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
//
// A team x city page only exists once it has MIN_SPOTS real spots, so nothing is thin. Spots are
// assigned to the nearest metro within 60 km (same list the app uses); anything further out stays
// app-only. Output is deterministic (no build timestamps) so a rebuild with unchanged data is a
// no-op in git. Files that no longer qualify are deleted. Run by export-spots.mjs --commit.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TEAMS, TEAM_BY_ID, LEAGUES } from '../assets/js/teams.js';
import { nearestMetro, center } from '../assets/js/geo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://distantfan.com';
const MIN_SPOTS = +(process.argv.find(a => a.startsWith('--min='))?.slice(6) || 3);
const CITY_MIN = 5;          // a city page needs this many spots in total
const METRO_KM = 60;
const ESPN_PATH = { nfl: 'football/nfl', cfb: 'football/college-football', nba: 'basketball/nba', cbb: 'basketball/mens-college-basketball', mlb: 'baseball/mlb', nhl: 'hockey/nhl', mls: 'soccer/usa.1' };

const readJson = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const { spots: allSpots, generatedAt } = readJson('data/spots.json');
const fansData = fs.existsSync(path.join(root, 'data/fans.json')) ? readJson('data/fans.json') : { teams: {} };

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
for (const s of live) {
  const m = nearestMetro(s, METRO_KM);
  if (!m || m.st.length !== 2 || /^(ON|BC|QC|AB|UK|IE|MX|AU)$/.test(m.st)) continue; // US metros only
  const mk = citySlug(m);
  metros.set(mk, m);
  (byCity.get(mk) || byCity.set(mk, new Set()).get(mk)).add(s);
  for (const id of s.teams || []) {
    if (!TEAM_BY_ID[id]) continue;
    const k = `${id}|${mk}`;
    (byPair.get(k) || byPair.set(k, []).get(k)).push(s);
  }
}
const cmpName = (a, b) => a.name.localeCompare(b.name);
for (const list of byPair.values()) list.sort(cmpName);

const pairs = [...byPair.entries()].filter(([, l]) => l.length >= MIN_SPOTS).map(([k, list]) => {
  const [id, mk] = k.split('|');
  return { team: TEAM_BY_ID[id], mk, metro: metros.get(mk), spots: list, ts: teamSlug(TEAM_BY_ID[id]) };
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

// ---- fan counts per team x metro (fans.json cells are geohash-4, no names)
const fansIn = new Map();
for (const [tid, cells] of Object.entries(fansData.teams || {})) {
  for (const [cell, n] of Object.entries(cells)) {
    const m = nearestMetro(center(cell), METRO_KM);
    if (m) fansIn.set(`${tid}|${citySlug(m)}`, (fansIn.get(`${tid}|${citySlug(m)}`) || 0) + n);
  }
}

// ---- shared chrome
const V = { style: hash('assets/css/style.css'), watch: hash('assets/css/watch.css') };
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
<meta property="og:image" content="${SITE}/assets/img/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b1016">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/style.css?v=${V.style}">
<link rel="stylesheet" href="/assets/css/watch.css?v=${V.watch}">
${[crumbLd, ...ld].map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header class="site-head"><div class="wrap">${BRAND}<nav><a href="/watch/">Where to watch</a><a class="btn sm primary" href="/app.html">Open the app</a></nav></div></header>
<main class="wrap watch">
<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => i === crumbs.length - 1 ? `<span>${esc(c[0])}</span>` : `<a href="${c[1]}">${esc(c[0])}</a>`).join(' <i>/</i> ')}</nav>
${body}
</main>
<footer class="site-foot"><div class="wrap"><span>© ${new Date(generatedAt).getUTCFullYear()} Distant Fan</span><span>Team names and logos belong to their teams and leagues. Listings gathered from official fan-club and alumni directories, venues and fans; confirm with the venue before you go.</span></div></footer>
</body>
</html>
`;
}

const lastChecked = list => Math.max(0, ...list.map(s => s.checkedAt || s.createdAt || 0));
const chip = (href, label, n) => `<a class="chip" href="${href}">${esc(label)}${n != null ? ` <b>${n}</b>` : ''}</a>`;
const teamLogo = (t, cls = 'logo') => t.logo ? `<img class="${cls}" src="${esc(t.logo)}" alt="" width="56" height="56" loading="lazy">` : '';
const spotUrl = (s, dest) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.address || ''}`.trim())}`;

function spotCard(s) {
  const src = s.sourceUrl && /^https?:\/\//.test(s.sourceUrl) ? `<a href="${esc(s.sourceUrl)}" rel="nofollow noopener" target="_blank">${esc(s.sourceName || 'source')}</a>` : esc(s.sourceName || '');
  return `<li class="spot">
  <h3>${esc(s.name)}</h3>
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

const CTA = (line) => `<section class="cta"><div><h2>${line}</h2><p>Free. Follow your teams, see the fans near you and who's going to the next game. You only share a rough area, never your address.</p></div><a class="btn lg primary" href="/app.html">Find my people</a></section>`;

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
  const path_ = ESPN_PATH[team.lg];
  const body = `
<header class="watch-hero">${teamLogo(team, 'logo lg')}<div>
  <span class="eyebrow">${esc(LEAGUES[team.lg] || '')} · ${esc(city)}</span>
  <h1>Where to watch ${esc(name)} games in ${esc(metro.name)}</h1>
  <p class="lede">${plural(spots.length, 'bar and fan watch spot')} in the ${esc(metro.name)} area where ${esc(team.short)} fans watch the game${clubs ? `, including ${plural(clubs, 'official fan club and alumni chapter')}` : ''}. Last checked ${esc(monthYear(lc))}.</p>
</div></header>

<div class="nextgame" id="nextgame" data-path="${esc(path_)}" data-eid="${esc(team.eid)}" data-short="${esc(team.short)}" hidden></div>

<ul class="spots">
${spots.map(spotCard).join('\n')}
</ul>

${fans ? `<p class="fans"><b>${plural(fans, 'fan')}</b> following ${esc(team.short)} near ${esc(metro.name)} ${fans === 1 ? 'has' : 'have'} joined Distant Fan.</p>` : ''}
${CTA(`Watching ${esc(team.short)} in ${esc(metro.name)}?`)}

<section class="more">
  <p>Missing a spot, or run a ${esc(team.short)} fan club here? <a href="/app.html">Add it in the app</a> or <a href="/#clubs">tell us about your club</a>. Bars can be listed for free.</p>
  ${otherCities.length ? `<h2>${esc(name)} in other cities</h2><div class="chips">${otherCities.map(q => chip(`/watch/${q.ts}/${q.mk}/`, cityName(q.metro), q.spots.length)).join('')}</div>` : ''}
  ${otherTeams.length ? `<h2>More fan bars in ${esc(metro.name)}</h2><div class="chips">${otherTeams.map(q => chip(`/watch/${q.ts}/${q.mk}/`, disp(q.team), q.spots.length)).join('')}</div>` : ''}
  <p><a href="/watch/in/${mk}/">All teams in ${esc(city)}</a> · <a href="/watch/${ts}/">${esc(name)} in every city</a></p>
</section>
${nextGameScript()}`;
  out.set(`watch/${ts}/${mk}/index.html`, page({
    url, title: `${name} watch spots in ${city} (${spots.length} bars & fan clubs)`,
    desc: `Where ${team.short} fans watch games in ${metro.name}: ${spots.slice(0, 3).map(s => s.name).join(', ')}${spots.length > 3 ? ` and ${spots.length - 3} more` : ''}. Updated ${monthYear(lc)}.`,
    body, crumbs: [['Home', '/'], ['Where to watch', '/watch/'], [name, `/watch/${ts}/`], [metro.name, url]],
    ld: [itemListLd(`${name} watch spots in ${city}`, spots)],
  }));
  urls.push({ loc: url, lastmod: isoDay(lc) });
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
${CTA(`Not near one of these?`)}`;
  out.set(`watch/${ts}/index.html`, page({
    url: `/watch/${ts}/`, title: `Where to watch ${name} games: ${list.length} cities with fan bars`,
    desc: `${total} bars and fan clubs where ${team.short} fans watch games, in ${list.slice(0, 4).map(p => p.metro.name).join(', ')} and more.`,
    body, crumbs: [['Home', '/'], ['Where to watch', '/watch/'], [name, `/watch/${ts}/`]],
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

function nextGameScript() {
  return `<script>
(function () {
  var el = document.getElementById('nextgame');
  if (!el || !window.fetch) return;
  fetch('https://site.api.espn.com/apis/site/v2/sports/' + el.dataset.path + '/teams/' + el.dataset.eid + '/schedule')
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (j) {
      var cutoff = Date.now() - 4 * 3.6e6, g = null;
      (j.events || []).some(function (e) {
        var c = e.competitions && e.competitions[0]; if (!c || Date.parse(e.date) < cutoff) return false;
        var us = c.competitors.filter(function (x) { return x.team && x.team.id === el.dataset.eid; })[0];
        var them = c.competitors.filter(function (x) { return x.team && x.team.id !== el.dataset.eid; })[0];
        if (!us || !them) return false;
        g = { t: Date.parse(e.date), tbd: c.timeValid === false || e.timeValid === false, home: us.homeAway === 'home', opp: them.team.displayName,
          tv: (c.broadcasts || []).map(function (b) { return b.media && b.media.shortName; }).filter(Boolean) };
        return true;
      });
      if (!g) return;
      var d = new Date(g.t), day = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      var time = g.tbd ? 'time TBA' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      el.innerHTML = '<b>Next game:</b> ' + el.dataset.short + (g.home ? ' vs ' : ' at ') + g.opp.replace(/</g, '&lt;') + ' · ' + day + ', ' + time + (g.tv.length ? ' · ' + g.tv.join(', ') : '') + ' <a href="/app.html">See who\\'s going</a>';
      el.hidden = false;
    }).catch(function () {});
})();
</script>`;
}

// home page in the sitemap
urls.unshift({ loc: '/', lastmod: isoDay(generatedAt) });
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${SITE}${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;
out.set('sitemap.xml', sitemap);
out.set('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

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

console.error(`pages: ${pairs.length} team x city, ${pairsByTeam.size} team hubs, ${cityPages.length} city hubs, 1 hub; wrote ${wrote}, removed ${removed} (min ${MIN_SPOTS} spots/pair)`);
