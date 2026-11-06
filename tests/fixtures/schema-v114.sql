-- ONE MORE: inventario independiente de Loyverse. Ejecutar una sola vez en D1 staging.
CREATE TABLE IF NOT EXISTS stock_items (
  product_id TEXT PRIMARY KEY,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(cost_cents >= 0),
  min_quantity INTEGER NOT NULL DEFAULT 1 CHECK(min_quantity >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS stock_movements_product_date ON stock_movements(product_id,created_at DESC);
