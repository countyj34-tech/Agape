import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { dexieDb, recordCustomerPayment } from '@/lib/db';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import type { CustomerLedgerEntry, Sale } from '@/types/pos';
import { ArrowLeft, DollarSign, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

export default function CustomerDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { settings } = useSupabaseAuth();
  const currencySymbol = settings?.currencySymbol || 'K';

  const customer = useLiveQuery(async () => {
    if (!id) return null;
    return (await dexieDb.customers.get(id)) ?? null;
  }, [id]);

  const sales = useLiveQuery(async () => {
    if (!id) return [];
    const all = await dexieDb.sales.where('customerId').equals(id).toArray();
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [id]);

  const ledger = useLiveQuery(async () => {
    if (!id) return [];
    const all = await dexieDb.customerLedger.where('customerId').equals(id).toArray();
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [id]);

  const metrics = useMemo(() => {
    const allSales = (sales ?? []) as Sale[];
    const allLedger = (ledger ?? []) as CustomerLedgerEntry[];

    const totalDebt = allSales.reduce((sum, s) => sum + (s.balanceDue ?? 0), 0);
    const totalPayments = allLedger.filter((l) => l.kind === 'payment').reduce((sum, l) => sum + (l.amount ?? 0), 0);
    const balance = Math.max(0, totalDebt - totalPayments);

    const outstandingSales = allSales.filter((s) => (s.balanceDue ?? 0) > 0);

    return { totalDebt, totalPayments, balance, outstandingSales };
  }, [ledger, sales]);

  const [open, setOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'mobile'>('cash');
  const [mobileProvider, setMobileProvider] = useState<'mtn' | 'airtel' | 'zamtel' | 'other'>('mtn');
  const [mobileReference, setMobileReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handlePaymentDialogOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      const amt = metrics.balance > 0 ? metrics.balance : 0;
      setPayAmount(amt > 0 ? amt.toFixed(2) : '');
      setMethod('cash');
      setMobileProvider('mtn');
      setMobileReference('');
      setNote('');
    }
  };

  const submitPayment = async () => {
    if (!id) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (method === 'mobile' && mobileReference.trim().length === 0) {
      toast.error('Enter the Mobile Money reference/transaction ID');
      return;
    }

    setSaving(true);
    try {
      await recordCustomerPayment({
        customerId: id,
        amount,
        method,
        mobileProvider: method === 'mobile' ? mobileProvider : undefined,
        mobileReference: method === 'mobile' ? mobileReference.trim() : undefined,
        note: note.trim() || undefined,
      });
      toast.success('Payment recorded');
      setPayAmount('');
      setMobileReference('');
      setNote('');
      setOpen(false);
    } catch (e) {
      toast.error((e as Error)?.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  if (!id) {
    return (
      <AppShell title="Customer">
        <div className="p-4">
          <p className="text-sm text-muted-foreground">Customer not found.</p>
        </div>
      </AppShell>
    );
  }

  if (customer === undefined) {
    return (
      <AppShell title="Customer">
        <div className="p-4">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </AppShell>
    );
  }

  if (!customer) {
    return (
      <AppShell title="Customer">
        <div className="space-y-4 p-4">
          <Button variant="outline" onClick={() => navigate('/customers')} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <p className="text-sm text-muted-foreground">Customer not found.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Customer">
      <div className="space-y-4 p-4">
        <Button variant="outline" onClick={() => navigate('/customers')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>{customer.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {customer.phone && <p className="text-sm text-muted-foreground">{customer.phone}</p>}

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total debt</span>
                <span className="font-semibold">
                  {currencySymbol}
                  {metrics.totalDebt.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Payments</span>
                <span className="font-semibold text-success">
                  {currencySymbol}
                  {metrics.totalPayments.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Balance</span>
                <span className={metrics.balance > 0 ? 'font-semibold text-destructive' : 'font-semibold'}>
                  {currencySymbol}
                  {metrics.balance.toFixed(2)}
                </span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Use the button below to record any money the customer has paid towards their Pay Later balance.
            </p>

            <Dialog open={open} onOpenChange={handlePaymentDialogOpenChange}>
              <DialogTrigger asChild>
                <Button className="w-full gap-2" disabled={saving}>
                  <DollarSign className="h-4 w-4" />
                  Record Payment
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record payment</DialogTitle>
                  <DialogDescription>Use this when the customer pays back a Pay Later balance.</DialogDescription>
                </DialogHeader>

                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="payAmount">Amount</Label>
                    <Input
                      id="payAmount"
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.01"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Method</Label>
                    <Select value={method} onValueChange={(v) => setMethod(v as any)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="mobile">Mobile Money</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {method === 'mobile' && (
                    <>
                      <div className="grid gap-2">
                        <Label>Provider</Label>
                        <Select value={mobileProvider} onValueChange={(v) => setMobileProvider(v as any)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select provider" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mtn">MTN MoMo</SelectItem>
                            <SelectItem value="airtel">Airtel Money</SelectItem>
                            <SelectItem value="zamtel">Zamtel</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="mRef">Reference</Label>
                        <Input
                          id="mRef"
                          value={mobileReference}
                          onChange={(e) => setMobileReference(e.target.value)}
                          placeholder="Transaction ID"
                          autoComplete="off"
                        />
                      </div>
                    </>
                  )}

                  <div className="grid gap-2">
                    <Label htmlFor="note">Note (optional)</Label>
                    <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid half" />
                  </div>
                </div>

                <DialogFooter>
                  <Button onClick={submitPayment} disabled={saving} className="gap-2">
                    {method === 'mobile' ? <Smartphone className="h-4 w-4" /> : <DollarSign className="h-4 w-4" />}
                    {saving ? 'Saving…' : 'Save payment'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outstanding sales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {metrics.outstandingSales.length === 0 ? (
              <p className="text-sm text-muted-foreground">No outstanding balances.</p>
            ) : (
              metrics.outstandingSales.map((s) => (
                <button
                  key={s.id}
                  className="w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50"
                  onClick={() => navigate(`/receipt/${s.id}`, { state: { sale: s } })}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.receiptNumber || s.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(s.createdAt).toLocaleString()} · {String(s.paymentMethod).toUpperCase()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-destructive">
                        {currencySymbol}
                        {(s.balanceDue ?? 0).toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">Due</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ledger</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(ledger ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No ledger entries yet.</p>
            ) : (
              (ledger ?? []).map((l) => (
                <div key={l.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {l.kind === 'debt' ? 'Debt' : 'Payment'}
                        {l.kind === 'payment' && l.method ? ` (${String(l.method).toUpperCase()})` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(l.createdAt).toLocaleString()}
                        {l.note ? ` · ${l.note}` : ''}
                      </p>
                      {l.method === 'mobile' && (l.mobileProvider || l.mobileReference) && (
                        <p className="text-xs text-muted-foreground">
                          {l.mobileProvider ? l.mobileProvider.toUpperCase() : 'MOBILE'}
                          {l.mobileReference ? ` · ${l.mobileReference}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className={l.kind === 'payment' ? 'text-sm font-semibold text-success' : 'text-sm font-semibold text-destructive'}>
                        {currencySymbol}
                        {(l.amount ?? 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}

            <Separator />
            <Button variant="outline" className="w-full" onClick={() => navigate('/reports')}>
              Open Reports (EOD)
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
