import { apiError, deliverNotification, json, requireAdmin } from '../_lib/quotes.js';

export async function onRequestPost({ request, env, fetch: fetcher }) {
  try {
    await requireAdmin(request, env);
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)
      return json({ error: 'notification_not_configured' }, 503);
    const now = Date.now();
    const rows = await env.QUOTES_DB.prepare(
      "SELECT request_id FROM notification_outbox WHERE (status = 'pending' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_until < ?) ORDER BY next_attempt_at ASC LIMIT 5",
    )
      .bind(now, now)
      .all();
    const results = [];
    for (const row of rows.results || [])
      results.push({
        requestId: row.request_id,
        notification: await deliverNotification(
          env.QUOTES_DB,
          row.request_id,
          env,
          fetcher || fetch,
        ),
      });
    // Bound retention of rate-limit counters; do not delete leads or outbox data.
    await env.QUOTES_DB.prepare('DELETE FROM quote_rate_limits WHERE bucket < ?')
      .bind(Math.floor(now / 600000) - 144)
      .run();
    return json({ processed: results.length, results });
  } catch (error) {
    return apiError(error);
  }
}

export function onRequest() {
  return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
}
