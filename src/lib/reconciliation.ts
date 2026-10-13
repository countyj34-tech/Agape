import type { ShiftReport } from '@/types/pos';

export function calculateShiftReconciliation({
  openingFloat,
  totalCashSales,
  totalCashExpenses,
  physicalCashCount,
}: {
  openingFloat: number;
  totalCashSales: number;
  totalCashExpenses: number;
  physicalCashCount: number;
}): {
  expectedCash: number;
  variance: number; // physical - expected
  status: 'balanced' | 'overage' | 'shortage';
} {
  const expected = Number((totalCashSales + openingFloat - totalCashExpenses).toFixed(2));
  const physical = Number(Number(physicalCashCount).toFixed(2));
  const variance = Number((physical - expected).toFixed(2));
  let status: 'balanced' | 'overage' | 'shortage' = 'balanced';
  if (variance > 0.0001) status = 'overage';
  else if (variance < -0.0001) status = 'shortage';
  return { expectedCash: expected, variance, status };
}

export function formatAuditText(report: {
  storeName?: string;
  date: Date;
  staffName: string;
  status: 'balanced' | 'overage' | 'shortage';
  shortageAmount?: number;
}) {
  const lines: string[] = [];
  lines.push('Mthunzi-Tech-Labs Audit Report');
  lines.push(`Date: ${report.date.toLocaleString()}`);
  lines.push(`Staff: ${report.staffName}`);
  lines.push(`Status: ${report.status === 'balanced' ? 'Balanced' : report.status === 'shortage' ? 'SHORTAGE' : 'Overage'}`);
  if (report.shortageAmount && report.shortageAmount > 0) lines.push(`Shortage Amount: K${report.shortageAmount.toFixed(2)}`);
  return lines.join('\n');
}

// Wrapper matching the prompt: runAuditShield
export function runAuditShield({
  openingFloat,
  totalCashSales,
  totalCashExpenses,
  staffEnteredCash,
}: {
  openingFloat: number;
  totalCashSales: number;
  totalCashExpenses: number;
  staffEnteredCash: number;
}): {
  expectedInDrawer: number;
  staffEnteredCash: number;
  variance: number;
  status: 'SHORTAGE' | 'OVERAGE' | 'BALANCED';
} {
  const expectedInDrawer = Number((openingFloat + totalCashSales - totalCashExpenses).toFixed(2));
  const variance = Number((Number(staffEnteredCash) - expectedInDrawer).toFixed(2));
  let status: 'SHORTAGE' | 'OVERAGE' | 'BALANCED' = 'BALANCED';
  if (variance < -0.0001) status = 'SHORTAGE';
  else if (variance > 0.0001) status = 'OVERAGE';
  return { expectedInDrawer, staffEnteredCash: Number(staffEnteredCash.toFixed(2)), variance, status };
}

