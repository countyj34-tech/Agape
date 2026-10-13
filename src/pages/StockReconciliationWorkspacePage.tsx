import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import {
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Download,
  FileImage,
  Loader2,
  MessageCircle,
  Play,
  Send,
  Workflow,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { SuperAdminGate } from '@/components/admin/SuperAdminGate';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { getCompanyById, fetchStoresFromSupabase } from '@/lib/companyManagement';
import { getCompanyStores } from '@/lib/storeManagement';
import {
  ensureMasterCloudSession,
  fetchRemoteCompaniesCatalog,
  pullRemoteProductsForStore,
  syncReconciliationSessionToSupabase,
} from '@/lib/stockReconciliationRemote';
import {
  createStockReconciliationSession,
  dexieDb,
  updateStockReconciliationSession,
} from '@/lib/db';
import { extractStockSheetsFromImages } from '@/lib/stockReconciliationOcr';
import { cleanOcrProductName } from '@/lib/stockReconciliationClean';
import { uploadReconciliationImages } from '@/lib/stockReconciliationUpload';
import { STOCK_FILE_ACCEPT } from '@/lib/stockReconciliationFileParse';
import {
  buildExtractionPreview,
  buildReconciliationLineItems,
  recalculateLineItem,
  summarizeReconciliationSession,
} from '@/lib/stockReconciliationCalculations';
import { applyStockReconciliationApproval } from '@/lib/stockReconciliationApproval';
import {
  downloadStockExtractionPreviewPdf,
  downloadStockReconciliationPdf,
  preloadStockReconciliationPdfDeps,
  shareStockReconciliationPdfToWhatsApp,
} from '@/lib/stockReconciliationReportPdf';
import {
  getFreeAiStatus,
  runPostApprovalPipeline,
  type DailyPipelineStep,
  type FreeAiStatus,
} from '@/lib/stockReconciliationPipeline';
import type {
  Company,
  Product,
  StockReconciliationLineItem,
  StockReconciliationOcrRow,
  StockReconciliationSession,
  Store,
} from '@/types/pos';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function filesFromInput(fileList: FileList | null): File[] {
  if (!fileList || fileList.length === 0) return [];
  return Array.from(fileList);
}

type UploadMode = 'separate' | 'combined';

export default function StockReconciliationWorkspacePage() {
  const { companyId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const preferredStoreId = searchParams.get('storeId') || '';
  const { settings, profile, user } = useSupabaseAuth();
  const { format: formatCurrency } = useCurrencyFormatter();

  const [company, setCompany] = useState<Company | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeProductCounts, setStoreProductCounts] = useState<Record<string, number>>({});
  const [storeId, setStoreId] = useState('');
  const [reportDate, setReportDate] = useState(todayKey());
  const [uploadMode, setUploadMode] = useState<UploadMode>('separate');
  const [openingFiles, setOpeningFiles] = useState<File[]>([]);
  const [closingFiles, setClosingFiles] = useState<File[]>([]);
  const [refillFiles, setRefillFiles] = useState<File[]>([]);
  const [combinedFiles, setCombinedFiles] = useState<File[]>([]);
  const [session, setSession] = useState<StockReconciliationSession | null>(null);
  const [processing, setProcessing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [progress, setProgress] = useState('');
  const [loading, setLoading] = useState(true);
  const [pullingProducts, setPullingProducts] = useState(false);
  const [productSource, setProductSource] = useState<'cloud' | 'local' | 'merged' | 'all-local' | null>(null);
  const [cloudProductCount, setCloudProductCount] = useState(0);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [matchCatalog, setMatchCatalog] = useState<Product[]>([]);
  const [freeAiStatus, setFreeAiStatus] = useState<FreeAiStatus | null>(null);
  const [pipelineStep, setPipelineStep] = useState<DailyPipelineStep | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);

  const selectedStore = stores.find((store) => store.id === storeId);
  const masterName = profile?.full_name || user?.email || settings?.shopName || 'Master User';

  const products = useLiveQuery(
    async () => {
      const all = await dexieDb.products.toArray();
      if (!storeId) return all;
      return all.filter((p) => p.storeId === storeId);
    },
    [storeId]
  );

  const allLocalProducts = useLiveQuery(async () => dexieDb.products.toArray(), []);
  const resolvedProducts = matchCatalog.length > 0 ? matchCatalog : products ?? [];
  const totalLocalProducts = allLocalProducts?.length ?? 0;
  const selectedStoreProductCount = storeId ? storeProductCounts[storeId] || 0 : 0;

  useEffect(() => {
    preloadStockReconciliationPdfDeps().catch(() => undefined);
    getFreeAiStatus().then(setFreeAiStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Prefer live remote catalog — this module is for remote client stores
        const session = await ensureMasterCloudSession();
        if (!cancelled) {
          setCloudConnected(session.ok);
          if (!session.ok) setCloudError(session.error || 'Cloud session failed');
        }

        let companyData: Company | null = null;
        let storeData: Store[] = [];
        const counts: Record<string, number> = {};

        if (session.ok && companyId && companyId !== 'local') {
          const catalog = await fetchRemoteCompaniesCatalog();
          if (!cancelled) {
            setCloudConnected(catalog.cloudConnected);
            if (catalog.error) setCloudError(catalog.error);
          }
          const remoteCompany = catalog.companies.find((c) => c.id === companyId);
          if (remoteCompany) {
            companyData = remoteCompany;
            storeData = remoteCompany.stores;
            for (const store of remoteCompany.stores) {
              counts[store.id] = store.productCount;
            }
          }
        }

        if (!companyData && companyId && companyId !== 'local') {
          companyData = (await getCompanyById(companyId)) || null;
        }

        if (!storeData.length && companyData) {
          storeData = await getCompanyStores(companyId);
          if (!storeData.length) {
            try {
              storeData = await fetchStoresFromSupabase(companyId);
            } catch {
              // offline
            }
          }
        }

        // Merge any local stores as fallback
        const [allStores, allProducts] = await Promise.all([
          dexieDb.stores.toArray(),
          dexieDb.products.toArray(),
        ]);
        for (const product of allProducts) {
          if (!product.storeId) continue;
          if (!counts[product.storeId]) {
            counts[product.storeId] = (counts[product.storeId] || 0) + 1;
          }
        }

        const merged = new Map<string, Store>();
        for (const s of storeData) merged.set(s.id, s);
        for (const s of allStores) {
          if (s.companyId === companyId || preferredStoreId === s.id) {
            merged.set(s.id, s);
          }
        }
        storeData = Array.from(merged.values()).sort(
          (a, b) => (counts[b.id] || 0) - (counts[a.id] || 0)
        );

        if (!companyData && storeData.length > 0) {
          const fromStore = storeData[0].companyId
            ? await getCompanyById(storeData[0].companyId)
            : null;
          companyData =
            fromStore ||
            ({
              id: storeData[0].companyId || 'local',
              name: storeData[0].name || 'Remote Store',
              currency: 'ZMW',
              currencySymbol: 'K',
              taxRate: 0,
              receiptFooter: '',
              thermalPrinterWidth: '58mm',
              adminPin: null,
              pinSetupComplete: true,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as Company);
        }

        if (cancelled) return;
        setCompany(companyData);
        setStores(storeData);
        setStoreProductCounts(counts);

        const preferred =
          (preferredStoreId && storeData.find((s) => s.id === preferredStoreId)) ||
          storeData.find((s) => (counts[s.id] || 0) > 0) ||
          storeData[0];
        if (preferred) setStoreId(preferred.id);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId, preferredStoreId]);

  async function loadProductCatalog(targetStoreId: string) {
    setPullingProducts(true);
    setCloudError(null);
    try {
      const remote = await pullRemoteProductsForStore(
        targetStoreId,
        companyId === 'local' ? undefined : companyId
      );
      setCloudConnected(!remote.cloudError || remote.cloudCount > 0);
      if (remote.cloudError) setCloudError(remote.cloudError);

      const localAll = await dexieDb.products.toArray();
      const storeLocal = localAll.filter((p) => p.storeId === targetStoreId);

      let catalog: Product[] = [];
      let source: typeof productSource = 'local';

      if (remote.cloudCount > 0) {
        catalog = remote.products;
        source = 'cloud';
        setCloudProductCount(remote.cloudCount);
        setStoreProductCounts((prev) => ({ ...prev, [targetStoreId]: remote.cloudCount }));
      } else if (storeLocal.length > 0) {
        catalog = storeLocal;
        source = 'local';
        setCloudProductCount(0);
      } else if (localAll.length > 0) {
        catalog = localAll;
        source = 'all-local';
        setCloudProductCount(0);
      } else {
        catalog = [];
        source = 'local';
        setCloudProductCount(0);
      }

      setMatchCatalog(catalog);
      setProductSource(source);
      return catalog;
    } finally {
      setPullingProducts(false);
    }
  }

  useEffect(() => {
    if (!storeId) return;
    loadProductCatalog(storeId).catch(() => undefined);
  }, [storeId, companyId]);

  const canExtract = Boolean(
    company &&
      storeId &&
      !processing &&
      (!session || session.status === 'draft' || session.status === 'extracted') &&
      session?.status !== 'approved' &&
      (uploadMode === 'combined'
        ? combinedFiles.length > 0
        : openingFiles.length > 0 && closingFiles.length > 0)
  );

  const canMatch = Boolean(
    session &&
      session.status === 'extracted' &&
      (session.extractionPreview?.length ?? 0) > 0 &&
      !processing
  );

  const canApprove = Boolean(
    session && session.status === 'review' && session.lineItems.length > 0 && !approving
  );

  const showSummary = session && (session.status === 'review' || session.status === 'approved');

  const summaryCards = useMemo(() => {
    if (!session) return [];
    return [
      { label: "Today's Revenue", value: formatCurrency(session.revenue) },
      { label: 'Products Sold', value: String(session.productsSold) },
      { label: 'Units Sold', value: String(session.quantitySold) },
      { label: 'Estimated Profit', value: formatCurrency(session.estimatedProfit) },
      { label: 'Low Stock Items', value: String(session.lowStockItems.length) },
      { label: 'Unmatched Items', value: String(session.unmatchedItems.length) },
    ];
  }, [session, formatCurrency]);

  function removeFile(list: File[], setter: (files: File[]) => void, index: number) {
    setter(list.filter((_, i) => i !== index));
  }

  async function handleExtract(): Promise<StockReconciliationSession | null> {
    if (!company || !selectedStore) {
      toast.error('Select a store first.');
      return null;
    }
    if (uploadMode === 'combined' && combinedFiles.length === 0) {
      toast.error('Upload at least one combined stock sheet image.');
      return null;
    }
    if (uploadMode === 'separate' && (openingFiles.length === 0 || closingFiles.length === 0)) {
      toast.error('Upload opening and closing stock images (multiple allowed).');
      return null;
    }

    setProcessing(true);
    setProgress('Saving images...');

    try {
      const uploadStartedAt = new Date();
      const images = await uploadReconciliationImages(
        uploadMode === 'combined'
          ? { combined: combinedFiles }
          : {
              opening: openingFiles,
              closing: closingFiles,
              refill: refillFiles,
            }
      );

      const processingStartedAt = new Date();
      let openingRows: StockReconciliationOcrRow[] = [];
      let closingRows: StockReconciliationOcrRow[] = [];
      let refillRows: StockReconciliationOcrRow[] = [];
      let combinedRows: StockReconciliationOcrRow[] = [];
      let rawOcrCount = 0;
      let keptOcrCount = 0;
      let extractionMethod = 'unknown';
      let extractionWarning: string | undefined;

      if (uploadMode === 'combined') {
        setProgress('AI reading combined stock sheets...');
        const combinedResult = await extractStockSheetsFromImages(combinedFiles, {
          sheetType: 'combined',
          onProgress: (u) => setProgress(u.status),
        });
        combinedRows = combinedResult.rows;
        rawOcrCount += combinedResult.rawCount ?? combinedRows.length;
        keptOcrCount += combinedResult.keptCount ?? combinedRows.length;
        extractionMethod = combinedResult.method;
        if (combinedResult.warning) extractionWarning = combinedResult.warning;
        openingRows = combinedRows.map((r) => ({
          rawName: r.rawName,
          quantity: r.opening ?? r.quantity,
          unitPrice: r.unitPrice,
        }));
        closingRows = combinedRows.map((r) => ({
          rawName: r.rawName,
          quantity: r.closing ?? 0,
          unitPrice: r.unitPrice,
        }));
        refillRows = combinedRows
          .filter((r) => (r.refill ?? 0) > 0)
          .map((r) => ({
            rawName: r.rawName,
            quantity: r.refill ?? 0,
            unitPrice: r.unitPrice,
          }));
      } else {
        setProgress(`AI reading opening stock (${openingFiles.length} image(s))...`);
        const openingResult = await extractStockSheetsFromImages(openingFiles, {
          sheetType: 'opening',
          onProgress: (u) => setProgress(u.status),
        });
        openingRows = openingResult.rows;
        rawOcrCount += openingResult.rawCount ?? openingRows.length;
        keptOcrCount += openingResult.keptCount ?? openingRows.length;
        extractionMethod = openingResult.method;
        if (openingResult.warning) extractionWarning = openingResult.warning;

        setProgress(`AI reading closing stock (${closingFiles.length} image(s))...`);
        const closingResult = await extractStockSheetsFromImages(closingFiles, {
          sheetType: 'closing',
          onProgress: (u) => setProgress(u.status),
        });
        closingRows = closingResult.rows;
        rawOcrCount += closingResult.rawCount ?? closingRows.length;
        keptOcrCount += closingResult.keptCount ?? closingRows.length;
        extractionMethod = closingResult.method;
        if (closingResult.warning) extractionWarning = closingResult.warning;

        if (refillFiles.length > 0) {
          setProgress(`AI reading refill stock (${refillFiles.length} image(s))...`);
          const refillResult = await extractStockSheetsFromImages(refillFiles, {
            sheetType: 'refill',
            onProgress: (u) => setProgress(u.status),
          });
          refillRows = refillResult.rows;
          rawOcrCount += refillResult.rawCount ?? refillRows.length;
          keptOcrCount += refillResult.keptCount ?? refillRows.length;
          extractionMethod = refillResult.method;
          if (refillResult.warning) extractionWarning = refillResult.warning;
        }
      }

      const methodLabel =
        extractionMethod === 'excel'
          ? 'Excel'
          : extractionMethod === 'csv'
            ? 'CSV'
            : extractionMethod === 'pdf-text'
              ? 'PDF'
              : extractionMethod === 'python-easyocr'
                ? 'Python EasyOCR'
                : extractionMethod === 'tesseract-stock-sheet'
                  ? 'Browser OCR'
                  : 'Extract';

      setProgress('Building extraction preview...');
      const extractionPreview = buildExtractionPreview({
        openingRows,
        closingRows,
        refillRows,
        combinedRows: uploadMode === 'combined' ? combinedRows : undefined,
      });

      if (extractionPreview.length === 0) {
        toast.error(
          'OCR found no usable product rows. Try clearer photos or Combined Sheet mode.'
        );
      }

      const baseSession: StockReconciliationSession = {
        id: session?.id ?? crypto.randomUUID(),
        companyId: company.id,
        companyName: company.name,
        storeId: selectedStore.id,
        storeName: selectedStore.name,
        reportDate,
        images,
        ocrResults: {
          opening: openingRows,
          closing: closingRows,
          refill: refillRows,
        },
        extractionPreview,
        lineItems: [],
        openingStockSummary: { itemCount: 0, totalValue: 0 },
        closingStockSummary: { itemCount: 0, totalValue: 0 },
        refillSummary: { itemCount: 0, totalQuantity: 0 },
        productsSold: 0,
        quantitySold: 0,
        revenue: 0,
        estimatedProfit: 0,
        lowStockItems: [],
        unmatchedItems: [],
        dataErrors: [],
        status: 'extracted',
        uploadStartedAt,
        processingStartedAt,
        processingCompletedAt: new Date(),
        processingDurationMs: Date.now() - processingStartedAt.getTime(),
        preparedBy: masterName,
        createdAt: session?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };

      // Keep results on screen even if browser storage fails (DataError / quota)
      setSession(baseSession);
      try {
        if (session) {
          await updateStockReconciliationSession(baseSession);
        } else {
          await createStockReconciliationSession(baseSession);
        }
      } catch (storageError) {
        console.error(storageError);
        toast.warning(
          storageError instanceof Error
            ? storageError.message
            : 'Could not save session locally. You can still review and Match on this screen.'
        );
      }
      syncReconciliationSessionToSupabase(baseSession).catch(() => undefined);

      if (extractionPreview.length > 0) {
        try {
          await downloadStockExtractionPreviewPdf({ session: baseSession, settings });
        } catch (pdfError) {
          console.warn('Extraction PDF skipped', pdfError);
          toast.warning('Extraction PDF could not download, but product rows are ready to review.');
        }
      }

      const filtered = rawOcrCount - keptOcrCount;
      if (extractionWarning) {
        toast.warning(extractionWarning);
      }
      if (extractionPreview.length > 0) {
        toast.success(
          `${methodLabel}: extracted ${extractionPreview.length} products${filtered > 0 ? ` (${filtered} noisy rows removed)` : ''}. Review the PDF, then Match Products.`
        );
      } else {
        toast.error(
          extractionWarning ||
            'Extraction finished but no rows passed quality checks. Check image quality or try again in a few minutes.'
        );
      }
      return baseSession;
    } catch (error) {
      console.error(error);
      const message =
        error instanceof DOMException
          ? `Browser error (${error.name}). Try Excel/CSV instead of large images, or clear site data for this app.`
          : error instanceof Error
            ? error.message
            : 'Extraction failed';
      toast.error(message);
      return null;
    } finally {
      setProcessing(false);
      setProgress('');
    }
  }

  async function handleMatch(
    sourceSession?: StockReconciliationSession
  ): Promise<StockReconciliationSession | null> {
    const workingSession = sourceSession ?? session;
    if (!workingSession?.extractionPreview?.length || !selectedStore) {
      toast.error('Extract stock data from images first.');
      return null;
    }

    setProcessing(true);
    setProgress('Loading product catalog for matching...');

    try {
      const storeProducts = await loadProductCatalog(selectedStore.id);
      const lineItems = buildReconciliationLineItems({
        openingRows: workingSession.ocrResults?.opening ?? [],
        closingRows: workingSession.ocrResults?.closing ?? [],
        refillRows: workingSession.ocrResults?.refill ?? [],
        products: storeProducts,
        previewRows: workingSession.extractionPreview,
      });

      const baseSession: StockReconciliationSession = {
        ...workingSession,
        lineItems,
        status: 'review',
        updatedAt: new Date(),
      };
      const summary = summarizeReconciliationSession(baseSession, storeProducts);
      const fullSession = { ...baseSession, ...summary };
      await updateStockReconciliationSession(fullSession);
      setSession(fullSession);
      syncReconciliationSessionToSupabase(fullSession).catch(() => undefined);

      const unmatched = fullSession.unmatchedItems.length;
      toast.success(
        `Matched ${lineItems.length - unmatched} of ${lineItems.length} products. Review before approval.`
      );
      return fullSession;
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Matching failed');
      return null;
    } finally {
      setProcessing(false);
      setProgress('');
    }
  }

  function updateExtractionRow(index: number, patch: Partial<StockReconciliationOcrRow>) {
    if (!session?.extractionPreview) return;
    const nextPreview = session.extractionPreview.map((row, i) =>
      i === index ? { ...row, ...patch } : row
    );
    const updated = { ...session, extractionPreview: nextPreview, updatedAt: new Date() };
    setSession(updated);
    updateStockReconciliationSession(updated).catch(() => undefined);
  }

  function updateLineItem(itemId: string, patch: Partial<StockReconciliationLineItem>) {
    if (!session) return;
    const nextItems = session.lineItems.map((item) => {
      if (item.id !== itemId) return item;
      return recalculateLineItem({ ...item, ...patch }, resolvedProducts);
    });
    const nextSession = summarizeReconciliationSession(
      { ...session, lineItems: nextItems },
      resolvedProducts
    );
    const updated = { ...session, ...nextSession, lineItems: nextItems, updatedAt: new Date() };
    setSession(updated);
    updateStockReconciliationSession(updated).catch(() => undefined);
  }

  async function handleApprove(createMissingProducts = false) {
    if (!session) return null;
    setApproving(true);
    try {
      const result = await applyStockReconciliationApproval({
        session,
        approvedBy: masterName,
        products: resolvedProducts,
        createMissingProducts,
      });
      setSession(result.session);
      const createdMsg =
        result.productsCreated && result.productsCreated > 0
          ? ` Created ${result.productsCreated} new product(s) in Supabase.`
          : '';
      toast.success(
        `Approved. Dashboard updated — sales recorded, stock set to closing counts.${createdMsg}`
      );
      return result.session;
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Approval failed');
      return null;
    } finally {
      setApproving(false);
    }
  }

  async function handleApproveAndSendDaily() {
    if (!session || session.status !== 'review') {
      toast.error('Match products and review data before sending the daily report.');
      return;
    }
    setPipelineRunning(true);
    try {
      setPipelineStep('approve');
      const approved = await handleApprove(true);
      if (!approved) return;

      const result = await runPostApprovalPipeline({
        session: approved,
        settings,
        company,
        onProgress: (step, message) => {
          setPipelineStep(step);
          setProgress(message);
        },
      });

      setSession(result.session);
      const sourceLabel = 'local report';
      toast.success(`Daily report (${sourceLabel}) sent. Dashboard updated in Supabase.`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Daily pipeline failed');
    } finally {
      setPipelineRunning(false);
      setPipelineStep(null);
      setProgress('');
    }
  }

  async function handleRunDailyPipeline() {
    if (!company || !selectedStore) {
      toast.error('Select a store first.');
      return;
    }
    setPipelineRunning(true);
    try {
      setPipelineStep('extract');
      let current = session;
      if (!current?.extractionPreview?.length || current.status === 'draft') {
        current = await handleExtract();
      }
      if (!current?.extractionPreview?.length) return;

      setPipelineStep('match');
      if (current.status === 'extracted') {
        current = (await handleMatch(current)) ?? current;
      }
      if (!current || current.status !== 'review') return;

      if (current.unmatchedItems.length > 0) {
        toast.info(
          `${current.unmatchedItems.length} unmatched product(s). Fix names in the table, or use Approve & Send to auto-create them in Supabase.`
        );
        setPipelineStep('review');
        return;
      }

      setPipelineStep('approve');
      await handleApproveAndSendDaily();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Daily pipeline failed');
    } finally {
      setPipelineRunning(false);
      if (pipelineStep !== 'review') setPipelineStep(null);
    }
  }

  function renderFilePicker(
    label: string,
    files: File[],
    setter: (files: File[]) => void,
    required?: boolean
  ) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <Label className="mb-2 block text-sm font-medium">
          {label}
          {required ? '' : ' (Optional)'}
        </Label>
        <Input
          type="file"
          accept={STOCK_FILE_ACCEPT}
          multiple
          onChange={(e) => {
            const next = filesFromInput(e.target.files);
            if (next.length) setter([...files, ...next]);
            e.target.value = '';
          }}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Images, PDF, Excel (.xlsx), or CSV — multiple files allowed
        </p>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileImage className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{file.name}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => removeFile(files, setter, index)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <SuperAdminGate>
        <AppShell title="AI Stock Processing">
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading company...
          </div>
        </AppShell>
      </SuperAdminGate>
    );
  }

  if (!company) {
    return (
      <SuperAdminGate>
        <AppShell title="AI Stock Processing">
          <div className="p-6">
            <Alert>
              <AlertDescription>
                Company not found in Supabase
                {cloudError ? ` (${cloudError})` : ''}. Go back and refresh the remote company list.
              </AlertDescription>
            </Alert>
            <Button asChild className="mt-4" variant="outline">
              <Link to="/admin/ai-stock">Back to companies</Link>
            </Button>
          </div>
        </AppShell>
      </SuperAdminGate>
    );
  }

  return (
    <SuperAdminGate>
      <AppShell title="AI Stock Processing">
        <div className="mx-auto max-w-7xl space-y-6 p-4">
          <div className="space-y-1">
            <Button variant="ghost" size="sm" asChild className="px-0">
              <Link to="/admin/ai-stock">
                <ArrowLeft className="mr-2 h-4 w-4" />
                All Companies
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold">{company.name}</h1>
              {session?.status && (
                <Badge variant={session.status === 'approved' ? 'default' : 'secondary'}>
                  {session.status}
                </Badge>
              )}
            </div>
          </div>

          {!cloudConnected && (
            <Alert variant="destructive">
              <AlertDescription>
                Not connected to Supabase
                {cloudError ? `: ${cloudError}` : '.'} Remote product catalogs cannot load until
                master cloud sign-in succeeds.
              </AlertDescription>
            </Alert>
          )}

          {cloudConnected && resolvedProducts.length === 0 && !pullingProducts && (
            <Alert>
              <AlertDescription>
                Connected to cloud but this store returned 0 products
                {cloudError ? ` (${cloudError})` : ''}. Pick another store, or run the super_admin
                RLS migration so master can read all products.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Store</CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name} ({storeProductCounts[store.id] || 0} cloud)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Report Date</CardTitle>
              </CardHeader>
              <CardContent>
                <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Products for Matching</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-semibold">
                  {pullingProducts ? '...' : resolvedProducts.length}
                </p>
                <p className="text-xs text-muted-foreground">
                  {pullingProducts
                    ? 'Pulling products from Supabase...'
                    : productSource === 'cloud'
                      ? `${cloudProductCount} products from Supabase`
                      : productSource === 'all-local'
                        ? `Cloud empty — fallback ${totalLocalProducts} local products`
                        : cloudError
                          ? cloudError
                          : `Selected store: ${selectedStoreProductCount} products`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!storeId || pullingProducts}
                  onClick={async () => {
                    const catalog = await loadProductCatalog(storeId);
                    if (catalog.length > 0) {
                      toast.success(`Loaded ${catalog.length} cloud products for matching`);
                    } else {
                      toast.error('No products returned from Supabase for this store');
                    }
                  }}
                >
                  Pull from Supabase
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Workflow className="h-5 w-5" />
                Daily Automation Pipeline
              </CardTitle>
              <CardDescription>
                Local Python EasyOCR reads your stock sheets (OpenCV cleaned) — no Puter, no cloud
                popups, no API keys. Then match → approve → update Supabase → PDF → WhatsApp/email.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant={freeAiStatus?.pythonOcr ? 'default' : 'secondary'}>
                  Python OCR {freeAiStatus?.pythonOcr ? '✓' : '— start pipeline server'}
                </Badge>
                <Badge variant="default">Local PDF ✓</Badge>
                <Badge variant="default">WhatsApp share ✓</Badge>
                <Badge variant="secondary">No Puter</Badge>
              </div>
              {pipelineStep && (
                <p className="text-sm text-muted-foreground">
                  Step: <span className="font-medium capitalize">{pipelineStep}</span>
                  {progress ? ` — ${progress}` : ''}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleRunDailyPipeline}
                  disabled={!canExtract || pipelineRunning || processing}
                >
                  {pipelineRunning ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Workflow className="mr-2 h-4 w-4" />
                  )}
                  Run Daily Pipeline
                </Button>
                {session?.status === 'review' && (
                  <Button
                    variant="default"
                    onClick={handleApproveAndSendDaily}
                    disabled={pipelineRunning || approving}
                  >
                    {pipelineRunning || approving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Approve &amp; Send Daily Report
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upload Stock Files</CardTitle>
              <CardDescription>
                Upload images, PDF, Excel, or CSV. Product names are cleaned to text only; stock
                columns stay as numbers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={uploadMode === 'separate' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setUploadMode('separate')}
                >
                  Separate sheets (Opening / Closing / Refill)
                </Button>
                <Button
                  type="button"
                  variant={uploadMode === 'combined' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setUploadMode('combined')}
                >
                  Combined sheet (Opening + Refill + Closing on one paper)
                </Button>
              </div>

              {uploadMode === 'combined' ? (
                renderFilePicker(
                  'Upload Combined Stock Sheet(s)',
                  combinedFiles,
                  setCombinedFiles,
                  true
                )
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  {renderFilePicker('Upload Opening Stock', openingFiles, setOpeningFiles, true)}
                  {renderFilePicker('Upload Closing Stock', closingFiles, setClosingFiles, true)}
                  {renderFilePicker('Upload Stock Refill', refillFiles, setRefillFiles)}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleExtract} disabled={!canExtract}>
              {processing && session?.status !== 'extracted' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileImage className="mr-2 h-4 w-4" />
              )}
              {processing && session?.status !== 'extracted' ? 'Extracting...' : 'Extract from Images'}
            </Button>
            {session?.status === 'extracted' && (
              <>
                <Button onClick={handleMatch} disabled={!canMatch}>
                  {processing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  {processing ? 'Matching...' : 'Match Products & Reconcile'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadStockExtractionPreviewPdf({ session, settings })}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Extraction PDF
                </Button>
              </>
            )}
            {progress && <span className="self-center text-sm text-muted-foreground">{progress}</span>}
          </div>

          {session && session.status === 'extracted' && (
            <Card>
              <CardHeader>
                <CardTitle>Step 1 — Review Extracted Data</CardTitle>
                <CardDescription>
                  Compare this table and the extraction PDF against your paper sheets. Fix product
                  names and stock numbers, then click Match Products.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {(session.extractionPreview?.length ?? 0) === 0 ? (
                  <Alert>
                    <AlertDescription>
                      No rows passed quality checks. Re-upload clearer photos or edit manually after
                      re-extracting.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product (from OCR)</TableHead>
                        <TableHead>Opening</TableHead>
                        <TableHead>Refill</TableHead>
                        <TableHead>Closing</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {session.extractionPreview?.map((row, index) => (
                        <TableRow key={`${row.rawName}-${index}`}>
                          <TableCell>
                            <Input
                              value={row.rawName}
                              onChange={(e) => updateExtractionRow(index, { rawName: e.target.value })}
                              onBlur={(e) =>
                                updateExtractionRow(index, {
                                  rawName: cleanOcrProductName(e.target.value),
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="w-20"
                              value={row.opening ?? row.quantity ?? 0}
                              onChange={(e) =>
                                updateExtractionRow(index, {
                                  opening: Number(e.target.value) || 0,
                                  quantity: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="w-20"
                              value={row.refill ?? 0}
                              onChange={(e) =>
                                updateExtractionRow(index, { refill: Number(e.target.value) || 0 })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="w-20"
                              value={row.closing ?? 0}
                              onChange={(e) =>
                                updateExtractionRow(index, { closing: Number(e.target.value) || 0 })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {session && (
            <>
              {showSummary && (
              <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
                {summaryCards.map((card) => (
                  <Card key={card.label}>
                    <CardContent className="pt-6">
                      <p className="text-xs text-muted-foreground">{card.label}</p>
                      <p className="text-lg font-semibold">{card.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              )}

              {session.status === 'review' || session.status === 'approved' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Step 2 — Review Matched Data</CardTitle>
                  <CardDescription>
                    Correct any remaining mistakes before approval. Dashboard updates only after approval.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {session.lineItems.length === 0 ? (
                    <Alert>
                      <AlertDescription>
                        No rows extracted. Tips: use Combined Sheet mode if Opening/Refill/Closing
                        are on one paper; upload clearer photos.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Opening</TableHead>
                          <TableHead>Refill</TableHead>
                          <TableHead>Closing</TableHead>
                          <TableHead>Sold</TableHead>
                          <TableHead>Revenue</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {session.lineItems.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <div className="font-medium">{item.productName}</div>
                              <div className="text-xs text-muted-foreground">{item.rawName}</div>
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                className="w-20"
                                value={item.openingStock}
                                disabled={session.status === 'approved'}
                                onChange={(e) =>
                                  updateLineItem(item.id, {
                                    openingStock: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                className="w-20"
                                value={item.refillStock}
                                disabled={session.status === 'approved'}
                                onChange={(e) =>
                                  updateLineItem(item.id, {
                                    refillStock: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                className="w-20"
                                value={item.closingStock}
                                disabled={session.status === 'approved'}
                                onChange={(e) =>
                                  updateLineItem(item.id, {
                                    closingStock: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell>{item.quantitySold}</TableCell>
                            <TableCell>{formatCurrency(item.revenue)}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  item.status === 'matched'
                                    ? 'default'
                                    : item.status === 'unmatched'
                                      ? 'destructive'
                                      : 'secondary'
                                }
                              >
                                {item.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
              ) : null}

              {(session.status === 'review' || session.status === 'approved') && (
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => handleApprove(false)} disabled={!canApprove}>
                  {approving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Approve & Update Dashboard
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadStockReconciliationPdf({ session, settings })}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    shareStockReconciliationPdfToWhatsApp({
                      session,
                      settings,
                      phone: company.phone || company.ownerPhone,
                    })
                  }
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Share via WhatsApp
                </Button>
              </div>
              )}

              {session.narrativeReport && (
                <Card>
                  <CardHeader>
                    <CardTitle>Daily AI Report</CardTitle>
                    <CardDescription>
                      Generated for WhatsApp / email — client dashboard already updated in Supabase.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm font-sans">
                      {session.narrativeReport}
                    </pre>
                  </CardContent>
                </Card>
              )}

              {session.images.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Original Images (Audit)</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-3">
                    {session.images.map((image) => (
                      <div key={image.id} className="space-y-2">
                        <Badge variant="outline">{image.type}</Badge>
                        {image.dataUrl ? (
                          <img
                            src={image.dataUrl}
                            alt={image.fileName}
                            className="max-h-48 w-full rounded-md border object-contain"
                          />
                        ) : (
                          <div className="flex max-h-48 min-h-24 w-full items-center justify-center rounded-md border bg-muted px-3 text-center text-xs text-muted-foreground">
                            {image.fileName} (preview not stored — Excel/PDF/CSV or large file)
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">{image.fileName}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </AppShell>
    </SuperAdminGate>
  );
}
