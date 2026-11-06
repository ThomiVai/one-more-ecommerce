-- SOLO PREPRODUCCION. No registra clientes, compras, descuentos ni cupos.
INSERT INTO management_assertions(id,ok) VALUES('v169-staging',CASE WHEN
 EXISTS(SELECT 1 FROM deployment_identity WHERE id=1 AND database_id='00000000-0000-0000-0000-000000000000' AND project='one-more-suplementos')
 AND EXISTS(SELECT 1 FROM partner_inquiries_schema WHERE id=1 AND version=160)
 AND EXISTS(SELECT 1 FROM partner_programs WHERE id='partners' AND benefits_enabled=0) THEN 1 ELSE 0 END);
CREATE TABLE IF NOT EXISTS partner_link_visits (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 partner_id TEXT NOT NULL REFERENCES partners(id),
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS partner_visits_partner_date ON partner_link_visits(partner_id,created_at);
CREATE TABLE IF NOT EXISTS partner_traffic_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=169));
INSERT INTO partner_traffic_schema VALUES(1,169) ON CONFLICT(id) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS partner_visits_no_update BEFORE UPDATE ON partner_link_visits BEGIN SELECT RAISE(ABORT,'visit_immutable'); END;
DELETE FROM management_assertions WHERE id='v169-staging';
