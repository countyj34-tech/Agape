/** Detect installed PWA / home-screen app (device mode). */

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      nav.standalone === true
    );
  } catch {
    return false;
  }
}
