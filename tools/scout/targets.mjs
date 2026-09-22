// Prints the teams to research this run, plus what the scout already has on the map for the area.
//   node targets.mjs                 this ISO week's bucket (1 of 4)
//   node targets.mjs --all           every team
//   node targets.mjs --bucket 2      a specific bucket
//   node targets.mjs --no-db         skip the Firestore read (no admin key needed)
import { AREAS, ROTATION, scoutTeams, isoWeek, adminDb } from './lib.mjs';

const args = process.argv.slice(2);
const area = args.includes('--area') ? args[args.indexOf('--area') + 1] : 'phoenix';
const all = scoutTeams(area);
const bucket = args.includes('--bucket') ? +args[args.indexOf('--bucket') + 1] : isoWeek() % ROTATION;
const teams = args.includes('--all') ? all : all.filter((_, i) => i % ROTATION === bucket);

let onMap = [];
if (!args.includes('--no-db')) {
  const db = await adminDb();
  const snap = await db.collection('spots').get();
  const { center, radiusKm } = AREAS[area];
  const { km } = await import('./lib.mjs');
  onMap = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(s => km(center, s) <= radiusKm)
    .map(s => ({ id: s.id, name: s.name, address: s.address, teams: s.teams, source: s.source || 'fan', checkedAt: s.checkedAt ? new Date(s.checkedAt).toISOString().slice(0, 10) : null, eventAt: s.eventAt || null }));
}

console.log(JSON.stringify({ area, bucket: args.includes('--all') ? 'all' : bucket, teams, onMap }, null, 1));
