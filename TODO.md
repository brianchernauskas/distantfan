# Distant Fan — Backlog

Working list of changes, roughly ordered so the earlier items unblock or de-risk the later
ones. Check items off as they land; add new ones at the bottom of whichever phase fits.
When picking up this file cold, work top to bottom unless told otherwise.

## Phase 1 — Foundation (touches core data model / privacy)

- [x] **Tighten viewer radius to 10 miles (from 25) and re-document why anonymity matters.**
      Done: stored geohash precision went from 4→5 chars (~25mi cell → ~3mi cell, the closest
      geohash step available), and the separate "near you" surfacing radius (`NEAR_KM` in
      `app.js`) went from ~50mi to 10mi. README's "Privacy model" section now explains the
      anonymity tradeoff, not just the mechanism. Note: this is a real reduction in location
      anonymity (3mi cells can point at a specific neighborhood), accepted deliberately after
      discussion — see the README note if it ever needs revisiting. Also required updating
      `firestore.rules` (the enforced storage-precision ceiling) alongside `config.js`.
- [x] **Reopen the app to local (non-away) teams.** Turned out to be a positioning problem, not a
      code one: nothing in `store.js`/`app.js`/`firestore.rules` ever restricted team selection to
      out-of-market fans — anyone could already follow their local team. The landing page copy
      (`index.html`) was the only thing saying otherwise ("For out-of-market fans," "You moved
      away"). Broadened the eyebrow tag, meta description, and added an explicit line for locals
      ("find a bar for the away games, or for when you just don't feel like fighting stadium
      traffic"). Also fixed two stale "25 miles" / "40 miles" copy references left over from item 1's
      3-mile/10-mile change.

## Phase 2 — Content & coverage

- [x] Research Arizona Wildcats football, KC Chiefs, and Kansas Jayhawks football venues/bars for
      the greater Phoenix area. Found: **Dirtbag's Phoenix** (Wildcats, official PhoenixCats/Arizona
      Alumni hangout, high confidence) and **Pub Rock Live** (Chiefs, self-declared "Home of AZ
      Chiefs Kingdom," high confidence). Jayhawks lead is weak: **The Hub Grill & Bar** is only
      confirmed via a one-off July 2024 KU Alumni happy hour, not a standing gameday venue (medium
      confidence) -- worth a fresher look later. Also fixed a real bug found along the way: the
      scout tool's Phoenix config (`tools/scout/lib.mjs`) was wrongly treating Arizona Wildcats as
      a Phoenix "home team" (they play in Tucson, ~110mi away), so the automated weekly scout was
      skipping them entirely -- now fixed so future scout runs cover them too. Candidates saved to
      `tools/scout/runs/candidates-manual-2026-09-22.json` (gitignored, not yet published to the
      live site -- see chat for the publish decision).
- [x] Add a "suggest a bar/venue" contact form so bar owners can reach you directly about being
      added to the site. Public form on the landing page (`index.html`), no account needed --
      writes to a new `venueLeads` Firestore collection via the REST API directly (kept
      `index.html` free of the Firebase SDK for one small write). Admin-only read, since
      submissions may include an email/phone. Shows up in the existing admin Review tab in the
      app alongside fan reports and scout finds. No visible email address on the public site, per
      your call -- form-only. Verified with live test writes against the deployed rules (cleaned
      up after). Spam/abuse protection is still just a honeypot field, no CAPTCHA or rate
      limiting -- still the gap noted below if it becomes a problem.
      **Also found and fixed while here:** item 1's `firestore.rules` change (4->5 char cell
      precision) had only ever been committed to git, never actually deployed to the live
      Firestore project -- the README's manual "paste into console" step was never done, so
      profile saves have likely been failing against the live rules since that push. Deployed the
      current rules via `tools/scout/deploy-rules.mjs` (uses the same admin key the scout uses).
- [ ] Broader push to get more venues/sites added generally (likely follows from the contact form
      above, plus manual outreach).
- [x] Add college basketball to the sports mix. Scoped to the same ~68 Power 4 schools already
      tracked for college football rather than all 362 D-I teams (`tools/cbb-ids.json`, reusing
      `tools/scout/p4-ids.json`) -- app architecture was already generic enough (LEAGUES/TEAMS-driven
      tabs, PATH-driven ESPN schedule fetch) that no app.js/store.js changes were needed, just data
      generation + a schedule endpoint entry. The venue scout now covers cbb too. Known gap: Big
      East (UConn, Villanova, etc.) is basketball-only and not covered -- worth a follow-up if it
      matters before March Madness.

## Phase 3 — Design & monetization

- [ ] Graphical/UI polish pass to make the site more visually appealing.
- [ ] Fanatics affiliate ad: team-aware creative based on the fan's followed teams, using your
      Fanatics referral link.
- [ ] Brainstorm additional monetization paths beyond the Fanatics affiliate (sponsorships from
      listed bars, premium features, etc.).
- [ ] Consider a betting-odds angle for a game (probably most relevant for a Vegas venue during
      March Madness) — needs a look at legal/compliance angle for odds display before building.

## Phase 4 — Engagement & growth features

- [ ] Email/text alert when a new venue is listed for a team the user follows (text = SMS costs
      via a provider like Twilio; decide email-only vs. email+SMS before building).
- [ ] "Traveling" mode: see watch parties/restaurants in a city other than home, for fans on the road.
- [x] Marketing plan to get the site in front of more people. Drafted ahead of the rest of Phase 3
      by request — see [MARKETING.md](MARKETING.md) for the full plan. Phase A of that plan
      (seeding fan-club communities) can start any time; Phases C–E assume more polish/content is
      in place first, so those still line up with finishing Phase 2/3 here.

## Phase 5 — Future platforms

- [ ] Whiteboard what it'd take to turn this into an iOS + Android app (native vs. wrapped PWA,
      push notifications, app store accounts, etc.).

## Other ideas worth considering (not yet ordered)

- **Analytics** (e.g. Plausible or GA4) before the marketing push, so you can tell what's working.
- **SEO basics** — meta tags, sitemap.xml, per-city landing pages — to support organic growth
  alongside the venue push in Phase 2.
- **Privacy policy / Terms of Service** page — you'll want one once there's an affiliate link and
  user location data in play (FTC requires affiliate-link disclosure too).
- **Abuse prevention** on the new bar-contact form and any future "suggest a venue" flow (basic
  rate limiting / spam checks).
- **Lightweight feedback mechanism** for early users (a simple form or email link) to catch bugs
  and feature requests once the marketing push brings in new fans.
