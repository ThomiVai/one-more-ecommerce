-- SOLO YOUR_D1_DATABASE_NAME. Aditivo. Conserva devoluciones y apuntes originales.
CREATE TABLE IF NOT EXISTS return_reversals (
 id TEXT PRIMARY KEY,
 record_type TEXT NOT NULL CHECK(record_type IN ('sale','purchase')),
 return_id TEXT NOT NULL,
 record_id TEXT NOT NULL,
 operation_key TEXT NOT NULL UNIQUE REFERENCES management_operations(operation_key),
 reversed_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 amount_cents INTEGER NOT NULL,
 cost_cents INTEGER NOT NULL,
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(record_type,return_id)
);
CREATE TABLE IF NOT EXISTS return_stock_effects (
 record_type TEXT NOT NULL,
 return_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 before_quantity INTEGER NOT NULL,
 after_quantity INTEGER NOT NULL,
 before_cost_cents INTEGER NOT NULL,
 after_cost_cents INTEGER NOT NULL,
 revision_after INTEGER NOT NULL,
 PRIMARY KEY(record_type,return_id,product_id)
);
CREATE TABLE IF NOT EXISTS return_reversal_stock (
 reversal_id TEXT NOT NULL REFERENCES return_reversals(id),
 product_id TEXT NOT NULL,
 delta INTEGER NOT NULL,
 before_quantity INTEGER NOT NULL,
 after_quantity INTEGER NOT NULL,
 before_cost_cents INTEGER NOT NULL,
 after_cost_cents INTEGER NOT NULL,
 valuation_mode TEXT NOT NULL,
 PRIMARY KEY(reversal_id,product_id)
);
CREATE TRIGGER IF NOT EXISTS return_reversals_no_update BEFORE UPDATE ON return_reversals BEGIN
 SELECT RAISE(ABORT,'return_reversal_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS return_reversals_no_delete BEFORE DELETE ON return_reversals BEGIN
 SELECT RAISE(ABORT,'return_reversal_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS return_reversal_stock_no_update BEFORE UPDATE ON return_reversal_stock BEGIN
 SELECT RAISE(ABORT,'return_reversal_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS return_reversal_stock_no_delete BEFORE DELETE ON return_reversal_stock BEGIN
 SELECT RAISE(ABORT,'return_reversal_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS return_reversal_balance AFTER INSERT ON return_reversals BEGIN
 UPDATE settlement_revisions SET revision=revision+1 WHERE record_type=NEW.record_type AND record_id=NEW.record_id;
END;
CREATE VIEW IF NOT EXISTS active_sale_returns_v138 AS
 SELECT r.* FROM sale_returns r WHERE NOT EXISTS(SELECT 1 FROM return_reversals x WHERE x.record_type='sale' AND x.return_id=r.id);
CREATE VIEW IF NOT EXISTS active_purchase_returns_v138 AS
 SELECT r.* FROM purchase_returns r WHERE NOT EXISTS(SELECT 1 FROM return_reversals x WHERE x.record_type='purchase' AND x.return_id=r.id);
CREATE VIEW IF NOT EXISTS active_sale_return_lines_v138 AS
 SELECT l.* FROM sale_return_lines l JOIN active_sale_returns_v138 r ON r.id=l.return_id;
CREATE VIEW IF NOT EXISTS active_purchase_return_lines_v138 AS
 SELECT l.* FROM purchase_return_lines l JOIN active_purchase_returns_v138 r ON r.id=l.return_id;
DROP TRIGGER IF EXISTS sale_return_line_limit;
CREATE TRIGGER sale_return_line_limit BEFORE INSERT ON sale_return_lines BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM sale_lines l JOIN sale_returns r ON r.sale_id=l.sale_id WHERE l.id=NEW.sale_line_id AND r.id=NEW.return_id AND l.product_id=NEW.product_id AND l.unit_price_cents=NEW.unit_price_cents AND l.unit_cost_cents=NEW.unit_cost_cents AND NEW.quantity+COALESCE((SELECT SUM(x.quantity) FROM active_sale_return_lines_v138 x WHERE x.sale_line_id=l.id),0)<=l.quantity
 ) THEN RAISE(ABORT,'concurrent_change_return_limit') END;
END;
DROP TRIGGER IF EXISTS purchase_return_line_limit;
CREATE TRIGGER purchase_return_line_limit BEFORE INSERT ON purchase_return_lines BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM purchase_lines l JOIN purchase_returns r ON r.purchase_id=l.purchase_id WHERE l.id=NEW.purchase_line_id AND r.id=NEW.return_id AND l.product_id=NEW.product_id AND l.unit_cost_cents=NEW.unit_cost_cents AND l.line_total_cents=NEW.original_line_total_cents AND NEW.quantity+COALESCE((SELECT SUM(x.quantity) FROM active_purchase_return_lines_v138 x WHERE x.purchase_line_id=l.id),0)<=l.quantity
 ) THEN RAISE(ABORT,'concurrent_change_purchase_return_limit') END;
END;
DROP VIEW IF EXISTS sales_activity_v135;
CREATE VIEW sales_activity_v135 AS
 SELECT id,sold_at day,channel,1 sales_count,0 returns_count,revenue_cents,cost_cents,revenue_cents gross_revenue_cents,0 refund_cents,0 corrections_count FROM sales
 UNION ALL SELECT r.id,r.returned_at,s.channel,0,1,-r.refund_cents,-r.cost_reversal_cents,0,r.refund_cents,0 FROM sale_returns r JOIN sales s ON s.id=r.sale_id
 UNION ALL SELECT x.id,x.reversed_at,s.channel,0,0,x.amount_cents,x.cost_cents,0,-x.amount_cents,1 FROM return_reversals x JOIN sales s ON s.id=x.record_id WHERE x.record_type='sale';
DROP VIEW IF EXISTS sale_item_activity_v135;
CREATE VIEW sale_item_activity_v135 AS
 SELECT l.product_id,s.sold_at day,l.quantity units,l.quantity*l.unit_price_cents revenue_cents,l.quantity*l.unit_cost_cents cost_cents FROM sale_lines l JOIN sales s ON s.id=l.sale_id
 UNION ALL SELECT l.product_id,r.returned_at,-l.quantity,-l.quantity*l.unit_price_cents,-l.quantity*l.unit_cost_cents*l.return_to_stock FROM sale_return_lines l JOIN sale_returns r ON r.id=l.return_id
 UNION ALL SELECT l.product_id,x.reversed_at,l.quantity,l.quantity*l.unit_price_cents,l.quantity*l.unit_cost_cents*l.return_to_stock FROM sale_return_lines l JOIN return_reversals x ON x.return_id=l.return_id AND x.record_type='sale';
DROP VIEW IF EXISTS purchase_activity_v136;
CREATE VIEW purchase_activity_v136 AS
 SELECT id,document_date day,1 purchases_count,0 returns_count,document_total_cents amount_cents,document_total_cents gross_cents,0 credit_cents FROM purchase_documents
 UNION ALL SELECT id,returned_at,0,1,-credit_cents,0,credit_cents FROM purchase_returns
 UNION ALL SELECT id,reversed_at,0,0,amount_cents,0,-amount_cents FROM return_reversals WHERE record_type='purchase';
DROP VIEW IF EXISTS document_amounts_v137;
CREATE VIEW document_amounts_v137 AS
 SELECT 'sale' record_type,s.id record_id,s.sold_at record_date,s.revenue_cents original_cents,s.revenue_cents-COALESCE(r.amount,0) amount_cents FROM sales s LEFT JOIN (SELECT sale_id,SUM(refund_cents) amount FROM active_sale_returns_v138 GROUP BY sale_id) r ON r.sale_id=s.id
 UNION ALL SELECT 'purchase',p.id,p.document_date,p.document_total_cents,p.document_total_cents-COALESCE(r.amount,0) FROM purchase_documents p LEFT JOIN (SELECT purchase_id,SUM(credit_cents) amount FROM active_purchase_returns_v138 GROUP BY purchase_id) r ON r.purchase_id=p.id;
CREATE TABLE IF NOT EXISTS sale_combo_groups (
 id TEXT PRIMARY KEY,
 sale_id TEXT NOT NULL REFERENCES sales(id),
 combo_id TEXT NOT NULL,
 label TEXT NOT NULL,
 quantity INTEGER NOT NULL,
 unit_price_cents INTEGER NOT NULL,
 recipe_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sale_combo_components (
 sale_line_id TEXT PRIMARY KEY REFERENCES sale_lines(id),
 group_id TEXT NOT NULL REFERENCES sale_combo_groups(id),
 slot INTEGER NOT NULL
);
