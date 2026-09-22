// Shared pieces for the Distant Fan watch-party scout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TEAMS } from '../../assets/js/teams.js';

// Covered metros: the 10 largest US metros plus Phoenix. homeTeams are skipped in that city only,
// since their fans aren't out-of-market there (a Cowboys bar in Phoenix still counts).
export const AREAS = {
  nyc: { label: 'New York', center: { lat: 40.73, lng: -73.99 }, radiusKm: 70,
    homeTeams: ['nfl-nyg', 'nfl-nyj', 'nba-ny', 'nba-bkn', 'mlb-nyy', 'mlb-nym', 'nhl-nyr', 'nhl-nyi', 'nhl-nj', 'mls-nyc', 'mls-rbny', 'cfb-164'] },
  la: { label: 'Los Angeles', center: { lat: 34.05, lng: -118.24 }, radiusKm: 90,
    homeTeams: ['nfl-lar', 'nfl-lac', 'nba-lal', 'nba-lac', 'mlb-lad', 'mlb-laa', 'nhl-la', 'nhl-ana', 'mls-lafc', 'mls-la', 'cfb-30', 'cfb-26'] },
  chi: { label: 'Chicago', center: { lat: 41.88, lng: -87.63 }, radiusKm: 70,
    homeTeams: ['nfl-chi', 'nba-chi', 'mlb-chc', 'mlb-chw', 'nhl-chi', 'mls-chi', 'cfb-77'] },
  dfw: { label: 'Dallas–Fort Worth', center: { lat: 32.84, lng: -97.05 }, radiusKm: 90,
    homeTeams: ['nfl-dal', 'nba-dal', 'mlb-tex', 'nhl-dal', 'mls-dal', 'cfb-2628', 'cfb-2567'] },
  hou: { label: 'Houston', center: { lat: 29.76, lng: -95.37 }, radiusKm: 80,
    homeTeams: ['nfl-hou', 'nba-hou', 'mlb-hou', 'mls-hou', 'cfb-248'] },
  dc: { label: 'Washington DC', center: { lat: 38.91, lng: -77.04 }, radiusKm: 70,
    homeTeams: ['nfl-wsh', 'nba-wsh', 'mlb-wsh', 'nhl-wsh', 'mls-dc', 'cfb-120'] },
  phl: { label: 'Philadelphia', center: { lat: 39.95, lng: -75.17 }, radiusKm: 60,
    homeTeams: ['nfl-phi', 'nba-phi', 'mlb-phi', 'nhl-phi', 'mls-phi'] },
  mia: { label: 'Miami', center: { lat: 26.0, lng: -80.2 }, radiusKm: 90,
    homeTeams: ['nfl-mia', 'nba-mia', 'mlb-mia', 'nhl-fla', 'mls-mia', 'cfb-2390'] },
  atl: { label: 'Atlanta', center: { lat: 33.75, lng: -84.39 }, radiusKm: 70,
    homeTeams: ['nfl-atl', 'nba-atl', 'mlb-atl', 'mls-atl', 'cfb-59'] },
  bos: { label: 'Boston', center: { lat: 42.36, lng: -71.06 }, radiusKm: 60,
    homeTeams: ['nfl-ne', 'nba-bos', 'mlb-bos', 'nhl-bos', 'mls-ne', 'cfb-103'] },
  // Arizona Wildcats (cfb-12) play in Tucson, ~110mi away, so they're treated as an away
  // team for Phoenix scouting purposes even though they're the state's flagship program.
  phx: { label: 'Phoenix', center: { lat: 33.45, lng: -112.07 }, radiusKm: 100,
    homeTeams: ['nfl-ari', 'nba-phx', 'mlb-ari', 'cfb-9'] },
};

// City sweep: which metros each weekday covers (Mon..Fri), so every city is searched weekly.
export const CITY_DAYS = [['nyc', 'la', 'chi'], ['dfw', 'hou'], ['dc', 'phl'], ['mia', 'atl'], ['bos', 'phx']];

// The covered metro a point falls in, or null.
export function areaFor(pt) {
  let best = null, bestD = Infinity;
  for (const [key, a] of Object.entries(AREAS)) {
    const d = km(a.center, pt);
    if (d <= a.radiusKm && d < bestD) { best = key; bestD = d; }
  }
  return best;
}

export const SPOT_TTL_DAYS = 60;   // a recurring spot drops off unless re-confirmed within this window
export const ROTATION = 4;         // teams are split into 4 buckets; one bucket per week

const P4 = JSON.parse(fs.readFileSync(new URL('./p4-ids.json', import.meta.url)));
const P4_IDS = new Set(Object.values(P4).flat().map(id => `cfb-${id}`));
const CONF = Object.fromEntries(Object.entries(P4).flatMap(([c, ids]) => ids.map(id => [`cfb-${id}`, c])));

// Every tracked team: all pro teams plus Power 4 football and Notre Dame. Home teams are excluded per city in apply.mjs.
export function scoutTeams() {
  return TEAMS.filter(t => t.lg !== 'cfb' || P4_IDS.has(t.id))
    .map(t => ({ id: t.id, name: t.name, league: t.lg, conference: CONF[t.id] }));
}

export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

// Team names from the agent → ids. Accepts an id, full name, "short" name, or abbreviation within a league.
export function resolveTeam(s) {
  const q = String(s || '').trim().toLowerCase();
  if (!q) return null;
  const byId = TEAMS.find(t => t.id === q);
  if (byId) return byId;
  const exact = TEAMS.filter(t => t.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const short = TEAMS.filter(t => t.short.toLowerCase() === q || t.loc.toLowerCase() === q);
  return short.length === 1 ? short[0] : null;
}

export const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|bar|and|grill|pub|tavern|restaurant)\b/g, ' ').replace(/\s+/g, ' ').trim();

export function venueKey(venue, address) {
  const num = (String(address || '').match(/\d+/) || [''])[0];
  return crypto.createHash('sha1').update(`${norm(venue)}|${num}`).digest('hex').slice(0, 16);
}

export function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// US Census geocoder first (free, no key, US street addresses), OpenStreetMap Nominatim as fallback.
export async function geocode(address) {
  try {
    const u = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`;
    const j = await (await fetch(u)).json();
    const m = j?.result?.addressMatches?.[0];
    if (m) return { lat: m.coordinates.y, lng: m.coordinates.x, matched: m.matchedAddress, via: 'census' };
  } catch {}
  try {
    await new Promise(r => setTimeout(r, 1100)); // Nominatim policy: at most 1 request per second
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(address)}`;
    const j = await (await fetch(u, { headers: { 'User-Agent': 'distantfan-scout/1.0 (https://distantfan.com)' } })).json();
    if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon, matched: j[0].display_name, via: 'nominatim' };
  } catch {}
  return null;
}

export function credentialPath() {
  return process.env.DISTANTFAN_ADMIN_KEY || path.join(os.homedir(), '.secrets', 'distantfan-admin.json');
}

export async function adminDb() {
  const key = credentialPath();
  if (!fs.existsSync(key)) {
    throw new Error(`No admin key at ${key}. Create one in Firebase console → Project settings → Service accounts → Generate new private key, and save it there.`);
  }
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(fs.readFileSync(key, 'utf8'))) });
  return getFirestore();
}
