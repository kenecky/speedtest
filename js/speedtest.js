// Messlogik: Ping, Download, Upload gegen einen Server mit
//   GET  /__down?bytes=N  -> liefert N Bytes
//   POST /__up            -> nimmt den Body an und verwirft ihn
// (gleiche Schnittstelle wie speed.cloudflare.com und server/server.mjs)

export const LIMITS = {
  // extend: bei sehr schnellen Leitungen darf das Limit bis auf das x-Fache wachsen
  klein:  { label: 'Klein (ca. 10 MB)',  down: 6e6,   up: 4e6,  extend: 1 },
  normal: { label: 'Normal (ca. 35 MB, bei Gigabit mehr)', down: 25e6,  up: 10e6, extend: 4 },
  genau:  { label: 'Genau (ca. 150 MB)', down: 100e6, up: 50e6, extend: 2 },
};

const CFG = {
  pingCount: 10,
  maxTime: 8000,        // ms pro Richtung (höchstens)
  minMeasureMs: 3000,   // so lange nach der Anlaufphase mindestens messen (Limit wächst ggf. mit)
  stableCount: 20,      // so viele Werte (à 100 ms) müssen für einen frühen Stopp ruhig sein
  warmupMs: 700,        // Anlaufphase, fließt nicht ins Ergebnis ein
  windowMs: 1000,       // Fenster für die Live-Anzeige
  tickMs: 100,
  targetReqMs: 300,     // Paketgröße wächst, bis eine Anfrage ~so lange dauert
  down: { streams: 4, startSize: 100e3, maxSize: 20e6 },
  up:   { streams: 4, startSize: 256e3,  maxSize: 4e6 },
};

const join = (base, path) => base.replace(/\/+$/, '') + path;

function isCrossOrigin(base) {
  try { return new URL(base, location.href).origin !== location.origin; }
  catch { return true; }
}

export class TestError extends Error {}

function wrapNetError(e, what) {
  if (e.name === 'AbortError' || e instanceof TestError) return e;
  return new TestError(`${what} fehlgeschlagen – Server nicht erreichbar oder blockiert (CORS). ${e.message || ''}`.trim());
}

// ---------- Ping ----------

export async function measurePing(base, { signal, onSample } = {}) {
  // no-cors: für reine Zeitmessung braucht der Server kein CORS
  const mode = isCrossOrigin(base) ? 'no-cors' : 'cors';
  const times = [];
  for (let i = 0; i <= CFG.pingCount; i++) {
    const t0 = performance.now();
    try {
      await fetch(join(base, '/__down?bytes=0'), { cache: 'no-store', mode, signal });
    } catch (e) { throw wrapNetError(e, 'Ping'); }
    const dt = performance.now() - t0;
    if (i === 0) continue; // erste Anfrage baut die Verbindung auf
    times.push(dt);
    onSample?.(dt);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let jitter = 0;
  for (let i = 1; i < times.length; i++) jitter += Math.abs(times[i] - times[i - 1]);
  jitter /= times.length - 1;
  return { ping: median, jitter };
}

// ---------- Durchsatz ----------

let payload = null;
function getPayload(size) {
  if (!payload || payload.length < size) {
    payload = new Uint8Array(size);
    for (let o = 0; o < size; o += 65536) crypto.getRandomValues(payload.subarray(o, Math.min(size, o + 65536)));
  }
  return payload;
}

async function downloadOnce(base, size, signal, onBytes) {
  const res = await fetch(join(base, `/__down?bytes=${Math.round(size)}`), { cache: 'no-store', signal });
  if (!res.ok) throw new TestError(`Download: Server antwortet mit HTTP ${res.status}`);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onBytes(value.byteLength);
  }
}

async function uploadFetch(base, body, signal, mode) {
  await fetch(join(base, '/__up'), { method: 'POST', body, cache: 'no-store', mode, signal });
}

// Upload mit Fortschritt: zählt Bytes laufend statt erst am Ende einer Anfrage.
// Braucht CORS mit Preflight – sonst Rückfall auf fetch (siehe xhrBroken).
function uploadXhr(base, body, signal, onBytes) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    let sent = 0;
    const credit = n => { if (n > 0) { sent += n; onBytes(n); } };
    x.open('POST', join(base, '/__up'));
    x.upload.onprogress = e => credit(e.loaded - sent);
    x.onload = () => { credit(body.byteLength - sent); resolve(); };
    x.onerror = () => reject(Object.assign(new TypeError('XHR-Upload fehlgeschlagen'), { xhr: true, sent }));
    x.onabort = () => reject(new DOMException('Abgebrochen', 'AbortError'));
    signal.addEventListener('abort', () => x.abort(), { once: true });
    x.send(body);
  });
}
const xhrBroken = new Set(); // Server, bei denen XHR-Upload (Preflight) nicht klappt

function speedBetween(a, b) {
  const dt = b.t - a.t;
  return dt > 0 ? ((b.b - a.b) * 8) / (dt / 1000) / 1e6 : 0; // Mbit/s
}

/**
 * kind: 'down' | 'up'
 * maxBytes: Datenlimit für diese Richtung
 * extend: Faktor, bis zu dem das Limit bei sehr schnellen Leitungen wachsen darf
 * onSpeed(mbps, ms): Live-Wert für Tacho und Kurve
 * Rückgabe: { mbps, bytes, ms, extended, uploadMode }
 */
export function measureThroughput(kind, base, { maxBytes, extend = 1, streams, signal, onSpeed }) {
  const cfg = CFG[kind];
  const streamCount = streams || cfg.streams;
  const ctrl = new AbortController();
  const abortOuter = () => ctrl.abort();
  signal?.addEventListener('abort', abortOuter);
  const mode = isCrossOrigin(base) ? 'no-cors' : 'cors';
  let useXhr = kind === 'up' && !xhrBroken.has(base);

  const t0 = performance.now();
  let cap = maxBytes;
  const capMax = maxBytes * extend;
  let bytes = 0;      // gemessene Bytes
  let used = 0;       // tatsächlich übertragen (inkl. abgebrochener Anfragen)
  let size = cfg.startSize;
  let stopped = false;
  let failure = null;
  let finishNow = () => {};

  // Limit erreicht? Sehr schnelle Leitungen (Limit schon in der Anlaufphase
  // aufgebraucht) bekommen mehr Daten, damit das volle Tempo messbar wird.
  const capReached = () => {
    const done = kind === 'up' ? bytes >= cap : used >= cap;
    if (!done) return false;
    if (cap < capMax && performance.now() - t0 < CFG.warmupMs + CFG.minMeasureMs) {
      cap = Math.min(capMax, cap * 2);
      return false;
    }
    return true;
  };

  const worker = async () => {
    while (!stopped) {
      const remaining = cap - used;
      if (remaining <= 0) {
        if (capReached()) return;
        // Limit verplant, aber evtl. noch nicht erreicht/erweitert: kurz warten
        if (cap - used <= 0) await new Promise(r => setTimeout(r, 50));
        continue;
      }
      const s = Math.min(size, remaining); // Limit wird nie überschritten
      const r0 = performance.now();
      try {
        if (kind === 'down') {
          await downloadOnce(base, s, ctrl.signal, n => {
            bytes += n; used += n;
            if (used >= cap && capReached()) finishNow();
          });
        } else {
          used += s;
          const body = getPayload(CFG.up.maxSize).subarray(0, Math.round(s));
          if (useXhr) {
            try {
              await uploadXhr(base, body, ctrl.signal, n => { if (!stopped) bytes += n; });
            } catch (e) {
              if (!e.xhr || stopped) throw e;
              // Server erlaubt keinen XHR-Upload -> ab jetzt fetch ohne Fortschritt
              useXhr = false;
              xhrBroken.add(base);
              used -= s - e.sent;
              continue;
            }
          } else {
            await uploadFetch(base, body, ctrl.signal, mode);
            if (!stopped) bytes += s;
          }
        }
      } catch (e) {
        if (!stopped) { failure = wrapNetError(e, kind === 'down' ? 'Download' : 'Upload'); stopped = true; }
        return;
      }
      if (performance.now() - r0 < CFG.targetReqMs) size = Math.min(cfg.maxSize, size * 2);
    }
  };

  return new Promise((resolve, reject) => {
    const samples = [{ t: 0, b: 0 }];
    const recent = [];
    const windows = []; // 1-s-Werte, die komplett nach der Anlaufphase liegen
    const workers = Array.from({ length: streamCount }, worker);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      stopped = true;
      ctrl.abort();
      signal?.removeEventListener('abort', abortOuter);
      Promise.allSettled(workers).then(() => {
        if (signal?.aborted) return reject(new DOMException('Abgebrochen', 'AbortError'));
        if (failure) return reject(failure);
        const last = samples[samples.length - 1];
        // Durchschnitt ohne Anlaufphase (Rückfall bei sehr kurzen Messungen)
        let from = samples.find(s => s.t >= CFG.warmupMs);
        if (!from || last.t - from.t < 500) from = samples[0];
        const avg = speedBetween(from, last);
        // Ergebnis = Median der 1-s-Werte: kurze Ausreißer zählen kaum.
        // Schwankung = 10. bis 90. Perzentil.
        const sorted = [...windows].sort((a, b) => a - b);
        const enough = sorted.length >= 5;
        resolve({
          mbps: enough ? quantile(sorted, 0.5) : avg,
          low: enough ? quantile(sorted, 0.1) : null,
          high: enough ? quantile(sorted, 0.9) : null,
          avg, streams: streamCount,
          bytes: used, ms: last.t,
          extended: cap > maxBytes,
          uploadMode: kind === 'up' ? (useXhr ? 'xhr' : 'fetch') : undefined,
        });
      });
    };
    finishNow = () => { samples.push({ t: performance.now() - t0, b: bytes }); finish(); };

    const timer = setInterval(() => {
      const now = { t: performance.now() - t0, b: bytes };
      samples.push(now);
      const old = samples.find(s => s.t >= now.t - CFG.windowMs) || samples[0];
      const cur = speedBetween(old === now ? samples[0] : old, now);
      onSpeed?.(cur, now.t);
      if (old.t >= CFG.warmupMs - 1 && now.t - old.t >= CFG.windowMs * 0.8) windows.push(cur);

      if (now.t > CFG.warmupMs) recent.push(cur);
      if (recent.length > CFG.stableCount) recent.shift();
      const mean = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
      const stable = recent.length === CFG.stableCount && now.t > CFG.warmupMs + CFG.minMeasureMs &&
        recent.every(v => Math.abs(v - mean) <= mean * 0.07);

      if (failure || signal?.aborted || now.t >= CFG.maxTime || stable || capReached()) finish();
    }, CFG.tickMs);
  });
}

export const MAX_TIME = CFG.maxTime;

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export const STREAM_MODES = {
  multi:  { label: '4 Verbindungen (Standard)', streams: 4 },
  single: { label: '1 Verbindung (wie Google)', streams: 1 },
  both:   { label: 'Beide vergleichen (mehr Daten)', streams: 4 },
};
