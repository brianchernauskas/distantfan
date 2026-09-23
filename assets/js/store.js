// Data layer. Uses Firebase (Auth + Firestore) when FIREBASE_CONFIG is set,
// otherwise a demo store in localStorage seeded with clearly fake fans and spots.
import { FIREBASE_CONFIG, SITE } from './config.js?v=202609231100';
import { TEAMS, TEAM_BY_ID } from './teams.js?v=202609231100';
import { METROS } from './metros.js?v=202609231100';
import { encode, center } from './geo.js?v=202609231100';

export const mode = FIREBASE_CONFIG ? 'firebase' : 'demo';
let impl;

export async function init() {
  impl = mode === 'firebase' ? await firebaseStore() : demoStore();
  return impl;
}
const call = name => (...a) => impl[name](...a);
export const onUser = call('onUser');
export const signInGoogle = call('signInGoogle');
export const signInEmail = call('signInEmail');
export const signUpEmail = call('signUpEmail');
export const resetPassword = call('resetPassword');
export const signInDemo = call('signInDemo');
export const signOut = call('signOut');
export const getProfile = call('getProfile');
export const saveProfile = call('saveProfile');
export const deleteProfile = call('deleteProfile');
export const fanCellsFor = call('fanCellsFor');
export const spotsFor = call('spotsFor');
export const spotsSample = call('spotsSample');
export const spotsNear = call('spotsNear');
export const checkinsActive = call('checkinsActive');
export const addSpot = call('addSpot');
export const removeSpot = call('removeSpot');
export const checkinsFor = call('checkinsFor');
export const checkIn = call('checkIn');
export const checkOut = call('checkOut');
export const subscribeRoom = call('subscribeRoom');
export const sendMessage = call('sendMessage');
export const deleteMessage = call('deleteMessage');
export const listQueue = call('listQueue');
export const approveQueued = call('approveQueued');
export const rejectQueued = call('rejectQueued');
export const reportSpot = call('reportSpot');
export const listReports = call('listReports');
export const removeReportedSpot = call('removeReportedSpot');
export const dismissReport = call('dismissReport');
export const listVenueLeads = call('listVenueLeads');
export const listProfiles = call('listProfiles');
export const listSpots = call('listSpots');
export const dismissVenueLead = call('dismissVenueLead');

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const active = c => (c.expiresAt || 0) > Date.now();

/* ---------------------------------------------------------------- Firebase */

async function firebaseStore() {
  const V = '12.19.0', base = `https://www.gstatic.com/firebasejs/${V}`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  let me = null;

  const toUser = u => u && { uid: u.uid, email: u.email, name: u.displayName || (u.email || '').split('@')[0] };
  const list = async q => (await F.getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() }));

  // Watch spots come from data/spots.json (served free by GitHub Pages) plus a small Firestore delta
  // for spots created since that snapshot, so page views don't each read the whole collection.
  // tools/scout/export-spots.mjs regenerates the file. If it can't be loaded we fall back to queries.
  let spotBase = null, spotCursor = 0, spotDeltaAt = 0, spotsDirty = false;
  const spotMap = new Map();
  const spotsReady = (async () => {
    try {
      const r = await fetch('data/spots.json', { cache: 'no-cache' });
      if (!r.ok) return false;
      spotBase = await r.json();
      spotBase.spots.forEach(s => spotMap.set(s.id, s));
      spotCursor = spotBase.generatedAt || 0;
      return true;
    } catch { return false; }
  })();
  // Returns live spots from the snapshot + delta, or null when there is no snapshot.
  async function spotsCached() {
    if (!(await spotsReady)) return null;
    if (spotsDirty || Date.now() - spotDeltaAt > 60_000) {
      spotsDirty = false; spotDeltaAt = Date.now();
      try {
        const fresh = await list(F.query(F.collection(db, 'spots'), F.where('createdAt', '>=', F.Timestamp.fromMillis(spotCursor)), F.limit(500)));
        for (const s of fresh) {
          const at = s.createdAt?.toMillis?.() || 0;
          spotMap.set(s.id, { ...s, createdAt: at });
          if (at > spotCursor) spotCursor = at;
        }
      } catch (e) { spotDeltaAt = 0; console.warn('spot delta failed', e); }
    }
    const now = Date.now();
    return [...spotMap.values()].filter(s => !s.expiresAt || s.expiresAt > now);
  }
  const spotsGone = id => spotMap.delete(id);

  // Fan counts per home cell come from data/fans.json (counts only, exported by the same script).
  // No per-person delta is possible for counts, so they trail by up to one export; the app adds the
  // signed-in fan themselves. Falls back to counting a Firestore query if the file is missing.
  let fansSnap;
  const fansReady = fetch('data/fans.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  async function fanCellsFor(teamId) {
    fansSnap ??= await fansReady;
    if (fansSnap) return { cells: { ...(fansSnap.teams[teamId] || {}) }, generatedAt: fansSnap.generatedAt };
    const cells = {};
    for (const p of await list(F.query(F.collection(db, 'profiles'), F.where('teams', 'array-contains', teamId), F.limit(2000)))) if (p.cell) cells[p.cell] = (cells[p.cell] || 0) + 1;
    return { cells, generatedAt: Date.now() };
  }

  return {
    onUser: cb => A.onAuthStateChanged(auth, u => { me = toUser(u); cb(me); }),
    signInGoogle: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
    signInEmail: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    async signUpEmail(email, pw, name) {
      const cred = await A.createUserWithEmailAndPassword(auth, email, pw);
      if (name) await A.updateProfile(cred.user, { displayName: clean(name, 40) });
      me = toUser(auth.currentUser);
    },
    resetPassword: email => A.sendPasswordResetEmail(auth, email),
    signInDemo: () => { throw new Error('Demo sign-in is only available in demo mode.'); },
    signOut: () => A.signOut(auth),

    async getProfile(uid) {
      const s = await F.getDoc(F.doc(db, 'profiles', uid));
      return s.exists() ? { uid, ...s.data() } : null;
    },
    saveProfile: (uid, p) => F.setDoc(F.doc(db, 'profiles', uid), {
      name: clean(p.name, 40), teams: p.teams.slice(0, SITE.maxTeams),
      cell: p.cell.slice(0, SITE.homePrecision), area: clean(p.area, 60),
      updatedAt: F.serverTimestamp(),
    }),
    async deleteProfile(uid) {
      await F.deleteDoc(F.doc(db, 'profiles', uid));
      await auth.currentUser?.delete().catch(() => {}); // needs a recent sign-in; profile is gone either way
    },

    fanCellsFor,
    spotsFor: async teamId => (await spotsCached())?.filter(s => s.teams?.includes(teamId))
      ?? list(F.query(F.collection(db, 'spots'), F.where('teams', 'array-contains', teamId), F.limit(500))),
    // Unfiltered sample, so a team with nothing nearby yet can still show fans other teams' spots
    // nearby - proof the map is alive, not a team-scoped read. Small dataset, so no server-side
    // geo query yet; the caller filters by distance client-side like everywhere else here.
    spotsSample: async () => (await spotsCached()) ?? list(F.query(F.collection(db, 'spots'), F.limit(400))),
    // Spots in a latitude band around a point, plus only the check-ins that haven't expired, for the
    // all-teams city view. Reads scale with that band, not the whole collection; the caller trims to
    // an exact radius. (A single range field needs no composite index.)
    spotsNear: async (lat, radiusKm) => { const d = radiusKm / 111; return (await spotsCached())?.filter(s => s.lat >= lat - d && s.lat <= lat + d) ?? list(F.query(F.collection(db, 'spots'), F.where('lat', '>=', lat - d), F.where('lat', '<=', lat + d), F.limit(2000))); },
    checkinsActive: () => list(F.query(F.collection(db, 'checkins'), F.where('expiresAt', '>', Date.now()), F.limit(2000))),
    addSpot: async s => { const r = await F.addDoc(F.collection(db, 'spots'), {
      name: clean(s.name, 80), address: clean(s.address, 120), club: clean(s.club, 80), note: clean(s.note, 200),
      lat: +s.lat, lng: +s.lng, teams: s.teams.slice(0, 6),
      by: me.uid, byName: clean(s.byName, 40), createdAt: F.serverTimestamp(),
    }); spotsDirty = true; return r; },
    removeSpot: async id => { await F.deleteDoc(F.doc(db, 'spots', id)); spotsGone(id); },

    checkinsFor: teamId => list(F.query(F.collection(db, 'checkins'), F.where('teamId', '==', teamId), F.limit(1000)))
      .then(r => r.filter(active)),
    checkIn: c => F.setDoc(F.doc(db, 'checkins', `${me.uid}_${c.teamId}`), {
      uid: me.uid, name: clean(c.name, 40), teamId: c.teamId, spotId: c.spotId,
      gameId: String(c.gameId || ''), gameName: clean(c.gameName, 80),
      gameDate: c.gameDate, expiresAt: c.expiresAt, createdAt: F.serverTimestamp(),
    }),
    checkOut: teamId => F.deleteDoc(F.doc(db, 'checkins', `${me.uid}_${teamId}`)),

    subscribeRoom(roomId, cb) {
      const q = F.query(F.collection(db, 'rooms', roomId, 'messages'), F.orderBy('createdAt', 'desc'), F.limit(100));
      return F.onSnapshot(q, snap => cb(snap.docs.map(d => {
        const m = d.data();
        return { id: d.id, ...m, at: m.createdAt?.toMillis?.() || Date.now() };
      }).reverse()), err => cb([], err));
    },
    sendMessage: (roomId, text, name) => F.addDoc(F.collection(db, 'rooms', roomId, 'messages'), {
      uid: me.uid, name: clean(name, 40), text: clean(text, 500), createdAt: F.serverTimestamp(),
    }),
    deleteMessage: (roomId, id) => F.deleteDoc(F.doc(db, 'rooms', roomId, 'messages', id)),

    // Scout review queue (admin only; enforced by firestore.rules).
    listQueue: () => list(F.query(F.collection(db, 'scoutQueue'), F.limit(200))),
    async approveQueued(q) {
      const { id, confidence, evidence, queuedAt, ...spot } = q;
      const b = F.writeBatch(db);
      b.set(F.doc(db, 'spots', `scout_${id}`), { ...spot, approvedBy: me.uid, createdAt: F.serverTimestamp() });
      b.delete(F.doc(db, 'scoutQueue', id));
      await b.commit();
      spotsDirty = true;
    },
    async rejectQueued(q) {
      const b = F.writeBatch(db);
      b.set(F.doc(db, 'scoutRejects', q.id), { name: q.name, address: q.address || '', teams: q.teams, rejectedAt: F.serverTimestamp() });
      b.delete(F.doc(db, 'scoutQueue', q.id));
      await b.commit();
    },

    // Fan reports on a listing. One per fan per spot; only the admin can read them.
    reportSpot: r => F.setDoc(F.doc(db, 'spotReports', `${r.spotId}_${me.uid}`), {
      spotId: r.spotId, spotName: clean(r.spotName, 80), uid: me.uid, name: clean(r.name, 40),
      reason: clean(r.reason, 40), note: clean(r.note, 300), createdAt: F.serverTimestamp(),
    }),
    // Admin Users tab. Profiles are already readable by any signed-in fan, so no rules change is needed.
    listProfiles: () => list(F.query(F.collection(db, 'profiles'), F.limit(5000)))
      .then(r => r.map(({ id, updatedAt, ...p }) => ({ uid: id, ...p, updatedAt: updatedAt?.toMillis?.() || 0 }))),
    // Every watch spot (readable by any signed-in fan), for the admin Users tab's nationwide counts.
    listSpots: async () => (await spotsCached()) ?? list(F.query(F.collection(db, 'spots'), F.limit(10000))),
    listReports: () => list(F.query(F.collection(db, 'spotReports'), F.limit(200))),
    async removeReportedSpot(r) {
      const all = await list(F.query(F.collection(db, 'spotReports'), F.where('spotId', '==', r.spotId)));
      const b = F.writeBatch(db);
      all.forEach(x => b.delete(F.doc(db, 'spotReports', x.id)));
      b.delete(F.doc(db, 'spots', r.spotId));
      // Stop the scout re-adding a listing a fan says is wrong.
      if (r.spotId.startsWith('scout_')) b.set(F.doc(db, 'scoutRejects', r.spotId.slice(6)), { name: r.spotName || '', reason: r.reason, rejectedAt: F.serverTimestamp() });
      await b.commit();
      spotsGone(r.spotId);
    },
    dismissReport: id => F.deleteDoc(F.doc(db, 'spotReports', id)),

    // Bar-owner leads from the public landing page (no account; written via the Firestore
    // REST API directly from index.html). Admin only, enforced by firestore.rules.
    listVenueLeads: () => list(F.query(F.collection(db, 'venueLeads'), F.limit(200))),
    dismissVenueLead: id => F.deleteDoc(F.doc(db, 'venueLeads', id)),
  };
}

/* -------------------------------------------------------------------- Demo */

const KEY = 'df_demo_v1';
function demoStore() {
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { state = {}; }
  state = { user: null, profiles: {}, spots: [], checkins: [], rooms: {}, seeded: {}, ...state };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
  const userCbs = new Set(), roomCbs = new Map();
  const emitUser = () => userCbs.forEach(cb => cb(state.user));
  const emitRoom = id => (roomCbs.get(id) || new Set()).forEach(cb => cb(state.rooms[id] || []));

  function seedTeam(teamId) {
    if (state.seeded[teamId]) return;
    state.seeded[teamId] = true;
    const team = TEAM_BY_ID[teamId];
    const rnd = rng(hash(teamId));
    const mine = state.user && state.profiles[state.user.uid];
    const homeMetro = nearestByName(team?.loc);
    // Fans cluster heavily at home, then spread out across the country.
    for (let i = 0; i < 180; i++) {
      const m = (homeMetro && rnd() < 0.3) ? homeMetro : METROS[Math.floor(rnd() ** 1.6 * METROS.length)];
      const jitter = () => (rnd() - 0.5) * 0.6;
      const cell = encode(m.lat + jitter(), m.lng + jitter(), SITE.homePrecision);
      const others = pick(rnd, TEAMS, 1 + Math.floor(rnd() * 2)).map(t => t.id);
      state.profiles[`demo-${teamId}-${i}`] = { name: fakeName(rnd), teams: [teamId, ...others], cell, area: `${m.name} area`, demo: true };
    }
    // A handful of fans right around the signed-in user so "near you" is never empty.
    if (mine?.cell) {
      const c = center(mine.cell);
      for (let i = 0; i < 6 + Math.floor(rnd() * 8); i++) {
        const cell = encode(c.lat + (rnd() - 0.5) * 0.9, c.lng + (rnd() - 0.5) * 0.9, SITE.homePrecision);
        state.profiles[`demo-${teamId}-near-${i}`] = { name: fakeName(rnd), teams: [teamId], cell, area: mine.area, demo: true };
      }
      spotAround(c, team, rnd, 3);
    }
    for (const m of pick(rnd, METROS.slice(0, 50), 18)) spotAround(m, team, rnd, 1);
    const now = Date.now();
    const lines = [`Anyone else stuck watching on a phone in a ${pick(rnd, ['Buffalo Wild Wings', 'hotel lobby', 'airport'], 1)[0]}?`,
      'Found a spot that puts our game on the big screen with sound. Added it to the map.',
      `Let's go ${team?.short || 'team'}!`, 'Who is heading out for the next one?', 'That last drive... I need a minute.'];
    const r = roomOf(teamId);
    state.rooms[r] = lines.map((text, i) => ({ id: `seed-${i}`, uid: `demo-${teamId}-${i}`, name: fakeName(rnd), text, at: now - (lines.length - i) * 3.6e6 * (1 + rnd() * 3), demo: true }));
    save();
  }
  function spotAround(c, team, rnd, n) {
    for (let i = 0; i < n; i++) {
      const lat = c.lat + (rnd() - 0.5) * 0.3, lng = c.lng + (rnd() - 0.5) * 0.3;
      const id = `demo-spot-${state.spots.length}`;
      state.spots.push({ id, name: `${pick(rnd, BAR_A, 1)[0]} ${pick(rnd, BAR_B, 1)[0]}`, address: 'Demo location', note: `Official-ish ${team?.short || ''} bar. Sound on for our games.`.trim(), lat, lng, teams: [team.id], by: 'demo', byName: 'Demo', demo: true });
      const going = Math.floor(rnd() * 14);
      for (let g = 0; g < going; g++) state.checkins.push({ uid: `demo-going-${id}-${g}`, name: fakeName(rnd), teamId: team.id, spotId: id, expiresAt: Date.now() + 5 * 864e5, demo: true });
    }
  }

  return {
    onUser(cb) { userCbs.add(cb); queueMicrotask(() => cb(state.user)); return () => userCbs.delete(cb); },
    signInGoogle() { throw new Error('Google sign-in needs Firebase. Use "Try the demo" for now.'); },
    signInEmail() { throw new Error('Email sign-in needs Firebase. Use "Try the demo" for now.'); },
    signUpEmail() { throw new Error('Email sign-up needs Firebase. Use "Try the demo" for now.'); },
    resetPassword() { throw new Error('Password reset needs Firebase.'); },
    signInDemo(name) { state.user = { uid: 'me', name: clean(name, 40) || 'You', email: null }; save(); emitUser(); },
    signOut() { state.user = null; save(); emitUser(); },
    async getProfile(uid) { return state.profiles[uid] ? { uid, ...state.profiles[uid] } : null; },
    async saveProfile(uid, p) {
      state.profiles[uid] = { name: clean(p.name, 40), teams: p.teams.slice(0, SITE.maxTeams), cell: p.cell.slice(0, SITE.homePrecision), area: p.area };
      state.seeded = {}; // reseed so demo neighbours land near the new home area
      for (const k of Object.keys(state.profiles)) if (k.startsWith('demo-')) delete state.profiles[k];
      state.spots = state.spots.filter(s => !s.demo); state.checkins = state.checkins.filter(c => !c.demo);
      for (const k of Object.keys(state.rooms)) state.rooms[k] = state.rooms[k].filter(m => !m.demo);
      save();
    },
    async deleteProfile() { localStorage.removeItem(KEY); state = { user: null, profiles: {}, spots: [], checkins: [], rooms: {}, seeded: {} }; emitUser(); },
    async fanCellsFor(teamId) {
      seedTeam(teamId);
      const cells = {};
      for (const p of Object.values(state.profiles)) if (p.cell && p.teams.includes(teamId)) cells[p.cell] = (cells[p.cell] || 0) + 1;
      return { cells, generatedAt: Date.now() }; // demo counts already include the demo user
    },
    async spotsFor(teamId) { seedTeam(teamId); return state.spots.filter(s => s.teams.includes(teamId)); },
    async spotsSample() { return state.spots; },
    async spotsNear() { return state.spots; },
    async checkinsActive() { return state.checkins.filter(active); },
    async addSpot(s) { state.spots.push({ ...s, id: `spot-${Date.now()}`, by: state.user.uid }); save(); },
    async removeSpot(id) { state.spots = state.spots.filter(s => s.id !== id); save(); },
    async checkinsFor(teamId) { seedTeam(teamId); return state.checkins.filter(c => c.teamId === teamId && active(c)); },
    async checkIn(c) { state.checkins = state.checkins.filter(x => !(x.uid === state.user.uid && x.teamId === c.teamId)); state.checkins.push({ ...c, uid: state.user.uid }); save(); },
    async checkOut(teamId) { state.checkins = state.checkins.filter(x => !(x.uid === state.user.uid && x.teamId === teamId)); save(); },
    subscribeRoom(id, cb) {
      const set = roomCbs.get(id) || new Set(); set.add(cb); roomCbs.set(id, set);
      queueMicrotask(() => cb(state.rooms[id] || []));
      return () => set.delete(cb);
    },
    async sendMessage(id, text, name) {
      (state.rooms[id] ||= []).push({ id: `m-${Date.now()}`, uid: state.user.uid, name: clean(name, 40), text: clean(text, 500), at: Date.now() });
      state.rooms[id] = state.rooms[id].slice(-100); save(); emitRoom(id);
    },
    async listQueue() { return []; },
    async reportSpot() {},
    async listSpots() { return state.spots; },
    async listProfiles() { return Object.entries(state.profiles).map(([uid, p]) => ({ uid, ...p })); },
    async listReports() { return []; },
    async removeReportedSpot() {},
    async dismissReport() {},
    async listVenueLeads() { return []; },
    async dismissVenueLead() {},
    async approveQueued() {},
    async rejectQueued() {},
    async deleteMessage(id, mid) { state.rooms[id] = (state.rooms[id] || []).filter(m => m.id !== mid); save(); emitRoom(id); },
  };
}

export const roomOf = (teamId, cell) => cell ? `${teamId}_${cell.slice(0, SITE.roomPrecision)}` : teamId;

function nearestByName(loc) {
  if (!loc) return null;
  const l = loc.toLowerCase();
  return METROS.find(m => l.includes(m.name.toLowerCase().split(/[–\s]/)[0])) || null;
}
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function pick(rnd, arr, n) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }
const FIRST = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Chris', 'Pat', 'Morgan', 'Jamie', 'Riley', 'Casey', 'Drew', 'Quinn', 'Avery', 'Reese', 'Jesse', 'Kelly', 'Robin', 'Dana', 'Lee', 'Max', 'Nico', 'Tess', 'Omar', 'Priya', 'Luis', 'Mia', 'Ben', 'Kate'];
const fakeName = rnd => `${pick(rnd, FIRST, 1)[0]} ${String.fromCharCode(65 + Math.floor(rnd() * 26))}.`;
const BAR_A = ['The Corner', 'Brass', 'Lucky', 'Rusty', 'Old Town', 'Northside', 'Tilted', 'Copper', 'Big Mike’s', 'Dugout', 'Red Door', 'Harbor'];
const BAR_B = ['Tap', 'Tavern', 'Pub', 'Sports Bar', 'Alehouse', 'Saloon', 'Grill', 'Taproom'];
