// Upcoming games from ESPN's public schedule feed (CORS-enabled). Cached per team for 30 minutes.
import { TEAM_BY_ID } from './teams.js?v=202610150903';
import { CORE_PATH } from './watch.js?v=202610150903';

const PATH = { nfl: 'football/nfl', cfb: 'football/college-football', nba: 'basketball/nba', cbb: 'basketball/mens-college-basketball', mlb: 'baseball/mlb', nhl: 'hockey/nhl', mls: 'soccer/usa.1' };
const TTL = 30 * 60e3;
const mem = new Map();

export async function nextGames(teamId, n = 4) {
  const team = TEAM_BY_ID[teamId];
  if (!team) return [];
  const key = `df_sched_${teamId}`;
  let cached = mem.get(key);
  if (!cached) try { cached = JSON.parse(sessionStorage.getItem(key)); } catch {}
  if (!cached || Date.now() - cached.at > TTL) {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${PATH[team.lg]}/teams/${team.eid}/schedule`);
    if (!res.ok) throw new Error(`Schedule unavailable (${res.status})`);
    const j = await res.json();
    cached = { at: Date.now(), games: (j.events || []).map(e => parse(e, team)).filter(Boolean) };
    mem.set(key, cached);
    try { sessionStorage.setItem(key, JSON.stringify(cached)); } catch {}
  }
  const cutoff = Date.now() - 4 * 3.6e6; // keep a game that is in progress
  return cached.games.filter(g => g.time > cutoff).slice(0, n);
}

function parse(e, team) {
  const c = e.competitions?.[0];
  if (!c) return null;
  const us = c.competitors.find(x => x.team?.id === team.eid);
  const them = c.competitors.find(x => x.team?.id !== team.eid);
  if (!us || !them) return null;
  const tv = [...new Set((c.broadcasts || []).map(b => b.media?.shortName).filter(Boolean))];
  return {
    id: e.id,
    time: Date.parse(e.date),
    tbd: c.timeValid === false || e.timeValid === false,
    home: us.homeAway === 'home',
    neutral: !!c.neutralSite,
    oppId: them.team.id,
    opp: { name: them.team.displayName, short: them.team.shortDisplayName || them.team.abbreviation, logo: them.team.logos?.[0]?.href || them.team.logo || '' },
    venue: c.venue?.fullName || '',
    city: [c.venue?.address?.city, c.venue?.address?.state].filter(Boolean).join(', '),
    tv,
    name: e.shortName || e.name,
  };
}

// Live state of one game from ESPN's core API: three ~300-byte requests, cheap enough to poll each
// minute while a game is on (the scoreboard feeds are 250 KB to 1 MB).
export async function liveStatus(teamId, g) {
  const team = TEAM_BY_ID[teamId];
  if (!team || !CORE_PATH[team.lg]) return null;
  const base = `https://sports.core.api.espn.com/v2/sports/${CORE_PATH[team.lg]}/events/${g.id}/competitions/${g.id}`;
  const get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
  const [st, us, them] = await Promise.all([get(`${base}/status`), get(`${base}/competitors/${team.eid}/score`), g.oppId ? get(`${base}/competitors/${g.oppId}/score`) : null]);
  if (!st?.type) return null;
  return { state: st.type.state, detail: st.type.shortDetail || st.type.detail || '', us: us?.displayValue ?? '', them: them?.displayValue ?? '' };
}
