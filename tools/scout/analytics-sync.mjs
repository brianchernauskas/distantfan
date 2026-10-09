// Pulls Google Analytics 4 numbers for distantfan.com into Firestore adminStats/analytics, which only
// the admin can read (the Users tab > Traffic view). Kept out of the public repo on purpose.
//   node analytics-sync.mjs            write to Firestore
//   node analytics-sync.mjs --print    just print the result
//
// One-time setup (Brian): enable "Google Analytics Data API" for Firebase project distantfan-e8dbd, and in
// GA4 Admin > Property access management add the service account email in the admin key as Viewer.
import os from 'node:os';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';
import { adminDb, credentialPath } from './lib.mjs';

const PROPERTY = process.env.GA_PROPERTY || '555364902';
const auth = new GoogleAuth({ keyFile: credentialPath(), scopes: ['https://www.googleapis.com/auth/analytics.readonly'] });
const client = await auth.getClient();

async function report(body) {
  const r = await client.request({ url: `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`, method: 'POST', data: body, validateStatus: () => true });
  if (r.status !== 200) throw new Error(`GA4 ${r.status}: ${r.data?.error?.message || JSON.stringify(r.data).slice(0, 300)}`);
  return (r.data.rows || []).map(row => [...row.dimensionValues.map(d => d.value), ...row.metricValues.map(m => +m.value)]);
}

const cur = { startDate: '27daysAgo', endDate: 'today' };
const prev = { startDate: '55daysAgo', endDate: '28daysAgo' };
const M = names => names.map(name => ({ name }));

const [totals, daily, channels, sources, pages, events, cities] = await Promise.all([
  // Two date ranges add a dateRange dimension as the last dimension value.
  report({ dateRanges: [cur, prev], metrics: M(['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'screenPageViews']) }),
  report({ dateRanges: [cur], dimensions: [{ name: 'date' }], metrics: M(['activeUsers', 'sessions']), orderBys: [{ dimension: { dimensionName: 'date' } }] }),
  report({ dateRanges: [cur], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: M(['sessions', 'engagedSessions']), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }),
  report({ dateRanges: [cur], dimensions: [{ name: 'sessionSourceMedium' }], metrics: M(['sessions']), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }),
  report({ dateRanges: [cur], dimensions: [{ name: 'landingPage' }], metrics: M(['sessions', 'engagedSessions']), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 15 }),
  report({ dateRanges: [cur], dimensions: [{ name: 'eventName' }], metrics: M(['eventCount']), orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 15 }),
  report({ dateRanges: [cur], dimensions: [{ name: 'city' }, { name: 'region' }], metrics: M(['activeUsers']), orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 10 }),
]);

// totals rows come back as [dateRange, ...metrics] ("date_range_0" / "date_range_1").
const pick = tag => { const r = totals.find(x => x[0] === tag); return r ? { users: r[1], newUsers: r[2], sessions: r[3], engaged: r[4], views: r[5] } : { users: 0, newUsers: 0, sessions: 0, engaged: 0, views: 0 }; };
const out = {
  updatedAt: Date.now(), property: PROPERTY, windowDays: 28,
  totals: pick('date_range_0'), prior: pick('date_range_1'),
  daily: daily.map(([d, users, sessions]) => ({ d, users, sessions })),
  channels: channels.map(([name, sessions, engaged]) => ({ name, sessions, engaged })),
  sources: sources.map(([name, sessions]) => ({ name, sessions })),
  pages: pages.map(([path, sessions, engaged]) => ({ path, sessions, engaged })),
  events: events.map(([name, count]) => ({ name, count })),
  cities: cities.map(([city, region, users]) => ({ name: city === '(not set)' ? region : `${city}, ${region}`, users })),
};

if (process.argv.includes('--print')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
const db = await adminDb();
await db.doc('adminStats/analytics').set(out);
console.log(`wrote adminStats/analytics: ${out.totals.users} users, ${out.totals.sessions} sessions (28d), ${out.pages.length} landing pages`);
