#!/usr/bin/env node
/**
 * Assemble the single public site from two independent builds:
 *
 *   frontend/dist  (React SPA, webpack)   → site/       with index.html renamed to app.html
 *   landing/out    (Next.js static export) → site/       index.html, uk/, _next/, sitemap, robots, OG images
 *
 * The apps stay separate in source and build; they only share a domain. Routing on the host:
 *   1. an existing file wins  (/ → landing index.html, /uk/ → landing, /bundle.js → SPA, …)
 *   2. /uk → /uk/             (redirect)
 *   3. everything else → /app.html (the SPA shell; React Router takes over)
 * render.yaml and scripts/preview-site.mjs implement exactly these rules.
 *
 * Usage: node scripts/assemble-site.mjs   (after building both apps)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spaDir = path.join(root, 'frontend', 'dist');
const landingDir = path.join(root, 'landing', 'out');
const siteDir = path.join(root, 'site');

/** Files both builds emit on purpose. The value says whose copy is kept. */
const SHARED = {
    'favicon.svg': 'landing',
    'apple-touch-icon.png': 'landing',
    'icon-192.png': 'landing',
    'icon-512.png': 'landing',
};
/** SPA files that make no sense on the combined host. */
const SPA_SKIP = new Set(['_redirects', 'robots.txt']);

function fail(msg) {
    console.error(`assemble-site: ${msg}`);
    process.exit(1);
}

function listFiles(dir, base = dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(full, base));
        else out.push(path.relative(base, full).split(path.sep).join('/'));
    }
    return out;
}

for (const [dir, cmd] of [
    [spaDir, 'npm run build:frontend'],
    [landingDir, 'npm run build --prefix landing'],
]) {
    if (!fs.existsSync(path.join(dir, 'index.html'))) fail(`${path.relative(root, dir)} is missing; run \`${cmd}\` first.`);
}

fs.rmSync(siteDir, { recursive: true, force: true });
fs.mkdirSync(siteDir, { recursive: true });

const placed = new Map(); // relative path → 'spa' | 'landing'

function place(srcDir, rel, owner, destRel = rel) {
    const prev = placed.get(destRel);
    if (prev) {
        const keep = SHARED[destRel];
        if (!keep) fail(`both apps produce "${destRel}". Rename one, or list it in SHARED.`);
        if (keep !== owner) return;
    }
    const dest = path.join(siteDir, destRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(srcDir, rel), dest);
    placed.set(destRel, owner);
}

for (const rel of listFiles(spaDir)) {
    if (SPA_SKIP.has(rel)) continue;
    place(spaDir, rel, 'spa', rel === 'index.html' ? 'app.html' : rel);
}
for (const rel of listFiles(landingDir)) {
    place(landingDir, rel, 'landing');
}

const counts = { spa: 0, landing: 0 };
for (const owner of placed.values()) counts[owner] += 1;
console.log(
    `assemble-site: site/ ready (${counts.landing} landing files, ${counts.spa} app files; SPA shell at /app.html)`,
);
