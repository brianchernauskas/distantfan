import fs from 'node:fs';
import { write, dec } from 'file:///C:/Users/bcher/AppData/Local/Temp/claude/C--Users-bcher-Claude-Work/0eea10c1-5fc3-4aa1-8211-9f814499e8fd/scratchpad/cand.mjs';
const D = process.env.TEMP + '/d/ore/';
const rows = [];
for (const f of fs.readdirSync(D).filter(x => /^2026-.*\.txt$/.test(x))) {
  const L = fs.readFileSync(D + f, 'utf8').split('\n').map(dec).filter(Boolean);
  const i = L.findIndex(l => l === 'Location'); if (i < 0) { console.error('no loc', f); continue; }
  const blk = []; for (let j = i + 1; j < L.length && !/^(About our venue|Questions\?|Parking|2026 Football|Add Next)/i.test(L[j]) && blk.length < 5; j++) blk.push(L[j]);
  const zipIdx = blk.findIndex(l => /[,. ]\s*[A-Z]{2}\s+\d{5}/.test(l));
  const season = L.some(l => /2026/.test(l) && /(football|season|kickoff)/i.test(l));
  if (zipIdx < 1) { console.error('skip', f, blk); continue; }
  const venue = blk[0].replace(/\s*\(.*?\)\s*$/, ''), addr = blk.slice(1, zipIdx + 1).join(', ').replace(/,\s*,/g, ',').replace(/([A-Za-z])[. ]\s*([A-Z]{2}) (\d{5})/, '$1, $2 $3');
  const chapter = (L.find(l => /Ducks Watch Party/i.test(l)) || f).replace(/\s*Watch Party.*/i, '').trim();
  rows.push({ venue, address: addr, club: `UO Alumni ${chapter}`, sourceUrl: `https://www.uoalumni.com/event/athletic/2026/${f.slice(5, -4)}`, season });
  console.error(season ? 'S26' : 'no26', f, '|', venue, '|', addr);
}
write('oregon', 'Oregon Ducks (Football)', rows, { sourceName: 'University of Oregon Alumni Association football watch parties', confidence: 'high', noteLead: 'Official UO Alumni Association chapter watch party.',
  evidence: 'Official UOAA 2026 chapter watch-party page lists this venue with street address.' });
