// Verlauf: Messungen lokal speichern und als Übersicht, Diagramm und Liste zeigen.
import { formatMbps } from './gauge.js';
import { CONN_LABELS } from './connection.js';

const KEY = 'history';
const MAX_ENTRIES = 300;
const NS = 'http://www.w3.org/2000/svg';

export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function saveHistory(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_ENTRIES))); } catch {}
}
export function addEntry(entry) {
  const list = loadHistory();
  list.push(entry);
  saveHistory(list);
}

const connGroup = c => (c === 'wifi' ? 'wifi' : c === 'cellular' ? 'cellular' : c === 'ethernet' ? 'ethernet' : 'other');
const GROUP_LABEL = { all: 'Alle', wifi: 'WLAN', cellular: 'Mobil', ethernet: 'LAN', other: 'Unbekannt' };

const fmtDate = ts => {
  const d = new Date(ts);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
};
const fmtMs = v => Math.round(v).toLocaleString('de-DE');
const avg = (list, k) => list.reduce((a, e) => a + e[k], 0) / list.length;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class HistoryView {
  constructor(sheet) {
    this.sheet = sheet;
    this.body = sheet.querySelector('.sheet-body');
    this.filter = 'all';
    sheet.querySelector('.sheet-close').addEventListener('click', () => this.close());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.isOpen) this.close(); });
    addEventListener('resize', () => this.isOpen && this.render());
  }

  get isOpen() { return !this.sheet.hidden; }

  open() {
    this.sheet.hidden = false;
    requestAnimationFrame(() => this.sheet.classList.add('open'));
    this.render();
  }

  close() {
    this.sheet.classList.remove('open');
    setTimeout(() => { this.sheet.hidden = true; }, 220);
  }

  render() {
    const all = loadHistory();
    this.body.replaceChildren();
    if (!all.length) {
      this.body.append(h('p', 'empty', 'Noch keine Messungen. Starte einen Test mit GO – jedes Ergebnis landet hier.'));
      return;
    }

    // Filter-Chips (nur vorhandene Verbindungsarten)
    const groups = ['all', ...['wifi', 'cellular', 'ethernet', 'other'].filter(g => all.some(e => connGroup(e.conn) === g))];
    if (!groups.includes(this.filter)) this.filter = 'all';
    if (groups.length > 2) {
      const chips = h('div', 'chips');
      for (const g of groups) {
        const b = h('button', 'chip' + (g === this.filter ? ' on' : ''), GROUP_LABEL[g]);
        b.type = 'button';
        b.addEventListener('click', () => { this.filter = g; this.render(); });
        chips.append(b);
      }
      this.body.append(chips);
    }

    const list = this.filter === 'all' ? all : all.filter(e => connGroup(e.conn) === this.filter);

    // Durchschnitt
    const stats = h('div', 'stats');
    for (const [label, val, unit, cls] of [
      ['Ø Download', formatMbps(avg(list, 'down')), 'Mbit/s', 'down'],
      ['Ø Upload', formatMbps(avg(list, 'up')), 'Mbit/s', 'up'],
      ['Ø Ping', fmtMs(avg(list, 'ping')), 'ms', 'ping'],
      ['Messungen', String(list.length), '', ''],
    ]) {
      const s = h('div', 'stat ' + cls);
      s.append(h('span', 'lbl', label), h('span', 'val', val), h('span', 'unit', unit));
      stats.append(s);
    }
    this.body.append(stats);

    // Diagramm
    this.body.append(this.chart(list.slice(-30)));

    // Liste (neueste zuerst)
    const ul = h('ul', 'entries');
    for (const e of [...list].reverse()) {
      const li = h('li');
      const left = h('div', 'e-left');
      left.append(h('span', 'e-date', fmtDate(e.t)));
      const sub = [CONN_LABELS[e.conn] || 'Verbindung unbekannt', e.isp].filter(Boolean).join(' · ');
      left.append(h('span', 'e-sub', sub));
      const right = h('div', 'e-right');
      right.append(h('span', 'e-down', `↓ ${formatMbps(e.down)}`), h('span', 'e-up', `↑ ${formatMbps(e.up)}`), h('span', 'e-ping', `${fmtMs(e.ping)} ms`));
      li.append(left, right);
      ul.append(li);
    }
    this.body.append(ul);

    const del = h('button', 'clear', 'Verlauf löschen');
    del.type = 'button';
    del.addEventListener('click', () => {
      if (confirm('Alle gespeicherten Messungen löschen?')) { saveHistory([]); this.render(); }
    });
    this.body.append(del);
  }

  chart(list) {
    const wrap = h('figure', 'chart');
    const cap = h('figcaption');
    cap.append(h('span', 'key down', 'Download'), h('span', 'key up', 'Upload'), h('span', 'note', list.length > 1 ? `letzte ${list.length} Messungen` : ''));
    wrap.append(cap);

    const cs = getComputedStyle(this.body);
    const inner = this.body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const W = Math.max(240, inner - 2), H = 150;
    const pad = { l: 34, r: 10, t: 10, b: 20 };
    const max = niceMax(Math.max(...list.map(e => Math.max(e.down, e.up))));
    const x = i => pad.l + (list.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (list.length - 1)) * (W - pad.l - pad.r));
    const y = v => pad.t + (1 - v / max) * (H - pad.t - pad.b);

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Download und Upload der letzten Messungen');
    const s = (tag, attrs, text) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text !== undefined) e.textContent = text;
      svg.append(e);
      return e;
    };

    for (const v of [0, max / 2, max]) {
      s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' });
      s('text', { x: pad.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, formatMbps(v));
    }
    s('text', { x: pad.l, y: H - 4, class: 'axis' }, fmtDate(list[0].t).split(' ')[0]);
    if (list.length > 1) s('text', { x: W - pad.r, y: H - 4, class: 'axis', 'text-anchor': 'end' }, fmtDate(list[list.length - 1].t).split(' ')[0]);

    for (const k of ['up', 'down']) {
      if (list.length > 1) s('path', { d: 'M' + list.map((e, i) => `${x(i)},${y(e[k])}`).join(' L'), class: `line ${k}` });
      list.forEach((e, i) => s('circle', { cx: x(i), cy: y(e[k]), r: 4, class: `dot ${k}` }));
    }

    // Hover / Tippen: Fadenkreuz + Tooltip mit allen Werten
    const cross = s('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' });
    const tip = h('div', 'tip');
    tip.hidden = true;
    const show = ev => {
      const r = svg.getBoundingClientRect();
      const px = ev.clientX - r.left;
      let i = 0, best = Infinity;
      list.forEach((_, j) => { const d = Math.abs(x(j) - px); if (d < best) { best = d; i = j; } });
      const e = list[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(
        h('div', 't-date', `${fmtDate(e.t)} · ${CONN_LABELS[e.conn] || 'unbekannt'}`),
        rowEl('down', formatMbps(e.down), 'Mbit/s Download'),
        rowEl('up', formatMbps(e.up), 'Mbit/s Upload'),
        rowEl('', fmtMs(e.ping), 'ms Ping'),
      );
      tip.hidden = false;
      const left = Math.min(Math.max(0, x(i) - 70), W - 150);
      tip.style.left = `${left}px`;
    };
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);

    const box = h('div', 'chart-box');
    box.append(svg, tip);
    wrap.append(box);
    return wrap;
  }
}

function rowEl(cls, val, label) {
  const r = h('div', 't-row ' + cls);
  r.append(h('i'), h('b', '', val), h('span', '', label));
  return r;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
