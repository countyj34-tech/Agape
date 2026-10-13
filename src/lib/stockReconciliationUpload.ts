import type { StockReconciliationImage, StockReconciliationImageType } from '@/types/pos';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i;
/** Keep previews small so IndexedDB put does not fail with DataError / QuotaExceeded */
const MAX_STORED_DATA_URL_CHARS = 1_500_000;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => {
      const err = reader.error;
      const message =
        err instanceof DOMException
          ? `Could not read file (${err.name})`
          : err?.message || 'Failed to read file';
      reject(new Error(message));
    };
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  return type.startsWith('image/') || IMAGE_EXT.test(file.name || '');
}

export async function createReconciliationImageRecord(
  file: File,
  type: StockReconciliationImageType
): Promise<StockReconciliationImage> {
  // Excel/PDF/CSV must not be stored as giant data URLs — that triggers browser DataError
  let dataUrl = '';
  if (isImageFile(file) && file.size < 4_000_000) {
    try {
      const raw = await readFileAsDataUrl(file);
      dataUrl = raw.length <= MAX_STORED_DATA_URL_CHARS ? raw : '';
    } catch {
      dataUrl = '';
    }
  }

  return {
    id: crypto.randomUUID(),
    type,
    fileName: file.name,
    mimeType: file.type || (isImageFile(file) ? 'image/jpeg' : 'application/octet-stream'),
    fileSize: file.size,
    dataUrl,
    uploadedAt: new Date(),
  };
}

export async function uploadReconciliationImages(
  files: Partial<Record<StockReconciliationImageType, File[] | File | null | undefined>>
): Promise<StockReconciliationImage[]> {
  const images: StockReconciliationImage[] = [];

  for (const type of ['opening', 'closing', 'refill', 'combined'] as StockReconciliationImageType[]) {
    const value = files[type];
    if (!value) continue;
    const list = Array.isArray(value) ? value : [value];
    for (const file of list) {
      if (!file) continue;
      images.push(await createReconciliationImageRecord(file, type));
    }
  }

  return images;
}
