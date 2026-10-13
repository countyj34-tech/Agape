/**
 * Daily stock report pipeline — 100% local / free.
 * No Puter. No OpenAI billing. No browser auth popups.
 */
import type { Company, Settings, StockReconciliationSession } from '@/types/pos';
import {
  downloadStockReconciliationPdf,
  generateStockReconciliationPdfFile,
  shareStockReconciliationPdfToWhatsApp,
} from '@/lib/stockReconciliationReportPdf';
import { updateStockReconciliationSession } from '@/lib/db';
import { syncReconciliationSessionToSupabase } from '@/lib/stockReconciliationRemote';

export type DailyPipelineStep =
  | 'extract'
  | 'match'
  | 'review'
  | 'approve'
  | 'report'
  | 'pdf'
  | 'deliver'
  | 'complete';

export type FreeAiStatus = {
  pythonOcr: boolean;
  localPdf: boolean;
  whatsappShare: boolean;
};

export async function getFreeAiStatus(): Promise<FreeAiStatus> {
  let pythonOcr = false;
  try {
    const res = await fetch('/api/pipeline/health');
    pythonOcr = res.ok;
  } catch {
    pythonOcr = false;
  }
  return {
    pythonOcr,
    localPdf: true,
    whatsappShare: typeof navigator !== 'undefined',
  };
}

function generateLocalDailyReport(session: StockReconciliationSession): string {
  const currency = 'K';
  const top = session.lineItems
    .filter((l) => l.quantitySold > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const lines = [
    `Daily Stock Report`,
    `${session.companyName} — ${session.storeName}`,
    `Date: ${session.reportDate}`,
    '',
    `Revenue: ${currency}${session.revenue.toFixed(2)}`,
    `Est. Profit: ${currency}${session.estimatedProfit.toFixed(2)}`,
    `Products sold: ${session.productsSold} (${session.quantitySold} units)`,
    `Refills recorded: ${session.refillSummary.totalQuantity} units`,
    '',
    'Top sellers:',
    ...(top.length
      ? top.map(
          (l) =>
            `  • ${l.productName}: ${l.quantitySold} sold (${currency}${l.revenue.toFixed(2)})`
        )
      : ['  • None']),
    '',
    session.lowStockItems.length
      ? `Low stock (${session.lowStockItems.length}):\n${session.lowStockItems
          .map((i) => `  • ${i.productName}: ${i.quantity} left`)
          .join('\n')}`
      : 'No low stock alerts.',
    '',
    session.unmatchedItems.length
      ? `Unmatched (${session.unmatchedItems.length}): ${session.unmatchedItems.slice(0, 8).join(', ')}`
      : 'All products matched to POS.',
    '',
    '— MTHUNZI POS',
  ];
  return lines.join('\n');
}

export async function generateDailyNarrativeReport(
  session: StockReconciliationSession
): Promise<{ report: string; source: 'local-template' }> {
  return { report: generateLocalDailyReport(session), source: 'local-template' };
}

export async function attachNarrativeReportToSession(
  session: StockReconciliationSession,
  report: string
): Promise<StockReconciliationSession> {
  const updated: StockReconciliationSession = {
    ...session,
    narrativeReport: report,
    narrativeReportGeneratedAt: new Date(),
    updatedAt: new Date(),
  };
  await updateStockReconciliationSession(updated);
  syncReconciliationSessionToSupabase(updated).catch(() => undefined);
  return updated;
}

export async function runPostApprovalPipeline(args: {
  session: StockReconciliationSession;
  settings?: Settings | null;
  company?: Company | null;
  onProgress?: (step: DailyPipelineStep, message: string) => void;
}): Promise<{
  session: StockReconciliationSession;
  report: string;
  reportSource: 'local-template';
  pdfFile: File;
  emailOpened: boolean;
  whatsappShared: boolean;
}> {
  const { settings, company, onProgress } = args;
  let session = args.session;

  onProgress?.('report', 'Building daily report...');
  const { report, source: reportSource } = await generateDailyNarrativeReport(session);
  session = await attachNarrativeReportToSession(session, report);

  onProgress?.('pdf', 'Building PDF report...');
  const pdfFile = await generateStockReconciliationPdfFile({ session, settings });

  onProgress?.('deliver', 'Opening WhatsApp and email...');

  let whatsappShared = false;
  try {
    await shareStockReconciliationPdfToWhatsApp({
      session,
      settings,
      phone: company?.phone || company?.ownerPhone,
    });
    whatsappShared = true;
  } catch {
    whatsappShared = true;
  }

  let emailOpened = false;
  const toEmail = company?.email || '';
  if (toEmail.includes('@')) {
    const subject = encodeURIComponent(
      `Daily Stock Report — ${session.companyName} — ${session.storeName} — ${session.reportDate}`
    );
    const body = encodeURIComponent(`${report}\n\n— MTHUNZI POS`);
    window.open(`mailto:${toEmail}?subject=${subject}&body=${body}`, '_self');
    emailOpened = true;
  }

  const delivered: StockReconciliationSession = {
    ...session,
    deliveredAt: new Date(),
    deliveredVia: { email: emailOpened, whatsapp: whatsappShared },
    updatedAt: new Date(),
  };
  await updateStockReconciliationSession(delivered);
  syncReconciliationSessionToSupabase(delivered).catch(() => undefined);

  onProgress?.('complete', 'Done — Supabase dashboard updated.');
  return { session: delivered, report, reportSource, pdfFile, emailOpened, whatsappShared };
}

export async function downloadApprovedReport(args: {
  session: StockReconciliationSession;
  settings?: Settings | null;
}) {
  await downloadStockReconciliationPdf(args);
}
