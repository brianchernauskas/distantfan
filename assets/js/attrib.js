// First-touch attribution: remembers how this browser first reached the site (landing path, referrer
// host, utm tags) and an optional ?follow=<teamId> prefill, in localStorage only. The app copies the
// coarse result onto the profile at sign-up so a new account can be traced to a source. No cookies,
// no ids, nothing is sent anywhere from here.
const KEY = 'df_first', FOLLOW = 'df_follow';
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const tidy = (s, n) => String(s || '').replace(/[^\w.\-/ ]/g, '').slice(0, n);

export function firstTouch() {
  try { return JSON.parse(get(KEY)) || null; } catch { return null; }
}

export function followPrefill() { return get(FOLLOW) || ''; }
export function clearFollow() { try { localStorage.removeItem(FOLLOW); } catch {} }

(function capture() {
  const q = new URLSearchParams(location.search);
  const follow = q.get('follow');
  if (follow && /^[\w-]{1,40}$/.test(follow)) set(FOLLOW, follow);
  if (firstTouch()) return;
  let ref = '';
  try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch {}
  if (ref === location.hostname.replace(/^www\./, '')) ref = '';
  const src = q.get('utm_source') || '';
  set(KEY, JSON.stringify({
    path: tidy(location.pathname, 80),
    ref: tidy(ref, 60),
    utm: tidy([src, q.get('utm_medium'), q.get('utm_campaign')].filter(Boolean).join('/'), 60),
    at: Date.now(),
  }));
})();
