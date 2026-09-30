// Builds the web app into www/ for the Capacitor native shell. The website is unaffected:
// GitHub Pages still serves the repo root, and no source file is edited by this script.
//
//   npm install && npm run build:app
//
// What it does differently from the website:
//  - bundles app.js and its modules into one file, with Firebase from npm instead of gstatic.com
//    (the app must work offline and can't load remote code)
//  - vendors Leaflet from npm instead of cdnjs
//  - strips the ?v= cache-busting strings (the bundle is versioned by the app release)
//  - copies a snapshot of data/ so the map has spots and fan counts before the network answers
//  - uses app.html as index.html (the landing page is web-only)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'www');
const rel = (...p) => path.join(ROOT, ...p);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets', 'js'), { recursive: true });

// The source loads Firebase with import(`${base}/firebase-app.js`) from gstatic. Rewrite those to
// bare npm specifiers at build time so esbuild can bundle them. Fails loudly if the source changes shape.
const firebaseFromNpm = {
  name: 'firebase-from-npm',
  setup(b) {
    b.onLoad({ filter: /\.js$/ }, args => {
      if (args.path.includes('node_modules')) return null;
      const src = fs.readFileSync(args.path, 'utf8');
      if (!src.includes('gstatic.com/firebasejs')) return { contents: src, loader: 'js' };
      const out = src.replace(/import\(`\$\{base\}\/firebase-([\w-]+)\.js`\)/g, "import('firebase/$1')");
      if (/gstatic\.com\/firebasejs/.test(out.replace(/^.*gstatic\.com\/firebasejs.*$/gm, '')) || /\$\{base\}\/firebase/.test(out)) {
        throw new Error(`${args.path}: found a Firebase CDN import the build could not rewrite`);
      }
      return { contents: out, loader: 'js' };
    });
    // Strip ?v= stamps from relative imports (tools/bump.py adds them).
    b.onResolve({ filter: /^\.\/.*\.js\?v=\d+$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?v=\d+$/, '')) }));
  },
};

await build({
  entryPoints: [rel('assets/js/app.js')],
  outfile: path.join(OUT, 'assets/js/app.js'),
  bundle: true, format: 'esm', target: 'es2020', minify: true, sourcemap: false,
  plugins: [firebaseFromNpm],
  logLevel: 'info',
});

// Static assets.
fs.cpSync(rel('assets/css'), path.join(OUT, 'assets/css'), { recursive: true });
fs.cpSync(rel('assets/img'), path.join(OUT, 'assets/img'), { recursive: true });
fs.cpSync(rel('data'), path.join(OUT, 'data'), { recursive: true });
fs.rmSync(path.join(OUT, 'data/indexnow.json'), { force: true });
fs.cpSync(rel('node_modules/leaflet/dist/leaflet.css'), path.join(OUT, 'vendor/leaflet/leaflet.css'), { recursive: true });
fs.cpSync(rel('node_modules/leaflet/dist/leaflet.js'), path.join(OUT, 'vendor/leaflet/leaflet.js'));
fs.cpSync(rel('node_modules/leaflet/dist/images'), path.join(OUT, 'vendor/leaflet/images'), { recursive: true });

// app.html -> index.html with local Leaflet and no cache-busting stamps.
let html = fs.readFileSync(rel('app.html'), 'utf8');
const before = html;
html = html
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.(css|js)/g, 'vendor/leaflet/leaflet.$1')
  .replace(/(assets\/[\w/.-]+\.(?:js|css))\?v=\d+/g, '$1');
if (/cdnjs\.cloudflare\.com|\?v=\d/.test(html)) throw new Error('app.html still references a CDN or ?v= stamp after rewrite');
if (html === before) throw new Error('app.html rewrite changed nothing');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// Report anything the shell still fetches from the network at load.
const remote = [...new Set(html.match(/https?:\/\/[^"')\s]+/g) || [])].filter(u => !u.includes('w3.org'));
const size = fs.statSync(path.join(OUT, 'assets/js/app.js')).size;
console.log(`\nwww/ ready. app.js ${(size / 1024).toFixed(0)} KB.`);
if (remote.length) console.log('Still remote in index.html:\n  ' + remote.join('\n  '));
