import fs from 'node:fs';
const T = process.env.TEMP + '/d/';
const h = fs.readFileSync(T + 'uscmap.html', 'utf8');
const rx = /\{"id":(\d+),"name":"((?:[^"\\]|\\.)*)","city":"([^"]*)","lat":([-\d.]+),"lng":([-\d.]+),"region":"([^"]*)"\}/g;
const arr = [...h.matchAll(rx)].map(m => ({ id: +m[1], name: JSON.parse('"' + m[2] + '"'), city: m[3], lat: +m[4], lng: +m[5], region: m[6] }));
const u = new Map();
for (const a of arr) { const k = a.name + '|' + a.city; if (!u.has(k)) u.set(k, { ...a, n: 0 }); u.get(k).n++; }
console.log(arr.length, 'events', u.size, 'venues');
fs.writeFileSync(T + 'usc.json', JSON.stringify([...u.values()]));
console.log([...u.values()].slice(0, 6));
