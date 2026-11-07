import { apiError, json, requireAdmin } from '../_lib/quotes.js';

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    const url = new URL(request.url);
    const before = url.searchParams.get('before');
    const cursor = before === null ? Number.MAX_SAFE_INTEGER : Number(before);
    if (!Number.isSafeInteger(cursor) || cursor < 0) return json({ error: 'invalid_cursor' }, 400);
    const beforeId = url.searchParams.get('beforeId') || '\uffff';
    if (beforeId.length > 40) return json({ error: 'invalid_cursor' }, 400);
    const rows = await env.QUOTES_DB.prepare(
      'SELECT q.request_id AS requestId, q.quote_number AS number, q.name, q.contact, q.lang, q.created_at AS createdAt, q.status, o.status AS notification, o.attempts, o.last_error AS notificationError, (SELECT COUNT(*) FROM quote_items i WHERE i.request_id = q.request_id) AS itemCount FROM quotes q JOIN notification_outbox o ON o.request_id = q.request_id WHERE q.created_at < ? OR (q.created_at = ? AND q.request_id < ?) ORDER BY q.created_at DESC, q.request_id DESC LIMIT 50',
    )
      .bind(cursor, cursor, beforeId)
      .all();
    const last = rows.results?.at(-1);
    return json({
      quotes: rows.results || [],
      nextCursor:
        rows.results?.length === 50 ? { before: last.createdAt, beforeId: last.requestId } : null,
    });
  } catch (error) {
    return apiError(error);
  }
}

export function onRequest() {
  return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
}
