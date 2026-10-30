#!/usr/bin/env node
// Design-system guard (documentation/design/design-system.md):
// no literal colors in components and no type below 12px.
// Usage: node scripts/check-design-tokens.cjs [--report]   (--report never fails)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../frontend/src');
// Files that legitimately hold color values: theme tokens, the phase palette,
// Google Calendar's own event colors, and dead habit code.
const ALLOW = [
  /^theme\//,
  /^modules\/calendar\/googleEventSettings\.ts$/,
  /^modules\/calendar\/hooks\/eventAppearance\.ts$/,
  /^modules\/habits\//,
  /^pages\/HabitsPage\//,
  /^modules\/now\/components\/HabitNowStrip\.tsx$/,
  /\.spec\.tsx?$/,
];
const RULES = [
  { name: 'hex color', re: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g, ext: /\.(tsx?|css)$/ },
  { name: 'type below 12px', re: /text-\[(?:1[01]|[0-9])px\]|text-\[0\.[0-6]\d*rem\]/g, ext: /\.(tsx?|css)$/ },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const report = process.argv.includes('--report');
const problems = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (ALLOW.some((re) => re.test(rel))) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const rule of RULES) {
    if (!rule.ext.test(rel)) continue;
    text.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const hits = line.match(rule.re);
      if (hits) problems.push(`${rel}:${i + 1}  ${rule.name}: ${hits.join(', ')}`);
    });
  }
}

if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\n${problems.length} design-token problem(s).`);
  if (!report) process.exit(1);
} else {
  console.log('Design tokens: clean.');
}
