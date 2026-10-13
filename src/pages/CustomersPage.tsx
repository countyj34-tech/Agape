import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { dexieDb, addCustomer } from '@/lib/db';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import type { Customer, CustomerLedgerEntry, Sale } from '@/types/pos';
import { Plus, Search, User } from 'lucide-react';
import { toast } from 'sonner';

export default function CustomersPage() {
  const navigate = useNavigate();
  const { settings } = useSupabaseAuth();
  const currencySymbol = settings?.currencySymbol || 'K';

  const [query, setQuery] = useState('');

  const customers = useLiveQuery(() => dexieDb.customers.orderBy('nameKey').toArray(), []);
  const creditSales = useLiveQuery(
    () => dexieDb.sales.filter((s) => (s.balanceDue ?? 0) > 0 && !!s.customerId).toArray(),
    []
  );
  const payments = useLiveQuery(
    () => dexieDb.customerLedger.where('kind').equals('payment').toArray(),
    []
  );

  const balances = useMemo(() => {
    const debtByCustomer = new Map<string, number>();
    for (const s of (creditSales ?? []) as Sale[]) {
      const cid = s.customerId;
      if (!cid) continue;
      const prev = debtByCustomer.get(cid) ?? 0;
      debtByCustomer.set(cid, prev + (s.balanceDue ?? 0));
    }

    const paidByCustomer = new Map<string, number>();
    for (const p of (payments ?? []) as CustomerLedgerEntry[]) {
      const prev = paidByCustomer.get(p.customerId) ?? 0;
      paidByCustomer.set(p.customerId, prev + (p.amount ?? 0));
    }

    const out = new Map<string, number>();
    for (const c of (customers ?? []) as Customer[]) {
      const debt = debtByCustomer.get(c.id) ?? 0;
      const paid = paidByCustomer.get(c.id) ?? 0;
      out.set(c.id, Math.max(0, debt - paid));
    }
    return out;
  }, [creditSales, customers, payments]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = ((customers ?? []) as Customer[]).map((c) => ({
      customer: c,
      balance: balances.get(c.id) ?? 0,
    }));

    const filtered = q
      ? list.filter((r) => r.customer.name.toLowerCase().includes(q) || (r.customer.phone ?? '').toLowerCase().includes(q))
      : list;

    return filtered.sort((a, b) => b.balance - a.balance || a.customer.name.localeCompare(b.customer.name));
  }, [balances, customers, query]);

  const totals = useMemo(() => {
    const totalOwed = rows.reduce((sum, r) => sum + r.balance, 0);
    const owingCount = rows.filter((r) => r.balance > 0).length;
    return { totalOwed, owingCount, totalCustomers: rows.length };
  }, [rows]);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);

  const onAddCustomer = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('Enter customer name');
      return;
    }

    setAdding(true);
    try {
      const created = await addCustomer({ name, phone: newPhone.trim() || undefined });
      setNewName('');
      setNewPhone('');
      toast.success('Customer saved');
      navigate(`/customers/${created.id}`);
    } catch (e) {
      toast.error((e as Error)?.message || 'Failed to add customer');
    } finally {
      setAdding(false);
    }
  };

  return (
    <AppShell title="Customer Book">
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Customers</CardTitle>
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add customer</DialogTitle>
                  <DialogDescription>Used for Pay Later sales and partial payments.</DialogDescription>
                </DialogHeader>

                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="custName">Name</Label>
                    <Input id="custName" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Mr. Phiri" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="custPhone">Phone (optional)</Label>
                    <Input id="custPhone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="e.g. 097…" />
                  </div>
                </div>

                <DialogFooter>
                  <Button onClick={onAddCustomer} disabled={adding} className="gap-2">
                    <User className="h-4 w-4" />
                    {adding ? 'Saving…' : 'Save'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder="Name or phone…" />
              </div>
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Customers</span>
                <span className="font-semibold">{totals.totalCustomers}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Customers owing</span>
                <span className="font-semibold">{totals.owingCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total outstanding</span>
                <span className="font-semibold text-destructive">
                  {currencySymbol}
                  {totals.totalOwed.toFixed(2)}
                </span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Tap a customer below to open their details. Use "Record payment" on the customer page for people who have paid;
              any balance shown in red means the customer still owes.
            </p>

            <Separator />

            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No customers yet.</p>
            ) : (
              <div className="space-y-2">
                {rows.map(({ customer, balance }) => (
                  <button
                    key={customer.id}
                    onClick={() => navigate(`/customers/${customer.id}`)}
                    className="w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{customer.name}</p>
                        {customer.phone ? (
                          <p className="truncate text-xs text-muted-foreground">{customer.phone}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">No phone</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={balance > 0 ? 'text-sm font-semibold text-destructive' : 'text-sm font-semibold'}>
                          {currencySymbol}
                          {balance.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">Balance</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
