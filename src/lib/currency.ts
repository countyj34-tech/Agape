import { Settings } from '@/types/pos';

const FX_CACHE_KEY = 'mthunzi_fx_rates';
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export type FxRateMap = {
  base: string;
  timestamp: number;
  rates: Record<string, number>;
};

function loadCachedRates(): FxRateMap | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FxRateMap;
    if (!parsed.base || !parsed.timestamp || !parsed.rates) return null;
    if (Date.now() - parsed.timestamp > FX_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedRates(map: FxRateMap) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

async function fetchRates(base: string): Promise<FxRateMap | null> {
  try {
    const res = await fetch(`https://api.exchangerate.host/latest?base=${encodeURIComponent(base)}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !json.rates) return null;
    const map: FxRateMap = {
      base,
      timestamp: Date.now(),
      rates: json.rates as Record<string, number>,
    };
    saveCachedRates(map);
    return map;
  } catch {
    return null;
  }
}

async function getRate(base: string, target: string): Promise<number | null> {
  if (base === target) return 1;

  const cached = loadCachedRates();
  if (cached && cached.base === base) {
    const r = cached.rates[target];
    if (typeof r === 'number') return r;
  }

  const fresh = await fetchRates(base);
  if (!fresh) return null;
  const r = fresh.rates[target];
  if (typeof r !== 'number') return null;
  return r;
}

export async function convertAmount(value: number, settings: Settings | null): Promise<number> {
  if (!settings) return value;

  const base = settings.baseCurrency || settings.currency || 'ZMW';
  const target = settings.currency || base;

  if (base === target) return value;

  const rate = await getRate(base, target);
  if (!rate) return value;

  return value * rate;
}

export function formatCurrencySync(value: number, settings: Settings | null): string {
  const symbol = settings?.currencySymbol || 'K';
  return `${symbol}${value.toFixed(2)}`;
}

export async function formatCurrency(value: number, settings: Settings | null): Promise<string> {
  const converted = await convertAmount(value, settings);
  return formatCurrencySync(converted, settings);
}
