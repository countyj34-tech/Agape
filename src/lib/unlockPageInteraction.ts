/** Force-clear leftover modal locks that block POS clicks. */
export function unlockPageInteraction(): void {
  if (typeof document === 'undefined') return;
  try {
    document.body.style.pointerEvents = '';
    document.body.style.overflow = '';
    document.body.removeAttribute('data-scroll-locked');
    document.body.removeAttribute('data-aria-hidden');
    document.documentElement.style.overflow = '';
    document.documentElement.style.pointerEvents = '';
    document.documentElement.removeAttribute('data-scroll-locked');

    // Kill any leftover Radix overlays/portals that still intercept clicks.
    document.querySelectorAll('[data-radix-dialog-overlay]').forEach((el) => {
      const state = el.getAttribute('data-state');
      if (state === 'closed' || state === null) {
        (el as HTMLElement).style.pointerEvents = 'none';
        try {
          el.remove();
        } catch {
          /* ignore */
        }
      }
    });

    if (document.body.hasAttribute('inert')) {
      document.body.removeAttribute('inert');
    }
  } catch {
    /* ignore */
  }
}
