import { dexieDb } from '@/lib/db';
import type { Sale } from '@/types/pos';

const VISIT_THRESHOLD = 3;

function getMonthRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Builds the loyalty and referral section appended to WhatsApp receipts.
 * Uses only local IndexedDB data and does not mutate state.
 */
export async function buildWhatsAppLoyaltySection(args: {
  sale: Sale;
  shopName: string;
}): Promise<string | null> {
  const { sale, shopName } = args;
  const lines: string[] = [];

  try {
    const now = new Date();
    const { start, end } = getMonthRange(now);

    if (sale.customerId) {
      const [customer, customerSales] = await Promise.all([
        dexieDb.customers.get(sale.customerId),
        dexieDb.sales.where('customerId').equals(sale.customerId).toArray(),
      ]);

      const visitsThisMonth = customerSales.filter((s) => {
        const created = s.createdAt instanceof Date ? s.createdAt : new Date(String(s.createdAt));
        return created >= start && created <= end;
      }).length;

      if (visitsThisMonth >= VISIT_THRESHOLD) {
        const firstName = (customer?.name || '').split(' ')[0] || 'Customer';
        const timesText = visitsThisMonth === 1 ? '1 time' : `${visitsThisMonth} times`;
        // Simple deterministic code based on receipt and month key
        const monthKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        const codeTail = sale.receiptNumber.replace(/[^0-9A-Z]/gi, '').slice(-4).toUpperCase();
        const loyaltyCode = `MTZ-${monthKey}-${codeTail || 'LOYAL'}`;

        lines.push('');
        lines.push('Loyalty Reward 🎁');
        lines.push(
          `Thank you ${firstName} for shopping at ${shopName}! You have visited us ${timesText} this month.`,
        );
        lines.push(
          `Show this message on your next visit for a 5% discount on your favourite item.`,
        );
        lines.push(`Your Loyalty Code: ${loyaltyCode}`);
      }
    }
  } catch (error) {
    // Fail silently; loyalty should never block receipt sharing.
    console.error('Loyalty section error:', error);
  }

  // Always append a referral hook so other shop owners discover Mthunzi.
  try {
    const origin = window.location?.origin ?? '';
    const referralUrl = origin || 'https://mthunzi-pos.com';
    lines.push('');
    lines.push('—');
    lines.push('Share with a shop owner:');
    lines.push(`See how Mthunzi-POS (Offline-First) works: ${referralUrl}`);
  } catch (error) {
    console.error('Referral section error:', error);
  }

  if (lines.length === 0) return null;
  return lines.join('\n');
}
