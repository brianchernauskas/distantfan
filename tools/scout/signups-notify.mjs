// Pushes a phone notification (ntfy) for each new Distant Fan sign-up, with how they found us.
//   node signups-notify.mjs            poll once (run every ~5 min from Windows Task Scheduler)
//   node signups-notify.mjs --dry      print what would be sent, change nothing
// Config  ~/.secrets/distantfan-ntfy.json   { "topic": "<private topic>", "server": "https://ntfy.sh" }
// State   ~/.secrets/distantfan-signups-state.json   (uids already announced; first run baselines silently)
// Reads Firebase Auth's user list (no Firestore reads) and fetches a profile only for accounts not yet announced.
// Names and emails are never sent: ntfy.sh is a public server.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adminDb } from './lib.mjs';
import { TEAMS } from '../../assets/js/teams.js';

const dry = process.argv.includes('--dry');
const dir = path.join(os.homedir(), '.secrets');
const cfgPath = path.join(dir, 'distantfan-ntfy.json');
const statePath = path.join(dir, 'distantfan-signups-state.json');
const GIVE_UP_MS = 24 * 3600e3; // account that never finished onboarding

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const first = !fs.existsSync(statePath);
const state = first ? { done: [] } : JSON.parse(fs.readFileSync(statePath, 'utf8'));
const done = new Set(state.done);

const db = await adminDb();
const { getAuth } = await import('firebase-admin/auth');
const users = [];
let page;
do { const r = await getAuth().listUsers(1000, page); users.push(...r.users); page = r.pageToken; } while (page);

if (first) {
  users.forEach(u => done.add(u.uid));
  if (!dry) fs.writeFileSync(statePath, JSON.stringify({ done: [...done] }));
  console.log(`Baselined ${users.length} existing accounts; no notifications sent.`);
  process.exit(0);
}

const byId = Object.fromEntries(TEAMS.map(t => [t.id, t]));
const pending = users.filter(u => !done.has(u.uid)).sort((a, b) => Date.parse(a.metadata.creationTime) - Date.parse(b.metadata.creationTime));
let profiles = 0, sent = 0;
for (const u of pending) {
  const snap = await db.doc(`profiles/${u.uid}`).get(); profiles++;
  const age = Date.now() - Date.parse(u.metadata.creationTime);
  if (!snap.exists) { if (age > GIVE_UP_MS) done.add(u.uid); continue; }
  const p = snap.data();
  const teams = (p.teams || []).map(id => byId[id]?.short || id).join(', ');
  const how = [p.how, p.src && `landed on ${p.src}`, p.ref && `via ${p.ref}`].filter(Boolean).join(' · ');
  const total = users.filter(x => done.has(x.uid)).length + 1;
  const body = [`Teams: ${teams}`, p.area && `Area: ${p.area}`, how && `Source: ${how}`, `Total fans: ${total}`].filter(Boolean).join('\n');
  if (dry) { console.log('[dry]', body); continue; }
  const res = await fetch(`${cfg.server || 'https://ntfy.sh'}/${cfg.topic}`, {
    method: 'POST', body, headers: { Title: 'New Distant Fan sign-up', Tags: 'tada', Click: 'https://distantfan.com/app.html' },
  });
  if (!res.ok) { console.error(`ntfy HTTP ${res.status}; will retry next run`); break; }
  done.add(u.uid); sent++;
}
if (!dry) fs.writeFileSync(statePath, JSON.stringify({ done: [...done] }));
console.log(`${users.length} accounts, ${pending.length} unannounced, ${sent} sent, ${profiles} profile reads.`);
