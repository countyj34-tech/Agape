import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { toast } from 'sonner';

export default function CreateAccountPage() {
  const [step, setStep] = useState<'account' | 'company'>('account');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({
    email: '',
    phone: '',
    pin: '',
    confirmPin: '',
  });
  const [companyForm, setCompanyForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    currency: 'ZMW',
    currencySymbol: 'K',
  });
  const { signup } = useSupabaseAuth();
  const navigate = useNavigate();

  const validateStep1 = (): boolean => {
    if (!accountForm.email.trim() || !accountForm.phone.trim() || !accountForm.pin.trim() || !accountForm.confirmPin.trim()) {
      setError('Please fill out all fields');
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountForm.email.trim())) {
      setError('Please enter a valid email address');
      return false;
    }

    if (!/^\d{6}$/.test(accountForm.pin.trim())) {
      setError('PIN must be exactly 6 digits');
      return false;
    }

    if (accountForm.pin.trim() !== accountForm.confirmPin.trim()) {
      setError('PINs do not match');
      return false;
    }

    setError(null);
    return true;
  };

  const validateStep2 = (): boolean => {
    if (!companyForm.name.trim() || !companyForm.phone.trim()) {
      setError('Company name and phone are required');
      return false;
    }

    if (companyForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyForm.email.trim())) {
      setError('Please enter a valid company email address');
      return false;
    }

    setError(null);
    return true;
  };

  const handleNext = (event: FormEvent) => {
    event.preventDefault();
    if (validateStep1()) {
      setStep('company');
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!validateStep2()) {
      return;
    }

    setLoading(true);

    const signupData = {
      email: accountForm.email.trim().toLowerCase(),
      phone: accountForm.phone.replace(/\D/g, ''),
      pin: accountForm.pin.trim(),
      companyName: companyForm.name.trim(),
      companyPhone: companyForm.phone.replace(/\D/g, ''),
      companyEmail: companyForm.email.trim() || undefined,
      companyAddress: companyForm.address.trim() || undefined,
      currency: companyForm.currency,
      currencySymbol: companyForm.currencySymbol.trim() || undefined,
    };

    try {
      const result = await signup(signupData);
      if (!result.success) {
        setError(result.error || 'Signup failed');
        toast.error(result.error || 'Signup failed');
        return;
      }

      toast.success('Company owner account created successfully');
      localStorage.setItem('mthunzi_new_signup', '1');
      navigate('/setup-store', { replace: true });
    } catch (err) {
      console.error('Signup failed', err);
      setError('Unable to create account. Please try again.');
      toast.error('Unable to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-3xl">
        <Card className="overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-slate-900 to-slate-800 text-white">
            <CardTitle>{step === 'account' ? 'Create Admin Account' : 'Create Your Company'}</CardTitle>
            <CardDescription>
              {step === 'account'
                ? 'Register the company owner using a real email, phone, and 6-digit PIN.'
                : 'Enter your company details to complete the multi-tenant setup.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 p-8">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            {step === 'account' ? (
              <form onSubmit={handleNext} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="owner-email">Owner Email</Label>
                  <Input
                    id="owner-email"
                    type="email"
                    placeholder="owner@example.com"
                    value={accountForm.email}
                    onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-phone">Owner Phone</Label>
                  <Input
                    id="owner-phone"
                    type="tel"
                    placeholder="0971112222"
                    value={accountForm.phone}
                    onChange={(event) => setAccountForm({ ...accountForm, phone: event.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="admin-pin">6-Digit PIN</Label>
                    <Input
                      id="admin-pin"
                      type="password"
                      placeholder="123456"
                      maxLength={6}
                      value={accountForm.pin}
                      onChange={(event) => setAccountForm({ ...accountForm, pin: event.target.value.replace(/\D/g, '') })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-pin">Confirm PIN</Label>
                    <Input
                      id="confirm-pin"
                      type="password"
                      placeholder="123456"
                      maxLength={6}
                      value={accountForm.confirmPin}
                      onChange={(event) => setAccountForm({ ...accountForm, confirmPin: event.target.value.replace(/\D/g, '') })}
                      required
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                    Continue
                  </Button>
                  <Button variant="ghost" onClick={() => navigate('/')}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="company-name">Company Name</Label>
                  <Input
                    id="company-name"
                    placeholder="e.g. Chacha Restaurant Group"
                    value={companyForm.name}
                    onChange={(event) => setCompanyForm({ ...companyForm, name: event.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="company-phone">Company Phone</Label>
                    <Input
                      id="company-phone"
                      type="tel"
                      placeholder="0971112222"
                      value={companyForm.phone}
                      onChange={(event) => setCompanyForm({ ...companyForm, phone: event.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company-email">Company Email</Label>
                    <Input
                      id="company-email"
                      type="email"
                      placeholder="info@company.com"
                      value={companyForm.email}
                      onChange={(event) => setCompanyForm({ ...companyForm, email: event.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-address">Company Address</Label>
                  <Input
                    id="company-address"
                    placeholder="e.g. 123 Main Street"
                    value={companyForm.address}
                    onChange={(event) => setCompanyForm({ ...companyForm, address: event.target.value })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="currency">Currency</Label>
                    <Select value={companyForm.currency} onValueChange={(value) => setCompanyForm({ ...companyForm, currency: value })}>
                      <SelectTrigger id="currency">
                        <SelectValue placeholder="Currency" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ZMW">ZMW</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="currency-symbol">Currency Symbol</Label>
                    <Input
                      id="currency-symbol"
                      placeholder="K"
                      value={companyForm.currencySymbol}
                      onChange={(event) => setCompanyForm({ ...companyForm, currencySymbol: event.target.value })}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                    {loading ? 'Creating company...' : 'Create Company'}
                  </Button>
                  <Button variant="ghost" onClick={() => setStep('account')}>
                    Back
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
