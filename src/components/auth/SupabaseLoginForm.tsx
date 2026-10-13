import React, { useState } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';

export function SupabaseLoginForm() {
  const { login } = useSupabaseAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [pin, setPin] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!emailOrPhone || !pin) {
      setError('Email/phone and PIN are required');
      return;
    }

    // Validate PIN is 6 digits
    if (!/^\d{6}$/.test(pin)) {
      setError('PIN must be 6 digits');
      return;
    }

    setLoading(true);

    const result = await login({
      emailOrPhone: emailOrPhone.trim(),
      pin
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error || 'Login failed');
    }
  };

  const handleForgotPin = () => {
    // Navigate to PIN reset page or show modal
    console.log('Forgot PIN flow');
  };

  const formatPhoneNumber = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
  };

  const isPhoneNumber = (value: string): boolean => {
    return !value.includes('@') && /\d/.test(value);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Enter your email or phone number and 6-digit PIN
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="emailOrPhone" className="block text-sm font-medium text-gray-700">
                Email or Phone Number
              </label>
              <input
                id="emailOrPhone"
                name="emailOrPhone"
                type="text"
                autoComplete="username"
                required
                value={isPhoneNumber(emailOrPhone) ? formatPhoneNumber(emailOrPhone) : emailOrPhone}
                onChange={(e) => {
                  const value = e.target.value;
                  if (isPhoneNumber(value)) {
                    setEmailOrPhone(value.replace(/\D/g, ''));
                  } else {
                    setEmailOrPhone(value);
                  }
                }}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder={isPhoneNumber(emailOrPhone) ? "097 123 456" : "you@example.com"}
              />
              <p className="mt-1 text-xs text-gray-500">
                Enter either your email address or phone number
              </p>
            </div>

            <div>
              <label htmlFor="pin" className="block text-sm font-medium text-gray-700">
                6-Digit PIN
              </label>
              <input
                id="pin"
                name="pin"
                type="password"
                autoComplete="current-password"
                required
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="••••••"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900">
                Remember me
              </label>
            </div>

            <div className="text-sm">
              <button
                type="button"
                onClick={handleForgotPin}
                className="font-medium text-indigo-600 hover:text-indigo-500"
              >
                Forgot your PIN?
              </button>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>

        <div className="text-center">
          <p className="text-sm text-gray-600">
            Don't have an account?{' '}
            <a href="/signup" className="font-medium text-indigo-600 hover:text-indigo-500">
              Sign up
            </a>
          </p>
        </div>

        {/* Quick login demo for development */}
        {import.meta.env.DEV && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-800 font-medium mb-2">Development Quick Login:</p>
            <div className="space-y-1 text-xs text-blue-700">
              <p>Email: admin@demo.com</p>
              <p>PIN: 123456</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
