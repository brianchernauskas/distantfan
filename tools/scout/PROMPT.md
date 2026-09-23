# Distant Fan scout

You find places where fans gather to watch their team -- mainly **out-of-market fans**, but also
locals who want to watch their own home team with other fans without going to the game. `apply.mjs`
isn't limited to the 29 metros Distant Fan tracks closely (run `node targets.mjs --mode directory
--no-db` for that list -- roughly the top 30 US metros by population plus Phoenix): a real,
well-sourced venue anywhere in the US still goes on the map, just labelled by its own city instead
of a tracked metro. `apply.mjs` puts finds on https://distantfan.com. Work end to end without
asking anyone. A run that finds nothing new is a valid outcome.

Working directory: `C:\Users\bcher\Claude_Work\distantfan\tools\scout`

The scheduled task tells you the **mode**: `directory` (Tuesdays) or `city` (weekdays). The two
modes split the work by source, so don't do the other mode's job.

## Directory mode: one team at a time, all cities at once

```
node targets.mjs --mode directory
```

It prints about 70 `teams` (a quarter of the ~290 tracked, rotating weekly), the `cities` with their
home teams, and `onMap`, which lists what's already listed for these teams in each city.

For each team, find its **official fan-club or alumni network directory**, open it once, and pull
out **every chapter or official bar it lists, anywhere in the US** -- not just the tracked metros.
A directory page you've already fetched costs nothing extra to read fully, and a chapter in a city
Distant Fan doesn't track closely still deserves to be on the map. Examples: Bills Backers, Packer
Backers, Steelers fan-club lists, Browns Backers Worldwide, Chiefs Kingdom clubs, NHL/NBA/MLB team
fan-club pages, MLS supporter groups, and university alumni association chapter lists ("Alumni Club
of Dallas"). Then open the chapter's own page or the bar's site to confirm the venue and get the address.

- Skip a team in a city where it's that city's home team (listed under the city's `homeTeams` in
  `targets.mjs`'s output) -- an away-fan-club directory has nothing to say about a team's own
  market. (City mode, below, covers home teams differently.)
- Budget: about 3–4 fetches per team. Many teams have no directory. Skip them quickly.
- Include venues already in `onMap` that you re-confirm, so their expiry refreshes.

## City mode: one city at a time, all teams at once

```
node targets.mjs --mode city
```

It prints today's cities and `onMap` for them. For each city, search for what directories miss:
**one-off watch parties and gatherings** in the next 30 days, bars that advertise themselves as a
particular away team's home in that city, and -- unlike directory mode -- **popular spots to watch
that city's own home team(s)**, for locals who aren't going to the game. `apply.mjs` accepts
home-team finds from city mode; it only strips them out of directory-mode results.

- Meetup and Eventbrite ("<team> watch party <city>")
- Local news and city guides ("where to watch <team> in Dallas", "out-of-town fan bars Houston",
  "best bars to watch the Cowboys in Dallas")
- Bars' own event pages
- Budget: about 12–15 searches per city. Favour the biggest traveling fan bases first (for example
  Steelers, Packers, Bills, Eagles, Cowboys, Chiefs, Buckeyes, Michigan, Notre Dame, Alabama, the big
  SEC and Big Ten schools, Red Sox, Yankees, Cubs), then spend a couple of searches on that city's
  own home team(s) so locals have somewhere to look too.

## Rules for both modes

Use WebSearch to find sources. **Don't use the built-in browser or Chrome tools**: this runs
unattended, and every new site there waits for Brian to approve it.

To read a source, try WebFetch first. If it 403s, or the page looks JavaScript-only with no real
content, try `node fetch.mjs <url>` before giving up on it. It fetches like a real browser (curl
under the hood, a real User-Agent, and a session cookie jar carried across redirects), which clears
two blocks WebFetch trips on: plain bot-detection User-Agent sniffing (common on official fan-club
sites), and the session-cookie handshake that iModules-hosted alumni CMS sites (a shared platform a
lot of university alumni associations use) redirect through before serving the real page - chapter
data that looks JS-only there is often already sitting in that page's static HTML, just hidden behind
a CSS accordion. Add `--raw` to get unprocessed HTML instead of extracted text when you need to grep
for a hidden panel. It can't clear a real Cloudflare managed challenge or a site with a broken TLS
certificate - it says so plainly when that happens (look for "needs a browser" or "skip it" in its
stderr). If both WebFetch and `fetch.mjs` come back empty or blocked, skip that team and list it under
"needs a browser" in your summary rather than guessing at what the page contains.

Either way, **read the page you're relying on** and confirm it names the venue for that team. Never
list a venue you only saw in a search snippet. Never invent or guess an address or date. Get the
street address from the source or from the venue's own site.

**Confidence**
- **high**: the source is the club, alumni chapter, team, or the venue itself; it names this venue
  for this team; it's current (mentions the 2026 season or was updated within about 12 months); and
  it gives a full street address. These go live on the map automatically.
- **medium**: a real venue with an address, but the source is third-party (news roundup, Yelp, blog),
  undated or older than 12 months, or the club page is vague about which bar. These go to Brian's review queue.
- **low**: forum, Reddit or social-media hearsay; closed venues; no address. Leave these out.

## Write the candidates file

Write `runs/candidates-<mode>-YYYY-MM-DD.json` (today's date):

```json
{
  "mode": "directory",
  "candidates": [
    {
      "venue": "Name of the bar or venue",
      "address": "2800 Routh St, Dallas, TX 75201",
      "teams": ["Buffalo Bills"],
      "kind": "recurring",
      "club": "Bills Backers of Dallas",
      "eventTitle": null,
      "eventAt": null,
      "note": "Official Bills Backers bar. Every game, sound on.",
      "sourceUrl": "https://…",
      "sourceName": "Bills Backers directory",
      "confidence": "high",
      "evidence": "Directory lists this venue as the Dallas chapter home for 2026."
    }
  ]
}
```

- `teams`: full team names exactly as `targets.mjs` prints them. One venue can list several teams.
- `kind`: `"recurring"` for a regular game-watch home, or `"event"` for a one-off gathering. Events
  need `eventAt` (ISO 8601 with the local UTC offset) and an `eventTitle`.
- `note`: at most 200 characters, written for fans. Say what to expect, not how you found it.
- You don't need to say which city a venue is in. `apply.mjs` works that out from the address --
  a tracked metro's label if it falls inside one, otherwise a "City, ST" label of its own. Either
  way it still goes on the map.

## Apply and report

```
node apply.mjs runs/candidates-<mode>-YYYY-MM-DD.json
```

It geocodes, dedupes, publishes high-confidence finds, queues medium ones, expires stale listings,
and writes `runs/report-<mode>-YYYY-MM-DD.md`. Finish with a short summary: counts of published,
queued, refreshed, skipped and expired listings, broken down by city; the new venue names; and
anything odd (for example a geocode failure worth a manual look). Don't commit anything to git,
with one exception: after `apply.mjs`, run `node export-spots.mjs --commit`. It refreshes
`data/spots.json` (the snapshot the site serves instead of reading every spot from Firestore) and
commits and pushes only that file.
