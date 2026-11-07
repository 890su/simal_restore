import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  handleQuote,
  normalizeInput,
  resolveItems,
  messageParts,
  deliverNotification,
} from '../functions/api/_lib/quotes.js';
import { onRequestGet as listQuotes } from '../functions/api/admin/quotes.js';
import { onRequestPost as retryQuotes } from '../functions/api/admin/retry.js';

// Real SQLite executes the production SQL and migration; only the Cloudflare
// binding transport is adapted. No network calls or Telegram messages are made.
class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(
      readFileSync(new URL('../migrations/0001_quotes.sql', import.meta.url), 'utf8'),
    );
    this.failOn = null;
  }
  prepare(sql) {
    const db = this;
    return {
      sql,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        return db.sqlite.prepare(sql).get(...this.args) || null;
      },
      async all() {
        return { success: true, results: db.sqlite.prepare(sql).all(...this.args) };
      },
      async run() {
        return { success: true, meta: db.sqlite.prepare(sql).run(...this.args) };
      },
    };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) => {
        if (this.failOn && statement.sql.includes(this.failOn))
          throw new Error('injected storage failure');
        return { success: true, meta: this.sqlite.prepare(statement.sql).run(...statement.args) };
      });
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  count(table) {
    return this.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  }
  close() {
    this.sqlite.close();
  }
}

const REQUEST_ID = '7a0ba107-6a08-46bd-9379-5a78be477159';
const catalog = {
  schemaVersion: 1,
  products: [
    {
      id: 'simal-1',
      sku: 'BED-1',
      active: true,
      translations: {
        ru: { title: 'Кровать <дуб>', url: '/catalog/beds/one/' },
        en: { title: 'Oak bed', url: '/en/catalog/beds/one/' },
      },
      price: 499.5,
      currency: 'GEL',
      availability: 'unknown',
      variants: [],
    },
    {
      id: 'simal-2',
      sku: 'BED-2',
      active: true,
      translations: { ru: { title: 'Матрас', url: '/catalog/mattresses/two/' } },
      price: null,
      currency: 'GEL',
      availability: 'on_order',
      variants: [],
    },
  ],
};
function input(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    name: 'Тестовый посетитель',
    contact: '+995 555 123 456',
    comment: 'Только локальный тест',
    lang: 'ru',
    items: [{ id: 'simal-1', quantity: 2 }],
    ...overrides,
  };
}
function fixture(t, overrides = {}) {
  const db = new TestD1();
  t.after(() => db.close());
  const env = {
    QUOTES_DB: db,
    QUOTE_IP_HASH_SECRET: 'test-ip-secret-at-least-24-characters',
    ...overrides,
  };
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    if (new URL(url).pathname === '/data/catalog.json') return Response.json(catalog);
    throw new Error('Unexpected network request; tests prohibit external delivery');
  };
  return { db, env, calls, fetcher };
}
function request(body, headers = {}) {
  return new Request('https://preview.simal.pages.dev/api/quote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://preview.simal.pages.dev',
      'CF-Connecting-IP': '192.0.2.1',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
function send(f, body = input(), extra = {}) {
  return handleQuote({ request: request(body), env: f.env, fetch: f.fetcher, ...extra });
}

test('menu enquiry saves and sends to the configured Telegram chat without a catalog', async (t) => {
  const f = fixture(t, { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' });
  const calls = [];
  const fetcher = async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.telegram.org');
    calls.push(JSON.parse(options.body));
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  const pending = [];
  const extra = { fetch: fetcher, waitUntil: (promise) => pending.push(promise) };
  const payload = input({ kind: 'enquiry', items: [], comment: 'Вопрос о доставке <дома>' });
  const first = await send(f, payload, extra);
  const receipt = await first.json();
  assert.equal(first.status, 201);
  await Promise.all(pending);
  assert.equal(f.db.count('quotes'), 1);
  assert.equal(f.db.count('quote_items'), 0);
  assert.equal(f.db.count('notification_outbox'), 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chat_id, 'test-chat');
  assert.ok(calls[0].text.includes(`запрос с сайта ${receipt.id}`));
  assert.ok(calls[0].text.includes('Вопрос о доставке &lt;дома&gt;'));

  const repeat = await send(f, payload, extra);
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).id, receipt.id);
  assert.equal(calls.length, 1);
  for (const invalid of [input({ items: [] }), { ...payload, contact: 'person@example.com' }, { ...payload, comment: '' }]) {
    assert.equal((await send(f, invalid, extra)).status, 400);
  }
});

test('acceptance persists server-side product snapshot and outbox before any notification', async (t) => {
  const f = fixture(t);
  const response = await send(
    f,
    input({ items: [{ id: 'simal-1', quantity: 2, price: 1, title: 'forged' }] }),
  );
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.status, 'accepted');
  assert.equal(body.notification, 'pending');
  assert.match(body.id, /^SIM-\d{8}-[A-F0-9]{8}$/);
  assert.equal(f.db.count('quotes'), 1);
  assert.equal(f.db.count('quote_items'), 1);
  assert.equal(f.db.count('notification_outbox'), 1);
  const line = f.db.sqlite.prepare('SELECT * FROM quote_items').get();
  assert.equal(line.title, 'Кровать <дуб>');
  assert.equal(line.unit_price, 499.5);
  assert.equal(line.quantity, 2);
  const stored = f.db.sqlite.prepare('SELECT * FROM quotes').get();
  assert.equal(stored.ip_hash.length, 64);
  assert.notEqual(stored.ip_hash, '192.0.2.1');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(f.calls.length, 1);
});

test('same UUID and normalized payload return same number; changed payload returns 409', async (t) => {
  const f = fixture(t);
  const first = await (await send(f)).json();
  const replayResponse = await send(f);
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200);
  assert.equal(replay.id, first.id);
  assert.equal(replay.duplicate, true);
  const changed = await send(f, input({ comment: 'Changed' }));
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error, 'request_id_conflict');
  assert.equal(f.db.count('quotes'), 1);
  assert.equal(f.calls.length, 1, 'retries do not need catalog or message provider');
});

test('item ordering is canonical and concurrent retries create one atomic submission', async (t) => {
  const f = fixture(t);
  const items = [
    { id: 'simal-1', quantity: 1 },
    { id: 'simal-2', quantity: 3 },
  ];
  const responses = await Promise.all([
    send(f, input({ items })),
    send(f, input({ items: [...items].reverse() })),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(bodies[0].id, bodies[1].id);
  assert.equal(f.db.count('quotes'), 1);
  assert.equal(f.db.count('quote_items'), 2);
  assert.equal(f.db.count('notification_outbox'), 1);
});

test('outbox insert failure rolls back quote and every line; no false receipt', async (t) => {
  const f = fixture(t);
  f.db.failOn = 'INSERT INTO notification_outbox';
  const response = await send(f);
  assert.equal(response.status, 503);
  assert.equal(f.db.count('quotes'), 0);
  assert.equal(f.db.count('quote_items'), 0);
  assert.equal(f.db.count('notification_outbox'), 0);
  assert.equal((await response.json()).error, 'storage_unavailable');
});

test('missing binding or IP hash secret fails closed', async (t) => {
  const f = fixture(t);
  for (const env of [{}, { QUOTES_DB: f.db }, { QUOTES_DB: f.db, QUOTE_IP_HASH_SECRET: 'short' }]) {
    const response = await send(f, input(), { env });
    assert.equal(response.status, 503);
  }
  assert.equal(f.db.count('quotes'), 0);
  assert.equal(f.calls.length, 0);
});

test('validation rejects malformed contacts, bounds, duplicate and unknown products', async (t) => {
  const f = fixture(t);
  const invalid = [
    { requestId: 'not-a-uuid' },
    { name: 'x' },
    { contact: 'not a contact' },
    { comment: 'x'.repeat(1501) },
    { website: 'spam.example' },
    { lang: 'ge' },
    { items: [] },
    { items: [{ id: 'simal-1', quantity: 1.5 }] },
    { items: [{ id: 'simal-1', quantity: 0 }] },
    { items: [{ id: 'simal-1', quantity: 10000 }] },
    {
      items: [
        { id: 'simal-1', quantity: 1 },
        { id: 'simal-1', quantity: 2 },
      ],
    },
  ];
  for (const patch of invalid)
    assert.equal((await send(f, input(patch))).status, 400, JSON.stringify(patch));
  const unknown = await send(f, input({ items: [{ id: 'not-published', quantity: 1 }] }));
  assert.equal(unknown.status, 409);
  assert.equal((await unknown.json()).error, 'product_unavailable');
  assert.equal(f.db.count('quotes'), 0);
});

test('variants must be published and selected explicitly; null price stays unknown', () => {
  const base = normalizeInput(input({ items: [{ id: 'simal-2', quantity: 1 }], lang: 'ka' }));
  assert.equal(resolveItems(base, catalog)[0].price, null);
  const variantCatalog = structuredClone(catalog);
  variantCatalog.products[1].variants = [{ id: 'width-160', price: 250, active: true }];
  assert.throws(() => resolveItems(base, variantCatalog), /variant_required/);
  const chosen = normalizeInput(
    input({ items: [{ id: 'simal-2', variantId: 'width-160', quantity: 1 }] }),
  );
  assert.equal(resolveItems(chosen, variantCatalog)[0].price, 250);
  assert.throws(
    () =>
      resolveItems(
        normalizeInput(input({ items: [{ id: 'simal-2', variantId: 'invented', quantity: 1 }] })),
        variantCatalog,
      ),
    /variant_unavailable/,
  );
  variantCatalog.products[1].active = false;
  assert.throws(() => resolveItems(chosen, variantCatalog), /product_unavailable/);
});

test('translated title uses RU canonical URL when localized page is absent', () => {
  const translatedCatalog = structuredClone(catalog);
  translatedCatalog.products[0].translations.en.url = '';
  translatedCatalog.products[0].translations.ka = { title: 'ქართული სახელი', url: '' };
  for (const lang of ['en', 'ka']) {
    const item = resolveItems(normalizeInput(input({ lang })), translatedCatalog)[0];
    assert.equal(item.title, translatedCatalog.products[0].translations[lang].title);
    assert.equal(item.url, 'https://simal.ge/catalog/beds/one/');
  }
  translatedCatalog.products[0].translations.ru.url = '';
  translatedCatalog.products[0].translations.ka.url = '/ge/catalog/beds/one/';
  assert.equal(
    resolveItems(normalizeInput(input({ lang: 'en' })), translatedCatalog)[0].url,
    'https://simal.ge/ge/catalog/beds/one/',
  );
  translatedCatalog.products[0].translations.ka.url = '//untrusted.example/product';
  assert.throws(
    () => resolveItems(normalizeInput(input({ lang: 'en' })), translatedCatalog),
    /catalog_unavailable/,
  );
});

test('out-of-stock product or variant is refused before a receipt is created', async (t) => {
  const f = fixture(t);
  const unavailable = structuredClone(catalog);
  unavailable.products[0].availability = 'out_of_stock';
  const response = await send(f, input(), { fetch: async () => Response.json(unavailable) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'product_unavailable');
  assert.equal(f.db.count('quotes'), 0);
  unavailable.products[0].availability = 'in_stock';
  unavailable.products[0].variants = [{ id: 'width-160', availability: 'out_of_stock' }];
  assert.throws(
    () =>
      resolveItems(
        normalizeInput(input({ items: [{ id: 'simal-1', variantId: 'width-160', quantity: 1 }] })),
        unavailable,
      ),
    /product_unavailable/,
  );
});

test('Origin is exact, missing or lookalike origin is forbidden, oversized body is rejected', async (t) => {
  const f = fixture(t);
  for (const origin of ['', 'https://evil.example', 'https://simal.ge.evil.example']) {
    const response = await send(f, input(), { request: request(input(), { Origin: origin }) });
    assert.equal(response.status, 403);
  }
  const oversized = await send(f, input({ comment: 'x'.repeat(40000) }));
  assert.equal(oversized.status, 413);
  const wrongType = await send(f, input(), {
    request: request(input(), { 'Content-Type': 'text/plain' }),
  });
  assert.equal(wrongType.status, 415);
});

test('atomic IP limiter blocks eleventh new attempt but does not block an accepted replay', async (t) => {
  const f = fixture(t);
  for (let index = 0; index < 10; index++) {
    const response = await send(
      f,
      input({ requestId: index === 0 ? REQUEST_ID : crypto.randomUUID() }),
    );
    assert.equal(response.status, 201);
  }
  const blocked = await send(f, input({ requestId: crypto.randomUUID() }));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '600');
  assert.equal((await send(f)).status, 200);
  assert.equal(f.db.count('quotes'), 10);
});

test('Telegram failure retains accepted lead and retry sends saved outbox with no token leak', async (t) => {
  const f = fixture(t, {
    TELEGRAM_BOT_TOKEN: 'fake-token-not-real',
    TELEGRAM_CHAT_ID: 'fake-chat',
    QUOTE_ADMIN_TOKEN: 'test-admin-token-at-least-32-characters',
  });
  const failedFetch = async (url, options) => {
    if (new URL(url).pathname === '/data/catalog.json') return Response.json(catalog);
    assert.equal(JSON.parse(options.body).chat_id, 'fake-chat');
    throw new Error(`sensitive URL: ${url}`);
  };
  const response = await send(f, input(), { fetch: failedFetch });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.notification, 'pending');
  const pending = f.db.sqlite.prepare('SELECT * FROM notification_outbox').get();
  assert.equal(pending.status, 'pending');
  assert.equal(pending.attempts, 1);
  assert.equal(pending.last_error, 'delivery_failed');
  assert.ok(!JSON.stringify(pending).includes('fake-token'));
  f.db.sqlite.exec('UPDATE notification_outbox SET next_attempt_at = 0');
  let sent = 0;
  const retry = await retryQuotes({
    request: new Request('https://simal.ge/api/admin/retry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.env.QUOTE_ADMIN_TOKEN}` },
    }),
    env: f.env,
    fetch: async () => {
      sent++;
      return Response.json({ ok: true });
    },
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).results[0].notification, 'sent');
  assert.equal(sent, 1);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM notification_outbox').get().status, 'sent');
  assert.equal(f.db.count('quotes'), 1);
});

test('background delivery returns receipt before messenger completes', async (t) => {
  const f = fixture(t, { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat' });
  const background = [];
  const response = await send(f, input(), {
    waitUntil: (promise) => background.push(promise),
    fetch: async (url) =>
      new URL(url).pathname === '/data/catalog.json'
        ? Response.json(catalog)
        : Response.json({ ok: true }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).notification, 'pending');
  assert.equal(background.length, 1);
  await Promise.all(background);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM notification_outbox').get().status, 'sent');
});

test('long HTML notification chunks never cut entities or Unicode and retry resumes parts', async (t) => {
  const f = fixture(t, { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat' });
  await send(f, input(), { env: { ...f.env, TELEGRAM_BOT_TOKEN: undefined } });
  const parts = messageParts(
    'SIM-TEST',
    { name: 'Test', contact: 'test@example.com', lang: 'ru', comment: '<&"\'😀'.repeat(400) },
    [],
  );
  assert.ok(parts.length > 2);
  for (const part of parts) {
    assert.ok(part.length < 3500);
    assert.ok(!part.includes('<'));
    assert.ok(!/&(?!(?:amp|lt|gt|quot|#39);)/.test(part));
    assert.ok(!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(part));
  }
  f.db.sqlite
    .prepare('UPDATE notification_outbox SET parts_json = ?, next_attempt_at = 0')
    .run(JSON.stringify(parts));
  let calls = 0;
  await deliverNotification(f.db, REQUEST_ID, f.env, async () => {
    calls++;
    return calls === 1
      ? Response.json({ ok: true })
      : Response.json({ ok: false }, { status: 500 });
  });
  assert.equal(
    f.db.sqlite.prepare('SELECT sent_parts FROM notification_outbox').get().sent_parts,
    1,
  );
  f.db.sqlite.exec('UPDATE notification_outbox SET next_attempt_at = 0');
  const delivered = [];
  for (let index = 0; index < 5; index++) {
    await deliverNotification(f.db, REQUEST_ID, f.env, async (_url, options) => {
      delivered.push(JSON.parse(options.body).text);
      return Response.json({ ok: true });
    });
    if (f.db.sqlite.prepare('SELECT status FROM notification_outbox').get().status === 'sent')
      break;
  }
  assert.deepEqual(delivered, parts.slice(1));
});

test('admin endpoints fail closed; authenticated list contains accepted receipts', async (t) => {
  const f = fixture(t, { QUOTE_ADMIN_TOKEN: 'test-admin-token-at-least-32-characters' });
  await send(f);
  const unauthenticated = await listQuotes({
    request: new Request('https://simal.ge/api/admin/quotes'),
    env: f.env,
  });
  assert.equal(unauthenticated.status, 401);
  const allowed = await listQuotes({
    request: new Request('https://simal.ge/api/admin/quotes', {
      headers: { Authorization: `Bearer ${f.env.QUOTE_ADMIN_TOKEN}` },
    }),
    env: f.env,
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).quotes.length, 1);
  assert.equal(allowed.headers.get('Cache-Control'), 'no-store');
  assert.equal(
    (
      await retryQuotes({
        request: new Request('https://simal.ge/api/admin/retry', { method: 'POST' }),
        env: f.env,
      })
    ).status,
    401,
  );
});

test('configured Turnstile requires valid token and hostname, while accepted replay needs no fresh token', async (t) => {
  const f = fixture(t, { TURNSTILE_SECRET_KEY: 'fake-turnstile-secret' });
  assert.equal((await send(f)).status, 400);
  let hostname = 'evil.example';
  const fetcher = async (url) =>
    new URL(url).hostname === 'challenges.cloudflare.com'
      ? Response.json({ success: true, hostname, action: 'quote' })
      : Response.json(catalog);
  assert.equal(
    (await send(f, input({ turnstileToken: 'test-token' }), { fetch: fetcher })).status,
    400,
  );
  hostname = 'preview.simal.pages.dev';
  assert.equal(
    (await send(f, input({ turnstileToken: 'test-token' }), { fetch: fetcher })).status,
    201,
  );
  assert.equal((await send(f)).status, 200);
});
