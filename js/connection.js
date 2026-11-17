// Verbindungsart anzeigen (WLAN / Mobile Daten / LAN / Offline).
// navigator.connection.type gibt es nur in Chrome auf Android (und ChromeOS).
// Andere Browser (iPhone/Safari, Firefox, Desktop) verraten die Art nicht –
// dann bleibt das Feld ausgeblendet; nur „Offline“ wird überall erkannt.

const ICONS = {
  wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
  cellular: '<path d="M4 20v-3M9 20v-7M14 20v-11M19 20V4"/>',
  ethernet: '<rect x="4" y="9" width="16" height="10" rx="1.5"/><path d="M8 9V5h8v4M9 13v2M12 13v2M15 13v2"/>',
  offline: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M3 3l18 18"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
};

const TYPES = {
  wifi:      { label: 'WLAN',         icon: 'wifi' },
  cellular:  { label: 'Mobile Daten', icon: 'cellular' },
  ethernet:  { label: 'LAN',          icon: 'ethernet' },
  bluetooth: { label: 'Bluetooth',    icon: 'wifi' },
  wimax:     { label: 'WiMAX',        icon: 'cellular' },
};

export function currentConnection() {
  if (!navigator.onLine) return 'offline';
  return navigator.connection?.type ?? null; // null = unbekannt
}

export function watchConnection(el) {
  const render = () => {
    const type = currentConnection();
    const info = type === 'offline' ? { label: 'Offline', icon: 'offline' } : TYPES[type];
    el.hidden = !info;
    if (!info) return;
    el.dataset.type = type;
    el.title = `Verbindung: ${info.label}`;
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[info.icon]}</svg>${info.label}`;
  };
  render();
  navigator.connection?.addEventListener?.('change', render);
  addEventListener('online', render);
  addEventListener('offline', render);
}
