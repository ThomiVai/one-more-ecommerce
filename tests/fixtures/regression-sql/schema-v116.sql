-- ONE MORE V116: registro independiente de ventas, sin Loyverse.
CREATE TABLE IF NOT EXISTS sales (
 id TEXT PRIMARY KEY,
 reference TEXT NOT NULL UNIQUE,
 sold_at TEXT NOT NULL,
 channel TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 revenue_cents INTEGER NOT NULL CHECK(revenue_cents>=0),
 cost_cents INTEGER NOT NULL CHECK(cost_cents>=0),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sale_lines (
 id TEXT PRIMARY KEY,
 sale_id TEXT NOT NULL REFERENCES sales(id),
 product_id TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents>=0)
);
CREATE INDEX IF NOT EXISTS sale_lines_sale_idx ON sale_lines(sale_id);
