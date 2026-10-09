// Admin-only "Sync now" for the Users > Traffic view. Same reports as tools/scout/analytics-sync.mjs.
// Runs as the function's default service account, which must be a Viewer on the GA4 property.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { GoogleAuth } = require('google-auth-library');

initializeApp();
const PROPERTY = '555364902';
const ADMINS = ['euJIvUd4sig4pGT4fE7SPSpE6lA3', 'RjIHnrdYD5gMvF9Y3YBcq2uiU872']; // keep in sync with firestore.rules isAdmin()

exports.syncAnalytics = onCall({ region: 'us-central1', maxInstances: 2, timeoutSeconds: 60 }, async req => {
  if (!req.auth || !ADMINS.includes(req.auth.uid)) throw new HttpsError('permission-denied', 'Admins only.');
  const db = getFirestore();
  const ref = db.doc('adminStats/analytics');
  const old = await ref.get();
  if (old.exists && Date.now() - old.data().updatedAt < 30_000) return { updatedAt: old.data().updatedAt, cached: true };

  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/analytics.readonly'] }).getClient();
  const report = async body => {
    const r = await client.request({ url: `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`, method: 'POST', data: body, validateStatus: () => true });
    if (r.status !== 200) throw new HttpsError('failed-precondition', `GA4 ${r.status}: ${r.data?.error?.message || 'request failed'}`);
    return (r.data.rows || []).map(row => [...row.dimensionValues.map(d => d.value), ...row.metricValues.map(m => +m.value)]);
  };
  const cur = { startDate: '27daysAgo', endDate: 'today' }, prev = { startDate: '55daysAgo', endDate: '28daysAgo' };
  const M = names => names.map(name => ({ name }));
  const top = (dim, metric, limit) => ({ dateRanges: [cur], dimensions: [{ name: dim }], metrics: M([metric]), orderBys: [{ metric: { metricName: metric }, desc: true }], limit });
  const [totals, daily, channels, sources, pages, events, cities] = await Promise.all([
    report({ dateRanges: [cur, prev], metrics: M(['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'screenPageViews']) }),
    report({ dateRanges: [cur], dimensions: [{ name: 'date' }], metrics: M(['activeUsers', 'sessions']), orderBys: [{ dimension: { dimensionName: 'date' } }] }),
    report({ ...top('sessionDefaultChannelGroup', 'sessions', 10), metrics: M(['sessions', 'engagedSessions']) }),
    report(top('sessionSourceMedium', 'sessions', 10)),
    report({ ...top('landingPage', 'sessions', 15), metrics: M(['sessions', 'engagedSessions']) }),
    report(top('eventName', 'eventCount', 15)),
    report({ ...top('city', 'activeUsers', 10), dimensions: [{ name: 'city' }, { name: 'region' }] }),
  ]);
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
  await ref.set(out);
  return { updatedAt: out.updatedAt };
});
