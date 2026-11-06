-- SOLO STAGING. Registro interno de pruebas; no habilita descuentos ni modifica contabilidad.
INSERT INTO management_assertions(id,ok) VALUES('v166-staging',CASE WHEN
 EXISTS(SELECT 1 FROM deployment_identity WHERE id=1 AND database_id='00000000-0000-0000-0000-000000000000' AND project='one-more-suplementos')
 AND EXISTS(SELECT 1 FROM partner_inquiries_schema WHERE id=1 AND version=160)
 AND EXISTS(SELECT 1 FROM partner_programs WHERE id='partners' AND benefits_enabled=0)
 THEN 1 ELSE 0 END);
CREATE TABLE IF NOT EXISTS partner_quota_periods (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 partner_id TEXT NOT NULL REFERENCES partners(id), agreement_id TEXT NOT NULL REFERENCES partner_agreements(id),
 previous_id TEXT UNIQUE REFERENCES partner_quota_periods(id),
 kind TEXT NOT NULL CHECK(kind IN ('welcome','renewal','reactivation')),
 start_on TEXT NOT NULL, expires_on TEXT NOT NULL,
 max_units INTEGER NOT NULL DEFAULT 4 CHECK(max_units=4),
 mode TEXT NOT NULL DEFAULT 'simulation' CHECK(mode='simulation'),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), actor TEXT NOT NULL,
 reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 CHECK(date(start_on) IS NOT NULL AND start_on=date(start_on) AND expires_on=date(start_on,'+30 days')),
 CHECK((kind='welcome' AND previous_id IS NULL) OR (kind<>'welcome' AND previous_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS partner_quota_partner ON partner_quota_periods(partner_id,seq);
CREATE TABLE IF NOT EXISTS partner_quota_movements (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 period_id TEXT NOT NULL REFERENCES partner_quota_periods(id),
 kind TEXT NOT NULL CHECK(kind IN ('use','reversal')),
 sale_id TEXT REFERENCES sales(id), reverses_id TEXT REFERENCES partner_quota_movements(id),
 units INTEGER NOT NULL CHECK((kind='use' AND units BETWEEN 1 AND 4 AND sale_id IS NOT NULL AND reverses_id IS NULL) OR (kind='reversal' AND units BETWEEN -4 AND -1 AND sale_id IS NULL AND reverses_id IS NOT NULL)),
 reason TEXT NOT NULL, identity_evidence TEXT NOT NULL, actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partner_quota_reviews (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 period_id TEXT NOT NULL UNIQUE REFERENCES partner_quota_periods(id),
 decision TEXT NOT NULL CHECK(decision IN ('continue','pause','finish')),
 notes TEXT NOT NULL, used_units_at_review INTEGER NOT NULL CHECK(used_units_at_review BETWEEN 0 AND 4), actor TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partner_quota_operations (
 operation_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, actor TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partner_quota_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=166));
INSERT INTO partner_quota_schema VALUES(1,166) ON CONFLICT(id) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS quota_period_immutable BEFORE UPDATE OF seq,id,partner_id,agreement_id,previous_id,kind,start_on,expires_on,max_units,mode,actor,reason,created_at ON partner_quota_periods BEGIN SELECT RAISE(ABORT,'quota_period_immutable'); END;
CREATE TRIGGER IF NOT EXISTS quota_revision BEFORE UPDATE ON partner_quota_periods WHEN NEW.revision<>OLD.revision+1 BEGIN SELECT RAISE(ABORT,'quota_revision_conflict'); END;
CREATE TRIGGER IF NOT EXISTS quota_period_no_delete BEFORE DELETE ON partner_quota_periods BEGIN SELECT RAISE(ABORT,'preserve_quota_period'); END;
CREATE TRIGGER IF NOT EXISTS quota_movements_no_update BEFORE UPDATE ON partner_quota_movements BEGIN SELECT RAISE(ABORT,'quota_movement_immutable'); END;
CREATE TRIGGER IF NOT EXISTS quota_movements_no_delete BEFORE DELETE ON partner_quota_movements BEGIN SELECT RAISE(ABORT,'preserve_quota_movement'); END;
CREATE TRIGGER IF NOT EXISTS quota_reviews_no_update BEFORE UPDATE ON partner_quota_reviews BEGIN SELECT RAISE(ABORT,'quota_review_immutable'); END;
CREATE TRIGGER IF NOT EXISTS quota_reviews_no_delete BEFORE DELETE ON partner_quota_reviews BEGIN SELECT RAISE(ABORT,'preserve_quota_review'); END;
CREATE TRIGGER IF NOT EXISTS quota_operations_no_update BEFORE UPDATE ON partner_quota_operations BEGIN SELECT RAISE(ABORT,'quota_operation_immutable'); END;
CREATE TRIGGER IF NOT EXISTS quota_operations_no_delete BEFORE DELETE ON partner_quota_operations BEGIN SELECT RAISE(ABORT,'preserve_quota_operation'); END;
DELETE FROM management_assertions WHERE id='v166-staging';

CREATE TRIGGER IF NOT EXISTS quota_sale_once BEFORE INSERT ON partner_quota_movements WHEN NEW.kind='use' AND EXISTS(SELECT 1 FROM partner_quota_movements m WHERE m.kind='use' AND m.sale_id=NEW.sale_id AND m.units+COALESCE((SELECT SUM(x.units) FROM partner_quota_movements x WHERE x.reverses_id=m.id),0)>0) BEGIN SELECT RAISE(ABORT,'quota_sale_conflict'); END;

CREATE INDEX IF NOT EXISTS quota_movements_period ON partner_quota_movements(period_id,seq);
CREATE INDEX IF NOT EXISTS quota_movements_reversals ON partner_quota_movements(reverses_id);
CREATE INDEX IF NOT EXISTS quota_movements_sale ON partner_quota_movements(sale_id);
