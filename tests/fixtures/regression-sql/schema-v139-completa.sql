-- SOLO YOUR_D1_DATABASE_NAME. Actualización acumulativa V128 → V138. Respaldar antes.

-- schema-v129.sql
-- SOLO YOUR_D1_DATABASE_NAME. Exportar antes. Aditivo y repetible.
-- No altera IDs, saldos ni operaciones históricas.
CREATE TABLE IF NOT EXISTS stock_revisions (
 product_id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
);
INSERT INTO stock_revisions(product_id,revision)
 SELECT product_id,0 FROM stock_items WHERE 1
 ON CONFLICT(product_id) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS stock_revision_insert AFTER INSERT ON stock_items BEGIN
 INSERT INTO stock_revisions(product_id,revision) VALUES(NEW.product_id,0)
 ON CONFLICT(product_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS stock_revision_update AFTER UPDATE ON stock_items BEGIN
 UPDATE stock_revisions SET revision=revision+1 WHERE product_id=NEW.product_id;
END;
CREATE TRIGGER IF NOT EXISTS stock_revision_delete AFTER DELETE ON stock_items BEGIN
 UPDATE stock_revisions SET revision=revision+1 WHERE product_id=OLD.product_id;
END;
CREATE TABLE IF NOT EXISTS management_assertions (
 id TEXT PRIMARY KEY,
 ok INTEGER NOT NULL CONSTRAINT concurrent_change CHECK(ok=1)
);
CREATE TABLE IF NOT EXISTS management_operations (
 operation_key TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 result_json TEXT NOT NULL,
 actor TEXT NOT NULL DEFAULT 'shared-admin',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_change_audit (
 id TEXT PRIMARY KEY,
 operation_key TEXT NOT NULL REFERENCES management_operations(operation_key),
 stock_id TEXT NOT NULL,
 before_json TEXT NOT NULL,
 after_json TEXT NOT NULL,
 reason TEXT NOT NULL,
 actor TEXT NOT NULL DEFAULT 'shared-admin',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_link_audit (
 id TEXT PRIMARY KEY,
 catalog_id TEXT NOT NULL,
 old_stock_id TEXT,
 new_stock_id TEXT,
 action TEXT NOT NULL,
 actor TEXT NOT NULL DEFAULT 'shared-admin',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Evita dobles altas concurrentes de la misma identidad textual normalizada.
CREATE TABLE IF NOT EXISTS catalog_creation_keys (
 signature TEXT PRIMARY KEY,
 product_id TEXT NOT NULL
);


-- schema-v132.sql
-- SOLO YOUR_D1_DATABASE_NAME. Aditivo y repetible. No altera datos comerciales.
CREATE TABLE IF NOT EXISTS team_users (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','operator')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 key_hash TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS team_sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES team_users(id),
 revision INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS team_sessions_user_idx ON team_sessions(user_id);
CREATE TABLE IF NOT EXISTS team_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 shared_access INTEGER NOT NULL DEFAULT 1 CHECK(shared_access IN (0,1))
);
INSERT INTO team_settings(id,shared_access) VALUES(1,1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS team_access_events (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL,
 actor_name TEXT NOT NULL,
 action TEXT NOT NULL,
 target_id TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS team_events_created_idx ON team_access_events(created_at);
CREATE TABLE IF NOT EXISTS team_login_limits (
 bucket TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 reset_at INTEGER NOT NULL
);


-- schema-v134.sql
-- SOLO YOUR_D1_DATABASE_NAME. Aditivo, repetible. No modifica registros comerciales.
-- Detecta cambios de identidad entre la lectura y la confirmación de una compra.
CREATE TABLE IF NOT EXISTS catalog_identity_revision (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO catalog_identity_revision(id,revision) VALUES(1,0) ON CONFLICT(id) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS catalog_revision_new_insert AFTER INSERT ON catalog_new_products BEGIN
 UPDATE catalog_identity_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_new_update AFTER UPDATE ON catalog_new_products BEGIN
 UPDATE catalog_identity_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_new_delete AFTER DELETE ON catalog_new_products BEGIN
 UPDATE catalog_identity_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_override_insert AFTER INSERT ON catalog_overrides BEGIN
 UPDATE catalog_identity_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_override_update AFTER UPDATE ON catalog_overrides BEGIN
 UPDATE catalog_identity_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_override_delete AFTER DELETE ON catalog_overrides BEGIN
 UPDATE catalog_identity_revision SET revision=revision+1 WHERE id=1;
END;


-- schema-v135.sql
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


-- schema-v136.sql
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


-- schema-v137.sql
-- SOLO YOUR_D1_DATABASE_NAME. Aditivo y repetible. No presume pagos históricos.
CREATE TABLE IF NOT EXISTS settlement_revisions (
 record_type TEXT NOT NULL CHECK(record_type IN ('sale','purchase')),
 record_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(record_type,record_id)
);
INSERT INTO settlement_revisions(record_type,record_id) SELECT 'sale',id FROM sales WHERE 1 ON CONFLICT DO NOTHING;
INSERT INTO settlement_revisions(record_type,record_id) SELECT 'purchase',id FROM purchase_documents WHERE 1 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS settlements (
 id TEXT PRIMARY KEY,
 operation_key TEXT NOT NULL UNIQUE REFERENCES management_operations(operation_key),
 record_type TEXT NOT NULL CHECK(record_type IN ('sale','purchase')),
 record_id TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('payment','refund')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 paid_at TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('cash','transfer','mercadopago','other')),
 reference TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '',
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS settlements_record ON settlements(record_type,record_id,created_at);
CREATE TABLE IF NOT EXISTS settlement_reversals (
 id TEXT PRIMARY KEY,
 settlement_id TEXT NOT NULL UNIQUE REFERENCES settlements(id),
 operation_key TEXT NOT NULL UNIQUE REFERENCES management_operations(operation_key),
 reversed_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS settlement_sale_insert AFTER INSERT ON sales BEGIN
 INSERT INTO settlement_revisions(record_type,record_id,revision) VALUES('sale',NEW.id,0) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS settlement_purchase_insert AFTER INSERT ON purchase_documents BEGIN
 INSERT INTO settlement_revisions(record_type,record_id,revision) VALUES('purchase',NEW.id,0) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS settlement_sale_update AFTER UPDATE ON sales BEGIN
 UPDATE settlement_revisions SET revision=revision+1 WHERE record_type='sale' AND record_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS settlement_purchase_update AFTER UPDATE ON purchase_documents BEGIN
 UPDATE settlement_revisions SET revision=revision+1 WHERE record_type='purchase' AND record_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS settlement_sale_return AFTER INSERT ON sale_returns BEGIN
 INSERT INTO settlement_revisions(record_type,record_id,revision) VALUES('sale',NEW.sale_id,1) ON CONFLICT(record_type,record_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS settlement_purchase_return AFTER INSERT ON purchase_returns BEGIN
 INSERT INTO settlement_revisions(record_type,record_id,revision) VALUES('purchase',NEW.purchase_id,1) ON CONFLICT(record_type,record_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS settlement_entry_revision AFTER INSERT ON settlements BEGIN
 INSERT INTO settlement_revisions(record_type,record_id,revision) VALUES(NEW.record_type,NEW.record_id,1) ON CONFLICT(record_type,record_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS settlement_reverse_revision AFTER INSERT ON settlement_reversals BEGIN
 UPDATE settlement_revisions SET revision=revision+1 WHERE (record_type,record_id) IN (SELECT record_type,record_id FROM settlements WHERE id=NEW.settlement_id);
END;
CREATE TRIGGER IF NOT EXISTS settlements_no_update BEFORE UPDATE ON settlements BEGIN
 SELECT RAISE(ABORT,'settlement_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS settlements_no_delete BEFORE DELETE ON settlements BEGIN
 SELECT RAISE(ABORT,'settlement_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS settlement_reversals_no_update BEFORE UPDATE ON settlement_reversals BEGIN
 SELECT RAISE(ABORT,'settlement_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS settlement_reversals_no_delete BEFORE DELETE ON settlement_reversals BEGIN
 SELECT RAISE(ABORT,'settlement_history_is_immutable');
END;
CREATE VIEW IF NOT EXISTS document_amounts_v137 AS
 SELECT 'sale' record_type,s.id record_id,s.sold_at record_date,s.revenue_cents original_cents,s.revenue_cents-COALESCE(r.amount,0) amount_cents FROM sales s LEFT JOIN (SELECT sale_id,SUM(refund_cents) amount FROM sale_returns GROUP BY sale_id) r ON r.sale_id=s.id
 UNION ALL
 SELECT 'purchase',p.id,p.document_date,p.document_total_cents,p.document_total_cents-COALESCE(r.amount,0) FROM purchase_documents p LEFT JOIN (SELECT purchase_id,SUM(credit_cents) amount FROM purchase_returns GROUP BY purchase_id) r ON r.purchase_id=p.id;
CREATE VIEW IF NOT EXISTS settlement_balances_v137 AS
 SELECT d.*,COALESCE(c.paid_cents,0) paid_cents,COALESCE(c.refunded_cents,0) refunded_cents,COALESCE(c.entry_count,0) entry_count,d.amount_cents-COALESCE(c.paid_cents,0)+COALESCE(c.refunded_cents,0) balance_cents,COALESCE(v.revision,0) revision FROM document_amounts_v137 d LEFT JOIN (SELECT e.record_type,e.record_id,SUM(CASE WHEN e.direction='payment' THEN e.amount_cents ELSE 0 END) paid_cents,SUM(CASE WHEN e.direction='refund' THEN e.amount_cents ELSE 0 END) refunded_cents,COUNT(*) entry_count FROM settlements e WHERE NOT EXISTS(SELECT 1 FROM settlement_reversals x WHERE x.settlement_id=e.id) GROUP BY e.record_type,e.record_id) c ON c.record_type=d.record_type AND c.record_id=d.record_id LEFT JOIN settlement_revisions v ON v.record_type=d.record_type AND v.record_id=d.record_id;


-- schema-v138.sql
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

-- SOLO YOUR_D1_DATABASE_NAME. Caja y revisión histórica, sin presumir dinero.
CREATE TABLE IF NOT EXISTS finance_revision (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO finance_revision(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS cash_opening (
 id INTEGER PRIMARY KEY CHECK(id=1),
 operation_key TEXT NOT NULL UNIQUE REFERENCES management_operations(operation_key),
 start_date TEXT NOT NULL,
 cash_cents INTEGER NOT NULL,
 transfer_cents INTEGER NOT NULL,
 mercadopago_cents INTEGER NOT NULL,
 other_cents INTEGER NOT NULL,
 note TEXT NOT NULL,
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cash_entries (
 id TEXT PRIMARY KEY,
 operation_key TEXT NOT NULL UNIQUE REFERENCES management_operations(operation_key),
 kind TEXT NOT NULL CHECK(kind IN ('expense','contribution','withdrawal','transfer','adjustment')),
 amount_cents INTEGER NOT NULL CHECK((kind='adjustment' AND amount_cents<>0) OR (kind<>'adjustment' AND amount_cents>0)),
 method TEXT NOT NULL CHECK(method IN ('cash','transfer','mercadopago','other')),
 destination TEXT CHECK(destination IN ('cash','transfer','mercadopago','other')),
 paid_at TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('shipping','commission','advertising','other')),
 note TEXT NOT NULL CHECK(length(note) BETWEEN 3 AND 300),
 record_type TEXT CHECK(record_type IN ('sale','purchase')),
 record_id TEXT,
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 CHECK((kind='transfer' AND destination IS NOT NULL AND destination<>method) OR (kind<>'transfer' AND destination IS NULL)),
 CHECK((record_type IS NULL AND record_id IS NULL) OR (kind='expense' AND record_type IS NOT NULL AND record_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS cash_reversals (
 id TEXT PRIMARY KEY,
 entry_id TEXT NOT NULL UNIQUE REFERENCES cash_entries(id),
 operation_key TEXT NOT NULL UNIQUE REFERENCES management_operations(operation_key),
 reversed_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS document_reviews (
 id TEXT PRIMARY KEY,
 operation_key TEXT NOT NULL UNIQUE REFERENCES management_operations(operation_key),
 record_type TEXT NOT NULL CHECK(record_type IN ('sale','purchase')),
 record_id TEXT NOT NULL,
 document_revision INTEGER NOT NULL,
 balance_cents INTEGER NOT NULL,
 conclusion TEXT NOT NULL CHECK(conclusion IN ('verified','needs_review')),
 note TEXT NOT NULL CHECK(length(note) BETWEEN 3 AND 300),
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS document_reviews_record ON document_reviews(record_type,record_id);
CREATE INDEX IF NOT EXISTS cash_entries_date ON cash_entries(paid_at);
CREATE VIEW IF NOT EXISTS cash_methods_v139 AS
 SELECT 'cash' method UNION ALL SELECT 'transfer' UNION ALL SELECT 'mercadopago' UNION ALL SELECT 'other';
CREATE VIEW IF NOT EXISTS cash_flows_v139 AS
 SELECT e.id source_id,'settlement' source,e.paid_at flow_date,e.method,CASE WHEN (e.record_type='sale' AND e.direction='payment') OR (e.record_type='purchase' AND e.direction='refund') THEN e.amount_cents ELSE -e.amount_cents END amount_cents FROM settlements e JOIN cash_opening o ON o.id=1 WHERE e.paid_at>=o.start_date
 UNION ALL
 SELECT x.id,'settlement-reversal',x.reversed_at,e.method,CASE WHEN (e.record_type='sale' AND e.direction='payment') OR (e.record_type='purchase' AND e.direction='refund') THEN -e.amount_cents ELSE e.amount_cents END FROM settlement_reversals x JOIN settlements e ON e.id=x.settlement_id JOIN cash_opening o ON o.id=1 WHERE e.paid_at>=o.start_date
 UNION ALL
 SELECT e.id,'cash-entry',e.paid_at,m.method,CASE WHEN m.method=e.destination THEN e.amount_cents WHEN e.kind IN ('expense','withdrawal','transfer') THEN -e.amount_cents ELSE e.amount_cents END FROM cash_entries e JOIN cash_methods_v139 m ON m.method=e.method OR (e.kind='transfer' AND m.method=e.destination)
 UNION ALL
 SELECT x.id,'cash-reversal',x.reversed_at,m.method,CASE WHEN m.method=e.destination THEN -e.amount_cents WHEN e.kind IN ('expense','withdrawal','transfer') THEN e.amount_cents ELSE -e.amount_cents END FROM cash_reversals x JOIN cash_entries e ON e.id=x.entry_id JOIN cash_methods_v139 m ON m.method=e.method OR (e.kind='transfer' AND m.method=e.destination);
CREATE VIEW IF NOT EXISTS expense_activity_v139 AS
 SELECT id source_id,paid_at activity_date,category,amount_cents FROM cash_entries WHERE kind='expense'
 UNION ALL
 SELECT x.id,x.reversed_at,e.category,-e.amount_cents FROM cash_reversals x JOIN cash_entries e ON e.id=x.entry_id WHERE e.kind='expense';
CREATE VIEW IF NOT EXISTS reconciliation_v139 AS
 SELECT b.*,CASE WHEN b.record_type='sale' THEN s.reference ELSE p.supplier||' · '||p.document_number END label,
 v.id review_id,v.conclusion,v.note review_note,v.actor review_actor,v.created_at reviewed_at,
 CASE WHEN v.conclusion='verified' AND v.document_revision=b.revision THEN 1 ELSE 0 END verified,
 CASE WHEN v.id IS NOT NULL AND v.document_revision<>b.revision THEN 1 ELSE 0 END outdated
 FROM settlement_balances_v137 b LEFT JOIN sales s ON b.record_type='sale' AND s.id=b.record_id LEFT JOIN purchase_documents p ON b.record_type='purchase' AND p.id=b.record_id
 LEFT JOIN document_reviews v ON v.rowid=(SELECT MAX(z.rowid) FROM document_reviews z WHERE z.record_type=b.record_type AND z.record_id=b.record_id);
CREATE TRIGGER IF NOT EXISTS cash_opening_no_update BEFORE UPDATE ON cash_opening BEGIN
 SELECT RAISE(ABORT,'finance_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS cash_opening_no_delete BEFORE DELETE ON cash_opening BEGIN
 SELECT RAISE(ABORT,'finance_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS cash_entries_no_update BEFORE UPDATE ON cash_entries BEGIN
 SELECT RAISE(ABORT,'finance_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS cash_entries_no_delete BEFORE DELETE ON cash_entries BEGIN
 SELECT RAISE(ABORT,'finance_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS cash_reversals_no_update BEFORE UPDATE ON cash_reversals BEGIN
 SELECT RAISE(ABORT,'finance_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS cash_reversals_no_delete BEFORE DELETE ON cash_reversals BEGIN
 SELECT RAISE(ABORT,'finance_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS document_reviews_no_update BEFORE UPDATE ON document_reviews BEGIN
 SELECT RAISE(ABORT,'finance_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS document_reviews_no_delete BEFORE DELETE ON document_reviews BEGIN
 SELECT RAISE(ABORT,'finance_history_is_immutable');
END;
CREATE TRIGGER IF NOT EXISTS finance_cash_opening_revision AFTER INSERT ON cash_opening BEGIN
 UPDATE finance_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS finance_cash_entries_revision AFTER INSERT ON cash_entries BEGIN
 UPDATE finance_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS finance_cash_reversals_revision AFTER INSERT ON cash_reversals BEGIN
 UPDATE finance_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS finance_settlements_revision AFTER INSERT ON settlements BEGIN
 UPDATE finance_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS finance_settlement_reversals_revision AFTER INSERT ON settlement_reversals BEGIN
 UPDATE finance_revision SET revision=revision+1 WHERE id=1;
END;
