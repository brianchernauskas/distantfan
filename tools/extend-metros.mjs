// Makes sure every live listing sits within COVER_KM of an entry in assets/js/metros.js, so the city
// picker (and the Users tab / /watch/in pages) can reach it. Greedy: repeatedly take the city with the
// most uncovered spots, add it as a metro at the centroid of those spots, and recount.
//   node tools/extend-metros.mjs            add the missing cities
//   node tools/extend-metros.mjs --dry-run  list what would be added
// New entries are appended, so the existing size ordering (used by build-pages for thin pages) is kept.
import fs from 'node:fs';
import { METROS } from '../assets/js/metros.js';

const COVER_KM = 40; // the city view's widest radius (WIDE_KM in app.js)
const dry = process.argv.includes('--dry-run');
const file = new URL('../assets/js/metros.js', import.meta.url);
const spots = JSON.parse(fs.readFileSync(new URL('../data/spots.json', import.meta.url), 'utf8')).spots
  .filter(s => (!s.expiresAt || s.expiresAt > Date.now()) && Number.isFinite(s.lat) && Number.isFinite(s.lng));

const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const cityOf = s => {
  const m = String(s.address || '').match(/,\s*([^,]+),\s*([A-Z]{2})\b/) || String(s.city || '').match(/^([^,]+),\s*([A-Z]{2})$/);
  return m ? { name: m[1].trim(), st: m[2] } : null;
};

const all = [...METROS];
const added = [];
const unnamed = [];
for (;;) {
  const open = spots.filter(s => !all.some(m => km(s, m) <= COVER_KM));
  if (!open.length) break;
  const groups = new Map();
  for (const s of open) {
    const c = cityOf(s);
    if (!c) { unnamed.push(s); continue; }
    const k = `${c.name}|${c.st}`;
    (groups.get(k) || groups.set(k, { ...c, spots: [] }).get(k)).spots.push(s);
  }
  if (!groups.size) break;
  const best = [...groups.values()].sort((a, b) => b.spots.length - a.spots.length || a.name.localeCompare(b.name))[0];
  const lat = best.spots.reduce((t, s) => t + s.lat, 0) / best.spots.length;
  const lng = best.spots.reduce((t, s) => t + s.lng, 0) / best.spots.length;
  const m = { name: best.name, st: best.st, lat: +lat.toFixed(2), lng: +lng.toFixed(2) };
  // Never let two entries share name+state; the picker looks entries up by that pair.
  if (all.some(x => x.name === m.name && x.st === m.st)) { for (const s of best.spots) s.lat = s.lng = NaN; continue; }
  all.push(m); added.push({ ...m, n: best.spots.length });
  for (let i = spots.length - 1; i >= 0; i--) if (!Number.isFinite(spots[i].lat)) spots.splice(i, 1);
}

console.log(`${added.length} cities to add; ${new Set(unnamed).size} uncovered spots have no parseable city`);
for (const a of added) console.log(`  ${a.name}, ${a.st}  (${a.n} spot${a.n === 1 ? '' : 's'})`);
if (dry || !added.length) process.exit(0);

let src = fs.readFileSync(file, 'utf8');
const nl = src.includes('\r\n') ? '\r\n' : '\n';
const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const lines = added.map(m => `  { name: '${esc(m.name)}', st: '${m.st}', lat: ${m.lat.toFixed(2)}, lng: ${m.lng.toFixed(2)} },`).join(nl);
const end = src.lastIndexOf('];');
src = src.slice(0, end) + `  // Added by tools/extend-metros.mjs so every listing is within ${COVER_KM} km of a pickable city.${nl}${lines}${nl}` + src.slice(end);
fs.writeFileSync(file, src);
console.log(`metros.js: ${METROS.length} -> ${all.length}`);
