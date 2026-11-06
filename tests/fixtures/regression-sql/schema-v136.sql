-- SOLO YOUR_D1_DATABASE_NAME. Aditivo y repetible. No cambia compras ni stock anteriores.
CREATE TABLE IF NOT EXISTS purchase_returns (
 id TEXT PRIMARY KEY,
 purchase_id TEXT NOT NULL REFERENCES purchase_documents(id),
 operation_key TEXT NOT NULL UNIQUE REFERENCES management_operations(operation_key),
 returned_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 credit_cents INTEGER NOT NULL CHECK(credit_cents>=0),
 inventory_removed_cents INTEGER NOT NULL CHECK(inventory_removed_cents>=0),
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS purchase_returns_purchase ON purchase_returns(purchase_id,returned_at);
CREATE TABLE IF NOT EXISTS purchase_return_lines (
 id TEXT PRIMARY KEY,
 return_id TEXT NOT NULL REFERENCES purchase_returns(id),
 purchase_line_id TEXT NOT NULL REFERENCES purchase_lines(id),
 product_id TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 remove_from_stock INTEGER NOT NULL CHECK(remove_from_stock IN (0,1)),
 unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents>=0),
 original_line_total_cents INTEGER NOT NULL CHECK(original_line_total_cents>=0),
 credit_cents INTEGER NOT NULL CHECK(credit_cents>=0),
 UNIQUE(return_id,purchase_line_id)
);
CREATE INDEX IF NOT EXISTS purchase_return_lines_original ON purchase_return_lines(purchase_line_id);
CREATE TRIGGER IF NOT EXISTS purchase_return_line_limit BEFORE INSERT ON purchase_return_lines BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM purchase_lines l JOIN purchase_returns r ON r.purchase_id=l.purchase_id
  WHERE l.id=NEW.purchase_line_id AND r.id=NEW.return_id AND l.product_id=NEW.product_id
  AND l.unit_cost_cents=NEW.unit_cost_cents AND l.line_total_cents=NEW.original_line_total_cents
  AND NEW.quantity+COALESCE((SELECT SUM(x.quantity) FROM purchase_return_lines x WHERE x.purchase_line_id=l.id),0)<=l.quantity
 ) THEN RAISE(ABORT,'concurrent_change_purchase_return_limit') END;
END;
CREATE TRIGGER IF NOT EXISTS purchase_returns_no_update BEFORE UPDATE ON purchase_returns BEGIN
 SELECT RAISE(ABORT,'purchase_return_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS purchase_returns_no_delete BEFORE DELETE ON purchase_returns BEGIN
 SELECT RAISE(ABORT,'purchase_return_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS purchase_return_lines_no_update BEFORE UPDATE ON purchase_return_lines BEGIN
 SELECT RAISE(ABORT,'purchase_return_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS purchase_return_lines_no_delete BEFORE DELETE ON purchase_return_lines BEGIN
 SELECT RAISE(ABORT,'purchase_return_history_is_immutable');
END;
CREATE VIEW IF NOT EXISTS purchase_activity_v136 AS
 SELECT id,document_date day,1 purchases_count,0 returns_count,document_total_cents amount_cents,document_total_cents gross_cents,0 credit_cents FROM purchase_documents
 UNION ALL
 SELECT id,returned_at,0,1,-credit_cents,0,credit_cents FROM purchase_returns;
