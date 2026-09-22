# Distant Fan scout: weekly watch-party research

You find places in the **Phoenix metro** where out-of-market fans gather to watch their team,
and hand them to `apply.mjs`, which puts them on https://distantfan.com. Work end to end without
asking anyone. A run that finds nothing new is a valid outcome.

Working directory: `C:\Users\bcher\Claude_Work\distantfan\tools\scout`

## 1. Get this week's targets

```
node targets.mjs
```

It prints `teams` (about a quarter of the ~215 tracked teams; the rest rotate through on other weeks)
and `onMap`, which lists what is already on the map in the Phoenix area. Venues already on the map
with `source: "scout"` only need re-confirming. Look for the current season, then list them again so
their expiry refreshes.

If it fails because the admin key is missing, stop and report that. Don't research without being able to apply.

## 2. Research

For each target team, look for **recurring game-watch homes** and **one-off gatherings** in the
Phoenix metro (Phoenix, Scottsdale, Tempe, Mesa, Chandler, Gilbert, Glendale, Peoria, Surprise,
Goodyear, Avondale, Queen Creek, Cave Creek, Fountain Hills, Buckeye, Maricopa, Casa Grande).

Where these usually live, best first:
- Official fan-club networks: team-sanctioned backer or booster directories (e.g. Bills Backers,
  Packer Backers, Steelers fan clubs, Browns Backers Worldwide, Chiefs Kingdom clubs), MLS supporter groups
- University alumni association chapter pages ("<School> Alumni Club of Phoenix / Arizona") and their game-watch pages
- The venue's own site or events page ("Home of the Phoenix <Team> fans")
- Meetup and Eventbrite event pages
- Local news or "where to watch <team> in Phoenix" roundups (lower confidence; see below)

Use WebSearch, then **WebFetch the page you're relying on** and confirm it names the venue for this
team. Never list a venue you only saw in a search snippet, and never invent or guess an address.
Get the street address from the source, or from the venue's own site.

Budget: about 2–3 searches per team. Skip a team fast if nothing turns up; many won't have anything.

## 3. Confidence

- **high**: the source is the club, alumni chapter, team, or the venue itself; it names this venue
  for this team; it's current (mentions the 2026 season, or was updated within about 12 months); and
  you have a full street address. These go live on the map automatically.
- **medium**: a real venue with an address, but the source is third-party (news roundup, Yelp,
  a blog), undated or older than 12 months, or the club page is vague about which bar. These go to
  Brian's review queue.
- **low**: forum/Reddit/social hearsay, closed or "temporarily closed" venues, no address. Leave these out.

## 4. Write the candidates file

Write `runs/candidates-YYYY-MM-DD.json` (today's date):

```json
{
  "area": "phoenix",
  "candidates": [
    {
      "venue": "Name of the bar or venue",
      "address": "1234 E Camelback Rd, Phoenix, AZ 85014",
      "teams": ["Buffalo Bills"],
      "kind": "recurring",
      "club": "Bills Backers of Phoenix",
      "eventTitle": null,
      "eventAt": null,
      "note": "Official Bills Backers bar. Every game, sound on.",
      "sourceUrl": "https://…",
      "sourceName": "Bills Backers directory",
      "confidence": "high",
      "evidence": "Directory lists this venue as the Phoenix chapter home for 2026."
    }
  ]
}
```

- `teams`: full team names exactly as `targets.mjs` prints them. One venue can list several teams.
- `kind`: `"recurring"` for a regular game-watch home, or `"event"` for a one-off gathering. Events
  need `eventAt` (ISO 8601 with offset, Arizona is UTC−07:00 year-round) and an `eventTitle`.
- `note`: at most 200 characters, written for fans. Say what to expect (sound on, which games, which room), not how you found it.
- Include re-confirmed venues from `onMap` as normal candidates so their expiry refreshes.

## 5. Apply and report

```
node apply.mjs runs/candidates-YYYY-MM-DD.json
```

It geocodes, dedupes, publishes the high-confidence finds, queues the medium ones, expires stale
listings, and writes `runs/report-YYYY-MM-DD.md`. Finish with a short summary: how many published,
queued, refreshed, skipped and expired, the new venues by name, and anything odd (for example a
geocode failure worth a manual look). Don't commit anything to git.
