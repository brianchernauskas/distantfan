// Gap pass helper: works through (metro, away NFL team) pairs that have no listed spots, biggest metros first.
// It only produces work items and records outcomes; it never writes to Firestore.
//   node gap-pass.mjs next [n=10]        next n pairs: {pair, metro, metroLabel, team, teamName}
//   node gap-pass.mjs done <pair> <outcome> [note]   outcome: found | none | stale | skipped
//   node gap-pass.mjs status
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, areaFor } from './lib.mjs';
import { TEAMS } from '../../assets/js/teams.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPOTS = path.join(here, '..', '..', 'data', 'spots.json');
const STATE = path.join(here, 'runs', 'gap-pass-state.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const state = readJson(STATE, { done: {} });
const save = () => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); };

const raw = readJson(SPOTS, []);
const spots = Array.isArray(raw) ? raw : Object.values(raw.spots || raw);
const nfl = TEAMS.filter(t => t.lg === 'nfl');
const have = {};
for (const s of spots) {
  if (s.lat == null) continue;
  const k = areaFor({ lat: s.lat, lng: s.lng });
  if (!k) continue;
  for (const t of s.teams || []) (have[k] ??= {})[t] = (have[k][t] || 0) + 1;
}
// Biggest-impact metros first (Phoenix is the owner's home market).
const ORDER = ['phx', 'lv', 'dfw', 'hou', 'den', 'atl', 'chi', 'la', 'sd', 'tb', 'clt', 'sea', 'aus', 'sa', 'dc', 'nyc', 'mia', 'sf', 'orl', 'pdx', 'sac', 'cmh', 'phl', 'bos', 'det', 'msp', 'stl', 'bal', 'pit'];

const pairs = [];
for (const k of ORDER) {
  const a = AREAS[k];
  if (!a) continue;
  for (const t of nfl) {
    if ((a.homeTeams || []).includes(t.id)) continue;
    if ((have[k] || {})[t.id]) continue;
    pairs.push({ pair: `${k}:${t.id}`, metro: k, metroLabel: a.label, team: t.id, teamName: t.name });
  }
}

const cmd = process.argv[2];
if (cmd === 'next') {
  const n = Number(process.argv[3] || 10);
  console.log(JSON.stringify(pairs.filter(p => !state.done[p.pair]).slice(0, n)));
  console.error(`remaining pairs: ${pairs.filter(p => !state.done[p.pair]).length} of ${pairs.length}`);
} else if (cmd === 'done') {
  const [pair, outcome, ...note] = process.argv.slice(3);
  state.done[pair] = { outcome, note: note.join(' '), at: new Date().toISOString() };
  save();
  console.log(`recorded ${pair}: ${outcome}`);
} else if (cmd === 'status') {
  const c = {};
  for (const v of Object.values(state.done)) c[v.outcome] = (c[v.outcome] || 0) + 1;
  console.log(JSON.stringify({ totalPairs: pairs.length, done: Object.keys(state.done).length, ...c }));
} else {
  console.error('usage: gap-pass.mjs next [n] | done <pair> <outcome> [note] | status');
  process.exit(2);
}
