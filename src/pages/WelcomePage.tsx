import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';

export default function WelcomePage() {
  const { settings } = useSupabaseAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (settings?.pinSetupComplete && settings.companyId) {
      navigate('/', { replace: true });
    }
  }, [settings, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white px-4 py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col justify-center rounded-3xl border border-white/10 bg-slate-950/80 p-10 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <div className="max-w-3xl text-center">
          <p className="text-sm uppercase tracking-[0.35em] text-amber-300">Know your Profit and manage stores from home</p>
          <h1 className="mt-6 text-5xl font-black tracking-tight sm:text-6xl">Mthunzi-POS for ALL </h1>
          <p className="mt-6 text-lg leading-8 text-slate-300">
            Streamline orders, inventory and staff operations with one powerful terminal. Offline-capable, data-driven and built for fast service.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="grid gap-3 sm:gap-0 sm:grid-cols-2">
              <Button size="lg" className="w-full sm:w-auto" onClick={() => navigate('/login')}>
                Get Started
              </Button>
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/login?tab=staff')}>
                Staff Login
              </Button>
            </div>
          <div className="text-sm text-slate-400">
            Already have an admin account?{' '}
            <button
              type="button"
              className="font-semibold text-amber-300 hover:text-amber-200"
              onClick={() => navigate('/login?tab=admin')}
            >
              Login here
            </button>
          </div>
        </div>

        <div className="mt-16 rounded-3xl border border-white/5 bg-slate-900/70 p-8 shadow-inner shadow-white/5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl bg-slate-950/80 p-6">
              <p className="text-sm uppercase tracking-[0.25em] text-amber-300">Fast setup</p>
              <p className="mt-4 text-base text-slate-300">Create your admin account, register your company, and start adding stores.</p>
            </div>
            <div className="rounded-3xl bg-slate-950/80 p-6">
              <p className="text-sm uppercase tracking-[0.25em] text-amber-300">Team control</p>
              <p className="mt-4 text-base text-slate-300">Add staff with roles so managers and salespeople see the right workflow.</p>
            </div>
            <div className="rounded-3xl bg-slate-950/80 p-6">
              <p className="text-sm uppercase tracking-[0.25em] text-amber-300">One company account</p>
              <p className="mt-4 text-base text-slate-300">All stores, team members and reports stay under one company login.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
