// Publishes ../../firestore.rules to the live project using the admin key.
//   node deploy-rules.mjs
import fs from 'node:fs';
import { adminDb } from './lib.mjs';

await adminDb(); // initialises the admin app from the key
const { getSecurityRules } = await import('firebase-admin/security-rules');
const src = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const rs = await getSecurityRules().releaseFirestoreRulesetFromSource(src);
console.log(`Published ruleset ${rs.name} (${rs.createTime})`);
