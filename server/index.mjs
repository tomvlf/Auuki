import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.mjs';

const database = process.env.AUUKI_DATABASE || './data/auuki.sqlite';
mkdirSync(dirname(database), {recursive: true, mode: 0o700});
const origin = process.env.AUUKI_ORIGIN || 'http://localhost:1234';
if(new URL(origin).origin !== origin) throw new Error('AUUKI_ORIGIN must be an origin without a trailing slash.');
if(process.env.AUUKI_INSECURE_COOKIES === '1' &&
   !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) {
    throw new Error('Insecure cookies are only allowed for localhost development.');
}
const app = createApp({database, origin, secureCookies: process.env.AUUKI_INSECURE_COOKIES !== '1'});
const port = Number(process.env.PORT || 3000);
app.server.listen(port, '0.0.0.0', () => console.log(`Auuki backend listening on ${port}; browser origin ${origin}`));
for(const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => app.server.close(() => { app.close(); process.exit(0); }));
}
