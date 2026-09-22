// Shared pieces for the Distant Fan watch-party scout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TEAMS } from '../../assets/js/teams.js';

export const AREAS = {
  phoenix: {
    label: 'Phoenix',
    center: { lat: 33.45, lng: -112.07 },
    radiusKm: 100,
    // Home-market teams: their fans aren't out-of-market here, so the scout skips them.
    homeTeams: ['nfl-ari', 'nba-phx', 'mlb-ari', 'cfb-9', 'cfb-12'],
  },
};

export const SPOT_TTL_DAYS = 60;   // a recurring spot drops off unless re-confirmed within this window
export const ROTATION = 4;         // teams are split into 4 buckets; one bucket per week

const P4 = JSON.parse(fs.readFileSync(new URL('./p4-ids.json', import.meta.url)));
const P4_IDS = new Set(Object.values(P4).flat().map(id => `cfb-${id}`));
const CONF = Object.fromEntries(Object.entries(P4).flatMap(([c, ids]) => ids.map(id => [`cfb-${id}`, c])));

export function scoutTeams(area) {
  const skip = new Set(AREAS[area].homeTeams);
  return TEAMS.filter(t => (t.lg !== 'cfb' || P4_IDS.has(t.id)) && !skip.has(t.id))
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

export const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
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
