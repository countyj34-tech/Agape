import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { AlertCircle, TrendingUp, Package, DollarSign, Percent, Download, Calendar, Clock } from 'lucide-react';
import type { ParallelReport } from '@/types/pos';
import { getApprovedReportsByBranch, getLatestApprovedReport } from '@/lib/parallelSupabase';

interface ClientDashboardProps {
  businessId: string;
  branchId: string;
  businessName: string;
  branchName: string;
  currencySymbol?: string;
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export function ClientDashboardView(props: ClientDashboardProps) {
  const [latestReport, setLatestReport] = useState<ParallelReport | null>(null);
  const [allReports, setAllReports] = useState<ParallelReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<ParallelReport | null>(null);
  const currency = props.currencySymbol || 'K';

  useEffect(() => {
    loadReports();
  }, [props.branchId]);

  async function loadReports() {
    setLoading(true);
    try {
      const latest = await getLatestApprovedReport(props.branchId);
      setLatestReport(latest);
      setSelectedReport(latest);

      const all = await getApprovedReportsByBranch(props.branchId);
      setAllReports(all);
    } catch (error) {
      console.error('Failed to load reports:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const report = selectedReport || latestReport;

  // Prepare chart data
  const topProductsData = report?.topSellingProducts?.slice(0, 5).map((p) => ({
    name: p.productName.length > 20 ? p.productName.substring(0, 20) + '...' : p.productName,
    value: p.quantity,
    revenue: p.totalValue,
  })) || [];

  const performanceData = [
    { name: 'Opening Stock', value: report?.openingStockValue || 0 },
    { name: 'Closing Stock', value: report?.closingStockValue || 0 },
  ];

  return (
    <div className="w-full space-y-6 p-4">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{props.businessName}</h1>
        <p className="text-gray-600">{props.branchName} • Inventory Dashboard</p>
      </div>

      {!report ? (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            🟡 Waiting For Official Report
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Status Card */}
          <Card className="border-green-200 bg-green-50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-green-700">
                  <span className="text-2xl">🟢</span>
                  Official Report Ready
                </CardTitle>
                <Badge className="bg-green-600">Approved</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-600">Business Date</p>
                  <p className="text-lg font-semibold">{report.reportDate}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Approved Date</p>
                  <p className="text-lg font-semibold">
                    {report.approvedAt ? new Date(report.approvedAt).toLocaleDateString() : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Prepared By</p>
                  <p className="text-lg font-semibold">Mthunzi-Tech-Labs</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Status</p>
                  <p className="text-lg font-semibold text-green-600">✓ Completed</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Opening Stock Value</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-3xl font-bold text-green-600">
                  {currency}{report.openingStockValue.toFixed(2)}
                </p>
                <p className="text-xs text-gray-500">{report.openingStockItems?.length || 0} items</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Closing Stock Value</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-3xl font-bold text-blue-600">
                  {currency}{report.closingStockValue.toFixed(2)}
                </p>
                <p className="text-xs text-gray-500">{report.closingStockItems?.length || 0} items</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Sales Value</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-3xl font-bold text-purple-600">
                  {currency}{report.salesValue.toFixed(2)}
                </p>
                <p className="text-xs text-gray-500">{report.quantitySold || 0} units sold</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Gross Profit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-3xl font-bold text-orange-600">
                  {currency}{report.grossProfit.toFixed(2)}
                </p>
                <p className="text-xs text-gray-500">{report.grossProfitMargin?.toFixed(1) || '0'}% margin</p>
              </CardContent>
            </Card>
          </div>

          {/* Performance Indicators */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Products Sold
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{report.productsSold}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Percent className="w-4 h-4" />
                  Inventory Accuracy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-green-600">{report.inventoryAccuracy.toFixed(1)}%</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Stock Variance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${report.stockVariance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {report.stockVariance}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top Selling Products */}
            {topProductsData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top Selling Products</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topProductsData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#10b981" name="Units Sold" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Stock Performance */}
            {performanceData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Stock Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={performanceData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip formatter={(value) => `${currency}${value.toFixed(2)}`} />
                      <Bar dataKey="value" fill="#3b82f6" name="Stock Value" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Issues & Recommendations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Issues */}
            {((report.outOfStockProducts && report.outOfStockProducts.length > 0) ||
              (report.lowStockProducts && report.lowStockProducts.length > 0) ||
              (report.missingProducts && report.missingProducts.length > 0)) && (
              <Card className="border-red-200">
                <CardHeader>
                  <CardTitle className="text-base text-red-600">Inventory Issues</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {report.outOfStockProducts && report.outOfStockProducts.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-red-600">Out of Stock</p>
                      <p className="text-sm text-gray-600">{report.outOfStockProducts.length} products</p>
                    </div>
                  )}
                  {report.lowStockProducts && report.lowStockProducts.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-orange-600">Low Stock</p>
                      <p className="text-sm text-gray-600">{report.lowStockProducts.length} products</p>
                    </div>
                  )}
                  {report.missingProducts && report.missingProducts.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-red-600">Missing Products</p>
                      <p className="text-sm text-gray-600">{report.missingProducts.length} products</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Recommendations */}
            {report.recommendations && report.recommendations.length > 0 && (
              <Card className="border-blue-200">
                <CardHeader>
                  <CardTitle className="text-base text-blue-600">Recommendations</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {report.recommendations.slice(0, 3).map((rec, idx) => (
                      <li key={idx} className="text-sm flex gap-2">
                        <span className="text-blue-600 flex-shrink-0">•</span>
                        <span className="text-gray-700">{rec}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Previous Reports */}
          {allReports.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Previous Reports</CardTitle>
                <CardDescription>View historical reports (read-only)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {allReports.slice(1, 10).map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded hover:bg-gray-100 cursor-pointer transition-colors"
                      onClick={() => setSelectedReport(r)}
                    >
                      <div className="flex items-center gap-3">
                        <Calendar className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-medium">{r.reportDate}</span>
                      </div>
                      <span className="text-sm text-gray-600">{currency}{r.salesValue.toFixed(2)} sales</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Footer */}
          <Alert className="bg-blue-50 border-blue-200">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800 text-sm">
              This is a read-only view. For more details or to share reports, please contact the administrator.
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  );
}

export default function ParallelClientDashboard() {
  // This would typically come from auth context or route params
  const [businessData] = useState({
    businessId: 'sample-business-id',
    branchId: 'sample-branch-id',
    businessName: 'Sample Business',
    branchName: 'Main Branch',
    currencySymbol: 'K',
  });

  return <ClientDashboardView {...businessData} />;
}
