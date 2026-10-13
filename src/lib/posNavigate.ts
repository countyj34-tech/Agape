import { flushSync } from 'react-dom';
import type { NavigateFunction } from 'react-router-dom';
import { unlockPageInteraction } from '@/lib/unlockPageInteraction';

/**
 * POS-safe navigation.
 * Forces a synchronous React commit so the screen always changes with the URL
 * (React Router v7 otherwise defers via startTransition, which Admin can starve).
 */
export function posNavigate(
  navigate: NavigateFunction,
  to: string,
  options?: { replace?: boolean }
): void {
  unlockPageInteraction();
  const replace = options?.replace ?? false;
  const expectedPath = (to.split('?')[0] || to).replace(/\/$/, '') || '/';

  flushSync(() => {
    navigate(to, { replace });
  });

  requestAnimationFrame(() => {
    unlockPageInteraction();
    // Safety net: if the URL still did not match after sync commit, hard-assign.
    const now = window.location.pathname.replace(/\/$/, '') || '/';
    if (now !== expectedPath && !now.startsWith(`${expectedPath}/`)) {
      window.location.assign(to);
    }
  });
}
