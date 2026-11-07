const MAX_BODY_BYTES = 32768;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,180}$/;
const encoder = new TextEncoder();

export class QuoteError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

function textField(value, maximum, code, minimum = 0) {
  if (typeof value !== 'string') throw new QuoteError(code);
  const text = value.trim();
  if (
    text.length < minimum ||
    text.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  )
    throw new QuoteError(code);
  return text;
}

export function normalizeInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new QuoteError('invalid_request');
  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId))
    throw new QuoteError('invalid_request_id');
  const name = textField(body.name, 100, 'invalid_name', 2);
  const contact = textField(body.contact ?? body.phone, 120, 'invalid_contact', 5);
  if (!(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ||
    (/^[+\d\s()\-]+$/.test(contact) && contact.replace(/\D/g, '').length >= 7)
  ))
    throw new QuoteError('invalid_contact');
  const comment = textField(body.comment ?? '', 1500, 'invalid_comment');
  const lang = body.lang ?? 'ru';
  if (!['ru', 'en', 'ka'].includes(lang)) throw new QuoteError('invalid_language');
  if (body.website !== undefined && (typeof body.website !== 'string' || body.website.length))
    throw new QuoteError('invalid_request');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50)
    throw new QuoteError('invalid_items');
  const seen = new Set();
  const items = body.items
    .map((item) => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        !ID.test(item.id) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 9999
      )
        throw new QuoteError('invalid_item');
      const variantId = item.variantId ?? null;
      if (variantId !== null && (typeof variantId !== 'string' || !ID.test(variantId)))
        throw new QuoteError('invalid_variant');
      const key = JSON.stringify([item.id, variantId]);
      if (seen.has(key)) throw new QuoteError('duplicate_item');
      seen.add(key);
      return { id: item.id, variantId, quantity: item.quantity };
    })
    .sort((a, b) => {
      const left = `${a.id}\0${a.variantId || ''}`;
      const right = `${b.id}\0${b.variantId || ''}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  return { requestId: body.requestId.toLowerCase(), name, contact, comment, lang, items };
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashIp(ip, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(ip));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function checkOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = new Set([new URL(request.url).origin, 'https://simal.ge']);
  for (const entry of (env.QUOTE_ALLOWED_ORIGINS || '').split(',')) {
    if (!entry.trim()) continue;
    try {
      const url = new URL(entry.trim());
      if (url.origin === entry.trim() && ['https:', 'http:'].includes(url.protocol))
        allowed.add(url.origin);
    } catch {
      /* Ignore invalid configuration, never widen access. */
    }
  }
  if (!origin || !allowed.has(origin)) throw new QuoteError('origin_forbidden', 403);
}

async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || ''))
    throw new QuoteError('json_required', 415);
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY_BYTES) throw new QuoteError('request_too_large', 413);
  if (!request.body) throw new QuoteError('invalid_json');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new QuoteError('request_too_large', 413);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new QuoteError('invalid_json');
  }
}

export function resolveItems(input, catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.products))
    throw new QuoteError('catalog_unavailable', 503);
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  return input.items.map((item) => {
    const product = products.get(item.id);
    if (!product || product.active !== true || product.availability === 'out_of_stock')
      throw new QuoteError('product_unavailable', 409);
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const variant =
      item.variantId === null
        ? null
        : variants.find((entry) => entry.id === item.variantId && entry.active !== false);
    if (item.variantId !== null && !variant) throw new QuoteError('variant_unavailable', 409);
    if (variants.length && item.variantId === null) throw new QuoteError('variant_required', 409);
    if (variant?.availability === 'out_of_stock') throw new QuoteError('product_unavailable', 409);
    const copy =
      product.translations?.[input.lang] ||
      product.translations?.ru ||
      product.translations?.en ||
      product.translations?.ka;
    if (!copy || typeof copy.title !== 'string' || !copy.title.trim() || product.currency !== 'GEL')
      throw new QuoteError('catalog_unavailable', 503);
    const price = variant && Object.hasOwn(variant, 'price') ? variant.price : product.price;
    if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0))
      throw new QuoteError('catalog_unavailable', 503);
    // A translated title can exist before its localized page. Keep that title
    // while linking to the first valid published canonical product page.
    const path = [
      copy.url,
      product.translations?.ru?.url,
      product.translations?.en?.url,
      product.translations?.ka?.url,
    ].find(
      (value) =>
        typeof value === 'string' &&
        value.startsWith('/') &&
        !value.startsWith('//') &&
        !/[\r\n\\]/.test(value),
    );
    if (!path) throw new QuoteError('catalog_unavailable', 503);
    return {
      ...item,
      title: copy.title.slice(0, 500),
      sku: String(product.sku || '').slice(0, 100),
      price,
      currency: 'GEL',
      url: new URL(path, 'https://simal.ge').href,
      availability: String(variant?.availability || product.availability || 'unknown').slice(0, 40),
    };
  });
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape one Unicode code point at a time: neither surrogate pairs nor HTML
// entities nor markup can be cut across Telegram message boundaries.
export function messageParts(number, input, items) {
  const content = [
    `Имя: ${input.name}`,
    `Контакт: ${input.contact}`,
    `Язык: ${input.lang}`,
    input.comment ? `Комментарий: ${input.comment}` : '',
    '',
    ...items.map(
      (item, index) =>
        `${index + 1}. ${item.title}\nКод: ${item.id}${item.variantId ? ` / ${item.variantId}` : ''}; количество: ${item.quantity}\nЦена из каталога: ${item.price === null ? 'по запросу' : `${item.price} GEL`}; статус: ${item.availability}\n${item.url}`,
    ),
    '',
    'Заявка на уточнение условий; наличие и цена не зарезервированы.',
  ].join('\n');
  const parts = [];
  let current = '';
  for (const point of content) {
    const escaped = escapeHtml(point);
    if (current.length + escaped.length > 3200) {
      parts.push(current);
      current = '';
    }
    current += escaped;
  }
  if (current) parts.push(current);
  return parts.map(
    (part, index) =>
      `SIMAL — заявка ${escapeHtml(number)}\nЧасть ${index + 1}/${parts.length}\n\n${part}`,
  );
}

function existingQuote(db, requestId) {
  return db
    .prepare(
      'SELECT q.request_id, q.quote_number, q.payload_hash, o.status AS notification_status FROM quotes q JOIN notification_outbox o ON o.request_id = q.request_id WHERE q.request_id = ?',
    )
    .bind(requestId)
    .first();
}

function accepted(row, duplicate = false) {
  return json(
    {
      id: row.quote_number,
      requestId: row.request_id,
      status: 'accepted',
      notification: row.notification_status === 'sent' ? 'sent' : 'pending',
      duplicate,
    },
    duplicate ? 200 : 201,
  );
}

async function checkTurnstile(body, request, env, fetcher) {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (
    typeof body.turnstileToken !== 'string' ||
    !body.turnstileToken ||
    body.turnstileToken.length > 2048
  )
    throw new QuoteError('verification_required', 400);
  let response, result;
  try {
    response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: body.turnstileToken,
        remoteip: request.headers.get('CF-Connecting-IP') || undefined,
      }),
    });
    result = await response.json();
  } catch {
    throw new QuoteError('verification_unavailable', 503);
  }
  const hostname = new URL(request.url).hostname;
  if (
    !response.ok ||
    result.success !== true ||
    result.hostname !== hostname ||
    (result.action && result.action !== 'quote')
  )
    throw new QuoteError('verification_failed', 400);
}

async function rateLimit(db, ipHash, now) {
  const bucket = Math.floor(now / RATE_WINDOW_MS);
  const result = await db
    .prepare(
      'INSERT INTO quote_rate_limits (ip_hash, bucket, count) VALUES (?, ?, 1) ON CONFLICT(ip_hash, bucket) DO UPDATE SET count = count + 1 RETURNING count',
    )
    .bind(ipHash, bucket)
    .first();
  if (!result || result.count > RATE_LIMIT) throw new QuoteError('rate_limited', 429);
}

export async function handleQuote(context) {
  const { request, env } = context;
  const fetcher = context.fetch || fetch;
  try {
    checkOrigin(request, env);
    if (
      !env.QUOTES_DB ||
      typeof env.QUOTES_DB.batch !== 'function' ||
      typeof env.QUOTE_IP_HASH_SECRET !== 'string' ||
      env.QUOTE_IP_HASH_SECRET.length < 24
    )
      throw new QuoteError('service_unavailable', 503);
    const db = env.QUOTES_DB;
    const body = await readJson(request);
    const input = normalizeInput(body);
    const payloadHash = await sha256(JSON.stringify(input));
    const existing = await existingQuote(db, input.requestId);
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new QuoteError('request_id_conflict', 409);
      return accepted(existing, true);
    }
    const now = Date.now();
    const ipHash = await hashIp(
      request.headers.get('CF-Connecting-IP') || 'unknown',
      env.QUOTE_IP_HASH_SECRET,
    );
    await rateLimit(db, ipHash, now);
    await checkTurnstile(body, request, env, fetcher);
    let catalog;
    try {
      const url = new URL('/data/catalog.json', request.url);
      const response = env.ASSETS?.fetch
        ? await env.ASSETS.fetch(new Request(url))
        : await fetcher(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error();
      catalog = await response.json();
    } catch {
      throw new QuoteError('catalog_unavailable', 503);
    }
    const items = resolveItems(input, catalog);
    const number = `SIM-${new Date(now).toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const statements = [
      db
        .prepare(
          'INSERT INTO quotes (request_id, quote_number, payload_hash, name, contact, comment, lang, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          input.requestId,
          number,
          payloadHash,
          input.name,
          input.contact,
          input.comment,
          input.lang,
          now,
          ipHash,
        ),
    ];
    items.forEach((item, index) =>
      statements.push(
        db
          .prepare(
            'INSERT INTO quote_items (request_id, line_number, product_id, variant_id, quantity, title, sku, unit_price, currency, product_url, availability) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.requestId,
            index + 1,
            item.id,
            item.variantId,
            item.quantity,
            item.title,
            item.sku,
            item.price,
            item.currency,
            item.url,
            item.availability,
          ),
      ),
    );
    statements.push(
      db
        .prepare(
          'INSERT INTO notification_outbox (request_id, parts_json, next_attempt_at) VALUES (?, ?, ?)',
        )
        .bind(input.requestId, JSON.stringify(messageParts(number, input, items)), now),
    );
    try {
      const result = await db.batch(statements);
      if (!result || result.some((entry) => entry.success === false))
        throw new Error('batch_failed');
    } catch {
      // A concurrent retry may win the unique-key insert. Its batch is complete
      // before this SELECT; a different payload never reuses its receipt.
      const winner = await existingQuote(db, input.requestId);
      if (winner) {
        if (winner.payload_hash !== payloadHash) throw new QuoteError('request_id_conflict', 409);
        return accepted(winner, true);
      }
      throw new QuoteError('storage_unavailable', 503);
    }
    // Persistence determines acceptance. Do not keep a visitor waiting for a
    // messenger: Pages extends the background task with waitUntil. The same
    // function can also run in a bounded admin retry request.
    let notification = 'pending';
    const delivery = deliverNotification(db, input.requestId, env, fetcher).catch(() => 'pending');
    if (typeof context.waitUntil === 'function') context.waitUntil(delivery);
    else notification = await delivery;
    return accepted({
      request_id: input.requestId,
      quote_number: number,
      notification_status: notification,
    });
  } catch (error) {
    if (error instanceof QuoteError)
      return json(
        { error: error.code },
        error.status,
        error.status === 429 ? { 'Retry-After': '600' } : {},
      );
    return json({ error: 'service_unavailable' }, 503);
  }
}

export async function deliverNotification(db, requestId, env, fetcher = fetch) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return 'pending';
  const now = Date.now();
  const row = await db
    .prepare(
      "UPDATE notification_outbox SET status = 'sending', attempts = attempts + 1, lease_until = ? WHERE request_id = ? AND ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_until < ?)) RETURNING *",
    )
    .bind(now + 120000, requestId, now, now)
    .first();
  if (!row) return 'pending';
  try {
    const parts = JSON.parse(row.parts_json);
    const end = Math.min(parts.length, row.sent_parts + 2);
    for (let index = row.sent_parts; index < end; index++) {
      const response = await fetcher(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(8000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: parts[index],
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error('delivery_failed');
      await db
        .prepare(
          'UPDATE notification_outbox SET sent_parts = ?, lease_until = ? WHERE request_id = ?',
        )
        .bind(index + 1, Date.now() + 120000, requestId)
        .run();
    }
    if (end < parts.length) {
      await db
        .prepare(
          "UPDATE notification_outbox SET status = 'pending', next_attempt_at = ?, lease_until = 0, last_error = NULL WHERE request_id = ?",
        )
        .bind(Date.now(), requestId)
        .run();
      return 'pending';
    }
    await db
      .prepare(
        "UPDATE notification_outbox SET status = 'sent', sent_at = ?, lease_until = 0, last_error = NULL WHERE request_id = ?",
      )
      .bind(Date.now(), requestId)
      .run();
    return 'sent';
  } catch {
    // Never retain raw exception text: fetch URLs can contain the bot token.
    const delay = Math.min(3600000, 30000 * 2 ** Math.min(row.attempts, 7));
    await db
      .prepare(
        "UPDATE notification_outbox SET status = 'pending', next_attempt_at = ?, lease_until = 0, last_error = 'delivery_failed' WHERE request_id = ?",
      )
      .bind(Date.now() + delay, requestId)
      .run();
    return 'pending';
  }
}

export async function requireAdmin(request, env) {
  const secret = env.QUOTE_ADMIN_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32)
    throw new QuoteError('service_unavailable', 503);
  const auth = request.headers.get('Authorization') || '';
  // Compare fixed-length hashes rather than returning at a secret prefix.
  const expected = await sha256(`Bearer ${secret}`);
  const actual = await sha256(auth);
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++)
    mismatch |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  if (mismatch) throw new QuoteError('unauthorized', 401);
  if (!env.QUOTES_DB) throw new QuoteError('service_unavailable', 503);
}

export function apiError(error) {
  return json(
    { error: error instanceof QuoteError ? error.code : 'service_unavailable' },
    error instanceof QuoteError ? error.status : 503,
  );
}
