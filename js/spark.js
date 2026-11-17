// Live-Kurve unter dem Tacho: links Download, rechts Upload.
// Jede Hälfte hat eine eigene Skala – es geht um den Verlauf (stabil oder schwankend),
// die exakten Werte stehen in den Karten darunter.

const NS = 'http://www.w3.org/2000/svg';
const W = 100, H = 30;

export class Spark {
  constructor(container, maxTime) {
    this.maxTime = maxTime;
    this.halves = {};
    for (const kind of ['down', 'up']) {
      const half = document.createElement('div');
      half.className = `spark-half ${kind}`;
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      const area = document.createElementNS(NS, 'path');
      area.setAttribute('class', 'spark-area');
      const line = document.createElementNS(NS, 'path');
      line.setAttribute('class', 'spark-line');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(area, line);
      const label = document.createElement('span');
      label.className = 'spark-label';
      label.textContent = kind === 'down' ? '↓ Download' : '↑ Upload';
      half.append(svg, label);
      container.appendChild(half);
      this.halves[kind] = { half, area, line, pts: [] };
    }
  }

  reset() {
    for (const h of Object.values(this.halves)) { h.pts = []; this.draw(h); h.half.classList.remove('active'); }
  }

  add(kind, mbps, ms) {
    const h = this.halves[kind];
    h.pts.push([ms, mbps]);
    for (const o of Object.values(this.halves)) o.half.classList.toggle('active', o === h);
    this.draw(h);
  }

  done() { for (const h of Object.values(this.halves)) h.half.classList.remove('active'); }

  draw(h) {
    if (!h.pts.length) { h.area.setAttribute('d', ''); h.line.setAttribute('d', ''); return; }
    const max = Math.max(...h.pts.map(p => p[1])) * 1.15 || 1;
    const xy = h.pts.map(([t, v]) => [(Math.min(t, this.maxTime) / this.maxTime) * W, H - (v / max) * (H - 2)]);
    const d = 'M' + xy.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L');
    h.line.setAttribute('d', d);
    h.area.setAttribute('d', `${d} L${xy[xy.length - 1][0].toFixed(2)},${H} L${xy[0][0].toFixed(2)},${H} Z`);
  }
}
