// Cache each team's upcoming games so build-pages.mjs can print them as static, crawlable HTML.
//
//   node tools/fetch-schedules.mjs             refresh data/schedules.json for every team that has a spot
//   node tools/fetch-schedules.mjs --commit    ...then rebuild watch/, commit and push, ping IndexNow
//
// Source is ESPN's public team schedule endpoint (the same one the app uses). Output per team:
//   rec, stand   record and standing text ("2-2", "3rd in NFC North")
//   last         most recent final: { t, opp, home, us, them }
//   games        next 8 games: { t (ISO), tbd, home, opp, oppId, venue, tv[], wk }
//   changed      YYYY-MM-DD the games list last changed; build-pages uses it as <lastmod>, so a
//                page only looks "updated" to search engines when its schedule really moved.
// The file is byte-stable when nothing changed (fetchedAt only moves when a team's data does).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TEAM_BY_ID } from '../assets/js/teams.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'data/schedules.json');
const ESPN_PATH = { nfl: 'football/nfl', cfb: 'football/college-football', nba: 'basketball/nba', cbb: 'basketball/mens-college-basketball', mlb: 'baseball/mlb', nhl: 'hockey/nhl', mls: 'soccer/usa.1' };
const KEEP = 8;

const { spots } = JSON.parse(fs.readFileSync(path.join(root, 'data/spots.json'), 'utf8'));
const ids = [...new Set(spots.flatMap(s => s.teams || []))].filter(id => TEAM_BY_ID[id] && ESPN_PATH[TEAM_BY_ID[id].lg]).sort();

const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { teams: {} };
const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const next = {};
let failed = 0;

async function one(id) {
  const t = TEAM_BY_ID[id];
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_PATH[t.lg]}/teams/${t.eid}/schedule`);
  if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
  const j = await r.json();
  const games = [];
  let last = null;
  for (const e of j.events || []) {
    const c = e.competitions?.[0];
    const us = c?.competitors?.find(x => x.team?.id === t.eid), them = c?.competitors?.find(x => x.team?.id !== t.eid);
    if (!us || !them) continue;
    const ts = Date.parse(e.date);
    if (!Number.isFinite(ts)) continue;
    const final = c.status?.type?.completed || e.status?.type?.completed;
    if (final) {
      const sc = x => x.score?.displayValue ?? x.score?.value ?? x.score;
      if (!last || ts > last.ts) last = { ts, t: new Date(ts).toISOString(), opp: them.team.displayName, home: us.homeAway === 'home', us: sc(us), them: sc(them) };
      continue;
    }
    if (ts < now - 4 * 3.6e6) continue;
    const v = c.venue;
    games.push({
      t: new Date(ts).toISOString(), tbd: c.timeValid === false || e.timeValid === false,
      home: us.homeAway === 'home', opp: them.team.displayName, oppId: them.team.id,
      venue: v?.fullName ? [v.fullName, v.address?.city, v.address?.state].filter(Boolean).join(', ') : '',
      tv: [...new Set((c.broadcasts || []).map(b => b.media?.shortName).filter(Boolean))],
      wk: e.week?.text || '',
    });
  }
  games.sort((a, b) => a.t.localeCompare(b.t));
  if (last) delete last.ts;
  return { rec: j.team?.recordSummary || '', stand: j.team?.standingSummary || '', ...(last && last.us != null ? { last } : {}), games: games.slice(0, KEEP) };
}

const queue = [...ids];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let id; (id = queue.shift());) {
    try {
      const d = await one(id);
      const old = prev.teams?.[id];
      const same = old && JSON.stringify({ ...old, changed: undefined }) === JSON.stringify({ ...d, changed: undefined });
      next[id] = { ...d, changed: same ? old.changed : today };
    } catch (e) {
      failed++;
      console.error(String(e.message || e));
      if (prev.teams?.[id]) next[id] = prev.teams[id];   // keep the last good copy
    }
  }
}));

const teams = Object.fromEntries(Object.keys(next).sort().map(k => [k, next[k]]));
const moved = JSON.stringify(prev.teams) !== JSON.stringify(teams);
const withGames = Object.values(teams).filter(t => t.games.length).length;
console.error(`schedules: ${Object.keys(teams).length} teams (${withGames} with upcoming games), ${failed} failed, ${moved ? 'changed' : 'unchanged'}`);
if (moved) fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date(now).toISOString(), teams }));

if (moved && process.argv.includes('--commit')) {
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(root, 'tools/build-pages.mjs')], { cwd: root, stdio: 'inherit' });
  const files = ['data/schedules.json', 'watch', 'sitemap.xml'];
  git('add', '--all', '--', ...files);
  git('commit', '-m', `Refresh team schedules (${withGames} teams with upcoming games)`, '--', ...files);
  git('push');
  try { execFileSync(process.execPath, [path.join(root, 'tools/indexnow.mjs'), '--commit'], { cwd: root, stdio: 'inherit' }); }
  catch { console.error('indexnow step failed; run node tools/indexnow.mjs --commit later'); }
}
