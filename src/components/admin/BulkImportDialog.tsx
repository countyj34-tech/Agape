import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { addCategory, addProduct, getAllCategories, getProductById, updateProduct } from '@/lib/db';
import type { SmartImportRow } from '@/lib/vantageOcr';
import { syncImportedStockToVantage } from '@/lib/vantageOcr';
import {
  extractSmartImportRowsFromFiles,
  STOCK_FILE_ACCEPT,
  validateStockImportRows,
} from '@/lib/stockImportExtract';
import type { Product } from '@/types/pos';
import { Loader2, Plus, Trash2, Upload } from 'lucide-react';

type DraftState = {
  rows: SmartImportRow[];
  sourceFileNames: string[];
  updatedAt: string;
};

function createBlankRow(): SmartImportRow {
  return {
    id: crypto.randomUUID(),
    name: '',
    buyingPrice: '0',
    sellingPrice: '0',
    quantity: '1',
  };
}

function getDraftKey(storeId?: string | null): string {
  return `mtz:smart-import:draft:${storeId || 'global'}`;
}

function toDraft(state: Pick<DraftState, 'rows' | 'sourceFileNames'>): DraftState {
  return {
    rows: state.rows,
    sourceFileNames: state.sourceFileNames,
    updatedAt: new Date().toISOString(),
  };
}

const METHOD_LABELS: Record<string, string> = {
  excel: 'Excel',
  csv: 'CSV',
  'pdf-text': 'PDF',
  'python-easyocr': 'Python OCR',
  'tesseract-stock-sheet': 'Browser OCR',
};

export function BulkImportDialog({
  open,
  onOpenChange,
  storeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  storeId?: string | null;
}) {
  const draftKey = useMemo(() => getDraftKey(storeId), [storeId]);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<SmartImportRow[]>([]);
  const [sourceFileNames, setSourceFileNames] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [overlayProgress, setOverlayProgress] = useState(0);
  const [overlayStatus, setOverlayStatus] = useState('');
  const [extractionMethod, setExtractionMethod] = useState('');

  const validationIssues = useMemo(() => validateStockImportRows(rows), [rows]);
  const hasValidationIssues = validationIssues.length > 0;
  const busy = processing || syncing;

  const persistDraft = useCallback(
    (nextRows: SmartImportRow[], nextSourceFileNames: string[]) => {
      if (!nextRows.length) {
        localStorage.removeItem(draftKey);
        return;
      }
      localStorage.setItem(
        draftKey,
        JSON.stringify(toDraft({ rows: nextRows, sourceFileNames: nextSourceFileNames }))
      );
    },
    [draftKey]
  );

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) {
        setRows([]);
        setSourceFileNames([]);
        return;
      }
      const draft = JSON.parse(raw) as DraftState;
      setRows(Array.isArray(draft.rows) ? draft.rows : []);
      setSourceFileNames(Array.isArray(draft.sourceFileNames) ? draft.sourceFileNames : []);
    } catch (error) {
      console.warn('Failed to load smart import draft', error);
    }
  }, [draftKey, open]);

  useEffect(() => {
    if (!open) return;
    persistDraft(rows, sourceFileNames);
  }, [open, persistDraft, rows, sourceFileNames]);

  const processSelectedFiles = async (selectedFiles: File[]) => {
    if (!selectedFiles.length) return;

    setProcessing(true);
    setOverlayProgress(0);
    setOverlayStatus('Extracting products from your files...');

    try {
      const { rows: extractedRows, method } = await extractSmartImportRowsFromFiles(
        selectedFiles,
        ({ progress, status }) => {
          setOverlayProgress(Math.round(progress));
          setOverlayStatus(status);
        }
      );

      const methodLabel = METHOD_LABELS[method] || method;
      setExtractionMethod(methodLabel);

      if (extractedRows.length === 0) {
        toast.message('No products found. Try Excel/CSV, or a clearer photo.');
      } else {
        toast.success(`Extracted ${extractedRows.length} products via ${methodLabel}`);
      }

      setRows(extractedRows);
      const nextSourceFileNames = selectedFiles.map((file) => file.name);
      setSourceFileNames(nextSourceFileNames);
      persistDraft(extractedRows, nextSourceFileNames);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setProcessing(false);
      setOverlayStatus('');
      setOverlayProgress(0);
    }
  };

  const onFiles = async (f: FileList | null) => {
    if (!f) return;
    const nextFiles = Array.from(f);
    setFiles(nextFiles);
    await processSelectedFiles(nextFiles);
  };

  const updateRow = (rowId: string, patch: Partial<SmartImportRow>) => {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const removeRow = (rowId: string) => {
    setRows((current) => current.filter((row) => row.id !== rowId));
  };

  const addManualRow = () => {
    setRows((current) => [...current, createBlankRow()]);
  };

  const runExtract = async () => {
    if (files.length === 0) {
      toast.error('Select at least one file (image, PDF, Excel, or CSV)');
      return;
    }
    await processSelectedFiles(files);
  };

  const ensureImportedCategory = async () => {
    const cats = await getAllCategories(storeId || undefined);
    let importedCat = cats.find((category) => category.name === 'Imported');
    if (!importedCat) {
      const id = crypto.randomUUID();
      await addCategory({
        id,
        name: 'Imported',
        order: (cats.length || 0) + 1,
        storeId: storeId || undefined,
      });
      importedCat = { id, name: 'Imported', order: (cats.length || 0) + 1 } as any;
    }
    return importedCat;
  };

  const saveAll = async () => {
    if (rows.length === 0) {
      toast.error('No items to save');
      return;
    }
    if (!storeId) {
      toast.error('Select a store first');
      return;
    }

    setSyncing(true);
    setOverlayProgress(5);
    setOverlayStatus('Preparing products');

    try {
      const importedCategory = await ensureImportedCategory();
      const nextRows = [...rows];
      let saved = 0;

      for (let index = 0; index < nextRows.length; index += 1) {
        const row = nextRows[index];
        const name = row.name.trim();
        if (!name) throw new Error(`Row ${index + 1} is missing a product name`);

        const buyingPrice = Number(row.buyingPrice) || 0;
        const sellingPrice = Number(row.sellingPrice) || 0;
        const quantity = Math.max(0, Math.round(Number(row.quantity) || 0));

        const productPayload: Product = {
          id: row.localProductId || crypto.randomUUID(),
          name,
          barcode: row.localProductId
            ? (await getProductById(row.localProductId))?.barcode || crypto.randomUUID()
            : crypto.randomUUID(),
          buyingPrice,
          sellingPrice,
          stock: quantity,
          lowStockThreshold: Math.max(1, Math.min(quantity || 1, 5)),
          categoryIds: [importedCategory.id],
          storeId: storeId || '',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        setOverlayStatus(`Saving ${name}`);
        setOverlayProgress(Math.round(((index + 1) / Math.max(1, nextRows.length)) * 80));

        if (row.localProductId) {
          const existing = await getProductById(row.localProductId);
          await updateProduct({
            ...productPayload,
            id: row.localProductId,
            barcode: existing?.barcode || productPayload.barcode,
            createdAt: existing?.createdAt || productPayload.createdAt,
          });
        } else {
          await addProduct(productPayload);
          row.localProductId = productPayload.id;
        }
        saved += 1;
        persistDraft(nextRows, sourceFileNames);
      }

      setOverlayStatus('Finishing sync...');
      setOverlayProgress(90);
      try {
        await syncImportedStockToVantage({
          storeId,
          sourceFileName: sourceFileNames.join(', ') || files.map((file) => file.name).join(', '),
          rows: nextRows,
        });
      } catch (syncError) {
        console.warn('Vantage sync skipped:', syncError);
      }

      setOverlayProgress(100);
      toast.success(`${saved} products added to inventory`);
      localStorage.removeItem(draftKey);
      setRows([]);
      setFiles([]);
      setSourceFileNames([]);
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      persistDraft(rows, sourceFileNames);
      toast.error(error instanceof Error ? error.message : 'Failed to save products');
    } finally {
      setSyncing(false);
      setOverlayStatus('');
      setOverlayProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-6xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="space-y-2 pr-8 sm:pr-0">
          <DialogTitle className="text-lg sm:text-2xl break-words">
            AI-Powered Stock Import
          </DialogTitle>
          <DialogDescription className="text-sm sm:text-base">
            Upload Excel, CSV, PDF, or photos of your stock list. Review the extracted products, then
            Save All to add them to this store&apos;s inventory — no manual typing needed.
          </DialogDescription>
        </DialogHeader>

        <div className="relative space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="ai-stock-import">Upload stock file(s)</Label>
              <Input
                id="ai-stock-import"
                type="file"
                accept={STOCK_FILE_ACCEPT}
                multiple
                onChange={(e) => onFiles(e.target.files)}
              />
              <p className="text-xs text-muted-foreground">
                Best results: Excel/CSV with columns Name, Buying Price, Selling Price, Quantity.
                PDF text tables and scanned PDFs (OCR) are supported too.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              <Button onClick={runExtract} disabled={busy || files.length === 0} className="gap-2">
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {processing ? 'Extracting…' : 'Extract Products'}
              </Button>
              <Button variant="outline" onClick={addManualRow} disabled={busy} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Row
              </Button>
            </div>
          </div>

          {busy && (
            <div className="absolute inset-0 z-20 rounded-xl border bg-background/85 p-4 backdrop-blur-sm">
              <div className="flex h-full flex-col justify-center gap-3">
                <div className="flex items-center gap-3 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>{overlayStatus || 'Processing...'}</span>
                  <span className="ml-auto text-muted-foreground">{overlayProgress}%</span>
                </div>
                <Progress value={overlayProgress} className="h-2" />
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">Draft:</span>
              {extractionMethod && (
                <span className="rounded-full bg-blue-500/20 px-2 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                  Via {extractionMethod}
                </span>
              )}
              {sourceFileNames.length > 0 ? (
                sourceFileNames.map((name) => (
                  <span
                    key={name}
                    className="rounded-full bg-background px-2 py-1 text-[11px] text-foreground shadow-sm"
                  >
                    {name}
                  </span>
                ))
              ) : (
                <span>Upload a file to start.</span>
              )}
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="max-h-[420px] overflow-auto hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[240px]">Name</TableHead>
                    <TableHead className="min-w-[140px]">Buying Price</TableHead>
                    <TableHead className="min-w-[140px]">Selling Price</TableHead>
                    <TableHead className="min-w-[120px]">Quantity</TableHead>
                    <TableHead className="w-[72px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        No products yet. Upload Excel/CSV/PDF/image to extract stock.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="align-top">
                          <Input
                            value={row.name}
                            onChange={(e) => updateRow(row.id, { name: e.target.value })}
                            placeholder="Product name"
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            type="number"
                            inputMode="decimal"
                            value={row.buyingPrice}
                            onChange={(e) => updateRow(row.id, { buyingPrice: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            type="number"
                            inputMode="decimal"
                            value={row.sellingPrice}
                            onChange={(e) => updateRow(row.id, { sellingPrice: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            type="number"
                            inputMode="numeric"
                            value={row.quantity}
                            onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeRow(row.id)}
                            title="Remove row"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {hasValidationIssues && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p className="font-semibold">Fix these before saving:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {validationIssues.slice(0, 5).map((issue) => (
                    <li key={`${issue.index}-${issue.name}`}>
                      {`Row ${issue.index + 1}: ${issue.issues.join(', ')}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-3 p-3 md:hidden">
              {rows.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No products yet. Upload a file to extract stock.
                </div>
              ) : (
                rows.map((row) => (
                  <div key={row.id} className="rounded-xl border bg-background p-3 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Product</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(row.id)}
                        title="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      <div className="space-y-2">
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={row.name}
                          onChange={(e) => updateRow(row.id, { name: e.target.value })}
                          placeholder="Product name"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label className="text-xs">Buying</Label>
                          <Input
                            type="number"
                            value={row.buyingPrice}
                            onChange={(e) => updateRow(row.id, { buyingPrice: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Selling</Label>
                          <Input
                            type="number"
                            value={row.sellingPrice}
                            onChange={(e) => updateRow(row.id, { sellingPrice: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Quantity</Label>
                        <Input
                          type="number"
                          value={row.quantity}
                          onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="w-full sm:w-auto"
          >
            Close
          </Button>
          <Button
            onClick={saveAll}
            disabled={busy || rows.length === 0 || hasValidationIssues}
            className="w-full gap-2 sm:w-auto"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {syncing ? 'Saving…' : `Save All to Inventory (${rows.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BulkImportDialog;
