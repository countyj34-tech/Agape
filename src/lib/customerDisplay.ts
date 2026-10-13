// Customer-facing display (second screen) protocol.
//
// A dual-screen POS terminal shows the operator UI on the front screen and a
// read-only price display to the customer on the back screen. The two windows
// communicate same-origin via BroadcastChannel, with a localStorage mirror used
// for the initial paint and as a fallback where BroadcastChannel is unavailable.
//
// When the Window Management API is available (Chrome/Edge), the customer
// window is auto-placed on a secondary monitor and can enter fullscreen on that
// screen. Otherwise it falls back to a normal popup the operator can drag over.

export const CUSTOMER_DISPLAY_CHANNEL = 'mthunzi-pos-customer-display-v1';
export const CUSTOMER_DISPLAY_STORAGE_KEY = 'mthunzi:customer-display:last-snapshot';
export const CUSTOMER_DISPLAY_WINDOW_NAME = 'mthunzi-customer-display';
export const CUSTOMER_DISPLAY_PATH = '/customer-display';
export const CUSTOMER_DISPLAY_SCREEN_PREF_KEY = 'mthunzi:customer-display:preferred-screen';
export const CUSTOMER_DISPLAY_TARGET_SCREEN_KEY = 'mthunzi:customer-display:target-screen';

export interface CustomerDisplayLine {
  lineId: string;
  name: string;
  quantity: number;
  unitPriceText: string;
  lineTotalText: string;
}

export interface CustomerDisplaySnapshot {
  type: 'cart-snapshot';
  status: 'active' | 'completed';
  storeName: string;
  logoUrl?: string;
  items: CustomerDisplayLine[];
  itemCount: number;
  subtotalText: string;
  discountAmount: number;
  discountText: string;
  taxLabel: string;
  taxAmount: number;
  taxText: string;
  totalText: string;
  // Only present when status === 'completed'.
  changeText?: string;
  updatedAt: number;
}

export type CustomerDisplayMessage =
  | CustomerDisplaySnapshot
  | { type: 'request-snapshot' };

/** Minimal ScreenDetailed shape from the Window Management API. */
export interface CustomerDisplayScreenInfo {
  left: number;
  top: number;
  width: number;
  height: number;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary: boolean;
  isInternal: boolean;
  label?: string;
  /** Opaque id used only to re-select a previously preferred screen. */
  id: string;
  /** The live ScreenDetailed object when available (for requestFullscreen). */
  raw?: Screen;
}

export interface OpenCustomerDisplayResult {
  window: Window | null;
  /** True when Window Management API placed the window on a secondary screen. */
  autoPlaced: boolean;
  /** Human-readable note for toasts (permission denied, single screen, etc.). */
  message?: string;
  targetScreen?: CustomerDisplayScreenInfo;
}

export function isBroadcastChannelSupported(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

export function isWindowManagementSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as Window & { getScreenDetails?: unknown }).getScreenDetails === 'function';
}

function screenId(s: {
  left: number;
  top: number;
  width: number;
  height: number;
  label?: string;
}): string {
  return `${s.left},${s.top},${s.width}x${s.height}:${s.label ?? ''}`;
}

function toScreenInfo(s: Screen & {
  availLeft?: number;
  availTop?: number;
  isPrimary?: boolean;
  isInternal?: boolean;
  label?: string;
}): CustomerDisplayScreenInfo {
  const left = Number((s as { left?: number }).left ?? 0);
  const top = Number((s as { top?: number }).top ?? 0);
  return {
    left,
    top,
    width: s.width,
    height: s.height,
    availLeft: Number(s.availLeft ?? left),
    availTop: Number(s.availTop ?? top),
    availWidth: s.availWidth,
    availHeight: s.availHeight,
    isPrimary: Boolean(s.isPrimary),
    isInternal: Boolean(s.isInternal),
    label: s.label,
    id: screenId({ left, top, width: s.width, height: s.height, label: s.label }),
    raw: s,
  };
}

function readPreferredScreenId(): string | null {
  try {
    return localStorage.getItem(CUSTOMER_DISPLAY_SCREEN_PREF_KEY);
  } catch {
    return null;
  }
}

export function rememberPreferredCustomerScreen(screenIdValue: string): void {
  try {
    localStorage.setItem(CUSTOMER_DISPLAY_SCREEN_PREF_KEY, screenIdValue);
  } catch {
    /* ignore */
  }
}

/**
 * Enumerate connected screens via the Window Management API.
 * Triggers a permission prompt the first time (must be called from a user gesture).
 */
export async function getCustomerDisplayScreens(): Promise<CustomerDisplayScreenInfo[]> {
  if (!isWindowManagementSupported()) return [];

  try {
    const details = await (
      window as Window & {
        getScreenDetails: () => Promise<{ screens: Screen[] }>;
      }
    ).getScreenDetails();
    return (details.screens ?? []).map((s) => toScreenInfo(s as Screen & {
      availLeft?: number;
      availTop?: number;
      isPrimary?: boolean;
      isInternal?: boolean;
      label?: string;
    }));
  } catch {
    return [];
  }
}

/**
 * Pick the best secondary screen for the customer display:
 * 1) previously preferred screen (if still connected)
 * 2) first non-primary screen that isn't the current operator screen
 * 3) any screen that isn't the current one
 * 4) null if only one screen is available
 */
export function pickCustomerDisplayScreen(
  screens: CustomerDisplayScreenInfo[],
  currentScreenId?: string | null
): CustomerDisplayScreenInfo | null {
  if (screens.length < 2) return null;

  const preferredId = readPreferredScreenId();
  if (preferredId) {
    const preferred = screens.find((s) => s.id === preferredId);
    if (preferred) return preferred;
  }

  const notCurrent = screens.filter((s) => s.id !== currentScreenId);
  const secondary = notCurrent.find((s) => !s.isPrimary) ?? notCurrent[0];
  return secondary ?? null;
}

function buildWindowFeatures(screen: CustomerDisplayScreenInfo): string {
  // Fill the available work area of the target screen.
  return [
    `left=${Math.round(screen.availLeft)}`,
    `top=${Math.round(screen.availTop)}`,
    `width=${Math.round(screen.availWidth)}`,
    `height=${Math.round(screen.availHeight)}`,
    'popup=yes',
  ].join(',');
}

/**
 * Opens (or focuses) the customer display window.
 * When Window Management is available and a second monitor exists, places the
 * window on that screen automatically. Call from a click handler so permission
 * prompts and window.open are allowed.
 */
export async function openCustomerDisplayWindow(): Promise<OpenCustomerDisplayResult> {
  const url = `${window.location.origin}${CUSTOMER_DISPLAY_PATH}`;

  // Identify the operator's current screen so we don't place the display there.
  let currentId: string | null = null;
  try {
    const cur = window.screen;
    currentId = screenId({
      left: Number((cur as Screen & { left?: number }).left ?? 0),
      top: Number((cur as Screen & { top?: number }).top ?? 0),
      width: cur.width,
      height: cur.height,
      label: (cur as Screen & { label?: string }).label,
    });
  } catch {
    /* ignore */
  }

  let targetScreen: CustomerDisplayScreenInfo | undefined;
  let autoPlaced = false;
  let message: string | undefined;

  if (isWindowManagementSupported()) {
    const screens = await getCustomerDisplayScreens();
    if (screens.length === 0) {
      message =
        'Screen permission was denied or unavailable. Drag the window to the customer screen and press fullscreen.';
    } else if (screens.length < 2) {
      message = 'Only one monitor detected. Connect a second screen for auto-placement.';
    } else {
      const picked = pickCustomerDisplayScreen(screens, currentId);
      if (picked) {
        targetScreen = picked;
        rememberPreferredCustomerScreen(picked.id);
      }
    }
  } else {
    message =
      'This browser cannot auto-place windows. Drag the customer display to the back screen and press fullscreen.';
  }

  const features = targetScreen ? buildWindowFeatures(targetScreen) : undefined;
  const win = window.open(url, CUSTOMER_DISPLAY_WINDOW_NAME, features);

  if (!win) {
    return {
      window: null,
      autoPlaced: false,
      message: 'Popup was blocked. Allow popups for this site, then try again.',
      targetScreen,
    };
  }

  if (targetScreen) {
    autoPlaced = true;
    // Move/resize again after open — some Chromium builds ignore features on named windows.
    try {
      win.moveTo(Math.round(targetScreen.availLeft), Math.round(targetScreen.availTop));
      win.resizeTo(Math.round(targetScreen.availWidth), Math.round(targetScreen.availHeight));
    } catch {
      /* cross-origin timing / popup restrictions — ignore */
    }

    // Tell the display which screen to fullscreen onto (localStorage is shared
    // across same-origin windows; sessionStorage is not).
    try {
      localStorage.setItem(
        CUSTOMER_DISPLAY_TARGET_SCREEN_KEY,
        JSON.stringify({
          availLeft: targetScreen.availLeft,
          availTop: targetScreen.availTop,
          availWidth: targetScreen.availWidth,
          availHeight: targetScreen.availHeight,
          left: targetScreen.left,
          top: targetScreen.top,
          width: targetScreen.width,
          height: targetScreen.height,
          label: targetScreen.label,
          isPrimary: targetScreen.isPrimary,
          id: targetScreen.id,
        })
      );
    } catch {
      /* ignore */
    }

    if (!message) {
      message = targetScreen.label
        ? `Opened on ${targetScreen.label}`
        : 'Opened on the customer screen';
    }
  }

  win.focus();
  return { window: win, autoPlaced, message, targetScreen };
}

export function persistSnapshot(snapshot: CustomerDisplaySnapshot): void {
  try {
    localStorage.setItem(CUSTOMER_DISPLAY_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage may be unavailable (private mode / quota). BroadcastChannel still works.
  }
}

export function readPersistedSnapshot(): CustomerDisplaySnapshot | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_DISPLAY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomerDisplaySnapshot;
    if (parsed && parsed.type === 'cart-snapshot') return parsed;
    return null;
  } catch {
    return null;
  }
}
