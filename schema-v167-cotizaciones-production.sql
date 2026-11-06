-- SOLO STAGING. Cotizaciones internas: sin ventas, reservas o consumos de cupo.
INSERT INTO management_assertions(id,ok) VALUES('v167-staging',CASE WHEN
 EXISTS(SELECT 1 FROM deployment_identity WHERE id=1 AND database_id='00000000-0000-0000-0000-000000000000' AND project='one-more-suplementos')
 AND EXISTS(SELECT 1 FROM partner_quota_schema WHERE id=1 AND version=166)
 AND EXISTS(SELECT 1 FROM partner_programs WHERE id='partners' AND benefits_enabled=0) THEN 1 ELSE 0 END);
CREATE TABLE IF NOT EXISTS partner_quote_drafts (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
 partner_id TEXT NOT NULL REFERENCES partners(id),period_id TEXT NOT NULL REFERENCES partner_quota_periods(id),
 period_revision INTEGER NOT NULL CHECK(period_revision>=0),catalog_revision INTEGER NOT NULL CHECK(catalog_revision>=0),
 mode TEXT NOT NULL DEFAULT 'simulation' CHECK(mode='simulation'),status TEXT NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 4),real_cost_cents INTEGER NOT NULL CHECK(real_cost_cents>0),
 subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents>0),shipping_cents INTEGER NOT NULL CHECK(shipping_cents>=0),
 total_cents INTEGER NOT NULL CHECK(total_cents=subtotal_cents+shipping_cents),
 delivery_zone TEXT NOT NULL CHECK(delivery_zone IN ('hurlingham','outside')),
 items_json TEXT NOT NULL CHECK(json_valid(items_json)),notes TEXT NOT NULL,
 operation_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK(delivery_zone<>'hurlingham' OR shipping_cents=0)
);
CREATE INDEX IF NOT EXISTS partner_quotes_partner ON partner_quote_drafts(partner_id,seq);
CREATE TABLE IF NOT EXISTS partner_quote_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=167));
INSERT INTO partner_quote_schema VALUES(1,167) ON CONFLICT(id) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS partner_quotes_no_update BEFORE UPDATE ON partner_quote_drafts BEGIN SELECT RAISE(ABORT,'quote_draft_immutable'); END;
CREATE TRIGGER IF NOT EXISTS partner_quotes_no_delete BEFORE DELETE ON partner_quote_drafts BEGIN SELECT RAISE(ABORT,'preserve_quote_draft'); END;
DELETE FROM management_assertions WHERE id='v167-staging';
