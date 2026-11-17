// Tacho als SVG: 240°-Bogen, nichtlineare Skala, gedämpfter Zeiger.

const SCALE = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000];
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

export class Gauge {
  constructor(container) {
    const svg = el('svg', { viewBox: '0 0 320 300', class: 'gauge', role: 'img', 'aria-label': 'Tacho' });
    container.appendChild(svg);

    el('path', { d: arcPath(R), class: 'g-track' }, svg);
    this.fill = el('path', { d: arcPath(R), class: 'g-fill', pathLength: 1, 'stroke-dasharray': '0 1' }, svg);

    // Skalenstriche und Beschriftung
    const n = SCALE.length - 1;
    for (let i = 0; i <= n * 4; i++) {
      const deg = START + (END - START) * (i / (n * 4));
      const major = i % 4 === 0;
      const [x1, y1] = pt(deg, R - 16), [x2, y2] = pt(deg, R - (major ? 28 : 22));
      el('line', { x1, y1, x2, y2, class: major ? 'g-tick major' : 'g-tick' }, svg);
      if (major) {
        const [tx, ty] = pt(deg, R - 44);
        const t = el('text', { x: tx, y: ty + 4, class: 'g-label' }, svg);
        t.textContent = SCALE[i / 4];
      }
    }

    this.needle = el('g', { class: 'g-needle' }, svg);
    el('polygon', { points: `${CX - 5},${CY} ${CX},${CY - R + 22} ${CX + 5},${CY} ${CX},${CY + 18}` }, this.needle);
    el('circle', { cx: CX, cy: CY, r: 11, class: 'g-hub' }, svg);

    this.valueText = el('text', { x: CX, y: CY + 70, class: 'g-value' }, svg);
    this.unitText = el('text', { x: CX, y: CY + 94, class: 'g-unit' }, svg);
    this.phaseText = el('text', { x: CX, y: CY - 48, class: 'g-phase' }, svg);

    this.svg = svg;
    this.target = 0;
    this.shown = 0;
    this.last = performance.now();
    this.readout = null;
    this.setReadout('–', 'Mbit/s');
    requestAnimationFrame(t => this.frame(t));
  }

  /** Zielwert in Mbit/s; der Zeiger folgt gedämpft */
  set(mbps) { this.target = Math.max(0, mbps); this.readout = null; }

  /** feste Anzeige statt Live-Wert (z. B. Ping) */
  setReadout(value, unit) { this.readout = { value, unit }; this.paintText(); }

  setPhase(text, kind) {
    this.phaseText.textContent = text;
    this.svg.dataset.kind = kind || '';
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
    // Trägheit wie bei einer echten Nadel
    this.shown += (this.target - this.shown) * (1 - Math.exp(-dt / 0.22));
    if (Math.abs(this.target - this.shown) < 0.005) this.shown = this.target;
    const f = frac(this.shown);
    this.needle.style.transform = `rotate(${START + (END - START) * f}deg)`;
    this.fill.setAttribute('stroke-dasharray', `${f} 2`);
    this.fill.style.opacity = f > 0.002 ? 1 : 0;
    this.paintText();
    requestAnimationFrame(tt => this.frame(tt));
  }
}

export function formatMbps(v) {
  return v < 10
    ? v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : Math.round(v).toLocaleString('de-DE');
}
