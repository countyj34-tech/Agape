console.log('start');

const dbMod = await import('./src/lib/db.ts');
console.log('db imported', !!dbMod.dexieDb);

const offline = await import('./src/lib/offlineStartup.ts');
console.log('offline imported', typeof offline.restoreOfflineLocalSession);

await dbMod.dexieDb.companies.clear();
await dbMod.dexieDb.stores.clear();
console.log('tables cleared');

const result = await offline.restoreOfflineLocalSession({ companyId: 'company-1', assignedStoreId: 'store-1', userRole: 'owner' } as any);
console.log('result', result);
