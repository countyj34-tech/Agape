function normalizeCashierName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function safeRandomId(): string {
  // Fallback for environments without crypto.randomUUID
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${rand()}-${rand()}-${rand()}-${rand()}`;
}

export function getOrCreateCashierId(cashierName: string): string {
  const normalized = normalizeCashierName(cashierName);
  if (!normalized) throw new Error('Cashier name is required');

  const key = `pos:cashierId:${normalized}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id = 'randomUUID' in crypto ? crypto.randomUUID() : safeRandomId();
  localStorage.setItem(key, id);
  return id;
}

export function getCashierId(cashierName: string): string | null {
  const normalized = normalizeCashierName(cashierName);
  if (!normalized) return null;
  return localStorage.getItem(`pos:cashierId:${normalized}`);
}

export function normalizeCashierKey(cashierName: string): string {
  return normalizeCashierName(cashierName) || 'unknown';
}
