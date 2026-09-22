// Firebase web config. These keys are public by design: access is controlled by
// firestore.rules and Firebase Auth, not by keeping this file secret.
// Leave FIREBASE_CONFIG as null to run in demo mode (data stays in this browser).
export const FIREBASE_CONFIG = null;
/* Paste from Firebase console → Project settings → Your apps → Web app:
export const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
*/

export const SITE = {
  name: 'Distant Fan',
  tagline: 'Your team. Wherever you are.',
  maxTeams: 8,
  // Geohash precision stored for a fan's home area. 4 ≈ 39 × 20 km. Firestore
  // rules reject anything more precise, so a street-level location can never be saved.
  homePrecision: 4,
  // Local chat rooms group fans by a precision-3 cell (≈ 156 × 156 km).
  roomPrecision: 3,
};
