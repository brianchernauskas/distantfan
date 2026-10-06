// Firebase Analytics (GA4) for pages that don't load the app's store: landing, unsubscribe and the
// generated watch/ pages. app.html gets analytics from store.js, so it must not load this file too
// (two inits would count each page view twice).
import { FIREBASE_CONFIG } from './config.js?v=202610061630';
import { firstTouch } from './attrib.js?v=202610061630'; // side effect: records first-touch source + ?follow=
firstTouch();

// window.dfTrack(name, params): lets the small inline scripts on the generated pages (share buttons)
// log GA4 events. Events fired before Analytics finishes loading are queued and flushed, and are
// dropped silently when Analytics is blocked.
const queue = [];
window.dfTrack = (name, params) => { queue.push([name, params]); };

if (FIREBASE_CONFIG) {
  const base = 'https://www.gstatic.com/firebasejs/12.19.0';
  // Best-effort: ad blockers or unsupported browsers must never break the page.
  Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-analytics.js`)])
    .then(async ([{ initializeApp }, an]) => {
      if (!(await an.isSupported())) return;
      const a = an.getAnalytics(initializeApp(FIREBASE_CONFIG));
      const send = (name, params) => { try { an.logEvent(a, name, params); } catch {} };
      queue.splice(0).forEach(([n, p]) => send(n, p));
      window.dfTrack = send;
    })
    .catch(() => {});
}
