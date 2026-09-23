import fs from 'node:fs';
import { write, dec } from './_cand.mjs';
const T = process.env.TEMP + '/d/';
const lines = f => fs.readFileSync(T + f, 'utf8').split('\n').map(dec).filter(Boolean);

// LSU: "City, ST" header lines then "Venue, address" / "Venue; address" lines
{
  const L = lines('lsu.txt'); const s = L.findIndex(l => /^Atlanta, GA$/.test(l)), e = L.findIndex(l => /^3838 W Lakeshore/.test(l));
  let city = '', rows = [];
  for (const l of L.slice(s, e)) {
    if (/^[A-Za-z .\/()'-]+,\s*[A-Z]{2}$/.test(l) && !/\d/.test(l)) { city = l; continue; }
    if (/^Residential/i.test(l)) continue;
    const m = l.match(/^(.*?)[,;]\s*(\d.*)$/); if (!m) { console.error('lsu skip', l); continue; }
    let addr = m[2].replace(/\s*\(.*?\)\s*$/, '').replace(/[;]/g, ',');
    const st = city.match(/,\s*([A-Z]{2})$/)?.[1];
    if (!/\b[A-Z]{2}\b|Texas|Arizona/.test(addr)) addr += `, ${city}`;
    rows.push({ venue: m[1].replace(/^(.*?) \(Preston-Hollow\)$/, '$1').trim(), address: addr, club: `LSU Alumni ${city.replace(/,.*/, '')} chapter` });
    console.error('lsu', rows.at(-1).venue, '|', rows.at(-1).address);
  }
  write('lsu', 'LSU Tigers (Football)', rows, { sourceUrl: 'https://www.lsualumni.org/watchparties', sourceName: 'LSU Alumni Association chapter watch parties', confidence: 'medium',
    noteLead: 'Official LSU Alumni chapter football watch party spot.', evidence: 'Official LSU Alumni Association chapter watch party list with street addresses, but the page title reads "Watch Parties 2025" and nothing on it names the 2026 season.' });
}
// Texas A&M: blocks of title, venue, street, "City, ST zip", dates..., state
{
  const L = lines('tam.txt'); const s = L.findIndex(l => /^All Game Watching Parties$/.test(l));
  const rows = [];
  for (let i = s; i < L.length - 4; i++) {
    const city = L[i + 3];
    if (/^[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}$/.test(city) && !/^[A-Z]{3} \d/.test(L[i + 2]) && /\d/.test(L[i + 2])) {
      const dates = []; for (let j = i + 4; j < L.length && /^[A-Z]{3} \d+$/.test(L[j]); j++) dates.push(L[j]);
      rows.push({ venue: L[i + 1], address: `${L[i + 2]}, ${city}`, club: L[i], note: `Texas A&M club game-watch: ${L[i]}. ${dates.length ? `Next: ${dates.slice(0, 4).join(', ')}.` : ''}`.slice(0, 200) });
      i += 3;
    }
  }
  console.error('tam rows', rows.length, rows.map(r => r.venue + ' | ' + r.address).join('\n'));
  write('tamu', 'Texas A&M Aggies (Football)', rows, { sourceUrl: 'https://www.aggienetwork.com/gameday/watchparties/', sourceName: 'Texas A&M Association of Former Students game watching parties', confidence: 'high',
    noteLead: 'Aggie club game-watch spot.', evidence: 'Official Aggie Network page listing 2026-season game watching parties with dates and street addresses.' });
}
