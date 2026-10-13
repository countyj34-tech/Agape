import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useStore } from '@/contexts/StoreContext';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Download,
  Share2,
  FileText,
  Package,
  TrendingDown,
  Percent,
} from 'lucide-react';
import {
  dexieDb,
  getAllProducts,
  getSettings,
  createDailyInventoryAudit,
  updateDailyInventoryAudit,
  getAuditsByStoreAndDate,
  calculateAuditMetrics,
  canCompleteAudit,
} from '@/lib/db';
import type { Product, DailyInventoryAudit, DailyInventoryAuditItem, Settings } from '@/types/pos';
import { generateAuditPdfFile, shareAuditPdfToWhatsApp, downloadAuditPdf, preloadAuditPdfDeps } from '@/lib/dailyInventoryAuditPdf';
import { Link, useNavigate } from 'react-router-dom';

type WorkflowStep = 'business' | 'branch' | 'date' | 'opening' | 'closing' | 'report';

interface AuditFormState {
  companyId: string;
  storeId: string;
  storeName: string;
  auditDate: string;
  auditedBy: string;
  auditedByPhone: string;
  openingStockItems: DailyInventoryAuditItem[];
  closingStockItems: DailyInventoryAuditItem[];
  openingStockValue: number;
  closingStockValue: number;
}

const initialState: AuditFormState = {
  companyId: '',
  storeId: '',
  storeName: '',
  auditDate: new Date().toISOString().split('T')[0],
  auditedBy: '',
  auditedByPhone: '',
  openingStockItems: [],
  closingStockItems: [],
  openingStockValue: 0,
  closingStockValue: 0,
};

export default function DailyInventoryAuditPage() {
  const navigate = useNavigate();
  const { format: formatCurrency, currencySymbol } = useCurrencyFormatter();
  const { company, settings: authSettings } = useSupabaseAuth();
  const { currentStoreId, currentStore, stores } = useStore();
  const [settings, setSettings] = useState<Settings | null>(null);

  const [currentStep, setCurrentStep] = useState<WorkflowStep>('business');
  const [formState, setFormState] = useState<AuditFormState>({ ...initialState });
  const [products, setProducts] = useState<Product[]>([]);
  const [editingItem, setEditingItem] = useState<DailyInventoryAuditItem | null>(null);
  const [editingItemIndex, setEditingItemIndex] = useState<number>(-1);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [currentStockType, setCurrentStockType] = useState<'opening' | 'closing'>('opening');
  const [generatedAudit, setGeneratedAudit] = useState<DailyInventoryAudit | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // Preload PDF dependencies
  useEffect(() => {
    preloadAuditPdfDeps().catch(() => undefined);
  }, []);

  // Load settings
  useEffect(() => {
    (async () => {
      const s = await getSettings();
      setSettings(s ?? null);
    })();
  }, []);

  // Load products for current store
  useEffect(() => {
    (async () => {
      if (formState.storeId) {
        const prods = await getAllProducts(formState.storeId);
        setProducts(prods);
      }
    })();
  }, [formState.storeId]);

  // Auto-fill company and store from context
  useEffect(() => {
    if (company?.id && !formState.companyId) {
      setFormState((prev) => ({
        ...prev,
        companyId: company.id,
        auditedBy: authSettings?.userRole === 'owner' ? company.name : 'Staff Member',
      }));
    }
  }, [company, authSettings]);

  // Auto-fill store from context
  useEffect(() => {
    if (currentStoreId && !formState.storeId) {
      setFormState((prev) => ({
        ...prev,
        storeId: currentStoreId,
        storeName: currentStore?.name || 'Main Store',
      }));
      setCurrentStep('date');
    }
  }, [currentStoreId, currentStore]);

  const handleStoreSelect = (storeId: string) => {
    const selected = stores.find((s) => s.id === storeId);
    setFormState((prev) => ({
      ...prev,
      storeId,
      storeName: selected?.name || 'Store',
    }));
    setCurrentStep('date');
  };

  const handleDateChange = (date: string) => {
    setFormState((prev) => ({ ...prev, auditDate: date }));
  };

  const handleAddItem = () => {
    if (!editingItem || !editingItem.productId) {
      toast.error('Please select a product');
      return;
    }

    if (editingItem.quantity <= 0) {
      toast.error('Quantity must be greater than 0');
      return;
    }

    const items =
      currentStockType === 'opening'
        ? formState.openingStockItems
        : formState.closingStockItems;

    const existingIndex = items.findIndex((i) => i.productId === editingItem.productId);

    if (existingIndex >= 0) {
      // Update existing
      const updatedItems = [...items];
      updatedItems[existingIndex] = editingItem;

      if (currentStockType === 'opening') {
        const newValue = updatedItems.reduce((sum, i) => sum + i.totalValue, 0);
        setFormState((prev) => ({
          ...prev,
          openingStockItems: updatedItems,
          openingStockValue: newValue,
        }));
      } else {
        const newValue = updatedItems.reduce((sum, i) => sum + i.totalValue, 0);
        setFormState((prev) => ({
          ...prev,
          closingStockItems: updatedItems,
          closingStockValue: newValue,
        }));
      }
    } else {
      // Add new
      const updatedItems = [...items, editingItem];

      if (currentStockType === 'opening') {
        const newValue = updatedItems.reduce((sum, i) => sum + i.totalValue, 0);
        setFormState((prev) => ({
          ...prev,
          openingStockItems: updatedItems,
          openingStockValue: newValue,
        }));
      } else {
        const newValue = updatedItems.reduce((sum, i) => sum + i.totalValue, 0);
        setFormState((prev) => ({
          ...prev,
          closingStockItems: updatedItems,
          closingStockValue: newValue,
        }));
      }
    }

    setEditingItem(null);
    setEditingItemIndex(-1);
    setIsAddingItem(false);
  };

  const handleRemoveItem = (index: number, type: 'opening' | 'closing') => {
    if (type === 'opening') {
      const updated = formState.openingStockItems.filter((_, i) => i !== index);
      const newValue = updated.reduce((sum, i) => sum + i.totalValue, 0);
      setFormState((prev) => ({
        ...prev,
        openingStockItems: updated,
        openingStockValue: newValue,
      }));
    } else {
      const updated = formState.closingStockItems.filter((_, i) => i !== index);
      const newValue = updated.reduce((sum, i) => sum + i.totalValue, 0);
      setFormState((prev) => ({
        ...prev,
        closingStockItems: updated,
        closingStockValue: newValue,
      }));
    }
  };

  const handleGenerateReport = async () => {
    if (!canCompleteAudit(formState)) {
      toast.error('Please enter both opening and closing stock');
      return;
    }

    const metrics = calculateAuditMetrics(
      formState.openingStockItems,
      formState.closingStockItems,
      formState.openingStockValue,
      formState.closingStockValue
    );

    const audit: DailyInventoryAudit = {
      id: crypto.randomUUID(),
      companyId: formState.companyId,
      storeId: formState.storeId,
      storeName: formState.storeName,
      auditDate: formState.auditDate,
      auditedBy: formState.auditedBy,
      auditedByPhone: formState.auditedByPhone,
      openingStockItems: formState.openingStockItems,
      closingStockItems: formState.closingStockItems,
      openingStockValue: formState.openingStockValue,
      closingStockValue: formState.closingStockValue,
      status: 'completed',
      ...metrics,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await createDailyInventoryAudit(audit);
      setGeneratedAudit(audit);
      setCurrentStep('report');
      toast.success('Audit report generated successfully!');
    } catch (error) {
      toast.error('Failed to generate audit report');
      console.error(error);
    }
  };

  const handleDownloadPdf = async () => {
    if (!generatedAudit || !settings) return;

    setIsGeneratingPdf(true);
    try {
      await downloadAuditPdf({
        audit: generatedAudit,
        settings,
      });
      toast.success('PDF downloaded successfully');
    } catch (error) {
      toast.error('Failed to download PDF');
      console.error(error);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleShareWhatsApp = async () => {
    if (!generatedAudit || !settings) return;

    setIsSharing(true);
    try {
      const result = await shareAuditPdfToWhatsApp({
        audit: generatedAudit,
        settings,
      });

      if (result.shared) {
        toast.success('Report shared to WhatsApp!');
        // Update audit with shared flag
        setGeneratedAudit((prev) =>
          prev
            ? {
                ...prev,
                sharedViaWhatsApp: true,
                sharedAt: new Date(),
              }
            : null
        );
      } else if (result.reason === 'cancelled') {
        toast.info('Share cancelled');
      } else {
        toast.info('Fallback method: PDF downloaded and WhatsApp opened');
      }
    } catch (error) {
      toast.error('Failed to share via WhatsApp');
      console.error(error);
    } finally {
      setIsSharing(false);
    }
  };

  const handleReset = () => {
    setFormState({ ...initialState });
    setCurrentStep('business');
    setGeneratedAudit(null);
    setEditingItem(null);
  };

  // Render different steps
  if (currentStep === 'business') {
    return (
      <AppShell>
        <div className="space-y-6 p-4">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-green-600">Daily Inventory Audit</h1>
            <p className="text-gray-600 mt-2">Professional inventory audits with automated reporting</p>
          </div>

          <Card className="border-2 border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-green-600" />
                Step 1: Select Business
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label>Business Name</Label>
                  <div className="p-3 bg-white border rounded mt-2">{company?.name || 'Select a business'}</div>
                </div>
                {company?.id && (
                  <Button
                    onClick={() => setCurrentStep('branch')}
                    className="w-full bg-green-600 hover:bg-green-700"
                  >
                    Proceed to Branch Selection →
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (currentStep === 'branch') {
    return (
      <AppShell>
        <div className="space-y-6 p-4">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-green-600">Daily Inventory Audit</h1>
            <p className="text-gray-600 mt-2">Step 2: Select Branch</p>
          </div>

          <Card className="border-2 border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-green-600" />
                Select Your Branch
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stores.map((store) => (
                  <Button
                    key={store.id}
                    onClick={() => handleStoreSelect(store.id)}
                    variant="outline"
                    className="w-full justify-start h-auto py-3 border-gray-300 hover:border-green-600 hover:bg-green-50"
                  >
                    <div className="text-left">
                      <p className="font-semibold">{store.name}</p>
                      {store.location_name && <p className="text-sm text-gray-600">{store.location_name}</p>}
                    </div>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (currentStep === 'date') {
    return (
      <AppShell>
        <div className="space-y-6 p-4">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-green-600">Daily Inventory Audit</h1>
            <p className="text-gray-600 mt-2">Step 3: Select Date</p>
          </div>

          <Card className="border-2 border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-green-600" />
                Audit Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="store-display">Branch</Label>
                <div className="p-3 bg-white border rounded mt-2 font-semibold">{formState.storeName}</div>
              </div>

              <div>
                <Label htmlFor="audit-date">Audit Date</Label>
                <Input
                  id="audit-date"
                  type="date"
                  value={formState.auditDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="audited-by">Audited By</Label>
                <Input
                  id="audited-by"
                  value={formState.auditedBy}
                  onChange={(e) => setFormState((prev) => ({ ...prev, auditedBy: e.target.value }))}
                  placeholder="Your name"
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="audited-phone">Phone Number (optional)</Label>
                <Input
                  id="audited-phone"
                  value={formState.auditedByPhone}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, auditedByPhone: e.target.value }))
                  }
                  placeholder="Your phone number"
                  className="mt-2"
                />
              </div>

              <Button
                onClick={() => setCurrentStep('opening')}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                Continue to Opening Stock →
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (currentStep === 'opening' || currentStep === 'closing') {
    const isOpeningStep = currentStep === 'opening';
    const items = isOpeningStep
      ? formState.openingStockItems
      : formState.closingStockItems;
    const stockValue = isOpeningStep
      ? formState.openingStockValue
      : formState.closingStockValue;
    const stepTitle = isOpeningStep ? 'Opening Stock' : 'Closing Stock';
    const stepNumber = isOpeningStep ? 4 : 5;

    return (
      <AppShell>
        <div className="space-y-6 p-4">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-green-600">Daily Inventory Audit</h1>
            <p className="text-gray-600 mt-2">Step {stepNumber}: Enter {stepTitle}</p>
          </div>

          <Card className="border-2 border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-green-600" />
                  {stepTitle}
                </span>
                <Badge variant="outline">{currencySymbol}{formatCurrency(stockValue)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Items List */}
              {items.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Products Added</Label>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {items.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg"
                      >
                        <div className="flex-1">
                          <p className="font-semibold text-sm">{item.productName}</p>
                          <p className="text-xs text-gray-600">
                            {item.quantity} × {currencySymbol}{formatCurrency(item.unitPrice)} = {currencySymbol}
                            {formatCurrency(item.totalValue)}
                          </p>
                        </div>
                        <Button
                          onClick={() => handleRemoveItem(index, isOpeningStep ? 'opening' : 'closing')}
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator className="my-4" />

              {/* Add Item Form */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Add Product</Label>

                <div>
                  <Label htmlFor="product-select" className="text-xs">
                    Product
                  </Label>
                  <Select
                    value={editingItem?.productId || ''}
                    onValueChange={(productId) => {
                      const product = products.find((p) => p.id === productId);
                      if (product) {
                        setEditingItem({
                          productId: product.id,
                          productName: product.name,
                          quantity: 1,
                          unitPrice: product.sellingPrice,
                          totalValue: product.sellingPrice,
                        });
                      }
                    }}
                  >
                    <SelectTrigger id="product-select">
                      <SelectValue placeholder="Select a product..." />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {editingItem && (
                  <>
                    <div>
                      <Label htmlFor="quantity" className="text-xs">
                        Quantity
                      </Label>
                      <Input
                        id="quantity"
                        type="number"
                        min="1"
                        value={editingItem.quantity}
                        onChange={(e) => {
                          const qty = parseInt(e.target.value) || 0;
                          setEditingItem((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  quantity: qty,
                                  totalValue: qty * prev.unitPrice,
                                }
                              : null
                          );
                        }}
                        className="mt-1"
                      />
                    </div>

                    <Button
                      onClick={handleAddItem}
                      className="w-full bg-green-600 hover:bg-green-700"
                      size="sm"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add to {stepTitle}
                    </Button>
                  </>
                )}
              </div>

              <Separator className="my-4" />

              {/* Navigation */}
              <div className="flex gap-2">
                <Button
                  onClick={() => setCurrentStep(isOpeningStep ? 'date' : 'opening')}
                  variant="outline"
                  className="flex-1"
                >
                  ← Back
                </Button>
                <Button
                  onClick={() => setCurrentStep(isOpeningStep ? 'closing' : 'report')}
                  disabled={items.length === 0}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  {isOpeningStep ? 'Closing Stock →' : 'Generate Report →'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (currentStep === 'report' && generatedAudit) {
    const reportMetrics = [
      {
        label: 'Opening Stock Value',
        value: `${currencySymbol}${formatCurrency(generatedAudit.openingStockValue)}`,
        icon: <Package className="w-5 h-5" />,
      },
      {
        label: 'Closing Stock Value',
        value: `${currencySymbol}${formatCurrency(generatedAudit.closingStockValue)}`,
        icon: <Package className="w-5 h-5" />,
      },
      {
        label: 'Sales Value',
        value: `${currencySymbol}${formatCurrency(generatedAudit.salesValue)}`,
        icon: <TrendingDown className="w-5 h-5" />,
      },
      {
        label: 'Gross Profit',
        value: `${currencySymbol}${formatCurrency(generatedAudit.grossProfit)}`,
        icon: <CheckCircle className="w-5 h-5 text-green-600" />,
      },
      {
        label: 'Products Sold',
        value: generatedAudit.productsSold.toString(),
        icon: <FileText className="w-5 h-5" />,
      },
      {
        label: 'Inventory Accuracy',
        value: `${generatedAudit.inventoryAccuracy.toFixed(1)}%`,
        icon: <Percent className="w-5 h-5" />,
      },
    ];

    return (
      <AppShell>
        <div className="space-y-6 p-4">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-green-600">Daily Inventory Audit Report</h1>
            <p className="text-gray-600 mt-2">Professional retail summary</p>
          </div>

          {/* Status Card */}
          <Card className="border-2 border-green-200 bg-green-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-center gap-2">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <span className="text-xl font-semibold text-green-700">✅ Inventory Completed</span>
              </div>
            </CardContent>
          </Card>

          {/* Key Information */}
          <Card className="border border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg">Audit Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Business</p>
                  <p className="font-semibold">{company?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Branch</p>
                  <p className="font-semibold">{generatedAudit.storeName}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Date</p>
                  <p className="font-semibold">{generatedAudit.auditDate}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Audited By</p>
                  <p className="font-semibold">{generatedAudit.auditedBy}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Separator className="my-4" />

          {/* Report Metrics - Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reportMetrics.map((metric, index) => (
              <Card key={index} className="border border-gray-200 hover:shadow-lg transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm text-gray-600 font-medium">{metric.label}</p>
                      <p className="text-2xl font-bold text-gray-900 mt-2">{metric.value}</p>
                    </div>
                    <div className="text-gray-400">{metric.icon}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Separator className="my-4" />

          {/* Discrepancies */}
          {(generatedAudit.missingProducts.length > 0 ||
            generatedAudit.extraProducts.length > 0 ||
            generatedAudit.outOfStockProducts.length > 0) && (
            <>
              <Card className="border border-orange-200 bg-orange-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-700">
                    <AlertCircle className="w-5 h-5" />
                    Inventory Discrepancies
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {generatedAudit.missingProducts.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-orange-900">
                        Missing Products ({generatedAudit.missingProducts.length})
                      </p>
                      <p className="text-xs text-orange-700 mt-1">
                        {generatedAudit.missingProducts.slice(0, 3).join(', ')}
                        {generatedAudit.missingProducts.length > 3 && ` ...and ${generatedAudit.missingProducts.length - 3} more`}
                      </p>
                    </div>
                  )}

                  {generatedAudit.extraProducts.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-orange-900">
                        Extra Products ({generatedAudit.extraProducts.length})
                      </p>
                      <p className="text-xs text-orange-700 mt-1">
                        {generatedAudit.extraProducts.slice(0, 3).join(', ')}
                        {generatedAudit.extraProducts.length > 3 && ` ...and ${generatedAudit.extraProducts.length - 3} more`}
                      </p>
                    </div>
                  )}

                  {generatedAudit.outOfStockProducts.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-orange-900">
                        Out of Stock ({generatedAudit.outOfStockProducts.length})
                      </p>
                      <p className="text-xs text-orange-700 mt-1">
                        {generatedAudit.outOfStockProducts.slice(0, 3).join(', ')}
                        {generatedAudit.outOfStockProducts.length > 3 && ` ...and ${generatedAudit.outOfStockProducts.length - 3} more`}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          <Separator className="my-4" />

          {/* Footer */}
          <Card className="border border-gray-200 bg-gray-50">
            <CardContent className="pt-6">
              <p className="text-sm text-gray-600 text-center mb-4">Prepared by: Mthunzi POS</p>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Button
              onClick={handleDownloadPdf}
              disabled={isGeneratingPdf}
              className="bg-blue-600 hover:bg-blue-700"
              size="lg"
            >
              <Download className="w-4 h-4 mr-2" />
              {isGeneratingPdf ? 'Generating...' : '📄 Generate PDF'}
            </Button>

            <Button
              onClick={handleShareWhatsApp}
              disabled={isSharing}
              className="bg-green-600 hover:bg-green-700"
              size="lg"
            >
              <Share2 className="w-4 h-4 mr-2" />
              {isSharing ? 'Sharing...' : '📲 Share via WhatsApp'}
            </Button>
          </div>

          {/* Reset Button */}
          <Button
            onClick={handleReset}
            variant="outline"
            className="w-full"
          >
            Start New Audit
          </Button>
        </div>
      </AppShell>
    );
  }

  return null;
}
