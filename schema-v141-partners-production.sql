-- EXCLUSIVAMENTE one-more-suplementos / YOUR_D1_DATABASE_NAME.
-- Aditiva. No modifica stock, ventas, compras, caja, precios ni usuarios.
CREATE TABLE IF NOT EXISTS deployment_identity (
 id INTEGER PRIMARY KEY CHECK(id=1),
 database_id TEXT NOT NULL CHECK(database_id='00000000-0000-0000-0000-000000000000'),
 project TEXT NOT NULL CHECK(project='one-more-suplementos')
);
INSERT INTO deployment_identity(id,database_id,project) VALUES(1,'00000000-0000-0000-0000-000000000000','one-more-suplementos') ON CONFLICT(id) DO NOTHING;
INSERT INTO management_assertions(id,ok) VALUES('v141-staging-identity',CASE WHEN (SELECT COUNT(*) FROM deployment_identity)=1 AND EXISTS(SELECT 1 FROM deployment_identity WHERE id=1 AND database_id='00000000-0000-0000-0000-000000000000' AND project='one-more-suplementos') THEN 1 ELSE 0 END);
CREATE TABLE IF NOT EXISTS customers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 revision INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customer_contacts (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
 kind TEXT NOT NULL CHECK(kind IN ('phone','email')), value TEXT NOT NULL, normalized TEXT NOT NULL,
 verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)), created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(kind,normalized)
);
CREATE INDEX IF NOT EXISTS customer_contacts_customer ON customer_contacts(customer_id);
CREATE TABLE IF NOT EXISTS partner_programs (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, benefits_enabled INTEGER NOT NULL DEFAULT 0 CHECK(benefits_enabled=0)
);
CREATE TABLE IF NOT EXISTS partner_program_versions (
 id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES partner_programs(id),
 version INTEGER NOT NULL, terms TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(program_id,version)
);
INSERT INTO partner_programs(id,name) VALUES('partners','ONE MORE PARTNERS') ON CONFLICT(id) DO NOTHING;
INSERT INTO partner_program_versions(id,program_id,version,terms) VALUES('partners-base-1','partners',1,'Base administrativa. Beneficios desactivados. Condiciones comerciales por acuerdo; no otorga recompensas.') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS partners (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
 program_id TEXT NOT NULL REFERENCES partner_programs(id), code TEXT NOT NULL COLLATE NOCASE UNIQUE,
 instagram TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','active','paused','closed')),
 revision INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(program_id,customer_id)
);
CREATE TABLE IF NOT EXISTS partner_agreements (
 id TEXT PRIMARY KEY, partner_id TEXT NOT NULL REFERENCES partners(id),
 version_id TEXT NOT NULL REFERENCES partner_program_versions(id),
 kind TEXT NOT NULL CHECK(kind IN ('pilot','prior_commitment')),
 terms TEXT NOT NULL, unresolved INTEGER NOT NULL DEFAULT 1 CHECK(unresolved IN (0,1)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed')),
 revision INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, confirmed_by TEXT, confirmed_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS partner_agreements_partner ON partner_agreements(partner_id,created_at);
CREATE TABLE IF NOT EXISTS partner_events (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL,
 before_json TEXT NOT NULL DEFAULT '{}', after_json TEXT NOT NULL DEFAULT '{}', operation_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS partner_events_entity ON partner_events(entity_id,created_at);
CREATE TABLE IF NOT EXISTS partner_operations (
 operation_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, actor TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partners_schema (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=141)
);
INSERT INTO partners_schema(id,version) VALUES(1,141) ON CONFLICT(id) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS partners_code_immutable BEFORE UPDATE OF code,customer_id,program_id ON partners BEGIN SELECT RAISE(ABORT,'partner_identity_immutable'); END;
CREATE TRIGGER IF NOT EXISTS partners_no_delete BEFORE DELETE ON partners BEGIN SELECT RAISE(ABORT,'preserve_partner_history'); END;
CREATE TRIGGER IF NOT EXISTS customers_no_delete BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT,'preserve_customer_history'); END;
CREATE TRIGGER IF NOT EXISTS agreements_no_delete BEFORE DELETE ON partner_agreements BEGIN SELECT RAISE(ABORT,'preserve_agreement_history'); END;
CREATE TRIGGER IF NOT EXISTS agreements_confirmed_immutable BEFORE UPDATE ON partner_agreements WHEN OLD.status='confirmed' BEGIN SELECT RAISE(ABORT,'confirmed_agreement_immutable'); END;
CREATE TRIGGER IF NOT EXISTS partner_versions_no_update BEFORE UPDATE ON partner_program_versions BEGIN SELECT RAISE(ABORT,'program_version_immutable'); END;
CREATE TRIGGER IF NOT EXISTS partner_versions_no_delete BEFORE DELETE ON partner_program_versions BEGIN SELECT RAISE(ABORT,'program_version_immutable'); END;
CREATE TRIGGER IF NOT EXISTS partner_events_no_update BEFORE UPDATE ON partner_events BEGIN SELECT RAISE(ABORT,'audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS partner_events_no_delete BEFORE DELETE ON partner_events BEGIN SELECT RAISE(ABORT,'audit_immutable'); END;
DELETE FROM management_assertions WHERE id='v141-staging-identity';
