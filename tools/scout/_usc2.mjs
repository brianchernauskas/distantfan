import fs from 'node:fs';
import { write } from './_cand.mjs';
const T = process.env.TEMP + '/d/';
const venues = JSON.parse(fs.readFileSync(T + 'usc.json', 'utf8'));
const norm = s => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|bar|grill|pub|and|restaurant|sports|tavern)\b/g, ' ').replace(/\s+/g, ' ').trim();
const hi = [], med = [], fail = [];
for (const v of venues) {
  await new Promise(r => setTimeout(r, 1100));
  let j;
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${v.lat}&lon=${v.lng}&zoom=18&addressdetails=1&namedetails=1`;
    j = await (await fetch(u, { headers: { 'User-Agent': 'distantfan-scout/1.0 (https://distantfan.com)' } })).json();
  } catch (e) { fail.push(v.name + ' fetch'); continue; }
  const a = j.address || {};
  if (!a.house_number || !a.road) { fail.push(`${v.name} (${v.city}) no street: ${j.display_name}`); continue; }
  const st = (a['ISO3166-2-lvl4'] || '').replace('US-', '');
  const city = a.city || a.town || a.village || a.suburb || a.hamlet || v.city.split(',')[0];
  const address = `${a.house_number} ${a.road}, ${city}, ${st} ${a.postcode || ''}`.trim();
  const names = [j.name, ...Object.values(j.namedetails || {})].filter(Boolean).map(norm);
  const vn = norm(v.name);
  const match = names.some(n => n && vn && (n.includes(vn) || vn.includes(n)));
  const row = { venue: v.name, address, lat: v.lat, lng: v.lng, club: 'USC Alumni Association game watch', note: `Official USC Alumni Association game-watch location (${v.n} listed events this season). Trojans gather here.` };
  (match ? hi : med).push(row);
  console.error(match ? 'HI ' : 'MED', v.name, '|', address, '|', j.name);
}
console.error('failed', fail);
const meta = { sourceUrl: 'https://alumni.usc.edu/game-watch/map/', sourceName: 'USC Alumni Association game watch map' };
write('usc-hi', 'USC Trojans (Football)', hi, { ...meta, confidence: 'high', noteLead: '', evidence: 'Official USC Alumni Association 2026 game-watch map lists this venue with coordinates; OpenStreetMap reverse lookup at those coordinates returns the same venue name and street address.' });
write('usc-med', 'USC Trojans (Football)', med, { ...meta, confidence: 'medium', noteLead: '', evidence: 'Official USC Alumni Association 2026 game-watch map lists this venue with coordinates; street address comes from an OpenStreetMap reverse lookup at those coordinates and the venue name did not match OSM, so please verify.' });
