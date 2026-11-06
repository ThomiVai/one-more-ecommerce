-- SOLO one-more-suplementos / YOUR_D1_DATABASE_NAME. Requiere V141 instalada.
-- Aditiva: no escribe en ventas, stock, costos históricos, caja ni usuarios.
INSERT INTO management_assertions(id,ok) VALUES('v142-staging',CASE WHEN
 EXISTS(SELECT 1 FROM deployment_identity WHERE id=1 AND database_id='00000000-0000-0000-0000-000000000000' AND project='one-more-suplementos')
 AND EXISTS(SELECT 1 FROM partners_schema WHERE id=1 AND version=141)
 AND EXISTS(SELECT 1 FROM partner_programs WHERE id='partners' AND benefits_enabled=0)
 THEN 1 ELSE 0 END);
CREATE TABLE IF NOT EXISTS partner_referral_events (
 id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id),
 revision INTEGER NOT NULL CHECK(revision>=0), previous_id TEXT REFERENCES partner_referral_events(id),
 customer_id TEXT NOT NULL REFERENCES customers(id), partner_id TEXT REFERENCES partners(id),
 customer_kind TEXT NOT NULL CHECK(customer_kind IN ('unknown','new','recurrent')),
 identity_verified INTEGER NOT NULL CHECK(identity_verified IN (0,1)),
 identity_evidence TEXT NOT NULL, attribution_evidence TEXT NOT NULL,
 delivered INTEGER NOT NULL CHECK(delivered IN (0,1)), delivered_at TEXT NOT NULL,
 delivery_evidence TEXT NOT NULL,
 variable_costs_complete INTEGER NOT NULL CHECK(variable_costs_complete IN (0,1)),
 variable_costs_cents INTEGER NOT NULL CHECK(variable_costs_cents BETWEEN 0 AND 10000000000000),
 costs_evidence TEXT NOT NULL, sale_revision INTEGER NOT NULL,
 reason TEXT NOT NULL, actor TEXT NOT NULL, operation_key TEXT NOT NULL UNIQUE REFERENCES partner_operations(operation_key),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(sale_id,revision),
 CHECK((revision=0 AND previous_id IS NULL) OR (revision>0 AND previous_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS partner_referral_heads (
 sale_id TEXT PRIMARY KEY REFERENCES sales(id), event_id TEXT NOT NULL UNIQUE REFERENCES partner_referral_events(id),
 revision INTEGER NOT NULL CHECK(revision>=0)
);
CREATE INDEX IF NOT EXISTS partner_referral_customer ON partner_referral_events(customer_id,sale_id);
CREATE INDEX IF NOT EXISTS partner_referral_partner ON partner_referral_events(partner_id,sale_id);
CREATE TABLE IF NOT EXISTS partner_referrals_schema (id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=142));
INSERT INTO partner_referrals_schema(id,version) VALUES(1,142) ON CONFLICT(id) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS partner_referral_chain BEFORE INSERT ON partner_referral_events WHEN NEW.revision>0 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM partner_referral_heads h WHERE h.sale_id=NEW.sale_id AND h.event_id=NEW.previous_id AND h.revision=NEW.revision-1) THEN RAISE(ABORT,'referral_revision_conflict') END;
END;
CREATE TRIGGER IF NOT EXISTS partner_referral_head_insert BEFORE INSERT ON partner_referral_heads BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM partner_referral_events e WHERE e.id=NEW.event_id AND e.sale_id=NEW.sale_id AND e.revision=NEW.revision) THEN RAISE(ABORT,'referral_head_conflict') END;
END;
CREATE TRIGGER IF NOT EXISTS partner_referral_head_update BEFORE UPDATE ON partner_referral_heads BEGIN
 SELECT CASE WHEN NEW.sale_id<>OLD.sale_id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM partner_referral_events e WHERE e.id=NEW.event_id AND e.sale_id=NEW.sale_id AND e.revision=NEW.revision AND e.previous_id=OLD.event_id) THEN RAISE(ABORT,'referral_head_conflict') END;
END;
CREATE TRIGGER IF NOT EXISTS partner_referral_events_no_update BEFORE UPDATE ON partner_referral_events BEGIN SELECT RAISE(ABORT,'referral_history_immutable'); END;
CREATE TRIGGER IF NOT EXISTS partner_referral_events_no_delete BEFORE DELETE ON partner_referral_events BEGIN SELECT RAISE(ABORT,'preserve_referral_history'); END;
CREATE TRIGGER IF NOT EXISTS partner_referral_heads_no_delete BEFORE DELETE ON partner_referral_heads BEGIN SELECT RAISE(ABORT,'preserve_referral_history'); END;
DELETE FROM management_assertions WHERE id='v142-staging';
