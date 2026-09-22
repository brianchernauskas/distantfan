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
import { AREAS, SPOT_TTL_DAYS, resolveTeam, venueKey, geocode, km, adminDb, areaFor } from './lib.mjs';

// "123 Main St, Louisville, KY 40202" -> "Louisville, KY". Falls back to the raw address when
// it doesn't look like a normal US "..., City, ST ..." tail.
function cityLabelFrom(address) {
  const m = String(address || '').match(/,\s*([A-Za-z .'-]+),\s*([A-Z]{2})\b/);
  return m ? `${m[1].trim()}, ${m[2]}` : clean(address, 60);
}
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

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

const [spotsSnap, rejectsSnap, queueSnap] = await Promise.all([
  db.collection('spots').get(), db.collection('scoutRejects').get(), db.collection('scoutQueue').get(),
]);
const spots = new Map(spotsSnap.docs.map(d => [d.id, d.data()]));
const rejects = new Set(rejectsSnap.docs.map(d => d.id));
const queued = new Map(queueSnap.docs.map(d => [d.id, d.data()]));
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

  const existing = spots.get(`scout_${key}`);
  let geo = existing ? { lat: existing.lat, lng: existing.lng } : await geocode(c.address);
  if (!geo) { skip(`could not geocode "${c.address}"`); continue; }
  const areaKey = areaFor(geo);
  const area = areaKey ? AREAS[areaKey] : null;
  const city = areaKey || cityLabelFrom(c.address);
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
    const merged = { ...doc, teams: [...new Set([...(existing.teams || []), ...teams])], note: doc.note || existing.note, club: doc.club || existing.club };
    report.refreshed.push(`[${city}] ${label} → expires ${new Date(expiresAt).toISOString().slice(0, 10)}`);
    if (!dry) await db.doc(`spots/scout_${key}`).set(merged, { merge: true });
    spots.set(`scout_${key}`, { ...existing, ...merged }); // so housekeeping below sees the new expiry
    continue;
  }
  if (conf === 'high') {
    report.published.push(`[${city}] ${label} @ ${doc.address} [${c.sourceUrl}]`);
    if (!dry) await db.doc(`spots/scout_${key}`).set({ ...doc, createdAt: FieldValue.serverTimestamp() });
    if (!dry && queued.has(key)) await db.doc(`scoutQueue/${key}`).delete(); // confirmed by a better source
    spots.set(`scout_${key}`, doc);
  } else {
    report.queued.push(`[${city}] ${label} @ ${doc.address}: ${clean(c.evidence, 160)} [${c.sourceUrl}]`);
    if (!dry) await db.doc(`scoutQueue/${key}`).set({ ...doc, confidence: conf, evidence: clean(c.evidence, 300), queuedAt: queued.get(key)?.queuedAt || now });
  }
  if (unknown.length) report.skipped.push(`${label}: ignored unrecognised team(s) ${unknown.join(', ')}`);
}

// Housekeeping: drop expired scout spots and stale queue items.
for (const [id, s] of spots) {
  if (id.startsWith('scout_') && s.expiresAt && s.expiresAt < now) {
    report.expired.push(`${s.name} (${(s.teams || []).join(', ')})`);
    if (!dry) await db.doc(`spots/${id}`).delete();
  }
}
for (const [id, q] of queued) if ((q.queuedAt || 0) < now - 30 * DAY && !dry) await db.doc(`scoutQueue/${id}`).delete();

const md = [`# Scout run ${new Date().toISOString().slice(0, 10)}${input.mode ? ` (${input.mode} sweep)` : ''}${dry ? ' [DRY RUN]' : ''}`, '',
  ...Object.entries(report).flatMap(([k, v]) => [`## ${k} (${v.length})`, ...v.map(x => `- ${x}`), ''])].join('\n');
const out = path.join(path.dirname(file), path.basename(file).replace(/^candidates/, 'report').replace(/\.json$/, '.md'));
fs.writeFileSync(out, md);
console.log(md);
