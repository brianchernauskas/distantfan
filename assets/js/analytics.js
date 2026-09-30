// Firebase Analytics (GA4) for pages that don't load the app's store: landing, unsubscribe and the
// generated watch/ pages. app.html gets analytics from store.js, so it must not load this file too
// (two inits would count each page view twice).
import { FIREBASE_CONFIG } from './config.js?v=202609301543';

if (FIREBASE_CONFIG) {
  const base = 'https://www.gstatic.com/firebasejs/12.19.0';
  // Best-effort: ad blockers or unsupported browsers must never break the page.
  Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-analytics.js`)])
    .then(async ([{ initializeApp }, an]) => { if (await an.isSupported()) an.getAnalytics(initializeApp(FIREBASE_CONFIG)); })
    .catch(() => {});
}
