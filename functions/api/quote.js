import { handleQuote } from './_lib/quotes.js';

export const onRequestPost = handleQuote;

export function onRequest() {
  return Response.json(
    { error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } },
  );
}
