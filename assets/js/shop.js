import { AFFILIATE } from './config.js?v=202610061705';
import { TEAM_BY_ID } from './teams.js?v=202610061705';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The strip shows when the affiliate is live, or for a preview with ?shop=1 in the URL.
export const shopOn = () => AFFILIATE.enabled || /[?&]shop=1\b/.test(location.search + location.hash);

export function shopLink(t, page) {
  const dest = (page && 'https://www.fanatics.com' + page) || AFFILIATE.teamUrls[t.id] || AFFILIATE.searchUrl.replace('{q}', encodeURIComponent(t.name));
  return AFFILIATE.linkTemplate.replace('{urlenc}', encodeURIComponent(dest)).replace('{url}', dest).replace('{team}', encodeURIComponent(t.id));
}

// One card per followed team. `logo` is the app's logo() renderer, passed in to avoid a circular import.
export function shopStrip(teamIds, logo) {
  const teams = teamIds.map(id => TEAM_BY_ID[id]).filter(Boolean);
  if (!shopOn() || !teams.length) return '';
  return `<section class="shop" aria-label="Team gear">
    <div class="shop-head"><h3>Rep your teams</h3><span class="badge plain">Sponsored</span></div>
    <div class="shop-cards">${teams.map(t => `<a class="shop-card" href="${esc(shopLink(t))}" target="_blank" rel="sponsored noopener" style="--team:${esc(t.color)}" data-shop="${esc(t.id)}">${logo(t, 'lg')}<span class="n">${esc(t.short)} gear</span><span class="s">Shop at ${esc(AFFILIATE.store)}</span></a>`).join('')}</div>
    <p class="shop-note">${esc(AFFILIATE.disclosure)}</p>
  </section>`;
}

// Slim one-team banner for the map's side panel, under the stats panel: above the fold on desktop, and the first
// thing under the map on mobile. Never over the map itself, where it would cover pins and the add-spot hint.
export function shopBanner(teamId, logo) {
  const t = TEAM_BY_ID[teamId];
  if (!shopOn() || !t) return '';
  return `<aside class="shop-banner" aria-label="Team gear" style="--team:${esc(t.color)}">
    <a href="${esc(shopLink(t))}" target="_blank" rel="sponsored noopener" data-shop="${esc(t.id)}" data-banner>${logo(t, 'sm')}<span class="main"><b>Rep the ${esc(t.short)}</b><span>Shop ${esc(t.short)} gear at ${esc(AFFILIATE.store)}</span></span><span class="badge plain">Sponsored</span></a>
    <p class="shop-note">${esc(AFFILIATE.disclosure)}</p>
  </aside>`;
}

// Upgrades the banner's search link to the team's real shop page when a fresh harvested one exists (same rule as the cards).
export async function hydrateBanner(teamId) {
  const a = document.querySelector('.shop-banner a[data-banner]'), t = TEAM_BY_ID[teamId];
  if (!a || !t) return;
  try {
    const r = await fetch(`data/shop/${encodeURIComponent(teamId)}.json`);
    if (!r.ok) return;
    const d = await r.json();
    if (a.isConnected && d.page && d.pageAt && (Date.now() - Date.parse(d.pageAt)) / 864e5 < AFFILIATE.pageMaxAgeDays) a.href = shopLink(t, d.page);
  } catch {}
}

const money = n => '$' + (Number.isInteger(n) ? n : n.toFixed(2));

// Product tiles come from data/shop/<teamId>.json (written by tools/shop-feed.mjs). Cards render first; when the
// snapshots exist for the fan's teams, a tile row is added below them. Any failure leaves
// the cards alone. Tiles round-robin across teams so a fan following several sees each of them.
export async function hydrateShop(teamIds, perTeam = 3) {
  const box = document.querySelector('.shop');
  if (!box) return;
  // One small file per team; a missing one (no products for that team) just 404s and is skipped.
  // Each file is { page, items }: `page` is the team's real Fanatics shop path (signed by Fanatics, so it can't be
  // built by hand), which upgrades that team's card from a search link to the team page.
  const got = await Promise.all(teamIds.map(async id => {
    try {
      const r = await fetch(`data/shop/${encodeURIComponent(id)}.json`);
      if (!r.ok) return { id, items: [] };
      const d = await r.json();
      return { id, page: d.page, pageAt: d.pageAt, items: (d.items || []).slice(0, perTeam).map(p => ({ ...p, id })) };
    } catch { return { id, items: [] }; }
  }));
  if (!box.isConnected) return;
  for (const g of got) {
    // A team page is used only while fresh; a stale or undated one is ignored and the card keeps its search link.
    const fresh = g.page && g.pageAt && (Date.now() - Date.parse(g.pageAt)) / 864e5 < AFFILIATE.pageMaxAgeDays;
    const t = TEAM_BY_ID[g.id], a = fresh && t && box.querySelector(`.shop-card[data-shop="${CSS.escape(g.id)}"]`);
    if (a) a.href = shopLink(t, g.page);
  }
  const lists = got.map(g => g.items).filter(l => l.length);
  const tiles = [];
  for (let i = 0; i < perTeam; i++) for (const l of lists) if (l[i]) tiles.push(l[i]);
  if (!tiles.length || !box.isConnected) return;
  const row = document.createElement('div');
  row.className = 'shop-products';
  row.innerHTML = tiles.slice(0, 12).map(p => `<a class="shop-tile" href="${esc(p.u + (p.u.includes('?') ? '&' : '?') + 'subId1=' + encodeURIComponent(p.id))}" target="_blank" rel="sponsored noopener" data-shop="${esc(p.id)}">
    <img src="${esc(p.i)}" alt="" loading="lazy">
    <span class="n">${esc(p.n)}</span>
    <span class="pr"><b>${money(p.p)}</b>${p.o && p.o > p.p ? ` <s>${money(p.o)}</s>` : ''}</span>
  </a>`).join('');
  box.querySelector('.shop-cards').after(row);
}
