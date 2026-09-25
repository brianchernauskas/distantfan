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
