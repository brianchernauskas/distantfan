import { AFFILIATE } from './config.js?v=202609300757';
import { TEAM_BY_ID } from './teams.js?v=202609300757';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The strip shows when the affiliate is live, or for a preview with ?shop=1 in the URL.
export const shopOn = () => AFFILIATE.enabled || /[?&]shop=1\b/.test(location.search + location.hash);

export function shopLink(t) {
  const dest = AFFILIATE.teamUrls[t.id] || AFFILIATE.searchUrl.replace('{q}', encodeURIComponent(t.name));
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

const money = n => '$' + (Number.isInteger(n) ? n : n.toFixed(2));

// Product tiles come from data/shop.json (written by tools/shop-feed.mjs). Cards render first; when the
// snapshot exists and has products for the fan's teams, a tile row is added below them. Any failure leaves
// the cards alone. Tiles round-robin across teams so a fan following several sees each of them.
export async function hydrateShop(teamIds, perTeam = 3) {
  const box = document.querySelector('.shop');
  if (!box) return;
  let snap;
  try { const r = await fetch('data/shop.json', { cache: 'no-cache' }); if (!r.ok) return; snap = await r.json(); } catch { return; }
  const lists = teamIds.map(id => (snap.teams?.[id] || []).slice(0, perTeam).map(p => ({ ...p, id }))).filter(l => l.length);
  const tiles = [];
  for (let i = 0; i < perTeam; i++) for (const l of lists) if (l[i]) tiles.push(l[i]);
  if (!tiles.length || !box.isConnected) return;
  const row = document.createElement('div');
  row.className = 'shop-products';
  row.innerHTML = tiles.slice(0, 12).map(p => `<a class="shop-tile" href="${esc(p.u)}" target="_blank" rel="sponsored noopener" data-shop="${esc(p.id)}">
    <img src="${esc(p.i)}" alt="" loading="lazy">
    <span class="n">${esc(p.n)}</span>
    <span class="pr"><b>${money(p.p)}</b>${p.o && p.o > p.p ? ` <s>${money(p.o)}</s>` : ''}</span>
  </a>`).join('');
  box.querySelector('.shop-cards').after(row);
}
