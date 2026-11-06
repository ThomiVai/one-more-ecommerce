CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 source TEXT NOT NULL DEFAULT 'manual',
 customer_name TEXT NOT NULL DEFAULT '',
 customer_phone TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled')),
 total_cents INTEGER NOT NULL DEFAULT 0,
 currency TEXT NOT NULL DEFAULT 'ARS',
 note TEXT NOT NULL DEFAULT '',
 items_json TEXT NOT NULL,
 loyverse_receipt_id TEXT,
 CHECK(total_cents >= 0)
);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at);
