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
