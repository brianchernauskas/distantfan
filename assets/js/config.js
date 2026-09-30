// Firebase web config. These keys are public by design: access is controlled by
// firestore.rules and Firebase Auth, not by keeping this file secret.
// Set FIREBASE_CONFIG to null to run in demo mode (data stays in this browser).
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBEXcgPMMP6ef_NCpf1npkv_WAtiBQGfHM',
  authDomain: 'distantfan-e8dbd.firebaseapp.com',
  projectId: 'distantfan-e8dbd',
  storageBucket: 'distantfan-e8dbd.firebasestorage.app',
  messagingSenderId: '1025815650213',
  appId: '1:1025815650213:web:6d33867eda6c0a3944d24c',
  measurementId: 'G-9SX08M8C92',
};

export const SITE = {
  name: 'Distant Fan',
  tagline: 'Your team. Wherever you are.',
  maxTeams: 8,
  // Geohash precision stored for a fan's home area. 5 ≈ 4.9 × 4.9 km (~3 mi). Firestore
  // rules reject anything more precise, so a street-level location can never be saved.
  homePrecision: 5,
  // Local chat rooms group fans by a precision-3 cell (≈ 156 × 156 km).
  roomPrecision: 3,
};

// Firebase uids that see the Review tab for the scout's queued finds. Must match isAdmin() in firestore.rules.
export const ADMINS = ['euJIvUd4sig4pGT4fE7SPSpE6lA3'];

// Fanatics affiliate strip on the Games tab. Stays hidden until `enabled` is true; add ?shop=1 to the
// app URL to preview it while off. After the affiliate program approves the site, paste the network's
// deep-link format into `linkTemplate` ({url} = the destination as-is, {urlenc} = URL-encoded, {team} = team id for the Sub ID) and set enabled: true.
// Example shape only: 'https://track.example.com/click?id=YOUR_ID&u={urlenc}'
export const AFFILIATE = {
  enabled: true,
  store: 'Fanatics',
  // Impact short link for Fanatics: ?u= overrides the landing page, subId1 tags the click with the team id.
  linkTemplate: 'https://fanatics.93n6tx.net/rEoGbj?u={urlenc}&subId1={team}',
  // Fanatics' team pages carry opaque ids, so until real deep links are mapped each card lands on a team search.
  searchUrl: 'https://www.fanatics.com/search?query={q}',
  // Optional per-team overrides once known: { 'nfl-pit': 'https://www.fanatics.com/nfl/pittsburgh-steelers/...' }
  teamUrls: {},
  disclosure: 'Distant Fan earns a commission on purchases made through these links, at no extra cost to you.',
};
