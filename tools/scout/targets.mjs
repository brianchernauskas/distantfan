// Prints what the scout should research this run, plus what's already on the map.
//   node targets.mjs --mode directory          this ISO week's team bucket (1 of 4), all cities
//   node targets.mjs --mode directory --all    every team
//   node targets.mjs --mode city               today's cities (Mon–Fri rotation in CITY_DAYS)
//   node targets.mjs --mode city --cities dfw,hou
//   --no-db skips the Firestore read (no admin key needed)
import { AREAS, CITY_DAYS, ROTATION, scoutTeams, isoWeek, adminDb, areaFor } from './lib.mjs';

const args = process.argv.slice(2);
const opt = k => args.includes(k) ? args[args.indexOf(k) + 1] : null;
const mode = opt('--mode') || 'directory';

const cityList = () => Object.entries(AREAS).map(([key, a]) => ({ key, label: a.label, homeTeams: a.homeTeams }));

let out;
if (mode === 'directory') {
  const all = scoutTeams();
  const bucket = opt('--bucket') != null ? +opt('--bucket') : isoWeek() % ROTATION;
  out = { mode, bucket: args.includes('--all') ? 'all' : bucket,
    teams: args.includes('--all') ? all : all.filter((_, i) => i % ROTATION === bucket),
    cities: cityList() };
} else if (mode === 'city') {
  const dow = new Date().getDay(); // 0 Sun .. 6 Sat
  const keys = opt('--cities') ? opt('--cities').split(',') : (CITY_DAYS[dow - 1] || []);
  for (const k of keys) if (!AREAS[k]) throw new Error(`Unknown city ${k}. Known: ${Object.keys(AREAS).join(', ')}`);
  out = { mode, cities: cityList().filter(c => keys.includes(c.key)),
    note: keys.length ? undefined : 'Weekend: no cities scheduled. Pass --cities to run anyway.' };
} else throw new Error(`Unknown --mode ${mode}`);

// Existing listings, grouped by city, so the scout can re-confirm rather than rediscover.
if (!args.includes('--no-db')) {
  const db = await adminDb();
  const wantTeams = out.teams ? new Set(out.teams.map(t => t.id)) : null;
  const wantCities = new Set(out.cities.map(c => c.key));
  // Query instead of scanning every spot (free tier is 50k reads/day). Directory mode asks for spots
  // listing any bucket team (array-contains-any takes at most 30 values); city mode asks for the
  // day's cities (`in` takes at most 30). Spots without a `city` field (older fan-added ones) aren't
  // returned in city mode; they don't need re-confirming and apply.mjs still dedupes against them.
  const col = db.collection('spots');
  const queries = wantTeams
    ? [...wantTeams].reduce((a, t, i) => ((a[Math.floor(i / 30)] ||= []).push(t), a), []).map(ids => col.where('teams', 'array-contains-any', ids))
    : [col.where('city', 'in', [...wantCities].slice(0, 30))];
  const docs = new Map();
  for (const q of queries) for (const d of (await q.get()).docs) docs.set(d.id, d);
  console.error(`firestore reads this run: ~${docs.size || 1}+`);
  const onMap = {};
  for (const d of docs.values()) {
    const s = d.data(), city = s.city || areaFor(s);
    if (!city || !wantCities.has(city)) continue;
    if (wantTeams && !(s.teams || []).some(t => wantTeams.has(t))) continue;
    (onMap[city] ||= []).push({ name: s.name, address: s.address, teams: s.teams, source: s.source || 'fan',
      checkedAt: s.checkedAt ? new Date(s.checkedAt).toISOString().slice(0, 10) : null,
      eventAt: s.eventAt ? new Date(s.eventAt).toISOString() : undefined });
  }
  out.onMap = onMap;
}

console.log(JSON.stringify(out, null, 1));
