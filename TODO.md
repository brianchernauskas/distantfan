# Distant Fan — Backlog

Working list of changes, roughly ordered so the earlier items unblock or de-risk the later
ones. Check items off as they land; add new ones at the bottom of whichever phase fits.
When picking up this file cold, work top to bottom unless told otherwise.

## Phase 1 — Foundation (touches core data model / privacy)

- [ ] **Tighten viewer radius to 10 miles (from 25) and re-document why anonymity matters.**
      Affects `assets/js/geo.js` geohash precision and the map query radius in `store.js`/`app.js`.
      Revisit the README's "Privacy model" section to explain the reasoning (not just the mechanism)
      so future-you remembers why fan locations are deliberately coarse.
- [ ] **Reopen the app to local (non-away) teams**, e.g. "find a spot to watch my team when they're
      on the road, or when I'm not going to the game." This changes the core query from
      "out-of-market fans only" to something broader — worth deciding the UX distinction between
      "away fan" and "local fan looking for a bar" before building.

## Phase 2 — Content & coverage

- [ ] Research Arizona Wildcats football, KC Chiefs, and Kansas Jayhawks football venues/bars for
      the greater Phoenix area (ties into distant-fan demand there).
- [ ] Add a "suggest a bar/venue" contact form so bar owners can reach you directly about being
      added to the site.
- [ ] Broader push to get more venues/sites added generally (likely follows from the contact form
      above, plus manual outreach).
- [ ] Add college basketball to the sports mix (worth timing before March Madness).

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
- [ ] Marketing plan to get the site in front of more people (do this once Phase 3 polish is in,
      so there's something good to point people at).

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
