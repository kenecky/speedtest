import { Gauge, formatMbps } from './gauge.js';
import { measurePing, measureThroughput, LIMITS, MAX_TIME } from './speedtest.js';
import { closeOnOutsideClick, pullToRefresh } from './ui.js';
import { watchConnection, currentConnection } from './connection.js';
import { fetchMeta, describeMeta } from './meta.js';
import { Spark } from './spark.js';
import { HistoryView, addEntry } from './history.js';

export const APP_VERSION = 'v6';

const SERVERS = {
  cloudflare: { label: 'Cloudflare (speed.cloudflare.com)', short: 'Cloudflare', base: 'https://speed.cloudflare.com' },
  self:       { label: 'Dieser Server (server/server.mjs)', short: 'Dieser Server', base: '' },
  custom:     { label: 'Eigene Adresse …', short: null, base: null },
};

const $ = id => document.getElementById(id);
const gauge = new Gauge($('gauge'), { onGo: () => run() });
const spark = new Spark($('spark'), MAX_TIME);
const history = new HistoryView($('history'));

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
if (!LIMITS[limitSel.value]) limitSel.value = 'normal';

const serverBase = () => (serverSel.value === 'custom' ? customUrl.value.trim() : SERVERS[serverSel.value].base);
const serverShort = () => (serverSel.value === 'custom' ? (customUrl.value.trim() || '–') : SERVERS[serverSel.value].short);

let meta = null;
async function refreshMeta() {
  const base = serverBase();
  if (!meta) $('meta').textContent = describeMeta(null, serverShort());
  const m = await fetchMeta(base);
  if (base !== serverBase()) return; // inzwischen anderer Server gewählt
  meta = m;
  $('meta').textContent = describeMeta(meta, serverShort());
  $('diagMeta').textContent = `Quelle: ${meta.source}` + (meta.isp ? `, ${meta.isp}` : '') + (meta.colo ? `, ${meta.colo}` : '');
}

let metaTimer;
function syncSettings(e) {
  customUrl.hidden = serverSel.value !== 'custom';
  store.set('server', serverSel.value);
  store.set('customUrl', customUrl.value.trim());
  store.set('limit', limitSel.value);
  if (e?.target === limitSel) return;
  meta = null;
  clearTimeout(metaTimer);
  metaTimer = setTimeout(refreshMeta, 400);
}
[serverSel, customUrl, limitSel].forEach(el => el.addEventListener('input', syncSettings));
syncSettings();
closeOnOutsideClick($('settings'));

watchConnection($('conn'), $('diagConn'));
$('diagVersion').textContent = APP_VERSION;

$('openHistory').addEventListener('click', () => history.open());

// ---------- Aktualisieren durch Herunterwischen (oberes Viertel) ----------

pullToRefresh($('ptr'), {
  canStart: e => !$('settings').contains(e.target) && !history.isOpen,
  onRefresh: () => location.reload(),
});

// ---------- Ablauf ----------

let running = null;
let idleTimer = null;

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
  if (running) return;
  clearTimeout(idleTimer);
  const ctrl = new AbortController();
  running = ctrl;
  document.body.classList.add('running');
  showError('');
  ['ping', 'jitter', 'down', 'up'].forEach(k => setResult(k, '–'));
  $('used').textContent = '0';
  spark.reset();

  const base = serverBase();
  const limit = LIMITS[limitSel.value];
  const conn = currentConnection();
  const metaPromise = refreshMeta().catch(() => {});
  let used = 0;

  try {
    gauge.setState('running');
    await gauge.sweep();
    if (ctrl.signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');

    // Ping
    setActive('ping');
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
        extend: limit.extend,
        signal: ctrl.signal,
        onSpeed: (v, ms) => { gauge.set(v); spark.add(kind, v, ms); },
      });
      result[kind] = r.mbps;
      used += r.bytes;
      $('used').textContent = fmtMB(used);
      setResult(kind, formatMbps(r.mbps));
      if (kind === 'up') {
        $('diagUpload').textContent = r.uploadMode === 'xhr'
          ? 'fein (mit Fortschritt)'
          : 'grob (Server erlaubt keinen Fortschritt)';
      }
      gauge.set(r.mbps);
      await new Promise(res => setTimeout(res, 600));
    }
    spark.done();

    await metaPromise;
    addEntry({
      t: Date.now(), conn, ping, jitter, down: result.down, up: result.up,
      isp: meta?.isp || null, colo: meta?.colo || null, server: serverShort(), used,
    });

    // Endstand: Zeiger zeigt den Download, danach wieder GO
    gauge.setState('done');
    gauge.set(result.down);
    gauge.setPhase('FERTIG', 'down');
    navigator.vibrate?.([40, 60, 40]);
    idleTimer = setTimeout(() => gauge.setState('idle'), 4000);
  } catch (e) {
    spark.done();
    gauge.setState('idle');
    gauge.setReadout('–', 'Mbit/s');
    if (e.name !== 'AbortError') showError(e.message);
  } finally {
    setActive(null);
    running = null;
    document.body.classList.remove('running');
  }
}

$('cancel').addEventListener('click', () => running?.abort());

// ---------- PWA ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
