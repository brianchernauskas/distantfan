// Weekly game-day email: each opted-in fan gets their teams' games for the coming week plus the
// nearest watch spots. Reads emailPrefs + profiles with the admin key, games from ESPN, spots from
// data/spots.json, and sends through Resend (https://resend.com).
//
//   node tools/digest/send.mjs                    dry run: writes previews to tools/digest/out/, sends nothing
//   node tools/digest/send.mjs --send             send for real (needs the config + a Resend key, see below)
//   node tools/digest/send.mjs --send --only me@example.com   just that address (test)
//   options: --days 7   look-ahead window     --force   ignore the "sent within 5 days" guard
//
// Setup (Brian): verify distantfan.com in Resend (adds DNS records at Hostinger), create an API key and
// save it to ~/.secrets/resend.key (or set RESEND_API_KEY), then copy tools/digest/config.example.json to ~/.secrets/distantfan-digest.json and fill it in
// (kept outside the repo because the site is public).
// CAN-SPAM needs a postal address in every marketing email, so --send refuses to run until
// the config has a real one. `--demo` previews with a made-up fan and touches no database. Each email carries a one-click unsubscribe link (unsubscribe.html).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAM_BY_ID } from '../../assets/js/teams.js';
import { km, center, nearestMetro } from '../../assets/js/geo.js';
import { adminDb } from '../scout/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : (process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1] ?? true); };
const SEND = process.argv.includes('--send'), FORCE = process.argv.includes('--force');
const ONLY = (arg('--only') || '').toString().toLowerCase();
const DAYS = +(arg('--days') || 7);
const SITE = 'https://distantfan.com';
const NEAR_KM = 40, MAX_SPOTS = 3, MAX_GAMES = 8, RESEND_GAP_DAYS = 5;
const ESPN_PATH = { nfl: 'football/nfl', cfb: 'football/college-football', nba: 'basketball/nba', cbb: 'basketball/mens-college-basketball', mlb: 'baseball/mlb', nhl: 'hockey/nhl', mls: 'soccer/usa.1' };
const STATE_TZ = { HI: 'Pacific/Honolulu', AK: 'America/Anchorage', AZ: 'America/Phoenix', CA: 'America/Los_Angeles', WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  ID: 'America/Denver', MT: 'America/Denver', WY: 'America/Denver', UT: 'America/Denver', CO: 'America/Denver', NM: 'America/Denver',
  ND: 'America/Chicago', SD: 'America/Chicago', NE: 'America/Chicago', KS: 'America/Chicago', OK: 'America/Chicago', TX: 'America/Chicago', MN: 'America/Chicago', IA: 'America/Chicago', MO: 'America/Chicago', AR: 'America/Chicago', LA: 'America/Chicago', WI: 'America/Chicago', IL: 'America/Chicago', MS: 'America/Chicago', AL: 'America/Chicago', TN: 'America/Chicago' };

// Config lives outside the repo (the site is public and this holds a postal address).
const cfgPath = path.join(os.homedir(), '.secrets/distantfan-digest.json');
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
if (SEND) {
  if (!cfg.from || !cfg.postalAddress || /REPLACE/i.test(cfg.postalAddress)) throw new Error('Save ~/.secrets/distantfan-digest.json (copy tools/digest/config.example.json; needs from + a real postalAddress) before --send.');
}
const resendKey = process.env.RESEND_API_KEY || (fs.existsSync(path.join(os.homedir(), '.secrets/resend.key')) ? fs.readFileSync(path.join(os.homedir(), '.secrets/resend.key'), 'utf8').trim() : '');
if (SEND && !resendKey) throw new Error('No Resend key: set RESEND_API_KEY or save it to ~/.secrets/resend.key');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = t => t.lg === 'cfb' ? `${t.short} football` : t.lg === 'cbb' ? `${t.short} basketball` : t.short;

// ---- games (one ESPN call per followed team, shared across fans)
const sched = new Map();
async function gamesFor(teamId) {
  if (sched.has(teamId)) return sched.get(teamId);
  const team = TEAM_BY_ID[teamId];
  const p = (async () => {
    if (!team) return [];
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_PATH[team.lg]}/teams/${team.eid}/schedule`);
      if (!res.ok) return [];
      const j = await res.json();
      return (j.events || []).map(e => {
        const c = e.competitions?.[0]; if (!c) return null;
        const us = c.competitors.find(x => x.team?.id === team.eid), them = c.competitors.find(x => x.team?.id !== team.eid);
        if (!us || !them) return null;
        return { key: e.id, teamId, time: Date.parse(e.date), tbd: c.timeValid === false || e.timeValid === false, home: us.homeAway === 'home',
          opp: them.team.displayName, tv: [...new Set((c.broadcasts || []).map(b => b.media?.shortName).filter(Boolean))] };
      }).filter(Boolean);
    } catch { return []; }
  })();
  sched.set(teamId, p);
  return p;
}

const { spots: allSpots } = JSON.parse(fs.readFileSync(path.join(root, 'data/spots.json'), 'utf8'));
const liveSpots = allSpots.filter(s => (!s.expiresAt || s.expiresAt > Date.now()) && Number.isFinite(s.lat));

function spotsNear(pt, teamId) {
  return liveSpots.filter(s => s.teams?.includes(teamId)).map(s => ({ ...s, d: km(pt, s) })).filter(s => s.d <= NEAR_KM)
    .sort((a, b) => a.d - b.d).slice(0, MAX_SPOTS);
}

function build(pref, profile) {
  const pt = center(profile.cell), metro = nearestMetro(pt, 120);
  const tz = STATE_TZ[metro?.st] || 'America/New_York';
  return { pt, metro, tz };
}

function render({ pref, profile, games, tz, pt }) {
  const unsub = `${SITE}/unsubscribe.html?t=${pref.id}`;
  const fmtDay = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz });
  const fmtTime = g => g.tbd ? 'time TBA' : new Date(g.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: tz });
  const first = games[0], t = TEAM_BY_ID[first.teamId];
  const subject = games.length === 1
    ? `${short(t)} ${first.home ? 'vs' : 'at'} ${first.opp}: ${fmtDay(first.time)}. Where to watch near you`
    : `${games.length} games this week for your teams: where to watch near ${profile.area?.replace(/ area$/, '') || 'you'}`;
  const blocks = games.map(g => {
    const team = TEAM_BY_ID[g.teamId], spots = spotsNear(pt, g.teamId);
    const spotHtml = spots.length
      ? spots.map(s => `<li style="margin:4px 0"><b>${esc(s.name)}</b> <span style="color:#6b7480">· ${esc(s.address || '')} · ${(s.d * 0.621).toFixed(0)} mi</span></li>`).join('')
      : `<li style="margin:4px 0;color:#6b7480">No spots listed near you yet. <a href="${SITE}/app.html" style="color:#df5a0b">Add one</a> and be the first.</li>`;
    return { g, team, spots, html: `<div style="border:1px solid #e3ded2;border-radius:12px;padding:16px 18px;margin:14px 0;background:#fff">
  <div style="font-size:13px;color:#6b7480">${esc(fmtDay(g.time))} · ${esc(fmtTime(g))}${g.tv.length ? ` · ${esc(g.tv.join(', '))}` : ''}</div>
  <div style="font-size:19px;font-weight:700;margin:4px 0 8px">${esc(short(team))} ${g.home ? 'vs' : 'at'} ${esc(g.opp)}</div>
  <div style="font-size:13px;font-weight:600;margin-bottom:4px">Where to watch near you</div>
  <ul style="margin:0;padding-left:18px;font-size:14px">${spotHtml}</ul>
</div>` };
  });
  const html = `<!doctype html><html><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#121820">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="font-size:22px;font-weight:800;letter-spacing:.02em;text-transform:uppercase">Distant<span style="color:#df5a0b">Fan</span></div>
  <p style="font-size:16px;margin:18px 0 4px">Hey ${esc((profile.name || 'there').split(' ')[0])}, here's your week.</p>
  <p style="font-size:14px;color:#6b7480;margin:0">Times shown for ${esc(profile.area?.replace(/ area$/, '') || 'your area')}.</p>
  ${blocks.map(b => b.html).join('\n')}
  <p style="text-align:center;margin:22px 0"><a href="${SITE}/app.html" style="background:#df5a0b;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;display:inline-block">See who's going</a></p>
  <p style="font-size:12px;color:#8a939e;line-height:1.5;margin-top:26px">You're getting this because you turned on the weekly game-day email at distantfan.com. <a href="${unsub}" style="color:#8a939e">Unsubscribe</a> in one click.<br>${esc(cfg.postalAddress || '[postal address goes here]')}</p>
</div></body></html>`;
  const text = `Hey ${(profile.name || 'there').split(' ')[0]}, here's your week (times for ${profile.area?.replace(/ area$/, '') || 'your area'}):\n\n${blocks.map(b =>
    `${fmtDay(b.g.time)} ${fmtTime(b.g)}: ${short(b.team)} ${b.g.home ? 'vs' : 'at'} ${b.g.opp}${b.g.tv.length ? ` (${b.g.tv.join(', ')})` : ''}\n` +
    (b.spots.length ? b.spots.map(s => `  - ${s.name}, ${s.address || ''}`).join('\n') : '  - No spots listed near you yet. Add one at ' + SITE + '/app.html') + '\n').join('\n')}\nSee who's going: ${SITE}/app.html\n\nUnsubscribe: ${unsub}\n${cfg.postalAddress || ''}\n`;
  return { subject, html, text, unsub };
}

async function sendMail(to, m) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.from, to, reply_to: cfg.replyTo || undefined, subject: m.subject, html: m.html, text: m.text, headers: { 'List-Unsubscribe': `<${m.unsub}>` } }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---- run
const DEMO = process.argv.includes('--demo');
if (DEMO && SEND) throw new Error('--demo never sends.');
const db = DEMO ? null : await adminDb();
let prefs, profiles, logs;
if (DEMO) {
  prefs = [{ id: '0'.repeat(32), uid: 'demo', email: 'demo@example.com' }];
  profiles = [{ exists: true, data: () => ({ name: 'Brian C', cell: '9tbq', area: 'Phoenix area', teams: ['nfl-min', 'cfb-9', 'mlb-ari', 'nfl-buf'] }) }];
  logs = [{ exists: false }];
} else {
  const prefsSnap = await db.collection('emailPrefs').where('optIn', '==', true).get();
  prefs = prefsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (ONLY) prefs = prefs.filter(p => p.email?.toLowerCase() === ONLY);
  profiles = prefs.length ? await db.getAll(...prefs.map(p => db.collection('profiles').doc(p.uid))) : [];
  logs = prefs.length ? await db.getAll(...prefs.map(p => db.collection('mailLog').doc(p.id))) : [];
}
console.error(`opted in: ${prefs.length}${ONLY ? ` (only ${ONLY})` : ''}${DEMO ? ' (demo fan)' : ''}`);
const outDir = path.join(root, 'tools/digest/out');
if (!SEND) fs.mkdirSync(outDir, { recursive: true });

let sent = 0, skipped = 0;
for (let i = 0; i < prefs.length; i++) {
  const pref = prefs[i], prof = profiles[i].exists ? profiles[i].data() : null;
  if (!prof?.cell || !prof.teams?.length) { skipped++; continue; }
  const last = logs[i].exists ? logs[i].data().lastSentAt : 0;
  if (!FORCE && SEND && last && Date.now() - last < RESEND_GAP_DAYS * 864e5) { skipped++; continue; }
  const now = Date.now(), end = now + DAYS * 864e5;
  const seen = new Set(), games = [];
  for (const tid of prof.teams) for (const g of await gamesFor(tid)) {
    if (g.time < now - 3 * 3.6e6 || g.time > end || seen.has(g.key)) continue;
    seen.add(g.key); games.push(g);
  }
  if (!games.length) { skipped++; continue; }
  games.sort((a, b) => a.time - b.time); games.length = Math.min(games.length, MAX_GAMES);
  const ctx = build(pref, prof);
  const mail = render({ pref, profile: prof, games, tz: ctx.tz, pt: ctx.pt });
  if (!SEND) {
    const f = path.join(outDir, `${i + 1}-${pref.id.slice(0, 6)}.html`);
    fs.writeFileSync(f, mail.html);
    console.error(`[dry] ${pref.email}: ${games.length} game(s) · "${mail.subject}" -> ${path.relative(root, f)}`);
    continue;
  }
  try {
    await sendMail(pref.email, mail);
    await db.collection('mailLog').doc(pref.id).set({ lastSentAt: Date.now(), games: games.length });
    sent++; console.error(`sent ${pref.email} (${games.length} games)`);
  } catch (e) { console.error(`FAILED ${pref.email}: ${e.message}`); }
  await sleep(600);
}
console.error(SEND ? `sent ${sent}, skipped ${skipped}` : `dry run done, skipped ${skipped} (no games this week / no profile)`);
