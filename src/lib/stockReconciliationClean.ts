import type { StockReconciliationOcrRow } from '@/types/pos';

/**
 * Canonical bar/restaurant product names (clean display form).
 * OCR / sheet text is snapped to these when close enough.
 */
export const CANONICAL_PRODUCT_NAMES = [
  'Black Label Small',
  'Black Label Canned',
  'Black Label Whisky',
  'Castle Lite',
  'Castle Lite Dumpy',
  'Castle Lite Canned',
  'Castle Lite Small',
  'Castle Small',
  'Castle Lager',
  'Heineken',
  'Heineken Silver',
  'Savannah',
  'Fruitree Juice',
  'Corona',
  'Windhoek Draught',
  'Windhoek Lager',
  'Breezer',
  '1340',
  'Kombutcha',
  'Kombat Big',
  'Brothers Mocktail',
  'Brutal Fruit Canned',
  'Flying Fish',
  'C.Shot',
  'Codys Vody',
  'FT Energy',
  'Disposable Drinks',
  'Hunters Gold',
  'Hunters Dry',
  'Budweiser',
  'Fruiticanna',
  'Fruiticanna Smoothie',
  'Gordons Canned',
  'Mosi Lite',
  'Mosi Small',
  'Mosi Lager',
  'Belgravia',
  'Belgravia Shots',
  'Small Kungfull',
  'Kungfull Big',
  'Mixers',
  'Amarula Big',
  'Drosdy Hof',
  'Mineral Water',
  'Red Bull',
  'Four Cousins Canned',
  'Four Cousins Bottle',
  'Power Energy',
  'Power Plus',
  'Celler Cask',
  'Celebration',
  'Chateau Canned',
  'Life Shot',
  'Nederbero',
  'Autumn Harvest',
  'Glenfiddich 12',
  'Jameson',
  'Smirnoff',
  'Absolute Vodka',
  'Tequila Silver',
  'Carling Black Label',
] as const;

/** Meaningful short / size tokens that must not be dropped as OCR junk */
const SMALL_KEEP = new Set([
  'big',
  'small',
  'dry',
  'gold',
  'lite',
  'lager',
  'red',
  'hof',
  'ft',
  'ml',
  'can',
  'shot',
  'plus',
]);

/** Real product words — never strip these as trailing OCR garbage */
const PRODUCT_WORDS = new Set([
  ...SMALL_KEEP,
  'canned',
  'bottle',
  'juice',
  'water',
  'energy',
  'bull',
  'fish',
  'vody',
  'cask',
  'shots',
  'silver',
  'draught',
  'dumpy',
  'whisky',
  'smoothie',
  'mocktail',
  'drinks',
  'harvest',
  'cousins',
  'label',
  'fruit',
  'castle',
  'windhoek',
  'hunters',
  'black',
  'mosi',
  'brutal',
  'flying',
  'codys',
  'gordons',
  'fruiticanna',
  'fruitree',
  'belgravia',
  'amarula',
  'drosdy',
  'mineral',
  'power',
  'celler',
  'celebration',
  'chateau',
  'life',
  'nederbero',
  'autumn',
  'glenfiddich',
  'heineken',
  'savannah',
  'corona',
  'breezer',
  'kombutcha',
  'kombat',
  'brothers',
  'disposable',
  'budweiser',
  'mixers',
  'kungfull',
  'jameson',
  'smirnoff',
  'absolute',
  'vodka',
  'tequila',
  'carling',
  'dumpie',
  'switch',
  'groundnuts',
  'cshot',
]);

/** Common OCR / sheet misspellings → canonical token */
const OCR_TOKEN_FIXES: Record<string, string> = {
  lte: 'lite',
  light: 'lite',
  dumpie: 'dumpy',
  dump: 'dumpy',
  dunghill: 'dunhill',
  fruiticana: 'fruiticanna',
  fruitcanna: 'fruiticanna',
  nederburg: 'nederbero',
  nederberg: 'nederbero',
  cellar: 'celler',
  cody: 'codys',
  "cody's": 'codys',
  whiskey: 'whisky',
  draught: 'draught',
  draft: 'draught',
  kombucha: 'kombutcha',
  kungfu: 'kungfull',
  kungfull: 'kungfull',
  cshot: 'cshot',
};

function normalizeKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseProduct(name: string): string {
  const special = new Map([
    ['ft', 'FT'],
    ['c.shot', 'C.Shot'],
    ['cshot', 'C.Shot'],
    ['ml', 'ml'],
  ]);

  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (special.has(lower)) return special.get(lower)!;
      if (/^\d+$/.test(token)) return token;
      if (/^[a-z]\./i.test(token)) {
        return token
          .split('.')
          .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''))
          .join('.');
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(' ');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = na.split(' ').filter(Boolean);
  const tb = nb.split(' ').filter(Boolean);
  const setA = new Set(ta);
  const setB = new Set(tb);

  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = union ? inter / union : 0;

  const allQueryInCanonical = ta.every((t) => setB.has(t));
  let coverageScore = 0;
  if (allQueryInCanonical && ta.length === tb.length) {
    coverageScore = 0.99;
  } else if (allQueryInCanonical && ta.length > 0) {
    // Prefer closer length — do not expand "Castle Lite" → "Castle Lite Dumpy"
    coverageScore = 0.55 + 0.35 * (ta.length / tb.length);
  }

  const maxLen = Math.max(na.length, nb.length);
  const lev = maxLen === 0 ? 0 : 1 - levenshtein(na, nb) / maxLen;

  return Math.max(jaccard, coverageScore, lev);
}

/** Aggressive scrub: letters/numbers/spaces only — no -, /, symbols */
function scrubRawName(raw: string): string {
  let name = String(raw || '');

  // Kill dashes, slashes, and every other symbol first (including ASCII hyphen)
  name = name.replace(/[\-\/\\|—–−_=~`^*+#@£$€©<>[\]{}()"'`,;:!?·•]+/g, ' ');
  name = name.replace(/^a\s+/i, '');
  name = name.replace(/^\d+[\).\s]+/, '').trim();
  name = name.replace(/\s+\d+(?:[.,]\d+)?\s*$/g, '').trim();

  // Letters, digits, spaces, apostrophe only
  name = name.replace(/[^A-Za-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();

  const tokens = name.split(/\s+/).filter(Boolean);
  const kept: string[] = [];

  const isOcrJunkToken = (token: string, lower: string): boolean => {
    if (PRODUCT_WORDS.has(lower) || SMALL_KEEP.has(lower) || /^\d+$/.test(token)) return false;
    if (token.length <= 2) return true;
    // Short ALL-CAPS or all-lower fragments: YW, sua, AG, WC, IR, fo
    if (token.length <= 4 && (/^[A-Z]+$/.test(token) || /^[a-z]+$/.test(token))) return true;
    return false;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    let token = tokens[i];
    let lower = token.toLowerCase();

    if (OCR_TOKEN_FIXES[lower]) {
      token = OCR_TOKEN_FIXES[lower];
      lower = token.toLowerCase();
    }

    if (!/[A-Za-z0-9]/.test(token)) continue;

    // Drop tiny OCR junk unless meaningful (FT, size words, digits)
    if (token.length <= 2 && !SMALL_KEEP.has(lower) && !/^\d+$/.test(token)) {
      if (!(lower === 'c' || lower === 'ft') || i === tokens.length - 1) {
        if (!SMALL_KEEP.has(lower)) continue;
      }
    }

    // Drop trailing OCR garbage in any case: yw, YW, sua, AG, WC, IR
    const isTrailing = i >= tokens.length - 3;
    if (isTrailing && kept.length >= 1 && isOcrJunkToken(token, lower)) {
      continue;
    }

    // Drop tokens with no vowels (OCR noise) unless known keepers / digits
    if (
      token.length >= 3 &&
      !/[aeiouAEIOU]/.test(token) &&
      !/^\d+$/.test(token) &&
      !SMALL_KEEP.has(lower) &&
      !PRODUCT_WORDS.has(lower)
    ) {
      continue;
    }

    kept.push(token);
  }

  // Strip trailing junk again
  while (kept.length > 1) {
    const last = kept[kept.length - 1];
    const lower = last.toLowerCase();
    if (!isOcrJunkToken(last, lower)) break;
    kept.pop();
  }

  return kept.join(' ').trim();
}

/** Snap messy OCR text to a known clean product name when close enough */
export function snapToCanonicalProductName(raw: string, minScore = 0.78): string | null {
  const cleaned = scrubRawName(raw);
  if (!cleaned) return null;

  let best: string | null = null;
  let bestScore = 0;
  let bestLen = Infinity;

  for (const canonical of CANONICAL_PRODUCT_NAMES) {
    const score = similarity(cleaned, canonical);
    const len = normalizeKey(canonical).length;
    if (score > bestScore + 0.02 || (Math.abs(score - bestScore) <= 0.02 && len < bestLen)) {
      bestScore = score;
      best = canonical;
      bestLen = len;
    }
  }

  return bestScore >= minScore ? best : null;
}

/** Final pass — never leave -, /, |, _, etc. in the display name */
function hardSanitizeDisplayName(name: string): string {
  return name
    .replace(/[\-\/\\|—–−_=~`^*+#@£$€©<>[\]{}()"'`,;:!?·•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clean product names to look like:
 * "Black Label Small", "Castle Lite Dumpy", "Heineken"
 * — no dashes, slashes, or OCR garbage.
 */
export function cleanOcrProductName(raw: string): string {
  const snapped = snapToCanonicalProductName(raw, 0.78);
  if (snapped) return snapped;

  const scrubbed = scrubRawName(raw);
  if (!scrubbed) return '';

  const softSnap = snapToCanonicalProductName(scrubbed, 0.72);
  if (softSnap) return softSnap;

  // Re-join C Shot → try C.Shot
  const joined = scrubbed.replace(/\bc\s+shot\b/i, 'C.Shot');
  if (/^c\.?shot$/i.test(normalizeKey(joined).replace(/\s/g, '')) || /c shot/i.test(scrubbed)) {
    const cshot = snapToCanonicalProductName('C.Shot', 0.9);
    if (cshot) return cshot;
  }

  return hardSanitizeDisplayName(titleCaseProduct(scrubbed));
}

export function isLikelyValidStockRow(
  row: StockReconciliationOcrRow,
  options?: { fromAi?: boolean }
): boolean {
  const name = cleanOcrProductName(row.rawName);
  if (name.length < 2) return false;
  if (/^[\d\s.,]+$/.test(name) && name !== '1340') return false;

  const letters = (name.match(/[a-zA-Z]/g) || []).length;
  if (letters < 2 && name !== '1340') return false;
  if (!options?.fromAi && letters / Math.max(name.length, 1) < 0.35 && name !== '1340') {
    return false;
  }

  const hasStock =
    (row.opening ?? row.quantity ?? 0) > 0 ||
    (row.closing ?? 0) > 0 ||
    (row.refill ?? 0) > 0;
  if (!hasStock) return false;

  // Reject leftover symbol-heavy names
  if (/[\/\\|_\-=]/.test(name)) return false;

  return true;
}

export function normalizeOcrRows(
  rows: StockReconciliationOcrRow[],
  options?: { fromAi?: boolean }
): StockReconciliationOcrRow[] {
  return rows
    .map((row) => ({
      ...row,
      rawName: cleanOcrProductName(row.rawName),
      opening: row.opening !== undefined ? Number(row.opening) || 0 : row.opening,
      closing: row.closing !== undefined ? Number(row.closing) || 0 : row.closing,
      refill: row.refill !== undefined ? Number(row.refill) || 0 : row.refill,
      quantity: Number(row.quantity) || 0,
    }))
    .filter((row) => isLikelyValidStockRow(row, options));
}
