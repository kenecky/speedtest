// Tacho als SVG: 240°-Bogen, nichtlineare Skala, gedämpfter Zeiger,
// GO-Knopf in der Mitte, roter Bereich ab 500 Mbit/s, Startausschlag, Zittern.

const SCALE = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000];
const REDLINE = 500;
const START = -120, END = 120;          // Grad, 0 = oben
const CX = 160, CY = 160, R = 128;
const NS = 'http://www.w3.org/2000/svg';

function frac(v) {
  if (v <= 0) return 0;
  const n = SCALE.length - 1;
  for (let i = 0; i < n; i++) {
    if (v < SCALE[i + 1]) return (i + (v - SCALE[i]) / (SCALE[i + 1] - SCALE[i])) / n;
  }
  return 1;
}
const angleOf = f => START + (END - START) * f;

function pt(deg, r) {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}

function arcPath(r, from = START, to = END) {
  const [x1, y1] = pt(from, r), [x2, y2] = pt(to, r);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class Gauge {
  constructor(container, { onGo } = {}) {
    const svg = el('svg', { viewBox: '0 0 320 300', class: 'gauge', role: 'img', 'aria-label': 'Tacho' });
    container.appendChild(svg);

    el('path', { d: arcPath(R), class: 'g-track' }, svg);
    this.fill = el('path', { d: arcPath(R), class: 'g-fill', pathLength: 1, 'stroke-dasharray': '0 2' }, svg);
    // roter Bereich außen am Bogen
    el('path', { d: arcPath(R + 12, angleOf(frac(REDLINE)), END), class: 'g-red' }, svg);

    // Skalenstriche und Beschriftung
    const n = SCALE.length - 1;
    for (let i = 0; i <= n * 4; i++) {
      const deg = START + (END - START) * (i / (n * 4));
      const major = i % 4 === 0;
      const red = deg >= angleOf(frac(REDLINE)) - 0.01;
      const [x1, y1] = pt(deg, R - 16), [x2, y2] = pt(deg, R - (major ? 28 : 22));
      el('line', { x1, y1, x2, y2, class: `g-tick${major ? ' major' : ''}${red ? ' red' : ''}` }, svg);
      if (major) {
        const [tx, ty] = pt(deg, R - 44);
        const t = el('text', { x: tx, y: ty + 4, class: `g-label${red ? ' red' : ''}` }, svg);
        t.textContent = SCALE[i / 4];
      }
    }

    this.needle = el('g', { class: 'g-needle' }, svg);
    el('polygon', { points: `${CX - 5},${CY} ${CX},${CY - R + 22} ${CX + 5},${CY} ${CX},${CY + 18}` }, this.needle);
    el('circle', { cx: CX, cy: CY, r: 11, class: 'g-hub' }, svg);

    this.valueText = el('text', { x: CX, y: CY + 70, class: 'g-value' }, svg);
    this.unitText = el('text', { x: CX, y: CY + 94, class: 'g-unit' }, svg);
    this.phaseText = el('text', { x: CX, y: CY + 120, class: 'g-phase' }, svg);

    // GO-Knopf
    const go = el('g', { class: 'g-go', role: 'button', tabindex: '0', 'aria-label': 'Test starten' }, svg);
    el('circle', { cx: CX, cy: CY, r: 66, class: 'g-go-ring' }, go);
    el('circle', { cx: CX, cy: CY, r: 66, class: 'g-go-btn' }, go);
    const goText = el('text', { x: CX, y: CY + 12, class: 'g-go-text' }, go);
    goText.textContent = 'GO';
    const press = e => { e.preventDefault(); if (this.state === 'idle') onGo?.(); };
    go.addEventListener('click', press);
    go.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') press(e); });
    this.goBtn = go;

    this.svg = svg;
    this.target = 0;
    this.shown = 0;
    this.noise = 0;
    this.sweepAt = null;
    this.last = performance.now();
    this.readout = null;
    this.setState('idle');
    this.setReadout('–', 'Mbit/s');
    requestAnimationFrame(t => this.frame(t));
  }

  /** 'idle' (GO sichtbar) | 'running' | 'done' */
  setState(state) {
    this.state = state;
    this.svg.dataset.state = state;
    if (state === 'idle') { this.target = 0; this.shown = 0; this.setPhase('', ''); }
  }

  /** Zielwert in Mbit/s; der Zeiger folgt gedämpft */
  set(mbps) { this.target = Math.max(0, mbps); this.readout = null; }

  /** feste Anzeige statt Live-Wert (z. B. Ping) */
  setReadout(value, unit) { this.readout = { value, unit }; this.paintText(); }

  setPhase(text, kind) {
    this.phaseText.textContent = text;
    this.svg.dataset.kind = kind || '';
  }

  /** Startausschlag: Nadel einmal voll nach rechts und zurück (wie beim Motorstart) */
  sweep(ms = 1100) {
    this.sweepAt = performance.now();
    this.sweepMs = ms;
    this.setReadout('', '');
    return new Promise(res => setTimeout(res, ms));
  }

  paintText() {
    if (this.readout) {
      this.valueText.textContent = this.readout.value;
      this.unitText.textContent = this.readout.unit;
    } else {
      this.valueText.textContent = formatMbps(this.shown);
      this.unitText.textContent = 'Mbit/s';
    }
  }

  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    let f;
    if (this.sweepAt !== null) {
      const p = (t - this.sweepAt) / this.sweepMs;
      if (p >= 1) { this.sweepAt = null; f = 0; }
      else f = p < 0.45 ? easeInOut(p / 0.45) : 1 - easeInOut((p - 0.45) / 0.55);
    } else {
      // Trägheit wie bei einer echten Nadel
      this.shown += (this.target - this.shown) * (1 - Math.exp(-dt / 0.22));
      if (Math.abs(this.target - this.shown) < 0.005) this.shown = this.target;
      f = frac(this.shown);
    }
    let angle = angleOf(f);
    // leichtes Zittern bei Tempo, stärker je schneller
    if (this.state === 'running' && this.sweepAt === null && f > 0.05) {
      this.noise = this.noise * 0.6 + (Math.random() - 0.5) * 0.4;
      angle += this.noise * (0.6 + 2.4 * f);
    }
    this.needle.style.transform = `rotate(${angle}deg)`;
    this.fill.setAttribute('stroke-dasharray', `${f} 2`);
    this.fill.style.opacity = f > 0.002 ? 1 : 0;
    this.svg.classList.toggle('in-red', f >= frac(REDLINE));
    this.paintText();
    requestAnimationFrame(tt => this.frame(tt));
  }
}

export function formatMbps(v) {
  return v < 10
    ? v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : Math.round(v).toLocaleString('de-DE');
}
