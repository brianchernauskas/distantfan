import fs from 'node:fs';
import { tds, fixAddr, write, dec } from './_cand.mjs';
const h = fs.readFileSync(process.env.TEMP + '/d/al.html', 'utf8');
let chapter = '', rows = [];
for (const m of h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const c = tds(m[1]); if (c.length !== 3) continue;
  if (c[0]) chapter = c[0];
  const venue = c[1], addr = c[2];
  if (!venue || !/\d{5}/.test(addr)) { console.error('skip', c); continue; }
  rows.push({ venue, address: fixAddr(addr), club: chapter && `Alabama Alumni ${chapter}` });
}
write('alabama', 'Alabama Crimson Tide (Football)', rows, { sourceUrl: 'https://alumni.ua.edu/blog/2025/08/22/2025-chapter-watch-party-locations/', sourceName: 'Alabama National Alumni Association watch party locations', confidence: 'medium',
  noteLead: 'Official Alabama alumni chapter watch spot.', evidence: 'Official UA National Alumni Association chapter list with street addresses, but it is the 2025-season page (posted 2025-08-22); no 2026 edition found.' });
