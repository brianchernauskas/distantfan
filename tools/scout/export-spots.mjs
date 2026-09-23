// Export every watch spot to data/spots.json so the site can serve them from GitHub Pages instead of
// reading the whole collection from Firestore on every page view. The app loads this file, then asks
// Firestore only for spots created after `generatedAt`.
//
//   node tools/scout/export-spots.mjs           write data/spots.json (skips if nothing changed)
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
const out = path.join(root, 'data', 'spots.json');
const db = await adminDb();

// Back-date a minute so a spot written while the export runs is still caught by the app's delta query.
const generatedAt = Date.now() - 60_000;
const snap = await db.collection('spots').get();
const ms = v => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : 0);

const spots = snap.docs
  .map(d => {
    const { createdAt, ...s } = d.data();
    return { id: d.id, ...s, createdAt: ms(createdAt) };
  })
  .filter(s => !s.expiresAt || s.expiresAt > Date.now())
  .sort((a, b) => a.id.localeCompare(b.id));

// Keep the file byte-stable when nothing changed so git history isn't noise.
let prev = null;
try { prev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
const same = prev && JSON.stringify(prev.spots) === JSON.stringify(spots);
if (same) {
  console.error(`spots unchanged (${spots.length}); firestore reads: ${snap.size}`);
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt, count: spots.length, spots }));
  console.error(`wrote ${spots.length} spots (${(fs.statSync(out).size / 1024).toFixed(0)} KB); firestore reads: ${snap.size}`);
}

if (!same && process.argv.includes('--commit')) {
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'inherit' });
  git('add', 'data/spots.json');
  git('commit', '-m', `Refresh spots snapshot (${spots.length})`, '--', 'data/spots.json'); // only this file, never other staged work
  git('push');
}
