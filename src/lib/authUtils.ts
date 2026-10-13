// Permanent authentication utilities to prevent lock errors
// This file provides stable, debounced authentication functions

let authCheckPromise: Promise<boolean> | null = null;
let userCheckPromise: Promise<any> | null = null;
let lastAuthCheck = 0;
const DEBOUNCE_DELAY = 1000; // 1 second debounce

/**
 * Stable authentication check with debouncing to prevent lock errors
 */
export async function stableIsAuthenticated(): Promise<boolean> {
  const now = Date.now();
  
  // If we checked recently, return cached result
  if (now - lastAuthCheck < DEBOUNCE_DELAY && authCheckPromise) {
    return authCheckPromise;
  }

  // If check is in progress, return existing promise
  if (authCheckPromise) {
    return authCheckPromise;
  }

  authCheckPromise = (async () => {
    try {
      const { supabase } = await import('./supabase');
      const { data: { user } } = await supabase.auth.getUser();
      lastAuthCheck = Date.now();
      return !!user;
    } catch (error) {
      // Silently handle lock errors and other auth issues
      if (error.message && !error.message.includes('Lock')) {
        console.error('Auth check error:', error.message);
      }
      return false;
    } finally {
      // Clear promise after delay
      setTimeout(() => {
        authCheckPromise = null;
      }, DEBOUNCE_DELAY);
    }
  })();

  return authCheckPromise;
}

/**
 * Stable current user check with debouncing
 */
export async function stableGetCurrentUser(): Promise<any> {
  // If check is in progress, return existing promise
  if (userCheckPromise) {
    return userCheckPromise;
  }

  userCheckPromise = (async () => {
    try {
      const { supabase } = await import('./supabase');
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    } catch (error) {
      // Silently handle lock errors
      if (error.message && !error.message.includes('Lock')) {
        console.error('Get user error:', error.message);
      }
      return null;
    } finally {
      // Clear promise after delay
      setTimeout(() => {
        userCheckPromise = null;
      }, DEBOUNCE_DELAY);
    }
  })();

  return userCheckPromise;
}

/**
 * Clear authentication cache (for logout)
 */
export function clearAuthCache(): void {
  authCheckPromise = null;
  userCheckPromise = null;
  lastAuthCheck = 0;
}
