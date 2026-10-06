# Distant Fan — Reddit playbook

Drafts and ground rules for Reddit. Numbers come from `data/spots.json` and the live `/watch/`
hub pages as of 2026-10-06; re-check a hub's count before posting, since the scout changes them
weekly. Complements Phase A in [MARKETING.md](MARKETING.md).

## Ground rules

- **Read each sub's rules and message the mods first.** Many ban links outright or require a
  flair or a weekly self-promo thread. A mod-approved post beats a clever one that gets removed.
- **Use a real account with history.** No new or throwaway account. Comment in the sub for a week
  before posting a link.
- **One post per sub, then stay in the thread** and answer every reply. Don't crosspost the same text.
- **Say you built it**, in the first lines. Never pose as a neutral fan who "found" it.
- **Lead with the useful thing** (the list of bars, the map), not the site. The link goes last.
- Don't ask for upvotes, don't DM people who comment, don't promise listings you haven't verified.

## Tagging links so you can see what works

Every post gets its own `utm_source` so GA4 and the signup "How did you hear" field show which
subreddit converts (`attrib.js` stores first-touch utm on the profile):

```
https://distantfan.com/watch/<team-slug>/?utm_source=reddit&utm_medium=post&utm_campaign=<subreddit>
```

Add `&follow=<teamId>` (e.g. `follow=nfl-buf`) to prefill the team on signup. Link to the team hub
or a city page, not the homepage.

## Where to post first

| Team | Why | Hub page | Sub | Tone |
|---|---|---|---|---|
| Bills | Biggest diaspora in the data (hub lists 260 bars, in about 50 cities, mostly out of state) | `/watch/buffalo-bills/` | r/buffalobills | Data post |
| Browns | Second biggest | `/watch/cleveland-browns/` | r/Browns | Data post |
| Packers | California is the surprise (about 19 bars there) | `/watch/green-bay-packers/` | r/GreenBayPackers | Data post |
| Patriots | 69 bars, lots in Dallas, Chicago, Denver | `/watch/new-england-patriots/` | r/Patriots | Data post |
| Steelers | Dallas, LA, Phoenix, Denver | `/watch/pittsburgh-steelers/` | r/steelers | Data post |
| Chiefs | Phoenix, Las Vegas, San Antonio | `/watch/kansas-city-chiefs/` | r/KansasCityChiefs | Ask for bars |

Space the posts out by at least a few days. A bad reception in one sub is information for the next.

---

## Draft 1: r/buffalobills (data post)

**Title:** I mapped where Bills fans actually watch games outside Buffalo. 50+ cities so far, and I need your help filling gaps

**Body:**

> I moved away from my team years ago and the hardest part of Sundays was finding where the fans
> were. So I've been collecting watch spots from official Bills Backers chapters, alumni and
> club pages, and bar lists, and putting them on one map.
>
> What it looks like right now: about 260 bars and fan clubs, spread over roughly 50 cities. Florida
> has the most (no surprise), then North Carolina, California, and Texas. Charlotte and Rochester
> are in the top few cities.
>
> I'm sure it's missing places, and some of it is probably out of date. If your chapter meets at
> a bar that isn't on there, or one on there has stopped showing the games, I'd rather hear it
> than guess. There's a "still accurate?" button on every listing, and you can add a bar yourself.
>
> Full list by city: https://distantfan.com/watch/buffalo-bills/?utm_source=reddit&utm_medium=post&utm_campaign=buffalobills&follow=nfl-buf
>
> I built it (it's free, no ads). Happy to answer anything about how I'm getting the data.

*Before posting:* confirm the city names above against the hub, since I only know the top five
from the description (New York, Rochester, Charlotte, Washington).

## Draft 2: r/GreenBayPackers (data post, the California angle)

**Title:** Turns out there are a LOT of Packers bars in California. Here's the list, and what's missing?

**Body:**

> I've been collecting watch spots for out-of-market fans of every team. Packers fans are all over
> the place, but the thing that surprised me is California: around 19 bars on my list, more than
> any other state outside Wisconsin. Los Angeles, Dallas–Fort Worth, Riverside, and Houston lead
> the city list.
>
> If you're in one of those and know a better spot, or your bar isn't listed, tell me. I want this
> to be a list people trust on game day, so I'd rather remove a dead listing than leave it up.
>
> https://distantfan.com/watch/green-bay-packers/?utm_source=reddit&utm_medium=post&utm_campaign=greenbaypackers&follow=nfl-gb
>
> (I built this. It's free, and I'm trying to make it useful, not sell anything.)

## Draft 3: r/KansasCityChiefs (ask for bars)

**Title:** Moved away from KC. Where do you watch games in Phoenix, Las Vegas, San Antonio?

**Body:**

> I've been building a map of where out-of-market fans watch their teams, and Chiefs fans show up
> in a few cities more than others: Phoenix, Las Vegas, and San Antonio lead my list right now (31
> bars and clubs total). That's probably biased toward the cities I've scraped hardest.
>
> If you live somewhere else, what's the bar where the Chiefs are always on and people actually
> show up? I'll add it if it checks out.
>
> https://distantfan.com/watch/kansas-city-chiefs/?utm_source=reddit&utm_medium=post&utm_campaign=kansascitychiefs&follow=nfl-kc
>
> I'm the person who built it.

## Drafts 4–6: Browns, Patriots, Steelers

Same shape as Draft 1. Swap in the hub's own description line for the numbers and top cities:

- **Browns:** "152 bars and fan clubs … Cleveland, Columbus, Fort Myers, Cincinnati and more."
- **Patriots:** "69 bars and fan clubs … Dallas–Fort Worth, Chicago, Denver, New York and more."
- **Steelers:** "48 bars and fan clubs … Dallas–Fort Worth, Los Angeles, Phoenix, Denver and more."

(The Browns and Bills hubs include home-market bars, so say "out of Cleveland" only if you filter
for that; check the page first.)

---

## Reply template for "where do I watch [team] in [city]?" threads

This is the highest-converting thing on this list because the person already asked. Only reply if
you can add at least one real recommendation yourself.

> A few options in [city]: [bar 1], [bar 2]. Both show [team] games and have a fan group that
> meets there. I keep a list of these by city here if it's useful: [city page link]. Not all of
> them are verified, so check before you go.

City page URL: `https://distantfan.com/watch/<team-slug>/<city-slug>/?utm_source=reddit&utm_medium=comment&utm_campaign=<subreddit>`
(see `watch/<team-slug>/` for the exact city slugs, e.g. `phoenix-az`).

## Tracking

- GA4: filter sessions by `utm_source = reddit`, split by campaign.
- Profiles: `src`/`ref`/`how` fields from the onboarding "How did you hear" select.
- Mark `sign_up` as a key event in GA4 (still owed, see project notes) or conversions won't show.
- After each post, record the sub, date, upvotes, comments, and signups in a row here:

| Date | Sub | Post | Upvotes | Visits | Signups | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
