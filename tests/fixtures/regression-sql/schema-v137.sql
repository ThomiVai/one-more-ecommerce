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
