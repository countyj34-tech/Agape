import Dexie, { type Table } from 'dexie';
import type { Sale } from '@/types/pos';
import type { SaleItemRecord } from '@/lib/db';

export type SaleSnapshotPayload = {
  sale: Sale;
  saleItems: Array<Omit<SaleItemRecord, 'id'>>;
  createdAt: string; // ISO
};

type SaleSnapshotRow = {
  id?: number;
  saleId: string;
  createdAt: string;
  payloadJson: string;
};

const BACKUP_DB_NAME = 'mthunzi-pos-backup-db';

class MthunziBackupDB extends Dexie {
  saleSnapshots!: Table<SaleSnapshotRow, number>;

  constructor() {
    super(BACKUP_DB_NAME);
    this.version(1).stores({
      saleSnapshots: '++id, saleId, createdAt',
    });
  }
}

const backupDb = new MthunziBackupDB();

export async function backupSaleSnapshot(payload: SaleSnapshotPayload): Promise<void> {
  const row: SaleSnapshotRow = {
    saleId: payload.sale.id,
    createdAt: payload.createdAt,
    payloadJson: JSON.stringify(payload),
  };
  await backupDb.saleSnapshots.add(row);
}

export async function getBackupSnapshots(limit = 500): Promise<SaleSnapshotPayload[]> {
  const rows = await backupDb.saleSnapshots.orderBy('createdAt').reverse().limit(limit).toArray();
  const parsed: SaleSnapshotPayload[] = [];
  for (const r of rows) {
    try {
      parsed.push(JSON.parse(r.payloadJson) as SaleSnapshotPayload);
    } catch {
      // ignore bad rows
    }
  }
  return parsed;
}

export async function clearBackupSnapshots(): Promise<void> {
  await backupDb.saleSnapshots.clear();
}
