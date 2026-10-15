# Demand-gap sweep (off-peak routine)

Scheduled task `distantfan-demand-gaps`, nightly. Edit this file, not the task.

Goal: add real watch spots where fans are most likely searching and the site has nothing (0 spots)
or a thin page (1-2 spots). Every venue added creates or strengthens a team x city page, and those
pages are where Google traffic lands. `demand-gaps.mjs` ranks the pairs by search demand (Search
Console queries once that API is on), GA4 page sessions, fan-base size, metro size and Sun Belt
transplant flow, and skips pairs searched recently by this routine or the nightly NFL gap pass.

Working directory: `C:\Users\bcher\Claude_Work\distantfan\tools\scout`. Follow the shared
**Rules for both modes**, **Confidence**, **Write the candidates file** and **Apply and report**
sections of `PROMPT.md` exactly (pre-approved command forms only, no browser tools, read every page
you rely on, never invent venues or addresses, college teams as `"<Name> (Football)"`), with the
differences below.

## Steps

1. `node targets.mjs --mode city --cities phx --no-db` (only to pull the latest code and inbox; ignore its output).
2. `node demand-gaps.mjs next 10` -> JSON array of `{pair, metro, metroLabel, team, teamName, have, why}`.
   `have` is how many spots that team already has in that metro. If the array is empty, stop.
3. For each pair, spend about 5-6 searches, in this order, and stop the pair once you have two
   solid venues (or three for a pair that already has spots):
   1. **Official lists**: the team's own bar network or fan-club directory, the NFL team's official
      "backers"/"nation" chapters, or the university alumni association's game-watch chapter for that
      metro. A current official list with a street address is **high**.
   2. **The club itself**: the local booster club or alumni chapter's own website or Linktree naming
      its game-watch bar this season (high when current with a full address).
   3. **The venue itself**: a bar's own site or events page calling itself the home of that team's
      fans ("official Steelers bar", "Badgers watch parties every Saturday") with its address (high).
   4. **Third-party**: local news or city-guide roundups ("where to watch the Bears in Houston"),
      or Yelp per PROMPT.md (medium only).
   Facebook and Instagram pages are not readable here: if a search snippet points to a club that
   only lives on social media, record the pair as `stale` with a note naming the club page so the
   nightly gap pass (which reads social pages) can pick it up. Never list a venue from a snippet.
4. Write all finds to `runs/candidates-demand-YYYY-MM-DD.json` with `"mode": "demand"`. Put only the
   pair's team in `teams`, spelled exactly as `teamName`. Note each venue's metro is decided by
   `apply.mjs` from the address; a venue outside the pair's metro is still fine to list if the source
   names it for that metro's fans, but do not count it as a find for the pair.
5. Before applying, `node apply.mjs runs/candidates-demand-YYYY-MM-DD.json --dry-run` and read the
   report. A candidate listed under "refreshed" matched a venue already on the map, and applying it
   adds the team to that live spot whatever its confidence, and replaces the spot's `note` and `club`.
   So for each refreshed candidate: if it is **medium**, remove it from the file and list it in the
   summary under "needs a manual team link" (venue, address, team, source); if it is **high**, keep it
   but set its `note` and `club` to `""` so the existing text stays. Rerun the dry run after editing.
6. `node apply.mjs runs/candidates-demand-YYYY-MM-DD.json`, then `node apply.mjs --inbox`.
7. Record every pair you worked: `node demand-gaps.mjs done <pair> <found|none|stale|skipped> <short_note_with_underscores>`.
   `found` = at least one venue published or queued for it; `stale` = a club exists but names no
   current venue, or only on social media; `none` = nothing found; `skipped` = blocked or out of time.
8. If anything was published or queued, `node export-spots.mjs --commit` (rebuilds the watch pages,
   commits and pushes only the snapshot and page files, then pings IndexNow).

## Summary

Finish with: pairs worked with outcome each, venues published (venue, address, team, metro, source),
venues queued for review, "needs a manual team link" items, social-only clubs handed to the gap pass,
`node demand-gaps.mjs status`, and any blocks. If anything was queued, remind Brian to review it at
https://distantfan.com/app.html#review.
