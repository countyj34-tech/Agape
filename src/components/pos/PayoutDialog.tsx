import React, { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dexieDb } from '@/lib/db';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { toast } from 'sonner';

export default function PayoutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const { settings } = useSupabaseAuth();

  const submit = async () => {
    const a = Number(amount);
    if (!a || a <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    try {
      await dexieDb.expenses.add({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        amount: a,
        category: 'payout',
        source: 'cash',
        note: reason || 'Payout',
      } as any);

      // Try to open drawer when a cash payout is recorded
      try {
        const { bluetoothPrinterService } = await import('@/lib/bluetoothPrinterService');
        if (settings) await bluetoothPrinterService.openDrawer(settings);
      } catch (e) {
        // non-fatal
        console.warn('Open drawer failed', e);
      }

      toast.success('Payout recorded');
      onOpenChange(false);
      setAmount('');
      setReason('');
    } catch (e) {
      console.error(e);
      toast.error('Failed to record payout');
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Record Payout</AlertDialogTitle>
          <AlertDialogDescription>Open cash drawer and record money taken out of the till.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 p-4">
          <div>
            <Label>Amount</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <Label>Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Payout reason" />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={submit}>Record Payout</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
