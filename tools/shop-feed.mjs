// Build data/shop/<teamId>.json: a few real Fanatics products per team, from impact.com's product catalog.
//
//   node tools/shop-feed.mjs --probe     fetch one page, print the field names and a sample item (check this first)
//   node tools/shop-feed.mjs             page through the catalog, match items to teams, write data/shop/
//   node tools/shop-feed.mjs --commit    ...then commit + push data/shop/
//
// Credentials live outside the repo in ~/.secrets/distantfan-impact.json (Brian creates it; Claude never
// reads it):  { "accountSid": "IR...", "authToken": "...", "catalogId": 5812 }
// 5812 = "Fanatics Top Products" (50,000 items); 5042 = the full 765k catalog (much slower to page).
//
// The site never calls impact.com: shop.js reads the small per-team data/shop/*.json snapshots, so no keys ship to
// the browser and page views cost nothing. Product Url values from the catalog are already tracking links.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const PER_TEAM = 6;
const PAGE_SIZE = 1000;

const cfgPath = path.join(os.homedir(), '.secrets', 'distantfan-impact.json');
if (!fs.existsSync(cfgPath)) { console.error(`Missing ${cfgPath}. See the header of this file.`); process.exit(1); }
const { accountSid, authToken, catalogId = 5812 } = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
const base = process.env.IMPACT_BASE || 'https://api.impact.com';

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url.startsWith('http') ? url : base + url, { headers: { Authorization: auth, Accept: 'application/json' } });
    if (res.ok) return res.json();
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
    await new Promise(r => setTimeout(r, 2000 * attempt));
  }
}
const firstPage = `/Mediapartners/${accountSid}/Catalogs/${catalogId}/Items?PageSize=${PAGE_SIZE}`;

if (args.includes('--probe')) {
  const page = await get(firstPage.replace(`PageSize=${PAGE_SIZE}`, 'PageSize=3'));
  console.log('page keys:', Object.keys(page).join(', '));
  const items = page.Items || [];
  console.log('items on page:', items.length);
  if (items[0]) { console.log('item fields:', Object.keys(items[0]).join(', ')); console.log(JSON.stringify(items[0], null, 1)); }
  process.exit(0);
}

// Catalog field names per impact.com's Items schema; --probe shows the real ones if these ever drift.
const price = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };
const inStock = it => !it.StockAvailability || /in.?stock|available/i.test(String(it.StockAvailability));
const usable = it => it.Name && it.ImageUrl && it.Url && price(it.CurrentPrice) != null && inStock(it);

// teams.js is an ES module of plain data; import it directly.
const { TEAMS } = await import(pathToUrl(path.join(root, 'assets/js/teams.js')));
function pathToUrl(p) { return 'file:///' + p.replace(/\\/g, '/'); }
const norm = s => ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const needles = TEAMS.map(t => ({ t, key: norm(t.name) }));

const byTeam = {};
let next = firstPage, seen = 0, kept = 0, pages = 0;
while (next) {
  const page = await get(next);
  const items = page.Items || [];
  pages++; seen += items.length;
  for (const it of items) {
    if (!usable(it)) continue;
    const hay = norm(it.Name);
    // A name like "Arizona Cardinals Nike Game Jersey" matches on the full team name. Longest name wins so
    // "Ohio State Buckeyes" is never mistaken for a shorter overlapping one.
    let best = null;
    for (const n of needles) if (hay.includes(n.key) && (!best || n.key.length > best.key.length)) best = n;
    if (!best) continue;
    const list = (byTeam[best.t.id] ||= []);
    if (list.length >= PER_TEAM) continue;
    list.push({ n: String(it.Name).slice(0, 90), p: price(it.CurrentPrice), o: price(it.OriginalPrice), i: it.ImageUrl, u: it.Url });
    kept++;
  }
  process.stderr.write(`\rpage ${pages}: ${seen} items scanned, ${kept} kept`);
  const nu = page['@nextpageuri'];
  next = nu ? nu : null;
}
process.stderr.write('\n');

// One small file per team (data/shop/<teamId>.json) so the app fetches only the teams a fan follows,
// instead of one ~700 KB file on every Games view. Stale team files from a previous run are removed.
const dir = path.join(root, 'data/shop');
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f));
for (const [id, items] of Object.entries(byTeam)) fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(items) + '\n');
const covered = Object.keys(byTeam).length;
console.error(`wrote data/shop/: ${kept} products across ${covered} of ${TEAMS.length} teams`);

if (args.includes('--commit')) {
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'inherit' });
  git('add', '-A', 'data/shop');
  try { execFileSync('git', ['diff', '--cached', '--quiet', '--', 'data/shop'], { cwd: root }); console.error('no change'); }
  catch { git('commit', '-m', `Refresh shop feed (${kept} products, ${covered} teams)`, '--', 'data/shop'); git('push'); }
}
