// Applies a scout candidates file to Firestore.
//   node apply.mjs runs/candidates-<mode>-2026-09-29.json [--dry-run]
// A find inside one of the tracked metros (see AREAS in lib.mjs) is filed under that metro's
// label. One outside them still goes on the map nationwide -- it's just labelled from its own
// address instead of a tracked metro, and doesn't get the "away from home market" treatment
// (there's no AREAS entry to define a home team for it) or the CITY_DAYS re-confirmation sweep,
// so it relies on directory mode re-confirming it before it expires.
//
// high confidence + geocoded address  → spots/{scout_<key>} (live on the map)
// medium confidence                   → scoutQueue/{key}   (Brian approves in the app's Review tab)
// low / unresolvable                  → reported, not written
// Also deletes scout spots past expiresAt and queue items older than 30 days.
import fs from 'node:fs';
import path from 'node:path';
import { AREAS, SPOT_TTL_DAYS, resolveTeam, venueKey, geocode, km, adminDb, areaFor, cityLabelFor } from './lib.mjs';

// "123 Main St, Louisville, KY 40202" -> "Louisville, KY". Falls back to the raw address when
// it doesn't look like a normal US "..., City, ST ..." tail.
function cityLabelFrom(address) {
  const m = String(address || '').match(/,\s*([A-Za-z .'-]+),\s*([A-Z]{2})\b/);
  return m ? `${m[1].trim()}, ${m[2]}` : clean(address, 60);
}
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const STOP = new Set('the and bar pub grill grille sports sport tavern restaurant inn house kitchen taphouse tap saloon irish of at downtown midtown uptown inc co company brewing brewery'.split(' '));
const nameToks = s => new Set(String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t && !STOP.has(t)));
const streetNum = a => (String(a).match(/^\s*(\d+)/) || [])[1];
function sameVenue(spot, cand) {
  const a = nameToks(spot.name), b = nameToks(cand.venue);
  const inter = [...a].filter(t => b.has(t)).length, sim = inter / (new Set([...a, ...b]).size || 1);
  return sim >= 0.5 || (streetNum(spot.address) && streetNum(spot.address) === streetNum(cand.address) && inter >= 1);
}

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const dry = args.includes('--dry-run');
if (!file) { console.error('usage: node apply.mjs <candidates.json> [--dry-run]'); process.exit(2); }

const input = JSON.parse(fs.readFileSync(file, 'utf8'));
// Directory mode reads a team's official away-fan-club/alumni directory, which by definition has
// nothing to say about that team's own home market. City and manual sweeps search more broadly
// ("best bars to watch the Cowboys in Dallas"), so a home-market team is a legitimate find there.
const ALLOW_HOME = input.mode !== 'directory';
const now = Date.now(), DAY = 864e5;
const db = await adminDb();
const { FieldValue } = await import('firebase-admin/firestore');

// Firestore's free tier allows 50k reads/day, so this never scans a whole collection. It fetches only
// (a) each candidate's own spot + reject docs by their deterministic ids, (b) spots near a candidate's
// coordinates for the dedupe checks, and (c) queries for expired docs. A run costs roughly two reads
// per candidate instead of every doc in spots, scoutRejects and scoutQueue.
let reads = 0;
const spots = new Map(), rejects = new Set(), queued = new Map();
const candKeys = new Set();
for (const c of input.candidates || []) {
  if (!c.venue || !c.address) continue;
  let key = venueKey(c.venue, c.address);
  if (c.kind === 'event') {
    const at = Date.parse(c.eventAt);
    if (!(at > now - DAY)) continue; // skipped in the loop below anyway
    key += `_${new Date(at).toISOString().slice(0, 10).replace(/-/g, '')}`;
  }
  candKeys.add(key);
}
const keyList = [...candKeys];
for (let i = 0; i < keyList.length; i += 200) {
  const snaps = await db.getAll(...keyList.slice(i, i + 200).flatMap(k => [db.doc(`spots/scout_${k}`), db.doc(`scoutRejects/${k}`)]));
  reads += snaps.length;
  for (const s of snaps) if (s.exists) (s.ref.parent.id === 'spots' ? spots.set(s.id, s.data()) : rejects.add(s.id));
}
// A queue doc only matters when we write to that key, so read it on demand.
async function queuedDoc(key) {
  if (!queued.has(key)) { const s = await db.doc(`scoutQueue/${key}`).get(); reads++; queued.set(key, s.exists ? s.data() : null); }
  return queued.get(key);
}
// Spots within ~330 m (latitude band; longitude is filtered in memory) for the near-duplicate checks.
const covered = [];
async function loadNear(geo) {
  const lo = geo.lat - 0.003, hi = geo.lat + 0.003;
  if (covered.some(([a, b]) => a <= lo && b >= hi)) return;
  const snap = await db.collection('spots').where('lat', '>=', lo).where('lat', '<=', hi).get();
  reads += Math.max(snap.size, 1);
  for (const d of snap.docs) if (!spots.has(d.id)) spots.set(d.id, d.data());
  covered.push([lo, hi]);
}
const report = { published: [], refreshed: [], queued: [], skipped: [], expired: [] };

for (const c of input.candidates || []) {
  const label = `${c.venue} (${(c.teams || []).join(', ')})`;
  const skip = why => report.skipped.push(`${label}: ${why}`);

  if (!c.venue || !c.address) { skip('missing venue or address'); continue; }
  if (!/^https?:\/\//.test(c.sourceUrl || '')) { skip('no source URL'); continue; }
  const conf = String(c.confidence || '').toLowerCase();
  if (!['high', 'medium'].includes(conf)) { skip(`confidence "${c.confidence}"`); continue; }

  const teams = [...new Set((c.teams || []).map(resolveTeam).filter(Boolean).map(t => t.id))];
  const unknown = (c.teams || []).filter(n => !resolveTeam(n));
  if (!teams.length) { skip(`no recognised team (${unknown.join(', ')})`); continue; }
  const isEvent = c.kind === 'event';
  const eventAt = isEvent ? Date.parse(c.eventAt) : NaN;
  if (isEvent && !(eventAt > now - DAY)) { skip(`event date missing or past (${c.eventAt})`); continue; }

  let key = venueKey(c.venue, c.address);
  if (isEvent) key += `_${new Date(eventAt).toISOString().slice(0, 10).replace(/-/g, '')}`;
  if (rejects.has(key)) { skip('previously rejected'); continue; }

  let docId = `scout_${key}`;
  let existing = spots.get(docId);
  // A candidate may carry hand-verified coordinates for addresses no geocoder can place (shopping-centre units,
  // new builds). Only used when the venue isn't already on the map, and only for plausible US coordinates.
  const manual = Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.lat > 18 && c.lat < 72 && c.lng < -65 && c.lng > -180 ? { lat: c.lat, lng: c.lng } : null;
  let geo = existing ? { lat: existing.lat, lng: existing.lng } : manual || await geocode(c.address);
  if (!geo) { skip(`could not geocode "${c.address}"`); continue; }
  await loadNear(geo);
  // Same venue under a different spelling ("Hudson Grille" vs "Hudson Grille Sandy Springs") hashes to a
  // different key, so also match an existing scout spot at the same spot with a similar name or street number.
  if (!existing && !isEvent) {
    const near = [...spots.entries()].find(([id, s]) => id.startsWith('scout_') && !s.eventAt && s.lat != null && km(s, geo) < 0.08 && sameVenue(s, c));
    if (near) { [docId, existing] = near; }
  }
  const areaKey = areaFor(geo);
  const area = areaKey ? AREAS[areaKey] : null;
  const city = areaKey || await cityLabelFor(c.address, geo);
  // Home teams aren't out-of-market in their own metro; keep the venue only for its visiting-team
  // fans there -- unless this run is explicitly allowed to surface home-team spots too (see
  // ALLOW_HOME below). Venues outside a tracked metro have no home-team list to check at all.
  const homeTeams = area && !ALLOW_HOME ? area.homeTeams : [];
  const away = teams.filter(t => !homeTeams.includes(t));
  if (!away.length) { skip(`home-market team only in ${area.label}`); continue; }
  teams.splice(0, teams.length, ...away);

  // A fan already added this venue by hand: leave theirs alone.
  const fanDup = [...spots.entries()].find(([id, s]) => !id.startsWith('scout_') && km(s, geo) < 0.2);
  if (fanDup) { skip(`already on map as fan-added "${fanDup[1].name}"`); continue; }

  const expiresAt = isEvent ? eventAt + DAY : now + SPOT_TTL_DAYS * DAY;
  const doc = {
    name: clean(c.venue, 80), address: clean(c.address, 120), note: clean(c.note, 200),
    lat: geo.lat, lng: geo.lng, city, teams, by: 'scout', byName: 'Distant Fan scout',
    source: 'scout', sourceUrl: c.sourceUrl, sourceName: clean(c.sourceName, 80), club: clean(c.club, 80),
    checkedAt: now, expiresAt,
    ...(isEvent ? { eventAt, eventTitle: clean(c.eventTitle, 100) } : {}),
  };

  if (existing) {
    const merged = { ...doc, name: existing.name, address: existing.address, teams: [...new Set([...(existing.teams || []), ...teams])], note: doc.note || existing.note, club: doc.club || existing.club };
    report.refreshed.push(`[${city}] ${label} → expires ${new Date(expiresAt).toISOString().slice(0, 10)}`);
    if (!dry) await db.doc(`spots/${docId}`).set(merged, { merge: true });
    spots.set(docId, { ...existing, ...merged }); // so housekeeping below sees the new expiry
    continue;
  }
  if (conf === 'high') {
    report.published.push(`[${city}] ${label} @ ${doc.address} [${c.sourceUrl}]`);
    if (!dry) await db.doc(`spots/scout_${key}`).set({ ...doc, createdAt: FieldValue.serverTimestamp() });
    if (!dry && await queuedDoc(key)) await db.doc(`scoutQueue/${key}`).delete(); // confirmed by a better source
    spots.set(`scout_${key}`, doc);
  } else {
    report.queued.push(`[${city}] ${label} @ ${doc.address}: ${clean(c.evidence, 160)} [${c.sourceUrl}]`);
    if (!dry) await db.doc(`scoutQueue/${key}`).set({ ...doc, confidence: conf, evidence: clean(c.evidence, 300), queuedAt: (await queuedDoc(key))?.queuedAt || now });
  }
  if (unknown.length) report.skipped.push(`${label}: ignored unrecognised team(s) ${unknown.join(', ')}`);
}

// Housekeeping: drop expired scout spots and stale queue items.
// Queried by expiry time, so only the docs being dropped are read. Spots refreshed above are
// preferred from memory (a dry run's query still returns their old expiry).
const expSnap = await db.collection('spots').where('expiresAt', '<', now).get();
reads += Math.max(expSnap.size, 1);
for (const d of expSnap.docs) {
  const s = spots.get(d.id) || d.data();
  if (d.id.startsWith('scout_') && s.expiresAt && s.expiresAt < now) {
    report.expired.push(`${s.name} (${(s.teams || []).join(', ')})`);
    if (!dry) await db.doc(`spots/${d.id}`).delete();
  }
}
const staleQ = await db.collection('scoutQueue').where('queuedAt', '<', now - 30 * DAY).get();
reads += Math.max(staleQ.size, 1);
if (!dry) for (const d of staleQ.docs) await d.ref.delete();
console.error(`firestore reads this run: ~${reads}`);

const md = [`# Scout run ${new Date().toISOString().slice(0, 10)}${input.mode ? ` (${input.mode} sweep)` : ''}${dry ? ' [DRY RUN]' : ''}`, '',
  ...Object.entries(report).flatMap(([k, v]) => [`## ${k} (${v.length})`, ...v.map(x => `- ${x}`), ''])].join('\n');
const out = path.join(path.dirname(file), path.basename(file).replace(/^candidates/, 'report').replace(/\.json$/, '.md'));
fs.writeFileSync(out, md);
console.log(md);
