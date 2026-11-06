-- SOLO YOUR_D1_DATABASE_NAME. Aditivo y repetible. No cambia ventas anteriores.
CREATE TABLE IF NOT EXISTS sale_returns (
 id TEXT PRIMARY KEY,
 sale_id TEXT NOT NULL REFERENCES sales(id),
 operation_key TEXT NOT NULL UNIQUE REFERENCES management_operations(operation_key),
 returned_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 refund_cents INTEGER NOT NULL CHECK(refund_cents>=0),
 cost_reversal_cents INTEGER NOT NULL CHECK(cost_reversal_cents>=0),
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sale_returns_sale ON sale_returns(sale_id,returned_at);
CREATE TABLE IF NOT EXISTS sale_return_lines (
 id TEXT PRIMARY KEY,
 return_id TEXT NOT NULL REFERENCES sale_returns(id),
 sale_line_id TEXT NOT NULL REFERENCES sale_lines(id),
 product_id TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 return_to_stock INTEGER NOT NULL CHECK(return_to_stock IN (0,1)),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents>=0),
 UNIQUE(return_id,sale_line_id)
);
CREATE INDEX IF NOT EXISTS sale_return_lines_original ON sale_return_lines(sale_line_id);
CREATE TRIGGER IF NOT EXISTS sale_return_line_limit BEFORE INSERT ON sale_return_lines BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM sale_lines l JOIN sale_returns r ON r.sale_id=l.sale_id
  WHERE l.id=NEW.sale_line_id AND r.id=NEW.return_id AND l.product_id=NEW.product_id
  AND l.unit_price_cents=NEW.unit_price_cents AND l.unit_cost_cents=NEW.unit_cost_cents
  AND NEW.quantity+COALESCE((SELECT SUM(x.quantity) FROM sale_return_lines x WHERE x.sale_line_id=l.id),0)<=l.quantity
 ) THEN RAISE(ABORT,'concurrent_change_return_limit') END;
END;
CREATE TRIGGER IF NOT EXISTS sale_returns_no_update BEFORE UPDATE ON sale_returns BEGIN
 SELECT RAISE(ABORT,'return_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS sale_returns_no_delete BEFORE DELETE ON sale_returns BEGIN
 SELECT RAISE(ABORT,'return_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS sale_return_lines_no_update BEFORE UPDATE ON sale_return_lines BEGIN
 SELECT RAISE(ABORT,'return_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS sale_return_lines_no_delete BEFORE DELETE ON sale_return_lines BEGIN
 SELECT RAISE(ABORT,'return_history_is_immutable');
END;
CREATE VIEW IF NOT EXISTS sales_activity_v135 AS
 SELECT id,sold_at day,channel,1 sales_count,0 returns_count,revenue_cents,cost_cents,revenue_cents gross_revenue_cents,0 refund_cents FROM sales
 UNION ALL
 SELECT r.id,r.returned_at,s.channel,0,1,-r.refund_cents,-r.cost_reversal_cents,0,r.refund_cents FROM sale_returns r JOIN sales s ON s.id=r.sale_id;
CREATE VIEW IF NOT EXISTS sale_item_activity_v135 AS
 SELECT l.product_id,s.sold_at day,l.quantity units,l.quantity*l.unit_price_cents revenue_cents,l.quantity*l.unit_cost_cents cost_cents FROM sale_lines l JOIN sales s ON s.id=l.sale_id
 UNION ALL
 SELECT l.product_id,r.returned_at,-l.quantity,-l.quantity*l.unit_price_cents,-l.quantity*l.unit_cost_cents*l.return_to_stock FROM sale_return_lines l JOIN sale_returns r ON r.id=l.return_id;
