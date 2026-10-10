// Prints, for each tracked metro, the NFL teams with zero listed spots (away teams only).
// A fast way to see where a club-first search (booster club / fan club Facebook and Instagram pages) will pay off.
//   node gap-matrix.mjs [areaKey]     e.g. node gap-matrix.mjs phx
import fs from 'node:fs';
import { AREAS, areaFor } from './lib.mjs';
const raw = JSON.parse(fs.readFileSync(new URL('../../data/spots.json', import.meta.url), 'utf8'));
const spots = Array.isArray(raw) ? raw : Object.values(raw.spots || raw);
const nfl = [...new Set(spots.flatMap(s => s.teams || []).filter(t => t.startsWith('nfl-')))].sort();
const have = {};
for (const s of spots) {
  if (s.lat == null) continue;
  const k = areaFor({ lat: s.lat, lng: s.lng });
  if (!k) continue;
  for (const t of s.teams || []) if (t.startsWith('nfl-')) (have[k] ??= {})[t] = (have[k][t] || 0) + 1;
}
const only = process.argv[2];
for (const [k, a] of Object.entries(AREAS)) {
  if (only && k !== only) continue;
  const zero = nfl.filter(t => !(a.homeTeams || []).includes(t) && !(have[k] || {})[t]);
  console.log(`${k} ${a.label}: ${zero.length} away teams with no spots: ${zero.map(t => t.slice(4)).join(' ')}`);
}
