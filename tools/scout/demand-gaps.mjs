// Demand-ranked gap list: (metro, away team) pairs where fans are likely searching but the map has
// nothing (0 spots) or a thin page (1-2 spots). Feeds the off-peak distantfan-demand-gaps routine.
// It only ranks work and records outcomes; it never writes to Firestore.
//   node demand-gaps.mjs top [n=30]       ranked list with the score breakdown (read-only)
//   node demand-gaps.mjs next [n=8]       next n pairs not on cooldown: {pair, metro, metroLabel, team, teamName, have, why}
//   node demand-gaps.mjs done <pair> <outcome> [note]   outcome: found | none | stale | skipped
//   node demand-gaps.mjs status
// Demand signals, strongest first:
//   1. Search Console queries naming a team and a metro (needs the Search Console API enabled for the
//      Firebase project and the admin service account added to the property; skipped quietly until then).
//   2. GA4 landing-page sessions (last 28 days) on that team's pages and on that team x city page.
//   3. A static prior: fan-base size x metro size, Sun Belt transplant metros boosted, league in season.
// --no-api skips 1 and 2 (prior only, no network).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, areaFor, scoutTeams, credentialPath } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const STATE = path.join(here, 'runs', 'demand-gaps-state.json');
const GAP_STATE = path.join(here, 'runs', 'gap-pass-state.json');   // the nightly NFL gap pass; its misses count too
const CACHE = path.join(here, 'runs', 'demand-signals.json');       // API pulls cached for 20h
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const args = process.argv.slice(2);
const state = readJson(STATE, { done: {} });
const save = () => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); };

const DAY = 864e5;
const COOLDOWN = { none: 45, stale: 30, skipped: 7, found: 21 };   // days before a pair comes back

// ---- static prior ----
const MONTH = new Date().getMonth() + 1;
const IN_SEASON = { nfl: [9, 10, 11, 12, 1], cfb: [9, 10, 11, 12, 1], nba: [10, 11, 12, 1, 2, 3, 4, 5, 6], nhl: [10, 11, 12, 1, 2, 3, 4, 5, 6],
  mlb: [4, 5, 6, 7, 8, 9, 10], mls: [3, 4, 5, 6, 7, 8, 9, 10, 11], cbb: [11, 12, 1, 2, 3] };
const LEAGUE_W = { nfl: 1, cfb: 0.45, nba: 0.3, nhl: 0.22, mlb: 0.25, mls: 0.12, cbb: 0.2 };
// Biggest travelling fan bases. NFL: national brands; CFB: the top-20 fan bases used for the Sep 23 sweep.
const BIG_NFL = { 'nfl-dal': 1.5, 'nfl-gb': 1.45, 'nfl-pit': 1.45, 'nfl-kc': 1.35, 'nfl-sf': 1.3, 'nfl-phi': 1.3, 'nfl-chi': 1.3,
  'nfl-lv': 1.3, 'nfl-ne': 1.25, 'nfl-buf': 1.25, 'nfl-nyg': 1.15, 'nfl-sea': 1.15, 'nfl-den': 1.15, 'nfl-det': 1.15, 'nfl-cle': 1.1 };
const BIG_CFB = { 'cfb-194': 2, 'cfb-333': 2, 'cfb-130': 1.9, 'cfb-251': 1.9, 'cfb-61': 1.8, 'cfb-99': 1.7, 'cfb-87': 1.8, 'cfb-213': 1.7,
  'cfb-201': 1.5, 'cfb-158': 1.5, 'cfb-228': 1.4, 'cfb-52': 1.4, 'cfb-2633': 1.6, 'cfb-2': 1.5, 'cfb-245': 1.5, 'cfb-30': 1.4,
  'cfb-57': 1.5, 'cfb-2483': 1.3, 'cfb-275': 1.3, 'cfb-2579': 1.1, 'cfb-145': 1.1, 'cfb-96': 1 };
// Metro population (millions, 2025 est.) and the transplant-heavy metros where out-of-market fans pile up.
const POP = { nyc: 19.5, la: 12.8, chi: 9.3, dfw: 8.3, hou: 7.5, atl: 6.4, dc: 6.4, mia: 6.2, phl: 6.2, phx: 5.1, bos: 4.9, sf: 4.6,
  det: 4.3, sea: 4.1, msp: 3.7, sd: 3.3, tb: 3.4, den: 3, sa: 2.7, stl: 2.8, bal: 2.8, orl: 2.8, clt: 2.8, lv: 2.4, pdx: 2.5,
  aus: 2.5, sac: 2.4, cmh: 2.2, pit: 2.4, nsh: 2.1 };
const TRANSPLANT = { phx: 1.4, lv: 1.4, dfw: 1.25, hou: 1.2, atl: 1.2, tb: 1.35, clt: 1.3, aus: 1.3, orl: 1.3, den: 1.25, sa: 1.15,
  mia: 1.2, sd: 1.15, dc: 1.15, sea: 1.1, sac: 1.05, pdx: 1.05, la: 1.05, nyc: 1.05, nsh: 1.35 };
const LEAGUES = (process.env.DEMAND_LEAGUES || 'nfl,cfb,nba,nhl').split(',');

const teams = scoutTeams().filter(t => LEAGUES.includes(t.league) && IN_SEASON[t.league].includes(MONTH));
const prior = t => LEAGUE_W[t.league] * (t.league === 'nfl' ? BIG_NFL[t.id] || 1 : t.league === 'cfb' ? BIG_CFB[t.id] || 0.6 : 1);
const metroW = k => Math.sqrt(POP[k] || 2) * (TRANSPLANT[k] || 1);

// ---- what the map has ----
const slugify = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const raw = readJson(path.join(ROOT, 'data', 'spots.json'), []);
const spots = Array.isArray(raw) ? raw : Object.values(raw.spots || raw);
const have = {};          // metro -> team -> spot count
const cityArea = {};      // "phoenix-az" -> "phx"
for (const s of spots) {
  if (s.lat == null) continue;
  const k = areaFor({ lat: s.lat, lng: s.lng });
  if (!k) continue;
  if (s.city) cityArea[slugify(s.city.replace(',', ''))] = k;
  for (const t of s.teams || []) (have[k] ??= {})[t] = (have[k][t] || 0) + 1;
}

// ---- observed demand (cached) ----
const idx = readJson(path.join(ROOT, 'data', 'watch-index.json'), { teams: {} }).teams;
const teamBySlug = Object.fromEntries(Object.entries(idx).map(([id, v]) => [v.ts, id]));
async function pullSignals() {
  const cached = readJson(CACHE, null);
  if (cached && Date.now() - cached.at < 20 * 3600e3) return cached;
  const out = { at: Date.now(), pages: [], queries: [], notes: [] };
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ keyFile: credentialPath(), scopes: ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/webmasters.readonly'] });
  const client = await auth.getClient();
  const req = (url, data) => client.request({ url, method: 'POST', data, validateStatus: () => true, timeout: 30000 });
  const ga = await req(`https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA_PROPERTY || '555364902'}:runReport`, {
    dateRanges: [{ startDate: '27daysAgo', endDate: 'today' }], dimensions: [{ name: 'landingPage' }], metrics: [{ name: 'sessions' }],
    dimensionFilter: { filter: { fieldName: 'landingPage', stringFilter: { matchType: 'BEGINS_WITH', value: '/watch/' } } }, limit: 5000 });
  if (ga.status === 200) out.pages = (ga.data.rows || []).map(r => [r.dimensionValues[0].value, +r.metricValues[0].value]);
  else out.notes.push(`GA4 ${ga.status}: ${ga.data?.error?.message?.slice(0, 120)}`);
  const end = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10), start = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const sc = await req('https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Adistantfan.com/searchAnalytics/query',
    { startDate: start, endDate: end, dimensions: ['query'], rowLimit: 5000 });
  if (sc.status === 200) out.queries = (sc.data.rows || []).map(r => [r.keys[0], r.impressions, r.clicks]);
  else out.notes.push(`Search Console ${sc.status} (enable the API and add the service account to use query demand)`);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(out));
  return out;
}
let sig = { pages: [], queries: [], notes: ['--no-api'] };
if (!args.includes('--no-api')) {
  try { sig = await pullSignals(); } catch (e) { sig.notes = [`signals failed, prior only: ${String(e.message).slice(0, 120)}`]; }
}
const teamSess = {}, pairSess = {}, pairImpr = {};
for (const [p, n] of sig.pages) {
  const [, , ts, city] = p.split('/');
  const tid = teamBySlug[ts];
  if (!tid) continue;
  teamSess[tid] = (teamSess[tid] || 0) + n;
  const k = city && cityArea[city];
  if (k) pairSess[`${k}:${tid}`] = (pairSess[`${k}:${tid}`] || 0) + n;
}
if (sig.queries.length) {
  // A query counts for a pair when it names the team (nickname or full name) and the metro or one of its cities.
  const cityWords = {};
  for (const [slug, k] of Object.entries(cityArea)) (cityWords[k] ??= new Set()).add(slug.replace(/-[a-z]{2}$/, '').replace(/-/g, ' '));
  for (const [k, a] of Object.entries(AREAS)) (cityWords[k] ??= new Set()).add(a.label.toLowerCase().split(/[–-]/)[0].trim());
  const teamWords = teams.map(t => [t.id, [t.name.replace(/ \((Football|Basketball)\)$/, '').toLowerCase(), t.name.split(' ').slice(-1)[0].replace(/[()]/g, '').toLowerCase()]]);
  for (const [q, impr] of sig.queries) {
    const ql = ` ${q.toLowerCase()} `;
    const ks = Object.entries(cityWords).filter(([, ws]) => [...ws].some(w => w.length > 3 && ql.includes(` ${w} `))).map(([k]) => k);
    if (!ks.length) continue;
    for (const [tid, ws] of teamWords) if (ws.some(w => ql.includes(` ${w} `) || ql.includes(w + ' '))) for (const k of ks) pairImpr[`${k}:${tid}`] = (pairImpr[`${k}:${tid}`] || 0) + impr;
  }
}

// ---- rank ----
const gapState = readJson(GAP_STATE, { done: {} }).done;
const coolUntil = rec => rec ? Date.parse(rec.at) + (COOLDOWN[rec.outcome] ?? 7) * DAY : 0;
const pairs = [];
for (const k of Object.keys(AREAS)) {
  for (const t of teams) {
    if ((AREAS[k].homeTeams || []).includes(t.id)) continue;
    const n = (have[k] || {})[t.id] || 0;
    if (n >= 3) continue;
    const pair = `${k}:${t.id}`;
    const gapF = [1, 0.75, 0.55][n];
    const obs = 1 + 0.6 * Math.log1p(pairSess[pair] || 0) + 0.15 * Math.log1p(teamSess[t.id] || 0) + 0.5 * Math.log1p(pairImpr[pair] || 0);
    const score = prior(t) * metroW(k) * obs * gapF;
    const why = [`${n} spots`, `team ${prior(t).toFixed(2)}`, `metro ${metroW(k).toFixed(2)}`];
    if (pairImpr[pair]) why.push(`${pairImpr[pair]} search impressions`);
    if (pairSess[pair]) why.push(`${pairSess[pair]} page sessions`);
    if (teamSess[t.id]) why.push(`team pages ${teamSess[t.id]} sessions`);
    const until = Math.max(coolUntil(state.done[pair]), coolUntil(gapState[pair]));
    pairs.push({ pair, metro: k, metroLabel: AREAS[k].label, team: t.id, teamName: t.name, have: n, score: +score.toFixed(3), why: why.join(', '), until });
  }
}
pairs.sort((a, b) => b.score - a.score);
const open = pairs.filter(p => p.until < Date.now());

const cmd = args[0];
const strip = ({ until, ...p }) => p;
if (cmd === 'top') {
  const n = Number(args[1] || 30);
  if (sig.notes.length) console.error(sig.notes.join('\n'));
  for (const p of pairs.slice(0, n)) console.log(`${p.score.toFixed(2).padStart(6)}  ${p.pair.padEnd(14)} ${p.teamName} in ${p.metroLabel}  [${p.why}]${p.until >= Date.now() ? '  (cooldown)' : ''}`);
} else if (cmd === 'next') {
  const n = Number(args[1] || 8);
  console.log(JSON.stringify(open.slice(0, n).map(strip)));
  console.error(`open pairs: ${open.length} of ${pairs.length}${sig.notes.length ? ' | ' + sig.notes.join(' | ') : ''}`);
} else if (cmd === 'done') {
  const [pair, outcome, ...note] = args.slice(1);
  if (!COOLDOWN[outcome]) { console.error('outcome must be found | none | stale | skipped'); process.exit(2); }
  state.done[pair] = { outcome, note: note.join(' '), at: new Date().toISOString() };
  save();
  console.log(`recorded ${pair}: ${outcome}`);
} else if (cmd === 'status') {
  const c = {};
  for (const v of Object.values(state.done)) c[v.outcome] = (c[v.outcome] || 0) + 1;
  console.log(JSON.stringify({ rankedPairs: pairs.length, open: open.length, zeroSpot: pairs.filter(p => !p.have).length, thin: pairs.filter(p => p.have).length, recorded: Object.keys(state.done).length, ...c, signals: { gaPages: sig.pages.length, scQueries: sig.queries.length, notes: sig.notes } }));
} else {
  console.error('usage: demand-gaps.mjs top [n] | next [n] | done <pair> <outcome> [note] | status   (--no-api for prior only)');
  process.exit(2);
}
