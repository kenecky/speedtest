// Karte der Messorte (Leaflet + OpenStreetMap), wird erst bei Bedarf geladen.
import { formatMbps } from './gauge.js';
import { CONN_LABELS } from './connection.js';

let loading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  loading ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet/leaflet.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = () => { loading = null; reject(new Error('Karte konnte nicht geladen werden')); };
    document.head.append(s);
  });
  return loading;
}

const connClass = c => (c === 'wifi' ? 'wifi' : c === 'cellular' ? 'cell' : 'other');
const fmtDate = ts => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Messungen am selben Ort (~100 m) zusammenfassen */
function groupByPlace(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = `${e.loc.lat.toFixed(3)},${e.loc.lon.toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.values()];
}

function popupContent(group) {
  const box = el('div', 'map-pop');
  const place = group.find(e => e.place)?.place;
  box.append(el('div', 'mp-title', place || 'Messort'));
  const approx = group.every(e => e.loc.src === 'ip');
  box.append(el('div', 'mp-sub', `${group.length} Messung${group.length > 1 ? 'en' : ''}${approx ? ' · Standort ungefähr (IP)' : ''}`));
  for (const e of [...group].reverse().slice(0, 8)) {
    const row = el('div', 'mp-row');
    row.append(
      el('span', 'mp-date', fmtDate(e.t)),
      el('span', `mp-conn ${connClass(e.conn)}`, CONN_LABELS[e.conn] || '–'),
      el('span', 'mp-val', `↓ ${formatMbps(e.down)}  ↑ ${formatMbps(e.up)}  ${Math.round(e.ping)} ms`),
    );
    box.append(row);
  }
  if (group.length > 8) box.append(el('div', 'mp-sub', `… und ${group.length - 8} weitere`));
  return box;
}

/** Karte in `container` zeichnen; gibt die Leaflet-Karte zurück (zum Aufräumen) */
export async function renderMap(container, entries) {
  const L = await loadLeaflet();
  const map = L.map(container, { attributionControl: true, zoomControl: true, scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);

  const bounds = [];
  for (const group of groupByPlace(entries)) {
    const conns = new Set(group.map(e => connClass(e.conn)));
    const cls = conns.size === 1 ? [...conns][0] : 'mixed';
    const approx = group.every(e => e.loc.src === 'ip') ? ' approx' : '';
    const avgDown = group.reduce((a, e) => a + e.down, 0) / group.length;
    const html = `<div class="pin ${cls}${approx}"><b>${formatMbps(avgDown)}</b>${group.length > 1 ? `<i>${group.length}</i>` : ''}</div>`;
    const { lat, lon } = group[group.length - 1].loc;
    L.marker([lat, lon], {
      icon: L.divIcon({ className: 'pin-wrap', html, iconSize: null }),
      title: `${group.length} Messung(en), Ø ${formatMbps(avgDown)} Mbit/s Download`,
    }).bindPopup(() => popupContent(group), { maxWidth: 280 }).addTo(map);
    bounds.push([lat, lon]);
  }
  if (bounds.length === 1) map.setView(bounds[0], 14);
  else map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  setTimeout(() => map.invalidateSize(), 260); // nach der Einblend-Animation
  return map;
}
