// A fetch that behaves like a real browser instead of a script. Shells out to curl (not
// Node's built-in fetch) with a realistic User-Agent and a session cookie jar carried across
// redirects, because curl's TLS fingerprint passes basic Cloudflare/bot-detection checks that
// Node's fetch (undici) gets challenged on - same URL, same headers, different result.
// This clears two kinds of block seen on official fan-club/alumni sites: plain User-Agent
// sniffing (Browns Backers, Arrowhead Kingdom) and the session-cookie handshake iModules-
// hosted alumni CMS sites (Oklahoma State, Michigan State, Missouri, ...) redirect through
// before serving the real page - chapter data that looks JS-only is often sitting in that
// page's static HTML the whole time, just hidden behind a CSS accordion.
// It does NOT clear a real Cloudflare managed challenge (e.g. billsfans.com) or a site with
// a broken TLS cert (e.g. packer-bars.com) - those still need a browser, or get skipped.
//
//   node fetch.mjs <url>          readable text (scripts/styles stripped, tags collapsed)
//   node fetch.mjs <url> --raw    unprocessed HTML (use when grep-ing for hidden panels)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const execFileP = promisify(execFile);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function fetchLikeBrowser(url) {
  const id = crypto.randomBytes(6).toString('hex');
  const jar = path.join(os.tmpdir(), `scout-fetch-${id}.cookies`);
  const bodyFile = path.join(os.tmpdir(), `scout-fetch-${id}.body`);
  try {
    const { stdout } = await execFileP('curl', [
      '-s', '-S', '-L', '--max-time', '25',
      '-A', UA,
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      '-c', jar, '-b', jar,
      '-o', bodyFile,
      '-w', '%{http_code} %{url_effective}',
      url,
    ]);
    const [status, finalUrl] = stdout.trim().split(/\s+/);
    const body = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '';
    return { status: Number(status), url: finalUrl || url, body };
  } finally {
    for (const f of [jar, bodyFile]) { try { fs.unlinkSync(f); } catch {} }
  }
}

function htmlToText(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&rdquo;|&ldquo;/gi, '"')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&[a-z]+;/gi, ' ');
  return text.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

const url = process.argv[2];
const raw = process.argv.includes('--raw');
if (!url) { console.error('usage: node fetch.mjs <url> [--raw]'); process.exit(2); }

try {
  const { status, url: finalUrl, body } = await fetchLikeBrowser(url);
  console.error(`# fetched ${finalUrl} -> HTTP ${status}${finalUrl !== url ? ` (redirected from ${url})` : ''}`);
  if (status >= 400 || !body) { console.error('# non-OK status or empty body - the source may not have real content here'); }
  if (/Enable JavaScript and cookies to continue|Just a moment\.\.\./i.test(body)) {
    console.error('# still hit a Cloudflare managed challenge - this site genuinely needs a browser, skip it');
  }
  console.log(raw ? body : htmlToText(body));
  if (status >= 400) process.exitCode = 1;
} catch (err) {
  console.error(`# fetch failed: ${err.message}`);
  console.error('# this usually means a broken site (expired TLS cert, DNS failure) - skip it');
  process.exit(1);
}
