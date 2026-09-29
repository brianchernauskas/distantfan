// Tell IndexNow (Bing, Yandex, Seznam, Naver) about new or changed URLs from sitemap.xml.
//
//   node tools/indexnow.mjs            submit URLs that are new or have a newer <lastmod> than last time
//   node tools/indexnow.mjs --dry-run  print what would be sent, change nothing
//   node tools/indexnow.mjs --seed f   mark the URLs listed in file f (one per line) as already sent
//   node tools/indexnow.mjs --commit   ...then commit + push data/indexnow.json (export-spots does this itself)
//
// The key is public by design: IndexNow verifies it by fetching https://distantfan.com/<key>.txt, so
// that file must be live (pushed) before the first submit. State lives in data/indexnow.json
// ({url: lastmod}) so each run only sends the delta. Call this AFTER the site is pushed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'distantfan.com';
const KEY = 'b42ef8e2865f47231dbac02984984f4e';
const statePath = path.join(root, 'data/indexnow.json');
const args = process.argv.slice(2);

const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const current = {};
for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) current[m[1]] = m[2];

const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const save = () => fs.writeFileSync(statePath, JSON.stringify(Object.fromEntries(Object.entries(state).sort()), null, 1) + '\n');

if (args.includes('--seed')) {
  const urls = fs.readFileSync(args[args.indexOf('--seed') + 1], 'utf8').split(/\s+/).filter(Boolean);
  for (const u of urls) if (current[u]) state[u] = current[u];
  save();
  console.error(`seeded ${urls.length} urls`);
  process.exit(0);
}

const todo = Object.keys(current).filter(u => state[u] !== current[u]);
console.error(`indexnow: ${todo.length} new/changed of ${Object.keys(current).length} urls`);
if (!todo.length || args.includes('--dry-run')) {
  if (args.includes('--dry-run')) console.error(todo.join('\n'));
  process.exit(0);
}

// The pages must be served before crawlers are pinged; Pages takes a minute or two after a push.
const probe = todo[0];
for (let i = 0; i < 18; i++) {
  const r = await fetch(probe, { method: 'HEAD', redirect: 'follow' }).catch(() => null);
  if (r?.ok) break;
  if (i === 17) { console.error(`indexnow: ${probe} not live yet, try again later`); process.exit(1); }
  await new Promise(r => setTimeout(r, 10000));
}

// One POST reaches every IndexNow engine; up to 10,000 urls per request.
for (let i = 0; i < todo.length; i += 10000) {
  const batch = todo.slice(i, i + 10000);
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: batch }),
  });
  if (res.status !== 200 && res.status !== 202) {
    console.error(`indexnow: HTTP ${res.status} ${await res.text()}`);
    save(); // keep what earlier batches sent
    process.exit(1);
  }
  for (const u of batch) state[u] = current[u];
  console.error(`indexnow: sent ${batch.length} (HTTP ${res.status})`);
}
save();

if (args.includes('--commit')) {
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'inherit' });
  git('add', '--', 'data/indexnow.json');
  git('commit', '-m', `IndexNow: record ${todo.length} submitted urls`, '--', 'data/indexnow.json');
  git('push');
}
