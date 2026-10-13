import { getSaleItemsByDate, getSalesByDate, getSettings } from '@/lib/db';
import { dexieDb } from '@/lib/db';

function formatMoney(currencySymbol: string, value: number): string {
  return `${currencySymbol}${value.toFixed(2)}`;
}

export async function generateWhatsAppReport(date: Date = new Date()): Promise<string> {
  const [settings, sales, saleItems] = await Promise.all([getSettings(), getSalesByDate(date), getSaleItemsByDate(date)]);
  const dayKey = date.toISOString().slice(0, 10);
  const expenses = await dexieDb.expenses
    .filter((e) => (e.createdAt instanceof Date ? e.createdAt : new Date(String(e.createdAt))).toISOString().slice(0, 10) === dayKey)
    .toArray();

  const currencySymbol = settings?.currencySymbol || 'K';
  const shopName = settings?.shopName || 'Mthunzi Store';
  const day = dayKey;

  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);

  // Profit is best taken from stored sale snapshots (already accounts for discounts)
  const totalProfit = sales.reduce((sum, s) => sum + s.profit, 0);

  const expensesTotal = expenses.reduce((sum, e) => sum + (e.amount ?? 0), 0);
  const profitAfterExpenses = totalProfit - expensesTotal;
  const taxRate = Math.max(0, Number(settings?.taxRate ?? 0));
  const taxAmount = profitAfterExpenses > 0 ? (profitAfterExpenses * taxRate) / 100 : 0;
  const netAfterTax = profitAfterExpenses - taxAmount;

  // Top sellers from saleItems
  const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const i of saleItems) {
    const existing = byProduct.get(i.productId);
    const lineRevenue = i.qty * i.priceAtSale;
    if (existing) {
      existing.qty += i.qty;
      existing.revenue += lineRevenue;
    } else {
      byProduct.set(i.productId, { name: i.productName, qty: i.qty, revenue: lineRevenue });
    }
  }

  const top3 = Array.from(byProduct.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 3);

  const lines: string[] = [];
  lines.push(`${shopName} — Daily Report`);
  lines.push(`Date: ${day}`);
  lines.push('');
  lines.push(`Total Revenue: ${formatMoney(currencySymbol, totalRevenue)}`);
  lines.push(`Gross Profit: ${formatMoney(currencySymbol, totalProfit)}`);
  lines.push(`Expenses: ${formatMoney(currencySymbol, expensesTotal)}`);
  lines.push(`Profit (after expenses): ${formatMoney(currencySymbol, profitAfterExpenses)}`);
  if (taxRate > 0) {
    lines.push(`Tax (${taxRate.toFixed(1)}%): ${formatMoney(currencySymbol, taxAmount)}`);
    lines.push(`Net Profit (after tax): ${formatMoney(currencySymbol, netAfterTax)}`);
  }
  lines.push(`Transactions: ${sales.length}`);
  lines.push('');
  lines.push('Top 3 Sellers:');

  if (top3.length === 0) {
    lines.push('1) (No sales)');
  } else {
    top3.forEach((p, idx) => {
      lines.push(`${idx + 1}) ${p.name} — x${p.qty} (${formatMoney(currencySymbol, p.revenue)})`);
    });
  }

  lines.push('');
  lines.push('Sent from Mthunzi-POS (Offline-First)');

  return lines.join('\n');
}

export async function shareWhatsAppReport(date: Date = new Date()): Promise<void> {
  const text = await generateWhatsAppReport(date);

  // Prefer native share (works better on Android/WhatsApp)
  if (navigator.share) {
    await navigator.share({ title: 'Daily Report', text });
    return;
  }

  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
