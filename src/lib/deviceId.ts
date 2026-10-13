function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function safeRandomId(): string {
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${rand()}-${rand()}-${rand()}-${rand()}`;
}

export function getDeviceFingerprint(): string {
  const ua = navigator.userAgent || 'unknown';
  return ua;
}

export function getMthunziDeviceId(): string {
  let uuid = localStorage.getItem('mthunzi_device_uuid');
  if (!uuid) {
    uuid = 'randomUUID' in crypto ? crypto.randomUUID() : safeRandomId();
    localStorage.setItem('mthunzi_device_uuid', uuid);
  }

  const fp = getDeviceFingerprint();
  const hash = fnv1a32(`${fp}::${uuid}`).toString(16).toUpperCase().padStart(8, '0');
  // Short, human-shareable ID
  return `MTZ-${hash}-${uuid.slice(0, 8).toUpperCase()}`;
}

const MTZ_LICENSE_SECRET = 'Mthunzi_Stephen_Zulu_2026_Secure';

function bytesToUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function pad8(n: number): string {
  return String(Math.trunc(n) >>> 0).padStart(8, '0');
}

function dash8(s: string): string {
  const digits = String(s || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length !== 8) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  if (!('crypto' in globalThis) || !crypto.subtle) {
    console.error('Web Crypto API not available - check if page is HTTPS or localhost');
    throw new Error('Web Crypto API not available. Use HTTPS or localhost for activation.');
  }
  
  try {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(digest);
  } catch (err) {
    console.error('SHA256 failed:', err);
    if (err instanceof Error && (err.message.includes('secure') || err.message.includes('Secure context'))) {
      throw new Error('Secure context required: Please use HTTPS or access from localhost instead of a network IP.');
    }
    throw err;
  }
}

// Master-key logic (offline): Hash(DeviceID + MTZ_LICENSE_SECRET)
// The generator should produce the same representation (hex/base64).
export async function computeLicenseHash(deviceId: string): Promise<{
  hex: string;
  base64: string;
  base64url: string;
  short8: string[];
}> {
  const bytes = await sha256Bytes(`${deviceId}${MTZ_LICENSE_SECRET}`);
  const hex = bytesToHex(bytes);
  const base64 = bytesToBase64(bytes);
  const base64url = toBase64Url(base64);

  // Human-friendly 8-digit activation codes derived from the digest.
  // We generate two variants (from the first and last 32-bit segments) to stay
  // compatible with different offline key-generator implementations.
  const mod = 100_000_000;
  const first = pad8(bytesToUint32BE(bytes, 0) % mod);
  const last = pad8(bytesToUint32BE(bytes, Math.max(0, bytes.length - 4)) % mod);
  const short8 = [first, dash8(first), last, dash8(last)];

  return { hex, base64, base64url, short8 };
}

function normalizeEnteredKey(key: string): string {
  const trimmed = String(key || '')
    .trim()
    // Remove common wrappers from copy/paste
    .replace(/^[`'\"]+|[`'\"]+$/g, '');

  // Remove whitespace + invisible unicode characters often introduced by chat apps
  const compact = trimmed
    .replace(/[\s\u200B-\u200D\uFEFF-]/g, '')
    .replace(/-/g, '');

  // Allow users to paste hex with 0x prefix
  const no0x = compact.replace(/^0x/i, '');

  // Strip any remaining non-key characters (e.g. punctuation)
  return no0x.replace(/[^a-zA-Z0-9+/_=.-]/g, '').toLowerCase();
}

function normalizeDigits(key: string): string {
  return String(key || '').replace(/\D/g, '');
}

export async function verifyLicenseKey(deviceId: string, enteredKey: string): Promise<boolean> {
  const normalized = normalizeEnteredKey(enteredKey);
  const normalizedDigits = normalizeDigits(enteredKey);
  if (!normalized && !normalizedDigits) return false;
  const { hex, base64, base64url, short8 } = await computeLicenseHash(deviceId);

  const candidates = [
    hex.toLowerCase(),
    base64.toLowerCase(),
    base64url.toLowerCase(),
  ];

  if (normalized && candidates.includes(normalized)) return true;

  // Accept short 8-digit codes (with or without dash).
  if (normalizedDigits && normalizedDigits.length === 8) {
    const shortDigits = short8.map((s) => normalizeDigits(s));
    return shortDigits.includes(normalizedDigits);
  }

  return false;
}
