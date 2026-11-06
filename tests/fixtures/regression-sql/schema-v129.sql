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
