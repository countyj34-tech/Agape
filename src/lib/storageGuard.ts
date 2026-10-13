export interface PersistentStorageResult {
  supported: boolean;
  persisted: boolean | null;
}

function getNavigatorStorage(): StorageManager | null {
  if (typeof navigator === 'undefined') return null;
  const anyNav = navigator as any;
  return anyNav.storage ?? null;
}

export async function requestPersistentStorage(): Promise<PersistentStorageResult> {
  const storage: any = getNavigatorStorage();
  if (!storage || typeof storage.persist !== 'function' || typeof storage.persisted !== 'function') {
    return { supported: false, persisted: null };
  }

  try {
    // Check current status first so we don't spam the user with prompts.
    const alreadyPersisted: boolean = await storage.persisted();
    if (alreadyPersisted) {
      return { supported: true, persisted: true };
    }

    const granted: boolean = await storage.persist();
    return { supported: true, persisted: granted };
  } catch (e) {
    console.error('Persistent storage request failed', e);
    return { supported: true, persisted: null };
  }
}

export async function getPersistentStorageStatus(): Promise<boolean | null> {
  const storage: any = getNavigatorStorage();
  if (!storage || typeof storage.persisted !== 'function') {
    return null;
  }
  try {
    const persisted: boolean = await storage.persisted();
    return persisted;
  } catch (e) {
    console.error('Persistent storage status check failed', e);
    return null;
  }
}
