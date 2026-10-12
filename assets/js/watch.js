// "How do I watch this game?" for an out-of-market fan, from the TV labels ESPN lists for a game.
// Shared by the app (Games tab), the generated watch/ pages (tools/build-pages.mjs) and the game-day
// email (tools/digest/send.mjs), so all three always say the same thing. No DOM, no imports.
//
// howToWatch(league, tvLabels) -> { kind, label, tip }
//   kind: 'national' (on TV everywhere), 'cable' (national cable or conference network),
//         'stream' (streaming only), 'regional' (likely blacked out away from home), 'tba'
//   label: short badge text, e.g. "National: NBC" or "Regional: CBS"
//   tip:   one sentence on what to do about it

const BROADCAST = ['ABC', 'CBS', 'Fox', 'FOX', 'NBC', 'CW'];
const has = (tv, list) => tv.filter(x => list.some(l => x === l || x.toLowerCase() === l.toLowerCase()));
// First match in the order of `list` (our priority), not the order ESPN happens to list them.
const first = (tv, list) => { for (const l of list) { const hit = tv.find(x => x.toLowerCase() === l.toLowerCase()); if (hit) return hit; } };

const NFL_NATIONAL = ['ESPN', 'ABC', 'NBC', 'Prime Video', 'Netflix', 'NFL Net', 'NFL Network', 'YouTube', 'ESPN2'];
const CFB_CABLE = ['ESPN', 'ESPN2', 'ESPNU', 'FS1', 'FS2', 'CBSSN', 'USA Net', 'TNT', 'truTV', 'BTN', 'SEC Network', 'ACC Network', 'Big Ten Network', 'Pac-12 Network', 'ESPNEWS'];
const CFB_CONF = ['BTN', 'SEC Network', 'ACC Network', 'Big Ten Network', 'Pac-12 Network'];
const CFB_STREAM = ['ESPN+', 'Peacock', 'SECN+', 'ACCNX', 'MW+', 'B1G+', 'Paramount+', 'Prime Video', 'Max', 'FloSports', 'Big 12 Now', 'Disney+', 'Hulu'];
const NBA_NATIONAL = ['ESPN', 'ABC', 'NBC', 'Peacock', 'Prime Video', 'TNT', 'NBA TV'];
const MLB_NATIONAL = ['Fox', 'FOX', 'FS1', 'ESPN', 'TBS', 'truTV', 'NBC', 'Peacock', 'Apple TV', 'Apple TV+', 'Netflix', 'MLB Net', 'MLB Network', 'Roku'];
const NHL_NATIONAL = ['ESPN', 'ABC', 'TNT', 'truTV', 'Max', 'HBO Max', 'NHL Net', 'NHL Network'];
const NHL_STREAM = ['ESPN+', 'Hulu', 'Disney+'];

const nat = (on, tip) => ({ kind: 'national', label: `National: ${on}`, tip });
const tba = tip => ({ kind: 'tba', label: 'TV not set yet', tip });

export function howToWatch(lg, tvIn) {
  const tv = (tvIn || []).filter(Boolean);
  switch (lg) {
    case 'nfl': {
      const n = first(tv, NFL_NATIONAL);
      if (n) return nat(n, /Prime|Netflix|YouTube/.test(n)
        ? `Streams nationwide on ${n}. Most sports bars carry it.`
        : 'On national TV, so almost any sports bar will have it.');
      const r = first(tv, ['CBS', 'Fox', 'FOX']);
      if (r) return { kind: 'regional', label: `Regional: ${r}`, tip: `Your local ${r} station may show a different game. Bars with NFL Sunday Ticket have every game, so ask before you go.` };
      return tba('Out-of-market games need NFL Sunday Ticket at the bar.');
    }
    case 'cfb': {
      const b = first(tv, BROADCAST);
      if (b) return nat(b, 'On over-the-air TV nationwide, so any sports bar can show it.');
      const s = first(tv, CFB_STREAM), c = first(tv, CFB_CABLE);
      if (c) return { kind: 'cable', label: `Cable: ${c}`, tip: has(tv, CFB_CONF).length
        ? `${c} is in most sports bars. At home it is in many cable and live-TV streaming plans.`
        : `${c} is national cable, so most sports bars have it.` };
      if (s) return { kind: 'stream', label: `Streaming: ${s}`, tip: `Streaming only on ${s}. Ask the bar whether they can put it on before you go.` };
      return tba('College TV picks are usually announced 6 to 12 days before kickoff.');
    }
    case 'nba': {
      const n = first(tv, NBA_NATIONAL);
      if (n) return nat(n, 'On national TV, so most sports bars will have it.');
      return { kind: 'regional', label: tv[0] ? `Regional: ${tv[0]}` : 'Regional TV', tip: 'Out of the home market this is on NBA League Pass. Ask whether the bar carries it.' };
    }
    case 'mlb': {
      const n = first(tv, MLB_NATIONAL);
      if (n) return nat(n, 'On national TV, so most sports bars will have it.');
      return { kind: 'regional', label: tv[0] ? `Regional: ${tv[0]}` : 'Regional TV', tip: 'Out of the home market this is on MLB.TV and MLB Extra Innings. Ask whether the bar carries it.' };
    }
    case 'nhl': {
      const n = first(tv, NHL_NATIONAL);
      if (n) return nat(n, 'On national TV, so most sports bars will have it.');
      const s = first(tv, NHL_STREAM);
      const local = tv.filter(x => !NHL_STREAM.includes(x));
      if (s && !local.length) return { kind: 'stream', label: `Streaming: ${s}`, tip: `Streams nationwide on ${s}. Ask the bar whether they can put it on.` };
      if (s) return { kind: 'stream', label: 'Out of market: ESPN+', tip: 'Away from the home market it streams on ESPN+. Ask the bar whether they can put it on.' };
      return { kind: 'regional', label: tv[0] ? `Regional: ${tv[0]}` : 'Regional TV', tip: 'Regional TV in the home market. Elsewhere it usually streams on ESPN+.' };
    }
    case 'mls': {
      const n = first(tv, ['Fox', 'FOX', 'FS1']);
      if (n) return nat(n, 'On national TV, so most sports bars will have it.');
      return { kind: 'stream', label: 'Streaming: Apple TV', tip: 'Streams on Apple TV (MLS Season Pass). Ask the bar whether they can put it on.' };
    }
    default:
      return tv.length ? { kind: 'cable', label: tv.join(', '), tip: '' } : tba('');
  }
}

// Plain-language colour per kind, for badges. Same palette in app, pages and email.
export const WATCH_COLOR = { national: '#1f8a4c', cable: '#2563eb', stream: '#7c3aed', regional: '#c2410c', tba: '#6b7480' };

// "Add to Google Calendar" link for one game (no account or server needed; opens a prefilled event).
export function gcalUrl({ title, start, end, details = '', location = '' }) {
  const f = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(start)}/${f(end)}`, details, location }).toString();
}

// ESPN core API (CORS-enabled, tiny JSON) for live status and scores of one game.
export const CORE_PATH = { nfl: 'football/leagues/nfl', cfb: 'football/leagues/college-football', nba: 'basketball/leagues/nba', cbb: 'basketball/leagues/mens-college-basketball', mlb: 'baseball/leagues/mlb', nhl: 'hockey/leagues/nhl', mls: 'soccer/leagues/usa.1' };
