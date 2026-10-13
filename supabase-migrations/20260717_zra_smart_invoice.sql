-- ZRA Smart Invoice foundation.
-- Credentials are only accessed by the authenticated server API. RLS is
-- intentionally enabled without client policies so browser clients cannot read
-- encrypted secrets or write invoice audit records directly.

CREATE TABLE IF NOT EXISTS public.zra_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  business_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  tpin TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'production')),
  smart_invoice_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT zra_settings_one_per_business UNIQUE (business_id)
);

CREATE TABLE IF NOT EXISTS public.zra_invoice_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  sale_id TEXT NOT NULL,
  business_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  request_json JSONB NOT NULL,
  response_json JSONB NOT NULL,
  status TEXT NOT NULL,
  invoice_number TEXT,
  verification_code TEXT,
  qr_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT zra_invoice_logs_one_per_sale UNIQUE (sale_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_zra_invoice_logs_business_created
  ON public.zra_invoice_logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zra_invoice_logs_sale
  ON public.zra_invoice_logs (sale_id);

CREATE OR REPLACE FUNCTION public.set_zra_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zra_settings_updated_at ON public.zra_settings;
CREATE TRIGGER trg_zra_settings_updated_at
BEFORE UPDATE ON public.zra_settings
FOR EACH ROW
EXECUTE FUNCTION public.set_zra_settings_updated_at();

ALTER TABLE public.zra_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zra_invoice_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.zra_settings.api_secret IS
  'AES-256-GCM encrypted envelope. Never return this value to browser clients.';
COMMENT ON TABLE public.zra_invoice_logs IS
  'Immutable request/response audit trail for ZRA invoice submissions.';
