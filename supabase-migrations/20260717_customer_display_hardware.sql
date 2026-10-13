-- Optional cloud mirror for customer pole-display preferences.
-- COM/USB port binding remains device-local in IndexedDB (Web Serial cannot
-- serialize ports). This table stores company defaults and enablement flags.

CREATE TABLE IF NOT EXISTS public.customer_display_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  business_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  connection_type TEXT NOT NULL DEFAULT 'usb_virtual_com'
    CHECK (connection_type IN ('serial', 'usb_virtual_com')),
  com_port TEXT DEFAULT '',
  baud_rate INTEGER NOT NULL DEFAULT 9600,
  data_bits INTEGER NOT NULL DEFAULT 8,
  parity TEXT NOT NULL DEFAULT 'none'
    CHECK (parity IN ('none', 'even', 'odd')),
  stop_bits INTEGER NOT NULL DEFAULT 1,
  encoding TEXT NOT NULL DEFAULT 'ascii'
    CHECK (encoding IN ('ascii', 'utf8')),
  auto_reconnect BOOLEAN NOT NULL DEFAULT true,
  brightness INTEGER NOT NULL DEFAULT 80,
  line_width INTEGER NOT NULL DEFAULT 20,
  last_connected TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_display_settings_one_per_business UNIQUE (business_id)
);

CREATE OR REPLACE FUNCTION public.set_customer_display_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_display_settings_updated_at ON public.customer_display_settings;
CREATE TRIGGER trg_customer_display_settings_updated_at
BEFORE UPDATE ON public.customer_display_settings
FOR EACH ROW
EXECUTE FUNCTION public.set_customer_display_settings_updated_at();

ALTER TABLE public.customer_display_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company admins manage customer display settings" ON public.customer_display_settings;
CREATE POLICY "Company admins manage customer display settings"
  ON public.customer_display_settings
  FOR ALL
  USING (
    business_id IN (
      SELECT company_id FROM memberships
      WHERE user_id = auth.uid()::TEXT
        AND is_active = true
        AND role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT company_id FROM memberships
      WHERE user_id = auth.uid()::TEXT
        AND is_active = true
        AND role IN ('owner', 'admin', 'manager')
    )
  );
