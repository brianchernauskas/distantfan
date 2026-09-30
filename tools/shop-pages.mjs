// Import harvested Fanatics team-shop links into data/shop-pages.json.
//
//   node tools/shop-pages.mjs --clipboard     read the JSON the harvest snippet copied (see tools/harvest-team-pages.js)
//   node tools/shop-pages.mjs links.json      ...or read it from a file ({ "nfl-ari": "/nfl/arizona-cardinals/o-...+z-...", ... })
//   node tools/shop-pages.mjs --status        show how old the current links are
//
// Each run REPLACES the whole set and stamps it with today's time: a team missing from the new harvest loses its
// team-page link and its card falls back to the Fanatics search link, rather than keeping a link of unknown age.
// Then run `node tools/shop-feed.mjs --commit` to write the links into the per-team files and push.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data/shop-pages.json');
const args = process.argv.slice(2);

if (args.includes('--status')) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const age = (Date.now() - Date.parse(d.harvestedAt)) / 864e5;
  console.log(`${Object.keys(d.pages).length} team-page links, harvested ${d.harvestedAt} (${age.toFixed(1)} days ago)`);
  process.exit(0);
}

let raw;
if (args.includes('--clipboard')) raw = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', maxBuffer: 1 << 26 });
else if (args[0]) raw = fs.readFileSync(args[0], 'utf8');
else { console.error('Usage: node tools/shop-pages.mjs --clipboard | <file.json> | --status'); process.exit(1); }

let input;
try { input = JSON.parse(raw.trim()); } catch { console.error('Input is not JSON. Did the copy(JSON.stringify(window.__pages)) step run?'); process.exit(1); }

const known = new Set(fs.readdirSync(path.join(root, 'data/shop')).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => f.slice(0, -5)));
const shape = /^\/[a-z0-9-]+\/[a-z0-9-]+\/o-\d+\+t-\d+\+z-[\w-]+$/;
const pages = {}, rejected = [];
for (const [id, p] of Object.entries(input).sort(([a], [b]) => (a < b ? -1 : 1))) {
  if (known.has(id) && typeof p === 'string' && shape.test(p)) pages[id] = p; else rejected.push(id);
}
// A harvest that found almost nothing is a failed harvest; do not wipe the good links with it.
if (Object.keys(pages).length < 100) { console.error(`Only ${Object.keys(pages).length} valid links (rejected ${rejected.length}). Not writing; re-run the harvest.`); process.exit(1); }

const out = { harvestedAt: new Date().toISOString(), pages };
fs.writeFileSync(file, '{\n"harvestedAt":' + JSON.stringify(out.harvestedAt) + ',\n"pages":{\n' + Object.entries(pages).map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v)).join(',\n') + '\n}\n}\n');
console.error(`wrote data/shop-pages.json: ${Object.keys(pages).length} links${rejected.length ? `, rejected ${rejected.length}: ${rejected.join(', ')}` : ''}, stamped ${out.harvestedAt}`);
console.error('Next: node tools/shop-feed.mjs --commit');
