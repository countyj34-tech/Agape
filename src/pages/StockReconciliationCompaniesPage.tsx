import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { SuperAdminGate } from '@/components/admin/SuperAdminGate';
import { HostKillSwitch } from '@/components/admin/HostKillSwitch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2, BrainCircuit, ChevronRight, Cloud, Loader2, RefreshCw } from 'lucide-react';
import { getStockReconciliationSessionsByCompany } from '@/lib/db';
import { hostStatusLabel, normalizeHostStatus } from '@/lib/hostStatus';
import {
  fetchRemoteCompaniesCatalog,
  fetchReconciliationSessionsForCompany,
  type RemoteCompanySummary,
} from '@/lib/stockReconciliationRemote';

export default function StockReconciliationCompaniesPage() {
  const [companies, setCompanies] = useState<RemoteCompanySummary[]>([]);
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCloudProducts, setTotalCloudProducts] = useState(0);

  function friendlyCloudError(raw?: string | null): string {
    if (!raw) return 'Could not reach Supabase.';
    const lower = raw.toLowerCase();
    if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
      return (
        'Supabase rejected the master cloud login. The app signed you in locally, but ' +
        'The app master account (mthunzilabs@gmail.com) must exist in Supabase → Authentication → Users with the matching password. ' +
        'Your Supabase dashboard login (rondorsparadise205@gmail.com) is only for opening the website — the app cannot use that. ' +
        'Create or reset that user in Supabase → Authentication → Users, set profiles.role to super_admin, then refresh.'
      );
    }
    return raw;
  }

  async function loadCatalog() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRemoteCompaniesCatalog();
      setCloudConnected(result.cloudConnected);
      setCompanies(result.companies);
      setTotalCloudProducts(result.companies.reduce((sum, c) => sum + c.productCount, 0));
      if (result.error) setError(result.error);

      const counts: Record<string, number> = {};
      await Promise.all(
        result.companies.map(async (company) => {
          const [localSessions, remoteSessions] = await Promise.all([
            getStockReconciliationSessionsByCompany(company.id),
            fetchReconciliationSessionsForCompany(company.id).catch(() => []),
          ]);
          counts[company.id] = new Set([
            ...localSessions.map((s) => s.id),
            ...remoteSessions.map((s) => s.id),
          ]).size;
        })
      );
      setSessionCounts(counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load remote companies');
      setCompanies([]);
      setCloudConnected(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  return (
    <SuperAdminGate>
      <AppShell title="AI Stock Processing">
        <div className="mx-auto max-w-5xl space-y-6 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-3">
                <BrainCircuit className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">AI Stock Processing</h1>
                <p className="text-sm text-muted-foreground">
                  Remote client stores — product catalogs are loaded live from Supabase.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadCatalog()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          <Alert variant={cloudConnected ? 'default' : 'destructive'}>
            <Cloud className="h-4 w-4" />
            <AlertDescription>
              {cloudConnected ? (
                <>
                  Connected to Supabase. Found <strong>{companies.length}</strong> companies and{' '}
                  <strong>{totalCloudProducts}</strong> products across remote stores.
                </>
              ) : (
                <>
                  <strong>Cloud database not connected.</strong>{' '}
                  {friendlyCloudError(error)}
                </>
              )}
            </AlertDescription>
          </Alert>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading remote companies from Supabase...
            </div>
          ) : companies.length === 0 ? (
            <Card>
              <CardContent className="space-y-3 py-10 text-center text-muted-foreground">
                <p>No remote companies found.</p>
                <p className="text-sm">
                  {friendlyCloudError(error) ||
                    'Ensure the master account exists in Supabase Auth with super_admin in profiles, and RLS allows reading companies/stores/products.'}
                </p>
                <Button onClick={() => void loadCatalog()}>Try again</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {companies.map((company) => (
                <Card key={company.id} className="transition hover:border-primary/40">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <CardTitle className="text-lg">{company.name}</CardTitle>
                          <CardDescription>
                            {company.phone || company.ownerPhone || company.email || 'No contact'}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge
                          variant={
                            normalizeHostStatus(company.hostStatus) === 'active' ? 'outline' : 'destructive'
                          }
                        >
                          {hostStatusLabel(company.hostStatus)}
                        </Badge>
                        <Badge variant={company.productCount > 0 ? 'default' : 'secondary'}>
                          {company.productCount} cloud products
                        </Badge>
                        <Badge variant="outline">{company.storeCount} stores</Badge>
                        <Badge variant="outline">{sessionCounts[company.id] ?? 0} reports</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {company.stores.length > 0 ? (
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {company.stores.map((store) => (
                          <li key={store.id}>
                            {store.name}: <strong>{store.productCount}</strong> products
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-amber-700">No stores linked to this company in cloud.</p>
                    )}
                    <HostKillSwitch
                      companyId={company.id}
                      companyName={company.name}
                      hostStatus={company.hostStatus}
                      hostStatusReason={company.hostStatusReason}
                      onUpdated={(status, reason) => {
                        setCompanies((prev) =>
                          prev.map((c) =>
                            c.id === company.id
                              ? { ...c, hostStatus: status, hostStatusReason: reason || null }
                              : c
                          )
                        );
                      }}
                    />
                    <Button asChild className="w-full" disabled={company.storeCount === 0}>
                      <Link
                        to={`/admin/ai-stock/${company.id}${
                          company.stores[0] ? `?storeId=${company.stores[0].id}` : ''
                        }`}
                      >
                        Open Workspace
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </AppShell>
    </SuperAdminGate>
  );
}
