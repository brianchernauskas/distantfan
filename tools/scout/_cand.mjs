// Scratch helpers for the top-20 sweep: entity decoding, address cleanup, candidate file writer.
import fs from 'node:fs';
export const dec = s => String(s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&#0*39;|&#8217;|&#x27;|&apos;|’/g, "'").replace(/&#8211;|&ndash;|–/g, '-').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&nbsp;|&#160;| /g, ' ').replace(/&#0*(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();
export const tds = row => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => dec(m[1]));
export const fixAddr = a => dec(a).replace(/\s*[•·]\s*/g, ', ').replace(/,\s*,/g, ',').replace(/\b([A-Za-z]{2}),?\s+(\d{5})/, (m, s, z) => `${s.toUpperCase()} ${z}`);
export function write(name, teamName, rows, meta) {
  const seen = new Set(), candidates = [];
  for (const r of rows) {
    const k = (r.venue + r.address).toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    candidates.push({ venue: r.venue, address: r.address, teams: [teamName], kind: 'recurring', club: r.club || meta.clubDefault || '',
      eventTitle: null, eventAt: null,
      note: (r.note || `${meta.noteLead} Fans gather here for games.`).slice(0, 200),
      sourceUrl: r.sourceUrl || meta.sourceUrl, sourceName: meta.sourceName, confidence: meta.confidence, evidence: meta.evidence });
  }
  const f = `runs/candidates-top20-${name}-2026-09-23.json`;
  fs.writeFileSync(f, JSON.stringify({ mode: 'directory', candidates }, null, 1));
  console.log(f, candidates.length);
}
