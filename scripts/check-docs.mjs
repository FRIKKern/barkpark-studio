// Enforces the doc rules in QUALITY.md: size caps, and every doc reachable from
// README. Exits 1 with one line per violation.
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const lines = (f) => read(f).trimEnd().split('\n').length;
const bad = [];

const CAPS = { 'README.md': 80, 'CONTRIBUTING.md': 40, 'QUALITY.md': 60, 'JOURNEYS.md': 90, 'docs/ROADMAP.md': 30 };
for (const [f, max] of Object.entries(CAPS)) if (lines(f) > max) bad.push(`${f}: ${lines(f)} lines > ${max}`);
for (const f of fs.readdirSync(path.join(root, 'docs/decisions'))) {
  const n = lines(`docs/decisions/${f}`);
  if (n > 40) bad.push(`docs/decisions/${f}: ${n} lines > 40 (one page)`);
}

// One row per journey id.
const ids = [...read('JOURNEYS.md').matchAll(/^\| (J\d\d) \|/gm)].map((m) => m[1]);
if (new Set(ids).size !== ids.length) bad.push('JOURNEYS.md: a journey id appears twice');

// Every doc is linked from README, or sits in a folder README links to.
const readme = read('README.md');
const docs = ['CONTRIBUTING.md', 'QUALITY.md', 'JOURNEYS.md', ...fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
for (const f of docs) if (!readme.includes(`(${f})`)) bad.push(`${f}: not linked from README`);

if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log('docs ok');
