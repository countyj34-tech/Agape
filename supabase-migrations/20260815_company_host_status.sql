-- Super-admin host kill switch (pause / suspend / remove tenant)

ALTER TABLE companies ADD COLUMN IF NOT EXISTS host_status TEXT DEFAULT 'active';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS host_status_reason TEXT;

COMMENT ON COLUMN companies.host_status IS 'active | paused | suspended | removed';
COMMENT ON COLUMN companies.host_status_reason IS 'Optional short message shown to customers';
