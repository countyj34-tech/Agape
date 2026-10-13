import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { CheckCircle, XCircle, AlertCircle, Download, Send, Eye, Clock } from 'lucide-react';
import type { ParallelReport, ParallelBusiness, ParallelBranch } from '@/types/pos';
import {
  getParallelBusinesses,
  getBranchesByBusiness,
  getReportsByBranch,
  updateParallelReport,
} from '@/lib/parallelSupabase';
import { downloadParallelReportPDF } from '@/lib/parallelReportPdf';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ReportWithDetails extends ParallelReport {
  business?: ParallelBusiness;
  branch?: ParallelBranch;
}

export default function ParallelAdminApprovalScreen() {
  const [businesses, setBusinesses] = useState<ParallelBusiness[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<string>('');
  const [branches, setBranches] = useState<ParallelBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [reports, setReports] = useState<ReportWithDetails[]>([]);
  const [selectedReport, setSelectedReport] = useState<ReportWithDetails | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rejectionOpen, setRejectionOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Load businesses
  useEffect(() => {
    loadBusinesses();
  }, []);

  // Load branches when business changes
  useEffect(() => {
    if (selectedBusiness) {
      loadBranches(selectedBusiness);
    }
  }, [selectedBusiness]);

  // Load reports when branch changes
  useEffect(() => {
    if (selectedBranch) {
      loadReports(selectedBranch);
    }
  }, [selectedBranch]);

  async function loadBusinesses() {
    setLoading(true);
    try {
      const data = await getParallelBusinesses();
      setBusinesses(data);
    } catch (error) {
      toast.error('Failed to load businesses');
    } finally {
      setLoading(false);
    }
  }

  async function loadBranches(businessId: string) {
    try {
      const data = await getBranchesByBusiness(businessId);
      setBranches(data);
      setSelectedBranch('');
    } catch (error) {
      toast.error('Failed to load branches');
    }
  }

  async function loadReports(branchId: string) {
    setLoading(true);
    try {
      const data = await getReportsByBranch(branchId);
      const businessId = selectedBusiness;
      const business = businesses.find((b) => b.id === businessId);
      const branch = branches.find((b) => b.id === branchId);

      const withDetails = data.map((r) => ({
        ...r,
        business,
        branch,
      }));

      setReports(withDetails);
    } catch (error) {
      toast.error('Failed to load reports');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(report: ReportWithDetails) {
    if (!report.business) return;

    setProcessing(true);
    try {
      const updated = await updateParallelReport(report.id, {
        status: 'approved',
        approvedBy: 'admin@mthunzi.com',
        approvedAt: new Date(),
      });

      if (updated) {
        toast.success('Report approved successfully');
        setDetailsOpen(false);
        setSelectedReport(null);
        await loadReports(selectedBranch);
      }
    } catch (error) {
      toast.error('Failed to approve report');
    } finally {
      setProcessing(false);
    }
  }

  async function handleReject(report: ReportWithDetails) {
    if (!rejectionReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }

    setProcessing(true);
    try {
      const updated = await updateParallelReport(report.id, {
        status: 'rejected',
        rejectionReason,
      });

      if (updated) {
        toast.success('Report rejected');
        setRejectionOpen(false);
        setRejectionReason('');
        setDetailsOpen(false);
        setSelectedReport(null);
        await loadReports(selectedBranch);
      }
    } catch (error) {
      toast.error('Failed to reject report');
    } finally {
      setProcessing(false);
    }
  }

  async function handleDownloadPDF(report: ReportWithDetails) {
    if (!report.business || !report.branch) return;

    try {
      await downloadParallelReportPDF({
        report,
        business: report.business,
        branch: report.branch,
      });
    } catch (error) {
      toast.error('Failed to generate PDF');
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Approve Reports</h1>
        <p className="text-gray-600">Review and approve stock reports for distribution</p>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Business</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedBusiness} onValueChange={setSelectedBusiness}>
              <SelectTrigger>
                <SelectValue placeholder="Select business..." />
              </SelectTrigger>
              <SelectContent>
                {businesses.map((biz) => (
                  <SelectItem key={biz.id} value={biz.id}>
                    {biz.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Branch</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={!selectedBusiness}>
              <SelectTrigger>
                <SelectValue placeholder={selectedBusiness ? 'Select branch...' : 'Select business first'} />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      {/* Reports List */}
      {selectedBranch && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Reports ({reports.length})</h2>

          {reports.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>No reports found for this branch</AlertDescription>
            </Alert>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {reports.map((report) => (
                <Card key={report.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">{report.reportDate}</CardTitle>
                          <Badge
                            variant={
                              report.status === 'approved'
                                ? 'default'
                                : report.status === 'rejected'
                                  ? 'destructive'
                                  : 'secondary'
                            }
                          >
                            {report.status}
                          </Badge>
                        </div>
                        <CardDescription>
                          {report.productsSold} products sold • {report.openingStockItems?.length || 0} items tracked
                        </CardDescription>
                      </div>
                      <Clock className="w-5 h-5 text-gray-400 mt-1" />
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {/* Key Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="text-center">
                        <p className="text-xs text-gray-600">Opening Stock</p>
                        <p className="text-lg font-bold text-green-600">
                          K{report.openingStockValue.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-600">Sales Value</p>
                        <p className="text-lg font-bold text-blue-600">
                          K{report.salesValue.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-600">Gross Profit</p>
                        <p className="text-lg font-bold text-purple-600">
                          K{report.grossProfit.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-600">Accuracy</p>
                        <p className="text-lg font-bold text-orange-600">
                          {report.inventoryAccuracy.toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    {/* Issues */}
                    {(report.missingProducts?.length > 0 ||
                      report.outOfStockProducts?.length > 0 ||
                      report.lowStockProducts?.length > 0) && (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          {report.missingProducts?.length > 0 && (
                            <div className="flex items-center gap-2 text-sm text-red-600">
                              <AlertCircle className="w-4 h-4" />
                              <span>{report.missingProducts.length} products missing</span>
                            </div>
                          )}
                          {report.outOfStockProducts?.length > 0 && (
                            <div className="flex items-center gap-2 text-sm text-red-600">
                              <AlertCircle className="w-4 h-4" />
                              <span>{report.outOfStockProducts.length} items out of stock</span>
                            </div>
                          )}
                          {report.lowStockProducts?.length > 0 && (
                            <div className="flex items-center gap-2 text-sm text-orange-600">
                              <AlertCircle className="w-4 h-4" />
                              <span>{report.lowStockProducts.length} items low stock</span>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedReport(report);
                          setDetailsOpen(true);
                        }}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View Details
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadPDF(report)}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download PDF
                      </Button>

                      {report.status === 'pending_approval' && (
                        <>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => handleApprove(report)}
                            disabled={processing}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setSelectedReport(report);
                              setRejectionOpen(true);
                            }}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Reject
                          </Button>
                        </>
                      )}

                      {report.status === 'approved' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600"
                          disabled
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Approved
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedReport && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>Report Details - {selectedReport.reportDate}</DialogTitle>
                <DialogDescription>
                  Review complete report information before approval
                </DialogDescription>
              </DialogHeader>

              {/* Metrics */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-green-50 rounded">
                  <p className="text-xs text-gray-600">Opening Stock</p>
                  <p className="text-xl font-bold text-green-600">K{selectedReport.openingStockValue.toFixed(2)}</p>
                </div>
                <div className="p-3 bg-blue-50 rounded">
                  <p className="text-xs text-gray-600">Closing Stock</p>
                  <p className="text-xl font-bold text-blue-600">K{selectedReport.closingStockValue.toFixed(2)}</p>
                </div>
                <div className="p-3 bg-purple-50 rounded">
                  <p className="text-xs text-gray-600">Gross Profit</p>
                  <p className="text-xl font-bold text-purple-600">K{selectedReport.grossProfit.toFixed(2)}</p>
                </div>
                <div className="p-3 bg-orange-50 rounded">
                  <p className="text-xs text-gray-600">Accuracy</p>
                  <p className="text-xl font-bold text-orange-600">{selectedReport.inventoryAccuracy.toFixed(1)}%</p>
                </div>
              </div>

              {/* Top Selling Products */}
              {selectedReport.topSellingProducts && selectedReport.topSellingProducts.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Top Selling Products</h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {selectedReport.topSellingProducts.slice(0, 5).map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm p-2 bg-gray-50 rounded">
                        <span>{item.productName}</span>
                        <span className="font-medium">{item.quantity} units • K{item.totalValue.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {selectedReport.recommendations && selectedReport.recommendations.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Recommendations</h4>
                  <ul className="space-y-1 text-sm">
                    {selectedReport.recommendations.slice(0, 3).map((rec, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="text-green-600">•</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <DialogFooter className="flex gap-2">
                <Button variant="outline" onClick={() => setDetailsOpen(false)}>
                  Close
                </Button>
                {selectedReport.status === 'pending_approval' && (
                  <>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setRejectionOpen(true);
                      }}
                    >
                      Reject
                    </Button>
                    <Button
                      className="bg-green-600 hover:bg-green-700"
                      onClick={() => handleApprove(selectedReport)}
                      disabled={processing}
                    >
                      {processing ? 'Approving...' : 'Approve'}
                    </Button>
                  </>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Rejection Dialog */}
      <Dialog open={rejectionOpen} onOpenChange={setRejectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Report</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this report
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="reason">Rejection Reason</Label>
              <Textarea
                id="reason"
                placeholder="E.g., Data appears inconsistent, Missing required fields..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="mt-2"
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectionOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedReport && handleReject(selectedReport)}
              disabled={processing}
            >
              {processing ? 'Rejecting...' : 'Reject Report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
