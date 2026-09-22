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
  // Geohash precision stored for a fan's home area. 4 ≈ 39 × 20 km. Firestore
  // rules reject anything more precise, so a street-level location can never be saved.
  homePrecision: 4,
  // Local chat rooms group fans by a precision-3 cell (≈ 156 × 156 km).
  roomPrecision: 3,
};
