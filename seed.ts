import { seedDemoData } from './src/lib/db.ts'; seedDemoData().then(() => console.log('Seeded demo data')).catch(console.error);
