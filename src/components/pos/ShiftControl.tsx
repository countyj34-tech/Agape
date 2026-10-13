import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { UserRound, Play, Square, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { dexieDb, endShift, startShift, createShiftReconciliationReport, lockShiftForAudit } from '@/lib/db';
import { getStaffByIdentifier } from '@/lib/companyManagement';
import type { Sale } from '@/types/pos';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function parseMoney(value: string): number | undefined {
  const cleaned = value.replace(/[^0-9.\-]/g, '').trim();
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export function ShiftControl() {
  const navigate = useNavigate();
  const { settings } = useSupabaseAuth();
  const currencySymbol = settings?.currencySymbol || 'K';

  const [open, setOpen] = useState(false);

  const activeShift = useLiveQuery(
    () => dexieDb.shifts.where('status').equals('open').first(),
    []
  );

  // Only load heavy shift aggregates when the shift dialog is open (keeps POS taps snappy).
  const shiftSales = useLiveQuery(
    () =>
      open && activeShift
        ? dexieDb.sales.where('shiftId').equals(activeShift.id).toArray()
        : [],
    [open, activeShift?.id]
  );

  const shiftExpenses = useLiveQuery(
    () =>
      open && activeShift
        ? dexieDb.expenses
            .where('createdAt')
            .between(new Date(activeShift.startedAt), new Date(activeShift.endedAt ?? Date.now()), true, true)
            .toArray()
        : [],
    [open, activeShift?.id, activeShift?.startedAt, activeShift?.endedAt]
  );

  const [cashierName, setCashierName] = useState(() => localStorage.getItem('pos:lastCashierName') ?? '');
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [staffPin, setStaffPin] = useState('');
  const [reconcileStarted, setReconcileStarted] = useState(false);
  const [busy, setBusy] = useState(false);

  const shiftCashMetrics = useMemo(() => {
    const sales = (shiftSales ?? []) as Sale[];
    const expenses = (shiftExpenses ?? []);

    const paidNowForSale = (s: Sale) => {
      if (typeof s.amountPaid === 'number' && Number.isFinite(s.amountPaid)) return Math.max(0, s.amountPaid);
      if (s.paymentMethod === 'credit') return 0;
      if (s.paymentMethod === 'cash') {
        const received = typeof s.amountReceived === 'number' ? s.amountReceived : s.total;
        return Math.max(0, Math.min(s.total, received));
      }
      return 0;
    };

    const totalCashSales = sales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + paidNowForSale(s), 0);
    const openingFloat = typeof activeShift?.openingCash === 'number' ? activeShift.openingCash : 0;
    const cashExpenses = expenses.filter((e) => e.source === 'cash').reduce((sum, e) => sum + (e.amount ?? 0), 0);
    const expectedCash = totalCashSales + openingFloat - cashExpenses;

    return {
      totalCashSales,
      openingFloat,
      cashExpenses,
      expectedCash,
    };
  }, [shiftSales, shiftExpenses, activeShift?.openingCash]);

  const reconciliation = useMemo(() => {
    const physical = parseMoney(closingCash);
    if (!Number.isFinite(physical as number)) {
      return { physical: undefined as number | undefined, difference: undefined as number | undefined, status: 'pending' as 'pending' | 'balanced' | 'overage' | 'shortage' };
    }
    const expected = shiftCashMetrics.expectedCash;
    const diff = (physical as number) - expected;
    let status: 'balanced' | 'overage' | 'shortage' = 'balanced';
    if (diff > 0.0001) status = 'overage';
    else if (diff < -0.0001) status = 'shortage';
    return { physical: physical as number, difference: diff, status };
  }, [closingCash, shiftCashMetrics]);

  const isClosingCashValid = parseMoney(closingCash) !== undefined && Number.isFinite(parseMoney(closingCash) as number);
  const shouldDisableEndShift = busy || !isClosingCashValid;
  

  const startedLabel = useMemo(() => {
    if (!activeShift?.startedAt) return '';
    const d = new Date(activeShift.startedAt);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
    return `${date} ${time}`;
  }, [activeShift?.startedAt]);

  const onStart = async () => {
    const name = cashierName.trim();
    if (!name) {
      toast.error('Enter cashier name');
      return;
    }

    setBusy(true);
    try {
      // Verify staff PIN if provided
      if (staffPin.trim()) {
        const staffMembers = await getStaffByIdentifier(name);
        const staffMember = staffMembers.find((m) => m.employeePin?.trim() === staffPin.trim());

        if (!staffMember) {
          toast.error('Invalid PIN for this staff member');
          setBusy(false);
          return;
        }

        // Valid staff member with correct PIN - use their information for accountability
        const shift = await startShift({
          cashierName: staffMember.name,
          openingCash: parseMoney(openingCash),
          staffId: staffMember.id,
          staffPhone: staffMember.phone,
          companyId: staffMember.companyId,
          storeId: staffMember.storeId,
          role: staffMember.role,
        });
        localStorage.setItem('pos:lastCashierName', staffMember.name);
        setOpeningCash('');
        setStaffPin('');
        toast.success(`Shift started for ${staffMember.name} (${staffMember.role})`);
        setOpen(false);
      } else {
        // No PIN provided - allow shift start without verification
        const shift = await startShift({ cashierName: name, openingCash: parseMoney(openingCash) });
        localStorage.setItem('pos:lastCashierName', name);
        setOpeningCash('');
        toast.success(`Shift started for ${shift.cashierName}`);
        setOpen(false);
      }
    } catch (e: any) {
      toast.error(String(e?.message ?? 'Failed to start shift'));
    } finally {
      setBusy(false);
    }
  };

  const onEnd = async () => {
    if (!activeShift) return;

    const physical = parseMoney(closingCash);
    if (!Number.isFinite(physical as number)) {
      toast.error('Enter the counted closing cash amount before ending the shift');
      return;
    }

    setBusy(true);
    try {
      await createShiftReconciliationReport({ shiftId: activeShift.id, actualCash: physical as number });
      const ended = await endShift({ shiftId: activeShift.id, closingCash: physical as number });
      setClosingCash('');
      toast.success('Shift ended and reconciliation recorded');
      setOpen(false);
      navigate(`/shift/${ended.id}`);
    } catch (e: any) {
      toast.error(String(e?.message ?? 'Failed to end shift'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="relative"
        title={activeShift ? `Shift: ${activeShift.cashierName}` : 'Start shift'}
      >
        <UserRound className="h-5 w-5" />
        {activeShift && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
        )}
        <span className="sr-only">Shift</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cashier Shift</DialogTitle>
            <DialogDescription>
              {activeShift
                ? 'End your shift to generate a shift report.'
                : 'Start a shift so sales are linked to a cashier.'}
            </DialogDescription>
          </DialogHeader>

          {activeShift ? (
            <div className="space-y-4">
              {(activeShift.auditLocked || activeShift.alertStatus === 'theft') && (
                <div className={`rounded-md border p-3 text-sm ${activeShift.alertStatus === 'theft' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                  {activeShift.alertStatus === 'theft'
                    ? '🚨 Shortage flagged: this shift has less cash than expected and requires manager review.'
                    : '⚠️ Shift locked for audit. Reconciliation is in progress.'}
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-white p-3 shadow-sm">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Cashier</div>
                    <div className="mt-2 text-base font-semibold">{activeShift.cashierName}</div>
                    <div className="text-xs text-muted-foreground">Started: {startedLabel}</div>
                  </div>
                  <div className="rounded-lg bg-white p-3 shadow-sm">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Expected cash</div>
                    <div className="mt-2 text-base font-semibold">{currencySymbol}{shiftCashMetrics.expectedCash.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground mt-1">Total cash sales + opening float - cash expenses</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-white p-3 shadow-sm">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Cash sales</div>
                    <div className="mt-2 text-base font-semibold">{currencySymbol}{shiftCashMetrics.totalCashSales.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg bg-white p-3 shadow-sm">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Opening float</div>
                    <div className="mt-2 text-base font-semibold">{currencySymbol}{shiftCashMetrics.openingFloat.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg bg-white p-3 shadow-sm">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Cash expenses</div>
                    <div className="mt-2 text-base font-semibold">{currencySymbol}{shiftCashMetrics.cashExpenses.toFixed(2)}</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">{activeShift.cashierName}</div>
                  <div className="text-xs text-muted-foreground">Started: {startedLabel}</div>
                </div>
                <Badge className="bg-emerald-600">OPEN</Badge>
              </div>

              <div className="space-y-2">
                {!reconcileStarted ? (
                  <>
                    <Label>Closing cash (required before ending shift)</Label>
                    <div className="flex gap-2">
                      <Input
                        inputMode="decimal"
                        placeholder={`${currencySymbol}0.00`}
                        value={closingCash}
                        onChange={(e) => setClosingCash(e.target.value)}
                      />
                      <Button
                        onClick={async () => {
                          if (!activeShift) return;
                          try {
                            await lockShiftForAudit(activeShift.id);
                            setReconcileStarted(true);
                            toast.message('Reconciliation started. Sales are now locked.');
                          } catch (e: any) {
                            toast.error(String(e?.message ?? 'Failed to start reconciliation'));
                          }
                        }}
                      >
                        Start Reconcile
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Enter the counted cash amount before ending the shift. This locks the drawer and records the audit.</p>
                  </>
                ) : (
                  <>
                    <Label>Closing cash (enter physical amount)</Label>
                    <div className="flex gap-2">
                      <Input
                        inputMode="decimal"
                        placeholder={`${currencySymbol}0.00`}
                        value={closingCash}
                        onChange={(e) => setClosingCash(e.target.value)}
                      />
                      <Button
                        onClick={async () => {
                          const physical = parseMoney(closingCash);
                          if (!activeShift) return;
                          if (!Number.isFinite(physical as number)) {
                            toast.error('Enter the counted closing cash amount before submitting reconciliation');
                            return;
                          }
                          setBusy(true);
                          try {
                            await createShiftReconciliationReport({ shiftId: activeShift.id, actualCash: physical as number });
                            const ended = await endShift({ shiftId: activeShift.id, closingCash: physical as number });
                            toast.success('Reconciliation recorded and shift closed');
                            setOpen(false);
                            navigate(`/shift/${ended.id}`);
                          } catch (e: any) {
                            console.error(e);
                            toast.error(String(e?.message ?? 'Failed to complete reconciliation'));
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy || !isClosingCashValid}
                      >
                        Submit & Reconcile
                      </Button>
                      <Button variant="ghost" onClick={() => { setClosingCash(''); }} disabled={busy}>
                        Reset
                      </Button>
                    </div>
                  </>
                )}
                <div className="mt-4 space-y-2 rounded-md border p-3 bg-slate-50 text-sm">
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between font-medium">
                      <span className="text-muted-foreground text-slate-700">Total cash sales</span>
                      <span className="font-bold text-slate-900">{currencySymbol}{shiftCashMetrics.totalCashSales.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Opening float</span>
                      <span>{currencySymbol}{shiftCashMetrics.openingFloat.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Cash expenses</span>
                      <span>{currencySymbol}{shiftCashMetrics.cashExpenses.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between font-medium border-t pt-2 mt-2">
                      <span className="text-muted-foreground text-slate-700">Expected cash in drawer</span>
                      <span className="font-bold text-slate-900">
                        {currencySymbol}{shiftCashMetrics.expectedCash.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {typeof reconciliation.physical === 'number' && (
                    <>
                      <div className="flex items-center justify-between border-t pt-2 mt-2">
                        <span className="text-muted-foreground">Entered physical cash</span>
                        <span className="font-semibold">
                          {currencySymbol}
                          {reconciliation.physical.toFixed(2)}
                        </span>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          Difference
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] text-muted-foreground hover:bg-muted"
                                aria-label="What does this difference mean?"
                              >
                                <HelpCircle className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="start" className="max-w-xs text-xs">
                              This shows the gap between the system expected cash and the physical cash you counted.
                              Positive = <span className="font-semibold">overage</span> (extra cash), negative =
                              <span className="font-semibold"> shortage</span> (missing cash).
                            </TooltipContent>
                          </Tooltip>
                        </span>
                        <span
                          className={
                            reconciliation.status === 'balanced'
                              ? 'font-semibold'
                              : reconciliation.status === 'overage'
                              ? 'font-semibold text-emerald-600'
                              : 'font-semibold text-destructive'
                          }
                        >
                          {currencySymbol}
                          {(reconciliation.difference ?? 0).toFixed(2)}
                        </span>
                      </div>

                      {typeof reconciliation.difference === 'number' && reconciliation.difference !== 0 && (
                        <div className={`mt-2 rounded-md border p-2 text-sm font-bold ${reconciliation.difference < 0 ? 'border-red-200 bg-red-100 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                          {reconciliation.difference < 0 ? '⚠️ SHORTAGE DETECTED: ' : '⚠️ OVERAGE DETECTED: '}
                          {currencySymbol}{Math.abs(reconciliation.difference).toFixed(2)} {reconciliation.difference < 0 ? 'MISSING / UNACCOUNTED' : 'EXTRA CASH'}
                        </div>
                      )}
                      
                      {typeof reconciliation.difference === 'number' && reconciliation.difference === 0 && (
                        <div className="mt-2 rounded-md border border-green-200 bg-green-50 p-2 text-sm font-bold text-green-700">
                          ✅ BALANCED
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="destructive"
                  onClick={onEnd}
                  disabled={shouldDisableEndShift}
                  className="gap-2"
                >
                  <Square className="h-4 w-4" />
                  End Shift
                </Button>
                {!isClosingCashValid && (
                  <span className="text-xs text-muted-foreground">Enter closing cash before ending the shift.</span>
                )}
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cashierName">Staff name or phone</Label>
                <Input
                  id="cashierName"
                  placeholder="e.g. Mary or 260977123456"
                  value={cashierName}
                  onChange={(e) => setCashierName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="staffPin">Staff PIN (optional but recommended)</Label>
                <Input
                  id="staffPin"
                  type="password"
                  placeholder="Enter staff PIN"
                  value={staffPin}
                  onChange={(e) => setStaffPin(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Enter PIN to verify staff identity and link shift to staff record for accountability.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="openingCash">Opening cash (optional)</Label>
                <Input
                  id="openingCash"
                  inputMode="decimal"
                  placeholder={`${currencySymbol}0.00`}
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                />
              </div>

              <DialogFooter>
                <Button onClick={onStart} disabled={busy} className="gap-2">
                  <Play className="h-4 w-4" />
                  Start Shift
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
