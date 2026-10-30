#!/usr/bin/env node
/**
 * Serve the assembled site/ with the same routing rules as the Render static service
 * (see scripts/assemble-site.mjs). For checking the combined landing + app before deploying.
 *
 * Usage: node scripts/preview-site.mjs [port]   (default 4000)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.resolve(process.argv[3] || path.join(root, 'site'));
const port = Number(process.argv[2] || 4000);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.xml': 'application/xml',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

/** Existing file for a URL path, the way a static host resolves it (dir → index.html). */
function existingFile(urlPath) {
    const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
    const full = path.join(siteDir, rel);
    if (!full.startsWith(siteDir)) return null;
    try {
        const stat = fs.statSync(full);
        if (stat.isFile()) return full;
        if (stat.isDirectory() && urlPath.endsWith('/')) {
            const index = path.join(full, 'index.html');
            if (fs.existsSync(index)) return index;
        }
    } catch {
        /* not found */
    }
    return null;
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    // 1. existing file wins
    let file = existingFile(url.pathname);
    // 2. redirects: /en → /en/, the old /uk/… → /
    if (!file && url.pathname === '/en') {
        res.writeHead(301, { Location: `/en/${url.search}` });
        return res.end();
    }
    if (!file && (url.pathname === '/uk' || url.pathname.startsWith('/uk/'))) {
        res.writeHead(301, { Location: `/${url.search}` });
        return res.end();
    }
    // 3. everything else → SPA shell
    if (!file) file = path.join(siteDir, 'app.html');

    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

server.listen(port, () => console.log(`site preview: http://localhost:${port}  (serving ${siteDir})`));
