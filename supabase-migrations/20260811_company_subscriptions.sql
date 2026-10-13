-- Monthly subscription / SaaS billing fields on companies

ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'business';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS monthly_price_usd NUMERIC;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_payment_ref TEXT;

COMMENT ON COLUMN companies.subscription_expires_at IS 'When paid monthly access ends; null = not enforced or lifetime';
COMMENT ON COLUMN companies.subscription_status IS 'active | past_due | cancelled | trial';
