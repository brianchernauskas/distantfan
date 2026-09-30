// Re-harvest Fanatics team-shop links. Run in a real browser, NOT in node (Fanatics 403s scripts).
//
// 1. Open https://www.fanatics.com/ in Chrome (any page on that site: fetches must be same-origin).
// 2. Open DevTools (F12) > Console, paste this whole file and press Enter. Leave the tab open and alone.
//    It takes roughly 7-15 minutes; progress is saved to localStorage, so it resumes if the tab reloads.
// 3. When window.__finished is true (type it in the console), run:   copy(JSON.stringify(window.__pages))
// 4. In a terminal in the repo:   node tools/shop-pages.mjs --clipboard
//    then:                         node tools/shop-feed.mjs --commit
//
// Why this exists: Fanatics signs team-page URLs (the /z- part), so they cannot be built, only read off their
// own pages. Each team's link is read from one of that team's product pages (paths come from the live
// data/shop files). Links are only trusted for AFFILIATE.pageMaxAgeDays (assets/js/config.js) after harvesting.
(async () => {
  const SITE = 'https://distantfan.com/data/shop/';
  const KEY = 'df_pages_v1';
  const ids = await (await fetch(SITE + '_index.json')).json();
  window.__pages = {}; window.__fail = {}; window.__finished = false; window.__stop = false;
  try { Object.assign(window.__pages, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(window.__pages)); } catch {} };
  const todo = ids.filter(id => !window.__pages[id]);
  let next = 0;
  const one = async id => {
    try {
      const d = await (await fetch(SITE + id + '.json')).json();
      for (const it of (d.items || d).slice(0, 3)) {
        const dest = decodeURIComponent(new URL(it.u).searchParams.get('u') || '');
        const pth = new URL(dest).pathname, seg = pth.split('/').filter(Boolean);
        if (seg.length < 3) continue;
        const prefix = '/' + seg[0] + '/' + seg[1] + '/';
        const r = await fetch(pth); if (!r.ok) continue;
        const html = await r.text();
        const i = html.indexOf('href="' + prefix + 'o-');
        const j = i < 0 ? -1 : html.indexOf('"', i + 6);
        const m = i < 0 ? null : html.slice(i + 6, j);
        if (m && /^\/[a-z0-9-]+\/[a-z0-9-]+\/o-\d+\+t-\d+\+z-[\w-]+$/.test(m)) { window.__pages[id] = m; save(); return; }
      }
      window.__fail[id] = 'no team link';
    } catch (e) { window.__fail[id] = String(e).slice(0, 50); }
  };
  // Two workers: four froze the tab on the first attempt.
  const worker = async () => { while (!window.__stop && next < todo.length) { await one(todo[next++]); await new Promise(r => setTimeout(r, 400)); } };
  Promise.all([worker(), worker()]).then(() => { window.__finished = true; console.log('harvest done:', Object.keys(window.__pages).length, 'found,', Object.keys(window.__fail).length, 'failed'); });
  console.log('harvest started:', todo.length, 'teams to do. Check window.__finished, then copy(JSON.stringify(window.__pages)).');
})();
