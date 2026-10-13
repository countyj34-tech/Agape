import React, { useState } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { sanitizeEmail } from '@/lib/utils';

interface Step1Data {
  email: string;
  phone: string;
  pin: string;
  confirmPin: string;
}

interface Step2Data {
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  companyAddress: string;
  currency: string;
}

export function SupabaseSignupForm() {
  const { signup } = useSupabaseAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Step 1: Admin info
  const [step1Data, setStep1Data] = useState<Step1Data>({
    email: '',
    phone: '',
    pin: '',
    confirmPin: ''
  });

  // Step 2: Company info
  const [step2Data, setStep2Data] = useState<Step2Data>({
    companyName: '',
    companyPhone: '',
    companyEmail: '',
    companyAddress: '',
    currency: 'ZMW'
  });

  const validateStep1 = (): boolean => {
    if (!step1Data.email || !step1Data.phone || !step1Data.pin || !step1Data.confirmPin) {
      setError('All fields are required');
      return false;
    }

    const cleaned = sanitizeEmail(step1Data.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      setError('Please enter a valid email address');
      return false;
    }

    if (!/^\d{6}$/.test(step1Data.pin)) {
      setError('PIN must be exactly 6 digits');
      return false;
    }

    if (step1Data.pin !== step1Data.confirmPin) {
      setError('PINs do not match');
      return false;
    }

    if (!/^\d{9,15}$/.test(step1Data.phone.replace(/\D/g, ''))) {
      setError('Please enter a valid phone number');
      return false;
    }

    return true;
  };

  const validateStep2 = (): boolean => {
    if (!step2Data.companyName || !step2Data.companyPhone) {
      setError('Company name and phone are required');
      return false;
    }

    if (!/^\d{9,15}$/.test(step2Data.companyPhone.replace(/\D/g, ''))) {
      setError('Please enter a valid company phone number');
      return false;
    }

    if (step2Data.companyEmail) {
      const cleanedCompany = sanitizeEmail(step2Data.companyEmail);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedCompany)) {
        setError('Please enter a valid company email address');
        return false;
      }
    }

    return true;
  };

  const handleStep1Next = () => {
    setError(null);
    if (validateStep1()) {
      setStep(2);
    }
  };

  const handleStep2Back = () => {
    setStep(1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateStep2()) {
      return;
    }

    setLoading(true);

    const result = await signup({
      email: sanitizeEmail(step1Data.email).toLowerCase(),
      phone: step1Data.phone,
      pin: step1Data.pin,
      companyName: step2Data.companyName,
      companyPhone: step2Data.companyPhone,
      companyEmail: step2Data.companyEmail ? sanitizeEmail(step2Data.companyEmail) : undefined,
      companyAddress: step2Data.companyAddress || undefined,
      currency: step2Data.currency
    });

    setLoading(false);

    if (result.success) {
      setSuccess(true);
    } else {
      setError(result.error || 'Signup failed');
    }
  };

  const formatPhoneNumber = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
              Account Created Successfully!
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Your company has been set up and you can now start using the POS system.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {step === 1 ? 'Create Your Account' : 'Set Up Your Company'}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {step === 1 
              ? 'Step 1 of 2: Create your admin account'
              : 'Step 2 of 2: Enter your company details'
            }
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center space-x-2">
          <div className={`h-2 w-8 rounded-full ${step >= 1 ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
          <div className={`h-2 w-8 rounded-full ${step >= 2 ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {step === 1 ? (
          // Step 1: Admin Information
          <form className="mt-8 space-y-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email Address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={step1Data.email}
                  onChange={(e) => setStep1Data({ ...step1Data, email: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="admin@company.com"
                />
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                  Phone Number
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  required
                  value={formatPhoneNumber(step1Data.phone)}
                  onChange={(e) => setStep1Data({ ...step1Data, phone: e.target.value.replace(/\D/g, '') })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="097 123 456"
                />
              </div>

              <div>
                <label htmlFor="pin" className="block text-sm font-medium text-gray-700">
                  6-Digit PIN
                </label>
                <input
                  id="pin"
                  name="pin"
                  type="password"
                  autoComplete="new-password"
                  required
                  maxLength={6}
                  value={step1Data.pin}
                  onChange={(e) => setStep1Data({ ...step1Data, pin: e.target.value.replace(/\D/g, '') })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="••••••"
                />
              </div>

              <div>
                <label htmlFor="confirmPin" className="block text-sm font-medium text-gray-700">
                  Confirm PIN
                </label>
                <input
                  id="confirmPin"
                  name="confirmPin"
                  type="password"
                  autoComplete="new-password"
                  required
                  maxLength={6}
                  value={step1Data.confirmPin}
                  onChange={(e) => setStep1Data({ ...step1Data, confirmPin: e.target.value.replace(/\D/g, '') })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="••••••"
                />
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={handleStep1Next}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Next Step
              </button>
            </div>
          </form>
        ) : (
          // Step 2: Company Information
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label htmlFor="companyName" className="block text-sm font-medium text-gray-700">
                  Company Name *
                </label>
                <input
                  id="companyName"
                  name="companyName"
                  type="text"
                  required
                  value={step2Data.companyName}
                  onChange={(e) => setStep2Data({ ...step2Data, companyName: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="My Business Ltd"
                />
              </div>

              <div>
                <label htmlFor="companyPhone" className="block text-sm font-medium text-gray-700">
                  Company Phone *
                </label>
                <input
                  id="companyPhone"
                  name="companyPhone"
                  type="tel"
                  required
                  value={formatPhoneNumber(step2Data.companyPhone)}
                  onChange={(e) => setStep2Data({ ...step2Data, companyPhone: e.target.value.replace(/\D/g, '') })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="097 123 456"
                />
              </div>

              <div>
                <label htmlFor="companyEmail" className="block text-sm font-medium text-gray-700">
                  Company Email
                </label>
                <input
                  id="companyEmail"
                  name="companyEmail"
                  type="email"
                  value={step2Data.companyEmail}
                  onChange={(e) => setStep2Data({ ...step2Data, companyEmail: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="contact@company.com"
                />
              </div>

              <div>
                <label htmlFor="companyAddress" className="block text-sm font-medium text-gray-700">
                  Company Address
                </label>
                <textarea
                  id="companyAddress"
                  name="companyAddress"
                  rows={3}
                  value={step2Data.companyAddress}
                  onChange={(e) => setStep2Data({ ...step2Data, companyAddress: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="123 Main Street, Lusaka, Zambia"
                />
              </div>

              <div>
                <label htmlFor="currency" className="block text-sm font-medium text-gray-700">
                  Default Currency
                </label>
                <select
                  id="currency"
                  name="currency"
                  value={step2Data.currency}
                  onChange={(e) => setStep2Data({ ...step2Data, currency: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="ZMW">Zambian Kwacha (ZMW)</option>
                  <option value="USD">US Dollar (USD)</option>
                  <option value="EUR">Euro (EUR)</option>
                  <option value="GBP">British Pound (GBP)</option>
                </select>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={handleStep2Back}
                className="flex-1 flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </div>
          </form>
        )}

        <div className="text-center">
          <p className="text-sm text-gray-600">
            Already have an account?{' '}
            <a href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
