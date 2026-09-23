// Shared pieces for the Distant Fan watch-party scout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TEAMS } from '../../assets/js/teams.js';

// Covered metros: the top 30 US metros by population (minus Riverside-San Bernardino, which is
// LA sprawl and would just duplicate the la entry) plus Phoenix, which was added ahead of its
// population rank for Brian's own local relevance. homeTeams are skipped in that city only,
// since their fans aren't out-of-market there (a Cowboys bar in Phoenix still counts). A school's
// football and basketball ids are both listed when it fields both, since ESPN ids are per-school.
export const AREAS = {
  nyc: { label: 'New York', center: { lat: 40.73, lng: -73.99 }, radiusKm: 70,
    homeTeams: ['nfl-nyg', 'nfl-nyj', 'nba-ny', 'nba-bkn', 'mlb-nyy', 'mlb-nym', 'nhl-nyr', 'nhl-nyi', 'nhl-nj', 'mls-nyc', 'mls-rbny', 'cfb-164', 'cbb-164'] },
  la: { label: 'Los Angeles', center: { lat: 34.05, lng: -118.24 }, radiusKm: 90,
    homeTeams: ['nfl-lar', 'nfl-lac', 'nba-lal', 'nba-lac', 'mlb-lad', 'mlb-laa', 'nhl-la', 'nhl-ana', 'mls-lafc', 'mls-la', 'cfb-30', 'cbb-30', 'cfb-26', 'cbb-26'] },
  chi: { label: 'Chicago', center: { lat: 41.88, lng: -87.63 }, radiusKm: 70,
    homeTeams: ['nfl-chi', 'nba-chi', 'mlb-chc', 'mlb-chw', 'nhl-chi', 'mls-chi', 'cfb-77', 'cbb-77'] },
  dfw: { label: 'Dallas–Fort Worth', center: { lat: 32.84, lng: -97.05 }, radiusKm: 90,
    homeTeams: ['nfl-dal', 'nba-dal', 'mlb-tex', 'nhl-dal', 'mls-dal', 'cfb-2628', 'cbb-2628', 'cfb-2567', 'cbb-2567'] },
  hou: { label: 'Houston', center: { lat: 29.76, lng: -95.37 }, radiusKm: 80,
    homeTeams: ['nfl-hou', 'nba-hou', 'mlb-hou', 'mls-hou', 'cfb-248', 'cbb-248'] },
  atl: { label: 'Atlanta', center: { lat: 33.75, lng: -84.39 }, radiusKm: 70,
    homeTeams: ['nfl-atl', 'nba-atl', 'mlb-atl', 'mls-atl', 'cfb-59', 'cbb-59'] },
  dc: { label: 'Washington DC', center: { lat: 38.91, lng: -77.04 }, radiusKm: 70,
    homeTeams: ['nfl-wsh', 'nba-wsh', 'mlb-wsh', 'nhl-wsh', 'mls-dc', 'cfb-120', 'cbb-120'] },
  mia: { label: 'Miami', center: { lat: 26.0, lng: -80.2 }, radiusKm: 90,
    homeTeams: ['nfl-mia', 'nba-mia', 'mlb-mia', 'nhl-fla', 'mls-mia', 'cfb-2390', 'cbb-2390'] },
  phl: { label: 'Philadelphia', center: { lat: 39.95, lng: -75.17 }, radiusKm: 60,
    homeTeams: ['nfl-phi', 'nba-phi', 'mlb-phi', 'nhl-phi', 'mls-phi'] },
  // Arizona Wildcats (cfb-12/cbb-12) play in Tucson, ~110mi away, so they're treated as an away
  // team for Phoenix scouting purposes even though they're the state's flagship program.
  phx: { label: 'Phoenix', center: { lat: 33.45, lng: -112.07 }, radiusKm: 100,
    homeTeams: ['nfl-ari', 'nba-phx', 'mlb-ari', 'cfb-9', 'cbb-9'] },
  bos: { label: 'Boston', center: { lat: 42.36, lng: -71.06 }, radiusKm: 60,
    homeTeams: ['nfl-ne', 'nba-bos', 'mlb-bos', 'nhl-bos', 'mls-ne', 'cfb-103', 'cbb-103'] },
  sf: { label: 'San Francisco Bay Area', center: { lat: 37.77, lng: -122.42 }, radiusKm: 90,
    homeTeams: ['nfl-sf', 'nba-gs', 'mlb-sf', 'nhl-sj', 'mls-sj', 'cfb-25', 'cbb-25', 'cfb-24', 'cbb-24'] },
  det: { label: 'Detroit', center: { lat: 42.33, lng: -83.05 }, radiusKm: 65,
    homeTeams: ['nfl-det', 'nba-det', 'mlb-det', 'nhl-det', 'cfb-130', 'cbb-130'] },
  sea: { label: 'Seattle', center: { lat: 47.61, lng: -122.33 }, radiusKm: 70,
    homeTeams: ['nfl-sea', 'mlb-sea', 'nhl-sea', 'mls-sea', 'cfb-264', 'cbb-264'] },
  msp: { label: 'Minneapolis–St. Paul', center: { lat: 44.98, lng: -93.27 }, radiusKm: 65,
    homeTeams: ['nfl-min', 'nba-min', 'mlb-min', 'nhl-min', 'mls-min', 'cfb-135', 'cbb-135'] },
  sd: { label: 'San Diego', center: { lat: 32.72, lng: -117.16 }, radiusKm: 60,
    homeTeams: ['mlb-sd', 'mls-sd'] },
  tb: { label: 'Tampa Bay', center: { lat: 27.95, lng: -82.46 }, radiusKm: 65,
    homeTeams: ['nfl-tb', 'mlb-tb', 'nhl-tb'] },
  den: { label: 'Denver', center: { lat: 39.74, lng: -104.99 }, radiusKm: 70,
    homeTeams: ['nfl-den', 'nba-den', 'mlb-col', 'nhl-col', 'mls-col', 'cfb-38', 'cbb-38'] },
  sa: { label: 'San Antonio', center: { lat: 29.42, lng: -98.49 }, radiusKm: 55,
    homeTeams: ['nba-sa'] },
  stl: { label: 'St. Louis', center: { lat: 38.63, lng: -90.2 }, radiusKm: 60,
    homeTeams: ['mlb-stl', 'nhl-stl', 'mls-stl'] },
  bal: { label: 'Baltimore', center: { lat: 39.29, lng: -76.61 }, radiusKm: 50,
    homeTeams: ['nfl-bal', 'mlb-bal'] },
  orl: { label: 'Orlando', center: { lat: 28.54, lng: -81.38 }, radiusKm: 60,
    homeTeams: ['nba-orl', 'mls-orl', 'cfb-2116', 'cbb-2116'] },
  clt: { label: 'Charlotte', center: { lat: 35.23, lng: -80.84 }, radiusKm: 60,
    homeTeams: ['nfl-car', 'nba-cha', 'mls-clt'] },
  lv: { label: 'Las Vegas', center: { lat: 36.17, lng: -115.14 }, radiusKm: 50,
    homeTeams: ['nfl-lv', 'nhl-vgk'] },
  pdx: { label: 'Portland', center: { lat: 45.52, lng: -122.68 }, radiusKm: 60,
    homeTeams: ['nba-por', 'mls-por'] },
  aus: { label: 'Austin', center: { lat: 30.27, lng: -97.74 }, radiusKm: 50,
    homeTeams: ['mls-atx', 'cfb-251', 'cbb-251'] },
  sac: { label: 'Sacramento', center: { lat: 38.58, lng: -121.49 }, radiusKm: 60,
    homeTeams: ['nba-sac'] },
  cmh: { label: 'Columbus', center: { lat: 39.96, lng: -82.99 }, radiusKm: 55,
    homeTeams: ['nhl-cbj', 'mls-clb', 'cfb-194', 'cbb-194'] },
  pit: { label: 'Pittsburgh', center: { lat: 40.44, lng: -79.99 }, radiusKm: 55,
    homeTeams: ['nfl-pit', 'mlb-pit', 'nhl-pit', 'cfb-221', 'cbb-221'] },
};

// City sweep: which metros each weekday covers (Mon..Fri), so every city is searched roughly
// every 6 business days now that there are 29 of them (was every week at 11).
export const CITY_DAYS = [
  ['nyc', 'la', 'chi', 'sf', 'sea', 'det'],
  ['dfw', 'hou', 'sa', 'aus', 'sd', 'stl'],
  ['dc', 'phl', 'bal', 'pit', 'cmh', 'msp'],
  ['mia', 'atl', 'orl', 'tb', 'clt', 'sac'],
  ['bos', 'phx', 'den', 'lv', 'pdx'],
];

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
const P4_IDS = new Set(Object.values(P4).flat().flatMap(id => [`cfb-${id}`, `cbb-${id}`]));
const CONF = Object.fromEntries(Object.entries(P4).flatMap(([c, ids]) => ids.flatMap(id => [[`cfb-${id}`, c], [`cbb-${id}`, c]])));

// Every tracked team: all pro teams plus Power 4 football/basketball and Notre Dame. Home teams are excluded per city in apply.mjs.
// Every P4 school is tracked under both cfb and cbb with the identical team name ("Ohio State
// Buckeyes"), so a bare name is ambiguous -- printing "(Football)"/"(Basketball)" here means the
// agent copies a disambiguated name straight into candidates, and resolveTeam() below can parse
// it back to the right league instead of silently failing to resolve either one.
export function scoutTeams() {
  return TEAMS.filter(t => (t.lg !== 'cfb' && t.lg !== 'cbb') || P4_IDS.has(t.id))
    .map(t => ({ id: t.id, name: t.lg === 'cfb' ? `${t.name} (Football)` : t.lg === 'cbb' ? `${t.name} (Basketball)` : t.name, league: t.lg, conference: CONF[t.id] }));
}

export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

// Team names from the agent → ids. Accepts an id, full name, "short" name, or abbreviation within
// a league. A trailing "(Football)"/"(Basketball)" (as scoutTeams() now prints for every P4
// school, which is tracked under both) resolves straight to that league instead of hitting the
// cfb/cbb name collision below.
export function resolveTeam(s) {
  const q = String(s || '').trim().toLowerCase();
  if (!q) return null;
  const byId = TEAMS.find(t => t.id === q);
  if (byId) return byId;
  const sport = q.match(/^(.*?)\s*\((football|basketball)\)$/);
  if (sport) {
    const lg = sport[2] === 'football' ? 'cfb' : 'cbb', base = sport[1];
    const hit = TEAMS.find(t => t.lg === lg && (t.name.toLowerCase() === base || t.short.toLowerCase() === base || t.loc.toLowerCase() === base));
    if (hit) return hit;
  }
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

// "City, ST" label for a venue outside the tracked metros. Addresses often lack the comma between street
// and city ("225 W Main St Charlottesville, VA 22902"), so read the city from the address text when the
// street ends at a street-type word, and otherwise ask the Census reverse geocoder about the coordinates.
const STATE_NAMES = {alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY'};
const STREET_WORDS = new Set('st street ave avenue rd road blvd boulevard dr drive pkwy parkway hwy highway way ln lane ct court pl place trl trail cir circle sq square pike ter terrace loop row boardwalk plaza center pointe point route path fwy trace run a1a nw ne sw se n s e w north south east west alley market park bridge'.split(' '));
const titleCase = s => s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
function cityFromAddress(address, st) {
  let s = String(address).replace(/\b\d{5}(-\d{4})?\b/g, ' ').replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
  const names = Object.entries(STATE_NAMES).filter(([, c]) => c === st).map(([n]) => n);
  const rx = new RegExp('\\b(' + [st, ...names].join('|') + ')\\s*$', 'i');
  if (!rx.test(s)) return null;
  s = s.replace(rx, '').trim().replace(/\b(suite|ste|unit|apt|floor)\s*\S+/gi, ' ').replace(/\s+/g, ' ').trim();
  const w = s.split(' '), out = [];
  for (let i = w.length - 1; i >= 0 && out.length < 3; i--) {
    const x = w[i].toLowerCase();
    if (STREET_WORDS.has(x) || /\d/.test(x)) break;
    out.unshift(w[i]);
  }
  return out.length ? titleCase(out.join(' ')) : null;
}
export async function cityLabelFor(address, geo) {
  const m = String(address || '').match(/,\s*([A-Za-z .'-]+),\s*([A-Z]{2})\b/);
  if (m) return `${m[1].trim()}, ${m[2]}`;
  try {
    const u = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${geo.lng}&y=${geo.lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Incorporated%20Places,Census%20Designated%20Places,County%20Subdivisions,States&format=json`;
    const g = (await (await fetch(u)).json()).result.geographies, st = g.States?.[0]?.STUSAB;
    const place = (g['Incorporated Places'] || g['Census Designated Places'] || g['County Subdivisions'] || [])[0]?.BASENAME;
    if (st) {
      const city = cityFromAddress(address, st) || (place || '').replace(/\s*\(balance\)|\s+metropolitan government|\s+consolidated government/gi, '');
      if (city) return `${city}, ${st}`;
    }
  } catch {}
  return String(address || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}
