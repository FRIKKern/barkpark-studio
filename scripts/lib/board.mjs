// Reads the task board as the Barkpark GitHub bridge mirrors it: every task under
// the Studio Parity goal is a sub-issue of FRIKKern/barkpark#21665 (public repo,
// so no Barkpark token is needed in CI). See docs/decisions/0003.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export const GOAL = { repo: 'FRIKKern/barkpark', issue: 21665, task: 'task-130be6b834d485ae' };

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

export async function gh(path) {
  const t = token();
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: { accept: 'application/vnd.github+json', ...(t && { authorization: `Bearer ${t}` }) },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function subIssues(issue) {
  const rows = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`repos/${GOAL.repo}/issues/${issue}/sub_issues?per_page=100&page=${page}`);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  // Sub-goals (e.g. the Freeform track) carry their own children: walk them too.
  for (const i of [...rows]) if (i.sub_issues_summary?.total) rows.push(...(await subIssues(i.number)));
  return rows;
}

// One row per task: { id: 'J21' | 'D03' | 'P0' | 'gap' | 'other', title, status, closedAt, url }.
// status: done | cancelled | in_progress | open — from the bridge's status:* label.
export async function tasks() {
  return (await subIssues(GOAL.issue)).map((i) => {
    const label = i.labels.map((l) => l.name).find((n) => n.startsWith('status:'));
    let status = label ? label.slice(7) : 'open';
    if (i.state === 'closed') status = i.state_reason === 'not_planned' ? 'cancelled' : 'done';
    const j = i.title.match(/^([JD]\d\d)\b/);
    const id = j ? j[1] : i.title.startsWith('P0 ') ? 'P0' : i.title.startsWith('Barkpark:') ? 'gap' : 'other';
    return { id, title: i.title, status, closedAt: i.closed_at, url: i.html_url };
  });
}

// Journey -> phase key ('1'…'6' or 'after'), from the Phase column of JOURNEYS.md (its one home).
export function journeyPhases(file = new URL('../../JOURNEYS.md', import.meta.url)) {
  const map = {};
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/^\| (J\d\d) \| (\d|after)\b/gm)) map[m[1]] = m[2];
  return map;
}

// Freeform-track journeys (D01…), from the "Freeform track" table in JOURNEYS.md.
export function freeformJourneys(file = new URL('../../JOURNEYS.md', import.meta.url)) {
  return [...fs.readFileSync(file, 'utf8').matchAll(/^\| (D\d\d) \|/gm)].map((m) => m[1]);
}

// Phases from the table in docs/ROADMAP.md (its one home).
export function phases(file = new URL('../../docs/ROADMAP.md', import.meta.url)) {
  const out = [];
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/^\| (\d|after) \| ([^|]+)\| ([^|]+)\|/gm)) {
    out.push({ key: m[1], name: m[2].trim(), gives: m[3].trim() });
  }
  return out;
}

// Rewrite the block between <!-- name:start --> and <!-- name:end --> in a file.
export function replaceBlock(file, name, body) {
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`(<!-- ${name}:start -->\\n)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(src)) throw new Error(`${file}: missing <!-- ${name}:start/end --> markers`);
  const next = src.replace(re, `$1${body}$2`);
  if (next !== src) fs.writeFileSync(file, next);
  return next !== src;
}
