import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Lock, ArrowLeft, CheckCircle } from 'lucide-react';
import { PinEntry } from './PinEntry';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { toast } from 'sonner';

interface PinResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PinResetDialog({ open, onOpenChange }: PinResetDialogProps) {
  const [step, setStep] = useState<'phone' | 'verification' | 'new-pin' | 'success'>('phone');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { resetPin } = useSupabaseAuth();

  const normalizePhone = (value: string) => value.trim().replace(/\D/g, '');

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedPhone = normalizePhone(phone);
    
    if (normalizedPhone.length < 10) {
      setError('Please enter a valid phone number');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Check if phone is registered as a company owner
      const { getCompanyByOwnerPhone } = await import('@/lib/companyManagement');
      const company = await getCompanyByOwnerPhone(normalizedPhone);
      
      // Check if phone is registered as a direct store owner
      const { supabase, isSupabaseConfigured } = await import('@/lib/supabase');
      let storeFound = false;
      
      if (isSupabaseConfigured()) {
        const { data: stores, error: storeError } = await supabase
          .from('stores')
          .select('phone');

        if (storeError) {
          console.warn('Failed to query store phones:', storeError.message || storeError);
        }

        if (stores?.length) {
          storeFound = stores.some((store) => normalizePhone(store.phone || '') === normalizedPhone);
        }
      }
      
      if (!company && !storeFound) {
        setError('This phone number is not registered as a company owner or store owner');
        return;
      }

      setStep('verification');
    } catch (err) {
      setError('Failed to verify phone number. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerificationSuccess = () => {
    setStep('new-pin');
  };

  const handleNewPinSubmit = async (pin: string) => {
    setLoading(true);
    setError('');

    try {
      const success = await resetPin(phone, pin);
      
      if (success) {
        setStep('success');
        toast.success('PIN has been reset successfully');
        setTimeout(() => {
          onOpenChange(false);
          resetDialog();
        }, 2000);
      } else {
        setError('Failed to reset PIN. Please try again.');
      }
    } catch (err) {
      setError('An error occurred while resetting PIN');
    } finally {
      setLoading(false);
    }
  };

  const resetDialog = () => {
    setStep('phone');
    setPhone('');
    setError('');
    setLoading(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    resetDialog();
  };

  const handleBack = () => {
    if (step === 'verification') {
      setStep('phone');
      setError('');
    } else if (step === 'new-pin') {
      setStep('verification');
      setError('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Reset PIN
          </DialogTitle>
          <DialogDescription>
            {step === 'phone' && 'Enter your registered phone number to reset your PIN'}
            {step === 'verification' && 'Please verify your identity to continue'}
            {step === 'new-pin' && 'Create a new PIN for your account'}
            {step === 'success' && 'Your PIN has been reset successfully'}
          </DialogDescription>
        </DialogHeader>

        {step === 'phone' && (
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="0971112222"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="flex-1">
                {loading ? 'Verifying...' : 'Continue'}
              </Button>
            </div>
          </form>
        )}

        {step === 'verification' && (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                We found a company registered to this phone number. Click continue to proceed with PIN reset.
              </AlertDescription>
            </Alert>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                className="flex-1"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleVerificationSuccess} className="flex-1">
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'new-pin' && (
          <div className="space-y-4">
            <PinEntry
              onSubmit={handleNewPinSubmit}
              onCancel={handleBack}
              title="Create New PIN"
              subtitle="Enter your new admin PIN"
              isSetup={true}
              minLength={4}
              maxLength={6}
            />
            
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {step === 'success' && (
          <div className="text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <p className="text-lg font-medium">PIN Reset Successful!</p>
            <p className="text-sm text-muted-foreground">
              You can now use your new PIN to access the system.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
