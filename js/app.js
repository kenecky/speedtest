import { Gauge, formatMbps } from './gauge.js';
import { measurePing, measureThroughput, LIMITS } from './speedtest.js';

const SERVERS = {
  cloudflare: { label: 'Cloudflare (speed.cloudflare.com)', base: 'https://speed.cloudflare.com' },
  self:       { label: 'Dieser Server (server/server.mjs)', base: '' },
  custom:     { label: 'Eigene Adresse …', base: null },
};

const $ = id => document.getElementById(id);
const gauge = new Gauge($('gauge'));

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- Einstellungen ----------

const serverSel = $('server'), customUrl = $('customUrl'), limitSel = $('limit');
for (const [k, s] of Object.entries(SERVERS)) serverSel.add(new Option(s.label, k));
for (const [k, l] of Object.entries(LIMITS)) limitSel.add(new Option(l.label, k));
serverSel.value = store.get('server', 'cloudflare');
customUrl.value = store.get('customUrl', '');
limitSel.value = store.get('limit', 'normal');

function syncSettings() {
  customUrl.hidden = serverSel.value !== 'custom';
  store.set('server', serverSel.value);
  store.set('customUrl', customUrl.value.trim());
  store.set('limit', limitSel.value);
  $('serverName').textContent = serverSel.value === 'custom'
    ? (customUrl.value.trim() || '–')
    : SERVERS[serverSel.value].label.replace(/ \(.*\)$/, '');
}
[serverSel, customUrl, limitSel].forEach(e => e.addEventListener('input', syncSettings));
syncSettings();

function serverBase() {
  return serverSel.value === 'custom' ? customUrl.value.trim() : SERVERS[serverSel.value].base;
}

// ---------- Ablauf ----------

const btn = $('start');
let running = null;

const fmtMs = v => Math.round(v).toLocaleString('de-DE');
const fmtMB = b => (b / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 });

function setResult(id, text) {
  const e = $(id);
  e.textContent = text;
  e.closest('.res').classList.toggle('done', text !== '–');
}

function setActive(id) {
  document.querySelectorAll('.res').forEach(r => r.classList.toggle('active', r.dataset.k === id));
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

async function run() {
  const ctrl = new AbortController();
  running = ctrl;
  btn.textContent = 'Abbrechen';
  btn.classList.add('running');
  showError('');
  ['ping', 'jitter', 'down', 'up'].forEach(k => setResult(k, '–'));
  $('used').textContent = '0';

  const base = serverBase();
  const limit = LIMITS[limitSel.value];
  let used = 0;

  try {
    // Ping
    setActive('ping');
    gauge.set(0);
    gauge.setPhase('PING', 'ping');
    gauge.setReadout('…', 'ms');
    const { ping, jitter } = await measurePing(base, {
      signal: ctrl.signal,
      onSample: ms => gauge.setReadout(fmtMs(ms), 'ms'),
    });
    setResult('ping', fmtMs(ping));
    setResult('jitter', fmtMs(jitter));

    // Download & Upload
    const result = {};
    for (const kind of ['down', 'up']) {
      setActive(kind);
      gauge.setPhase(kind === 'down' ? 'DOWNLOAD' : 'UPLOAD', kind);
      gauge.set(0);
      const r = await measureThroughput(kind, base, {
        maxBytes: limit[kind],
        signal: ctrl.signal,
        onSpeed: v => gauge.set(v),
      });
      result[kind] = r.mbps;
      used += r.bytes;
      $('used').textContent = fmtMB(used);
      setResult(kind, formatMbps(r.mbps));
      gauge.set(r.mbps);
      await new Promise(res => setTimeout(res, 600));
    }

    // Endstand: Zeiger zeigt den Download
    gauge.set(result.down);
    gauge.setPhase('FERTIG · DOWNLOAD', 'down');
  } catch (e) {
    gauge.set(0);
    gauge.setPhase('', '');
    gauge.setReadout('–', 'Mbit/s');
    if (e.name !== 'AbortError') showError(e.message);
  } finally {
    setActive(null);
    running = null;
    btn.textContent = 'Start';
    btn.classList.remove('running');
  }
}

btn.addEventListener('click', () => (running ? running.abort() : run()));

// ---------- PWA ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
