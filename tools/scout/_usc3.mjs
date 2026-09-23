import fs from 'node:fs';
const f = 'runs/candidates-top20-usc-med-2026-09-23.json';
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
const drop = /^(Anchor Bar|Backyards Patio|Elwood Club|Enzo's BBQ|Mother.s Comfort|Mr\. Mojito|On the Kirb|Peking Tavern|SOS Bar|The Fourth Bore|Theory)/;
const before = j.candidates.length;
j.candidates = j.candidates.filter(c => !drop.test(c.venue));
fs.writeFileSync(f, JSON.stringify(j, null, 1));
console.log(before, '->', j.candidates.length);
