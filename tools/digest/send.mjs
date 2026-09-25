// Weekly game-day email: each opted-in fan gets their teams' games for the coming week plus the
// nearest watch spots. Reads emailPrefs + profiles with the admin key, games from ESPN, spots from
// data/spots.json, and sends through Resend (https://resend.com).
//
//   node tools/digest/send.mjs                    dry run: writes previews to tools/digest/out/, sends nothing
//   node tools/digest/send.mjs --send             send for real (needs the config + a Resend key, see below)
//   node tools/digest/send.mjs --send --only me@example.com   just that address (test)
//   node tools/digest/send.mjs --welcome --send  welcome email (with this week's games) to opted-in fans never mailed before;
//                                        run by the distantfan-welcome-emails task twice a day
//   options: --days 7   look-ahead window     --force   ignore the "sent within 5 days" guard
//
// Provider: EmailJS by default (the same Gmail service as the draft-order pick'em site: plain text, sent from
// that Gmail account, 200/month free; the API must be allowed for non-browser apps in EmailJS -> Account -> Security).
// Resend is used instead when ~/.secrets/resend.key exists or config.provider is 'resend' (HTML, own domain).
// Test one email to yourself: node tools/digest/send.mjs --test-to you@example.com
//
// Resend setup (optional upgrade): verify distantfan.com in Resend (adds DNS records at Hostinger), create an API key and
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
const SEND = process.argv.includes('--send') || process.argv.includes('--test-to'), FORCE = process.argv.includes('--force');
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
const TEST_TO = (arg('--test-to') || '').toString();   // send the demo email to this one address (no database)
const PROVIDER = cfg.provider || (fs.existsSync(path.join(os.homedir(), '.secrets/resend.key')) || process.env.RESEND_API_KEY ? 'resend' : 'emailjs');
if (SEND && !TEST_TO) {
  if (PROVIDER === 'resend' && !cfg.from || !cfg.postalAddress || /REPLACE/i.test(cfg.postalAddress)) throw new Error('Save ~/.secrets/distantfan-digest.json (copy tools/digest/config.example.json; needs from + a real postalAddress) before --send.');
}
const resendKey = process.env.RESEND_API_KEY || (fs.existsSync(path.join(os.homedir(), '.secrets/resend.key')) ? fs.readFileSync(path.join(os.homedir(), '.secrets/resend.key'), 'utf8').trim() : '');
if (SEND && PROVIDER === 'resend' && !resendKey) throw new Error('No Resend key: set RESEND_API_KEY or save it to ~/.secrets/resend.key');

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
          opp: them.team.displayName, oppLogo: them.team.logos?.[0]?.href || them.team.logo || '', tv: [...new Set((c.broadcasts || []).map(b => b.media?.shortName).filter(Boolean))] };
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

// ---- email layout (tables + inline styles so it holds up in Gmail, Outlook and Apple Mail)
const FONT = "Arial,Helvetica,sans-serif";
const teamColor = t => /^#[0-9a-f]{6}$/i.test(t?.color || '') ? t.color : '#df5a0b';
// A logo on a white disc, so dark marks stay legible in dark-mode mail clients too.
const tile = (src, size, alt = '') => src ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#ffffff;border:1px solid #e3ded2;border-radius:50%;padding:4px;line-height:0"><img src="${esc(src)}" alt="${esc(alt)}" width="${size - 10}" height="${size - 10}" style="display:block;width:${size - 10}px;height:${size - 10}px;border:0"></td></tr></table>` : '';

function render({ pref, profile, games, tz, pt, welcome = false }) {
  const unsub = `${SITE}/unsubscribe.html?t=${pref.id}`;
  const fmtDay = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz });
  const fmtTime = g => g.tbd ? 'time TBA' : new Date(g.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: tz });
  const first = games[0], t = first && TEAM_BY_ID[first.teamId];
  const area = profile.area?.replace(/ area$/, '') || 'your area';
  const firstName = (profile.name || 'there').split(' ')[0];
  const intro = welcome
    ? `Thanks for turning on game-day email. Every Thursday morning we'll send your teams' games for the week, with the watch spots nearest ${area}. ${games.length ? "Here's this week to start:" : 'None of your teams play in the next week, so your first full email comes when the schedule picks up.'}`
    : "here's your week.";
  const subject = welcome ? 'Welcome to Distant Fan game-day email' : games.length === 1
    ? `${short(t)} ${first.home ? 'vs' : 'at'} ${first.opp}: ${fmtDay(first.time)}. Where to watch near you`
    : `${games.length} games this week for your teams: where to watch near ${area === 'your area' ? 'you' : area}`;

  const blocks = games.map(g => {
    const team = TEAM_BY_ID[g.teamId], spots = spotsNear(pt, g.teamId), col = teamColor(team);
    const spotHtml = spots.length
      ? spots.map(s => `<div style="margin:0 0 7px;font-size:14px;line-height:1.35">📍 <b style="color:#121820">${esc(s.name)}</b><br><span style="color:#6b7480;font-size:13px">${esc(s.address || '')}${s.address ? ' · ' : ''}${(s.d * 0.621).toFixed(0)} mi</span></div>`).join('')
      : `<div style="font-size:14px;color:#6b7480">No spots listed near you yet. <a href="${SITE}/app.html" style="color:#df5a0b;font-weight:700">Add one</a> and be the first.</div>`;
    return { g, team, spots, html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;background:#ffffff;border:1px solid #e3ded2;border-left:6px solid ${col};border-radius:12px"><tr><td style="padding:16px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="56" valign="middle">${tile(team.logo, 52, team.name)}</td>
<td valign="middle" style="padding:0 12px">
<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:#6b7480">${esc(fmtDay(g.time))} · ${esc(fmtTime(g))}</div>
<div style="font-size:19px;font-weight:800;line-height:1.2;margin:3px 0;color:#121820">${esc(short(team))} <span style="font-weight:600;color:#6b7480">${g.home ? 'vs' : 'at'}</span> ${esc(g.opp)}</div>
${g.tv.length ? `<div style="font-size:13px;color:#6b7480">📺 ${esc(g.tv.join(', '))}</div>` : ''}
</td>
<td width="44" valign="middle" align="right">${tile(g.oppLogo, 40, g.opp)}</td>
</tr></table>
<div style="border-top:1px solid #eee9de;margin-top:14px;padding-top:12px">
<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:${col === '#ffffff' ? '#6b7480' : col};margin-bottom:8px">Where to watch near you</div>
${spotHtml}
</div></td></tr></table>` };
  });

  const teamStrip = (profile.teams || []).map(id => TEAM_BY_ID[id]).filter(Boolean).map(tm => `<td style="padding:0 8px 0 0">${tile(tm.logo, 44, tm.name)}</td>`).join('');
  const heading = welcome ? `You're in, ${esc(firstName)}.` : `Your week, ${esc(firstName)}.`;
  const lead = welcome ? esc(intro) : `Your teams' games for the next few days, with the watch spots nearest ${esc(area)}.`;

  const html = `<div style="background:#f5f3ee;padding:22px 10px;font-family:${FONT};color:#121820">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;margin:0 auto">
<tr><td style="background:#0b1016;border-radius:14px 14px 0 0;padding:16px 22px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="54" valign="middle"><img src="${process.env.DIGEST_ASSET_BASE || SITE}/assets/img/email-logo.png" width="44" height="44" alt="Distant Fan" style="display:block;border:0;border-radius:10px"></td>
<td valign="middle" style="font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#ffffff">Distant<span style="color:#ff7a1a">Fan</span></td>
<td valign="middle" align="right" style="font-size:12px;color:#98a5b5">Your team.<br>Wherever you are.</td>
</tr></table></td></tr>
<tr><td style="background:#ff7a1a;height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:24px 4px 6px">
<div style="font-size:30px;line-height:1.1;font-weight:800;color:#121820">${heading}</div>
<p style="font-size:15px;line-height:1.55;color:#4a5563;margin:10px 0 16px">${lead}</p>
${teamStrip ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px"><tr>${teamStrip}</tr></table>` : ''}
${games.length ? `<div style="font-size:12px;color:#8a939e;margin:10px 0 0">Times shown for ${esc(area)}.</div>` : ''}
</td></tr>
<tr><td style="padding:16px 0 4px">
${blocks.map(b => b.html).join('\n')}
</td></tr>
<tr><td align="center" style="padding:14px 0 6px"><a href="${SITE}/app.html" style="display:inline-block;background:#df5a0b;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 30px;border-radius:999px">See who's going</a></td></tr>
<tr><td style="padding:22px 6px 4px;font-size:12px;line-height:1.55;color:#8a939e;text-align:center">You're getting this because you turned on the weekly game-day email at distantfan.com. <a href="${unsub}" style="color:#8a939e">Unsubscribe</a> in one click.<br>${esc(cfg.postalAddress || '[postal address goes here]')}</td></tr>
</table></div>`;

  const text = `Hey ${firstName}${welcome ? '. ' : ', '}${intro}${games.length ? ` (times for ${area})` : ''}\n\n${blocks.map(b =>
    `${fmtDay(b.g.time)} ${fmtTime(b.g)}: ${short(b.team)} ${b.g.home ? 'vs' : 'at'} ${b.g.opp}${b.g.tv.length ? ` (${b.g.tv.join(', ')})` : ''}\n` +
    (b.spots.length ? b.spots.map(s => `  - ${s.name}, ${s.address || ''}`).join('\n') : '  - No spots listed near you yet. Add one at ' + SITE + '/app.html') + '\n').join('\n')}\nSee who's going: ${SITE}/app.html\n\nUnsubscribe: ${unsub}\n${cfg.postalAddress || ''}\n`;
  return { subject, html, text, unsub };
}

// EmailJS (same Gmail service as the draft-order pick'em site): plain-text body only, sent from the
// connected Gmail account. Its template is `{{picks_text}}`, so the digest's text version goes there.
// Needs "Allow EmailJS API for non-browser applications" on in EmailJS -> Account -> Security.
async function sendEmailJs(to, m, name) {
  const ej = { serviceId: 'service_aaw5cl8', templateId: 'template_obor8bx', publicKey: '7HdyBZlJwZtLqAl2v', ...(cfg.emailjs || {}) };
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({ service_id: ej.serviceId, template_id: ej.templateId, user_id: ej.publicKey, ...(ej.privateKey ? { accessToken: ej.privateKey } : {}),
      template_params: { to_email: to, email: to, to, recipient: to, user_email: to, from_name: 'Distant Fan', to_name: name, subject: m.subject, player_name: name, picks_text: m.text, message_html: m.html, submitted_at: '' } }),
  });
  if (!res.ok) throw new Error(`EmailJS ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendMail(to, m, name) {
  if (PROVIDER === 'emailjs') return sendEmailJs(to, m, name);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.from, to, reply_to: cfg.replyTo || undefined, subject: m.subject, html: `<!doctype html><html><body style="margin:0">${m.html}</body></html>`, text: m.text, headers: { 'List-Unsubscribe': `<${m.unsub}>` } }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---- run
const WELCOME = process.argv.includes('--welcome');   // first email for fans who have never been mailed
const DEMO = process.argv.includes('--demo') || !!TEST_TO;
if (DEMO && SEND && !TEST_TO) throw new Error('--demo only sends with --test-to <address>.');
const db = DEMO ? null : await adminDb();
let prefs, profiles, logs;
if (DEMO) {
  prefs = [{ id: '0'.repeat(32), uid: 'demo', email: TEST_TO || 'demo@example.com' }];
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
  if (WELCOME && logs[i].exists) { skipped++; continue; }   // already mailed a welcome or a digest
  const last = logs[i].exists ? logs[i].data().lastSentAt : 0;
  if (!FORCE && SEND && last && Date.now() - last < RESEND_GAP_DAYS * 864e5) { skipped++; continue; }
  const now = Date.now(), end = now + DAYS * 864e5;
  const seen = new Set(), games = [];
  for (const tid of prof.teams) for (const g of await gamesFor(tid)) {
    if (g.time < now - 3 * 3.6e6 || g.time > end || seen.has(g.key)) continue;
    seen.add(g.key); games.push(g);
  }
  if (!games.length && !WELCOME) { skipped++; continue; }
  games.sort((a, b) => a.time - b.time); games.length = Math.min(games.length, MAX_GAMES);
  const ctx = build(pref, prof);
  const mail = render({ pref, profile: prof, games, tz: ctx.tz, pt: ctx.pt, welcome: WELCOME });
  if (!SEND) {
    const f = path.join(outDir, `${i + 1}-${pref.id.slice(0, 6)}.html`);
    fs.writeFileSync(f, `<!doctype html><html><body style="margin:0">${mail.html}</body></html>`);
    console.error(`[dry] ${pref.email}: ${games.length} game(s) · "${mail.subject}" -> ${path.relative(root, f)}`);
    continue;
  }
  try {
    await sendMail(pref.email, mail, (prof.name || '').split(' ')[0]);
    if (db) await db.collection('mailLog').doc(pref.id).set({ lastSentAt: Date.now(), games: games.length, ...(WELCOME ? { welcomedAt: Date.now() } : {}) });
    sent++; console.error(`sent ${pref.email} (${games.length} games)`);
  } catch (e) { console.error(`FAILED ${pref.email}: ${e.message}`); }
  await sleep(600);
}
console.error(SEND ? `sent ${sent}, skipped ${skipped}` : `dry run done, skipped ${skipped} (no games this week / no profile)`);
