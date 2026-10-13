import type { Product } from '@/types/pos';
import type { StockReconciliationOcrRow } from '@/types/pos';

export function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function similarityScore(a: string, b: string): number {
  const normA = normalizeProductName(a);
  const normB = normalizeProductName(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.92;

  const maxLen = Math.max(normA.length, normB.length);
  const distance = levenshteinDistance(normA, normB);
  return 1 - distance / maxLen;
}

export function matchProductByName(
  rawName: string,
  products: Product[],
  minScore = 0.72
): Product | null {
  const trimmed = rawName.trim();
  if (!trimmed) return null;

  let best: Product | null = null;
  let bestScore = 0;

  for (const product of products) {
    const score = similarityScore(trimmed, product.name);
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }

  return bestScore >= minScore ? best : null;
}

export function aggregateOcrRows(rows: StockReconciliationOcrRow[]): StockReconciliationOcrRow[] {
  const grouped = new Map<string, StockReconciliationOcrRow>();

  for (const row of rows) {
    const key = normalizeProductName(row.rawName) || row.rawName.toLowerCase();
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...row });
      continue;
    }
    existing.quantity += row.quantity;
    if (row.opening !== undefined) existing.opening = (existing.opening ?? 0) + row.opening;
    if (row.closing !== undefined) existing.closing = (existing.closing ?? 0) + row.closing;
    if (row.refill !== undefined) existing.refill = (existing.refill ?? 0) + row.refill;
    if (row.unitPrice !== undefined && existing.unitPrice === undefined) {
      existing.unitPrice = row.unitPrice;
    }
  }

  return Array.from(grouped.values());
}

export function clusterOcrRowNames(rows: StockReconciliationOcrRow[]): StockReconciliationOcrRow[] {
  const clusters: StockReconciliationOcrRow[] = [];

  for (const row of rows) {
    let merged = false;
    for (const cluster of clusters) {
      if (similarityScore(cluster.rawName, row.rawName) >= 0.85) {
        cluster.quantity += row.quantity;
        if (row.opening !== undefined) cluster.opening = (cluster.opening ?? 0) + row.opening;
        if (row.closing !== undefined) cluster.closing = (cluster.closing ?? 0) + row.closing;
        if (row.refill !== undefined) cluster.refill = (cluster.refill ?? 0) + row.refill;
        if (row.unitPrice !== undefined && cluster.unitPrice === undefined) {
          cluster.unitPrice = row.unitPrice;
        }
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({ ...row });
    }
  }

  return clusters;
}

export function findMatchingOcrRow(
  name: string,
  rows: StockReconciliationOcrRow[]
): StockReconciliationOcrRow | undefined {
  let best: StockReconciliationOcrRow | undefined;
  let bestScore = 0;

  for (const row of rows) {
    const score = similarityScore(name, row.rawName);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  return bestScore >= 0.72 ? best : undefined;
}
