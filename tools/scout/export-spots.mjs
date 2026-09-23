// Export data/spots.json (every watch spot) and data/fans.json (fan counts per team per coarse home
// cell - no names, no uids) so the site can serve them from GitHub Pages instead of
// reading whole collections from Firestore on every page view. The app loads spots.json, then asks
// Firestore only for spots created after `generatedAt`; fans.json is counts only, so it is served as-is.
//
//   node tools/scout/export-spots.mjs           write both files (each skipped if nothing changed)
//   node tools/scout/export-spots.mjs --commit  ...then git add/commit/push it
//
// Run it after each scout run (apply.mjs) and whenever spots are removed by hand. Expired spots are
// dropped here; deletions made after an export only reach visitors at the next export.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adminDb } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'data');
const db = await adminDb();

// Back-date a minute so a spot written while the export runs is still caught by the app's delta query.
const generatedAt = Date.now() - 60_000;
const fansAt = generatedAt;
const snap = await db.collection('spots').get();
const ms = v => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : 0);

const spots = snap.docs
  .map(d => {
    const { createdAt, ...s } = d.data();
    return { id: d.id, ...s, createdAt: ms(createdAt) };
  })
  .filter(s => !s.expiresAt || s.expiresAt > Date.now())
  .sort((a, b) => a.id.localeCompare(b.id));

// Keep each file byte-stable when nothing changed so git history isn't noise.
function write(name, key, payload) {
  const out = path.join(dir, name);
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
  if (prev && JSON.stringify(prev[key]) === JSON.stringify(payload[key])) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload));
  console.error(`wrote ${name} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  return true;
}
const changed = [write('spots.json', 'spots', { generatedAt, count: spots.length, spots })];

// Fan counts: { teamId: { homeCell: n } }. A fan following several teams counts once under each.
const profiles = await db.collection('profiles').get();
const teams = {};
for (const d of profiles.docs) {
  const { teams: ts, cell: full } = d.data();
  if (!full || !Array.isArray(ts)) continue;
  const cell = full.slice(0, 4); // this file is public, so coarsen to ~39x20 km (profiles hold up to 5 chars)
  for (const t of ts) { const m = (teams[t] ||= {}); m[cell] = (m[cell] || 0) + 1; }
}
const sorted = Object.fromEntries(Object.keys(teams).sort().map(t => [t, Object.fromEntries(Object.entries(teams[t]).sort())]));
changed.push(write('fans.json', 'teams', { generatedAt: fansAt, fans: profiles.size, teams: sorted }));
console.error(`spots ${spots.length}, fans ${profiles.size}; firestore reads: ${snap.size + profiles.size}`);

if (changed.some(Boolean) && process.argv.includes('--commit')) {
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'inherit' });
  const files = ['data/spots.json', 'data/fans.json'];
  git('add', ...files);
  git('commit', '-m', `Refresh spot and fan snapshots (${spots.length} spots, ${profiles.size} fans)`, '--', ...files); // only these files, never other staged work
  git('push');
}
