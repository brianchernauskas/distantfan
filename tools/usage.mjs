// Is anyone coming back? Prints fan engagement from Firestore: return visits (visits/{uid}, written by
// the app once per fan per day), check-ins, chat, suggestions and email. Counts only: no names,
// emails or uids, so the output is safe to paste anywhere.
//
//   node tools/usage.mjs
//
// GA4 has the matching events (tab_map / tab_games / tab_chat, check_in, chat_send, spot_suggest,
// add_to_calendar, email_go_open) and utm_source=digest|welcome for email clicks.
import { adminDb } from './scout/lib.mjs';

const db = await adminDb();
const now = Date.now(), DAY = 864e5;
const ms = v => v?.toMillis?.() ?? (typeof v === 'number' ? v : 0);
const admins = new Set((await import('../assets/js/config.js')).ADMINS || []);

const profiles = (await db.collection('profiles').get()).docs.filter(d => !admins.has(d.id));
const fans = new Set(profiles.map(d => d.id));
const visits = (await db.collection('visits').get()).docs.filter(d => fans.has(d.id)).map(d => ({ ...d.data(), lastAt: ms(d.data().lastAt) }));
const checkins = (await db.collection('checkins').get()).docs.map(d => d.data()).filter(c => fans.has(c.uid));
const msgs = (await db.collectionGroup('messages').get()).docs.map(d => d.data()).filter(m => fans.has(m.uid));
const sugg = (await db.collection('spotSuggestions').get()).docs.filter(d => fans.has(d.data().uid)).length;
const reports = (await db.collection('spotReports').get()).docs.filter(d => fans.has(d.data().uid)).length;
const prefs = (await db.collection('emailPrefs').get()).docs.map(d => d.data()).filter(p => fans.has(p.uid));

const hist = {};
visits.forEach(v => { const k = v.days >= 5 ? '5+' : String(v.days); hist[k] = (hist[k] || 0) + 1; });
const via = {};
visits.forEach(v => { via[v.via || 'direct'] = (via[v.via || 'direct'] || 0) + 1; });

console.log(`Fans (excluding admins): ${fans.size}`);
console.log(`Visit tracking (since 2026-10-12): ${visits.length} fans seen`);
console.log(`  came back on 2+ days: ${visits.filter(v => v.days >= 2).length}`);
console.log(`  active last 7 days:   ${visits.filter(v => now - v.lastAt < 7 * DAY).length}`);
console.log(`  active last 28 days:  ${visits.filter(v => now - v.lastAt < 28 * DAY).length}`);
console.log(`  days-visited histogram: ${JSON.stringify(hist)}`);
console.log(`  last visit came from: ${JSON.stringify(via)}`);
console.log(`Check-ins (current docs): ${checkins.length} by ${new Set(checkins.map(c => c.uid)).size} fans`);
console.log(`Chat messages: ${msgs.length} by ${new Set(msgs.map(m => m.uid)).size} fans`);
console.log(`Spot suggestions: ${sugg} · spot reports: ${reports}`);
console.log(`Email: ${prefs.filter(p => p.optIn).length} opted in of ${prefs.length}`);
