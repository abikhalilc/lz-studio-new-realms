import { resolve } from 'node:path';
import { openDatabase, createStudioServer } from './app.ts';

const port = Number(process.env.STUDIO_API_PORT ?? 8787);
const db = openDatabase(resolve(process.env.STUDIO_DATA_DIR ?? '.studio-data', 'studio.sqlite'));
const host = process.env.STUDIO_API_HOST ?? '127.0.0.1';
const server = createStudioServer({ db, allowLocalSetup: process.env.STUDIO_LOCAL_SETUP === '1' && ['127.0.0.1', '::1', 'localhost'].includes(host), dist: resolve('dist'), secureCookies: process.env.STUDIO_SECURE_COOKIES === '1' });
server.listen(port, host, () => console.info(`Studio server listening on port ${port}.`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
