import * as S from './store.js?v=202609220946';
import { SITE, ADMINS } from './config.js?v=202609220946';
import { TEAMS, TEAM_BY_ID, LEAGUES } from './teams.js?v=202609220946';
import { METROS } from './metros.js?v=202609220946';
import { encode, center, bounds, areaLabel, km } from './geo.js?v=202609220946';
import { nextGames } from './schedule.js?v=202609220946';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#root');
const NEAR_KM = 80;
const isAdmin = () => !!user && ADMINS.includes(user.uid);

let user = null, profile = null, teamId = null, view = 'map';
let map = null, mapLayers = null, unsubRoom = null, room = 'local', adding = false;
let cache = {}; // per-team { fans, spots, checkins }

const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

/* ------------------------------------------------------------------ icons */
const ICON = {
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>',
  games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
};
const BRAND = `<a class="brand" href="./" aria-label="Distant Fan home"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="8" cy="32" r="4.5" fill="currentColor" opacity=".35"/><path d="M12 29C15 20 19 17 23.5 17.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-dasharray=".5 5" opacity=".55"/><path d="M29 3.5a8.5 8.5 0 0 0-8.5 8.5c0 6.4 8.5 15 8.5 15s8.5-8.6 8.5-15A8.5 8.5 0 0 0 29 3.5z" fill="var(--accent)"/><circle cx="29" cy="12" r="3.2" fill="var(--bg)"/></svg><span>Distant<b>Fan</b></span></a>`;
const logo = (t, cls = '') => t?.logo ? `<img class="logo ${cls}" src="${esc(t.logo)}" alt="" loading="lazy">` : `<span class="logo ${cls}"></span>`;

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg; el.setAttribute('role', 'status');
  document.body.append(el); setTimeout(() => el.remove(), 2600);
}
const errMsg = e => (e?.code || '').replace('auth/', '').replace(/-/g, ' ') || e?.message || 'Something went wrong';

/* ------------------------------------------------------------------- boot */
(async function boot() {
  try { await S.init(); }
  catch (e) { root.innerHTML = `<div class="center-card"><h2>Can't connect</h2><p class="muted">${esc(e.message)}</p></div>`; return; }
  S.onUser(async u => {
    user = u; cleanupView();
    if (!u) return renderAuth();
    try { profile = await S.getProfile(u.uid); } catch (e) { profile = null; console.error(e); }
    if (!profile) return renderOnboarding();
    teamId = profile.teams.includes(ls.get('df_team')) ? ls.get('df_team') : profile.teams[0];
    view = views().includes(location.hash.slice(1)) ? location.hash.slice(1) : 'map';
    renderShell();
  });
})();

function cleanupView() {
  unsubRoom?.(); unsubRoom = null;
  if (map) { map.remove(); map = null; mapLayers = null; }
  adding = false;
}

/* ------------------------------------------------------------------- auth */
function renderAuth() {
  const demo = S.mode === 'demo';
  root.innerHTML = `
    <div class="center-card">
      ${BRAND}
      <div><h2>Find your people</h2><p class="muted" style="margin-top:8px">Sign in to see fans of your team near you.</p></div>
      ${demo ? `
        <div class="panel" style="background:var(--accent-soft);border-color:transparent">
          <b>Demo mode.</b> <span class="muted">Accounts aren't switched on yet, so this runs on sample fans and spots. Anything you add stays in this browser.</span>
        </div>
        <form id="demoForm" class="row">
          <input class="input grow" name="name" placeholder="Your first name" autocomplete="given-name" maxlength="30" required>
          <button class="btn primary">Try the demo</button>
        </form>` : `
        <button class="btn block" id="google"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continue with Google</button>
        <div class="divider">or with email</div>
        <form id="emailForm" style="display:grid;gap:12px">
          <label class="field" id="nameField" hidden>Your name<input class="input" name="name" autocomplete="name" maxlength="40"></label>
          <label class="field">Email<input class="input" name="email" type="email" autocomplete="email" required></label>
          <label class="field">Password<input class="input" name="pw" type="password" autocomplete="current-password" minlength="6" required></label>
          <button class="btn primary block" id="emailBtn">Sign in</button>
          <div class="row" style="justify-content:space-between;font-size:14px">
            <button type="button" class="link-btn" id="toggleMode">New here? Create an account</button>
            <button type="button" class="link-btn" id="forgot">Forgot password?</button>
          </div>
        </form>`}
      <p class="err" id="authErr" role="alert"></p>
    </div>`;
  const err = $('#authErr');
  if (demo) {
    $('#demoForm').onsubmit = e => { e.preventDefault(); S.signInDemo(new FormData(e.target).get('name')); };
    return;
  }
  let signUp = false;
  $('#google').onclick = () => S.signInGoogle().catch(e => err.textContent = errMsg(e));
  $('#toggleMode').onclick = () => {
    signUp = !signUp;
    $('#nameField').hidden = !signUp;
    $('#emailBtn').textContent = signUp ? 'Create account' : 'Sign in';
    $('#toggleMode').textContent = signUp ? 'Have an account? Sign in' : 'New here? Create an account';
  };
  $('#forgot').onclick = async () => {
    const email = $('#emailForm').email.value.trim();
    if (!email) { err.textContent = 'Enter your email first.'; return; }
    try { await S.resetPassword(email); err.textContent = ''; toast('Reset link sent. Check your email.'); } catch (e) { err.textContent = errMsg(e); }
  };
  $('#emailForm').onsubmit = async e => {
    e.preventDefault(); err.textContent = '';
    const f = new FormData(e.target);
    try { signUp ? await S.signUpEmail(f.get('email'), f.get('pw'), f.get('name')) : await S.signInEmail(f.get('email'), f.get('pw')); }
    catch (x) { err.textContent = errMsg(x); }
  };
}

/* ------------------------------------------------------------- onboarding */
function renderOnboarding(editing = false) {
  cleanupView();
  const draft = {
    teams: [...(profile?.teams || [])],
    cell: profile?.cell || '',
    area: profile?.area || '',
    name: profile?.name || shortName(user.name),
  };
  let step = 1, league = 'nfl', q = '';

  const draw = () => {
    root.innerHTML = `
      <div class="center-card wide">
        <div class="row" style="justify-content:space-between">${BRAND}<div class="steps-dots">${[1, 2, 3].map(i => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div></div>
        ${step === 1 ? stepTeams() : step === 2 ? stepArea() : stepName()}
        <p class="err" id="obErr" role="alert"></p>
        <div class="row" style="justify-content:space-between">
          ${step > 1 ? '<button class="btn ghost" id="back">Back</button>' : editing ? '<button class="btn ghost" id="cancel">Cancel</button>' : '<span></span>'}
          <button class="btn primary" id="next">${step === 3 ? (editing ? 'Save changes' : 'Find my people') : 'Continue'}</button>
        </div>
      </div>`;
    wire();
  };

  const stepTeams = () => `
    <div><h2>Who do you root for?</h2><p class="muted" style="margin-top:6px">Pick up to ${SITE.maxTeams}. You can change these anytime.</p></div>
    <div class="picked" id="picked">${draft.teams.length ? draft.teams.map(id => {
      const t = TEAM_BY_ID[id]; return `<button class="chip" data-rm="${id}" aria-label="Remove ${esc(t?.name)}">${logo(t, 'sm')}${esc(t?.short)} ✕</button>`;
    }).join('') : '<span class="muted" style="font-size:14px">No teams yet</span>'}</div>
    <input class="input" id="q" placeholder="Search any team: Packers, Buckeyes, Red Sox…" value="${esc(q)}" autocomplete="off">
    ${q ? '' : `<div class="league-tabs">${Object.entries(LEAGUES).map(([k, n]) => `<button class="tab" data-lg="${k}" aria-selected="${k === league}">${esc(n)}</button>`).join('')}</div>`}
    <div class="team-grid">${teamOptions()}</div>`;

  const teamOptions = () => {
    const needle = q.toLowerCase();
    const list = q ? TEAMS.filter(t => `${t.name} ${t.abbr} ${t.loc}`.toLowerCase().includes(needle)).slice(0, 60)
      : TEAMS.filter(t => t.lg === league).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return '<p class="empty">No teams match.</p>';
    return list.map(t => `<button class="team-opt" data-team="${t.id}" aria-pressed="${draft.teams.includes(t.id)}">${logo(t, 'sm')}<span>${esc(t.name)}${q ? ` <span class="muted" style="font-weight:400">· ${esc(LEAGUES[t.lg])}</span>` : ''}</span></button>`).join('');
  };

  const stepArea = () => `
    <div><h2>Where do you live now?</h2><p class="muted" style="margin-top:6px">We only keep a rough area, a grid square about 25 miles across. Your exact location never leaves this device.</p></div>
    <div class="panel" style="display:grid;gap:14px">
      <button class="btn primary" id="locate">📍 Use my location</button>
      <div class="divider">or pick the nearest metro</div>
      <select class="input" id="metro"><option value="">Choose a metro…</option>${[...METROS].sort((a, b) => a.name.localeCompare(b.name)).map(m => `<option value="${esc(m.name)}">${esc(m.name)}, ${m.st}</option>`).join('')}</select>
    </div>
    <p id="areaOut" class="${draft.cell ? 'ok' : 'muted'}">${draft.cell ? `✓ Home base: <b>${esc(draft.area)}</b>` : 'No area set yet.'}</p>`;

  const stepName = () => `
    <div><h2>What should fans call you?</h2><p class="muted" style="margin-top:6px">First name and last initial works well. This is shown next to your teams and messages.</p></div>
    <label class="field">Display name<input class="input" id="dname" maxlength="40" value="${esc(draft.name)}" autocomplete="nickname"></label>
    <div class="panel"><div class="sub">Other fans will see</div>
      <div class="item" style="cursor:default;margin:6px -8px 0"><span class="avatar">${esc((draft.name || '?')[0].toUpperCase())}</span>
        <div class="main"><div class="t" id="pvName">${esc(draft.name)}</div><div class="s">${esc(draft.area)} · ${draft.teams.map(id => esc(TEAM_BY_ID[id]?.short)).join(', ')}</div></div></div>
    </div>`;

  function setArea(cell, label) {
    draft.cell = cell; draft.area = label;
    const out = $('#areaOut'); out.className = 'ok'; out.innerHTML = `✓ Home base: <b>${esc(label)}</b>`;
  }

  function wire() {
    const err = $('#obErr');
    $('#back')?.addEventListener('click', () => { step--; draw(); });
    $('#cancel')?.addEventListener('click', () => renderShell());
    $('#next').onclick = async () => {
      err.textContent = '';
      if (step === 1 && !draft.teams.length) { err.textContent = 'Pick at least one team.'; return; }
      if (step === 2 && !draft.cell) { err.textContent = 'Set your area to continue.'; return; }
      if (step < 3) { step++; draw(); return; }
      draft.name = $('#dname').value.trim();
      if (!draft.name) { err.textContent = 'Add a display name.'; return; }
      $('#next').disabled = true;
      try {
        await S.saveProfile(user.uid, draft);
        profile = { uid: user.uid, ...draft };
        cache = {};
        if (!profile.teams.includes(teamId)) teamId = profile.teams[0];
        renderShell();
        toast(editing ? 'Profile updated' : `Welcome, ${draft.name.split(' ')[0]}!`);
      } catch (e) { err.textContent = errMsg(e); $('#next').disabled = false; }
    };
    if (step === 1) {
      const qi = $('#q');
      qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; draw(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
      $$('[data-lg]').forEach(b => b.onclick = () => { league = b.dataset.lg; draw(); });
      $$('[data-team]').forEach(b => b.onclick = () => {
        const id = b.dataset.team, i = draft.teams.indexOf(id);
        if (i >= 0) draft.teams.splice(i, 1);
        else if (draft.teams.length >= SITE.maxTeams) { err.textContent = `That's the max of ${SITE.maxTeams}. Remove one first.`; return; }
        else draft.teams.push(id);
        const scroll = $('.team-grid').scrollTop; draw(); $('.team-grid').scrollTop = scroll;
      });
      $$('[data-rm]').forEach(b => b.onclick = () => { draft.teams = draft.teams.filter(x => x !== b.dataset.rm); draw(); });
    }
    if (step === 2) {
      $('#locate').onclick = () => {
        if (!navigator.geolocation) { err.textContent = 'Location is not available in this browser. Pick a metro instead.'; return; }
        $('#locate').disabled = true; $('#locate').textContent = 'Locating…';
        navigator.geolocation.getCurrentPosition(p => {
          // Round to a coarse cell immediately; the coordinates are discarded here.
          const cell = encode(p.coords.latitude, p.coords.longitude, SITE.homePrecision);
          setArea(cell, areaLabel(cell));
          $('#locate').disabled = false; $('#locate').textContent = '📍 Use my location';
        }, e => {
          err.textContent = e.code === 1 ? 'Location permission was denied. Pick a metro instead.' : 'Could not get your location. Pick a metro instead.';
          $('#locate').disabled = false; $('#locate').textContent = '📍 Use my location';
        }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 6e5 });
      };
      $('#metro').onchange = e => {
        const m = METROS.find(x => x.name === e.target.value);
        if (m) setArea(encode(m.lat, m.lng, SITE.homePrecision), `${m.name} area`);
      };
    }
    if (step === 3) $('#dname').oninput = e => { draft.name = e.target.value; $('#pvName').textContent = e.target.value; };
  }
  draw();
}

const shortName = n => {
  const p = String(n || '').trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : (p[0] || '');
};

/* ------------------------------------------------------------------ shell */
function renderShell() {
  cleanupView();
  const tabs = [['map', 'Map'], ['games', 'Games'], ['chat', 'Chat'], ...(isAdmin() ? [['review', 'Review']] : [])];
  const tabBtns = tabs.map(([k, n]) => `<button class="tab" data-view="${k}" aria-selected="${view === k}">${ICON[k]}<span>${n}</span></button>`).join('');
  root.innerHTML = `
    <div class="app">
      <header class="app-head"><div class="bar">
        ${BRAND}
        <nav class="tabs" aria-label="Sections">${tabBtns}</nav>
        <span class="spacer"></span>
        <button class="avatar" id="meBtn" aria-label="Your profile">${esc((profile.name || '?')[0].toUpperCase())}</button>
      </div>
      ${S.mode === 'demo' ? '<div class="demo-banner" id="demoBanner"><b>Demo mode</b> · sample fans and spots. What you add stays in this browser.</div>' : ''}
      </header>
      <div class="teambar" id="teambar" role="toolbar" aria-label="Your teams"></div>
      <main class="view" id="view"></main>
      <nav class="bottom-tabs" aria-label="Sections">${tabBtns}<button class="tab" id="meBtn2">${ICON.me}<span>You</span></button></nav>
    </div>`;
  const banner = $('#demoBanner');
  document.documentElement.style.setProperty('--banner', banner ? `${banner.offsetHeight}px` : '0px');
  $$('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; history.replaceState(null, '', `#${view}`); renderShell(); });
  $('#meBtn').onclick = $('#meBtn2').onclick = openProfile;
  drawTeambar();
  ({ map: viewMap, games: viewGames, chat: viewChat, review: viewReview })[view]();
}

function drawTeambar() {
  const bar = $('#teambar');
  bar.hidden = view === 'games' || view === 'review';
  bar.innerHTML = profile.teams.map(id => {
    const t = TEAM_BY_ID[id];
    return `<button class="chip" data-t="${id}" aria-pressed="${id === teamId}" style="--team:${esc(t?.color)}">${logo(t, 'sm')}${esc(t?.short || id)}</button>`;
  }).join('') + '<button class="chip add" id="editTeams">+ Teams</button>';
  $$('[data-t]', bar).forEach(b => b.onclick = () => {
    if (b.dataset.t === teamId) return;
    teamId = b.dataset.t; ls.set('df_team', teamId);
    $$('[data-t]', bar).forEach(x => x.setAttribute('aria-pressed', x.dataset.t === teamId));
    if (view === 'map') loadMap(); else if (view === 'chat') viewChat();
  });
  $('#editTeams').onclick = () => renderOnboarding(true);
}

async function teamData(id, fresh = false) {
  if (!fresh && cache[id]) return cache[id];
  const [fans, allSpots, checkins] = await Promise.all([S.fansFor(id), S.spotsFor(id), S.checkinsFor(id)]);
  const spots = allSpots.filter(s => !s.expiresAt || s.expiresAt > Date.now()); // scout listings expire unless re-confirmed
  return (cache[id] = { fans, spots, checkins });
}
const home = () => center(profile.cell);
const goingBySpot = checkins => checkins.reduce((m, c) => (m[c.spotId] = (m[c.spotId] || 0) + 1, m), {});

/* -------------------------------------------------------------------- map */
function viewMap() {
  $('#view').innerHTML = `
    <div class="view-map">
      <div style="position:relative"><div id="map" aria-label="Map of fans and watch spots"></div></div>
      <aside class="side" id="side"><div class="loading" style="min-height:200px">Loading fans…</div></aside>
    </div>`;
  map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([home().lat, home().lng], 8);
  // Standard OSM tiles (no key). Dark mode darkens them with a CSS filter on the tile pane.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  mapLayers = L.layerGroup().addTo(map);
  map.on('click', e => { if (adding) { const club = adding === 'club'; setAdding(false); openSpotDialog(e.latlng, club); } });
  loadMap();
}

async function loadMap(fresh = false) {
  const id = teamId, t = TEAM_BY_ID[id], side = $('#side');
  if (!map || !side) return;
  let d;
  try { d = await teamData(id, fresh); } catch (e) { side.innerHTML = `<div class="panel"><p class="err">${esc(errMsg(e))}</p></div>`; return; }
  if (id !== teamId || !map) return; // team switched while loading
  const me = home(), color = t?.color || '#ff7a1a';
  const going = goingBySpot(d.checkins);
  const myCheckin = d.checkins.find(c => c.uid === user.uid);

  // Fans grouped by coarse cell. Circles sit at the cell centre, never at a person.
  const cells = {};
  for (const f of d.fans) if (f.cell) (cells[f.cell] ||= []).push(f);
  const nearFans = d.fans.filter(f => f.cell && f.uid !== user.uid && km(me, center(f.cell)) <= NEAR_KM);
  const spots = d.spots.map(s => ({ ...s, dist: km(me, s), going: going[s.id] || 0 })).sort((a, b) => a.dist - b.dist);
  const nearSpots = spots.filter(s => s.dist <= NEAR_KM);

  mapLayers.clearLayers();
  const hb = bounds(profile.cell);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff7a1a';
  L.rectangle([[hb.s, hb.w], [hb.n, hb.e]], { color: accent, weight: 1.5, dashArray: '4 5', fillOpacity: .06, interactive: false }).addTo(mapLayers);
  for (const [cell, fans] of Object.entries(cells)) {
    const c = center(cell), n = fans.length;
    L.circleMarker([c.lat, c.lng], { radius: 6 + Math.sqrt(n) * 4, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: .72 })
      .bindPopup(`<h4>${n} ${esc(t?.short)} fan${n === 1 ? '' : 's'}</h4><p>${esc(areaLabel(cell))}</p>${fans.slice(0, 8).map(f => `<div>${esc(f.name)}</div>`).join('')}${n > 8 ? `<p style="margin-top:6px">and ${n - 8} more</p>` : ''}`)
      .addTo(mapLayers);
  }
  for (const s of spots) {
    const icon = L.divIcon({ className: '', html: `<div class="spot-pin" style="--team:${esc(color)}">${t?.logo ? `<img src="${esc(t.logo)}" alt="">` : ''}</div>`, iconSize: [38, 38], iconAnchor: [19, 38], popupAnchor: [0, -36] });
    L.marker([s.lat, s.lng], { icon, title: s.name }).bindPopup(() => spotPopup(s, myCheckin)).addTo(mapLayers);
  }
  L.marker([me.lat, me.lng], { icon: L.divIcon({ className: '', html: '<div class="me-pin"></div>', iconSize: [18, 18] }), interactive: false, zIndexOffset: 1000 }).addTo(mapLayers);

  // Top areas nationwide, by metro label.
  const areas = {};
  for (const [cell, fans] of Object.entries(cells)) { const a = areaLabel(cell); areas[a] = (areas[a] || 0) + fans.length; }
  const topAreas = Object.entries(areas).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const mySpot = myCheckin && spots.find(s => s.id === myCheckin.spotId);

  side.innerHTML = `
    <div class="panel">
      <div class="row">${logo(t, 'lg')}<div class="grow"><h3>${esc(t?.name)}</h3><div class="sub">${esc(profile.area)}</div></div></div>
      <div class="stat-row">
        <div class="stat"><div class="n">${nearFans.length}</div><div class="l">fans near you</div></div>
        <div class="stat"><div class="n">${nearSpots.length}</div><div class="l">watch spots</div></div>
        <div class="stat"><div class="n">${d.fans.length}</div><div class="l">fans total</div></div>
      </div>
      ${mySpot ? `<p class="ok" style="margin-top:12px">✓ You're going to <b>${esc(mySpot.name)}</b>${myCheckin.gameName ? ` for ${esc(myCheckin.gameName)}` : ''}. <button class="link-btn" id="unGo">Cancel</button></p>` : ''}
    </div>
    <div class="panel">
      <div class="row" style="justify-content:space-between"><h3>Watch spots nearby</h3><button class="btn sm primary" id="addSpot">+ Add</button></div>
      <div class="list">${nearSpots.length ? nearSpots.slice(0, 12).map(s => `
        <button class="item" data-spot="${esc(s.id)}"><span class="pinicon">📍</span>
          <span class="main"><span class="t" style="display:block">${esc(s.name)}</span><span class="s">${fmtKm(s.dist)}${s.eventAt ? ` · ${esc(s.eventTitle || 'Watch party')}, ${fmtWhen(s.eventAt)}` : s.note ? ` · ${esc(s.note)}` : ''}</span></span>
          ${s.going ? `<span class="badge">${s.going} going</span>` : s.source === 'scout' ? '<span class="badge plain">found online</span>' : ''}</button>`).join('')
        : `<p class="empty">No spots within ${Math.round(NEAR_KM * .621)} miles yet. Know a bar that shows ${esc(t?.short)} games? Add it and other fans will find it.</p>`}</div>
      <button class="link-btn" style="font-size:14px;margin-top:10px" id="clubLink">Run a fan club or alumni chapter?</button>
    </div>
    <div class="panel">
      <h3>Fans near you</h3>
      <div class="list">${nearFans.length ? nearFans.slice(0, 10).map(f => `
        <div class="item" style="cursor:default"><span class="avatar" style="width:32px;height:32px;font-size:13px">${esc((f.name || '?')[0])}</span>
          <span class="main"><span class="t" style="display:block">${esc(f.name)}</span><span class="s">${esc(areaLabel(f.cell))}${f.teams.length > 1 ? ` · also ${f.teams.filter(x => x !== id).slice(0, 2).map(x => esc(TEAM_BY_ID[x]?.short)).join(', ')}` : ''}</span></span></div>`).join('')
        + (nearFans.length > 10 ? `<p class="empty">and ${nearFans.length - 10} more</p>` : '')
        : `<p class="empty">You're the first ${esc(t?.short)} fan in your area. Share Distant Fan with the next one.</p>`}</div>
      <button class="btn sm block" style="margin-top:10px" id="toChat">Chat with ${esc(t?.short)} fans near you</button>
    </div>
    <div class="panel">
      <h3>Biggest fan bases</h3>
      <div class="list">${topAreas.map(([a, n]) => `<div class="item" style="cursor:default"><span class="main"><span class="t">${esc(a)}</span></span><span class="badge plain">${n}</span></div>`).join('') || '<p class="empty">No fans yet.</p>'}</div>
    </div>`;

  $('#addSpot').onclick = () => setAdding(true);
  $('#clubLink').onclick = openClubDialog;
  if (location.hash === '#club') { history.replaceState(null, '', '#map'); openClubDialog(); }
  $('#toChat').onclick = () => { view = 'chat'; room = 'local'; history.replaceState(null, '', '#chat'); renderShell(); };
  $('#unGo')?.addEventListener('click', async () => { await S.checkOut(id); toast('Check-in cancelled'); loadMap(true); });
  $$('[data-spot]', side).forEach(b => b.onclick = () => {
    const s = spots.find(x => x.id === b.dataset.spot);
    map.setView([s.lat, s.lng], 14);
    mapLayers.eachLayer(l => { if (l.options?.title === s.name) l.openPopup(); });
    if (matchMedia('(max-width: 860px)').matches) $('#map').scrollIntoView({ behavior: 'smooth' });
  });

  if (!nearFans.length && !nearSpots.length && d.fans.length) {
    const b = L.latLngBounds(Object.keys(cells).map(c => { const p = center(c); return [p.lat, p.lng]; }));
    b.extend([me.lat, me.lng]); map.fitBounds(b, { padding: [30, 30], maxZoom: 9 });
  }
}

const fmtWhen = ms => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const views = () => ['map', 'games', 'chat', ...(isAdmin() ? ['review'] : [])];

const fmtKm = k => { const mi = k * .621; return mi < 1 ? 'under a mile' : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`; };

function spotPopup(s, myCheckin) {
  const el = document.createElement('div');
  const mine = s.by === user.uid || isAdmin();
  const here = myCheckin?.spotId === s.id;
  el.innerHTML = `<h4>${esc(s.name)}</h4>
    ${s.eventAt ? `<p><b>${esc(s.eventTitle || 'Watch party')}</b><br>${fmtWhen(s.eventAt)}</p>` : ''}
    ${s.club ? `<p>Home of <b>${esc(s.club)}</b></p>` : ''}
    <p>${s.address ? `${esc(s.address)}<br>` : ''}${s.note ? esc(s.note) : ''}</p>
    <p><b>${s.going}</b> going to the next game${s.source === 'scout' ? '' : s.byName ? ` · added by ${esc(s.byName)}` : ''}</p>
    ${s.source === 'scout' ? `<p style="font-size:12px">Found online${s.sourceUrl ? ` via <a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(s.sourceName || 'source')}</a>` : ''} · checked ${new Date(s.checkedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}. Worth confirming before you go.</p>` : ''}
    <div class="row">
      <button class="btn sm ${here ? '' : 'primary'}" data-go>${here ? 'Going ✓' : "I'm going"}</button>
      <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}">Directions</a>
      ${mine ? '<button class="btn sm ghost" data-rm>Remove</button>' : ''}
    </div>
    <button class="link-btn" style="font-size:12px;margin-top:10px" data-report>${s.source === 'scout' ? 'Still accurate? Tell us if not' : 'Something wrong with this spot?'}</button>`;
  el.querySelector('[data-go]').onclick = () => here ? S.checkOut(teamId).then(() => { toast('Check-in cancelled'); loadMap(true); }) : goTo(s);
  el.querySelector('[data-report]').onclick = () => openReportDialog(s);
  el.querySelector('[data-rm]')?.addEventListener('click', async () => {
    if (!confirm(`Remove ${s.name} from the map?`)) return;
    await S.removeSpot(s.id); toast('Spot removed'); loadMap(true);
  });
  return el;
}

async function goTo(spot, game, tid = teamId) {
  try {
    if (!game) game = (await nextGames(tid, 1).catch(() => []))[0];
    const until = game ? game.time + 5 * 3.6e6 : Date.now() + 24 * 3.6e6;
    await S.checkIn({ teamId: tid, spotId: spot.id, name: profile.name, gameId: game?.id || '', gameName: game ? `${game.home ? 'vs' : 'at'} ${game.opp.short}` : '', gameDate: game?.time || Date.now(), expiresAt: until });
    toast(`You're going to ${spot.name}`);
    delete cache[tid];
    if (view === 'map') loadMap(true); else viewGames();
  } catch (e) { toast(errMsg(e)); }
}

function setAdding(on) {
  adding = on; // true, false, or 'club'
  $('.view-map')?.classList.toggle('adding', on);
  $('.map-hint')?.remove();
  if (on) {
    const h = document.createElement('div');
    h.className = 'map-hint'; h.innerHTML = `Tap the map where ${on === 'club' ? 'your club meets' : 'the spot is'} · <button class="link-btn" style="color:inherit;text-decoration:underline">Cancel</button>`;
    h.querySelector('button').onclick = () => setAdding(false);
    $('#map').parentElement.append(h);
    if (matchMedia('(max-width: 860px)').matches) $('#map').scrollIntoView({ behavior: 'smooth' });
  }
}

function openSpotDialog(latlng, forClub = false) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<h3>Add a watch spot</h3>
    <form method="dialog" id="spotForm">
      <label class="field">Name<input class="input" name="name" required maxlength="80" placeholder="The Brass Tap"></label>
      <label class="field">Address <span class="hint">optional</span><input class="input" name="address" maxlength="120" placeholder="123 Main St"></label>
      <label class="field">Fan club or chapter <span class="hint">${forClub ? 'the club that meets here' : 'optional'}</span><input class="input" name="club" maxlength="80" placeholder="Bills Backers of Phoenix" ${forClub ? 'required' : ''}></label>
      <label class="field">Why go here? <span class="hint">optional</span><input class="input" name="note" maxlength="200" placeholder="Official backers bar, sound on, gets packed"></label>
      <div class="field">Shows games for
        <div class="picked">${profile.teams.map(id => `<label class="chip"><input type="checkbox" name="teams" value="${id}" ${id === teamId ? 'checked' : ''}>${logo(TEAM_BY_ID[id], 'sm')}${esc(TEAM_BY_ID[id]?.short)}</label>`).join('')}</div>
      </div>
      <p class="muted" style="font-size:13px">Public places only, please. Never add someone's home.</p>
      <p class="err" id="spotErr"></p>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="save">Add spot</button></div>
    </form>`;
  document.body.append(dlg); dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('form').onsubmit = async e => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const f = new FormData(e.target), teams = f.getAll('teams');
    if (!teams.length) { $('#spotErr', dlg).textContent = 'Pick at least one team.'; return; }
    try {
      await S.addSpot({ name: f.get('name'), address: f.get('address'), club: f.get('club'), note: f.get('note'), lat: latlng.lat, lng: latlng.lng, teams, byName: profile.name });
      dlg.close(); toast('Spot added. Thanks!');
      teams.forEach(t => delete cache[t]); loadMap(true);
    } catch (x) { $('#spotErr', dlg).textContent = errMsg(x); }
  };
}

function openReportDialog(s) {
  const reasons = s.eventAt
    ? ['Event cancelled or moved', 'Wrong place or time', 'Something else']
    : ['Closed, or no longer shows the games', 'Wrong location or address', 'Wrong team', 'Something else'];
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<h3>What's wrong?</h3>
    <form method="dialog">
      <p class="muted" style="margin-top:-6px">${esc(s.name)}</p>
      <div style="display:grid;gap:8px">${reasons.map((r, i) => `<label class="row" style="gap:10px;font-weight:500"><input type="radio" name="reason" value="${esc(r)}" ${i ? '' : 'checked'}>${esc(r)}</label>`).join('')}</div>
      <label class="field">Details <span class="hint">optional</span><textarea class="input" name="note" maxlength="300" rows="3" placeholder="e.g. They moved to the bar down the street"></textarea></label>
      <p class="err" id="repErr"></p>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="send">Send</button></div>
    </form>`;
  document.body.append(dlg); dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('form').onsubmit = async e => {
    if (e.submitter?.value !== 'send') return;
    e.preventDefault();
    const f = new FormData(e.target);
    try { await S.reportSpot({ spotId: s.id, spotName: s.name, name: profile.name, reason: f.get('reason'), note: f.get('note') }); dlg.close(); toast("Thanks, we'll check it"); }
    catch (x) { $('#repErr', dlg).textContent = errMsg(x); }
  };
}

function openClubDialog() {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<h3>Run a fan club?</h3>
    <div style="display:grid;gap:14px">
      <p>Backers clubs and alumni chapters are the heart of game day for fans far from home. Put your bar on the map so the fans around ${esc(profile.area.replace(/ area$/, ''))} can find you.</p>
      <p class="muted" style="font-size:14px">Already listed but something's out of date? Open the listing on the map and tap <b>Still accurate?</b> to tell us what changed.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-x>Not now</button><button class="btn primary" data-add>Add my club's bar</button></div>
    </div>`;
  document.body.append(dlg); dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('[data-x]').onclick = () => dlg.close();
  dlg.querySelector('[data-add]').onclick = () => { dlg.close(); setAdding('club'); };
}

/* ------------------------------------------------------------------ games */
async function viewGames() {
  const v = $('#view');
  v.innerHTML = `<div class="page"><h2>Your games</h2><div id="games"><div class="loading" style="min-height:200px">Loading schedules…</div></div></div>`;
  const results = await Promise.all(profile.teams.map(async id => {
    try { return (await nextGames(id, 4)).map(g => ({ ...g, teamId: id })); } catch { return []; }
  }));
  const data = Object.fromEntries(await Promise.all(profile.teams.map(async id => [id, await teamData(id).catch(() => null)])));
  if (view !== 'games') return;
  const games = results.flat().sort((a, b) => a.time - b.time).slice(0, 16);
  const me = home();
  $('#games').innerHTML = games.length ? games.map(g => {
    const t = TEAM_BY_ID[g.teamId], d = data[g.teamId];
    const going = d ? goingBySpot(d.checkins) : {};
    const near = d ? d.spots.map(s => ({ ...s, dist: km(me, s), going: going[s.id] || 0 })).filter(s => s.dist <= NEAR_KM).sort((a, b) => b.going - a.going || a.dist - b.dist) : [];
    const mine = d?.checkins.find(c => c.uid === user.uid && (!c.gameId || c.gameId === g.id));
    const mySpot = mine && d.spots.find(s => s.id === mine.spotId);
    const dt = new Date(g.time);
    return `<div class="panel game">
      <div class="when"><div class="d">${dt.toLocaleDateString(undefined, { weekday: 'short' })}</div><div class="n">${dt.getDate()}</div><div class="m">${dt.toLocaleDateString(undefined, { month: 'short' })}</div></div>
      <div>
        <div class="vs">${logo(t, 'sm')}${esc(t.short)} <span class="muted" style="font-weight:500">${g.neutral ? 'vs' : g.home ? 'vs' : 'at'}</span> ${g.opp.logo ? `<img class="logo sm" src="${esc(g.opp.logo)}" alt="">` : ''}${esc(g.opp.short)}</div>
        <div class="meta">${g.tbd ? 'Time TBA' : dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}${g.city ? ` · ${esc(g.city)}` : ''}</div>
        ${g.tv.length ? `<div class="tv">${g.tv.map(x => `<span class="badge plain">${esc(x)}</span>`).join('')}</div>` : ''}
      </div>
      <span></span>
      <div class="watch">
        ${mySpot ? `<span class="s">✓ You're going to <b>${esc(mySpot.name)}</b></span><button class="btn sm" data-out="${g.teamId}">Cancel</button>`
        : near.length ? `<span class="s">Watch near you: <b>${esc(near[0].name)}</b>${near[0].going ? ` · ${near[0].going} going` : ''}${near.length > 1 ? ` · ${near.length - 1} more spot${near.length > 2 ? 's' : ''}` : ''}</span><button class="btn sm primary" data-go="${g.teamId}|${g.id}">I'm going</button>`
        : `<span class="s">No ${esc(t.short)} spots near you yet.</span><button class="btn sm" data-add="${g.teamId}">Add one</button>`}
      </div>
    </div>`;
  }).join('') : '<div class="panel"><p class="empty">No upcoming games found for your teams. Off-season, or the schedule isn\'t out yet.</p></div>';

  $$('[data-out]').forEach(b => b.onclick = async () => { await S.checkOut(b.dataset.out); delete cache[b.dataset.out]; toast('Check-in cancelled'); viewGames(); });
  $$('[data-add]').forEach(b => b.onclick = () => { teamId = b.dataset.add; ls.set('df_team', teamId); view = 'map'; history.replaceState(null, '', '#map'); renderShell(); setTimeout(() => setAdding(true), 300); });
  $$('[data-go]').forEach(b => b.onclick = () => {
    const [tid, gid] = b.dataset.go.split('|');
    const g = games.find(x => x.teamId === tid && x.id === gid), d = data[tid], going = goingBySpot(d.checkins);
    const near = d.spots.map(s => ({ ...s, dist: km(me, s), going: going[s.id] || 0 })).filter(s => s.dist <= NEAR_KM).sort((a, b) => b.going - a.going || a.dist - b.dist);
    pickSpot(near, s => goTo(s, g, tid));
  });
}

function pickSpot(spots, done) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<h3>Where are you watching?</h3>
    <div class="list" style="margin:0 -8px 10px">${spots.slice(0, 10).map(s => `<button class="item" data-id="${esc(s.id)}"><span class="pinicon">📍</span><span class="main"><span class="t" style="display:block">${esc(s.name)}</span><span class="s">${fmtKm(s.dist)}</span></span>${s.going ? `<span class="badge">${s.going} going</span>` : ''}</button>`).join('')}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-x>Cancel</button></div>`;
  document.body.append(dlg); dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('[data-x]').onclick = () => dlg.close();
  $$('[data-id]', dlg).forEach(b => b.onclick = () => { dlg.close(); done(spots.find(s => s.id === b.dataset.id)); });
}

/* ------------------------------------------------------------------- chat */
function viewChat() {
  unsubRoom?.();
  const t = TEAM_BY_ID[teamId];
  const localId = S.roomOf(teamId, profile.cell), natId = S.roomOf(teamId);
  const rid = room === 'local' ? localId : natId;
  $('#view').innerHTML = `
    <div class="chat">
      <div class="rooms">
        ${logo(t, 'sm')}
        <button class="tab" data-room="local" aria-selected="${room === 'local'}">${esc(profile.area.replace(/ area$/, ''))} ${esc(t?.short)} fans</button>
        <button class="tab" data-room="nat" aria-selected="${room === 'nat'}">All ${esc(t?.short)} fans</button>
      </div>
      <div class="log" id="log" aria-live="polite"><div class="loading" style="min-height:120px">Loading messages…</div></div>
      <form id="msgForm"><input class="input" name="text" placeholder="Message ${room === 'local' ? 'fans near you' : `all ${esc(t?.short)} fans`}…" maxlength="500" autocomplete="off" required><button class="btn primary">Send</button></form>
    </div>`;
  $$('[data-room]').forEach(b => b.onclick = () => { room = b.dataset.room; viewChat(); });
  const log = $('#log');
  unsubRoom = S.subscribeRoom(rid, (msgs, err) => {
    if (err) { log.innerHTML = `<p class="err">${esc(errMsg(err))}</p>`; return; }
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.innerHTML = msgs.length ? msgs.map(m => `
      <div class="msg ${m.uid === user.uid ? 'mine' : ''}">
        <div class="who">${esc(m.name)} · ${timeAgo(m.at)}${m.uid === user.uid ? ` <button class="del" data-del="${esc(m.id)}" aria-label="Delete message">delete</button>` : ''}</div>
        <div class="txt">${esc(m.text)}</div>
      </div>`).join('')
      : `<p class="empty" style="text-align:center;margin:auto">No messages yet. Say hi to ${room === 'local' ? `the ${esc(t?.short)} fans around you` : `${esc(t?.short)} fans everywhere`}.</p>`;
    if (atBottom || log.dataset.first !== '1') { log.scrollTop = log.scrollHeight; log.dataset.first = '1'; }
    $$('[data-del]', log).forEach(b => b.onclick = () => S.deleteMessage(rid, b.dataset.del));
  });
  $('#msgForm input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#msgForm').requestSubmit(); }
  });
  $('#msgForm').onsubmit = async e => {
    e.preventDefault();
    const inp = e.target.text, text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    try { await S.sendMessage(rid, text, profile.name); } catch (x) { inp.value = text; toast(errMsg(x)); }
  };
}

function timeAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ----------------------------------------------------------------- review */
async function viewReview() {
  const v = $('#view');
  v.innerHTML = `<div class="page"><h2>Review</h2><div id="reports" style="display:grid;gap:14px"></div><h3 style="font-size:26px;margin-top:10px">Scout finds</h3><p class="muted">Finds the weekly scout wasn't sure enough about to publish on its own. Approve puts them on the map; reject stops the scout suggesting them again.</p><div id="queue" style="display:grid;gap:14px"><div class="loading" style="min-height:160px">Loading…</div></div></div>`;
  let items, reports;
  try { [items, reports] = await Promise.all([S.listQueue(), S.listReports()]); } catch (e) { $('#queue').innerHTML = `<div class="panel"><p class="err">${esc(errMsg(e))}</p></div>`; return; }
  if (view !== 'review') return;
  drawReports(reports);
  items.sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0));
  const q = $('#queue');
  if (!items.length) { q.innerHTML = '<div class="panel"><p class="empty">Nothing waiting. The scout runs Tuesday mornings.</p></div>'; return; }
  q.innerHTML = items.map(it => `
    <div class="panel" data-q="${esc(it.id)}" style="display:grid;gap:8px">
      <div class="row">${it.teams.map(id => logo(TEAM_BY_ID[id], 'sm')).join('')}<b class="grow">${esc(it.name)}</b><span class="badge plain">${esc(it.confidence || 'medium')}</span></div>
      <div class="muted" style="font-size:14px">${it.teams.map(id => esc(TEAM_BY_ID[id]?.name || id)).join(', ')}${it.club ? ` · ${esc(it.club)}` : ''}</div>
      ${it.eventAt ? `<div><b>${esc(it.eventTitle || 'Watch party')}</b> · ${fmtWhen(it.eventAt)}</div>` : ''}
      <div style="font-size:14px">${esc(it.address)}${it.note ? `<br>${esc(it.note)}` : ''}</div>
      <div class="muted" style="font-size:13px">Why: ${esc(it.evidence || '—')}<br>Source: <a href="${esc(it.sourceUrl)}" target="_blank" rel="noopener">${esc(it.sourceName || it.sourceUrl)}</a> · <a href="https://www.google.com/maps/search/?api=1&query=${it.lat},${it.lng}" target="_blank" rel="noopener">map</a></div>
      <div class="row"><button class="btn sm primary" data-ok>Approve</button><button class="btn sm ghost" data-no>Reject</button></div>
    </div>`).join('');
  $$('[data-q]', q).forEach(card => {
    const it = items.find(x => x.id === card.dataset.q);
    const act = async (fn, msg) => {
      $$('button', card).forEach(b => b.disabled = true);
      try { await fn(it); it.teams.forEach(t => delete cache[t]); card.remove(); toast(msg); if (!$('[data-q]', q)) viewReview(); }
      catch (e) { toast(errMsg(e)); $$('button', card).forEach(b => b.disabled = false); }
    };
    $('[data-ok]', card).onclick = () => act(S.approveQueued, `${it.name} is on the map`);
    $('[data-no]', card).onclick = () => act(S.rejectQueued, 'Rejected');
  });
}

function drawReports(reports) {
  const box = $('#reports');
  if (!box) return;
  if (!reports.length) { box.innerHTML = ''; return; }
  reports.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  box.innerHTML = `<h3 style="font-size:26px">Reports from fans (${reports.length})</h3>` + reports.map(r => `
    <div class="panel" data-r="${esc(r.id)}" style="display:grid;gap:6px">
      <div class="row"><b class="grow">${esc(r.spotName || r.spotId)}</b><span class="badge">${esc(r.reason)}</span></div>
      ${r.note ? `<div style="font-size:14px">“${esc(r.note)}”</div>` : ''}
      <div class="muted" style="font-size:13px">From ${esc(r.name)}${r.createdAt?.toMillis ? ` · ${timeAgo(r.createdAt.toMillis())}` : ''}</div>
      <div class="row"><button class="btn sm primary" data-rm>Remove listing</button><button class="btn sm ghost" data-ok>Dismiss</button></div>
    </div>`).join('');
  $$('[data-r]', box).forEach(card => {
    const r = reports.find(x => x.id === card.dataset.r);
    const act = async (fn, msg) => {
      $$('button', card).forEach(b => b.disabled = true);
      try { await fn(r); cache = {}; toast(msg); viewReview(); }
      catch (e) { toast(errMsg(e)); $$('button', card).forEach(b => b.disabled = false); }
    };
    $('[data-rm]', card).onclick = () => confirm(`Remove ${r.spotName} from the map?`) && act(S.removeReportedSpot, 'Listing removed');
    $('[data-ok]', card).onclick = () => act(x => S.dismissReport(x.id), 'Dismissed');
  });
}

/* ---------------------------------------------------------------- profile */
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

function openProfile() {
  const theme = ls.get('df_theme') || 'auto';
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<h3>${esc(profile.name)}</h3>
    <div style="display:grid;gap:14px">
      <div class="sub muted">${esc(profile.area)}${user.email ? ` · ${esc(user.email)}` : ''}</div>
      <div class="picked">${profile.teams.map(id => `<span class="chip" style="cursor:default">${logo(TEAM_BY_ID[id], 'sm')}${esc(TEAM_BY_ID[id]?.short)}</span>`).join('')}</div>
      <button class="btn" data-a="edit">Edit teams, area and name</button>
      <label class="field">Theme<select class="input" id="theme">${['auto', 'light', 'dark'].map(x => `<option value="${x}" ${x === theme ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></label>
      <div class="row"><button class="btn grow" data-a="out">Sign out</button><button class="btn ghost" data-a="close">Close</button></div>
      <button class="link-btn" style="color:var(--bad);justify-self:start;font-size:14px" data-a="del">Delete my profile</button>
    </div>`;
  document.body.append(dlg); dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('#theme').onchange = e => {
    const v = e.target.value;
    ls.set('df_theme', v === 'auto' ? '' : v);
    if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
    if (view === 'map') { dlg.close(); renderShell(); }
  };
  dlg.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') dlg.close();
    if (a === 'edit') { dlg.close(); renderOnboarding(true); }
    if (a === 'out') { dlg.close(); S.signOut(); }
    if (a === 'del') {
      if (!confirm('Delete your profile? You will be removed from the fan map right away.')) return;
      dlg.close();
      try { await S.deleteProfile(user.uid); profile = null; toast('Profile deleted'); if (S.mode === 'firebase') S.signOut(); }
      catch (x) { toast(errMsg(x)); }
    }
  });
}

window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (profile && views().includes(h) && h !== view) { view = h; renderShell(); }
});
