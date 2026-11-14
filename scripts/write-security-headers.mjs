import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [htmlPath, destination] = process.argv.slice(2);
if(!htmlPath || !destination) throw new Error('Provide built HTML and a destination for security headers.');

const html = readFileSync(htmlPath, 'utf8');
const hashes = new Set();
for(const [, attributes, content] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if(/\bsrc\s*=/i.test(attributes) || !content.trim()) continue;
    hashes.add(`'sha256-${createHash('sha256').update(content).digest('base64')}'`);
}

const policy = [
    "default-src 'none'",
    `script-src 'self' ${[...hashes].join(' ')}`.trim(),
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://intervals.icu",
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ');

writeFileSync(destination, [
    `add_header Content-Security-Policy "${policy}" always;`,
    'add_header X-Content-Type-Options "nosniff" always;',
    'add_header X-Frame-Options "DENY" always;',
    'add_header Referrer-Policy "no-referrer" always;',
    'add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), bluetooth=(self), serial=(self), usb=(self), screen-wake-lock=(self)" always;',
    '',
].join('\n'));
