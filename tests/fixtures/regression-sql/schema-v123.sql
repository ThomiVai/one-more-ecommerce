-- V123: nuevas fichas comerciales y variantes, sin alterar datos existentes.
CREATE TABLE IF NOT EXISTS catalog_new_products (
 id TEXT PRIMARY KEY,
 group_id TEXT NOT NULL,
 name TEXT NOT NULL,
 brand TEXT NOT NULL,
 size TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT 'Otros',
 price_cents INTEGER,
 publication_status TEXT NOT NULL DEFAULT 'draft' CHECK(publication_status IN ('draft','published','hidden')),
 image_url TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS catalog_new_products_group_idx ON catalog_new_products(group_id);
