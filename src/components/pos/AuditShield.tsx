import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { runAuditShield } from '@/lib/reconciliation';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';

type Props = {
  openingFloat: number;
  totalCashSales: number;
  totalCashExpenses: number;
  onResult?: (result: { expectedInDrawer: number; staffEnteredCash: number; variance: number; status: string }) => void;
};

export default function AuditShield({ openingFloat, totalCashSales, totalCashExpenses, onResult }: Props) {
  const { settings } = useSupabaseAuth();
  const currencySymbol = settings?.currencySymbol || 'K';

  const [staffEntered, setStaffEntered] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<null | ReturnType<typeof runAuditShield>>(null);

  const expectedPreview = useMemo(() => {
    return Number((openingFloat + totalCashSales - totalCashExpenses).toFixed(2));
  }, [openingFloat, totalCashSales, totalCashExpenses]);

  const handleSubmit = () => {
    const parsed = Number((staffEntered || '0').toString().replace(/[^0-9.\-]/g, ''));
    const res = runAuditShield({
      openingFloat: Number(openingFloat || 0),
      totalCashSales: Number(totalCashSales || 0),
      totalCashExpenses: Number(totalCashExpenses || 0),
      staffEnteredCash: Number(isFinite(parsed) ? parsed : 0),
    });
    setResult(res);
    setSubmitted(true);
    if (onResult) onResult(res);
  };

  const statusBox = () => {
    if (!result) return null;
    if (result.status === 'BALANCED') {
      return (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
          🟢 BALANCED — Good job
        </div>
      );
    }
    if (result.status === 'OVERAGE') {
      return (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-700">
          ⚠️ OVERAGE — {currencySymbol}{Math.abs(result.variance).toFixed(2)}
        </div>
      );
    }
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-bold text-destructive">
        🚨 SHORTAGE: {currencySymbol}{Math.abs(result.variance).toFixed(2)}
      </div>
    );
  };

  return (
    <div className="space-y-4 p-4 rounded-md border">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-muted-foreground">Opening Float</div>
          <div className="font-semibold">{currencySymbol}{openingFloat.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Total Cash Sales</div>
          <div className="font-semibold">{currencySymbol}{totalCashSales.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Total Cash Expenses</div>
          <div className="font-semibold">{currencySymbol}{totalCashExpenses.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">System Expected</div>
          <div className="font-semibold">{submitted ? (<>{currencySymbol}{expectedPreview.toFixed(2)}</>) : (<span>••••</span>)}</div>
        </div>
      </div>

      <div>
        <Label htmlFor="staffEntered">Staff Entered (drawer total)</Label>
        <Input
          id="staffEntered"
          placeholder={`${currencySymbol}0.00`}
          value={staffEntered}
          onChange={(e) => setStaffEntered(e.target.value)}
          disabled={submitted}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleSubmit} disabled={submitted}>
          Submit
        </Button>
        {submitted && result && (
          <div className="flex-1">{statusBox()}</div>
        )}
      </div>

      {submitted && result && (
        <div className="mt-2 text-sm">
          <div>SYSTEM EXPECTED: <span className="font-bold">{currencySymbol}{result.expectedInDrawer.toFixed(2)}</span></div>
          <div>STAFF ENTERED: <span className="font-bold">{currencySymbol}{result.staffEnteredCash.toFixed(2)}</span></div>
          <div>VARIANCE: <span className={result.variance < 0 ? 'text-destructive font-semibold' : 'text-success font-semibold'}>{currencySymbol}{result.variance.toFixed(2)}</span></div>
        </div>
      )}
    </div>
  );
}
