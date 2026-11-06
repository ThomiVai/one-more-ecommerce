-- SOLO one-more-suplementos / YOUR_D1_DATABASE_NAME. Requiere Partners V141.
INSERT INTO management_assertions(id,ok) VALUES('v159-staging',CASE WHEN EXISTS(SELECT 1 FROM deployment_identity WHERE id=1 AND database_id='00000000-0000-0000-0000-000000000000' AND project='one-more-suplementos') AND EXISTS(SELECT 1 FROM partners_schema WHERE id=1 AND version=141) THEN 1 ELSE 0 END);
CREATE TABLE IF NOT EXISTS partner_outreach_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=159));
INSERT INTO partner_outreach_schema VALUES(1,159) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS partner_prospects(
 id TEXT PRIMARY KEY, instagram TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
 specialty TEXT NOT NULL DEFAULT '',town TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',
 stage TEXT NOT NULL DEFAULT 'new' CHECK(stage IN ('new','contacted','replied','negotiating','ready','converted','declined','do_not_contact')),
 owner_id TEXT NOT NULL REFERENCES team_users(id),follow_up_on TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',
 partner_id TEXT REFERENCES partners(id),revision INTEGER NOT NULL DEFAULT 0,
 created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK((stage='converted' AND partner_id IS NOT NULL) OR (stage<>'converted' AND partner_id IS NULL))
);
CREATE INDEX IF NOT EXISTS partner_prospects_followup ON partner_prospects(stage,follow_up_on,owner_id);
CREATE TABLE IF NOT EXISTS partner_outreach_operations(operation_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,actor TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS partner_prospect_events(
 id TEXT PRIMARY KEY,prospect_id TEXT NOT NULL REFERENCES partner_prospects(id),action TEXT NOT NULL,
 actor TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,note TEXT NOT NULL,
 operation_key TEXT NOT NULL UNIQUE REFERENCES partner_outreach_operations(operation_key),created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS partner_prospect_events_history ON partner_prospect_events(prospect_id,created_at,id);
CREATE TRIGGER IF NOT EXISTS prospect_identity_immutable BEFORE UPDATE OF instagram ON partner_prospects BEGIN SELECT RAISE(ABORT,'prospect_identity_immutable');END;
CREATE TRIGGER IF NOT EXISTS prospects_no_delete BEFORE DELETE ON partner_prospects BEGIN SELECT RAISE(ABORT,'prospect_history_preserved');END;
CREATE TRIGGER IF NOT EXISTS prospect_events_no_update BEFORE UPDATE ON partner_prospect_events BEGIN SELECT RAISE(ABORT,'prospect_audit_immutable');END;
CREATE TRIGGER IF NOT EXISTS prospect_events_no_delete BEFORE DELETE ON partner_prospect_events BEGIN SELECT RAISE(ABORT,'prospect_audit_immutable');END;
CREATE TRIGGER IF NOT EXISTS outreach_operations_no_update BEFORE UPDATE ON partner_outreach_operations BEGIN SELECT RAISE(ABORT,'prospect_operation_immutable');END;
CREATE TRIGGER IF NOT EXISTS outreach_operations_no_delete BEFORE DELETE ON partner_outreach_operations BEGIN SELECT RAISE(ABORT,'prospect_operation_immutable');END;
DELETE FROM management_assertions WHERE id='v159-staging';
