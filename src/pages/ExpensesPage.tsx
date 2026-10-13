import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { dexieDb, addExpense, deleteExpense } from '@/lib/db';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useStore } from '@/contexts/StoreContext';
import type { Expense } from '@/types/pos';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePersistentForm } from '@/hooks/usePersistentForm';

function localDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayBounds(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map((v) => parseInt(v, 10));
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  const end = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  return { start, end };
}

type ExpenseDraft = {
  amount?: string;
  category?: string;
  note?: string;
  source?: Expense['source'];
  mobileReference?: string;
};

export default function ExpensesPage() {
  const { settings } = useSupabaseAuth();
  const currencySymbol = settings?.currencySymbol || 'K';

  const [dateKey, setDateKey] = useState(() => localDateKey(new Date()));
  const { start, end } = useMemo(() => dayBounds(dateKey), [dateKey]);

  const { currentStoreId, isGlobalView } = useStore();

  const expenses = useLiveQuery(
    async () => {
      const list = await dexieDb.expenses.where('createdAt').between(start, end, true, true).toArray();
      if (isGlobalView) return list.reverse();
      return list.filter((e) => e.storeId === currentStoreId).reverse();
    },
    [currentStoreId, isGlobalView, start.getTime(), end.getTime()]
  );

  const totals = useMemo(() => {
    const all = (expenses ?? []) as Expense[];
    const total = all.reduce((sum, e) => sum + (e.amount ?? 0), 0);
    const cash = all.filter((e) => e.source === 'cash').reduce((sum, e) => sum + (e.amount ?? 0), 0);
    const mobile = all.filter((e) => e.source !== 'cash').reduce((sum, e) => sum + (e.amount ?? 0), 0);
    return { total, cash, mobile, count: all.length };
  }, [expenses]);

  const [expenseDraft, setExpenseDraft, clearExpenseDraft] = usePersistentForm<Partial<ExpenseDraft>>(
    'expenses:add-expense-draft',
    () => ({})
  );

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(() => expenseDraft.amount ?? '');
  const [category, setCategory] = useState(() => expenseDraft.category ?? '');
  const [note, setNote] = useState(() => expenseDraft.note ?? '');
  const [source, setSource] = useState<Expense['source']>(
    () => expenseDraft.source ?? 'cash'
  );
  const [mobileReference, setMobileReference] = useState(
    () => expenseDraft.mobileReference ?? ''
  );
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setAmount(expenseDraft.amount ?? '');
      setCategory(expenseDraft.category ?? '');
      setNote(expenseDraft.note ?? '');
      setSource(expenseDraft.source ?? 'cash');
      setMobileReference(expenseDraft.mobileReference ?? '');
    }
  };

  const onAdd = async () => {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (!category.trim()) {
      toast.error('Enter a category');
      return;
    }
    if (source !== 'cash' && mobileReference.trim().length === 0) {
      toast.error('Enter the reference/transaction ID');
      return;
    }

    setSaving(true);
    try {
      await addExpense({
        amount: a,
        category: category.trim(),
        note: note.trim() || undefined,
        source,
        mobileReference: source === 'cash' ? undefined : mobileReference.trim(),
      });
      toast.success('Expense saved');
      clearExpenseDraft();
      setAmount('');
      setCategory('');
      setNote('');
      setSource('cash');
      setMobileReference('');
      setOpen(false);
    } catch (e) {
      toast.error((e as Error)?.message || 'Failed to add expense');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteExpense(id);
      toast.success('Deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  return (
    <AppShell title="Expenses">
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Expenses</CardTitle>
            <Dialog open={open} onOpenChange={handleOpenChange}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add expense</DialogTitle>
                  <DialogDescription>Record money leaving the business (stock run, fuel, airtime, etc.).</DialogDescription>
                </DialogHeader>

                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="expAmount">Amount</Label>
                    <Input
                      id="expAmount"
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAmount(v);
                        setExpenseDraft((prev) => ({ ...prev, amount: v || undefined }));
                      }}
                      onFocus={(e) => e.target.select()}
                      placeholder="0.00"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="expCategory">Category</Label>
                    <Input
                      id="expCategory"
                      value={category}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCategory(v);
                        setExpenseDraft((prev) => ({ ...prev, category: v || undefined }));
                      }}
                      placeholder="e.g. Transport, Airtime, Supplies"
                    />
                    <div className="flex flex-wrap gap-1 pt-1">
                      {['Transport', 'Fuel', 'Airtime', 'Rent', 'Wages', 'Supplies'].map((label) => (
                        <Button
                          key={label}
                          type="button"
                          size="xs"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => {
                            setCategory(label);
                            setExpenseDraft((prev) => ({ ...prev, category: label }));
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label>Source</Label>
                    <Select
                      value={source}
                      onValueChange={(v) => {
                        setSource(v as any);
                        setExpenseDraft((prev) => ({
                          ...prev,
                          source: v as Expense['source'],
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash drawer</SelectItem>
                        <SelectItem value="mtn">MTN MoMo</SelectItem>
                        <SelectItem value="airtel">Airtel Money</SelectItem>
                        <SelectItem value="zamtel">Zamtel</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {source !== 'cash' && (
                    <div className="grid gap-2">
                      <Label htmlFor="expRef">Reference</Label>
                      <Input
                        id="expRef"
                        value={mobileReference}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMobileReference(v);
                          setExpenseDraft((prev) => ({
                            ...prev,
                            mobileReference: v || undefined,
                          }));
                        }}
                        placeholder="Transaction ID"
                        autoComplete="off"
                      />
                    </div>
                  )}

                  <div className="grid gap-2">
                    <Label htmlFor="expNote">Note (optional)</Label>
                    <Input
                      id="expNote"
                      value={note}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNote(v);
                        setExpenseDraft((prev) => ({ ...prev, note: v || undefined }));
                      }}
                      placeholder="Details…"
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button onClick={onAdd} disabled={saving}>
                    {saving ? 'Saving…' : 'Save expense'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Count</span>
                <span className="font-semibold">{totals.count}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Cash expenses</span>
                <span className="font-semibold">
                  {currencySymbol}
                  {totals.cash.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Mobile expenses</span>
                <span className="font-semibold">
                  {currencySymbol}
                  {totals.mobile.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total expenses</span>
                <span className="font-semibold text-destructive">
                  {currencySymbol}
                  {totals.total.toFixed(2)}
                </span>
              </div>
            </div>

            <Separator />

            {(expenses ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses for this day.</p>
            ) : (
              <div className="space-y-2">
                {(expenses ?? []).map((e) => (
                  <div key={e.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {e.category} · {currencySymbol}
                          {Number(e.amount ?? 0).toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(e.createdAt).toLocaleString()} · {String(e.source).toUpperCase()}
                        </p>
                        {e.mobileReference && e.source !== 'cash' && (
                          <p className="text-xs text-muted-foreground">Ref: {e.mobileReference}</p>
                        )}
                        {e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => onDelete(e.id)} className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
