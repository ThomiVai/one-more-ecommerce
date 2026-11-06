-- V115 Compra por PDF, no modifica tablas previas.
CREATE TABLE IF NOT EXISTS purchase_documents (
 id TEXT PRIMARY KEY,
 supplier TEXT NOT NULL,
 document_number TEXT NOT NULL,
 document_date TEXT NOT NULL,
 document_total_cents INTEGER NOT NULL,
 line_count INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(supplier,document_number)
);
CREATE TABLE IF NOT EXISTS purchase_lines (
 id TEXT PRIMARY KEY,
 purchase_id TEXT NOT NULL REFERENCES purchase_documents(id),
 product_id TEXT NOT NULL,
 supplier_code TEXT NOT NULL,
 description TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents>=0),
 line_total_cents INTEGER NOT NULL CHECK(line_total_cents>=0)
);
CREATE INDEX IF NOT EXISTS purchase_lines_purchase ON purchase_lines(purchase_id);
