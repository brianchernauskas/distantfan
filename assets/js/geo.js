// Geohash helpers. A fan's home is stored only as a coarse cell, never as coordinates.
import { METROS } from './metros.js?v=202609230838';

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encode(lat, lng, precision) {
  let latR = [-90, 90], lngR = [-180, 180], hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    const r = even ? lngR : latR, v = even ? lng : lat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch |= 16 >> bit; r[0] = mid; } else { r[1] = mid; }
    even = !even;
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

export function bounds(hash) {
  let latR = [-90, 90], lngR = [-180, 180], even = true;
  for (const c of hash) {
    const n = B32.indexOf(c);
    for (let b = 4; b >= 0; b--) {
      const r = even ? lngR : latR, mid = (r[0] + r[1]) / 2;
      if ((n >> b) & 1) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { s: latR[0], n: latR[1], w: lngR[0], e: lngR[1] };
}

export function center(hash) {
  const b = bounds(hash);
  return { lat: (b.s + b.n) / 2, lng: (b.w + b.e) / 2 };
}

export function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestMetro(pt, maxKm = 120) {
  let best = null, bestD = Infinity;
  for (const m of METROS) {
    const d = km(pt, m);
    if (d < bestD) { bestD = d; best = m; }
  }
  return bestD <= maxKm ? best : null;
}

export function areaLabel(cell) {
  const m = nearestMetro(center(cell));
  return m ? `${m.name} area` : 'Your area';
}
