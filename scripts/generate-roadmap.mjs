// Draws docs/images/roadmap.svg: phases from docs/ROADMAP.md, journey membership
// from JOURNEYS.md (Sanity journeys by phase, Freeform D-journeys in their own lane),
// progress from the task board (scripts/lib/board.mjs).
import fs from 'node:fs';
import { tasks, journeyPhases, phases, freeformJourneys } from './lib/board.mjs';

const OUT = new URL('../docs/images/roadmap.svg', import.meta.url);
const W = 1200, PAD = 40, GAP = 16, TOP = 196, ROW = 30;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const ICON = { done: '✓', in_progress: '◐', open: '○', cancelled: '✕' };

// Short journey label: the JOURNEYS.md text up to its first separator.
const journeyText = Object.fromEntries(
  [...fs.readFileSync(new URL('../JOURNEYS.md', import.meta.url), 'utf8').matchAll(/^\| ([JD]\d\d) \| [^|]+\| ([^|]+)\|/gm)]
    .map(([, id, text]) => [id, text.replace(/\*\*/g, '').split(/[:;,→(]/)[0].replace(/"/g, '').trim()]),
);
const CLS = { done: 'done', in_progress: 'now', open: 'todo', cancelled: 'todo' };

// Items in a box of `width`: one labelled row each while they fit, else compact
// id-only chips, so a phase keeps working at 20+ journeys.
const LABELLED_MAX = 8, CHIP_W = 74, CHIP_ROW = 28;
function itemsLayout(items, width, cols = 1) {
  const labelled = items.length <= LABELLED_MAX * cols;
  const per = labelled ? cols : Math.max(1, Math.floor(width / CHIP_W));
  const step = labelled ? ROW : CHIP_ROW;
  return { labelled, per, colW: labelled ? width / cols : CHIP_W, step, height: Math.ceil(items.length / per) * step };
}
function drawItems(out, items, x, y, width, cols = 1) {
  const l = itemsLayout(items, width, cols);
  const rowsPerCol = Math.ceil(items.length / l.per);
  items.forEach((it, k) => {
    // labelled: fill column by column; chips: fill row by row
    const [c, r] = l.labelled ? [Math.floor(k / rowsPerCol), k % rowsPerCol] : [k % l.per, Math.floor(k / l.per)];
    const text = l.labelled ? it.label : it.id ?? it.label;
    out.push(`<text x="${x + c * l.colW}" y="${y + r * l.step}" font-size="${l.labelled ? 16 : 15}"><tspan class="${CLS[it.status]}">${ICON[it.status]}</tspan><tspan dx="${l.labelled ? 8 : 5}">${esc(text)}</tspan></text>`);
  });
}

function render(board, jPhase, phaseRows, dIds) {
  const byId = Object.fromEntries(board.filter((t) => /^[JD]/.test(t.id)).map((t) => [t.id, t]));
  const item = (id) => ({ id, status: byId[id]?.status ?? 'open', label: `${id} ${cut(journeyText[id] ?? '', 21)}` });
  const journeys = Object.keys(jPhase).sort();
  const cols = phaseRows.map((p) => {
    let items = journeys.filter((j) => jPhase[j] === p.key).map(item);
    if (p.key === '0') items = board.filter((t) => t.id === 'P0').map((t) => ({ status: t.status, label: cut(t.title.slice(3), 25) }));
    else if (p.key === 'after' && !items.length) items = p.name.split(' + ').map((label) => ({ status: 'open', label }));
    const done = items.length > 0 && p.key !== 'after' && items.every((i) => i.status === 'done');
    return { ...p, items, done };
  });
  const firstOpen = cols.findIndex((c) => !c.done);
  cols.forEach((c, i) => { c.tag = c.done ? 'done' : i === firstOpen ? 'now' : i === firstOpen + 1 ? 'next' : 'later'; });

  const passed = journeys.filter((j) => byId[j]?.status === 'done').length;
  const free = dIds.map(item);
  const freeDone = free.filter((i) => i.status === 'done').length;
  const gaps = board.filter((t) => t.id === 'gap');
  const gapsDone = gaps.filter((t) => t.status === 'done').length;
  const PER_ROW = 4;
  const colW = (W - 2 * PAD - GAP * (PER_ROW - 1)) / PER_ROW;
  const inner = colW - 40;
  const rows = [];
  for (let i = 0; i < cols.length; i += PER_ROW) rows.push(cols.slice(i, i + PER_ROW));
  const rowH = rows.map((r) => 124 + Math.max(...r.map((c) => itemsLayout(c.items, inner).height)));
  const barW = W - 2 * PAD;
  const laneH = free.length ? 124 + itemsLayout(free, barW - 40, PER_ROW).height : 0;
  const H = TOP + rowH.reduce((n, h) => n + h + GAP, 0) + (laneH && laneH + GAP) + 52;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">Barkpark Studio roadmap</title>`);
  out.push(`<desc id="d">${passed} of ${journeys.length} journeys pass side by side. ${esc(cols.map((c) => `Phase ${c.key} ${c.name}: ${c.tag}`).join('. '))}. Freeform track: ${freeDone} of ${free.length}.</desc>`);
  out.push(`<style>
  svg { --bg:#fbfaf7; --card:#ffffff; --line:#e3e0d6; --ink:#1f1e1b; --muted:#6c6a63; --done:#2c7a4b; --now:#b26b00; --todo:#a3a097; --nowbg:#fff6e5; }
  @media (prefers-color-scheme: dark) {
    svg { --bg:#14161a; --card:#1c1f24; --line:#30343b; --ink:#ecebe6; --muted:#9a9ca3; --done:#6cc28f; --now:#e8b55a; --todo:#6d7179; --nowbg:#2a2418; }
  }
  text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: var(--ink); }
  .muted { fill: var(--muted); } .done { fill: var(--done); } .now { fill: var(--now); } .todo { fill: var(--todo); }
  .bg { fill: var(--bg); } .track { fill: var(--line); } .bar { fill: var(--done); } .rule { stroke: var(--line); }
  .card { fill: var(--card); stroke: var(--line); } .card.on { fill: var(--nowbg); stroke: var(--now); stroke-width: 2; }
</style>`);
  out.push(`<rect class="bg" width="${W}" height="${H}" rx="16"/>`);
  out.push(`<text x="${PAD}" y="70" font-size="36" font-weight="700" letter-spacing="-0.8">Barkpark Studio</text>`);
  out.push(`<text x="${PAD}" y="102" font-size="19" class="muted">Sanity-quality editing on Barkpark, one journey at a time.</text>`);
  out.push(`<text x="${W - PAD}" y="70" font-size="40" font-weight="700" text-anchor="end">${passed}<tspan class="muted" font-weight="400"> / ${journeys.length}</tspan></text>`);
  out.push(`<text x="${W - PAD}" y="102" font-size="16" text-anchor="end" class="muted">journeys pass side by side</text>`);
  out.push(`<rect x="${PAD}" y="124" width="${barW}" height="8" rx="4" class="track"/>`);
  if (passed) out.push(`<rect x="${PAD}" y="124" width="${(barW * passed) / journeys.length}" height="8" rx="4" class="bar"/>`);
  out.push(`<text x="${PAD}" y="168" font-size="16"><tspan class="done">✓ passed</tspan><tspan class="now" dx="24">◐ in progress</tspan><tspan class="todo" dx="24">○ to do</tspan><tspan class="muted" dx="24">★ crown phase, built first</tspan></text>`);
  out.push(`<text x="${W - PAD}" y="168" font-size="16" text-anchor="end" class="muted">Barkpark server gaps closed: ${gapsDone} / ${gaps.length}</text>`);

  let y0 = TOP;
  rows.forEach((row, r) => {
    row.forEach((c, i) => {
      const x = PAD + i * (colW + GAP);
      const tagCls = { done: 'done', now: 'now', next: 'muted', later: 'todo' }[c.tag];
      out.push(`<g data-phase="${c.key}">`);
      out.push(`<rect x="${x}" y="${y0}" width="${colW}" height="${rowH[r]}" rx="12" class="card${c.tag === 'now' ? ' on' : ''}"/>`);
      out.push(`<text x="${x + 20}" y="${y0 + 32}" font-size="13" font-weight="700" letter-spacing="1.5" class="muted">${c.key === 'after' ? 'AFTER' : `PHASE ${c.key}`}</text>`);
      out.push(`<text x="${x + colW - 20}" y="${y0 + 32}" font-size="13" font-weight="700" letter-spacing="1.5" text-anchor="end" class="${tagCls}">${c.tag.toUpperCase()}</text>`);
      out.push(`<text x="${x + 20}" y="${y0 + 66}" font-size="${c.name.length > 17 ? 19 : 23}" font-weight="600">${esc(c.name)}</text>`);
      out.push(`<path d="M${x + 20} ${y0 + 86}H${x + colW - 20}" class="rule"/>`);
      drawItems(out, c.items, x + 20, y0 + 118, inner);
      out.push(`</g>`);
    });
    y0 += rowH[r] + GAP;
  });
  if (laneH) {
    out.push(`<g data-track="freeform">`);
    out.push(`<rect x="${PAD}" y="${y0}" width="${barW}" height="${laneH}" rx="12" class="card"/>`);
    out.push(`<text x="${PAD + 20}" y="${y0 + 32}" font-size="13" font-weight="700" letter-spacing="1.5" class="muted">SIDE TRACK · COUNTED APART</text>`);
    out.push(`<text x="${W - PAD - 20}" y="${y0 + 32}" font-size="13" font-weight="700" letter-spacing="1.5" text-anchor="end" class="muted">D-JOURNEYS PASS</text>`);
    out.push(`<text x="${PAD + 20}" y="${y0 + 66}" font-size="23" font-weight="600">Freeform<tspan class="muted" font-weight="400" font-size="17" dx="12">PortableDoc documents in Barkpark's shared canvas</tspan></text>`);
    out.push(`<text x="${W - PAD - 20}" y="${y0 + 66}" font-size="26" font-weight="700" text-anchor="end">${freeDone}<tspan class="muted" font-weight="400"> / ${free.length}</tspan></text>`);
    out.push(`<path d="M${PAD + 20} ${y0 + 86}H${W - PAD - 20}" class="rule"/>`);
    drawItems(out, free, PAD + 20, y0 + 118, barW - 40, PER_ROW);
    out.push(`</g>`);
  }
  out.push(`<text x="${PAD}" y="${H - 30}" font-size="14" class="muted">Generated from the task board by scripts/generate-roadmap.mjs. Phases: docs/ROADMAP.md · journeys: JOURNEYS.md · bar: QUALITY.md</text>`);
  out.push(`</svg>\n`);
  return out.join('\n');
}

const svg = render(await tasks(), journeyPhases(), phases(), freeformJourneys());
if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== svg) {
  fs.mkdirSync(new URL('.', OUT), { recursive: true });
  fs.writeFileSync(OUT, svg);
  console.log('wrote docs/images/roadmap.svg');
}
