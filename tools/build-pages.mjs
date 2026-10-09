// Static "where to watch" pages for search engines, built from data/spots.json + data/fans.json.
//
//   node tools/build-pages.mjs            regenerate watch/, sitemap.xml, robots.txt
//   node tools/build-pages.mjs --min=2    publish pages for team x city pairs with at least 2 spots (default 3)
//
// Output (all plain HTML, served as-is by GitHub Pages):
//   watch/index.html                   hub: every city and team that has a page
//   watch/{team}/index.html            one team, every city where it has a page
//   watch/{team}/{city}/index.html     the money page: "Where to watch {team} games in {city}"
//   watch/in/{city}/index.html         one city, every team, every spot
//   watch/at/{venue}-{city}/index.html one venue: who gathers there, address, nearby spots (skips chains)
//
// A team x city page exists once it has MIN_SPOTS real spots. Pairs with only 1-2 spots get a page too
// (marked thin) but only when one of the spots is solid (a club listing or an independent bar with a
// real note), and every page carries the team's upcoming games from data/schedules.json
// (tools/fetch-schedules.mjs), so it has something worth reading beyond the spot list. Spots are
// assigned to the nearest metro within 60 km (same list the app uses); anything further out stays
// app-only. Output is deterministic (no build timestamps) so a rebuild with unchanged data is a
// no-op in git. Files that no longer qualify are deleted. Run by export-spots.mjs --commit.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TEAMS, TEAM_BY_ID, LEAGUES } from '../assets/js/teams.js';
import { nearestMetro, center, km } from '../assets/js/geo.js';
import { METROS } from '../assets/js/metros.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://distantfan.com';
const MIN_SPOTS = +(process.argv.find(a => a.startsWith('--min='))?.slice(6) || 3);
const CITY_MIN = 5;          // a city page needs this many spots in total
const METRO_KM = 60;
const ESPN_PATH = { nfl: 'football/nfl', cfb: 'football/college-football', nba: 'basketball/nba', cbb: 'basketball/mens-college-basketball', mlb: 'baseball/mlb', nhl: 'hockey/nhl', mls: 'soccer/usa.1' };

const readJson = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const { spots: allSpots, generatedAt } = readJson('data/spots.json');
const fansData = fs.existsSync(path.join(root, 'data/fans.json')) ? readJson('data/fans.json') : { teams: {} };

const schedFile = path.join(root, 'data/schedules.json');
const SCHED = fs.existsSync(schedFile) ? readJson('data/schedules.json') : { fetchedAt: new Date(0).toISOString(), teams: {} };

// Scraped club and venue names sometimes carry an em dash; normalize it so none reaches a public page.
const noDash = s => String(s ?? '').replace(/\s*\u2014\s*/g, ' - ');
// "a" or "an" by sound: vowel letters take "an" (U is usually "yoo": a Utes, a UCF), and initialisms
// starting with F H L M N R S X are spoken as vowels (an LSU, an SMU, an NC State).
const an = w => { const f = String(w).trim().split(/\s/)[0]; return /^[AEIOaeio]/.test(f) || (/^[A-Z]{2,}$/.test(f) && /^[FHLMNRSX]/.test(f)) ? 'an' : 'a'; };
const esc = s => noDash(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const plural = (n, a, b = a + 's') => `${n} ${n === 1 ? a : b}`;
const monthYear = ms => new Date(ms).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const hash = f => crypto.createHash('md5').update(fs.readFileSync(path.join(root, f))).digest('hex').slice(0, 8);

// ---- names and slugs
const disp = t => t.lg === 'cfb' ? `${t.name} football` : t.lg === 'cbb' ? `${t.name} basketball` : t.name;
const teamSlug = t => slugify(t.lg === 'cfb' ? `${t.name} football` : t.lg === 'cbb' ? `${t.name} basketball` : t.name);
const cityName = m => `${m.name}, ${m.st}`;
const citySlug = m => slugify(`${m.name} ${m.st}`);

// ---- group spots by team x metro
const now = Date.now();
const live = allSpots.filter(s => (!s.expiresAt || s.expiresAt > now) && Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.name);
const byPair = new Map();       // `${teamId}|${metroKey}` -> spots
const byCity = new Map();       // metroKey -> Set(spots)
const metros = new Map();       // metroKey -> metro
const spotMetro = new Map();    // spot -> metroKey (US metros only)
for (const s of live) {
  const m = nearestMetro(s, METRO_KM);
  if (!m || m.st.length !== 2 || /^(ON|BC|QC|AB|UK|IE|MX|AU)$/.test(m.st)) continue; // US metros only
  const mk = citySlug(m);
  metros.set(mk, m);
  spotMetro.set(s, mk);
  (byCity.get(mk) || byCity.set(mk, new Set()).get(mk)).add(s);
  for (const id of s.teams || []) {
    if (!TEAM_BY_ID[id]) continue;
    const k = `${id}|${mk}`;
    (byPair.get(k) || byPair.set(k, []).get(k)).push(s);
  }
}
const CHAIN_MIN = 5;
const nameCount = new Map();
for (const s of live) nameCount.set(s.name, (nameCount.get(s.name) || 0) + 1);
// "Solid" = worth building a page around on its own: a named club/chapter, or an independent bar with a real note.
const solid = s => !!s.club || (nameCount.get(s.name) < CHAIN_MIN && String(s.note || '').length >= 40);
const cmpName = (a, b) => a.name.localeCompare(b.name);
for (const list of byPair.values()) list.sort(cmpName);

// Thin pairs (1-2 spots) are limited so we don't mass-produce near-duplicates: 2 spots anywhere, or 1 spot in
// one of the THIN_TOP largest metros (METROS is ordered by size). Tune with --thin-top=N (0 turns thin pages off).
const THIN_TOP = +(process.argv.find(a => a.startsWith('--thin-top='))?.slice(11) || 20);
const metroRank = new Map(METROS.map((m, i) => [`${m.name}|${m.st}`, i]));
const thinOk = (mk, l) => l.some(solid) && (l.length >= 2 || metroRank.get(`${metros.get(mk).name}|${metros.get(mk).st}`) < THIN_TOP);
const pairs = [...byPair.entries()].filter(([k, l]) => l.length >= MIN_SPOTS || (THIN_TOP > 0 && thinOk(k.split('|')[1], l))).map(([k, list]) => {
  const [id, mk] = k.split('|');
  return { team: TEAM_BY_ID[id], mk, metro: metros.get(mk), spots: list, ts: teamSlug(TEAM_BY_ID[id]), thin: list.length < MIN_SPOTS };
});
const slugSeen = new Map();
for (const p of pairs) {  // guard against two teams sharing a slug
  const prev = slugSeen.get(p.ts);
  if (prev && prev !== p.team.id) throw new Error(`team slug collision: ${p.ts} (${prev} vs ${p.team.id})`);
  slugSeen.set(p.ts, p.team.id);
}
const pairsByTeam = new Map(), pairsByCity = new Map();
for (const p of pairs) {
  (pairsByTeam.get(p.team.id) || pairsByTeam.set(p.team.id, []).get(p.team.id)).push(p);
  (pairsByCity.get(p.mk) || pairsByCity.set(p.mk, []).get(p.mk)).push(p);
}
for (const l of pairsByTeam.values()) l.sort((a, b) => b.spots.length - a.spots.length || a.metro.name.localeCompare(b.metro.name));
for (const l of pairsByCity.values()) l.sort((a, b) => b.spots.length - a.spots.length || disp(a.team).localeCompare(disp(b.team)));

// ---- venue pages: one per independent bar with a real note and at least one known team.
// Chains (same name on 5+ listings) are skipped: hundreds of near-identical pages help nobody.
const venueUrl = new Map();     // spot -> /watch/at/{slug}/
const venues = [];
{
  const taken = new Set();
  const cands = live.filter(s => spotMetro.has(s) && (s.teams || []).some(id => TEAM_BY_ID[id]) && nameCount.get(s.name) < CHAIN_MIN && String(s.note || '').length >= 40)
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''));
  for (const s of cands) {
    const m = metros.get(spotMetro.get(s));
    const tn = String(s.address || '').split(',').map(x => x.trim());
    const twn = tn.length >= 3 ? tn[tn.length - 2] : m.name;
    let slug = slugify(`${s.name} ${twn} ${m.st}`) || slugify(s.id);
    if (taken.has(slug)) slug += '-' + crypto.createHash('md5').update(String(s.id)).digest('hex').slice(0, 4);
    taken.add(slug);
    venueUrl.set(s, `/watch/at/${slug}/`);
    venues.push({ s, slug, metro: m, mk: spotMetro.get(s), town: twn });
  }
}

// ---- fan counts per team x metro (fans.json cells are geohash-4, no names)
const fansIn = new Map();
for (const [tid, cells] of Object.entries(fansData.teams || {})) {
  for (const [cell, n] of Object.entries(cells)) {
    const m = nearestMetro(center(cell), METRO_KM);
    if (m) fansIn.set(`${tid}|${citySlug(m)}`, (fansIn.get(`${tid}|${citySlug(m)}`) || 0) + n);
  }
}

// ---- shared chrome
const V = { style: hash('assets/css/style.css'), watch: hash('assets/css/watch.css'), analytics: hash('assets/js/analytics.js') };
const BRAND = `<a class="brand" href="/" aria-label="Distant Fan home"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="8" cy="32" r="4.5" fill="currentColor" opacity=".35"/><path d="M12 29C15 20 19 17 23.5 17.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-dasharray=".5 5" opacity=".55"/><path d="M29 3.5a8.5 8.5 0 0 0-8.5 8.5c0 6.4 8.5 15 8.5 15s8.5-8.6 8.5-15A8.5 8.5 0 0 0 29 3.5z" fill="var(--accent)"/><circle cx="29" cy="12" r="3.2" fill="var(--bg)"/></svg><span>Distant<b>Fan</b></span></a>`;

function page({ url, title, desc, body, crumbs, ld = [], image }) {
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: SITE + c[1] })) };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}${url}">
<meta property="og:image" content="${SITE}${image || '/assets/img/og.png'}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}${image || '/assets/img/og.png'}">
<meta name="theme-color" content="#0b1016">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/style.css?v=${V.style}">
<link rel="stylesheet" href="/assets/css/watch.css?v=${V.watch}">
<script type="module" src="/assets/js/analytics.js?v=${V.analytics}"></script>
${[crumbLd, ...ld].map(o => `<script type="application/ld+json">${noDash(JSON.stringify(o)).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header class="site-head"><div class="wrap">${BRAND}<nav><a href="/watch/">Where to watch</a><a class="btn sm primary" href="/app.html">Open the app</a></nav></div></header>
<main class="wrap watch">
<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => i === crumbs.length - 1 ? `<span>${esc(c[0])}</span>` : `<a href="${c[1]}">${esc(c[0])}</a>`).join(' <i>/</i> ')}</nav>
${body}
</main>
<footer class="site-foot"><div class="wrap"><span>© ${new Date(generatedAt).getUTCFullYear()} Distant Fan · <a href="/about.html">About</a> · <a href="/privacy.html">Privacy</a></span><span>Team names and logos belong to their teams and leagues. Listings gathered from official fan-club and alumni directories, venues and fans; confirm with the venue before you go.</span></div></footer>
</body>
</html>
`;
}

// Fan-group names people actually search for ("browns backers", "husker bar"); only used in copy.
const FAN_TERM = { 'nfl-cle': 'Browns Backers', 'nfl-buf': 'Bills Backers', 'nfl-gb': 'Packer Backers', 'nfl-kc': 'Chiefs Kingdom', 'nfl-den': 'Broncos Country', 'nfl-lv': 'Raider Nation', 'nfl-sf': '49ers Faithful', 'nfl-pit': 'Steelers Nation', 'nfl-phi': 'Eagles fans', 'nfl-ne': 'Patriots fans', 'nfl-chi': 'Bears fans', 'nfl-dal': 'Cowboys fans' };
const town = s => { const p = String(s.address || '').split(',').map(x => x.trim()); return p.length >= 3 ? p[p.length - 2] : ''; };
const joinList = a => a.length <= 1 ? a.join('') : a.length === 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
const lastChecked = list => Math.max(0, ...list.map(s => s.checkedAt || s.createdAt || 0));
const chip = (href, label, n) => `<a class="chip" href="${href}">${esc(label)}${n != null ? ` <b>${n}</b>` : ''}</a>`;
const teamLogo = (t, cls = 'logo') => t.logo ? `<img class="${cls}" src="${esc(t.logo)}" alt="" width="56" height="56" loading="lazy">` : '';
const spotUrl = (s, dest) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.address || ''}`.trim())}`;

// ---- upcoming games: static HTML from data/schedules.json so crawlers see them. Times print in Eastern
// (stable, deterministic); a tiny script swaps in the visitor's local time.
const SCHED_AT = Date.parse(SCHED.fetchedAt) || 0;
const TEAM_BY_ESPN = new Map(TEAMS.map(t => [`${t.lg}|${t.eid}`, t]));
const sched = team => {
  const d = SCHED.teams?.[team.id];
  return d ? { ...d, games: (d.games || []).filter(g => Date.parse(g.t) >= SCHED_AT - 4 * 3.6e6) } : null;
};
const ET = { timeZone: 'America/New_York' };
const fmtGame = g => g.tbd
  ? `${new Date(g.t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...ET })}, time TBA`
  : new Date(g.t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...ET });
const fmtDay = g => new Date(g.t).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...ET });
const fmtShort = g => new Date(g.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...ET });
const oppShort = (team, g) => TEAM_BY_ESPN.get(`${team.lg}|${g.oppId}`)?.short || g.opp.split(' ').slice(-1)[0];
const WATCH_TIP = {
  nfl: 'Out-of-market NFL games usually need NFL Sunday Ticket at the bar, so ask before you go. Thursday, Sunday night and Monday night games are national and show at almost any sports bar.',
  cfb: 'Big games are on ESPN, ABC, Fox, CBS or NBC. Conference-network and ESPN+ games are the ones to ask a bar about.',
  nba: 'National games (ESPN, ABC, TNT, NBC, Prime Video) show at most sports bars. Regional-network games are often blacked out away from the team’s home market, so ask whether the bar carries the league’s out-of-market package.',
  nhl: 'National games (ESPN, ABC, TNT) show at most sports bars. Regional-network games are often blacked out away from the team’s home market, so ask whether the bar carries the league’s out-of-market package.',
  mlb: 'National games (Fox, ESPN, TBS, NBC, Apple TV) show at most sports bars. Regional-network games are often blacked out away from the team’s home market, so ask whether the bar carries MLB Extra Innings.',
  mls: 'Most MLS matches stream through Apple, so ask whether the bar will put your match on.',
};
const resultLine = (team, d) => {
  const l = d.last; if (!l) return '';
  const a = +l.us, b = +l.them, r = a > b ? 'W' : a < b ? 'L' : 'T';
  return Number.isFinite(a) && Number.isFinite(b) ? ` Last game: ${r} ${l.us}–${l.them} ${l.home ? 'vs' : 'at'} ${esc(l.opp)}.` : '';
};
function scheduleBlock(team, where, limit = 6) {
  const d = sched(team);
  if (!d || !d.games.length) return { html: '', ld: [], next: null, changed: 0 };
  const games = d.games.slice(0, limit);
  const rows = games.map(g => `<li><time class="gt" datetime="${g.t}"${g.tbd ? ' data-tbd="1"' : ''}>${esc(fmtGame(g))}</time> <b>${g.home ? 'vs' : 'at'} ${esc(g.opp)}</b>${g.tv.length ? ` <span class="tv">${esc(g.tv.join(', '))}</span>` : ''}</li>`).join('\n');
  const rec = d.rec ? `${esc(team.short)} are ${esc(d.rec)}${d.stand ? ` (${esc(d.stand)})` : ''}.` : '';
  const html = `<section class="schedule"><h2>Upcoming ${esc(team.short)} games to watch${where ? ` in ${esc(where)}` : ''}</h2>
<p class="muted">${rec}${resultLine(team, d)}</p>
<ul class="games">
${rows}
</ul>
${WATCH_TIP[team.lg] ? `<p class="muted tip">${esc(WATCH_TIP[team.lg])}</p>` : ''}
</section>`;
  const LEAGUE = { nfl: 'NFL', cfb: 'NCAA Football', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', mls: 'MLS' };
  const LEAGUE_URL = { nfl: 'https://www.nfl.com/', cfb: 'https://www.ncaa.com/sports/football', nba: 'https://www.nba.com/', nhl: 'https://www.nhl.com/', mlb: 'https://www.mlb.com/', mls: 'https://www.mlssoccer.com/' };
  const ld = games.slice(0, 3).map(g => {
    const homeName = g.home ? team.name : g.opp, awayName = g.home ? g.opp : team.name;
    const league = LEAGUE[team.lg];
    return {
      '@context': 'https://schema.org', '@type': 'SportsEvent', name: `${awayName} at ${homeName}`, startDate: g.t,
      description: `${awayName} at ${homeName}${league ? ` (${league})` : ''}${g.tv.length ? `, broadcast on ${g.tv.join(', ')}` : ''}. Find bars showing the game${where ? ` in ${where}` : ''} on Distant Fan.`,
      eventStatus: 'https://schema.org/EventScheduled',
      ...(team.logo ? { image: team.logo } : {}),
      homeTeam: { '@type': 'SportsTeam', name: homeName }, awayTeam: { '@type': 'SportsTeam', name: awayName },
      performer: [{ '@type': 'SportsTeam', name: homeName }, { '@type': 'SportsTeam', name: awayName }],
      ...(league ? { organizer: { '@type': 'SportsOrganization', name: league, url: LEAGUE_URL[team.lg] } } : {}),
      ...(g.venue ? { location: { '@type': 'Place', name: g.venue.split(',')[0], address: g.venue } } : {}),
    };
  });
  return { html, ld, next: games[0], changed: Date.parse(d.changed) || 0 };
}
const nextLine = (team, g) => g ? ` Next game: ${esc(team.short)} ${g.home ? 'vs' : 'at'} ${esc(oppShort(team, g))}, ${esc(fmtDay(g))}${g.tv.length ? ` on ${esc(g.tv[0])}` : ''}.` : '';
const TIME_JS = `<script>(function(){if(!window.Intl)return;[].forEach.call(document.querySelectorAll('time.gt'),function(el){if(el.getAttribute('data-tbd'))return;try{el.textContent=new Date(el.getAttribute('datetime')).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});}catch(e){}});})();</script>`;

function spotCard(s) {
  const src = s.sourceUrl && /^https?:\/\//.test(s.sourceUrl) ? `<a href="${esc(s.sourceUrl)}" rel="nofollow noopener" target="_blank">${esc(s.sourceName || 'source')}</a>` : esc(s.sourceName || '');
  return `<li class="spot">
  <h3>${venueUrl.has(s) ? `<a href="${venueUrl.get(s)}">${esc(s.name)}</a>` : esc(s.name)}</h3>
  ${s.club ? `<div class="club">${esc(s.club)}</div>` : ''}
  ${s.address ? `<div class="addr"><a href="${esc(spotUrl(s))}" rel="nofollow noopener" target="_blank">${esc(s.address)}</a></div>` : ''}
  ${s.note ? `<p>${esc(s.note)}</p>` : ''}
  <div class="meta">${s.checkedAt ? `Checked ${esc(monthYear(s.checkedAt))}` : ''}${src ? `${s.checkedAt ? ' · ' : ''}Source: ${src}` : ''}</div>
</li>`;
}

const itemListLd = (name, list) => ({
  '@context': 'https://schema.org', '@type': 'ItemList', name,
  numberOfItems: list.length,
  itemListElement: list.map((s, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'BarOrPub', name: s.name, ...(s.address ? { address: s.address } : {}), geo: { '@type': 'GeoCoordinates', latitude: +s.lat.toFixed(5), longitude: +s.lng.toFixed(5) } } })),
});

const CTA = (line, team) => `<section class="cta"><div><h2>${line}</h2><p>Free. Follow ${team ? esc(team.short) : 'your teams'}, see the fans near you and who's going to the next game${team ? `, and get a weekly game-day email with the games and the bars` : ''}. You only share a rough area, never your address.</p></div><a class="btn lg primary" href="/app.html${team ? `?follow=${encodeURIComponent(team.id)}` : ''}">${team ? `Follow ${esc(team.short)}` : 'Find my people'}</a></section>`;
// Slim version near the top of the page, where most search visitors decide whether to stay.
const FOLLOW = team => `<div class="followbar"><span><b>${esc(team.short)} fan?</b> Follow them for a weekly game-day email and see the fans near you.</span><a class="btn sm primary" href="/app.html?follow=${encodeURIComponent(team.id)}">Follow ${esc(team.short)}</a></div>`;

// Share card per team (tools/build-og.py). Falls back to the site card when a team has none yet.
const ogFor = team => { const p = `/assets/og/${teamSlug(team)}.png`; return fs.existsSync(path.join(root, p)) ? p : undefined; };

// Share row: a visitor who likes the page can send it to a friend who moved, or post it to Reddit. The
// shared link carries utm tags so the recipient's signup is attributable (attrib.js stores them), and
// the click fires a GA4 `share` event through window.dfTrack (analytics.js).
const shareUrl = (url, source, medium, campaign) => `${SITE}${url}?utm_source=${source}&utm_medium=${medium}&utm_campaign=${encodeURIComponent(campaign)}`;
function SHARE(url, title, campaign, line) {
  const reddit = `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl(url, 'reddit', 'share', campaign))}&title=${encodeURIComponent(title)}`;
  return `<aside class="sharebar" data-url="${esc(shareUrl(url, 'share', 'link', campaign))}" data-title="${esc(title)}" data-id="${esc(campaign)}">
  <span>${line}</span>
  <div class="sharebtns"><button class="btn sm" type="button" data-share="native" hidden>Share</button><a class="btn sm" href="${esc(reddit)}" target="_blank" rel="noopener" data-share="reddit">Post to Reddit</a><button class="btn sm" type="button" data-share="copy">Copy link</button></div>
</aside>`;
}
const SHARE_JS = `<script>(function(){var b=document.querySelector('.sharebar');if(!b)return;
function t(m){try{(window.dfTrack||function(){})('share',{method:m,content_type:'watch_page',item_id:b.dataset.id})}catch(e){}}
var n=b.querySelector('[data-share=native]');if(navigator.share){n.hidden=false;n.onclick=function(){navigator.share({title:b.dataset.title,url:b.dataset.url}).then(function(){t('native')}).catch(function(){})}}
b.querySelector('[data-share=reddit]').onclick=function(){t('reddit')};
var c=b.querySelector('[data-share=copy]');c.onclick=function(){var u=b.dataset.url,d=function(){c.textContent='Copied';t('copy');setTimeout(function(){c.textContent='Copy link'},2000)};
var f=function(){t('copy');prompt('Copy this link',u)};
if(navigator.clipboard)navigator.clipboard.writeText(u).then(d,f);else f()}})()</script>`;

// Snippet copy: lead with the wording searchers use ("<team> bars in <city>"), name the venues.
// Title test (started 2026-10-06, see SEO.md): team x city pages with 40+ impressions and 0 or 1 clicks
// in Search Console (Sep 25 - Oct 4) get a title in the shape people actually search ("bears bar nashville":
// short team name, singular "bar"). Everything else keeps the original title as the control group.
const TITLE_TEST = new Set(['chicago-bears/nashville-tn', 'chicago-bears/denver-co', 'cleveland-browns/phoenix-az', 'denver-broncos/las-vegas-nv',
  'nebraska-cornhuskers-football/phoenix-az', 'nebraska-cornhuskers-football/kansas-city-mo', 'new-england-patriots/nashville-tn',
  'ohio-state-buckeyes-football/tampa-fl', 'ohio-state-buckeyes-football/nashville-tn', 'cleveland-browns/chicago-il', 'ohio-state-buckeyes-football/charlotte-nc',
  'san-francisco-49ers/dallas-fort-worth-tx', 'cleveland-browns/nashville-tn', 'chicago-bears/phoenix-az', 'san-francisco-49ers/portland-or',
  'cleveland-browns/cleveland-oh', 'san-francisco-49ers/sacramento-ca', 'kansas-city-chiefs/las-vegas-nv', 'pittsburgh-steelers/los-angeles-ca',
  'philadelphia-eagles/las-vegas-nv', 'philadelphia-eagles/washington-dc']);
function testTitle(team, metro, n) {
  const label = team.lg === 'cfb' || team.lg === 'cbb' ? team.loc : team.short;
  for (const t of [`${label} bar in ${metro.name}: ${n} spots to watch ${disp(team)}`, `${label} bar in ${metro.name}: ${n} places to watch the game`, `${label} bar in ${metro.name}, ${metro.st}: ${n} places`]) if (t.length <= 62) return t;
  return `${label} bar in ${metro.name}: ${n} places`;
}
function pageTitle(team, name, metro, n) {
  const c =`${metro.name}, ${metro.st}`, k = n === 1 ? '1 place to watch' : `${n} places to watch`;
  for (const t of [`${team.name} bars in ${c}: ${k}`, `${team.name} bars in ${metro.name}: ${k}`, `${team.short} bars in ${metro.name}: ${k}`]) if (t.length <= 62) return t;
  return `${team.short} bars in ${metro.name}: ${k} the game`;
}
function pageDesc(team, metro, spots, lc) {
  const term = FAN_TERM[team.id] || `${team.short} fans`;
  const upd = ` Updated ${monthYear(lc)}.`;
  const names = spots.slice(0, 3).map(s => s.name);
  for (const k of [3, 2, 1]) {
    const n = names.slice(0, k), r = spots.length - k;
    const d = `Find ${an(team.short)} ${team.short} bar in ${metro.name}: ${term} watch the game at ${joinList(n)}${r > 0 ? ` and ${r} more` : ''}.${upd}`;
    if (d.length <= 158) return d;
  }
  return `Find ${an(team.short)} ${team.short} bar in ${metro.name}: ${spots.length} bars and fan clubs for ${term}.${upd}`;
}
function intro(team, metro, spots) {
  const term = FAN_TERM[team.id] || `${team.short} fans`;
  const t = s => { const x = town(s); return x && x !== metro.name ? ` in ${esc(x)}` : ''; };
  const towns = [...new Set(spots.map(town).filter(x => x && x !== metro.name))];
  const top = spots.slice(0, 3).map(s => `${esc(s.name)}${t(s)}`);
  const more = spots.length - top.length;
  const mine = c => [team.short, team.loc, team.abbr, team.name].some(w => w && c.toLowerCase().includes(w.toLowerCase()));
  const clubs = [...new Set(spots.map(s => s.club).filter(c => c && mine(c)))].slice(0, 3);
  const art = an(team.short);
  return `<p class="intro">Looking for ${art} ${esc(team.short)} bar in ${esc(metro.name)}? ${esc(term)} in the area${towns.length > 1 ? `, from ${esc(joinList(towns.slice(0, 4)))},` : ''} watch games at ${joinList(top)}${more > 0 ? `, plus ${more} more below` : ''}.${clubs.length ? ` Listed groups include ${esc(joinList(clubs))}.` : ''} Call ahead on game days to make sure the bar will have your game on.</p>`;
}

// ---- outputs
const out = new Map();  // path under root -> html
const urls = [];        // { loc, lastmod }

// team x city
for (const p of pairs) {
  const { team, metro, spots, ts, mk } = p;
  const name = disp(team), city = cityName(metro);
  const url = `/watch/${ts}/${mk}/`;
  const fans = fansIn.get(`${team.id}|${mk}`) || 0;
  const lc = lastChecked(spots);
  const clubs = spots.filter(s => s.club).length;
  const otherCities = (pairsByTeam.get(team.id) || []).filter(q => q.mk !== mk).slice(0, 12);
  const otherTeams = (pairsByCity.get(mk) || []).filter(q => q.team.id !== team.id).slice(0, 12);
  const sb = scheduleBlock(team, metro.name);
  const nearest = p.thin ? (pairsByTeam.get(team.id) || []).filter(q => q.mk !== mk).map(q => ({ q, d: km(metro, q.metro) })).sort((a, b) => a.d - b.d).slice(0, 6) : [];
  const body = `
<header class="watch-hero">${teamLogo(team, 'logo lg')}<div>
  <span class="eyebrow">${esc(LEAGUES[team.lg] || '')} · ${esc(city)}</span>
  <h1>Where to watch ${esc(name)} games in ${esc(metro.name)}</h1>
  <p class="lede">${plural(spots.length, 'bar and fan watch spot')} in the ${esc(metro.name)} area where ${esc(team.short)} fans watch the game${clubs ? `, including ${plural(clubs, 'official fan club and alumni chapter')}` : ''}. Last checked ${esc(monthYear(lc))}.${nextLine(team, sb.next)}</p>
</div></header>

${FOLLOW(team)}

${intro(team, metro, spots)}

<ul class="spots">
${spots.map(spotCard).join('\n')}
</ul>

${SHARE(url, `${name} bars in ${city}`, `${ts}-${mk}`, `Know ${an(team.short)} ${esc(team.short)} fan in ${esc(metro.name)}? Send them this page.`)}

${sb.html}
${nearest.length ? `<section class="more"><h2>Nearest ${esc(team.short)} watch spots in other cities</h2><div class="chips">${nearest.map(x => chip(`/watch/${x.q.ts}/${x.q.mk}/`, `${cityName(x.q.metro)} · ${Math.round(x.d * 0.621)} mi`, x.q.spots.length)).join('')}</div></section>` : ''}

${fans ? `<p class="fans"><b>${plural(fans, 'fan')}</b> following ${esc(team.short)} near ${esc(metro.name)} ${fans === 1 ? 'has' : 'have'} joined Distant Fan.</p>` : ''}
${CTA(`Watching ${esc(team.short)} in ${esc(metro.name)}?`, team)}

<section class="more">
  <p>Missing a spot, or run ${an(team.short)} ${esc(team.short)} fan club here? <a href="/app.html">Add it in the app</a> or <a href="/#clubs">tell us about your club</a>. Bars can be listed for free.</p>
  ${otherCities.length ? `<h2>${esc(name)} in other cities</h2><div class="chips">${otherCities.map(q => chip(`/watch/${q.ts}/${q.mk}/`, cityName(q.metro), q.spots.length)).join('')}</div>` : ''}
  ${otherTeams.length ? `<h2>More fan bars in ${esc(metro.name)}</h2><div class="chips">${otherTeams.map(q => chip(`/watch/${q.ts}/${q.mk}/`, disp(q.team), q.spots.length)).join('')}</div>` : ''}
  <p><a href="/watch/in/${mk}/">All teams in ${esc(city)}</a> · <a href="/watch/${ts}/">${esc(name)} in every city</a></p>
</section>
${sb.html ? TIME_JS : ''}
${SHARE_JS}`;
  const desc0 = pageDesc(team, metro, spots, lc), nx = sb.next ? ` Next game: ${fmtShort(sb.next)} ${sb.next.home ? 'vs' : 'at'} ${oppShort(team, sb.next)}.` : '';
  out.set(`watch/${ts}/${mk}/index.html`, page({
    url, title: TITLE_TEST.has(`${ts}/${mk}`) ? testTitle(team, metro, spots.length) : pageTitle(team, name, metro, spots.length),
    desc: desc0.length + nx.length <= 158 ? desc0 + nx : desc0,
    body, crumbs: [['Home', '/'], ['Where to watch', '/watch/'], [name, `/watch/${ts}/`], [metro.name, url]],
    image: ogFor(team),
    ld: [itemListLd(`${name} watch spots in ${city}`, spots), ...sb.ld],
  }));
  urls.push({ loc: url, lastmod: isoDay(Math.max(lc, sb.changed)) });
}

// venues
for (const v of venues) {
  const { s, slug, metro, mk, town: twn } = v;
  const url = venueUrl.get(s), city = cityName(metro);
  const teams = (s.teams || []).map(id => TEAM_BY_ID[id]).filter(Boolean);
  const tnames = teams.map(t => t.short);
  const lead = teams[0];
  const nearby = teams.flatMap(t => (byPair.get(`${t.id}|${mk}`) || []).filter(o => o !== s && venueUrl.has(o)).map(o => ({ o, t }))).filter((x, i, a) => a.findIndex(y => y.o === x.o) === i).slice(0, 8);
  const pairLinks = teams.map(t => pairs.find(p => p.team.id === t.id && p.mk === mk)).filter(Boolean);
  const src = s.sourceUrl && /^https?:\/\//.test(s.sourceUrl) ? `<a href="${esc(s.sourceUrl)}" rel="nofollow noopener" target="_blank">${esc(s.sourceName || 'source')}</a>` : esc(s.sourceName || '');
  const lc = s.checkedAt || s.createdAt || 0;
  const sb = scheduleBlock(lead, twn, 4);
  const body = `
<header class="watch-hero">${teamLogo(lead, 'logo lg')}<div>
  <span class="eyebrow">${esc(twn)}, ${esc(metro.st)} · ${esc(joinList(tnames.slice(0, 3)))} fans</span>
  <h1>${esc(s.name)}: ${esc(joinList(tnames.slice(0, 3)))} fan bar in ${esc(twn)}</h1>
  <p class="lede">${esc(s.note)}</p>
</div></header>

${FOLLOW(lead)}

<section class="venue">
  <dl>
    <dt>Address</dt><dd>${s.address ? `<a href="${esc(spotUrl(s))}" rel="nofollow noopener" target="_blank">${esc(s.address)}</a>` : esc(city)}</dd>
    <dt>Fans who gather here</dt><dd>${esc(joinList(teams.map(disp)))}</dd>
    ${s.club ? `<dt>Group</dt><dd>${esc(s.club)}</dd>` : ''}
    ${lc ? `<dt>Last checked</dt><dd>${esc(monthYear(lc))}${src ? ` · Source: ${src}` : ''}</dd>` : ''}
  </dl>
  <p class="muted">Looking for ${an(lead.short)} ${esc(lead.short)} bar in ${esc(twn)}? Call ${esc(s.name)} before game day to confirm they will have your game on, since schedules and rooms change.</p>
</section>

${sb.html}

${CTA(`Watching at ${esc(s.name)}?`, lead)}

<section class="more">
  <p>Something out of date? <a href="/app.html">Tell us in the app</a>.</p>
  ${nearby.length ? `<h2>More fan bars in ${esc(metro.name)}</h2><div class="chips">${nearby.map(x => chip(venueUrl.get(x.o), x.o.name)).join('')}</div>` : ''}
  <p>${pairLinks.map(p => `<a href="/watch/${p.ts}/${p.mk}/">${esc(disp(p.team))} in ${esc(metro.name)}</a>`).join(' · ')}${pairLinks.length ? ' · ' : ''}<a href="/watch/in/${mk}/">All teams in ${esc(city)}</a></p>
</section>
${sb.html ? TIME_JS : ''}`;
  out.set(`watch/at/${slug}/index.html`, page({
    url, title: `${s.name}, ${twn} ${metro.st}: ${joinList(tnames.slice(0, 2))} fan bar`,
    desc: `${s.name} at ${s.address || city}: where ${joinList(tnames.slice(0, 3))} fans watch games in ${twn}. ${s.club ? s.club + '. ' : ''}Updated ${monthYear(lc || generatedAt)}.`.slice(0, 200),
    body, crumbs: [['Home', '/'], ['Where to watch', '/watch/'], [city, `/watch/in/${mk}/`], [s.name, url]],
    image: ogFor(lead),
    ld: [{ '@context': 'https://schema.org', '@type': 'BarOrPub', name: s.name, ...(s.address ? { address: s.address } : {}), geo: { '@type': 'GeoCoordinates', latitude: +s.lat.toFixed(5), longitude: +s.lng.toFixed(5) }, description: s.note }, ...sb.ld],
  }));
  urls.push({ loc: url, lastmod: isoDay(Math.max(lc || generatedAt, sb.changed)) });
}

// team hubs
for (const [tid, list] of pairsByTeam) {
  const team = TEAM_BY_ID[tid], name = disp(team), ts = teamSlug(team);
  const total = list.reduce((n, p) => n + p.spots.length, 0);
  const lc = Math.max(...list.map(p => lastChecked(p.spots)));
  const body = `
<header class="watch-hero">${teamLogo(team, 'logo lg')}<div>
  <span class="eyebrow">${esc(LEAGUES[team.lg] || '')}</span>
  <h1>Where to watch ${esc(name)} games away from home</h1>
  <p class="lede">${plural(total, 'watch spot')} for ${esc(team.short)} fans across ${plural(list.length, 'city', 'cities')}. Pick yours.</p>
</div></header>
<div class="chips big">${list.map(p => chip(`/watch/${ts}/${p.mk}/`, cityName(p.metro), p.spots.length)).join('')}</div>
${SHARE(`/watch/${ts}/`, `Where to watch ${name} games away from home`, ts, `Know ${esc(team.short)} fans who moved away? Send them this list.`)}
${CTA(`Not near one of these?`, team)}
${SHARE_JS}`;
  out.set(`watch/${ts}/index.html`, page({
    url: `/watch/${ts}/`, title: `Where to watch ${name} games: ${list.length} cities with fan bars`,
    desc: `${total} bars and fan clubs where ${team.short} fans watch games, in ${list.slice(0, 4).map(p => p.metro.name).join(', ')} and more.`,
    body, crumbs: [['Home', '/'], ['Where to watch', '/watch/'], [name, `/watch/${ts}/`]],
    image: ogFor(team),
  }));
  urls.push({ loc: `/watch/${ts}/`, lastmod: isoDay(lc) });
}

// city hubs
const cityPages = [...byCity.entries()].filter(([, set]) => set.size >= CITY_MIN).sort((a, b) => b[1].size - a[1].size);
for (const [mk, set] of cityPages) {
  const metro = metros.get(mk), city = cityName(metro);
  const teamIds = new Set();
  for (const s of set) for (const id of s.teams || []) if (TEAM_BY_ID[id]) teamIds.add(id);
  const groups = [...teamIds].map(id => ({ team: TEAM_BY_ID[id], list: byPair.get(`${id}|${mk}`) || [] })).filter(g => g.list.length)
    .sort((a, b) => b.list.length - a.list.length || disp(a.team).localeCompare(disp(b.team)));
  const lc = lastChecked([...set]);
  const body = `
<header class="watch-hero"><div>
  <span class="eyebrow">${esc(city)}</span>
  <h1>Where to watch out-of-town teams in ${esc(metro.name)}</h1>
  <p class="lede">${plural(set.size, 'bar and fan watch spot')} in the ${esc(metro.name)} area for fans of ${plural(groups.length, 'team')}. Last checked ${esc(monthYear(lc))}.</p>
</div></header>
${groups.map(g => {
    const has = pairs.find(p => p.team.id === g.team.id && p.mk === mk);
    const nm = disp(g.team);
    return `<section class="tgroup"><h2>${teamLogo(g.team, 'logo sm')} ${has ? `<a href="/watch/${has.ts}/${mk}/">${esc(nm)}</a>` : esc(nm)} <span class="n">${g.list.length}</span></h2>
<ul class="plain">${g.list.map(s => `<li><b>${esc(s.name)}</b>${s.address ? ` <span class="muted">· ${esc(s.address)}</span>` : ''}</li>`).join('')}</ul></section>`;
  }).join('\n')}
${CTA(`Live in ${esc(metro.name)}?`)}`;
  out.set(`watch/in/${mk}/index.html`, page({
    url: `/watch/in/${mk}/`, title: `Where to watch out-of-town teams in ${city}: ${set.size} fan bars`,
    desc: `${set.size} bars and fan clubs in ${metro.name} for ${groups.slice(0, 4).map(g => g.team.short).join(', ')} fans and more.`,
    body, crumbs: [['Home', '/'], ['Where to watch', '/watch/'], [city, `/watch/in/${mk}/`]],
    ld: [itemListLd(`Fan bars in ${city}`, [...set].sort(cmpName))],
  }));
  urls.push({ loc: `/watch/in/${mk}/`, lastmod: isoDay(lc) });
}

// hub
{
  const teamRows = [...pairsByTeam.entries()].map(([tid, l]) => ({ team: TEAM_BY_ID[tid], n: l.reduce((a, p) => a + p.spots.length, 0), cities: l.length }))
    .sort((a, b) => b.n - a.n);
  const body = `
<header class="watch-hero"><div>
  <span class="eyebrow">Away from home</span>
  <h1>Where to watch your team, wherever you live</h1>
  <p class="lede">Bars, fan clubs and alumni chapters where out-of-town fans gather to watch the game. ${plural(live.length, 'spot')} tracked, refreshed every week.</p>
</div></header>
<h2 class="sec">By city</h2>
<div class="chips big">${cityPages.map(([mk, set]) => chip(`/watch/in/${mk}/`, cityName(metros.get(mk)), set.size)).join('')}</div>
<h2 class="sec">By team</h2>
<div class="chips big">${teamRows.map(r => chip(`/watch/${teamSlug(r.team)}/`, disp(r.team), r.n)).join('')}</div>
${CTA('Your team, wherever you are.')}`;
  out.set('watch/index.html', page({
    url: '/watch/', title: 'Where to watch your team away from home | Distant Fan',
    desc: `Find bars, fan clubs and alumni chapters that show your team's games in ${cityPages.length} US cities. NFL, college football, NBA, MLB, NHL and MLS.`,
    body, crumbs: [['Home', '/'], ['Where to watch', '/watch/']],
  }));
  urls.push({ loc: '/watch/', lastmod: isoDay(lastChecked(live)) });
}

// Crawlable links on the landing page: the biggest team and city hubs, as plain anchors, so the home page
// passes link weight to them (the picker is script-drawn and gives crawlers nothing). index.html is
// hand-written; only the block between the watch-links markers is rewritten.
{
  const f = path.join(root, 'index.html');
  const h = fs.readFileSync(f, 'utf8');
  const teamTop = [...pairsByTeam.entries()].map(([tid, l]) => ({ team: TEAM_BY_ID[tid], n: l.reduce((a, p) => a + p.spots.length, 0) }))
    .sort((a, b) => b.n - a.n || disp(a.team).localeCompare(disp(b.team))).slice(0, 18);
  const cityTop = cityPages.slice(0, 12);
  const a = (href, label, n) => `<a class="wlink" href="${href}">${esc(label)} <b>${n}</b></a>`;
  const block = `<!-- watch-links:start -->
    <h3 class="wl-h">Popular teams</h3>
    <div class="wlinks">${teamTop.map(r => a(`/watch/${teamSlug(r.team)}/`, disp(r.team), r.n)).join('')}</div>
    <h3 class="wl-h">Popular cities</h3>
    <div class="wlinks">${cityTop.map(([mk, set]) => a(`/watch/in/${mk}/`, cityName(metros.get(mk)), set.size)).join('')}</div>
    <p class="fine"><a href="/watch/">See every team and city</a></p>
    <!-- watch-links:end -->`;
  const next = h.replace(/<!-- watch-links:start -->[\s\S]*?<!-- watch-links:end -->/, () => block);
  if (next !== h) fs.writeFileSync(f, next);
}

// Compact team -> city index for the landing-page picker (index.html): per city [metro key, name, state,
// spot count, fans on Distant Fan, first three venue names], biggest city first. Fetched lazily.
{
  const teamsIdx = {};
  for (const [tid, list] of pairsByTeam) {
    teamsIdx[tid] = { ts: teamSlug(TEAM_BY_ID[tid]), cities: list.map(p => [p.mk, p.metro.name, p.metro.st, p.spots.length, fansIn.get(`${tid}|${p.mk}`) || 0, p.spots.slice(0, 3).map(s => noDash(s.name))]) };
  }
  out.set('data/watch-index.json', JSON.stringify({ v: 1, teams: teamsIdx }) + '\n');
}

// ---- About and Privacy: plain trust pages (who runs this, where listings come from, what is stored)
{
  const nTeams = TEAMS.length;
  const about = `<div class="static"><h1>About Distant Fan</h1>
<p class="intro">Distant Fan helps sports fans who live away from their team find each other. For any team and city it shows the bars, official fan clubs and alumni chapters where that team's fans watch the game, and it adds a way to see which fans live nearby and chat on game day.</p>
<h2 class="sec">Who it's for</h2>
<p>Fans who moved away from their team's home market, fans whose team is on the road, and anyone who wants a room full of people who care about the same team. It covers ${nTeams} teams across the NFL, college football, college basketball, the NBA, MLB, the NHL and MLS. It is free to use.</p>
<h2 class="sec">Where the listings come from</h2>
<p>Every watch spot on this site comes from a named source and is dated. The main sources are official team and league fan-club maps (for example the Eagles Landings and Browns Backers directories), alumni association watch-party pages, the venues themselves, and fans who add or correct a place. Each listing shows when it was last checked and where it came from. Game schedules and TV channels come from ESPN's public schedule feed.</p>
<p>Bars change their rooms and sound policies, and out-of-market games usually need a package such as NFL Sunday Ticket, so confirm with the venue before you go. If a listing is wrong or missing, tell us and we will fix it.</p>
<h2 class="sec">Independent, and how it is paid for</h2>
<p>Distant Fan is an independent project and is not affiliated with any team, league or broadcaster. Team names and logos belong to their owners. Some gear links in the app go to Fanatics; if you buy through one, Distant Fan earns a commission at no extra cost to you. Bars are listed for free and listings are never sold or ranked by payment.</p>
<h2 class="sec">Get in touch</h2>
<p>Email <a href="mailto:brian@distantfan.com">brian@distantfan.com</a> with questions, corrections or press requests.</p>
<p>Run a bar, a fan club or an alumni chapter? <a href="/#own-a-bar">Ask to be listed</a> or <a href="/#clubs">tell us about your club</a>. Found a mistake? Use the add-a-spot form in <a href="/app.html">the app</a>. Read how we handle your data on the <a href="/privacy.html">privacy page</a>.</p>
</div>
${CTA('Your team, wherever you are.')}`;
  out.set('about.html', page({
    url: '/about.html', title: 'About Distant Fan: where out-of-market fans watch',
    desc: 'Distant Fan is a free, independent fan network that lists the bars, fan clubs and alumni chapters where your team plays on TV, with sources and check dates.',
    body: about, crumbs: [['Home', '/'], ['About', '/about.html']],
    ld: [{ '@context': 'https://schema.org', '@type': 'AboutPage', url: SITE + '/about.html', name: 'About Distant Fan', about: { '@id': SITE + '/#org' } }],
  }));
  urls.push({ loc: '/about.html', lastmod: isoDay(generatedAt) });

  const priv = `<div class="static"><h1>Privacy</h1>
<p class="intro">Distant Fan only works if fans feel safe on it, so the design goal is simple: nobody, including us, can see where you live.</p>
<h2 class="sec">What other fans can see</h2>
<ul>
<li><b>Area, not address.</b> Your home location is rounded to a grid square about 3 miles wide on your own device. Your exact position is never sent or stored, and the database rejects anything more precise.</li>
<li><b>A name and your teams.</b> Other fans see the first name and initial you choose, and the teams you follow. The map draws a circle for an area, never a pin for a person.</li>
<li><b>Delete anytime.</b> Removing your profile takes you off the map immediately.</li>
</ul>
<h2 class="sec">What we store</h2>
<p>You can browse every watch page without an account. If you sign up (with Google or an email and password), we store your sign-in details, the name and teams you choose, your rough area, your chat messages, and an email address for the weekly game-day email, which you can stop at any time with the unsubscribe link in each message. Accounts and data are held in Google Firebase.</p>
<h2 class="sec">Analytics and cookies</h2>
<p>We use Google Analytics through Firebase to count page views and which features get used. Separately, your browser remembers how you first reached the site (the referring site and any campaign tag) in local storage, and we copy that coarse source onto your profile if you sign up. No advertising cookies are set by Distant Fan.</p>
<h2 class="sec">Affiliate links</h2>
<p>Some gear links in the app go to Fanatics. If you buy through one, Distant Fan earns a commission at no extra cost to you. Clicking one shares nothing about you with us, and the shop sets its own cookies once you land there.</p>
<h2 class="sec">Questions or removal requests</h2>
<p>You can edit or delete your profile in <a href="/app.html">the app</a>. To ask us anything else about your data, or to have your data removed, email <a href="mailto:brian@distantfan.com">brian@distantfan.com</a>.</p></div>`;
  out.set('privacy.html', page({
    url: '/privacy.html', title: 'Privacy: how Distant Fan protects your location',
    desc: 'Your home location is rounded to a roughly 3 mile grid square on your device and never stored precisely. What other fans see, what we store, and how to delete it.',
    body: priv, crumbs: [['Home', '/'], ['Privacy', '/privacy.html']],
  }));
  urls.push({ loc: '/privacy.html', lastmod: isoDay(generatedAt) });
}

// home page in the sitemap
urls.unshift({ loc: '/', lastmod: isoDay(generatedAt) });
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${SITE}${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;
out.set('sitemap.xml', sitemap);
out.set('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

// ---- redirects: GitHub Pages has no server rules, so a page that disappears (spots moved to a nearer city,
// a venue renamed) leaves a small meta-refresh stub at its old URL, with a canonical pointing at the new one.
// data/redirects.json remembers every retired URL; pages that vanish in this run are added automatically.
const redirFile = path.join(root, 'data/redirects.json');
const saved = fs.existsSync(redirFile) ? JSON.parse(fs.readFileSync(redirFile, 'utf8')) : { paths: [], geo: {} };
const retired = new Set(saved.paths), retiredGeo = { ...(saved.geo || {}) };
const geoOf = h => { const m = h.match(/"latitude":([-\d.]+),"longitude":([-\d.]+)/); return m ? `${m[1]},${m[2]}` : null; };
const isStub = h => h.includes('data-redirect');
(function collect(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) collect(f);
    else if (e.name === 'index.html') {
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (out.has(rel)) continue;
      const old = fs.readFileSync(f, 'utf8');
      if (isStub(old)) continue;
      const u = '/' + rel.slice(0, -'index.html'.length);
      retired.add(u);
      if (geoOf(old)) retiredGeo[u] = geoOf(old);
    }
  }
})(path.join(root, 'watch'));
const pageKey = u => u.slice(1) + 'index.html';
const tokens = u => u.split('/').filter(Boolean).pop().split('-');
function redirectTarget(u) {
  if (u.startsWith('/watch/at/')) {   // a venue page: the same venue is the page with the same coordinates
    if (retiredGeo[u]) { const k = [...out.keys()].find(k => k.startsWith('watch/at/') && geoOf(out.get(k)) === retiredGeo[u]); return k ? '/' + k.slice(0, -'index.html'.length) : '/watch/'; }
    const t = tokens(u); let best = null, bestN = 0;
    for (const k of out.keys()) {
      if (!k.startsWith('watch/at/') || !k.endsWith('/index.html')) continue;
      const t2 = k.split('/')[2].split('-'); let n = 0;
      while (n < t.length && n < t2.length && t[n] === t2[n]) n++;
      if (n > bestN) { bestN = n; best = '/' + k.slice(0, -'index.html'.length); }
    }
    if (best && bestN >= Math.max(2, t.length - 3)) return best;
    return '/watch/';
  }
  const parts = u.split('/').filter(Boolean);   // team x city page: fall back to the team hub, then the main hub
  for (let n = parts.length - 1; n >= 1; n--) { const c = '/' + parts.slice(0, n).join('/') + '/'; if (out.has(pageKey(c))) return c; }
  return '/watch/';
}
const retiredList = [...retired].sort();
let stubs = 0;
for (const u of retiredList) {
  if (out.has(pageKey(u))) continue;   // the page is live again
  const to = redirectTarget(u);
  out.set(pageKey(u), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Moved | Distant Fan</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="redirect" content="${to}" data-redirect>
<link rel="canonical" href="${SITE}${to}">
<meta http-equiv="refresh" content="0; url=${to}">
<script>location.replace(${JSON.stringify(to)});</script></head>
<body><p>This page moved. <a href="${to}">Continue to the new page</a>.</p></body></html>
`);
  stubs++;
}
fs.mkdirSync(path.dirname(redirFile), { recursive: true });
fs.writeFileSync(redirFile, JSON.stringify({ paths: retiredList, geo: retiredGeo }, null, 1) + '\n');

// ---- write only what changed, drop pages that no longer qualify
let wrote = 0, removed = 0;
for (const [rel, html] of out) {
  const f = path.join(root, rel);
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === html) continue;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
  wrote++;
}
const stale = [];
(function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (!out.has(path.relative(root, p).split(path.sep).join('/'))) stale.push(p);
  }
})(path.join(root, 'watch'));
for (const p of stale) { fs.unlinkSync(p); removed++; }
(function prune(d) {   // remove directories left empty
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) prune(path.join(d, e.name));
  try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch {}
})(path.join(root, 'watch'));

console.error(`pages: ${pairs.length} team x city (${pairs.filter(p => p.thin).length} thin), ${pairsByTeam.size} team hubs, ${cityPages.length} city hubs, 1 hub, ${venues.length} venues; wrote ${wrote}, removed ${removed} (min ${MIN_SPOTS} spots/pair)`);
