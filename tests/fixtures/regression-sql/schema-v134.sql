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
