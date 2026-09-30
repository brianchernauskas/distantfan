import { AFFILIATE } from './config.js?v=202609300742';
import { TEAM_BY_ID } from './teams.js?v=202609300742';

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
