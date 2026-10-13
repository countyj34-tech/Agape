import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { syncFromSupabase } from '@/lib/companyManagement';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { isAdminRole, isSuperAdminRole } from '@/lib/permissions';
import { isOfflineMasterCredentials, isMasterSessionActive } from '@/lib/offlineMasterAuth';

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const [selectedTab, setSelectedTab] = useState<'admin' | 'staff'>(
    searchParams.get('tab') === 'staff' ? 'staff' : 'admin'
  );
  const [adminIdentifier, setAdminIdentifier] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [staffIdentifier, setStaffIdentifier] = useState('');
  const [staffPin, setStaffPin] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login, settings, isAdminAuthenticated, company } = useSupabaseAuth();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'staff' || tab === 'admin') {
      setSelectedTab(tab);
    }
  }, [searchParams]);

  // If already signed in as admin, leave the login screen
  useEffect(() => {
    if (isMasterSessionActive()) {
      navigate('/admin/ai-stock', { replace: true });
      return;
    }
    if (isAdminAuthenticated && isAdminRole(settings?.userRole)) {
      navigate(isSuperAdminRole(settings?.userRole) ? '/admin/ai-stock' : '/admin', {
        replace: true,
      });
    }
  }, [isAdminAuthenticated, settings?.userRole, navigate]);

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-sm text-muted-foreground">Loading login...</p>
      </div>
    );
  }

  const handleAdminSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!adminIdentifier.trim() || !adminPin.trim()) {
      toast.error('Enter admin email or phone and PIN');
      return;
    }

    setLoading(true);
    try {
      const credentials = {
        emailOrPhone: adminIdentifier.trim(),
        pin: adminPin.trim(),
      };

      const isMaster = isOfflineMasterCredentials(credentials.emailOrPhone, credentials.pin);
      const result = await login(credentials);
      if (!result.success) {
        toast.error(result.error || 'Login failed. Verify your credentials.');
        return;
      }

      // Master works across remote tenants — don't sync/prune a single local company
      if (!isMaster) {
        try {
          const companyId = (result as any).company?.id || company?.id || settings?.companyId;
          if (companyId) {
            await syncFromSupabase(companyId);
          }
        } catch (error) {
          console.error('Failed to sync from Supabase:', error);
        }
      }

      toast.success(isMaster ? 'Signed in as master.' : 'Signed in as admin.');
      // Give React a tick to commit auth/settings state before AdminGate runs
      await new Promise((r) => setTimeout(r, 80));
      navigate(isMaster ? '/admin/ai-stock' : '/admin', { replace: true });
    } catch (error) {
      console.error('Admin login failed:', error);
      toast.error('Unable to sign in. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleStaffSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!staffIdentifier.trim() || !staffPin.trim()) {
      toast.error('Enter email or phone and PIN');
      return;
    }

    setLoading(true);
    try {
      const credentials = {
        emailOrPhone: staffIdentifier.trim(),
        pin: staffPin.trim(),
      };

      const result = await login(credentials);
      if (!result.success) {
        toast.error(result.error || 'Staff login failed. Verify your credentials.');
        return;
      }

      try {
        const companyId = (result as any).company?.id || company?.id || settings?.companyId;
        if (companyId) {
          await syncFromSupabase(companyId);
        }
      } catch (error) {
        console.error('Failed to sync from Supabase:', error);
      }

      toast.success('Welcome back!');
      await new Promise((r) => setTimeout(r, 50));
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Staff login failed:', error);
      toast.error('Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <CardTitle>Sign In</CardTitle>
          <CardDescription>
            Sign in with the credentials provided by your admin. Staff only need the email or phone
            assigned to them, plus their PIN.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs
            value={selectedTab}
            onValueChange={(value) => setSelectedTab(value as 'admin' | 'staff')}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="admin">Admin</TabsTrigger>
              <TabsTrigger value="staff">Staff</TabsTrigger>
            </TabsList>

            <TabsContent value="admin">
              <form onSubmit={handleAdminSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-identifier">Admin Email or Phone</Label>
                  <Input
                    id="admin-identifier"
                    type="text"
                    placeholder="owner@example.com or 0971112222"
                    value={adminIdentifier}
                    onChange={(e) => setAdminIdentifier(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-pin">Admin PIN</Label>
                  <Input
                    id="admin-pin"
                    type="password"
                    placeholder="Enter your admin PIN"
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign in as Admin'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="staff">
              <form onSubmit={handleStaffSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="staff-identifier">Email or Phone</Label>
                  <Input
                    id="staff-identifier"
                    type="text"
                    placeholder="jane@example.com or 0971112222"
                    value={staffIdentifier}
                    onChange={(e) => setStaffIdentifier(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-pin">Staff PIN</Label>
                  <Input
                    id="staff-pin"
                    type="password"
                    placeholder="Enter your staff PIN"
                    value={staffPin}
                    onChange={(e) => setStaffPin(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign in as Staff'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => navigate('/')}>
            Back
          </Button>
          <Button variant="outline" onClick={() => navigate('/create-account')}>
            Create Admin Account
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
