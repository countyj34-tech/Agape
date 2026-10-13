import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Store, 
  Users, 
  TrendingUp, 
  Package, 
  ShoppingCart, 
  DollarSign,
  Activity,
  Eye,
  RefreshCw,
  BarChart3,
  Clock,
  MapPin,
  Phone
} from 'lucide-react';
import { toast } from 'sonner';
import { listCompaniesForCurrentUser, getCompanyStaff, getActiveShiftsForCompany } from '@/lib/companyManagement';
import { getCompanyStores } from '@/lib/storeManagement';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useStore } from '@/contexts/StoreContext';
import { subscribeToStoreSales, subscribeToStoreUpdates } from '@/lib/storeManagement';
import type { Company, Store as StoreType, Staff, ShiftLog } from '@/types/pos';
import type { Sale } from '@/types/pos';

interface StoreMetrics {
  storeId: string;
  storeName: string;
  todaySales: number;
  todayTransactions: number;
  activeStaff: number;
  lowStockItems: number;
  lastSaleTime?: Date;
  status: 'online' | 'offline' | 'busy';
}

interface CompanyMetrics {
  companyId: string;
  companyName: string;
  totalStores: number;
  totalStaff: number;
  todayRevenue: number;
  activeStores: number;
  activeStaff: number;
}

export default function ViewAllStoresPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [activeShifts, setActiveShifts] = useState<ShiftLog[]>([]);
  const [storeMetrics, setStoreMetrics] = useState<StoreMetrics[]>([]);
  const [companyMetrics, setCompanyMetrics] = useState<CompanyMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [realTimeData, setRealTimeData] = useState<Record<string, Sale | StoreType>>({});
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  
  const navigate = useNavigate();
  const { settings } = useSupabaseAuth();
  const { currentStoreId, setCurrentStoreId } = useStore();

  async function loadData() {
    try {
      setLoading(true);

      const companiesData = await listCompaniesForCurrentUser({
        companyId: settings?.companyId,
        userRole: settings?.userRole,
      });
      setCompanies(companiesData);

      if (companiesData.length > 0) {
        const preferred =
          companiesData.find((c) => String(c.id) === String(settings?.companyId)) ||
          companiesData[0];
        setSelectedCompany(preferred);

        // Load stores, staff, and metrics for visible companies only
        await loadCompanyData(companiesData);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error('Failed to load store data');
    } finally {
      setLoading(false);
    }
  }

  async function loadCompanyData(companies: Company[]) {
    const storeMetricsData: StoreMetrics[] = [];
    const companyMetricsData: CompanyMetrics[] = [];

    for (const company of companies) {
      const [companyStoresRaw, companyStaff, activeShifts] = await Promise.all([
        getCompanyStores(company.id),
        getCompanyStaff(company.id),
        getActiveShiftsForCompany(company.id),
      ]);

      const companyStores = Array.isArray(companyStoresRaw) ? companyStoresRaw : (companyStoresRaw && (companyStoresRaw as any).stores ? (companyStoresRaw as any).stores : []);

      setStores(prev => [...prev, ...companyStores]);
      setStaff(prev => [...prev, ...companyStaff]);
      setActiveShifts(prev => [...prev, ...activeShifts]);

      // Calculate store metrics
      const metrics = companyStores.map(store => ({
        storeId: store.id,
        storeName: store.name,
        todaySales: Math.floor(Math.random() * 10000), // Placeholder - would come from actual sales data
        todayTransactions: Math.floor(Math.random() * 100), // Placeholder
        activeStaff: activeShifts.filter(shift => shift.storeId === store.id).length,
        lowStockItems: Math.floor(Math.random() * 5), // Placeholder
        lastSaleTime: new Date(Date.now() - Math.random() * 3600000), // Placeholder
        status: Math.random() > 0.3 ? 'online' : Math.random() > 0.5 ? 'busy' : 'offline' as 'online' | 'offline' | 'busy',
      }));

      storeMetricsData.push(...metrics);

      // Calculate company metrics
      const companyMetric: CompanyMetrics = {
        companyId: company.id,
        companyName: company.name,
        totalStores: companyStores.length,
        totalStaff: companyStaff.length,
        todayRevenue: metrics.reduce((sum, m) => sum + m.todaySales, 0),
        activeStores: metrics.filter(m => m.status === 'online').length,
        activeStaff: activeShifts.length,
      };

      companyMetricsData.push(companyMetric);
    }

    setStoreMetrics(storeMetricsData);
    setCompanyMetrics(companyMetricsData);
  }

  function setupRealtimeSubscriptions() {
    // Set up real-time subscriptions for all stores
    stores.forEach(store => {
      const salesChannel = subscribeToStoreSales(store.id, (sale: Sale) => {
        setRealTimeData(prev => ({
          ...prev,
          [`sale-${store.id}`]: sale,
        }));
        setLastUpdate(new Date());

        // Update store metrics
        setStoreMetrics(prev => prev.map(metric => 
          metric.storeId === store.id 
            ? { 
                ...metric, 
                todaySales: metric.todaySales + (sale.total || 0),
                todayTransactions: metric.todayTransactions + 1,
                lastSaleTime: new Date(sale.created_at),
                status: 'online'
              }
            : metric
        ));
      });

      const storeChannel = subscribeToStoreUpdates(store.id, (updatedStore: Partial<StoreType>) => {
        setStores(prev => prev.map(s => s.id === store.id ? { ...s, ...updatedStore } : s));
        setLastUpdate(new Date());
      });
    });
  }

  function cleanupSubscriptions() {
    // Cleanup would be handled by the subscription functions
  }

  useEffect(() => {
    loadData();
    setupRealtimeSubscriptions();
    
    return () => {
      // Cleanup subscriptions
      cleanupSubscriptions();
    };
  }, [loadData, setupRealtimeSubscriptions]);

  const refreshData = () => {
    setLastUpdate(new Date());
    loadData();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'busy': return 'bg-yellow-500';
      case 'offline': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'online': return 'Online';
      case 'busy': return 'Busy';
      case 'offline': return 'Offline';
      default: return 'Unknown';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading all stores...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">All Stores Overview</h1>
          <p className="text-muted-foreground">
            Real-time monitoring of all stores and companies
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </Badge>
          <Button variant="outline" size="sm" onClick={refreshData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Company Overview */}
      {companyMetrics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Company Overview
            </CardTitle>
            <CardDescription>
              Performance metrics across all companies
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {companyMetrics.map((metrics) => (
                <div key={metrics.companyId} className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{metrics.companyName}</h3>
                    <Badge variant="outline">{metrics.totalStores} stores</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Today's Revenue</div>
                      <div className="font-semibold">K{metrics.todayRevenue.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Active Staff</div>
                      <div className="font-semibold">{metrics.activeStaff}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Active Stores</div>
                      <div className="font-semibold">{metrics.activeStores}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total Staff</div>
                      <div className="font-semibold">{metrics.totalStaff}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Store Details */}
      <Tabs defaultValue="stores" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stores">Stores ({storeMetrics.length})</TabsTrigger>
          <TabsTrigger value="staff">Staff ({staff.length})</TabsTrigger>
          <TabsTrigger value="activity">Real-time Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="stores">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="h-5 w-5" />
                Store Status
              </CardTitle>
              <CardDescription>
                Live status and performance of all stores
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {storeMetrics.map((store) => (
                  <div key={store.storeId} className="p-4 border rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{store.storeName}</h3>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(store.status)}`} />
                        <Badge variant="outline" className="text-xs">
                          {getStatusText(store.status)}
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Today's Sales</span>
                        <span className="font-semibold">K{store.todaySales.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Transactions</span>
                        <span className="font-semibold">{store.todayTransactions}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Active Staff</span>
                        <span className="font-semibold">{store.activeStaff}</span>
                      </div>
                      {store.lowStockItems > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Low Stock</span>
                          <span className="font-semibold text-yellow-600">{store.lowStockItems} items</span>
                        </div>
                      )}
                      {store.lastSaleTime && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Last Sale</span>
                          <span className="font-semibold">{store.lastSaleTime.toLocaleTimeString()}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                onClick={() => navigate(`/?storeId=${store.id}`)}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        View
                      </Button>
                      {currentStoreId !== store.id && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setCurrentStoreId(store.id);
                            navigate('/');
                          }}
                        >
                          <Store className="h-3 w-3 mr-1" />
                          Switch
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="staff">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Staff Activity
              </CardTitle>
              <CardDescription>
                Currently active staff across all stores
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activeShifts.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No active staff</h3>
                  <p className="text-muted-foreground">No staff members are currently clocked in</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeShifts.map((shift) => (
                    <div key={shift.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <h4 className="font-semibold">{shift.staffName}</h4>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>Clocked in: {shift.clockInAt.toLocaleTimeString()}</span>
                          <span>{shift.staffPhone}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="default">Active</Badge>
                        {shift.departmentId && (
                          <Badge variant="outline">Department</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Real-time Activity
              </CardTitle>
              <CardDescription>
                Live sales and updates across all stores
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Alert>
                  <AlertDescription>
                    Real-time activity monitoring is active. You'll see live sales and updates as they happen across all stores.
                  </AlertDescription>
                </Alert>
                
                <div className="space-y-2">
                  {Object.entries(realTimeData).slice(-10).map(([key, data]) => (
                    <div key={key} className="p-3 border rounded-lg text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {key.startsWith('sale-') ? `Sale in ${(data as Sale).store_name || 'Store'}` : 'Store Update'}
                        </span>
                        <span className="text-muted-foreground">
                          {new Date((data as Sale).created_at || Date.now()).toLocaleTimeString()}
                        </span>
                      </div>
                      {key.startsWith('sale-') && (
                        <div className="mt-1">
                          Total: K{((data as Sale).total || 0).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
