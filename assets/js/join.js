// One-step game-day email signup on the generated watch pages (form.joinbar, built by build-pages.mjs). Without JS the form
// falls back to a plain GET of /app.html?follow=<teamId> (the email field has no name, so it never lands in a URL).
// The visitor types an email; Firebase Auth mails them a sign-in link (passwordless email link), which
// doubles as the opt-in confirmation, so nobody can subscribe someone else. Tapping it opens
// app.html?join=<teamId>&m=<metro>, where app.js finishes sign-in and creates the profile with that team,
// that metro as the rough home area and the weekly email switched on. Firebase loads only on submit.
import { FIREBASE_CONFIG } from './config.js?v=202610150903';

const KEY = 'df_join';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const track = (n, p) => { try { (window.dfTrack || (() => {}))(n, p); } catch {} };

for (const form of document.querySelectorAll('form.joinbar')) {
  const msg = form.querySelector('.jmsg'), btn = form.querySelector('button'), input = form.querySelector('input[type=email]');
  const say = (html, cls = '') => { msg.className = `jmsg ${cls}`; msg.innerHTML = html; };
  input.addEventListener('focus', () => track('join_focus', { team: form.dataset.team }), { once: true });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = input.value.trim();
    if (!EMAIL.test(email)) { say('Enter a valid email address.', 'err'); input.focus(); return; }
    const team = form.dataset.team, m = form.dataset.m || '';
    const appUrl = `/app.html?follow=${encodeURIComponent(team)}`;
    if (!FIREBASE_CONFIG) { location.href = appUrl; return; }
    btn.disabled = true; say('Sending…');
    try {
      const base = 'https://www.gstatic.com/firebasejs/12.19.0';
      const [{ initializeApp, getApps, getApp }, A] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`)]);
      const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
      const url = `${location.origin}/app.html?join=${encodeURIComponent(team)}&m=${encodeURIComponent(m)}&utm_source=join&utm_medium=email&utm_campaign=${encodeURIComponent(team)}`;
      await A.sendSignInLinkToEmail(A.getAuth(app), email, { url, handleCodeInApp: true });
      try { localStorage.setItem(KEY, JSON.stringify({ email, team, m, at: Date.now() })); } catch {}
      track('join_start', { team, metro: m });
      form.classList.add('sent');
      say(`<b>Check your inbox.</b> We sent a link to ${email.replace(/[<>&"]/g, '')}. Tap it to confirm and you're in. Not there in a minute? Check spam.`, 'ok');
    } catch (x) {
      btn.disabled = false;
      const code = x && x.code || '';
      track('join_error', { team, code: String(code).slice(0, 40) });
      say(code === 'auth/invalid-email' ? 'That email address doesn\'t look right.'
        : code === 'auth/quota-exceeded' || code === 'auth/too-many-requests' ? 'Too many sign-ups right now. Try again in a few minutes.'
        : `Couldn't send the link. <a href="${appUrl}">Sign up in the app instead</a>.`, 'err');
    }
  });
}
