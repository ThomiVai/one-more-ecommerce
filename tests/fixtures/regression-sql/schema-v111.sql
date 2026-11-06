-- Ejecutar en YOUR_D1_DATABASE_NAME (no elimina pedidos existentes)
CREATE TABLE IF NOT EXISTS product_mappings (
 web_product_id TEXT PRIMARY KEY,
 loyverse_item_id TEXT NOT NULL,
 loyverse_variant_id TEXT NOT NULL,
 loyverse_label TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS product_mappings_variant_idx ON product_mappings(loyverse_variant_id);
