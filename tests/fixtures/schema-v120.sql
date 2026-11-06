CREATE TABLE IF NOT EXISTS catalog_overrides (
 product_id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 brand TEXT NOT NULL,
 size TEXT NOT NULL,
 price_cents INTEGER,
 publication_status TEXT NOT NULL DEFAULT 'draft' CHECK(publication_status IN ('draft','published','hidden')),
 image_url TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS catalog_overrides_status_idx ON catalog_overrides(publication_status);
