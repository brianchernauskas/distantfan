// Closure sweep helper: finds listed venues that Google Maps marks "Permanently closed".
// Read-only against the map: it reads data/spots.json and writes only runs/closure-sweep-*.
//   node closure-sweep.mjs next [n=12]        print the next n unchecked venues with a Maps search URL
//   node closure-sweep.mjs record <file.json> record browser results: [{id, n, c, t}] (n = place name or null,
//                                             c = "Permanently closed" seen, t = "Temporarily closed" seen)
//   node closure-sweep.mjs status             counts by outcome
// Outcomes: closed | temp | mismatch (Maps returned a different place) | unverified (no single place) | open
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPOTS = path.join(here, '..', '..', 'data', 'spots.json');
const STATE = path.join(here, 'runs', 'closure-sweep-state.json');
const REPORT = path.join(here, 'runs', 'closure-sweep-report.md');

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const spotsRaw = readJson(SPOTS, []);
const spots = Array.isArray(spotsRaw) ? spotsRaw : Object.values(spotsRaw.spots || spotsRaw);
const byId = new Map(spots.map(s => [s.id, s]));
const state = readJson(STATE, { checked: {} });
const save = () => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); };

const toks = s => new Set(String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter(t => t.length > 2 && !['the', 'and', 'bar', 'pub', 'grill', 'grille', 'sports', 'tavern'].includes(t)));
function classify(spot, r) {
  if (!r.n || r.n === 'Results') return 'unverified';
  const a = toks(spot.name), b = toks(r.n);
  const overlap = [...a].filter(t => b.has(t)).length;
  if (a.size && overlap === 0) return 'mismatch';
  if (r.c) return 'closed';
  if (r.t) return 'temp';
  return 'open';
}

const cmd = process.argv[2];
if (cmd === 'next') {
  const n = Number(process.argv[3] || 12);
  // Group by source so a list that went stale is checked together; skip anything already checked.
  const todo = spots.filter(s => s.id && !state.checked[s.id] && s.name && s.address)
    .sort((a, b) => String(a.sourceName).localeCompare(String(b.sourceName)) || a.id.localeCompare(b.id)).slice(0, n);
  console.log(JSON.stringify(todo.map(s => ({
    id: s.id, name: s.name, address: s.address,
    url: 'https://www.google.com/maps/search/' + encodeURIComponent(`${s.name} ${s.address}`).replace(/%20/g, '+'),
  }))));
  console.error(`remaining unchecked: ${spots.filter(s => s.id && !state.checked[s.id]).length}`);
} else if (cmd === 'record') {
  const rows = readJson(process.argv[3], []);
  let k = 0;
  for (const r of rows) {
    const s = byId.get(r.id);
    if (!s) continue;
    state.checked[r.id] = { name: s.name, address: s.address, maps: r.n ?? null, outcome: classify(s, r), at: new Date().toISOString() };
    k++;
  }
  save();
  const out = Object.entries(state.checked).map(([id, v]) => ({ id, ...v }));
  const sec = (title, o) => `## ${title} (${out.filter(v => v.outcome === o).length})\n` +
    out.filter(v => v.outcome === o).map(v => `- ${v.name} | ${v.address} | \`${v.id}\`${v.maps && v.maps !== v.name ? ` | Maps: ${v.maps}` : ''}`).join('\n') + '\n';
  fs.writeFileSync(REPORT, `# Closure sweep report\nUpdated ${new Date().toISOString()}. Checked ${out.length} venues. Nothing has been removed; review before deleting.\n\n` +
    sec('Permanently closed on Google Maps', 'closed') + '\n' + sec('Temporarily closed', 'temp') + '\n' +
    sec('Maps returned a different place (verify by hand)', 'mismatch') + '\n' + sec('No single match (verify by hand)', 'unverified'));
  console.log(`recorded ${k}; total checked ${out.length}; closed so far ${out.filter(v => v.outcome === 'closed').length}`);
} else if (cmd === 'status') {
  const c = {};
  for (const v of Object.values(state.checked)) c[v.outcome] = (c[v.outcome] || 0) + 1;
  console.log(JSON.stringify({ checked: Object.keys(state.checked).length, unchecked: spots.length - Object.keys(state.checked).length, ...c }));
} else {
  console.error('usage: closure-sweep.mjs next [n] | record <file.json> | status');
  process.exit(2);
}
