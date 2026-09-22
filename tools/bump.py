#!/usr/bin/env python3
"""Stamp a version on every local asset URL so a deploy can't serve a half-cached site.

Hostinger's CDN caches aggressively. Without this, a returning visitor can get a
fresh copy of one module and a stale copy of another; if an export moved between
them the page dies with a module error and renders nothing.

Run before committing any change to the JS or CSS:

    python tools/bump.py

It rewrites `?v=` on script/link tags in the HTML and on every relative import
inside assets/js, so the whole module graph moves in lockstep. External imports
(Firebase, Leaflet, Google Fonts) are left alone.
"""
import pathlib
import re
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = time.strftime('%Y%m%d%H%M')

# href/src on local assets, e.g. src="assets/js/app.js"
HTML_ASSET = re.compile(r'((?:src|href)="assets/[\w/.-]+\.(?:js|css))(?:\?v=\d+)?"')
# inline module imports in the HTML, e.g. from './assets/js/teams.js'
HTML_IMPORT = re.compile(r"((?:from|import\()\s*'\./assets/js/[\w.-]+\.js)(?:\?v=\d+)?'")
# static and dynamic relative imports, e.g. from './config.js'
JS_IMPORT = re.compile(r"((?:from|import\()\s*'\./[\w.-]+\.js)(?:\?v=\d+)?'")


def stamp(path: pathlib.Path, pattern: re.Pattern) -> bool:
    original = path.read_text(encoding='utf-8')
    updated = pattern.sub(lambda m: f"{m.group(1)}?v={VERSION}" + ('"' if '"' in m.group(0) else "'"), original)
    if updated == original:
        return False
    path.write_text(updated, encoding='utf-8')
    return True


def main() -> int:
    touched = []
    for html in sorted(ROOT.glob('*.html')):
        a, b = stamp(html, HTML_ASSET), stamp(html, HTML_IMPORT)
        if a or b:
            touched.append(html.name)
    for js in sorted((ROOT / 'assets' / 'js').glob('*.js')):
        if stamp(js, JS_IMPORT):
            touched.append(f'assets/js/{js.name}')

    print(f'version {VERSION}')
    for name in touched:
        print(f'  stamped {name}')
    if not touched:
        print('  nothing to stamp')
    return 0


if __name__ == '__main__':
    sys.exit(main())
