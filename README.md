# Distant Fan

**Your team. Wherever you are.** A fan network for out-of-market sports fans: find other fans of
your team where you live now, the bars that put your game on, and a game-day chat.

Live at https://distantfan.com. It replaces the earlier Hostinger Horizons "FanSpot" build.

## What's here

| File | Purpose |
| --- | --- |
| `index.html` | Landing page |
| `app.html` | The app: sign-in, onboarding, map, games, chat |
| `assets/js/config.js` | Firebase web config (`null` = demo mode) and site settings |
| `assets/js/store.js` | Data layer. Firebase Auth + Firestore, or a localStorage demo with fake fans |
| `assets/js/app.js` | All UI |
| `assets/js/teams.js` | 292 teams (NFL, NBA, MLB, NHL, MLS, FBS), generated. Don't hand-edit |
| `assets/js/schedule.js` | Upcoming games from ESPN's public schedule feed (CORS-enabled) |
| `assets/js/geo.js` | Geohash helpers. Homes are stored as coarse cells only |
| `firestore.rules` | Security rules. Paste into the Firebase console |
| `.htaccess` | HTTPS redirect and cache headers for Hostinger |
| `tools/bump.py` | Cache-busting stamp. **Run before every deploy that touches JS/CSS** |

No build step. Serve the folder as static files.

## Privacy model

- A fan's home is a geohash of **4 characters** (a cell about 39 × 20 km). Browser geolocation
  is rounded on the device and the coordinates are thrown away. Metro picks use the metro centre.
- `firestore.rules` rejects any `cell` longer than 4 characters, so a street-level location can't
  be stored even by a modified client.
- The map draws fan circles at cell centres. It never draws a pin for a person.
- Watch spots are public places and do keep exact coordinates.

## Going live with Firebase

1. Create a Firebase project at https://console.firebase.google.com (Analytics not needed).
2. **Build → Authentication → Get started.** Enable **Google** and **Email/Password**.
   Under **Settings → Authorized domains**, add `distantfan.com` and `www.distantfan.com`.
3. **Build → Firestore Database → Create database** (production mode, a US region).
   Open the **Rules** tab, paste in `firestore.rules`, and click **Publish**.
4. **Project settings → Your apps → Web (`</>`)**. Register the app and copy the config object into
   `FIREBASE_CONFIG` in `assets/js/config.js`. These keys are public by design; the rules do the protecting.
5. `python tools/bump.py`, commit, deploy.

No composite indexes are needed. Every query is a single `array-contains`/`==` or one `orderBy`.

## Deploying to Hostinger

Code lives in GitHub. Hostinger pulls it via **hPanel → Websites → distantfan.com → Advanced → Git**:
repository `https://github.com/brianchernauskas/distantfan.git`, branch `main`, install path empty
(`public_html`). Turn on **Auto deployment** and add the webhook URL it gives you under the
GitHub repo's **Settings → Webhooks**, so every push goes live.

After a deploy, if a change doesn't show up, use **hPanel → Performance → CDN → Flush cache**.

## Regenerating the team list

```bash
cd tools
for l in football/nfl basketball/nba baseball/mlb hockey/nhl soccer/usa.1; do curl -s "https://site.api.espn.com/apis/site/v2/sports/$l/teams?limit=1000" -o "$(echo $l | tr '/' '_').json"; done
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000" -o football_cfb.json
node build-teams.mjs
```

`fbs-ids.json` holds the FBS team IDs (ESPN group 80) and is committed. Team IDs are stable.
Changing a team's id orphans it from existing profiles.

## Local preview

`npx serve distantfan --listen 3021`. With `FIREBASE_CONFIG = null` the app runs in demo mode.
