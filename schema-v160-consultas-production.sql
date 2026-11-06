-- SOLO preproducción. Requiere V141, V142 y V159. Sin escrituras contables.
INSERT INTO management_assertions(id,ok) VALUES('v160-staging',CASE WHEN
 EXISTS(SELECT 1 FROM deployment_identity WHERE id=1 AND database_id='00000000-0000-0000-0000-000000000000' AND project='one-more-suplementos')
 AND EXISTS(SELECT 1 FROM partner_referrals_schema WHERE id=1 AND version=142)
 AND EXISTS(SELECT 1 FROM partner_outreach_schema WHERE id=1 AND version=159)
 AND EXISTS(SELECT 1 FROM partner_programs WHERE id='partners' AND benefits_enabled=0)
 THEN 1 ELSE 0 END);
CREATE TABLE IF NOT EXISTS partner_inquiries (
 id TEXT PRIMARY KEY, operation_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 declared_code TEXT NOT NULL, partner_id TEXT REFERENCES partners(id),
 buyer_confirmed INTEGER NOT NULL CHECK(buyer_confirmed IN (0,1)),
 summary TEXT NOT NULL CHECK(length(summary) BETWEEN 25 AND 10000),
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','received','rejected','linked')),
 sale_id TEXT UNIQUE REFERENCES sales(id), revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 CHECK((declared_code='' AND partner_id IS NULL AND buyer_confirmed=0) OR (declared_code<>'' AND partner_id IS NOT NULL)),
 CHECK((status='linked' AND sale_id IS NOT NULL) OR (status<>'linked' AND sale_id IS NULL))
);
CREATE INDEX IF NOT EXISTS partner_inquiries_status ON partner_inquiries(status,id);
CREATE TABLE IF NOT EXISTS partner_inquiry_reviews (
 id TEXT PRIMARY KEY, inquiry_id TEXT NOT NULL REFERENCES partner_inquiries(id),
 revision INTEGER NOT NULL CHECK(revision>0), actor TEXT NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL,
 reason TEXT NOT NULL, buyer_evidence TEXT NOT NULL, identity_evidence TEXT NOT NULL,
 operation_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(inquiry_id,revision)
);
CREATE TABLE IF NOT EXISTS partner_inquiries_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=160));
INSERT INTO partner_inquiries_schema VALUES(1,160) ON CONFLICT(id) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS inquiries_original_immutable BEFORE UPDATE OF id,operation_key,request_hash,declared_code,partner_id,buyer_confirmed,summary,created_at ON partner_inquiries BEGIN SELECT RAISE(ABORT,'inquiry_original_immutable'); END;
CREATE TRIGGER IF NOT EXISTS inquiries_revision BEFORE UPDATE ON partner_inquiries WHEN NEW.revision<>OLD.revision+1 BEGIN SELECT RAISE(ABORT,'inquiry_revision_conflict'); END;
CREATE TRIGGER IF NOT EXISTS inquiries_no_delete BEFORE DELETE ON partner_inquiries BEGIN SELECT RAISE(ABORT,'preserve_inquiry_history'); END;
CREATE TRIGGER IF NOT EXISTS inquiry_reviews_no_update BEFORE UPDATE ON partner_inquiry_reviews BEGIN SELECT RAISE(ABORT,'inquiry_review_immutable'); END;
CREATE TRIGGER IF NOT EXISTS inquiry_reviews_no_delete BEFORE DELETE ON partner_inquiry_reviews BEGIN SELECT RAISE(ABORT,'preserve_inquiry_history'); END;
DELETE FROM management_assertions WHERE id='v160-staging';
