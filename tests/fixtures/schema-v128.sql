-- ONE MORE V128 - STAGING ONLY
-- Mapeo reversible y no destructivo entre producto comercial y SKU físico.
-- No modifica stock_items, stock_movements, sales, purchase_lines ni catalogo.
CREATE TABLE IF NOT EXISTS catalog_stock_links (
  catalog_id TEXT PRIMARY KEY,
  stock_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS catalog_stock_links_stock_idx ON catalog_stock_links(stock_id);
