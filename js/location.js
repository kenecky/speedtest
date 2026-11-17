// Standort für den Verlauf.
//   'gps' – genau, über navigator.geolocation (Browser fragt einmal um Erlaubnis)
//   'ip'  – ungefähr, aus der IP-Adresse (liefert der Server in /meta mit)
//   'off' – nichts speichern
// Ortsnamen zu GPS-Koordinaten kommen von OpenStreetMap (Nominatim).

export const LOCATION_MODES = {
  gps: 'Genau (GPS, fragt einmal nach Erlaubnis)',
  ip:  'Ungefähr (über die IP-Adresse)',
  off: 'Aus',
};

let lastStatus = 'noch nicht abgefragt';
export const locationStatus = () => lastStatus;

/** GPS-Position oder null (nie ein Fehler) */
export function getGpsPosition(timeout = 12000) {
  if (!('geolocation' in navigator)) { lastStatus = 'vom Browser nicht unterstützt'; return Promise.resolve(null); }
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => {
        lastStatus = `GPS ok (±${Math.round(p.coords.accuracy)} m)`;
        resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy), src: 'gps' });
      },
      e => {
        lastStatus = e.code === 1 ? 'GPS nicht erlaubt – nutze IP-Standort' : `GPS fehlgeschlagen (${e.message || e.code})`;
        resolve(null);
      },
      { enableHighAccuracy: false, timeout, maximumAge: 60000 },
    );
  });
}

/** Ortsname zu Koordinaten, z. B. „Berlin · Mitte“ – oder null */
export async function reverseGeocode(lat, lon, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=de&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
    const j = await fetch(url, { signal: ctrl.signal }).then(r => (r.ok ? r.json() : null));
    const a = j?.address;
    if (!a) return null;
    const city = a.city || a.town || a.village || a.municipality || a.county;
    const part = a.suburb || a.city_district || a.borough || a.quarter || a.hamlet;
    return [city, part].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' · ') || null;
  } catch { return null; } finally { clearTimeout(t); }
}

/**
 * Standort für einen Verlaufseintrag bestimmen.
 * gpsPromise: bereits gestartete GPS-Abfrage (läuft parallel zum Test)
 * meta: Ergebnis von fetchMeta (für den IP-Standort)
 */
export async function resolveLocation(mode, gpsPromise, meta) {
  if (mode === 'off') return { loc: null, place: null };
  const gps = mode === 'gps' ? await gpsPromise : null;
  if (gps) return { loc: gps, place: await reverseGeocode(gps.lat, gps.lon) };
  const c = meta?.client;
  if (c) {
    if (mode === 'ip') lastStatus = 'IP-Standort';
    return { loc: { lat: c.lat, lon: c.lon, acc: null, src: 'ip' }, place: c.city };
  }
  return { loc: null, place: null };
}
