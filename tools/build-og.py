#!/usr/bin/env python3
"""Per-team social share images for the watch/ pages: assets/og/<team-slug>.png (1200x630).

A link pasted into Reddit, iMessage, X or Slack shows this card instead of the generic site image,
so a Bills fan sees "Where to watch Buffalo Bills games" with the Bills logo before they click.
Cards carry no counts, so they never go stale; rerun only when teams are added.

    python tools/build-og.py              build missing cards
    python tools/build-og.py --force      rebuild all
    python tools/build-og.py --team nfl-buf

Needs Pillow (pip install pillow). Team logos are fetched from the same ESPN CDN URLs the site
already uses, cached in the OS temp dir. Only teams that have a watch/<slug>/ hub get a card.
"""
import io
import json
import pathlib
import re
import sys
import tempfile
import unicodedata
import urllib.request

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'og'
CACHE = pathlib.Path(tempfile.gettempdir()) / 'distantfan-og-logos'
W, H = 1200, 630

BG, INK, MUTED, ACCENT = (245, 243, 238), (18, 24, 32), (96, 104, 114), (223, 90, 11)
FONT_DIRS = ['C:/Windows/Fonts', '/usr/share/fonts/truetype/dejavu', '/System/Library/Fonts/Supplemental']


def font(names, size):
    for d in FONT_DIRS:
        for n in names:
            p = pathlib.Path(d) / n
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


HEAD = ['impact.ttf', 'ARIALNB.TTF', 'arialbd.ttf', 'DejaVuSans-Bold.ttf', 'Arial Bold.ttf']
BODY = ['segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf', 'Arial Bold.ttf']
BODY_REG = ['segoeui.ttf', 'arial.ttf', 'DejaVuSans.ttf', 'Arial.ttf']


def slugify(s):
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower().replace('&', ' and ')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def team_slug(t):
    suffix = {'cfb': ' football', 'cbb': ' basketball'}.get(t['lg'], '')
    return slugify(t['name'] + suffix)


def teams():
    out = []
    for line in (ROOT / 'assets' / 'js' / 'teams.js').read_text(encoding='utf-8').splitlines():
        line = line.strip().rstrip(',')
        if line.startswith('{"id":'):
            out.append(json.loads(line))
    return out


def logo(t):
    if not t.get('logo'):
        return None
    CACHE.mkdir(exist_ok=True)
    f = CACHE / (t['id'] + '.png')
    if not f.exists():
        try:
            req = urllib.request.Request(t['logo'], headers={'User-Agent': 'distantfan-og/1.0'})
            f.write_bytes(urllib.request.urlopen(req, timeout=20).read())
        except Exception as e:
            print(f"  no logo for {t['id']}: {e}")
            return None
    try:
        return Image.open(f).convert('RGBA')
    except Exception:
        return None


def hex_rgb(h, default):
    h = (h or '').lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) if len(h) == 6 else default


def lum(c):
    return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255


def wrap(draw, text, fnt, width):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=fnt) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    return lines + [cur] if cur else lines


def fit_name(draw, name, width, max_lines=2):
    for size in range(104, 52, -4):
        f = font(HEAD, size)
        lines = wrap(draw, name.upper(), f, width)
        if len(lines) <= max_lines and all(draw.textlength(l, font=f) <= width for l in lines):
            return f, lines
    f = font(HEAD, 52)
    return f, wrap(draw, name.upper(), f, width)[:max_lines]


def card(t):
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    team = hex_rgb(t.get('color'), ACCENT)
    band = team if lum(team) < 0.85 else INK

    d.rectangle([0, 0, 22, H], fill=band)

    # scattered dots, like the main share card
    for x, y, r, a in [(1010, 70, 6, .28), (1100, 130, 8, .35), (900, 110, 5, .2), (1150, 260, 7, .3),
                       (930, 570, 6, .26), (1040, 585, 5, .22), (1160, 520, 8, .3), (820, 40, 4, .18)]:
        c = tuple(int(BG[i] + (ACCENT[i] - BG[i]) * a) for i in range(3))
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)

    # logo disc
    cx, cy, R = 930, 300, 200
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(255, 255, 255), outline=band, width=10)
    lg = logo(t)
    if lg:
        box = 270
        lg.thumbnail((box, box), Image.LANCZOS)
        img.paste(lg, (cx - lg.width // 2, cy - lg.height // 2), lg)

    # text
    x = 80
    d.text((x, 70), 'AWAY FROM HOME', font=font(BODY, 26), fill=ACCENT)
    d.text((x, 118), 'WHERE TO WATCH', font=font(HEAD, 54), fill=MUTED)
    name = t['name'] + {'cfb': ' football', 'cbb': ' basketball'}.get(t['lg'], '')
    f, lines = fit_name(d, name, 640)
    y = 190
    for l in lines:
        d.text((x, y), l, font=f, fill=INK)
        y += int(f.size * 1.02)
    d.text((x, y + 6), 'GAMES', font=font(HEAD, 54), fill=MUTED)
    d.text((x, y + 80), 'Bars and fan clubs in cities across the US', font=font(BODY_REG, 30), fill=MUTED)

    # brand footer
    d.ellipse([x, 548, x + 22, 570], fill=ACCENT)
    d.ellipse([x + 7, 555, x + 15, 563], fill=BG)
    d.text((x + 36, 540), 'DistantFan', font=font(BODY, 34), fill=INK)
    d.text((W - 80, 548), 'distantfan.com', font=font(BODY, 28), fill=MUTED, anchor='ra')
    return img


def main():
    args = sys.argv[1:]
    force = '--force' in args
    only = args[args.index('--team') + 1] if '--team' in args else None
    OUT.mkdir(parents=True, exist_ok=True)
    made = skipped = 0
    for t in teams():
        slug = team_slug(t)
        if only and t['id'] != only:
            continue
        if not (ROOT / 'watch' / slug / 'index.html').exists():
            continue
        f = OUT / f'{slug}.png'
        if f.exists() and not force:
            skipped += 1
            continue
        card(t).quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(f, optimize=True)
        made += 1
    print(f'og cards: made {made}, kept {skipped} ({OUT})')


if __name__ == '__main__':
    main()
