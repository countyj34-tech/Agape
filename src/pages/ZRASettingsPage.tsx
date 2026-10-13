import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import {
  createZRASettings,
  getZRASettings,
  updateZRASettings,
  type ZRAEnvironment,
  type ZRASettingsInput,
} from '@/lib/zraApi';
import { toast } from 'sonner';

type FormState = Omit<ZRASettingsInput, 'business_id'>;

const emptyForm: FormState = {
  business_name: '',
  tpin: '',
  branch_id: '',
  device_id: '',
  api_key: '',
  api_secret: '',
  environment: 'sandbox',
  smart_invoice_enabled: false,
};

export default function ZRASettingsPage() {
  const navigate = useNavigate();
  const { settings, company } = useSupabaseAuth();
  const businessId = settings?.companyId || company?.id || '';
  const [form, setForm] = useState<FormState>({
    ...emptyForm,
    business_name: company?.name || settings?.shopName || '',
  });
  const [exists, setExists] = useState(false);
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!businessId) {
      setLoading(false);
      return;
    }

    void (async () => {
      setLoading(true);
      try {
        const record = await getZRASettings(businessId);
        if (cancelled) return;
        if (record) {
          setExists(true);
          setHasStoredSecret(record.has_api_secret);
          setForm({
            business_name: record.business_name,
            tpin: record.tpin,
            branch_id: record.branch_id,
            device_id: record.device_id,
            api_key: record.api_key,
            api_secret: '',
            environment: record.environment,
            smart_invoice_enabled: record.smart_invoice_enabled,
          });
        }
      } catch (error) {
        if (!cancelled) toast.error((error as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!businessId) {
      toast.error('No company is selected');
      return;
    }
    if (
      !form.business_name.trim() ||
      !form.tpin.trim() ||
      !form.branch_id.trim() ||
      !form.device_id.trim() ||
      !form.api_key.trim()
    ) {
      toast.error('Complete all required fields');
      return;
    }
    if (!exists && !form.api_secret?.trim()) {
      toast.error('API Secret is required when creating ZRA settings');
      return;
    }

    setSaving(true);
    try {
      const input: ZRASettingsInput = {
        ...form,
        business_id: businessId,
        business_name: form.business_name.trim(),
        tpin: form.tpin.trim(),
        branch_id: form.branch_id.trim(),
        device_id: form.device_id.trim(),
        api_key: form.api_key.trim(),
        api_secret: form.api_secret?.trim() || undefined,
      };
      const saved = exists
        ? await updateZRASettings(businessId, input)
        : await createZRASettings(input);
      setExists(true);
      setHasStoredSecret(saved.has_api_secret);
      setField('api_secret', '');
      toast.success('ZRA Smart Invoice settings saved');
    } catch (error) {
      toast.error((error as Error).message || 'Failed to save ZRA settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="ZRA Smart Invoice">
      <div className="mx-auto max-w-2xl space-y-6 p-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <CardTitle>ZRA Smart Invoice</CardTitle>
                <CardDescription>
                  Company-specific credentials are encrypted and stored securely.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="zra-business-name">Business Name</Label>
                    <Input
                      id="zra-business-name"
                      value={form.business_name}
                      maxLength={200}
                      onChange={(e) => setField('business_name', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="zra-tpin">TPIN</Label>
                    <Input
                      id="zra-tpin"
                      value={form.tpin}
                      maxLength={32}
                      inputMode="numeric"
                      onChange={(e) => setField('tpin', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="zra-branch">Branch ID</Label>
                    <Input
                      id="zra-branch"
                      value={form.branch_id}
                      maxLength={100}
                      onChange={(e) => setField('branch_id', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="zra-device">Device ID</Label>
                    <Input
                      id="zra-device"
                      value={form.device_id}
                      maxLength={100}
                      onChange={(e) => setField('device_id', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="zra-api-key">API Key</Label>
                    <Input
                      id="zra-api-key"
                      value={form.api_key}
                      maxLength={512}
                      autoComplete="off"
                      onChange={(e) => setField('api_key', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="zra-api-secret">API Secret</Label>
                    <Input
                      id="zra-api-secret"
                      type="password"
                      value={form.api_secret || ''}
                      maxLength={2048}
                      autoComplete="new-password"
                      placeholder={
                        hasStoredSecret
                          ? 'Secret saved — leave blank to keep it'
                          : 'Enter API Secret'
                      }
                      onChange={(e) => setField('api_secret', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      The saved secret is never returned to this browser.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Environment</Label>
                  <RadioGroup
                    value={form.environment}
                    onValueChange={(value) =>
                      setField('environment', value as ZRAEnvironment)
                    }
                    className="flex flex-wrap gap-6"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="sandbox" id="zra-sandbox" />
                      <Label htmlFor="zra-sandbox">Sandbox</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="production" id="zra-production" />
                      <Label htmlFor="zra-production">Production</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <Label htmlFor="zra-enabled">Enable Smart Invoice</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Completed sales will be prepared and logged for ZRA submission.
                    </p>
                  </div>
                  <Switch
                    id="zra-enabled"
                    checked={form.smart_invoice_enabled}
                    onCheckedChange={(checked) =>
                      setField('smart_invoice_enabled', checked)
                    }
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    disabled={saving}
                    onClick={() => navigate('/admin/settings')}
                  >
                    Cancel
                  </Button>
                  <Button disabled={saving || !businessId} onClick={handleSave}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
