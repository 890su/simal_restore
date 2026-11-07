PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS quotes (
  request_id TEXT PRIMARY KEY,
  quote_number TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted'
);

CREATE TABLE IF NOT EXISTS quote_items (
  request_id TEXT NOT NULL REFERENCES quotes(request_id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
  title TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  unit_price REAL,
  currency TEXT NOT NULL CHECK(currency = 'GEL'),
  product_url TEXT NOT NULL,
  availability TEXT NOT NULL,
  PRIMARY KEY (request_id, line_number)
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  request_id TEXT PRIMARY KEY REFERENCES quotes(request_id) ON DELETE CASCADE,
  parts_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent')),
  sent_parts INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at INTEGER
);

CREATE INDEX IF NOT EXISTS quotes_created_at ON quotes(created_at DESC);
CREATE INDEX IF NOT EXISTS notification_outbox_due ON notification_outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS quote_rate_limits (
  ip_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, bucket)
);
