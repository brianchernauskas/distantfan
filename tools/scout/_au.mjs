import fs from 'node:fs';
import { write, dec, fixAddr } from './_cand.mjs';
const rows = [];
for (const f of fs.readdirSync(process.env.TEMP + '/d').filter(x => /^au-.*\.txt$/.test(x))) {
  const L = fs.readFileSync(process.env.TEMP + '/d/' + f, 'utf8').split('\n').map(x => dec(x)).filter(Boolean);
  const st = f.slice(3, -4), url = `https://alumni.auburn.edu/project/${st}-watchparty/`;
  let club = '', cur = null, skip = false, started = false;
  for (const l of L) {
    if (/^2026-2027 Football Season/.test(l)) { started = true; continue; }
    if (!started) continue;
    if (/^Contact Us$/.test(l)) break;
    if (skip) { skip = false; if (cur) cur.games = l; continue; }
    if (/^Venue:/.test(l)) { cur = { venue: l.replace(/^Venue:\s*/, ''), club, sourceUrl: url }; rows.push(cur); continue; }
    if (/^Venue Address:/.test(l)) { if (cur) cur.address = l.replace(/^Venue Address:\s*/, ''); continue; }
    if (/^(Venue Website|Game Watch Contact|Stay in the loop|The best way)/.test(l)) continue;
    if (/^Games:/.test(l)) { skip = true; continue; }
    if (l.length < 80) club = l;
  }
}
const ok = rows.filter(r => r.venue && r.address && /\d/.test(r.address) && /[A-Z]{2}\.?,?\s+\d{5}/.test(r.address));
console.error('dropped', rows.length - ok.length, rows.filter(r => !ok.includes(r)).map(r => r.venue + '|' + r.address).slice(0, 10));
for (const r of ok) { r.address = fixAddr(r.address); r.note = `Official Auburn Alumni club game-watch spot${r.games ? ` (${r.games})` : ''}. Fans gather here.`; }
write('auburn', 'Auburn Tigers (Football)', ok.map(r => ({ ...r, club: r.club })), { sourceName: 'Auburn Alumni Association game watch parties (2026-2027 season)', confidence: 'high',
  evidence: 'Official Auburn Alumni Association state page for the 2026-2027 football season lists this venue with street address.' });
