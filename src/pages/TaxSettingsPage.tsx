import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { AppShell } from '@/components/layout/AppShell';
import { saveSettings } from '@/lib/db';
import { getDefaultSalesTaxRate, type SalesTaxMode } from '@/lib/taxEngine';

export default function TaxSettingsPage() {
  const navigate = useNavigate();
  const { settings, refreshSettings } = useSupabaseAuth();

  const [mode, setMode] = useState<SalesTaxMode>(() => {
    const m = (settings?.salesTaxMode ?? 'none') as SalesTaxMode;
    return m === 'tot' || m === 'vat' || m === 'none' ? m : 'none';
  });

  const [rate, setRate] = useState<string>(() => {
    const r = Number(settings?.salesTaxRate);
    if (Number.isFinite(r) && r >= 0) return String(r);
    return String(getDefaultSalesTaxRate((settings?.salesTaxMode ?? 'none') as SalesTaxMode));
  });

  const effectiveRate = useMemo(() => {
    if (mode === 'none') return 0;
    if (mode === 'tot') return 5;
    const parsed = Number(rate);
    if (!Number.isFinite(parsed) || parsed < 0) return 16;
    return Math.min(100, parsed);
  }, [mode, rate]);

  const handleSave = async () => {
    if (!settings) {
      toast.error('Settings not loaded');
      return;
    }

    const nextMode: SalesTaxMode = mode;
    const nextRate = nextMode === 'none' ? 0 : effectiveRate;

    try {
      await saveSettings({
        ...settings,
        salesTaxMode: nextMode,
        salesTaxRate: nextRate,
        updatedAt: new Date(),
      });
      await refreshSettings();
      toast.success('Tax settings saved');
    } catch (e) {
      console.error(e);
      toast.error('Failed to save tax settings');
    }
  };

  return (
    <AppShell title="Tax Settings">
      <div className="space-y-6 p-4">
        <Card>
          <CardHeader>
            <CardTitle>ZRA Tax Mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tax type</Label>
              <Select
                value={mode}
                onValueChange={(v) => {
                  const next = (v as SalesTaxMode) ?? 'none';
                  setMode(next);
                  if (next === 'none') setRate('0');
                  if (next === 'tot') setRate('5');
                  if (next === 'vat') setRate('16');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Tax</SelectItem>
                  <SelectItem value="tot">Turnover Tax (5%)</SelectItem>
                  <SelectItem value="vat">VAT (16%)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Turnover Tax is common under K5,000,000 yearly turnover; VAT is common for larger businesses.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Rate (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={mode === 'tot' ? '5' : mode === 'none' ? '0' : rate}
                disabled={mode === 'tot' || mode === 'none'}
                onChange={(e) => setRate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                VAT can be adjusted if needed. Turnover Tax is fixed at 5%.
              </p>
            </div>

            <div className="rounded-md border p-3 text-xs text-muted-foreground">
              This tax is applied on top of (Subtotal − Discount) and shown clearly as “Tax Amount” on receipts.
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/admin')}>
                Back
              </Button>
              <Button onClick={handleSave}>Save</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
