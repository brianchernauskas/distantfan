# Distant Fan: search setup checklist

What exists (all automatic): `tools/build-pages.mjs` builds the `/watch/` pages, `sitemap.xml` and
`robots.txt`, and `export-spots.mjs --commit` rebuilds them after every scout run. The landing page has
a canonical tag and WebSite/Organization structured data. What's left needs a human login.

## 1. Google Search Console (about 10 minutes, do this first)

1. Go to https://search.google.com/search-console and sign in with the Google account you want to own the site.
2. **Add property** -> **Domain** -> enter `distantfan.com`.
3. Google shows a TXT record (`google-site-verification=...`). In Hostinger: Domains -> distantfan.com
   -> DNS / Nameservers -> DNS records -> **Add record**: type `TXT`, name `@`, value = the string, TTL 3600.
   Leave the existing GitHub A records and the `www` CNAME alone.
4. Back in Search Console click **Verify** (DNS can take a few minutes; retry if it says not found).
5. **Sitemaps** (left menu) -> enter `sitemap.xml` -> **Submit**. Status should read "Success" with about
   290 discovered URLs.
6. **URL inspection** (top bar) -> paste `https://distantfan.com/` -> **Request indexing**. Repeat for
   `https://distantfan.com/watch/` and one or two big-city pages, e.g. `/watch/in/phoenix-az/`.

## 2. Bing Webmaster Tools (2 minutes)

https://www.bing.com/webmasters -> **Import from Google Search Console** and approve. It brings the
property and sitemap across. Bing also feeds DuckDuckGo and some AI search tools.

## 3. Check back

- **After 1 week:** Search Console -> Pages. Expect most `/watch/` URLs under "Indexed" or "Discovered".
  "Crawled, currently not indexed" on many pages means Google finds them thin: raise `MIN_SPOTS` in
  `tools/build-pages.mjs` (default 3) or add more spots for those cities.
- **After 3-4 weeks:** Performance -> queries. Look for "where to watch [team] in [city]" impressions.
  Pages with impressions but low clicks need a better title or description; edit the templates in
  `build-pages.mjs`.
- Run `site:distantfan.com` in Google for a quick count of indexed pages.

## 4. Links (the slow part)

Rankings follow links from other sites. Ask fan clubs and alumni chapters already listed on the site to
link to their team/city page, post the relevant `/watch/` page in team and city subreddits, and mention
it in MARKETING.md Phase A outreach. Each link from a real fan community helps more than any tag.

## 5. Title test (started 2026-10-06)

Search Console baseline, Sep 25 to Oct 4 2026: 241 clicks, 10.4K impressions, 2.3% CTR, average
position 8.1. That CTR is normal for that position, so the real lever is ranking, not titles. Still,
21 team x city pages had 40+ impressions and 0 or 1 clicks, and the queries hitting them use the short
team name and a singular "bar" ("bears bar nashville", "raiders bar denver"). Those 21 pages (the
`TITLE_TEST` set in `tools/build-pages.mjs`) now use `testTitle()`: "Bears bar in Nashville: 4 spots to
watch Chicago Bears". Everything else keeps the original "{Team} bars in {City}, ST: N places to watch"
as the control.

Baseline (impressions / clicks, Sep 25 to Oct 4): bears-nashville 216/1, bears-denver 147/1,
browns-phoenix 125/1, broncos-las-vegas 91/1, nebraska-phoenix 86/1, nebraska-kansas-city 70/1,
patriots-nashville 62/1, ohio-state-tampa 61/1, ohio-state-nashville 60/1, browns-chicago 58/1,
ohio-state-charlotte 56/1, 49ers-dallas 53/1, browns-nashville 53/1, bears-phoenix 50/1,
49ers-portland 57/0, browns-cleveland 57/0, 49ers-sacramento 56/0, chiefs-las-vegas 49/0,
steelers-los-angeles 43/0, eagles-las-vegas 43/0, eagles-washington 42/0.

**Review around 2026-11-03** (4 weeks): Search Console, Pages, filter `page` to those URLs, compare
CTR and clicks per impression for the 21 against the same number of untouched pages with similar
impressions. Impressions are still ramping up (Oct 4 was the biggest day), so compare CTR, not raw
clicks. If CTR is clearly better, roll `testTitle()` out to all team x city pages; if not, delete
`TITLE_TEST` and keep the original. Expect a small effect: samples are tiny.
