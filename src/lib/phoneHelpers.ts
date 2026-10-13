export function normalizePhone(value?: string | null): string | undefined {
  if (!value) return undefined;
  const digits = String(value).replace(/\D/g, '').trim();
  if (!digits) return undefined;

  // Normalize common Zambian phone formats.
  if (digits.startsWith('260') && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }

  if (digits.length === 9 && /^[7-9]\d{8}$/.test(digits)) {
    return `0${digits}`;
  }

  if (digits.length === 10 && digits.startsWith('0')) {
    return digits;
  }

  return digits;
}

export function normalizeEmail(value?: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}
