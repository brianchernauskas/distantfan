// Upcoming games from ESPN's public schedule feed (CORS-enabled). Cached per team for 30 minutes.
import { TEAM_BY_ID } from './teams.js?v=202609221130';

const PATH = { nfl: 'football/nfl', cfb: 'football/college-football', nba: 'basketball/nba', mlb: 'baseball/mlb', nhl: 'hockey/nhl', mls: 'soccer/usa.1' };
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
    opp: { name: them.team.displayName, short: them.team.shortDisplayName || them.team.abbreviation, logo: them.team.logos?.[0]?.href || them.team.logo || '' },
    venue: c.venue?.fullName || '',
    city: [c.venue?.address?.city, c.venue?.address?.state].filter(Boolean).join(', '),
    tv,
    name: e.shortName || e.name,
  };
}
