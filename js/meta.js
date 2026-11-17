// Anbieter (Provider) und Serverstandort ermitteln.
// Cloudflare kennt beides: /meta (JSON), die cf-meta-*-Header von /__down
// oder /cdn-cgi/trace (nur Standort). Alles optional – schlägt etwas fehl,
// wird einfach nichts angezeigt.

const COLOS = {
  FRA: 'Frankfurt', DUS: 'Düsseldorf', HAM: 'Hamburg', MUC: 'München', BER: 'Berlin', TXL: 'Berlin',
  STR: 'Stuttgart', NUE: 'Nürnberg', LEJ: 'Leipzig', HAJ: 'Hannover', CGN: 'Köln', BRE: 'Bremen',
  VIE: 'Wien', ZRH: 'Zürich', GVA: 'Genf', AMS: 'Amsterdam', BRU: 'Brüssel', LUX: 'Luxemburg',
  PRG: 'Prag', WAW: 'Warschau', CPH: 'Kopenhagen', CDG: 'Paris', MRS: 'Marseille', LHR: 'London',
  MAN: 'Manchester', DUB: 'Dublin', MXP: 'Mailand', FCO: 'Rom', MAD: 'Madrid', BCN: 'Barcelona',
  PMI: 'Palma', LIS: 'Lissabon', ARN: 'Stockholm', OSL: 'Oslo', HEL: 'Helsinki', BUD: 'Budapest',
  ATH: 'Athen', IST: 'Istanbul', SOF: 'Sofia', OTP: 'Bukarest', ZAG: 'Zagreb', LJU: 'Ljubljana',
};

// Falls nur die AS-Nummer bekannt ist
const ASNS = {
  3320: 'Telekom', 3209: 'Vodafone', 31334: 'Vodafone Kabel', 29562: 'Vodafone',
  6805: 'O2 Telefónica', 8881: '1&1 Versatel', 8422: 'NetCologne', 6830: 'Liberty Global',
  20676: 'Plusnet', 35244: 'Deutsche Glasfaser', 60294: 'Deutsche Glasfaser', 8767: 'M-net',
  8447: 'A1', 25255: 'Magenta', 3303: 'Swisscom', 6730: 'Sunrise', 15600: 'Quickline',
};

const SHORT = [
  [/deutsche telekom/i, 'Telekom'], [/vodafone/i, 'Vodafone'], [/telefonica|telefónica|\bo2\b/i, 'O2 Telefónica'],
  [/1&1|versatel/i, '1&1'], [/deutsche glasfaser/i, 'Deutsche Glasfaser'], [/netcologne/i, 'NetCologne'],
  [/m-net/i, 'M-net'], [/swisscom/i, 'Swisscom'], [/magenta/i, 'Magenta'], [/^a1 /i, 'A1'],
];

export function shortIsp(name) {
  if (!name) return null;
  for (const [re, short] of SHORT) if (re.test(name)) return short;
  return name.replace(/\s+(AG|GmbH|SE|Ltd\.?|Inc\.?|B\.V\.|S\.A\.)$/i, '').trim();
}

export const coloName = code => (code ? COLOS[code.toUpperCase()] || code.toUpperCase() : null);

const join = (base, path) => base.replace(/\/+$/, '') + path;

async function withTimeout(promiseFn, ms = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await promiseFn(ctrl.signal); } finally { clearTimeout(t); }
}

/** → { isp, colo, city, source } – Felder können null sein */
export async function fetchMeta(base) {
  const out = { isp: null, colo: null, city: null, source: 'keine' };

  // 1) JSON-Endpunkt
  try {
    const j = await withTimeout(sig => fetch(join(base, '/meta'), { cache: 'no-store', signal: sig }).then(r => r.ok ? r.json() : null));
    if (j && typeof j === 'object') {
      out.isp = shortIsp(j.asOrganization) || (j.asn ? ASNS[j.asn] || `AS${j.asn}` : null);
      out.colo = j.colo || null;
      out.city = j.server || null; // eigener Server liefert „server“
      if (out.isp || out.colo || out.city) { out.source = '/meta'; return out; }
    }
  } catch {}

  // 2) Header der Download-Antwort
  try {
    const h = await withTimeout(sig => fetch(join(base, '/__down?bytes=0'), { cache: 'no-store', signal: sig }).then(r => r.headers));
    const asn = h.get('cf-meta-asn');
    out.isp = asn ? ASNS[asn] || `AS${asn}` : null;
    out.colo = h.get('cf-meta-colo');
    if (out.isp || out.colo) { out.source = 'Header'; return out; }
  } catch {}

  // 3) Trace (nur Standort)
  try {
    const txt = await withTimeout(sig => fetch(join(base, '/cdn-cgi/trace'), { cache: 'no-store', signal: sig }).then(r => r.ok ? r.text() : ''));
    const colo = /^colo=(\w+)/m.exec(txt)?.[1];
    if (colo) { out.colo = colo; out.source = 'Trace'; }
  } catch {}

  return out;
}

/** Text für die Fußzeile, z. B. „Telekom · Server Frankfurt“ */
export function describeMeta(meta, fallbackServer) {
  if (!meta) return `Server: ${fallbackServer}`;
  const server = meta.city || (meta.colo ? `Server ${coloName(meta.colo)}` : `Server: ${fallbackServer}`);
  return meta.isp ? `${meta.isp} · ${server}` : server;
}
