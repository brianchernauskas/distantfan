// Native-app-only helpers. Loaded with a dynamic import from store.js when running inside the
// Capacitor shell; the website never fetches this file. The Firebase Authentication plugin does the
// Google sign-in with the OS account chooser (popups don't work in a webview), and the ID token it
// returns is handed to the web SDK so Firestore rules see the same signed-in user as on the web.
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

export const isNative = () => Capacitor.isNativePlatform();

export async function signInGoogle(A, auth) {
  const res = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
  const idToken = res.credential && res.credential.idToken;
  if (!idToken) throw new Error('Google sign-in did not return a token.');
  return A.signInWithCredential(auth, A.GoogleAuthProvider.credential(idToken));
}

export const signOut = () => FirebaseAuthentication.signOut().catch(() => {});

// Coarse position for "Use my location". Matches the callback shape of navigator.geolocation so the
// call site in app.js stays the same; a denied permission maps to error code 1 as in the browser API.
// Only a coarse fix is requested: the app rounds it to a ~5 km geohash cell and discards the coordinates.
export async function getPosition(ok, fail, opts = {}) {
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    let perm = await Geolocation.checkPermissions();
    if (perm.coarseLocation !== 'granted' && perm.location !== 'granted') perm = await Geolocation.requestPermissions({ permissions: ['coarseLocation'] });
    if (perm.coarseLocation !== 'granted' && perm.location !== 'granted') return fail({ code: 1 });
    ok(await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: opts.timeout || 12000, maximumAge: opts.maximumAge || 0 }));
  } catch (e) {
    fail({ code: /denied/i.test(String(e && e.message)) ? 1 : 2 });
  }
}
