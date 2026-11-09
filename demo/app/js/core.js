// Capxul's shell: the frame, the router and the shared components every module uses.
// A module is an ES module in this folder: `import { cx, h } from './core.js'`, then register workspaces and routes
// at its top level. The shell loads data.json first, then every module, then renders the hash. See README.md.

const MODULES = ['money', 'governance', 'fde', 'accounting', 'hr', 'payroll', 'crm', 'projects'];
const RESERVED = new Set(['settings', 'sidebar', 'customize', 'upgrade', 'downloads']);
const SVGNS = 'http://www.w3.org/2000/svg';
const STORE = 'capxul-mock:';

export const cx = { version: 1 };
let D = null;

/* =====================================================================================================
   DOM helpers
   ===================================================================================================== */

function isProps(p) {
  return p && typeof p === 'object' && !(p instanceof Node) && !Array.isArray(p);
}
function addKids(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) addKids(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  }
}
/** Empty an element and add children (null, false and arrays are fine). */
function fill(el, ...kids) { if (!el) return el; el.textContent = ''; addKids(el, kids); return el; }
function classOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(classOf).filter(Boolean).join(' ');
  return Object.keys(v).filter((k) => v[k]).join(' ');
}
function setProps(el, props, svg) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') {
      const c = classOf(v);
      if (c) el.setAttribute('class', ((el.getAttribute('class') || '') + ' ' + c).trim());
    } else if (k === 'style') {
      if (typeof v === 'string') el.style.cssText += ';' + v;
      else for (const [sk, sv] of Object.entries(v)) if (sv != null) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(sv));
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'html') {
      el.innerHTML = v;
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (!svg && ['value', 'checked', 'disabled', 'selected', 'indeterminate', 'hidden', 'open'].includes(k)) {
      el[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
}

/** h('div.card#id', { class, style, onClick, ... }, ...children) makes an HTML element. */
export function h(tag, props, ...kids) {
  if (!isProps(props)) { if (props !== undefined) kids.unshift(props); props = {}; }
  const m = /^[a-zA-Z0-9-]*/.exec(tag)[0];
  const el = document.createElement(m || 'div');
  const rest = tag.slice(m.length);
  if (rest) for (const part of rest.split(/(?=[.#])/)) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else if (part[0] === '#') el.id = part.slice(1);
  }
  setProps(el, props, false);
  addKids(el, kids);
  return el;
}
/** s('rect', { x, y, style }, ...children) makes an SVG element. */
export function s(tag, props, ...kids) {
  if (!isProps(props)) { if (props !== undefined) kids.unshift(props); props = {}; }
  const el = document.createElementNS(SVGNS, tag);
  setProps(el, props, true);
  addKids(el, kids);
  return el;
}
cx.h = h;
cx.s = s;
cx.fill = fill;
cx.frag = (...kids) => { const f = document.createDocumentFragment(); addKids(f, kids); return f; };
cx.esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
cx.style = (id, css) => {
  let el = document.getElementById('style-' + id);
  if (!el) { el = h('style', { id: 'style-' + id }); document.head.appendChild(el); }
  el.textContent = css;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(STORE + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(STORE + k, JSON.stringify(v)); } catch { /* storage may be blocked */ } },
};
cx.store = store;

/* =====================================================================================================
   Icons (24px line icons, drawn for Capxul)
   ===================================================================================================== */

const ICONS = {
  home: 'M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z',
  approvals: 'M4 13.5h4.2l1.4 2.5h4.8l1.4-2.5H20 M4 13.5 6.4 5h11.2l2.4 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
  money: 'M4 4.5h16v14H4z M7 18.5V21 M17 18.5V21 M15 11.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M12 11.5h3',
  departments: 'M10 3h4v4h-4z M3.5 17h5v4h-5z M15.5 17h5v4h-5z M12 7v5 M6 17v-2.5h12V17',
  books: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11 M9 8h6',
  hr: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.3a6.5 6.5 0 0 1 3.5 5.7',
  payroll: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',
  crm: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h.01',
  projects: 'M4 4h4.5v16H4z M10 4h4.5v10H10z M16 4h4v7h-4z',
  board: 'M12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M8.4 14 7 21l5-2.6 5 2.6-1.4-7',
  seats: 'M7 11V5.5A2.5 2.5 0 0 1 9.5 3h5A2.5 2.5 0 0 1 17 5.5V11 M5 11h14v4H5z M7 15v6 M17 15v6',
  fde: 'M12 3.5 13.7 8.3 18.5 10l-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z M10 21h4',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  down: 'M6 9l6 6 6-6',
  right: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  up: 'M6 15l6-6 6 6',
  x: 'M6 6l12 12 M18 6 6 18',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  check: 'M5 12.5l4.5 4.5L19 7',
  plus: 'M12 5v14 M5 12h14',
  filter: 'M4 5h16l-6 7.5V19l-4 2v-8.5z',
  sort: 'M7 4v16 M3 8l4-4 4 4 M17 20V4 M13 16l4 4 4-4',
  refresh: 'M19.5 10A8 8 0 0 0 5.2 7.4L4 9 M4 4.5V9h4.5 M4.5 14a8 8 0 0 0 14.3 2.6L20 15 M20 19.5V15h-4.5',
  lock: 'M6 11h12v10H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  in: 'M17 7 7 17 M7 9v8h8',
  out: 'M7 17 17 7 M9 7h8v8',
  swap: 'M4 8h15l-3.5-3.5 M20 16H5l3.5 3.5',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z M8.5 12l2.5 2.5 4.5-5',
  terminal: 'M4 5h16v14H4z M7.5 9.5 10 12l-2.5 2.5 M12.5 15h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 21a7.5 7.5 0 0 1 15 0',
  calendar: 'M4 6h16v15H4z M4 10h16 M8 3v4 M16 3v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  message: 'M4 20l1.3-3.9A8 8 0 1 1 8 19z',
  note: 'M5 4h10l4 4v12H5z M15 4v4h4 M8 13h8 M8 17h5',
  task: 'M5 5h14v14H5z M8.5 12l2.5 2.5 4.5-5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  list: 'M8.5 6H20 M8.5 12H20 M8.5 18H20 M4 6h.01 M4 12h.01 M4 18h.01',
  report: 'M4 5h16v14H4z M4 10h16 M4 14.5h16 M10 5v14',
  tree: 'M4 4.5h6 M7 4.5V19 M7 11.5h7 M7 19h7 M16 9.5h4v4h-4z M16 17h4v4h-4z',
  chart: 'M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6',
  kanban: 'M4 4h4.5v16H4z M10 4h4.5v10H10z M16 4h4v7h-4z',
  file: 'M6 3h8l5 5v13H6z M14 3v5h5',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  send: 'M4 12 20 4l-6 16-3-7z M11 13l9-9',
  alert: 'M12 3.5 2.5 20h19z M12 10v4 M12 17h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01',
  hat: 'M3 17c3 1.5 15 1.5 18 0 M6 16.5V11a6 6 0 0 1 12 0v5.5 M6 13h12',
  bank: 'M3 21h18 M4.5 10h15 M12 3l8.5 4.5h-17z M6.5 10v8 M10.5 10v8 M13.5 10v8 M17.5 10v8',
  key: 'M8 15a4.5 4.5 0 1 1 3.6-1.8L21 22.5h-3.2l-1.6-1.6-1.6 1.6-1.7-1.7 1.6-1.6-2.1-2.1 M7 11h.01',
  passkey: 'M12 11v4 M8.6 8.6A5 5 0 0 1 17 12v2 M7 12v1a10 10 0 0 0 1.5 5 M16 17.5a14 14 0 0 1-.9 2.5 M12 3a9 9 0 0 1 9 9 M3 12a9 9 0 0 1 4-7.5',
  hourglass: 'M7 3h10 M7 21h10 M8 3c0 5 8 5 8 9s-8 4-8 9 M16 3c0 5-8 5-8 9s8 4 8 9',
  comment: 'M4 5h16v11H9l-5 4z',
  chain: 'M9.5 14.5l5-5 M7 11l-2 2a3.5 3.5 0 0 0 5 5l2-2 M12 7l2-2a3.5 3.5 0 0 1 5 5l-2 2',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z',
};
/** cx.icon('name', { size }) returns an inline SVG line icon. */
cx.icon = (name, o = {}) => {
  const svg = s('svg', { class: 'ic' + (o.class ? ' ' + o.class : ''), viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  if (o.size) { svg.style.width = o.size + 'px'; svg.style.height = o.size + 'px'; }
  const d = ICONS[name] || ICONS.info;
  svg.appendChild(s('path', { d, style: name === 'more' ? 'stroke-width:3' : null }));
  return svg;
};
cx.icons = Object.keys(ICONS);

/* =====================================================================================================
   Formatting
   ===================================================================================================== */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NF = new Map();
function nf(dp) {
  if (!NF.has(dp)) NF.set(dp, new Intl.NumberFormat('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  return NF.get(dp);
}
const MINUS = '−';
const LONDON = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function london(iso) {
  const parts = Object.fromEntries(LONDON.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, hh: parts.hour, mm: parts.minute, ss: parts.second };
}
function ymd(v) {
  // 'YYYY-MM-DD' stays as it is; a timestamp becomes its London date
  if (v == null || v === '') return null;
  if (v instanceof Date) v = v.toISOString();
  v = String(v);
  if (v.length <= 10) { const [y, m, d] = v.split('-').map(Number); return { y, m: m || 1, d: d || 1 }; }
  return london(v);
}
const CUR = { GBP: '£', USD: '$', EUR: '€' };

export const fmt = {
  num: (n, dp = 0) => (n == null || Number.isNaN(+n) ? '' : (n < 0 ? MINUS : '') + nf(dp).format(Math.abs(+n))),
  int: (n) => fmt.num(n, 0),
  pct: (x, dp = 1) => (x == null ? '' : fmt.num(x * 100, dp) + '%'),
  /** £1,234.56 (negative with a true minus) */
  gbp: (n, dp = 2) => (n == null ? '' : (n < 0 ? MINUS : '') + '£' + nf(dp).format(Math.abs(n))),
  usd: (n, dp = 2) => (n == null ? '' : (n < 0 ? MINUS : '') + '$' + nf(dp).format(Math.abs(n))),
  /** 1,234.56 USDC (dp 6 in proofs) */
  usdc: (n, dp = 2, asset = 'USDC') => (n == null ? '' : (n < 0 ? MINUS : '') + nf(dp).format(Math.abs(n)) + ' ' + asset),
  /** any currency or token: GBP, USD, EUR use a symbol; USDC, EURC, SEK follow the number */
  money: (n, cur = 'GBP', dp = 2) => {
    if (n == null || n === '') return '';
    if (CUR[cur]) return (n < 0 ? MINUS : '') + CUR[cur] + nf(dp).format(Math.abs(n));
    return (n < 0 ? MINUS : '') + nf(dp).format(Math.abs(n)) + ' ' + cur;
  },
  signed: (n, cur = 'USDC', dp = 2) => (n > 0 ? '+' : '') + fmt.money(n, cur, dp),
  /** "229,404.21 USDC · £181,068.75" */
  both: (usdc, gbp, asset = 'USDC') => fmt.usdc(usdc, 2, asset) + (gbp == null ? '' : ' · ' + fmt.gbp(gbp)),
  compact: (n, cur) => {
    if (n == null) return '';
    const a = Math.abs(n);
    const body = a >= 1e6 ? nf(a >= 1e7 ? 1 : 2).format(a / 1e6) + 'm' : a >= 1e3 ? nf(a >= 1e5 ? 0 : 1).format(a / 1e3) + 'k' : nf(0).format(a);
    const sign = n < 0 ? MINUS : '';
    if (!cur) return sign + body;
    return CUR[cur] ? sign + CUR[cur] + body : sign + body + ' ' + cur;
  },
  /** 9 Nov 2026 */
  date: (v) => { const p = ymd(v); return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : ''; },
  /** 9 Nov */
  day: (v) => { const p = ymd(v); return p ? `${p.d} ${MONTHS[p.m - 1]}` : ''; },
  /** Monday 9 November 2026 */
  dateLong: (v) => {
    const p = ymd(v); if (!p) return '';
    const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    return `${DAYS[wd]} ${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}`;
  },
  weekday: (v) => { const p = ymd(v); return p ? DAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()].slice(0, 3) : ''; },
  /** 'Oct 2026' from '2026-10' or a date */
  month: (v) => { const p = ymd(String(v).length === 7 ? v + '-01' : v); return p ? `${MONTHS[p.m - 1]} ${p.y}` : ''; },
  monthShort: (v) => { const p = ymd(String(v).length === 7 ? v + '-01' : v); return p ? MONTHS[p.m - 1] : ''; },
  /** 5 Nov 2026, 14:03 (London) */
  datetime: (iso) => { if (!iso) return ''; const p = london(iso); return `${p.d} ${MONTHS[p.m - 1]} ${p.y}, ${p.hh}:${p.mm}`; },
  time: (iso) => { if (!iso) return ''; const p = london(iso); return `${p.hh}:${p.mm}`; },
  /** 2026-11-05 14:03:09 UTC */
  utc: (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z$|Z$/, '') + ' UTC' : ''),
  /** The desk's short "7 m", "3 h", "2 d", "1 w" against today's clock */
  ago: (v) => {
    if (!v) return '';
    const t = String(v).length <= 10 ? Date.parse(v + 'T12:00:00Z') : Date.parse(v);
    let diff = (cx.now.getTime() - t) / 1000;
    // Things done in this session are stamped a little after the story's clock; within the hour they read "now".
    const fut = diff < 0; diff = Math.abs(diff);
    if (fut && diff < 3600 && String(v).length > 10) return 'now';
    const out = diff < 60 ? 'now' : diff < 3600 ? Math.floor(diff / 60) + ' m' : diff < 86400 ? Math.floor(diff / 3600) + ' h'
      : diff < 86400 * 7 ? Math.floor(diff / 86400) + ' d' : diff < 86400 * 35 ? Math.floor(diff / 604800) + ' w'
      : diff < 86400 * 365 ? Math.floor(diff / (86400 * 30.4)) + ' mo' : Math.floor(diff / (86400 * 365)) + ' y';
    return out === 'now' ? 'now' : fut ? 'in ' + out : out;
  },
  /** "3 days ago", "in 2 weeks" */
  agoLong: (v) => {
    const a = fmt.ago(v); if (!a || a === 'now') return 'just now';
    const fut = a.startsWith('in '); const [n, u] = a.replace('in ', '').split(' ');
    const word = { m: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month', y: 'year' }[u];
    const t = `${n} ${word}${+n === 1 ? '' : 's'}`;
    return fut ? 'in ' + t : t + ' ago';
  },
  /** 0x4A1f…9c2E */
  addr: (a) => (a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a || ''),
  hash: (x) => (x && x.length > 14 ? x.slice(0, 8) + '…' + x.slice(-4) : x || ''),
  hours: (n) => (n == null ? '' : fmt.num(n, n % 1 ? (Math.round(n * 100) % 10 ? 2 : 1) : 0) + ' h'),
  plural: (n, word, many) => `${fmt.int(n)} ${n === 1 ? word : many || word + 's'}`,
  bytes: (n) => (n > 1e6 ? fmt.num(n / 1e6, 1) + ' MB' : fmt.num(n / 1e3, 0) + ' KB'),
};
cx.fmt = fmt;

/* =====================================================================================================
   Data
   ===================================================================================================== */

const tableCache = new Map();
/** Inflate a compact {cols, rows} table (by path such as 'books.gl', or the table itself) into objects, cached. */
cx.rows = (pathOrTable) => {
  const key = typeof pathOrTable === 'string' ? pathOrTable : null;
  if (key && tableCache.has(key)) return tableCache.get(key);
  const t = key ? key.split('.').reduce((o, k) => (o ? o[k] : undefined), D) : pathOrTable;
  if (!t) return [];
  const out = Array.isArray(t) ? t : t.rows.map((r) => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])));
  if (key) tableCache.set(key, out);
  return out;
};
/** Add a row to a compact table and to its cached objects: cx.rows.push('activity', { at, … }, { front: true }). */
cx.rows.push = (path, obj, o = {}) => {
  const objs = cx.rows(path);
  const t = path.split('.').reduce((x, k) => x?.[k], D);
  if (!t) return obj;
  if (Array.isArray(t)) { if (o.front) t.unshift(obj); else t.push(obj); return obj; }
  const arr = t.cols.map((c) => obj[c] ?? null);
  if (o.front) { t.rows.unshift(arr); objs.unshift(obj); } else { t.rows.push(arr); objs.push(obj); }
  return obj;
};
/** Forget the cached objects of a table (after changing its compact rows directly). */
cx.rows.invalidate = (path) => { if (path) tableCache.delete(path); else tableCache.clear(); };
/** A plain, hash-safe form of any record name: letters, digits and single hyphens. */
cx.slug = (id) => String(id ?? '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Find a record whose `key` slugs to `slug` (what a route receives as ctx.id). */
cx.find = (arr, key, slug) => {
  if (slug == null) return null;
  const want = cx.slug(slug);
  return (arr || []).find((r) => cx.slug(typeof key === 'function' ? key(r) : r[key]) === want) || null;
};
/** GBP per USDC on a day (or the nearest day before it). */
cx.rate = (day) => {
  if (!day) return D.meta.rate.gbpPerUsdc;
  let d = String(day).slice(0, 10);
  for (let i = 0; i < 10; i++) {
    if (D.rates[d] != null) return D.rates[d];
    const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); d = t.toISOString().slice(0, 10);
  }
  return D.meta.rate.gbpPerUsdc;
};

const peopleIdx = new Map();
function indexPeople() {
  peopleIdx.clear();
  const members = new Map((D.seats.members || []).map((m) => [m.id, m]));
  for (const p of D.people) {
    const m = members.get(p.id);
    const rec = { ...p, kind: 'employee', seatMember: m || null };
    peopleIdx.set(p.id, rec);
    if (p.employee) peopleIdx.set(p.employee, rec);
  }
  for (const o of D.others || []) {
    if (peopleIdx.has(o.id)) continue;
    const m = members.get(o.id);
    peopleIdx.set(o.id, { ...o, kind: 'other', hats: m ? m.hats : [], seat: o.seat || null, seatMember: m || null, companyEmail: o.email });
  }
  for (const a of D.agents || []) peopleIdx.set(a.handle, { ...a, id: a.handle, name: a.handle, kind: 'agent', label: a.name });
  const fde = D.fde?.hosting;
  if (fde) peopleIdx.set(fde.handle, { id: fde.handle, name: fde.handle, label: "Harbourline's FDE", kind: 'agent', fde: true, safe: fde.safe, hats: [] });
}
/** A person, guest or agent by id ('maya'), employee number ('HR-EMP-00001') or handle ('@kwame-ops'). */
cx.person = (id) => peopleIdx.get(id) || null;
cx.people = () => D.people;
/** Display name: 'Maya Okafor', '@kwame-ops', 'the Board'. */
cx.name = (id) => {
  if (id == null) return '';
  if (id === 'board') return 'the Board';
  if (id === 'agreement') return 'the pay agreement';
  const p = peopleIdx.get(id);
  return p ? p.name : String(id);
};
cx.firstName = (id) => { const p = peopleIdx.get(id); return p ? (p.firstName || p.first || p.name.split(' ')[0]) : cx.name(id); };

/** A department or allowance by id ('engineering', 'travel'); 'board' is the Board. */
cx.dept = (id) => {
  if (id === 'board') return { id: 'board', name: 'the Board', kind: 'board' };
  const d = D.departments.find((x) => x.id === id);
  if (d) return { ...d, kind: 'department' };
  const a = D.allowances.find((x) => x.id === id);
  return a ? { ...a, kind: 'allowance' } : null;
};
cx.deptName = (id) => {
  const d = cx.dept(id); if (!d) return id || '';
  return d.kind === 'allowance' ? d.name + ' allowance' : d.kind === 'board' ? 'the Board' : d.name;
};
/** Who wears a department's or allowance's hat on a day (default today): person ids and agent handles. */
cx.holders = (id, day) => {
  const d = cx.dept(id); if (!d || !d.holders) return [];
  const at = day || cx.today;
  return d.holders.filter((x) => x.from <= at && (!x.to || x.to > at)).map((x) => x.who);
};
/** The department chain above one: ['harbourline'] for 'design'. */
cx.ancestors = (id) => {
  const out = []; let d = cx.dept(id);
  while (d && d.parent) { out.push(d.parent); d = cx.dept(d.parent); }
  return out;
};
/** The quarter's budget line of a department on a day (default today). */
cx.budgetOn = (id, day) => {
  const d = cx.dept(id); const at = day || cx.today;
  return d?.budgets?.find((b) => b.from <= at && b.to >= at) || null;
};

/* =====================================================================================================
   Who is signed in, and what they may do
   ===================================================================================================== */

let meId = 'maya';
let acting = 'org';
cx.me = () => cx.person(meId);
cx.meId = () => meId;
cx.acting = () => acting;
/** People you can view the mock-up as: seat holders, then employees without a seat. */
cx.personas = () => {
  const seat = (D.seats.members || []).filter((m) => m.kind === 'Person' && m.status === 'Active').map((m) => m.id);
  const noSeat = D.people.filter((p) => p.status === 'Active' && !seat.includes(p.id)).map((p) => p.id);
  return { seat, noSeat };
};
cx.setMe = (id) => {
  if (!cx.person(id) || id === meId) return;
  meId = id; store.set('persona', id);
  renderTopbar(); renderSidebar();
  emit('persona', cx.me());
  render({ keepScroll: true });
};
cx.setActing = (v) => { acting = v; renderTopbar(); emit('acting', v); render({ keepScroll: true }); };
cx.hasSeat = (id = meId) => {
  const p = cx.person(id);
  return !!(p && (p.seat || p.seatMember));
};
/** Does the viewer wear this hat today? ('Director', 'People', 'Books', 'Engineering', 'Travel allowance', ...) */
cx.wears = (hat, id = meId) => {
  const p = cx.person(id); if (!p) return false;
  const want = String(hat).toLowerCase();
  if (want === 'director' && D.board.directors.some((x) => (x.who || x.id || x) === id && !x.to)) return true;
  return (p.hats || []).some((x) => x.toLowerCase() === want);
};
/** Does the viewer wear this department's hat or one above it now? */
cx.holds = (deptId, id = meId) => [deptId, ...cx.ancestors(deptId)].some((d) => cx.holders(d).includes(id));
/**
 * cx.allowed(need) → { ok, reason }. need is a hat name ('Books'), { dept: 'engineering' } (that hat or one above),
 * { any: [needs...] }, { seat: true }, or a function returning true, false or a reason string.
 */
cx.allowed = (need) => {
  if (!need) return { ok: true };
  if (typeof need === 'function') { const r = need(cx.me()); return r === true ? { ok: true } : { ok: false, reason: typeof r === 'string' ? r : 'You may not do this.' }; }
  if (typeof need === 'string') return cx.wears(need) ? { ok: true } : { ok: false, reason: `Needs the ${need} hat. ${wearersLine(need)}` };
  if (need.seat) return cx.hasSeat() ? { ok: true } : { ok: false, reason: 'Needs a seat at Harbourline.' };
  if (need.dept) {
    if (cx.holds(need.dept)) return { ok: true };
    const holders = cx.holders(need.dept).map(cx.name).join(' and ');
    return { ok: false, reason: `Needs the ${cx.deptName(need.dept)} hat or one above it${holders ? `. ${holders} wears it now` : ''}.` };
  }
  if (need.any) { for (const n of need.any) if (cx.allowed(n).ok) return { ok: true }; return { ok: false, reason: cx.allowed(need.any[0]).reason }; }
  return { ok: true };
};
function wearersLine(hat) {
  const who = (D.people || []).filter((p) => (p.hats || []).some((x) => x.toLowerCase() === hat.toLowerCase())).map((p) => p.name);
  if (hat.toLowerCase() === 'director') return `Directors: ${D.board.directors.map((x) => cx.name(x.who || x.id || x)).join(', ')}.`;
  return who.length ? `${who.join(', ')} ${who.length === 1 ? 'wears' : 'wear'} it now.` : '';
}

/* =====================================================================================================
   Events
   ===================================================================================================== */

const listeners = {};
cx.on = (evt, fn) => { (listeners[evt] ||= []).push(fn); return () => { listeners[evt] = listeners[evt].filter((f) => f !== fn); }; };
function emit(evt, payload) { for (const fn of listeners[evt] || []) { try { fn(payload); } catch (e) { console.error(e); } } }
cx.emit = emit;

/* =====================================================================================================
   Workspaces, routes and the router
   ===================================================================================================== */

const GROUPS = [
  { label: 'Company', ids: ['home', 'approvals', 'money', 'departments'] },
  { label: 'You', ids: ['yours'] },
  { label: 'Business', ids: ['books', 'hr', 'payroll', 'crm', 'projects'] },
  { label: 'Governance', ids: ['board', 'seats'] },
  { label: 'Help', ids: ['fde', 'activity'] },
];
const workspaces = new Map();
const routes = new Map();
const routeOwner = new Map();

/**
 * cx.workspace({ id, label, icon, route, nav, badge, seatless }) registers (or replaces) a sidebar workspace.
 * nav: [{ label, route, id?, badge? } | { section: 'Reports', collapsed?: true, items: [...] }]
 */
cx.workspace = (ws) => {
  if (!ws.id) throw new Error('workspace needs an id');
  workspaces.set(ws.id, { icon: ws.id, route: ws.id, nav: [], ...ws });
  if (frameReady) renderSidebar();
};
cx.workspaces = () => [...workspaces.values()];

/**
 * cx.route(name, handler, meta) registers a screen. name: letters, digits, single hyphens.
 * handler(ctx) returns a Node (usually cx.page(...)) or a Promise of one. ctx = { name, id, state, meta }.
 * meta: { workspace, title, cmd } (cmd is the default for the command strip).
 */
cx.route = (name, handler, meta = {}) => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || RESERVED.has(name) || name.startsWith('comment-')) throw new Error(`route name not allowed: ${name}`);
  routes.set(name, { handler, meta });
};
cx.hasRoute = (name) => routes.has(name);
cx.routes = () => [...routes.keys()];
/** '#name' or '#name--ID' (the id is slugged; find the record again with cx.find). */
cx.href = (name, id) => '#' + name + (id != null && id !== '' ? '--' + cx.slug(id) : '');
let pendingState = null;
/** Go to a screen. state (any object) reaches the handler as ctx.state, for this visit only. */
cx.go = (name, id, state) => {
  pendingState = state || null;
  const target = cx.href(name, id);
  if (location.hash === target) render(); else location.hash = target;
};
cx.current = { name: 'home', id: null, state: null };
cx.refresh = () => render({ keepScroll: true });

/** Where a reference ({ type, id }) in the data opens: the route names modules register. */
const REF_ROUTES = {
  payment: 'payment', proposal: 'proposal', vote: 'vote', round: 'round', department: 'department', allowance: 'allowance',
  leave: 'leave', 'expense-claim': 'expense-claim', advance: 'advance', employee: 'employee', run: 'payroll-run', payslip: 'payslip',
  deposit: 'deposit', payout: 'payout', escrow: 'payment', project: 'project', task: 'task', timesheet: 'timesheet',
  deal: 'deal', lead: 'lead', contact: 'contact', company: 'company', agent: 'agent', seats: 'seats', invitation: 'seats', fde: 'fde',
  'sales-invoice': 'sales-invoice', 'purchase-invoice': 'purchase-invoice', 'payment-entry': 'payment-entry', 'journal-entry': 'journal-entry',
  account: 'account', conversation: 'fde', approval: 'approvals', notice: 'notices',
};
cx.refRoute = (ref) => {
  if (!ref) return null;
  const name = REF_ROUTES[ref.type] || ref.type;
  if (['seats', 'fde', 'approvals', 'notices'].includes(name)) return [name, null];
  return [name, ref.id ?? null];
};
cx.refHref = (ref) => { const r = cx.refRoute(ref); return r ? cx.href(r[0], r[1]) : null; };
/** A link to a record: cx.link('Text', 'sales-invoice', 'ACC-SINV-2026-00050'). */
cx.link = (text, route, id, props = {}) => h('a', { href: cx.href(route, id), ...props }, text);

function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
  const i = raw.indexOf('--');
  const name = (i < 0 ? raw : raw.slice(0, i)) || 'home';
  const id = i < 0 ? null : raw.slice(i + 2);
  return { name, id };
}
let renderSeq = 0;
async function render(opts = {}) {
  if (!frameReady) return;
  const seq = ++renderSeq;
  const { name, id } = parseHash();
  const r = routes.get(name);
  const prev = cx.current;
  const ctx = { name, id, state: pendingState, meta: r?.meta || {} };
  pendingState = null;
  cx.current = ctx;
  closePops();
  if (!opts.keepScroll) setNav(false);
  strip.reset(r?.meta?.cmd || null);
  cx.fde.context = null;
  let node;
  const ws = workspaceOf(name);
  try {
    if (!r) node = notBuilt(name, id);
    else if (ws && !ws.seatless && !r.meta?.seatless && !cx.hasSeat() && name !== 'home') node = noSeatPage(ws);
    else node = await r.handler(ctx);
  } catch (e) {
    console.error(`Screen "${name}" failed:`, e);
    node = errorPage(name, e);
  }
  if (seq !== renderSeq) return;
  if (!(node instanceof Node)) node = cx.page({ title: String(node ?? '') });
  if (!node.querySelector?.('.strip') && !node.classList?.contains('strip')) {
    const wrap = h('div.page', strip.el);
    wrap.appendChild(node);
    node = wrap;
  }
  if (tour) { const pg = node.classList?.contains('page') ? node : node.querySelector?.('.page'); (pg || node).prepend(tourBar()); }
  fill(view, node);
  renderSidebar();
  if (!opts.keepScroll && (prev.name !== name || prev.id !== id)) window.scrollTo(0, 0);
  emit('route', ctx);
}
cx.render = render;
function workspaceOf(name) {
  const meta = routes.get(name)?.meta;
  if (meta?.workspace) return workspaces.get(meta.workspace) || null;
  for (const ws of workspaces.values()) {
    if (ws.route === name || ws.id === name) return ws;
    if (navRoutes(ws.nav).includes(name)) return ws;
  }
  return null;
}
function navRoutes(nav) {
  const out = [];
  for (const it of nav || []) { if (it.items) out.push(...navRoutes(it.items)); else if (it.route) out.push(it.route, ...(it.match || [])); }
  return out;
}

/* =====================================================================================================
   The command strip
   ===================================================================================================== */

const KNOWN_SDK = [
  ['payment send', 'client.payments.pay'], ['payment get', 'client.payments.get'], ['payment list', 'client.payments.list'],
  ['payment cancel', 'client.payments.cancel'], ['payment wait', 'client.payments.subscribe'], ['payment claim', 'client.payments.claim'],
  ['payment reschedule', 'client.payments.reschedule'], ['payment retry', 'client.payments.retry'],
  ['balance', 'client.accounts.read'], ['address', 'client.account.profile.depositInstructions'],
  ['bank pay', 'client.approvals.prepare'], ['bank details', 'client.banking.details.get'], ['bank settle', 'client.banking.details.settle'],
  ['bank deposits', 'client.banking.deposits.list'], ['bank match', 'client.banking.deposits.match'],
  ['bank accounts add', 'client.account.bankAccounts.add'], ['bank accounts remove', 'client.account.bankAccounts.remove'], ['bank accounts', 'client.account.bankAccounts.list'],
  ['document verify', 'client.paymentDocuments.verify'], ['document get', 'client.paymentDocuments.get'], ['document render', 'client.paymentDocuments.render'],
  ['inbox list', 'client.account.inbox.list'], ['inbox pay', 'client.approvals.prepare'], ['inbox decline', 'client.account.inbox.decline'],
  ['verify status', 'client.verification.status'], ['verify start', 'client.verification.start'],
  ['org director list', 'client.org(orgId).directors.get'], ['org board show', 'client.org(orgId).board.get'],
  ['org department show', 'client.org(orgId).departments.get'], ['org department budget set', 'client.org(orgId).departments.setAmount'],
  ['org fde show', 'client.org(orgId).fde.show'], ['org fde ask', 'client.org(orgId).fde.ask'], ['org cap-table', 'client.org(orgId).equity.capTable'],
  ['org me', 'client.org(orgId).me'], ['org seats show', 'client.org(orgId).seats.show'], ['org seats buy', 'client.org(orgId).seats.buy'],
  ['org member invite', 'client.org(orgId).invitations.invite'],
];
const VERBS = new Set(('list get show create change add remove submit cancel amend apply send pay claim wait approve reject move log bill run set import ' +
  'rename archive review reclassify buy grant revoke invite freeze unfreeze rotate sweep ask annotate summary events verify render decline issue ' +
  'resend close reopen allocate unallocate withhold settle match checkin preview execute cast exercise assign replace reschedule retry balance ' +
  'trial-balance profit-and-loss balance-sheet reconcile quickbooks connect disconnect convert disable enable link unlink start end').split(' '));
const NAMESPACES = new Set(['books', 'hr', 'payroll', 'crm', 'projects', 'activity', 'reports', 'board', 'equity', 'fde', 'seats', 'export', 'facts', 'settings']);
function tokenize(cli) {
  const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(cli))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
const camel = (w) => w.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const plural = (w) => (/s$/.test(w) ? w : /y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
/** Derive the SDK call from a CLI line (G7: org → client.org(orgId), groups are namespaces, nouns plural camelCase, verb last). */
cx.sdkOf = (cli) => {
  if (!cli) return '';
  let toks = tokenize(String(cli).replace(/^\s*capxul\s+/, ''));
  const flagsAt = toks.findIndex((t) => t.startsWith('--'));
  const head = flagsAt < 0 ? toks : toks.slice(0, flagsAt);
  const flags = {};
  if (flagsAt >= 0) {
    const rest = toks.slice(flagsAt);
    for (let i = 0; i < rest.length; i++) {
      if (!rest[i].startsWith('--')) continue;
      const k = camel(rest[i].slice(2));
      if (k === 'org' || k === 'json') { if (k === 'org' && rest[i + 1] && !rest[i + 1].startsWith('--')) i++; continue; }
      let v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      flags[k] = flags[k] === undefined ? v : [].concat(flags[k], v);
    }
  }
  const lineHead = head.join(' ');
  const known = KNOWN_SDK.find(([k]) => lineHead === k || lineHead.startsWith(k + ' '));
  let base, args;
  if (known) { base = known[1]; args = head.slice(known[0].split(' ').length); }
  else {
    let i = 0; const path = [];
    let root = 'client';
    if (head[0] === 'org') { root = 'client.org(orgId)'; i = 1; }
    else if (['hr', 'payroll', 'agent', 'shares', 'vote', 'invest'].includes(head[0])) root = 'client.me';
    else if (head[0] === 'contact') { root = 'client.account.addressBook'; i = 1; }
    else if (head[0] === 'request') { root = 'client.requests'; i = 1; }
    if (head[i] === 'doc') { path.push('docs'); i++; }
    else if (head[i] === 'report' && head[i + 1] === 'run') { path.push('reports'); i++; }
    let verb = null;
    for (; i < head.length; i++) {
      const w = head[i];
      if (!/^[a-z][a-z-]*$/.test(w)) break;
      if (path[path.length - 1] === 'reports' && w !== 'reports') { verb = camel(w); i++; break; }
      if (VERBS.has(w) && path.length) { verb = camel(w); i++; break; }
      path.push(NAMESPACES.has(w) ? camel(w) : camel(plural(w)));
    }
    if (!verb && path.length) verb = path.pop().replace(/s$/, '');
    base = [root, ...path, verb].filter(Boolean).join('.');
    args = head.slice(i);
  }
  const parts = args.map((a) => JSON.stringify(a));
  if (Object.keys(flags).length) parts.push('{ ' + Object.entries(flags).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') + ' }');
  return `${base}(${parts.join(', ')})`;
};

function normCmd(spec) {
  if (!spec) return null;
  if (typeof spec === 'string' || Array.isArray(spec)) spec = { cli: spec };
  const lines = [].concat(spec.cli || []).filter(Boolean).map((l) => (/^capxul\b/.test(l) ? l : 'capxul ' + l));
  const sdk = spec.sdk ? [].concat(spec.sdk) : lines.map(cx.sdkOf);
  return { ...spec, lines, sdkLines: sdk };
}
const strip = (() => {
  const el = h('div.strip', { role: 'region', 'aria-label': 'Command for this screen' });
  let screen = null, action = null, actionLabel = '', pinned = false, mode = 'cli', showJson = false, timer = 0;
  function cur() { return action || screen; }
  function draw() {
    const c = cur();
    el.classList.toggle('action', !!action);
    fill(el);
    const tag = h('span.strip-tag', action ? `Action · ${actionLabel}` : 'Command');
    const pre = h('pre.strip-cmd');
    if (!c || !c.lines.length) {
      pre.appendChild(h('span.fl', c?.note || 'This screen has no command of its own.'));
    } else if (mode === 'sdk') {
      c.sdkLines.forEach((l, i) => { if (i) pre.appendChild(document.createTextNode('\n')); pre.appendChild(h('span.p', '› ')); pre.appendChild(document.createTextNode(l)); });
    } else {
      c.lines.forEach((l, i) => {
        if (i) pre.appendChild(document.createTextNode('\n'));
        pre.appendChild(h('span.p', '$ '));
        for (const [j, t] of l.split(/(\s--[a-z-]+)/).entries()) pre.appendChild(j % 2 ? h('span.fl', t) : document.createTextNode(t));
      });
    }
    const tools = h('div.strip-tools');
    if (c && c.lines.length) {
      tools.append(
        h('button.strip-btn', { type: 'button', onclick: () => copyText(mode === 'sdk' ? c.sdkLines.join('\n') : c.lines.join('\n'), pre) }, 'Copy'),
        h('button.strip-btn', { type: 'button', 'aria-pressed': String(mode === 'sdk'), onclick: () => { mode = mode === 'sdk' ? 'cli' : 'sdk'; draw(); } }, 'SDK'),
      );
      if (c.json !== undefined) tools.appendChild(h('button.strip-btn', { type: 'button', 'aria-pressed': String(showJson), onclick: () => { showJson = !showJson; draw(); } }, '--json'));
    }
    if (action) tools.appendChild(h('button.strip-btn', { type: 'button', title: "Back to the screen's command", onclick: () => { pinned = false; action = null; draw(); } }, '×'));
    el.append(h('div.strip-row', tag, pre, tools));
    const meta = [];
    if (c?.who) meta.push(h('span', 'Who may run it: ', h('b', c.who)));
    if (c?.kind === 'proposed') meta.push(h('span.strip-kind', 'proposed command'));
    if (c?.note && c.lines.length) meta.push(h('span', c.note));
    if (meta.length) el.appendChild(h('div.strip-meta', meta));
    if (showJson && c?.json !== undefined) el.appendChild(h('pre.strip-json', typeof c.json === 'string' ? c.json : JSON.stringify(c.json, null, 2)));
  }
  return {
    el,
    reset(spec) { screen = normCmd(spec); action = null; pinned = false; showJson = false; draw(); },
    screen(spec) { screen = normCmd(spec); if (!pinned) action = null; draw(); },
    preview(spec, label) { if (pinned) return; clearTimeout(timer); action = normCmd(spec); actionLabel = label || 'Action'; draw(); },
    unpreview() { if (pinned) return; clearTimeout(timer); timer = setTimeout(() => { if (!pinned && !el.matches(':hover')) { action = null; draw(); } }, 1400); },
    pin(spec, label) { clearTimeout(timer); action = normCmd(spec); actionLabel = label || 'Action'; pinned = true; draw(); },
    unpin() { pinned = false; action = null; draw(); },
    get() { return cur(); },
  };
})();
/** Set the screen's command: a string, a list of strings, or { cli, sdk, json, who, kind, note }. */
cx.setCommand = (spec) => strip.screen(spec);
/** Show an action's command on the strip; pin keeps it until cx.clearAction() or the next screen. */
cx.showAction = (spec, label, o = {}) => (o.pin ? strip.pin(spec, label) : strip.preview(spec, label));
cx.clearAction = () => strip.unpin();
/** Clear a hover preview (shown with cx.showAction) after the pointer leaves; a pinned command stays. */
cx.unpreview = () => strip.unpreview();
cx.command = () => strip.get();

function copyText(text, selectEl) {
  const done = () => toast('Copied to the clipboard');
  const fallback = () => {
    if (selectEl) { const r = document.createRange(); r.selectNodeContents(selectEl); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    toast('Selected. Press Ctrl+C or ⌘C to copy.', { tone: 'info' });
  };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch { fallback(); }
}
cx.copy = copyText;

/* =====================================================================================================
   Small parts: buttons, menus, pills, people, amounts, hashes
   ===================================================================================================== */

/**
 * cx.btn(label, { kind: 'primary'|'danger'|'ghost', icon, onClick, cmd, needs, disabled, reason, sm, caret, title, href })
 * cmd: the action's command (shown on the strip on hover and on click). needs: see cx.allowed.
 */
cx.btn = (label, o = {}) => {
  const allow = cx.allowed(o.needs);
  const off = o.disabled || !allow.ok;
  const reason = o.reason || allow.reason;
  const tag = o.href ? 'a' : 'button';
  const el = h(tag + '.btn', {
    class: [o.kind, o.sm && 'sm', o.class],
    type: o.href ? null : 'button',
    href: o.href ? (Array.isArray(o.href) ? cx.href(o.href[0], o.href[1]) : o.href) : null,
    id: o.id, 'aria-disabled': off ? 'true' : null,
    title: off && reason ? reason : o.title || null,
  }, off && !o.disabled ? cx.icon('lock') : o.icon ? cx.icon(o.icon) : null, label ? h('span', label) : null, o.caret ? cx.icon('down', { class: 'caret' }) : null);
  if (o.cmd) {
    el.addEventListener('mouseenter', () => strip.preview(o.cmd, label || o.title));
    el.addEventListener('focus', () => strip.preview(o.cmd, label || o.title));
    el.addEventListener('mouseleave', () => strip.unpreview());
    el.addEventListener('blur', () => strip.unpreview());
  }
  el.addEventListener('click', (e) => {
    if (off) { e.preventDefault(); if (reason) toast(reason, { tone: 'warning' }); return; }
    if (o.cmd && !o.href) strip.pin(o.cmd, label || o.title);
    if (o.onClick) o.onClick(e);
  });
  return el;
};

const openPops = new Set();
function closePops(except) { for (const p of [...openPops]) if (p !== except) p.close(); }
cx.closePopovers = () => closePops();
function placePop(pop, anchor, align) {
  pop.style.left = ''; pop.style.right = ''; pop.style.top = '';
  if (align === 'right') pop.style.right = '0'; else pop.style.left = '0';
  pop.style.top = (anchor.offsetHeight + 4) + 'px';
  const r = pop.getBoundingClientRect();
  if (r.right > innerWidth - 8) { pop.style.left = 'auto'; pop.style.right = '0'; }
  const r2 = pop.getBoundingClientRect();
  if (r2.left < 8) { pop.style.right = 'auto'; pop.style.left = (8 - anchor.getBoundingClientRect().left) + 'px'; }
}
/** A popover attached to a trigger: returns { wrap, pop, open, close, toggle }. content() builds the popover's children. */
cx.popover = (trigger, content, o = {}) => {
  const wrap = h('div.menu-wrap', trigger);
  const pop = h('div.pop', { hidden: true, role: o.role || 'menu' });
  wrap.appendChild(pop);
  const api = {
    wrap, pop,
    open() { closePops(api); fill(pop, ...[].concat(content(api))); pop.hidden = false; openPops.add(api); placePop(pop, trigger, o.align); trigger.setAttribute('aria-expanded', 'true'); },
    close() { pop.hidden = true; openPops.delete(api); trigger.setAttribute('aria-expanded', 'false'); o.onClose?.(); },
    toggle() { pop.hidden ? api.open() : api.close(); },
  };
  trigger.setAttribute('aria-haspopup', 'true'); trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', (e) => { if (trigger.getAttribute('aria-disabled') === 'true') return; e.stopPropagation(); api.toggle(); });
  return api;
};
/**
 * cx.menu(label, items, { kind, icon, align, sm }) — a dropdown button (the desk's "Actions ▾", "Create ▾", "…").
 * items: [{ label, onClick, cmd, needs, danger, href: [route, id], hint, icon } | { divider: true } | { heading: 'Text' }]
 */
cx.menu = (label, items, o = {}) => {
  const trigger = h('button.btn', { type: 'button', class: [o.kind, o.sm && 'sm'], title: o.title || (label ? null : 'More') },
    o.icon ? cx.icon(o.icon) : null, label ? h('span', label) : null, label && o.caret !== false ? cx.icon('down', { class: 'caret' }) : null);
  if (!label && !o.icon) trigger.appendChild(cx.icon('more'));
  const api = cx.popover(trigger, (p) => menuItems(typeof items === 'function' ? items() : items, p), { align: o.align || 'right' });
  return api.wrap;
};
function menuItems(items, p) {
  return items.filter(Boolean).map((it) => {
    if (it.divider) return h('div.pop-sep');
    if (it.heading) return h('div.pop-label', it.heading);
    if (it.note) return h('div.pop-note', it.note);
    const allow = cx.allowed(it.needs);
    const off = it.disabled || !allow.ok;
    const el = h(it.href ? 'a.pop-item' : 'button.pop-item', {
      type: it.href ? null : 'button', role: 'menuitem', class: { danger: it.danger, on: it.on },
      href: it.href ? (Array.isArray(it.href) ? cx.href(it.href[0], it.href[1]) : it.href) : null,
      'aria-disabled': off ? 'true' : null, title: off ? (it.reason || allow.reason) : null,
    }, off ? cx.icon('lock') : it.icon ? cx.icon(it.icon) : null, h('span.grow', h('span.ttl', it.label), it.sub ? h('span.sub', it.sub) : null), it.hint ? h('small', it.hint) : null);
    if (it.cmd) { el.addEventListener('mouseenter', () => strip.preview(it.cmd, it.label)); el.addEventListener('mouseleave', () => strip.unpreview()); }
    el.addEventListener('click', (e) => {
      if (off) { e.preventDefault(); toast(it.reason || allow.reason, { tone: 'warning' }); return; }
      p.close();
      if (it.cmd) strip.pin(it.cmd, it.label);
      it.onClick?.(e);
    });
    return el;
  });
}

const TONE_ALIAS = { info: 'blue', success: 'green', warning: 'orange', danger: 'red', neutral: 'gray', muted: 'muted', escrow: 'escrow' };
const STATUS_TONES = {
  draft: 'red', 'not saved': 'orange', submitted: 'blue', cancelled: 'red', unpaid: 'orange', 'partly paid': 'yellow', paid: 'green', overdue: 'red',
  return: 'gray', 'credit note issued': 'gray', 'debit note issued': 'gray', 'on hold': 'gray', 'temporarily on hold': 'gray', 'internal transfer': 'gray',
  pending: 'orange', settled: 'green', unreconciled: 'orange', reconciled: 'green', enabled: 'blue', disabled: 'gray',
  active: 'green', inactive: 'red', suspended: 'orange', left: 'gray', open: 'orange', approved: 'green', rejected: 'red',
  'half day': 'orange', present: 'green', absent: 'red', 'on leave': 'red', 'work from home': 'blue', withheld: 'orange', expired: 'gray',
  returned: 'gray', claimed: 'green', 'partly claimed and returned': 'yellow', prepared: 'gray', scheduled: 'blue', due: 'orange',
  'money waiting': 'escrow', escrowed: 'escrow', sent: 'blue', 'needs retry': 'orange', mismatched: 'red', preparing: 'blue',
  'waiting for you': 'orange', signed: 'blue', sending: 'blue', done: 'green', reverted: 'red', replaced: 'gray', declined: 'gray',
  refused: 'red', withdrawn: 'gray', 'waiting for approvals': 'orange', waiting: 'orange', executed: 'green', failed: 'red', processing: 'blue',
  arriving: 'blue', credited: 'green', 'below minimum': 'gray', unmatched: 'orange', matched: 'green', 'not a request': 'gray',
  quoted: 'gray', 'in transit': 'blue', delivered: 'green', returning: 'orange', refunded: 'gray', 'needs attention': 'red',
  proposed: 'blue', applied: 'green', abandoned: 'gray', closed: 'gray', 'taken back': 'gray', creating: 'blue', frozen: 'orange',
  removed: 'gray', provisioned: 'blue', running: 'green', paused: 'red', resuming: 'blue', retired: 'gray', authorizing: 'blue',
  allocated: 'green', offered: 'blue', ended: 'gray', lapsed: 'gray', proposing: 'blue', voting: 'orange', completed: 'green',
  working: 'blue', 'pending review': 'orange', template: 'gray', 'to bill': 'orange', billed: 'green', 'partially billed': 'yellow',
  won: 'green', lost: 'red', new: 'gray', contacted: 'orange', nurture: 'blue', qualified: 'green', converted: 'teal', unqualified: 'red',
  junk: 'purple', qualification: 'gray', 'demo/making': 'orange', 'proposal/quotation': 'blue', negotiation: 'yellow', 'ready to close': 'purple',
  backlog: 'gray', todo: 'gray', 'in progress': 'blue', canceled: 'red', 'no answer': 'red', busy: 'orange', final: 'green',
  unclaimed: 'escrow', 'payment in transit': 'blue', 'not started': 'gray', own: 'green', 'opening entry': 'blue', 'journal entry': 'blue',
  'bank entry': 'blue', 'cash entry': 'blue', 'exchange gain or loss': 'blue', 'exchange rate revaluation': 'blue', 'depreciation entry': 'blue',
  'credit note': 'gray', 'debit note': 'gray', filed: 'green', receive: 'green', pay: 'blue', 'internal transfer ': 'blue',
};
/** The colour role of a status word, from the business records' and Capxul's own vocabularies. */
cx.toneOf = (status) => {
  if (!status) return 'gray';
  const k = String(status).toLowerCase().trim();
  return STATUS_TONES[k] || STATUS_TONES[k.split(' · ')[0]] || 'gray';
};
/** A status pill: cx.pill('Unpaid'), cx.pill('Money waiting'), cx.pill('Custom', 'success'). */
cx.pill = (text, tone, o = {}) => {
  const t = TONE_ALIAS[tone] || tone || cx.toneOf(text);
  return h('span.pill', { class: ['t-' + t, o.lg && 'lg', o.plain && 'plain'], title: o.title || null }, text);
};
const DOT_VARS = { gray: '--t-gray', orange: '--t-orange', blue: '--t-blue', green: '--t-green', teal: '--t-teal', red: '--t-red', purple: '--t-purple', yellow: '--t-yellow', escrow: '--t-escrow' };
/** A CRM-style coloured dot and its word: cx.dot('Nurture', 'blue'). */
cx.dot = (text, color) => h('span.dot', { style: { '--dot': `var(${DOT_VARS[TONE_ALIAS[color] || color || cx.toneOf(text)] || '--t-gray'})` } }, text);

const AV_TONES = ['teal', 'blue', 'purple', 'orange', 'green', 'escrow', 'yellow', 'red'];
function hashStr(t) { let x = 0; for (const c of String(t)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; }
/** Initials in a circle (square for an agent). */
cx.avatar = (id, o = {}) => {
  const p = cx.person(id);
  const name = p ? (p.kind === 'agent' ? (p.label || p.name).replace(/^@/, '') : p.name) : String(id || '?');
  const ini = name.replace(/^@/, '').split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return h('span.avatar', { class: ['t-' + AV_TONES[hashStr(id || name) % AV_TONES.length], o.size, p?.kind === 'agent' && 'agent'], title: p ? p.name : name, 'aria-hidden': 'true' }, ini || '?');
};
/** Avatar and name, linked to the employee (or agent) when the route exists. */
cx.personChip = (id, o = {}) => {
  if (!id) return h('span.faint', '—');
  const p = cx.person(id);
  const label = o.label || (p ? (p.kind === 'agent' && p.label && o.long ? `${p.label} (${p.name})` : p.name) : cx.name(id));
  const inner = [cx.avatar(id, { size: o.size || 'sm' }), h('span', label)];
  if (o.link !== false && p?.kind === 'employee' && routes.has('employee')) return h('a.person', { href: cx.href('employee', p.employee) }, inner);
  if (o.link !== false && p?.kind === 'agent' && routes.has('agent')) return h('a.person', { href: cx.href('agent', p.id) }, inner);
  return h('span.person', inner);
};
/** A hat badge: cx.hat('Engineering'). */
cx.hat = (name) => h('span.hat', cx.icon('hat'), name);
cx.tag = (text) => h('span.tag', text);
/**
 * An amount: cx.amount(-2051, 'USDC', { gbp: -1618.8, sign: true, color: true, stack: true, dp }).
 * USDC and other tokens show the token after the number; GBP, USD and EUR a symbol before it.
 */
cx.amount = (v, cur = 'GBP', o = {}) => {
  const dp = o.dp ?? 2;
  let text = fmt.money(v, cur, dp);
  if (o.sign && v > 0) text = '+' + text;
  const el = h('span.amt', { class: [o.color && v > 0 && 'pos', o.color && v < 0 && 'neg', o.stack && 'stack'] }, h('span', text));
  if (o.gbp != null && cur !== 'GBP') el.appendChild(h('span.alt', (o.stack ? '' : ' · ') + fmt.gbp(o.gbp)));
  if (o.alt) el.appendChild(h('span.alt', (o.stack ? '' : ' · ') + o.alt));
  return el;
};
/** Direction of a money movement, in words and an arrow: 'In', 'Out', 'Between your Safes'. */
cx.dir = (d) => {
  const k = String(d || '').toLowerCase();
  const cls = k.startsWith('in') ? 'in' : k.startsWith('out') ? 'out' : 'between';
  return h('span.dir', { class: cls }, cx.icon(cls === 'in' ? 'in' : cls === 'out' ? 'out' : 'swap', { size: 13 }), d);
};
/** A shortened address, transaction or hash with copy and (for address/tx) a Basescan link. */
cx.hashChip = (value, o = {}) => {
  if (!value) return h('span.faint', '—');
  const kind = o.kind || (/^0x[0-9a-fA-F]{40}$/.test(value) ? 'address' : /^0x[0-9a-fA-F]{64}$/.test(value) ? 'hash' : 'id');
  const short = o.full ? value : kind === 'address' ? fmt.addr(value) : kind === 'id' ? value : fmt.hash(value);
  const kids = [h('span', { title: value }, short), h('button', { type: 'button', title: 'Copy', onclick: (e) => { e.stopPropagation(); copyText(value); } }, cx.icon('copy'))];
  const ext = kind === 'address' ? `https://basescan.org/address/${value}` : (kind === 'tx' || o.tx) ? `https://basescan.org/tx/${value}` : null;
  if (ext && o.link !== false) kids.push(h('a', { href: ext, target: '_blank', rel: 'noopener', title: 'Open in Basescan', style: 'display:inline-grid;color:var(--faint)' }, cx.icon('external', { size: 13 })));
  return h('span.hash', kids);
};
cx.addr = (a, o) => cx.hashChip(a, { kind: 'address', ...o });
cx.tx = (t, o) => cx.hashChip(t, { kind: 'tx', ...o });
/** Label/value pairs as a definition list: cx.kv([['From', node], ['To', 'text']]). */
cx.kv = (pairs) => h('dl.kv', pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', k), h('dd', v ?? h('span.faint', '—'))]));
/** A card: { title, actions, cmd, body, foot, flush, class }. */
cx.card = (o = {}) => h('section.card', { class: o.class }, o.title || o.actions ? h('header.card-head', o.title ? h('h2', o.title) : null, o.actions || null, o.cmd ? h('div.card-cmd', '$ ' + [].concat(o.cmd).join('  ·  ')) : null) : null,
  o.body !== undefined ? h('div.card-body', { class: { flush: o.flush } }, o.body) : null, o.foot ? h('footer.card-foot', o.foot) : null);
cx.empty = (text, action) => h('div.empty', h('div', text), action || null);
cx.banner = (text, o = {}) => h('div.banner', { class: o.tone }, o.icon !== false ? cx.icon(o.icon || (o.tone === 'warning' || o.tone === 'danger' ? 'alert' : o.tone === 'escrow' ? 'hourglass' : 'info')) : null, h('div.grow', text), o.action || null);

/* =====================================================================================================
   Page frame
   ===================================================================================================== */

/**
 * cx.page({ title, crumbs, status, sub, actions, cmd, banner, body, fde, workspace, hero })
 * crumbs: [{ label, route, id }] (default: the workspace); status: a pill Node, a status word or { text, tone }.
 * actions: Nodes (cx.btn, cx.menu). cmd: the screen's command. fde: what the FDE is told you are looking at.
 * hero: a Node that replaces the standard head (the strip still follows it).
 */
cx.page = (o = {}) => {
  if (o.cmd !== undefined) strip.screen(o.cmd);
  const ws = workspaces.get(o.workspace || cx.current.meta?.workspace) || workspaceOf(cx.current.name);
  const crumbs = o.crumbs || (ws && ws.route !== cx.current.name ? [{ label: ws.label, route: ws.route }] : []);
  cx.fde.context = o.fde || [...crumbs.map((c) => c.label), o.title].filter(Boolean).join(' › ');
  const statuses = [].concat(o.status ?? []).map((st) => st instanceof Node ? st : typeof st === 'string' ? cx.pill(st, null, { lg: true }) : cx.pill(st.text, st.tone, { lg: true }));
  const head = o.hero ? o.hero : o.head === false ? null : h('header.page-head',
    h('div.page-titles',
      crumbs.length ? h('nav.crumbs', { 'aria-label': 'Breadcrumb' }, crumbs.flatMap((c, i) => [i ? h('span.sep', '/') : null, c.route ? cx.link(c.label, c.route, c.id) : h('span', c.label)])) : null,
      h('div.page-title', h('h1', o.title || ''), h('span', { 'data-status': '' }, statuses)),
      o.sub ? h('div.page-sub', o.sub) : null),
    o.actions ? h('div.page-actions', o.actions) : null);
  return h('div.page', head, strip.el, o.banner || null, h('div.page-body', o.body ?? null));
};
/** Replace the page's status pills (e.g. after an action): cx.setStatus(cx.pill('Paid')). */
cx.setStatus = (...pills) => { const slot = document.querySelector('.page-title [data-status]'); if (slot) fill(slot, ...pills); };

/* =====================================================================================================
   Charts (SVG, drawn to scale, redrawn at the container's width)
   ===================================================================================================== */

const tip = h('div.tip', { hidden: true, role: 'tooltip' });
function bindTip(box) {
  const show = (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || !box.contains(t)) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute('data-tip'); tip.hidden = false;
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    let x = e.clientX + 12, y = e.clientY + 14;
    if (x + w > innerWidth - 8) x = e.clientX - w - 12;
    if (y + hgt > innerHeight - 8) y = e.clientY - hgt - 12;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  };
  box.addEventListener('pointermove', show);
  box.addEventListener('pointerdown', show);
  box.addEventListener('pointerleave', () => { tip.hidden = true; });
}
function responsive(height, draw) {
  const box = h('div.chart', { style: { height: height + 'px' } });
  let last = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.floor(box.clientWidth);
    if (w > 0 && w !== last) { last = w; try { fill(box, draw(w)); } catch (e) { console.error('chart failed', e); } }
  });
  ro.observe(box);
  bindTip(box);
  return box;
}
function niceTicks(min, max, count = 5) {
  if (min === max) { if (max === 0) max = 1; else { min = Math.min(0, min); max = Math.max(0, max); } }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : +v.toPrecision(12));
  return { ticks, lo, hi };
}
const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const TONE_FILL = { pos: 'var(--chart-1)', neg: 'var(--chart-2)', warn: 'var(--t-orange)', danger: 'var(--t-red)', muted: 'var(--line-2)' };
function colorOf(c, i) {
  if (!c) return SERIES[i % SERIES.length];
  if (/^\d$/.test(String(c))) return SERIES[(+c - 1) % SERIES.length];
  if (TONE_FILL[c]) return TONE_FILL[c];
  if (DOT_VARS[c] || TONE_ALIAS[c]) return `var(${DOT_VARS[TONE_ALIAS[c] || c] || '--t-gray'})`;
  return c;
}
function legendOf(items) {
  return h('div.legend', items.map((it) => h('span', h('i', { class: it.line ? 'line' : null, style: { background: it.color } }), it.name)));
}
function textW(t) { return String(t).length * 6.2; }

export const chart = {
  /**
   * Grouped or stacked bars with an optional line on the same scale.
   * { labels, series: [{ name, values, color }], line: { name, values, color }, format, height, stacked, onClick(i) }
   */
  bar(o) {
    const H = o.height || 220, fmtV = o.format || ((v) => fmt.compact(v)), n = o.labels.length;
    const series = o.series.map((sr, i) => ({ ...sr, color: colorOf(sr.color, i) }));
    const line = o.line ? { ...o.line, color: colorOf(o.line.color || 'var(--fg)', 0) } : null;
    let lo = 0, hi = 0;
    for (let i = 0; i < n; i++) {
      if (o.stacked) {
        let p = 0, q = 0; for (const sr of series) { const v = sr.values[i] || 0; if (v >= 0) p += v; else q += v; }
        hi = Math.max(hi, p); lo = Math.min(lo, q);
      } else for (const sr of series) { const v = sr.values[i] || 0; hi = Math.max(hi, v); lo = Math.min(lo, v); }
      if (line && line.values[i] != null) { hi = Math.max(hi, line.values[i]); lo = Math.min(lo, line.values[i]); }
    }
    const { ticks, lo: tlo, hi: thi } = niceTicks(lo, hi, o.ticks || 4);
    const box = responsive(H, (W) => {
      const padL = Math.max(...ticks.map((t) => textW(fmtV(t)))) + 10, padR = 8, padT = 10, padB = 24;
      const pw = Math.max(10, W - padL - padR), ph = H - padT - padB;
      const y = (v) => padT + ph - ((v - tlo) / (thi - tlo)) * ph;
      const band = pw / n, gw = band * (n > 24 ? 0.8 : 0.66), bw = o.stacked ? gw : gw / series.length;
      const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title || 'Bar chart' });
      for (const t of ticks) {
        svg.append(s('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: t === 0 ? 'zero-l' : 'grid-l' }),
          s('text', { x: padL - 6, y: y(t) + 3.5, 'text-anchor': 'end' }, fmtV(t)));
      }
      const every = Math.max(1, Math.ceil((n * Math.max(30, Math.max(...o.labels.map((l) => textW(l) + 8)))) / pw));
      o.labels.forEach((l, i) => { if (i % every === 0) svg.append(s('text', { x: padL + band * i + band / 2, y: H - 7, 'text-anchor': 'middle' }, l)); });
      for (let i = 0; i < n; i++) {
        let up = 0, down = 0;
        series.forEach((sr, j) => {
          const v = sr.values[i] || 0;
          let y0, y1;
          if (o.stacked) { if (v >= 0) { y0 = y(up); y1 = y(up + v); up += v; } else { y0 = y(down); y1 = y(down + v); down += v; } }
          else { y0 = y(0); y1 = y(v); }
          const x = padL + band * i + (band - gw) / 2 + (o.stacked ? 0 : j * bw);
          const rect = s('rect', { x: x.toFixed(1), y: Math.min(y0, y1).toFixed(1), width: Math.max(1, bw - (o.stacked || series.length === 1 ? 0 : 1.5)).toFixed(1), height: Math.max(v ? 1 : 0, Math.abs(y1 - y0)).toFixed(1), rx: 1.5,
            style: `fill:${sr.color}`, 'data-tip': `${o.labels[i]}\n${sr.name}: ${(o.tipFormat || fmtV)(v)}` });
          if (o.onClick) { rect.style.cursor = 'pointer'; rect.addEventListener('click', () => o.onClick(i, j)); }
          svg.append(rect);
        });
      }
      if (line) {
        const pts = line.values.map((v, i) => (v == null ? null : [padL + band * i + band / 2, y(v)]));
        svg.append(s('polyline', { points: pts.filter(Boolean).map((p) => p.map((c) => c.toFixed(1)).join(',')).join(' '), style: `fill:none;stroke:${line.color};stroke-width:1.8` }));
        pts.forEach((p, i) => p && svg.append(s('circle', { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 3, style: `fill:var(--surface);stroke:${line.color};stroke-width:1.6`, 'data-tip': `${o.labels[i]}\n${line.name}: ${(o.tipFormat || fmtV)(line.values[i])}` })));
      }
      return svg;
    });
    const items = series.map((sr) => ({ name: sr.name, color: sr.color })); if (line) items.push({ name: line.name, color: line.color, line: true });
    return h('div', box, o.legend === false ? null : legendOf(items));
  },
  /** Lines (optionally filled): { labels, series: [{ name, values, color }], format, height, area } */
  line(o) {
    const H = o.height || 200, fmtV = o.format || ((v) => fmt.compact(v)), n = o.labels.length;
    const series = o.series.map((sr, i) => ({ ...sr, color: colorOf(sr.color, i) }));
    const all = series.flatMap((sr) => sr.values.filter((v) => v != null));
    const { ticks, lo, hi } = niceTicks(Math.min(0, ...all), Math.max(...all, 0), o.ticks || 4);
    const box = responsive(H, (W) => {
      const padL = Math.max(...ticks.map((t) => textW(fmtV(t)))) + 10, padR = 10, padT = 10, padB = 24;
      const pw = W - padL - padR, ph = H - padT - padB;
      const x = (i) => padL + (n === 1 ? pw / 2 : (i / (n - 1)) * pw), y = (v) => padT + ph - ((v - lo) / (hi - lo)) * ph;
      const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title || 'Line chart' });
      for (const t of ticks) svg.append(s('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: t === 0 ? 'zero-l' : 'grid-l' }), s('text', { x: padL - 6, y: y(t) + 3.5, 'text-anchor': 'end' }, fmtV(t)));
      const every = Math.max(1, Math.ceil((n * Math.max(30, Math.max(...o.labels.map((l) => textW(l) + 8)))) / pw));
      o.labels.forEach((l, i) => { if (i % every === 0 || i === n - 1 && n < 14) svg.append(s('text', { x: x(i), y: H - 7, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, l)); });
      series.forEach((sr) => {
        const pts = sr.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
        if (o.area && pts.length) svg.append(s('path', { d: `M${pts[0][0]},${y(Math.max(lo, 0))} ` + pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${pts[pts.length - 1][0]},${y(Math.max(lo, 0))} Z`, style: `fill:${sr.color};opacity:.12` }));
        svg.append(s('polyline', { points: pts.map((p) => p.map((c) => c.toFixed(1)).join(',')).join(' '), style: `fill:none;stroke:${sr.color};stroke-width:1.8;stroke-linejoin:round` }));
        sr.values.forEach((v, i) => { if (v != null) svg.append(s('circle', { cx: x(i), cy: y(v), r: i === n - 1 ? 3.5 : 6, style: i === n - 1 ? `fill:${sr.color}` : 'fill:transparent', 'data-tip': `${o.labels[i]}\n${sr.name}: ${(o.tipFormat || fmtV)(v)}` })); });
      });
      return svg;
    });
    return h('div', box, o.legend === false || series.length < 2 ? null : legendOf(series));
  },
  /** A donut with its legend: { items: [{ label, value, color }], format, height, center } */
  donut(o) {
    const H = o.height || 180, fmtV = o.format || ((v) => fmt.compact(v));
    const items = o.items.map((it, i) => ({ ...it, color: colorOf(it.color, i) }));
    const total = items.reduce((a, it) => a + Math.max(0, it.value), 0) || 1;
    const box = responsive(H, (W) => {
      const r = Math.min(H, W) / 2 - 4, cxp = W / 2, cyp = H / 2, ir = r * 0.62;
      const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title || 'Donut chart' });
      let a0 = -Math.PI / 2;
      for (const it of items) {
        const frac = Math.max(0, it.value) / total; if (!frac) continue;
        const a1 = a0 + frac * Math.PI * 2 - (frac === 1 ? 1e-4 : 0);
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (rad, a) => [cxp + rad * Math.cos(a), cyp + rad * Math.sin(a)].map((v) => v.toFixed(2)).join(' ');
        svg.append(s('path', { d: `M${p(r, a0)} A${r} ${r} 0 ${large} 1 ${p(r, a1)} L${p(ir, a1)} A${ir} ${ir} 0 ${large} 0 ${p(ir, a0)} Z`, style: `fill:${it.color};stroke:var(--surface);stroke-width:1.5`, 'data-tip': `${it.label}\n${(o.tipFormat || fmtV)(it.value)} · ${fmt.pct(frac)}` }));
        a0 = a1;
      }
      if (o.center) svg.append(s('text', { x: cxp, y: cyp + 5, 'text-anchor': 'middle', style: 'font-size:14px;font-weight:600;fill:var(--fg)' }, o.center));
      return svg;
    });
    return h('div', box, h('div.legend', items.map((it) => h('span', h('i', { style: { background: it.color } }), `${it.label} · ${(o.tipFormat || fmtV)(it.value)}`))));
  },
  /** A small trend line for a number card: chart.spark(values, { color }) */
  spark(values, o = {}) {
    const H = o.height || 30, color = colorOf(o.color, 0);
    const lo = Math.min(...values), hi = Math.max(...values);
    const box = responsive(H, (W) => {
      const x = (i) => 1 + (i / Math.max(1, values.length - 1)) * (W - 5), y = (v) => 3 + (H - 6) - ((v - lo) / ((hi - lo) || 1)) * (H - 6);
      const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      return s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' },
        s('polygon', { points: `${x(0)},${H} ${pts} ${x(values.length - 1)},${H}`, style: `fill:${color};opacity:.1` }),
        s('polyline', { points: pts, style: `fill:none;stroke:${color};stroke-width:1.5` }),
        s('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 2.5, style: `fill:${color}` }));
    });
    box.classList.add('spark');
    return box;
  },
  /** Horizontal bars to scale (ageing buckets, top customers): { items: [{ label, value, color, href }], format } */
  hbar(o) {
    const fmtV = o.format || ((v) => fmt.compact(v));
    const max = Math.max(...o.items.map((it) => Math.abs(it.value)), 1);
    return h('div', { style: 'display:grid;gap:8px' }, o.items.map((it, i) => h('div', { style: 'display:grid;gap:3px' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:10px;font-size:13px' }, it.href ? h('a', { href: Array.isArray(it.href) ? cx.href(...it.href) : it.href }, it.label) : h('span', it.label), h('span.num', fmtV(it.value))),
      h('div.meter-bar', h('i', { style: { width: (Math.abs(it.value) / max * 100).toFixed(2) + '%', background: colorOf(it.color, o.color ? 0 : i) } })))));
  },
  /**
   * A meter to scale: { total, parts: [{ label, value, color }], format, warnAt: 0.85 }.
   * Parts fill from the left; what is left of the total stays empty. Above warnAt the first part turns amber.
   */
  meter(o) {
    const fmtV = o.format || ((v) => fmt.num(v, 2));
    const total = o.total || o.parts.reduce((a, p) => a + p.value, 0) || 1;
    const used = o.parts.reduce((a, p) => a + p.value, 0);
    const warn = o.warnAt != null && used / total > o.warnAt;
    const bar = h('div.meter-bar', { role: 'img', 'aria-label': o.parts.map((p) => `${p.label} ${fmtV(p.value)}`).join(', ') + ` of ${fmtV(total)}` },
      o.parts.map((p, i) => h('i', { title: `${p.label}: ${fmtV(p.value)}`, style: { width: (Math.max(0, p.value) / total * 100).toFixed(3) + '%', background: warn && i === 0 ? 'var(--t-orange)' : colorOf(p.color, i) } })));
    return h('div.meter', bar, o.legend === false ? null : h('div.meter-legend', o.parts.map((p, i) => h('span', h('i', { style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', marginRight: '5px', background: warn && i === 0 ? 'var(--t-orange)' : colorOf(p.color, i) } }), `${p.label} `, h('b', fmtV(p.value)))), h('span', 'of ', h('b', fmtV(total)))));
  },
  /**
   * A Gantt chart to scale: { rows: [{ id, label, sub, start, end, progress, color, href, deps: [ids] }], from, to, today, rowHeight }
   */
  gantt(o) {
    const rows = o.rows; const RH = o.rowHeight || 28, AX = 30;
    const day = (d) => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
    const from = day(o.from || rows.reduce((m, r) => (r.start < m ? r.start : m), rows[0]?.start || cx.today));
    const to = day(o.to || rows.reduce((m, r) => (r.end > m ? r.end : m), rows[0]?.end || cx.today)) + 86400000;
    const H = AX + rows.length * RH + 6;
    const box = responsive(H, (W) => {
      const LW = Math.min(220, Math.max(110, W * 0.3)), pw = W - LW - 8;
      const x = (t) => LW + ((t - from) / (to - from)) * pw;
      const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title || 'Gantt chart' });
      const start = new Date(from); start.setUTCDate(1);
      const months = []; for (let t = new Date(start); t.getTime() < to; t.setUTCMonth(t.getUTCMonth() + 1)) months.push(new Date(t));
      const every = Math.max(1, Math.ceil(months.length * 44 / pw));
      months.forEach((m, i) => {
        const xx = x(m.getTime()); if (xx < LW - 1) return;
        svg.append(s('line', { x1: xx, x2: xx, y1: AX - 6, y2: H, class: 'grid-l' }));
        if (i % every === 0) svg.append(s('text', { x: xx + 3, y: AX - 12 }, `${MONTHS[m.getUTCMonth()]}${m.getUTCMonth() === 0 || i === 0 ? ' ' + String(m.getUTCFullYear()).slice(2) : ''}`));
      });
      const pos = new Map();
      rows.forEach((r, i) => {
        const yy = AX + i * RH;
        const maxChars = Math.floor((LW - 12) / 6.2);
        const lab = r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + '…' : r.label;
        const t = s('text', { x: 4, y: yy + RH / 2 + 4, style: `fill:var(--fg-2);font-size:12px;${r.href ? 'cursor:pointer' : ''}` }, lab);
        if (r.href) t.addEventListener('click', () => cx.go(...r.href));
        svg.append(t);
        if (!r.start || !r.end) return;
        const x0 = x(day(r.start)), x1 = Math.max(x0 + 3, x(day(r.end) + 86400000));
        pos.set(r.id, { x0, x1, y: yy + RH / 2 });
        const color = colorOf(r.color, 0);
        const g = s('g', { 'data-tip': `${r.label}\n${fmt.date(r.start)} to ${fmt.date(r.end)}${r.progress != null ? `\n${fmt.pct(r.progress, 0)} done` : ''}${r.sub ? '\n' + r.sub : ''}`, style: r.href ? 'cursor:pointer' : null });
        g.append(s('rect', { x: x0, y: yy + 6, width: x1 - x0, height: RH - 12, rx: 3, style: `fill:${color};opacity:.25` }));
        if (r.progress) g.append(s('rect', { x: x0, y: yy + 6, width: (x1 - x0) * Math.min(1, r.progress), height: RH - 12, rx: 3, style: `fill:${color}` }));
        if (r.href) g.addEventListener('click', () => cx.go(...r.href));
        svg.append(g);
      });
      for (const r of rows) for (const dep of r.deps || []) {
        const a = pos.get(dep), b = pos.get(r.id); if (!a || !b) continue;
        const mx = Math.max(a.x1 + 6, Math.min(b.x0 - 6, a.x1 + 12));
        svg.append(s('path', { d: `M${a.x1},${a.y} H${mx} V${b.y} H${b.x0}`, style: 'fill:none;stroke:var(--chart-axis);stroke-width:1' }), s('path', { d: `M${b.x0},${b.y} l-4,-3 v6 z`, style: 'fill:var(--chart-axis)' }));
      }
      const today = day(o.today || cx.today);
      if (today >= from && today <= to) svg.append(s('line', { x1: x(today), x2: x(today), y1: AX - 6, y2: H, class: 'today-l' }), s('text', { x: x(today) + 3, y: H - 3, style: 'fill:var(--neg);font-size:10.5px' }, 'today'));
      return svg;
    });
    return box;
  },
};
cx.chart = chart;
cx.niceTicks = niceTicks;

/* =====================================================================================================
   Workspace page, number cards, shortcuts, link cards
   ===================================================================================================== */

/** A number card: { label, value, sub, delta: { text, good }, href: [route, id], spark: [values], color, cmd } */
cx.numberCard = (o) => {
  const tag = o.href ? 'a.ncard' : 'div.ncard';
  const el = h(tag, { href: o.href ? (Array.isArray(o.href) ? cx.href(o.href[0], o.href[1]) : o.href) : null, title: o.cmd ? '$ ' + o.cmd : null },
    h('div.ncard-label', o.label), h('div.ncard-value', o.value instanceof Node ? o.value : String(o.value ?? '')),
    o.sub ? h('div.ncard-sub', o.sub) : null,
    o.delta ? h('div.ncard-delta', { class: o.delta.good === true ? 'good' : o.delta.good === false ? 'bad' : null }, o.delta.text) : null,
    o.spark ? chart.spark(o.spark, { color: o.color }) : null);
  if (o.cmd) { el.addEventListener('mouseenter', () => strip.preview(o.cmd, o.label)); el.addEventListener('mouseleave', () => strip.unpreview()); }
  return el;
};
/**
 * cx.workspacePage({ title, cmd, sub, actions, cards, charts, shortcuts, quick, links, body, order })
 * cards: number-card specs; charts: [{ title, node, cmd, wide }]; shortcuts: [{ label, route, id, count, tone, icon }];
 * quick: [{ title, items: [{ label, sub, right, route, id }] }]; links: [{ title, items: [{ label, route, id, icon, count }] }].
 */
cx.workspacePage = (o) => {
  const parts = {
    cards: o.cards?.length ? h('div.ncards', o.cards.map((c) => (c instanceof Node ? c : cx.numberCard(c)))) : null,
    charts: o.charts?.length ? h('div.grid', { class: o.charts.length > 1 ? 'c2' : null }, o.charts.map((c) => (c instanceof Node ? c : cx.card({ class: 'chart-card' + (c.wide ? ' wide' : ''), title: c.title, actions: c.actions, cmd: c.cmd, body: c.node })))) : null,
    shortcuts: o.shortcuts?.length ? h('div', { style: 'display:grid;gap:10px' }, h('h2.ws-sec-title', o.shortcutsTitle || 'Your shortcuts'), h('div.shortcuts', o.shortcuts.map((sc) => h('a.shortcut', { href: cx.href(sc.route, sc.id) }, cx.icon(sc.icon || 'right'), h('span.lbl', sc.label), sc.count != null ? h('span.cnt', { class: 't-' + (TONE_ALIAS[sc.tone] || sc.tone || 'gray') }, String(sc.count)) : null)))) : null,
    quick: o.quick?.length ? h('div.grid', { class: o.quick.length > 1 ? 'c2' : null }, o.quick.map((q) => cx.card({ title: q.title, cmd: q.cmd, actions: q.actions, body: h('ul.quick', { style: 'list-style:none;margin:0;padding:0' }, q.items.map((it) => h('li', h('div', { style: 'flex:1;min-width:0' }, it.route ? cx.link(it.label, it.route, it.id) : it.label, it.sub ? h('div.muted', { style: 'font-size:12px' }, it.sub) : null), it.right ? h('span.num', it.right) : null))) }))) : null,
    links: o.links?.length ? h('div', { style: 'display:grid;gap:10px' }, h('h2.ws-sec-title', o.linksTitle || 'Reports and masters'), h('div.linkcards', o.links.map((lc) => h('section.linkcard', h('h3', lc.title), h('ul', lc.items.map((it) => h('li', h('a', { href: it.route ? cx.href(it.route, it.id) : '#' + cx.current.name, onclick: it.route ? null : (e) => { e.preventDefault(); toast(`${it.label} is not part of this mock-up.`); } }, cx.icon(it.icon || (it.kind === 'report' ? 'report' : 'right')), h('span', it.label), it.count != null ? h('span.cnt', String(it.count)) : null)))))))) : null,
    body: o.body || null,
  };
  const order = o.order || ['cards', 'charts', 'shortcuts', 'quick', 'links', 'body'];
  return cx.page({ title: o.title, crumbs: o.crumbs || [], sub: o.sub, actions: o.actions, cmd: o.cmd, banner: o.banner, fde: o.fde, workspace: o.workspace, body: order.map((k) => parts[k]) });
};

/* =====================================================================================================
   Tabs, sections and fields (the form)
   ===================================================================================================== */

/** cx.tabs([{ label, count, render: () => Node }], { active, key, onChange }) — panels render on first show. */
cx.tabs = (tabs, o = {}) => {
  const memo = o.key ? store.get('tab:' + o.key, null) : null;
  let active = o.active ?? Math.max(0, tabs.findIndex((t) => t.label === memo));
  const bar = h('div.tabs', { role: 'tablist' });
  const panel = h('div.tabpanel', { role: 'tabpanel' });
  const cache = new Map();
  function show(i) {
    active = i;
    [...bar.children].forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
    if (!cache.has(i)) cache.set(i, tabs[i].render ? tabs[i].render() : tabs[i].node);
    fill(panel, cache.get(i));
    if (o.key) store.set('tab:' + o.key, tabs[i].label);
    o.onChange?.(i, tabs[i]);
  }
  tabs.forEach((t, i) => bar.appendChild(h('button.tab', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => show(i) }, t.label, t.count != null ? h('small', String(t.count)) : null)));
  const root = h('div.tabs-root', bar, panel);
  show(Math.min(active, tabs.length - 1));
  root.show = show;
  return root;
};

function displayValue(f, v, doc) {
  if (f.render) return f.render(doc);
  if (v instanceof Node) return v;
  if (v == null || v === '') return h('span.faint', f.type === 'check' ? '' : '—');
  switch (f.type) {
    case 'currency': return fmt.money(v, f.currency || doc?.currency || 'GBP', f.dp ?? 2);
    case 'usdc': return fmt.usdc(v, f.dp ?? 2);
    case 'int': return fmt.int(v);
    case 'float': return fmt.num(v, f.dp ?? 2);
    case 'percent': return fmt.num(v, f.dp ?? 0) + '%';
    case 'date': return fmt.date(v);
    case 'datetime': return fmt.datetime(v);
    case 'status': return cx.pill(v);
    case 'person': return cx.personChip(v);
    case 'link': return f.href ? h('a', { href: Array.isArray(f.href) ? cx.href(f.href[0], f.href[1]) : f.href }, String(v)) : String(v);
    case 'hash': return cx.hashChip(v, { full: f.full });
    case 'address': return cx.addr(v);
    case 'select': {
      const opts = typeof f.options === 'function' ? f.options(doc) : f.options || [];
      const hit = opts.find((op) => Array.isArray(op) && String(op[0]) === String(v));
      return hit ? String(hit[1]) : String(v);
    }
    default: return String(v);
  }
}
/**
 * cx.field({ label, key, value, type, options, reqd, readOnly, edit, model, onChange, help, wide, href, currency, dp, render })
 * Read-only by default (a value box); with edit (or inside an editable form) an input bound to model[key].
 * types: data/text, textarea, select, check, date, int, float, currency, usdc, percent, link, status, person, hash, address, datetime, mono.
 */
cx.field = (f) => {
  const model = f.model || {};
  const v = f.value !== undefined ? f.value : f.key ? model[f.key] : undefined;
  const id = 'f-' + cx.slug(f.id || f.key || f.label).toLowerCase();
  const editing = f.edit && !f.readOnly;
  const label = h(editing ? 'label' : 'div', { class: editing ? null : 'flabel', for: editing ? id : null }, f.label, f.reqd ? h('span.reqd', '*') : null);
  let control;
  if (editing) {
    const set = (val) => { if (f.key) model[f.key] = val; f.onChange?.(val, f.key); };
    if (f.type === 'select') {
      const opts = typeof f.options === 'function' ? f.options(model) : f.options || [];
      control = h('select.finput', { id, onchange: (e) => set(e.target.value) }, opts.map((op) => { const [val, txt] = Array.isArray(op) ? op : [op, op]; return h('option', { value: val, selected: String(val) === String(v ?? '') }, txt); }));
    } else if (f.type === 'textarea') {
      control = h('textarea.finput', { id, rows: f.rows || 3, placeholder: f.placeholder || '', oninput: (e) => set(e.target.value) }, v ?? '');
    } else if (f.type === 'check') {
      control = h('label.fval.check', h('input', { id, type: 'checkbox', checked: !!v, onchange: (e) => set(e.target.checked ? 1 : 0) }), f.checkLabel || '');
    } else {
      const numeric = ['int', 'float', 'currency', 'usdc', 'percent'].includes(f.type);
      control = h('input.finput', { id, type: f.type === 'date' ? 'date' : numeric ? 'number' : 'text', step: numeric ? (f.type === 'int' ? '1' : 'any') : null, class: { num: numeric },
        value: v ?? '', placeholder: f.placeholder || '', oninput: (e) => set(numeric ? (e.target.value === '' ? null : +e.target.value) : e.target.value) });
    }
  } else if (f.type === 'check') {
    control = h('div.fval.check', h('span.box', { class: { on: !!v } }, v ? cx.icon('check') : null), f.checkLabel || (v ? 'Yes' : 'No'));
  } else {
    control = h('div.fval', { class: { num: ['currency', 'usdc', 'int', 'float', 'percent'].includes(f.type), mono: f.type === 'mono' || f.type === 'hash', 'text-block': f.type === 'textarea' } }, displayValue(f, v, model));
  }
  return h('div.field', { class: { wide: f.wide } }, label, control, f.help ? h('div.fhelp', f.help) : null);
};
/**
 * cx.section({ label, collapsible, collapsed, cols, fields, columns, table, node, desc }, { doc, editable, onChange })
 * fields flow into cols columns (default 2); columns gives explicit column breaks ([[...], [...]]).
 */
cx.section = (sec, ctx = {}) => {
  const doc = ctx.doc || {};
  const mk = (f) => (f instanceof Node ? f : f.hidden ? null : cx.field({ ...f, model: doc, edit: (ctx.editable && !f.readOnly) || f.edit, onChange: (val, key) => { ctx.onChange?.(key, val, f); } }));
  let body;
  if (sec.columns) body = h('div.fields', { style: { '--cols': sec.columns.length } }, sec.columns.map((col) => h('div.fcol', col.map(mk))));
  else if (sec.fields) {
    const cols = sec.cols || 2;
    const list = sec.fields.filter((f) => !f.hidden);
    if (cols === 1) body = h('div.fields', { style: { '--cols': 1 } }, list.map(mk));
    else {
      const per = Math.ceil(list.length / cols);
      body = h('div.fields', { style: { '--cols': cols } }, Array.from({ length: cols }, (_, i) => h('div.fcol', list.slice(i * per, (i + 1) * per).map(mk))));
    }
  }
  const content = h('div', { style: 'display:grid;gap:12px;min-width:0' }, sec.desc ? h('p.section-desc', sec.desc) : null, body || null, sec.table ? (sec.table instanceof Node ? sec.table : cx.grid({ editable: ctx.editable, ...sec.table })) : null, sec.node || null);
  const root = h('section.section', { class: { collapsed: sec.collapsed } });
  if (sec.label) {
    if (sec.collapsible) {
      const btn = h('button', { type: 'button', 'aria-expanded': String(!sec.collapsed), onclick: () => { const open = btn.getAttribute('aria-expanded') !== 'true'; btn.setAttribute('aria-expanded', String(open)); content.hidden = !open; root.classList.toggle('collapsed', !open); } }, cx.icon('down'), sec.label);
      root.appendChild(h('div.section-head', btn));
      content.hidden = !!sec.collapsed;
    } else root.appendChild(h('div.section-head', h('h3', sec.label), sec.actions || null));
  }
  root.appendChild(content);
  return root;
};

/**
 * cx.formView({ doc, editable, tabs: [{ label, sections, node, count }], sections, side, timeline, connections, onChange, dirtyPill })
 * The record form: a sheet with tabs of sections (fields, child tables), a side column, the activity timeline below.
 * side: { id, cmd, assigned: [ids], attachments: [names], tags: [words], created: { by, at }, modified: { by, at }, extra: Node }
 */
cx.formView = (o) => {
  const doc = o.doc || {};
  let dirty = false;
  const onChange = (key, val, f) => {
    if (!dirty && o.dirtyPill !== false) { dirty = true; cx.setStatus(cx.pill('Not saved', 'orange', { lg: true })); }
    o.onChange?.(doc, key, val, f);
  };
  const ctx = { doc, editable: !!o.editable, onChange };
  const tabs = (o.tabs || [{ label: 'Details', sections: o.sections || [] }]).map((t) => ({ label: t.label, count: t.count, render: () => t.render ? t.render() : h('div', t.node || null, (t.sections || []).map((sec) => (sec instanceof Node ? sec : cx.section(sec, ctx)))) }));
  if (o.connections?.length) tabs.push({ label: 'Connections', render: () => connectionsOf(o.connections) });
  // A link may open a form on one of its tabs: cx.go('payslip', id, { tab: 'Payment' }).
  const wantTab = cx.current.state?.tab;
  const ai = wantTab ? tabs.findIndex((t) => t.label === wantTab) : -1;
  const sheet = h('div.form-sheet', tabs.length > 1 ? cx.tabs(tabs, { key: o.tabKey, active: ai >= 0 ? ai : undefined }) : tabs[0].render());
  const tl = o.timeline ? h('section', { style: 'display:grid;gap:8px' }, h('h3', { style: 'font:600 14px/1.3 var(--font-ui);margin-top:6px' }, o.timelineTitle || 'Activity'), cx.timeline(o.timeline.items || o.timeline, { comment: o.timeline.comment ?? true })) : null;
  const main = h('div.form-main', sheet, tl);
  return h('div.form', h('div.form-layout', { class: { solo: !o.side } , style: o.side ? null : 'grid-template-columns:minmax(0,1fr)' }, main, o.side ? formSide(o.side) : null));
};
function connectionsOf(groups) {
  return h('div', { style: 'padding:16px;display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr))' }, groups.map((g) => h('div', h('h4', { style: 'font-size:12px;color:var(--muted);font-weight:600;margin-bottom:6px' }, g.group),
    h('div', { style: 'display:grid;gap:6px' }, g.items.map((it) => h('a.shortcut', { href: it.route ? cx.href(it.route, it.id) : '#' + cx.current.name, style: 'padding:7px 10px' }, h('span.lbl', it.label), h('span.cnt.t-gray', String(it.count ?? 0))))))));
}
function formSide(sd) {
  const sec = (title, kids, add) => h('div.side-sec', h('h4', title), kids, add ? h('button.add', { type: 'button', onclick: () => toast(`${add} is a record change; the command is on the strip.`) }, cx.icon('plus', { size: 12 }), add) : null);
  return h('aside.form-side', cx.card({ body: [
    sd.id ? h('div', { style: 'display:grid;gap:4px' }, h('div', { style: 'font-weight:600;overflow-wrap:anywhere' }, sd.title || ''), h('div', cx.hashChip(sd.id, { kind: 'id' }))) : null,
    sd.cmd ? h('div', { style: 'font:11.5px/1.5 var(--font-mono);color:var(--muted);overflow-wrap:anywhere;padding:7px 8px;background:var(--surface-2);border-radius:4px' }, '$ ' + sd.cmd) : null,
    sd.assigned ? sec('Assigned to', sd.assigned.length ? h('div.chips', sd.assigned.map((id) => cx.personChip(id))) : h('div.faint', 'Nobody'), 'Assign') : null,
    sd.attachments ? sec('Attachments', sd.attachments.length ? h('div', { style: 'display:grid;gap:3px' }, sd.attachments.map((a) => h('span', { style: 'display:flex;gap:6px;align-items:center' }, cx.icon('file', { size: 13 }), a))) : h('div.faint', 'None'), 'Attach a file') : null,
    sd.tags ? sec('Tags', sd.tags.length ? h('div.chips', sd.tags.map(cx.tag)) : h('div.faint', 'None'), 'Add a tag') : null,
    sd.extra || null,
    sd.modified || sd.created ? h('div', { style: 'display:grid;gap:3px;font-size:12.5px;color:var(--muted)' },
      sd.modified ? h('span', `${cx.name(sd.modified.by) || 'Capxul'} last edited this · ${fmt.agoLong(sd.modified.at)}`) : null,
      sd.created ? h('span', `${cx.name(sd.created.by) || 'Capxul'} created this · ${fmt.agoLong(sd.created.at)}`) : null) : null,
  ] }));
}

/**
 * cx.grid({ columns: [{ key, label, type, currency, edit, options, render, width, align }], rows, editable, onChange, totals: [keys], addLabel, empty, rowHref, numbered })
 * A child table: No. column, totals, Add row and Delete when editable, and a pencil that opens the full row.
 */
cx.grid = (o) => {
  const rows = o.rows || [];
  const sel = new Set();
  const root = h('div.cgrid');
  const cell = (c, r, i) => {
    if (o.editable && c.edit) {
      const numeric = ['int', 'float', 'currency', 'usdc', 'percent'].includes(c.type);
      const cellKey = i + ':' + c.key;
      if (c.type === 'select') {
        const opts = typeof c.options === 'function' ? c.options(r) : c.options || [];
        return h('select', { 'aria-label': `${c.label}, row ${i + 1}`, dataset: { cell: cellKey }, onchange: (e) => { r[c.key] = e.target.value; changed(true); } },
          opts.map((op) => { const [val, txt] = Array.isArray(op) ? op : [op, op]; return h('option', { value: val, selected: String(val) === String(r[c.key] ?? '') }, txt); }));
      }
      return h('input', { type: numeric ? 'number' : c.type === 'date' ? 'date' : 'text', step: 'any', class: numeric ? 'num' : null, value: r[c.key] ?? '', 'aria-label': `${c.label}, row ${i + 1}`, dataset: { cell: cellKey },
        onchange: (e) => { r[c.key] = numeric ? +e.target.value : e.target.value; changed(true); } });
    }
    const v = c.get ? c.get(r) : r[c.key];
    return c.render ? c.render(r, i) : displayValue(c, v, r);
  };
  // A cell's change redraws after focus has moved on (Tab, a click), then puts focus back on the same cell of the new
  // table, so typing through a row's cells is not interrupted.
  let redraw = 0;
  const changed = (fromCell) => {
    o.onChange?.(rows);
    if (!fromCell) return draw();
    clearTimeout(redraw);
    redraw = setTimeout(() => {
      if (!root.isConnected) return;
      const a = document.activeElement;
      const keep = a && root.contains(a) ? a.dataset?.cell : null;
      const selStart = keep && typeof a.selectionStart === 'number' ? a.selectionStart : null;
      draw();
      if (keep) {
        const el = root.querySelector(`[data-cell="${keep}"]`);
        if (el) { el.focus(); if (selStart != null) try { el.setSelectionRange(selStart, selStart); } catch { /* number inputs have no selection */ } }
      }
    }, 0);
  };
  function draw() {
    const numCols = (c) => ['currency', 'usdc', 'int', 'float', 'percent'].includes(c.type) || c.align === 'right';
    const head = h('tr', o.editable ? h('th.chk', h('input', { type: 'checkbox', 'aria-label': 'Select all rows', checked: sel.size === rows.length && rows.length > 0, onchange: (e) => { sel.clear(); if (e.target.checked) rows.forEach((_, i) => sel.add(i)); draw(); } })) : null,
      o.numbered !== false ? h('th.idx', 'No.') : null, o.columns.map((c) => h('th', { class: { num: numCols(c), opt: c.opt }, style: c.width ? { width: c.width } : null }, c.label)), o.editable || o.rowForm ? h('th', { style: 'width:34px' }) : null);
    const body = rows.map((r, i) => h('tr', { class: { click: !!o.rowHref && !o.editable, sel: sel.has(i) }, onclick: o.rowHref && !o.editable ? (e) => { if (e.target.closest('a,button,input')) return; cx.go(...o.rowHref(r)); } : null },
      o.editable ? h('td.chk', h('input', { type: 'checkbox', 'aria-label': `Select row ${i + 1}`, checked: sel.has(i), onchange: (e) => { e.target.checked ? sel.add(i) : sel.delete(i); draw(); } })) : null,
      o.numbered !== false ? h('td.idx', String(i + 1)) : null,
      o.columns.map((c) => h('td', { class: { num: numCols(c), opt: c.opt } }, cell(c, r, i))),
      o.editable || o.rowForm ? h('td', h('button.edit', { type: 'button', title: 'Open the row', onclick: () => rowModal(r, i) }, cx.icon('edit'))) : null));
    let foot = null;
    if (o.totals?.length && rows.length) {
      foot = h('tr.total', o.editable ? h('td') : null, o.numbered !== false ? h('td') : null, o.columns.map((c, j) => {
        if (o.totals.includes(c.key)) { const sum = rows.reduce((a, r) => a + (+(c.get ? c.get(r) : r[c.key]) || 0), 0); return h('td.num', displayValue(c, sum, rows[0])); }
        return h('td', j === 0 ? 'Total' : '');
      }), o.editable || o.rowForm ? h('td') : null);
    }
    const table = h('table.tbl', h('thead', head), h('tbody', rows.length ? body : h('tr', h('td', { colspan: o.columns.length + 3 }, h('div.empty', o.empty || 'No rows')))), foot ? h('tfoot', foot) : null);
    fill(root, h('div.tbl-scroll', table));
    if (o.editable) root.appendChild(h('div.cgrid-foot',
      h('button.btn.sm', { type: 'button', onclick: () => { rows.push(Object.fromEntries(o.columns.map((c) => [c.key, c.default ?? (['int', 'float', 'currency', 'usdc'].includes(c.type) ? 0 : '')]))); changed(); } }, cx.icon('plus'), o.addLabel || 'Add row'),
      sel.size ? h('button.btn.sm.danger', { type: 'button', onclick: () => { [...sel].sort((a, b) => b - a).forEach((i) => rows.splice(i, 1)); sel.clear(); changed(); } }, cx.icon('trash'), `Delete ${sel.size}`) : null,
      h('span.grow'), h('span.muted', { style: 'font-size:12px' }, fmt.plural(rows.length, 'row'))));
  }
  function rowModal(r, i) {
    const fields = (o.rowForm || o.columns).map((c) => ({ ...c, model: r, edit: o.editable && c.edit !== false && !c.render }));
    cx.modal({ title: `${o.title || 'Row'} ${i + 1}`, body: h('div.fields', { style: { '--cols': 2 } }, fields.map((f) => cx.field(f))), actions: [{ label: 'Done', primary: true, onClick: (close) => { close(); changed(); } }] });
  }
  draw();
  return root;
};

/**
 * cx.timeline(items, { comment, sort }) — the record's activity: newest first.
 * item: { at, who, text, kind: created|change|comment|email|whatsapp|call|note|task|money|link|approval|status, body, sub, href }
 */
cx.timeline = (items, o = {}) => {
  const list = [...(items || [])];
  if (o.sort !== false) list.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const ICON = { created: 'plus', change: 'edit', comment: 'comment', email: 'mail', whatsapp: 'message', call: 'phone', note: 'note', task: 'task', money: 'shield', link: 'link', approval: 'check', status: 'activity', payment: 'shield', submitted: 'check', cancelled: 'x', attachment: 'file' };
  const root = h('div.tl');
  const item = (it) => h('div.tl-item',
    h('span.tl-icon', { class: 'k-' + (it.kind || 'change') }, it.who && ['comment'].includes(it.kind) ? cx.avatar(it.who, { size: 'sm' }) : cx.icon(it.icon || ICON[it.kind] || 'activity')),
    h('div.tl-text', it.who ? h('b', cx.name(it.who) + ' ') : null, it.text instanceof Node ? it.text : it.href ? h('a', { href: Array.isArray(it.href) ? cx.href(...it.href) : it.href }, it.text) : (it.text || ''),
      it.at ? h('span.when', { title: fmt.datetime(it.at) }, '· ' + fmt.agoLong(it.at)) : null,
      it.body || it.sub ? h('div.tl-body', it.sub ? h('span.tl-sub', it.sub) : null, it.body instanceof Node ? it.body : it.body || '') : null));
  if (o.comment) {
    const ta = h('textarea.finput', { id: 'tl-comment-' + Math.random().toString(36).slice(2, 7), rows: 2, placeholder: 'Add a comment', 'aria-label': 'Add a comment' });
    const form = h('form', { onsubmit: (e) => {
      e.preventDefault(); const t = ta.value.trim(); if (!t) return;
      root.insertBefore(item({ at: cx.now.toISOString(), who: meId, kind: 'comment', text: 'commented', body: t }), form.parentNode.nextSibling);
      ta.value = ''; o.onComment?.(t); toast('Comment added');
    } }, ta, h('div', h('button.btn.sm', { type: 'submit' }, 'Comment')));
    root.appendChild(h('div.tl-comment', cx.avatar(meId), form));
  }
  list.forEach((it) => root.appendChild(item(it)));
  if (!list.length && !o.comment) root.appendChild(h('div.empty', 'Nothing yet'));
  return root;
};

/* =====================================================================================================
   List view
   ===================================================================================================== */

const lvStates = new Map();
const OPS = [['=', 'equals'], ['!=', 'not equals'], ['like', 'like'], ['>', '>'], ['<', '<'], ['>=', '>='], ['<=', '<='], ['set', 'is set'], ['notset', 'is not set']];
function cmpCond(v, op, want) {
  if (op === 'set') return v != null && v !== '';
  if (op === 'notset') return v == null || v === '';
  const nv = +v, nw = +want, numeric = want !== '' && !Number.isNaN(nw) && v !== '' && v != null && !Number.isNaN(nv);
  const sv = String(v ?? '').toLowerCase(), sw = String(want ?? '').toLowerCase();
  switch (op) {
    case '=': return numeric ? nv === nw : sv === sw;
    case '!=': return numeric ? nv !== nw : sv !== sw;
    case 'like': return sv.includes(sw.replace(/%/g, ''));
    case '>': return numeric ? nv > nw : sv > sw;
    case '<': return numeric ? nv < nw : sv < sw;
    case '>=': return numeric ? nv >= nw : sv >= sw;
    case '<=': return numeric ? nv <= nw : sv <= sw;
    default: return true;
  }
}
function colText(c, r) {
  const v = c.get ? c.get(r) : r[c.key];
  if (v == null) return '';
  if (c.type === 'person') return cx.name(v);
  return String(v);
}
function cellOf(c, r) {
  if (c.render) return c.render(r);
  const v = c.get ? c.get(r) : r[c.key];
  if (v == null || v === '') return h('span.faint', '—');
  switch (c.type) {
    case 'currency': return fmt.money(v, c.currency || r.currency || 'GBP', c.dp ?? 2);
    case 'usdc': return fmt.usdc(v, c.dp ?? 2);
    case 'int': return fmt.int(v);
    case 'float': case 'number': return fmt.num(v, c.dp ?? 2);
    case 'percent': return fmt.num(v, c.dp ?? 0) + '%';
    case 'date': return fmt.date(v);
    case 'datetime': return fmt.datetime(v);
    case 'status': return cx.pill(v);
    case 'dot': return cx.dot(v, c.color?.(r));
    case 'person': return cx.personChip(v, { link: false });
    case 'check': return v ? cx.icon('check') : '';
    case 'ago': return h('span.ago', { title: fmt.datetime(v) }, fmt.ago(v));
    default: return String(v);
  }
}
const isNumType = (c) => ['currency', 'usdc', 'int', 'float', 'number', 'percent'].includes(c?.type) || c?.align === 'right';
/**
 * cx.listView(o) — the desk's list: saved filter tabs, standard filters, Filter builder, sort, group-by counts,
 * checkboxes and bulk actions, paging (20 · 100 · 500), and the command strip following the filters.
 * See README.md for every option.
 */
cx.listView = (o) => {
  const key = o.key || cx.current.name;
  const filters = o.filters || [];
  const columns = o.columns || [];
  const idOf = o.id || ((r) => r.name);
  const titleCol = o.titleCol || { label: o.titleLabel || 'Title', get: (r) => r.title || r.name };
  const sortOpts = o.sort?.options || [];
  let st = lvStates.get(key);
  const fresh = !st || !!o.reset;
  if (!st || o.reset) {
    st = { filters: {}, conds: [], tab: 0, sort: o.sort?.default?.key || sortOpts[0]?.key || null, dir: o.sort?.default?.dir || 'desc', limit: o.pageSize || 20, facet: null, sel: new Set() };
    for (const f of filters) if (f.default != null) st.filters[f.key] = f.default;
    lvStates.set(key, st);
  }
  // defaultTab (an index or a tab's label) is the tab a list opens on the first time, and when a link carries filters
  // but no tab. Navigation state (cx.go(route, id, { list })) wins over o.initial.
  const tabIndex = (t) => (typeof t === 'number' ? t : Math.max(0, (o.tabs || []).findIndex((x) => x.label === t)));
  if (fresh && o.defaultTab != null) st.tab = tabIndex(o.defaultTab);
  const init = cx.current.state?.list || o.initial;
  if (init) {
    if (init.filters) { st.filters = { ...init.filters }; st.conds = []; st.facet = null; }
    if (init.tab != null) st.tab = tabIndex(init.tab);
    else if (init.filters && o.defaultTab != null) st.tab = tabIndex(o.defaultTab);
  }
  st.sel = new Set();
  const getters = new Map();
  for (const c of [titleCol, ...columns, ...(o.right ? [o.right] : [])]) if (c.key) getters.set(c.key, c);
  const valueOf = (r, k) => { const f = filters.find((x) => x.key === k); if (f?.get) return f.get(r); const c = getters.get(k); return c?.get ? c.get(r) : r[k]; };
  const matchFilter = (r, f, val) => {
    if (val == null || val === '' || val === false) return true;
    if (f.match) return f.match(r, val);
    const v = valueOf(r, f.key);
    switch (f.type) {
      case 'select': case 'person': return String(v ?? '') === String(val);
      case 'check': return !!v;
      case 'date': return String(v ?? '').startsWith(val);
      case 'month': return String(v ?? '').startsWith(val);
      default: return String(v ?? '').toLowerCase().includes(String(val).toLowerCase()) || (f.key === 'name' || f.alsoId ? String(idOf(r)).toLowerCase().includes(String(val).toLowerCase()) : false);
    }
  };
  const base = () => (typeof o.rows === 'function' ? o.rows() : o.rows) || [];
  const passes = (r, skipFacet) => {
    for (const f of filters) if (!matchFilter(r, f, st.filters[f.key])) return false;
    for (const c of st.conds) if (!cmpCond(valueOf(r, c.field), c.op, c.value)) return false;
    if (!skipFacet && st.facet) { const g = o.groupBy.find((x) => x.key === st.facet.key); if (g && String(g.get ? g.get(r) : r[g.key]) !== st.facet.value) return false; }
    return true;
  };
  const tabRows = (rows, i) => (o.tabs?.[i]?.filter ? rows.filter(o.tabs[i].filter) : rows);
  function compute() {
    let rows = tabRows(base(), st.tab).filter((r) => passes(r));
    const so = sortOpts.find((x) => x.key === st.sort);
    if (so) {
      const g = so.get || ((r) => valueOf(r, so.key));
      rows = [...rows].sort((a, b) => { const x = g(a), y = g(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? '')); return st.dir === 'asc' ? c : -c; });
    }
    return rows;
  }
  let firstUpdate = true;
  const root = h('div.lv');
  const tabsEl = o.tabs?.length ? h('div.lv-tabs', { role: 'toolbar', 'aria-label': 'Saved filters' }) : null;
  const bar = h('div.lv-bar');
  const side = o.groupBy?.length ? h('aside.lv-side') : null;
  const top = h('div.lv-top');
  const tableWrap = h('div.tbl-scroll');
  const foot = h('div.lv-foot');
  const inputs = new Map();
  for (const f of filters) {
    const id = `lv-${cx.slug(key)}-${cx.slug(f.key)}`.toLowerCase();
    let el;
    const on = (val) => { st.filters[f.key] = val; st.limit = o.pageSize || 20; update(); };
    if (f.type === 'select' || f.type === 'person') {
      const opts = typeof f.options === 'function' ? f.options() : f.options || [...new Set(base().map((r) => valueOf(r, f.key)).filter((v) => v != null && v !== ''))].sort();
      el = h('select.ctl', { id, 'aria-label': f.label, onchange: (e) => on(e.target.value) }, h('option', { value: '' }, f.label), opts.map((op) => { const [val, txt] = Array.isArray(op) ? op : [op, f.type === 'person' ? cx.name(op) : op]; return h('option', { value: val }, txt); }));
    } else if (f.type === 'check') {
      el = h('label.ctl', { style: 'display:inline-flex;align-items:center;gap:6px;width:auto' }, h('input', { id, type: 'checkbox', onchange: (e) => on(e.target.checked) }), f.label);
    } else {
      el = h('input.ctl', { id, type: f.type === 'date' ? 'date' : f.type === 'month' ? 'month' : 'search', placeholder: f.label, 'aria-label': f.label, oninput: (e) => on(e.target.value) });
    }
    inputs.set(f.key, el); bar.appendChild(el);
  }
  const fbBtn = h('button.btn', { type: 'button' }, cx.icon('filter'), h('span', 'Filter'));
  const fb = cx.popover(fbBtn, (p) => filterBuilder(p), { align: 'left', role: 'dialog' });
  const clearBtn = h('button.btn.ghost', { type: 'button', title: 'Clear filters', onclick: () => { st.filters = {}; st.conds = []; st.facet = null; syncInputs(); update(); } }, cx.icon('x'), h('span', 'Clear'));
  bar.append(fb.wrap, clearBtn, h('span.grow'));
  if (o.views?.length) bar.appendChild(h('div.btn-group', o.views.map((v) => h('a.btn', { href: cx.href(v.route, v.id), class: { primary: v.active }, 'aria-current': v.active ? 'page' : null }, v.icon ? cx.icon(v.icon) : null, h('span', v.label)))));
  if (sortOpts.length) {
    const sel = h('select.ctl', { 'aria-label': 'Sort by', style: 'width:auto', onchange: (e) => { st.sort = e.target.value; update(); } }, sortOpts.map((so) => h('option', { value: so.key, selected: so.key === st.sort }, so.label)));
    const dirBtn = h('button.btn', { type: 'button', title: 'Ascending or descending', 'aria-label': 'Sort direction', onclick: () => { st.dir = st.dir === 'asc' ? 'desc' : 'asc'; fill(dirBtn, cx.icon('sort'), h('span', st.dir === 'asc' ? 'Asc' : 'Desc')); update(); } }, cx.icon('sort'), h('span', st.dir === 'asc' ? 'Asc' : 'Desc'));
    bar.append(sel, dirBtn);
  }
  function syncInputs() {
    for (const f of filters) {
      const el = inputs.get(f.key), v = st.filters[f.key];
      if (f.type === 'check') el.querySelector('input').checked = !!v; else el.value = v ?? '';
    }
  }
  function filterBuilder(p) {
    const fields = [...new Map([...filters.map((f) => [f.key, f.label]), ...[titleCol, ...columns, ...(o.right ? [o.right] : [])].filter((c) => c.key).map((c) => [c.key, c.label])]).entries()];
    const draft = st.conds.length ? st.conds.map((c) => ({ ...c })) : [{ field: fields[0]?.[0], op: '=', value: '' }];
    const box = h('div.fb');
    const drawFb = () => {
      fill(box, 
        ...draft.map((c, i) => h('div.fb-row',
          h('select.ctl', { 'aria-label': 'Field', onchange: (e) => { c.field = e.target.value; } }, fields.map(([k, l]) => h('option', { value: k, selected: k === c.field }, l))),
          h('select.ctl', { 'aria-label': 'Condition', onchange: (e) => { c.op = e.target.value; } }, OPS.map(([k, l]) => h('option', { value: k, selected: k === c.op }, l))),
          h('input.ctl', { 'aria-label': 'Value', value: c.value, oninput: (e) => { c.value = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') apply(); } }),
          h('button.btn.ghost.sm', { type: 'button', title: 'Remove', onclick: () => { draft.splice(i, 1); drawFb(); } }, cx.icon('x')))),
        h('div.fb-actions', h('button.btn.sm', { type: 'button', onclick: () => { draft.push({ field: fields[0]?.[0], op: '=', value: '' }); drawFb(); } }, cx.icon('plus'), '+ Add a filter'), h('button.btn.sm.primary', { type: 'button', onclick: apply }, 'Apply filters')));
    };
    const apply = () => { st.conds = draft.filter((c) => c.field && (c.value !== '' || c.op === 'set' || c.op === 'notset')); p.close(); update(); };
    drawFb();
    return box;
  }
  function update() {
    const all = base();
    const rows = compute();
    if (tabsEl) fill(tabsEl, ...o.tabs.map((t, i) => h('button.lv-tab', { type: 'button', 'aria-pressed': String(st.tab === i), onclick: () => { st.tab = i; st.limit = o.pageSize || 20; update(); } }, t.label, t.count !== false ? h('small', fmt.int(tabRows(all, i).filter((r) => passes(r)).length)) : null)));
    const active = Object.values(st.filters).filter((v) => v !== '' && v != null && v !== false).length + st.conds.length + (st.facet ? 1 : 0);
    fill(fbBtn, cx.icon('filter'), h('span', st.conds.length ? `Filter · ${st.conds.length}` : 'Filter'));
    clearBtn.hidden = !active;
    if (side) fill(side, ...o.groupBy.map((g) => {
      const counts = new Map();
      for (const r of tabRows(all, st.tab).filter((x) => passes(x, true))) { const v = String(g.get ? g.get(r) : r[g.key] ?? ''); if (v) counts.set(v, (counts.get(v) || 0) + 1); }
      const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, g.limit || 8);
      return h('div', h('h4', g.label), list.map(([v, n]) => h('button', { type: 'button', 'aria-pressed': String(st.facet?.key === g.key && st.facet.value === v), onclick: () => { st.facet = st.facet?.key === g.key && st.facet.value === v ? null : { key: g.key, value: v }; update(); } }, h('span', g.format ? g.format(v) : g.type === 'person' ? cx.name(v) : v), h('small', fmt.int(n)))));
    }));
    const shown = rows.slice(0, st.limit);
    const hdr = h('tr',
      o.selectable !== false ? h('th.chk', h('input', { type: 'checkbox', 'aria-label': 'Select all', checked: shown.length > 0 && shown.every((r) => st.sel.has(idOf(r))), onchange: (e) => { shown.forEach((r) => (e.target.checked ? st.sel.add(idOf(r)) : st.sel.delete(idOf(r)))); update(); } })) : null,
      h('th', titleCol.label), o.status ? h('th', o.statusLabel || 'Status') : null,
      columns.map((c) => h('th', { class: { num: isNumType(c), opt: !c.keep }, style: c.width ? { width: c.width } : null }, c.label)),
      o.right ? h('th.num', o.right.label) : null,
      o.showId !== false ? h('th.opt', o.idLabel || 'ID') : null,
      o.modified ? h('th.opt', { style: 'text-align:right' }, h('span.sr', 'Last changed')) : null);
    const body = shown.map((r) => {
      const id = idOf(r);
      const href = o.href ? o.href(r) : null;
      const url = href ? (Array.isArray(href) ? cx.href(href[0], href[1]) : href) : null;
      const st0 = o.status ? o.status(r) : null;
      const title = titleCol.render ? titleCol.render(r) : (titleCol.get ? titleCol.get(r) : r[titleCol.key]);
      return h('tr', { class: { click: !!(url || o.onOpen), sel: st.sel.has(id) }, onclick: (e) => { if (e.target.closest('a,button,input,label')) return; if (o.onOpen) o.onOpen(r); else if (url) location.hash = url; } },
        o.selectable !== false ? h('td.chk', h('input', { type: 'checkbox', 'aria-label': `Select ${id}`, checked: st.sel.has(id), onchange: (e) => { e.target.checked ? st.sel.add(id) : st.sel.delete(id); updateTop(rows); e.target.closest('tr').classList.toggle('sel', e.target.checked); } })) : null,
        h('td', h('div.lv-cell-title', url && !(title instanceof Node) ? h('a.ttl', { href: url }, String(title ?? '')) : h('span.ttl', title ?? ''), titleCol.sub ? h('span.sub', titleCol.sub(r) ?? '') : null, o.showId !== false && String(title) !== String(id) ? h('span.id-narrow', id) : null)),
        o.status ? h('td', st0 instanceof Node ? st0 : st0 == null ? '' : typeof st0 === 'string' ? cx.pill(st0) : cx.pill(st0.text, st0.tone)) : null,
        columns.map((c) => h('td', { class: { num: isNumType(c), opt: !c.keep } }, cellOf(c, r))),
        o.right ? h('td.num', cellOf(o.right, r)) : null,
        o.showId !== false ? h('td.opt', h('span.id', id)) : null,
        o.modified ? h('td.opt', { style: 'text-align:right' }, h('span.ago', { title: fmt.datetime(o.modified(r)) }, fmt.ago(o.modified(r)))) : null);
    });
    const ncols = 2 + (o.status ? 1 : 0) + columns.length + (o.right ? 1 : 0) + (o.showId !== false ? 1 : 0) + (o.modified ? 1 : 0);
    fill(tableWrap, h('table.tbl', h('thead', hdr), h('tbody', body.length ? body : h('tr', h('td', { colspan: ncols }, cx.empty(o.empty || 'Nothing matches these filters.', active ? h('button.btn.sm', { type: 'button', onclick: () => clearBtn.click() }, 'Clear filters') : null))))));
    updateTop(rows);
    fill(foot, h('span', 'Show'), h('span.seg', [20, 100, 500].map((n) => h('button', { type: 'button', 'aria-pressed': String(st.limit === n), onclick: () => { st.limit = n; update(); } }, String(n)))),
      rows.length > st.limit ? h('button.btn.sm.ghost', { type: 'button', onclick: () => { st.limit += o.pageSize || 20; update(); } }, 'Load more') : null,
      h('span', { style: 'margin-left:auto' }, `${fmt.int(Math.min(st.limit, rows.length))} of ${fmt.int(rows.length)}`));
    const spec = typeof o.cmd === 'function' ? o.cmd(st, rows) : o.cmd ? withFilters(o.cmd, st, filters) : null;
    if (spec && o.setsCommand !== false && o.strip !== false) { if (firstUpdate) queueMicrotask(() => strip.screen(spec)); else strip.screen(spec); }
    firstUpdate = false;
  }
  function updateTop(rows) {
    const n = st.sel.size;
    const selRows = () => base().filter((r) => st.sel.has(idOf(r)));
    fill(top, 
      n ? h('span', { style: 'color:var(--fg);font-weight:600' }, `${fmt.int(n)} selected`) : h('span', `${fmt.int(rows.length)} ${rows.length === 1 ? (o.noun || 'record') : (o.nouns || (o.noun ? o.noun + 's' : 'records'))}`),
      h('span.grow'),
      n && o.bulk?.length ? cx.menu('Actions', o.bulk.map((b) => ({ ...b, onClick: () => b.onClick?.(selRows()) })), { sm: true }) : null,
      n ? h('button.btn.sm.ghost', { type: 'button', onclick: () => { st.sel.clear(); update(); } }, 'Deselect') : null,
      !n && o.topRight ? o.topRight : null,
      !n ? h('span', `${fmt.int(Math.min(st.limit, rows.length))} of ${fmt.int(rows.length)}`) : null);
  }
  syncInputs();
  update();
  root.append(...[tabsEl, bar].filter(Boolean), h('div.lv-wrap', { class: { noside: !side } }, side, h('div.lv-card', top, tableWrap, foot)));
  root.refresh = update;
  root.state = st;
  return root;
};
const snake = (k) => String(k).replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
function withFilters(cmd, st, filters) {
  const spec = typeof cmd === 'string' ? { cli: cmd } : { ...cmd };
  if (spec.filters === false) return spec;
  const flag = spec.filterFlag || '--filter';
  const parts = [];
  for (const f of filters) {
    const v = st.filters[f.key];
    if (v === '' || v == null || v === false) continue;
    if (f.flag) parts.push(`${f.flag} ${/\s/.test(String(v)) ? JSON.stringify(String(v)) : v}`);
    else parts.push(`${flag} ${f.field || snake(f.key)}=${/\s/.test(String(v)) ? JSON.stringify(String(v)) : v}`);
  }
  for (const c of st.conds) parts.push(`${flag} "${snake(c.field)}${c.op === 'like' ? ' like ' : c.op === 'set' ? ' is set' : c.op === 'notset' ? ' is not set' : c.op}${['set', 'notset'].includes(c.op) ? '' : c.value}"`);
  if (parts.length) spec.cli = String([].concat(spec.cli)[0]) + ' ' + parts.join(' ');
  delete spec.sdk;
  return spec;
}

/* =====================================================================================================
   Report view
   ===================================================================================================== */

const rvStates = new Map();
function parseColFilter(q) {
  q = q.trim(); if (!q) return null;
  let m;
  if ((m = /^(-?[\d.,]+)\s*:\s*(-?[\d.,]+)$/.exec(q))) return (v) => +v >= +m[1].replace(/,/g, '') && +v <= +m[2].replace(/,/g, '');
  if ((m = /^(>=|<=|>|<|=)\s*(-?[\d.,]+)$/.exec(q))) { const n = +m[2].replace(/,/g, ''); return (v) => cmpCond(v, m[1], n); }
  return null;
}
/**
 * cx.reportView({ key, title, filters, run, cmd, related, columnFilters, totals, footnote })
 * filters: [{ key, label, type: 'date'|'month'|'select'|'text'|'check', options, value }]
 * run(values) → { columns, rows, totals, chart, summary, message }   (rows may carry indent, group, bold, total)
 * cmd(values) → the command for the strip.
 */
cx.reportView = (o) => {
  const key = o.key || cx.current.name;
  let st = rvStates.get(key);
  if (!st) { st = { values: Object.fromEntries((o.filters || []).map((f) => [f.key, f.value ?? ''])), hidden: new Set(), colf: {}, collapsed: new Set() }; rvStates.set(key, st); }
  if (cx.current.state?.report) Object.assign(st.values, cx.current.state.report);
  const root = h('div.lv');
  const bar = h('div.lv-bar');
  const summary = h('div');
  const chartBox = h('div');
  const tableWrap = h('div.tbl-scroll', { style: 'max-height:none' });
  const top = h('div.lv-top');
  const msg = h('div');
  for (const f of o.filters || []) {
    const id = `rv-${cx.slug(key)}-${cx.slug(f.key)}`.toLowerCase();
    let el;
    const on = (v) => { st.values[f.key] = v; st.collapsed.clear(); run(); };
    if (f.type === 'select') el = h('select.ctl', { id, 'aria-label': f.label, title: f.label, onchange: (e) => on(e.target.value) }, (typeof f.options === 'function' ? f.options() : f.options).map((op) => { const [v, t] = Array.isArray(op) ? op : [op, op]; return h('option', { value: v, selected: String(v) === String(st.values[f.key]) }, t); }));
    else if (f.type === 'check') el = h('label.ctl', { style: 'display:inline-flex;align-items:center;gap:6px;width:auto' }, h('input', { id, type: 'checkbox', checked: !!st.values[f.key], onchange: (e) => on(e.target.checked) }), f.label);
    else el = h('input.ctl', { id, type: f.type === 'date' ? 'date' : f.type === 'month' ? 'month' : 'search', value: st.values[f.key] ?? '', placeholder: f.label, 'aria-label': f.label, title: f.label, onchange: (e) => on(e.target.value) });
    bar.appendChild(f.type === 'check' ? el : h('label', { style: 'display:grid;gap:2px;font-size:11.5px;color:var(--muted)' }, f.label, el));
  }
  let result = null;
  const pick = () => cx.modal({ title: 'Pick columns', body: h('div', { style: 'display:grid;gap:6px' }, result.columns.map((c) => h('label', { style: 'display:flex;gap:8px;align-items:center' }, h('input', { type: 'checkbox', checked: !st.hidden.has(c.key), onchange: (e) => { e.target.checked ? st.hidden.delete(c.key) : st.hidden.add(c.key); draw(); } }), c.label))), actions: [{ label: 'Done', primary: true }] });
  const exportCmd = () => { const c = normCmd(typeof o.cmd === 'function' ? o.cmd(st.values, result) : o.cmd); return c?.lines.length ? c.lines[0] + ' --format csv' : null; };
  bar.append(h('span.grow'), ...(o.related || []), cx.menu('Actions', () => [
    { label: 'Pick columns', icon: 'report', onClick: pick },
    { label: 'Export', icon: 'file', cmd: exportCmd(), onClick: () => toast('This is the command Capxul would run. The mock-up makes no downloads.', { cmd: exportCmd() }) },
    { label: 'Refresh', icon: 'refresh', onClick: () => run() },
  ]));
  function run() {
    const out = o.run(st.values);
    Promise.resolve(out).then((r) => {
      result = r || { columns: [], rows: [] };
      fill(summary, result.summary?.length ? h('div.ncards', result.summary.map((x) => (x instanceof Node ? x : cx.numberCard(x)))) : '');
      fill(chartBox, result.chart ? cx.card({ class: 'chart-card', title: result.chartTitle || null, body: result.chart }) : '');
      fill(msg, result.message ? cx.banner(result.message, { tone: result.messageTone }) : '');
      draw();
      const spec = typeof o.cmd === 'function' ? o.cmd(st.values, result) : o.cmd;
      if (spec) strip.screen(spec);
    });
  }
  function draw() {
    const cols = result.columns.filter((c) => !st.hidden.has(c.key));
    const tree = result.rows.some((r) => r.indent);
    const useColF = o.columnFilters !== false && !tree;
    let rows = result.rows;
    if (useColF) rows = rows.filter((r) => cols.every((c) => {
      const q = st.colf[c.key]; if (!q) return true;
      const v = c.get ? c.get(r) : r[c.key];
      const nf2 = isNumType(c) ? parseColFilter(q) : null;
      return nf2 ? nf2(v) : String(v ?? '').toLowerCase().includes(q.toLowerCase());
    }));
    const visible = [];
    let hideBelow = null;
    rows.forEach((r, i) => {
      const ind = r.indent || 0;
      if (hideBelow != null && ind > hideBelow) return;
      hideBelow = null;
      const hasKids = tree && rows[i + 1] && (rows[i + 1].indent || 0) > ind;
      const rid = r.id ?? i;
      visible.push({ r, i, hasKids, rid });
      if (hasKids && st.collapsed.has(rid)) hideBelow = ind;
    });
    const cell = (c, r) => {
      if (c.render) return c.render(r);
      const v = c.get ? c.get(r) : r[c.key];
      if (v == null || v === '') return '';
      const node = cellOf({ ...c, currency: c.currency || r.currency }, r);
      const href = c.href ? c.href(r) : null;
      return href ? h('a', { href: Array.isArray(href) ? cx.href(href[0], href[1]) : href }, node) : node;
    };
    const head = [h('tr', h('th.idx', '#'), cols.map((c) => h('th', { class: { num: isNumType(c) }, style: c.width ? { minWidth: c.width } : null }, c.label)))];
    if (useColF) head.push(h('tr.filter-row', h('th'), cols.map((c) => h('th', h('input', { type: 'search', 'aria-label': `Filter ${c.label}`, value: st.colf[c.key] || '', oninput: (e) => { st.colf[c.key] = e.target.value; clearTimeout(draw.t); draw.t = setTimeout(() => { const f = document.activeElement; const lbl = f?.getAttribute('aria-label'); draw(); if (lbl) tableWrap.querySelector(`input[aria-label="${CSS.escape(lbl)}"]`)?.focus(); }, 160); } })))));
    const body = visible.map(({ r, i, hasKids, rid }, n) => h('tr', { class: { group: r.group || r.bold || hasKids, total: r.total } },
      h('td.idx', String(n + 1)),
      cols.map((c, j) => {
        let content = cell(c, r);
        if (j === 0 && tree) {
          const tog = hasKids ? h('button.tree-tog', { type: 'button', 'aria-expanded': String(!st.collapsed.has(rid)), 'aria-label': 'Expand or collapse', onclick: () => { st.collapsed.has(rid) ? st.collapsed.delete(rid) : st.collapsed.add(rid); draw(); } }, cx.icon('down')) : h('span.tree-pad');
          content = h('span.tree-cell', { style: { paddingLeft: ((r.indent || 0) * 18) + 'px' } }, tog, content);
        }
        return h('td', { class: { num: isNumType(c) } }, content);
      })));
    let totalRow = null;
    const tot = result.totals ?? o.totals;
    if (tot === true) {
      const leaf = rows.filter((r, i) => !r.group && !r.total && !(tree && rows[i + 1] && (rows[i + 1].indent || 0) > (r.indent || 0)));
      totalRow = h('tr.total', h('td.idx'), cols.map((c, j) => h('td', { class: { num: isNumType(c) } }, isNumType(c) && c.total !== false ? cellOf(c, { [c.key]: leaf.reduce((a, r) => a + (+(c.get ? c.get(r) : r[c.key]) || 0), 0), currency: c.currency || leaf[0]?.currency }) : j === 0 ? 'Total' : '')));
    } else if (tot && typeof tot === 'object') {
      totalRow = h('tr.total', h('td.idx'), cols.map((c, j) => h('td', { class: { num: isNumType(c) } }, tot[c.key] != null ? cellOf(c, tot) : j === 0 ? (tot.label || 'Total') : '')));
    }
    fill(tableWrap, h('table.tbl', h('thead', head), h('tbody', body.length ? body : h('tr', h('td', { colspan: cols.length + 1 }, cx.empty(result.empty || 'No rows for these filters.')))), totalRow ? h('tfoot', totalRow) : null));
    fill(top, h('span', `${fmt.int(visible.length)} rows`), h('span.grow'), tree ? h('button.btn.sm.ghost', { type: 'button', onclick: () => { if (st.collapsed.size) st.collapsed.clear(); else rows.forEach((r, i) => { if (rows[i + 1] && (rows[i + 1].indent || 0) > (r.indent || 0)) st.collapsed.add(r.id ?? i); }); draw(); } }, st.collapsed.size ? 'Expand all' : 'Collapse all') : null);
  }
  run();
  root.append(bar, msg, summary, chartBox, h('div.lv-card', top, tableWrap, h('div.lv-foot', h('span', o.footnote || 'For comparison, use >5, <10 or =324. For ranges, use 5:10.'))));
  root.rerun = run;
  return root;
};

/* =====================================================================================================
   Tree view and kanban
   ===================================================================================================== */

const treeStates = new Map();
/**
 * cx.treeView({ key, roots: [{ id, label, sub, badges, value, children, group, href }], toolbar(node), onOpen(node), depth })
 * A tree: chevrons, the node's badges and value at the right; clicking a node opens its toolbar.
 */
cx.treeView = (o) => {
  const key = o.key || cx.current.name;
  let st = treeStates.get(key);
  if (!st) {
    st = { open: new Set(), sel: null };
    const walk = (ns, d) => ns.forEach((n) => { if (n.children?.length && (n.open ?? d < (o.depth ?? 1))) st.open.add(n.id); walk(n.children || [], d + 1); });
    walk(o.roots, 0);
    treeStates.set(key, st);
  }
  const root = h('div', { style: 'display:grid;gap:8px;min-width:0' });
  const all = []; const walkAll = (ns) => ns.forEach((n) => { all.push(n); walkAll(n.children || []); }); walkAll(o.roots);
  const box = h('div.tree', { role: 'tree' });
  function draw() {
    fill(box);
    const row = (n, depth) => {
      const kids = n.children || [];
      const open = st.open.has(n.id);
      const el = h('div.tree-row', { role: 'treeitem', 'aria-expanded': kids.length ? String(open) : null, class: { on: st.sel === n.id, grp: n.group || kids.length > 0 }, style: { paddingLeft: (8 + depth * 20) + 'px' }, tabindex: '0',
        onclick: (e) => { if (e.target.closest('a,button')) return; st.sel = st.sel === n.id ? null : n.id; o.onSelect?.(n); draw(); },
        onkeydown: (e) => { if (e.key === 'Enter') el.click(); } },
        h('button.tree-tog', { type: 'button', class: { leaf: !kids.length }, 'aria-expanded': String(open), 'aria-label': open ? 'Collapse' : 'Expand', tabindex: '-1', onclick: () => { open ? st.open.delete(n.id) : st.open.add(n.id); draw(); } }, cx.icon('down')),
        n.href ? h('a.tree-label', { href: Array.isArray(n.href) ? cx.href(...n.href) : n.href }, n.label) : h('span.tree-label', n.label),
        n.sub ? h('span.tree-sub', n.sub) : null,
        (n.badges || []).map((b) => (b instanceof Node ? b : cx.tag(b))),
        n.value != null ? h('span.tree-val.num', n.value instanceof Node ? n.value : String(n.value)) : null);
      box.appendChild(el);
      if (st.sel === n.id && o.toolbar) { const tools = o.toolbar(n); if (tools?.length) box.appendChild(h('div.tree-tools', { style: { paddingLeft: (30 + depth * 20) + 'px' } }, tools)); }
      if (open) kids.forEach((k) => row(k, depth + 1));
    };
    o.roots.forEach((n) => row(n, 0));
  }
  const tools = h('div.lv-bar', h('button.btn', { type: 'button', onclick: () => { all.forEach((n) => n.children?.length && st.open.add(n.id)); draw(); } }, cx.icon('down'), 'Expand all'), h('button.btn', { type: 'button', onclick: () => { st.open.clear(); draw(); } }, cx.icon('up'), 'Collapse all'), h('span.grow'), o.tools || null);
  draw();
  root.append(tools, box);
  root.refresh = draw;
  return root;
};

/**
 * cx.kanban({ key, columns: [{ key, label, color, items }], card(item, col), onMove(item, toKey, fromKey), onOpen(item), id(item), limit, colMenu(col) })
 * Drag a card between columns (or use its Move menu); onMove may return false (or a Promise of false) to refuse.
 */
cx.kanban = (o) => {
  const limit = o.limit || 20;
  const shown = new Map();
  const root = h('div.kb', { role: 'list' });
  const idOf = o.id || ((it) => it.name);
  let dragging = null;
  const move = async (item, from, to) => {
    if (from === to) return;
    const ok = o.onMove ? await o.onMove(item, to.key, from.key) : true;
    if (ok === false) return;
    from.items.splice(from.items.indexOf(item), 1); to.items.unshift(item);
    draw();
  };
  function draw() {
    fill(root, ...o.columns.map((col) => {
      const n = shown.get(col.key) || limit;
      const colEl = h('section.kb-col', { role: 'listitem', 'aria-label': col.label,
        ondragover: (e) => { if (dragging) { e.preventDefault(); colEl.classList.add('drop'); } },
        ondragleave: () => colEl.classList.remove('drop'),
        ondrop: (e) => { e.preventDefault(); colEl.classList.remove('drop'); if (dragging) move(dragging.item, dragging.col, col); dragging = null; } },
        h('header.kb-head', cx.dot(col.label, col.color), h('span.count', String(col.items.length)), h('span.grow'), o.colMenu ? cx.menu(null, o.colMenu(col), { sm: true, kind: 'ghost' }) : null),
        col.items.slice(0, n).map((it) => {
          const others = o.columns.filter((c) => c !== col);
          const card = h('article.kb-card', { draggable: 'true', tabindex: '0',
            ondragstart: (e) => { dragging = { item: it, col }; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', idOf(it)); } catch { /* */ } },
            ondragend: () => { card.classList.remove('dragging'); dragging = null; },
            onclick: (e) => { if (e.target.closest('a,button,.menu-wrap')) return; o.onOpen?.(it); },
            onkeydown: (e) => { if (e.key === 'Enter') o.onOpen?.(it); } },
            o.card(it, col),
            h('div', { style: 'display:flex;justify-content:flex-end;margin:-4px -6px -6px' }, cx.menu('Move', others.map((c) => ({ label: c.label, onClick: () => move(it, col, c) })), { sm: true, kind: 'ghost' })));
          return card;
        }),
        col.items.length > n ? h('button.kb-more', { type: 'button', onclick: () => { shown.set(col.key, n + limit); draw(); } }, `Load more (${col.items.length - n})`) : null);
      return colEl;
    }));
  }
  draw();
  root.refresh = draw;
  return root;
};

/* =====================================================================================================
   Modal, side panel, toasts, the confirmation step
   ===================================================================================================== */

const modalStack = [];
/**
 * cx.modal({ title, body, actions: [{ label, primary, danger, onClick(close) } | Node], wide, onClose }) → { el, close }
 */
cx.modal = (o) => {
  const prevFocus = document.activeElement;
  const back = h('div.modal-back', { onclick: (e) => { if (e.target === back) close(); } });
  const foot = o.actions?.length ? h('footer.modal-foot', o.actions.map((a) => (a instanceof Node ? a : cx.btn(a.label, { kind: a.primary ? 'primary' : a.danger ? 'danger' : null, cmd: a.cmd, needs: a.needs, onClick: () => (a.onClick ? a.onClick(close) : close()) })))) : null;
  const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Dialog', class: { wide: o.wide } },
    h('header.modal-head', h('h2', o.title || ''), h('button.iconbtn', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, cx.icon('x'))),
    h('div.modal-body', o.body), foot);
  back.appendChild(box);
  document.getElementById('app').appendChild(back);
  const api = { el: box, close };
  modalStack.push(api);
  setTimeout(() => (box.querySelector('input,select,textarea,.btn.primary') || box.querySelector('button'))?.focus(), 30);
  function close() {
    if (!back.isConnected) return;
    back.remove(); modalStack.splice(modalStack.indexOf(api), 1); o.onClose?.(); prevFocus?.focus?.();
  }
  return api;
};

let panelState = null;
/**
 * cx.panel.open({ title, sub, body, wide, onClose }) → { el, body, close, setBody }. One panel at a time, on the right.
 */
cx.panel = {
  open(o) {
    cx.panel.close();
    const body = h('div.panel-body', o.body || null);
    const el = h('aside.panel', { class: { wide: o.wide }, role: 'complementary', 'aria-label': o.title },
      h('header.panel-head', h('div.grow', h('h2', o.title || ''), o.sub ? h('small', o.sub) : null), o.actions || null,
        // during a walkthrough the panel can cover the step bar (a phone), so it carries the next step itself
        tour && tour.i < tour.t.steps.length - 1 ? h('button.btn.sm.tour-next', { type: 'button', title: 'The walkthrough\'s next step', onclick: () => tourGo(tour.i + 1) }, 'Next step', cx.icon('right')) : null,
        h('button.iconbtn', { type: 'button', 'aria-label': 'Close the panel', onclick: () => cx.panel.close() }, cx.icon('x'))),
      body);
    document.getElementById('app').appendChild(el);
    panelState = { el, body, onClose: o.onClose, key: o.key };
    const api = { el, body, close: () => cx.panel.close(), setBody: (...kids) => fill(body, ...kids) };
    panelState.api = api;
    return api;
  },
  close() { if (!panelState) return; panelState.el.remove(); const f = panelState.onClose; panelState = null; f?.(); },
  isOpen: (key) => !!panelState && (key == null || panelState.key === key),
  current: () => panelState?.api || null,
};

/** cx.toast(text, { tone: 'success'|'info'|'warning'|'danger', cmd, action: { label, onClick }, ms }) */
function toast(text, o = {}) {
  const box = document.querySelector('.toasts');
  if (!box) return;
  const icon = o.tone === 'warning' ? 'alert' : o.tone === 'danger' ? 'alert' : o.tone === 'info' ? 'info' : 'check';
  const el = h('div.toast', { role: 'status', class: o.tone },
    cx.icon(icon), h('div', h('div', text), o.cmd ? h('code', '$ ' + [].concat(o.cmd)[0]) : null),
    o.action ? h('button', { type: 'button', onclick: () => { el.remove(); o.action.onClick(); } }, o.action.label) : h('button', { type: 'button', 'aria-label': 'Dismiss', onclick: () => el.remove() }, cx.icon('x', { size: 14 })));
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), o.ms || (o.cmd ? 7000 : 4200));
}
cx.toast = toast;

/**
 * The confirmation step, built into the page (no browser dialogs).
 * await cx.confirm({ title, body, cmd, who, confirmLabel, cancelLabel, danger }) → true or false
 */
cx.confirm = (o) => new Promise((resolve) => {
  const host = view.querySelector('.page-body') || view;
  if (o.cmd) strip.pin(o.cmd, o.title);
  const spec = normCmd(o.cmd);
  let done = false;
  const finish = (v) => { if (done) return; done = true; card.remove(); document.removeEventListener('keydown', onKey); if (o.cmd) strip.unpin(); resolve(v); };
  const onKey = (e) => { if (e.key === 'Escape') finish(false); };
  const card = h('section.confirm', { class: { danger: o.danger }, role: 'alertdialog', 'aria-label': o.title },
    h('div.confirm-body',
      h('h3', o.title),
      o.body ? (o.body instanceof Node ? o.body : h('p', o.body)) : null,
      spec?.lines.length ? h('div.confirm-cmd', spec.lines.map((l, i) => [i ? '\n' : '', h('span.p', '$ '), l])) : null,
      o.who ? h('div.muted', { style: 'font-size:12.5px' }, 'Who may run it: ' + o.who) : null,
      h('div.confirm-actions', cx.btn(o.confirmLabel || 'Confirm', { kind: o.danger ? 'danger primary' : 'primary', onClick: () => finish(true) }), cx.btn(o.cancelLabel || 'Back', { onClick: () => finish(false) }))));
  host.prepend(card);
  document.addEventListener('keydown', onKey);
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  setTimeout(() => card.querySelector('.btn.primary')?.focus(), 50);
});

/* =====================================================================================================
   Money pieces every module shares: the hand-over (approval), the FDE's draft, the proof
   ===================================================================================================== */

const BASE_GENESIS = Date.parse('2023-06-15T00:00:00Z');
cx.blockAt = (iso) => Math.floor((Date.parse(iso || cx.now.toISOString()) - BASE_GENESIS) / 2000);
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return '0x' + [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); }
cx.randHex = randHex;
cx.newId = (prefix) => { const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; let t = ''; const a = new Uint8Array(26); crypto.getRandomValues(a); for (const b of a) t += A[b % 32]; return `${prefix}_01M7${t.slice(4)}`; };

/**
 * The hand-over: every write that moves money or authority ends at an approval from the signer's own Safe.
 * await cx.approval({ title, from, to, amount, gbp, asset, rows, warnings, signer, hat, deadline, cmd, next, board, autoClose })
 *   rows: [{ to, amount, rail, note }] for a batch; board: { proposal, nonce, have, need, approvedBy: [ids] }
 * Resolves { status: 'done', tx, block, at } | { status: 'approved', remaining } (Board) | { status: 'declined' }.
 * The viewer must be the signer (or, for the Board, a Director); otherwise the sheet says who must approve.
 */
cx.approval = (o) => new Promise((resolve) => {
  const me = cx.me();
  const signerId = o.signer || meId;
  const isBoard = !!o.board;
  const mayApprove = isBoard ? cx.wears('Director') && !(o.board.approvedBy || []).includes(meId) : signerId === meId;
  if (o.cmd) strip.pin(o.cmd, o.title);
  const spec = normCmd(o.cmd);
  const asset = o.asset || 'USDC';
  const signer = cx.person(signerId);
  const rows = [
    o.from ? ['From', o.from] : null,
    o.to ? ['To', o.to] : null,
    o.amount != null ? ['Amount', h('div', h('div.sheet-amount', fmt.money(o.amount, asset)), o.gbp != null ? h('div.muted', fmt.gbp(o.gbp) + (o.rate ? ` at 1 ${asset} = £${o.rate}` : '')) : null)] : null,
    o.rows?.length ? ['Recipients', h('div', { style: 'display:grid;gap:4px' }, o.rows.slice(0, 8).map((r) => h('div', { style: 'display:flex;gap:10px;justify-content:space-between;font-size:13px' }, h('span', r.to, r.rail ? h('span.muted', ` · ${r.rail}`) : null), h('span.num', typeof r.amount === 'number' ? fmt.money(r.amount, asset) : r.amount))), o.rows.length > 8 ? h('div.muted', `and ${o.rows.length - 8} more`) : null)] : null,
    isBoard ? ['Proposal', `${o.board.proposal}${o.board.nonce != null ? ` · nonce ${o.board.nonce}` : ''} · ${o.board.have ?? 0} of ${o.board.need ?? D.board.threshold} approvals`] : null,
    ['Signer', isBoard ? h('span', 'A Director, from their own Safe', (o.board.approvedBy || []).length ? h('span.muted', ` · approved so far: ${(o.board.approvedBy).map(cx.name).join(', ')}`) : null)
      : h('span', signer ? signer.name : cx.name(signerId), signer?.safe ? h('span.muted', ` · their Safe ${fmt.addr(signer.safe)}`) : null, o.hat ? h('span.muted', ` · wears the ${o.hat} hat`) : null)],
    o.deadline ? ['Deadline', o.deadline] : ['Deadline', 'Expires in 15:00'],
  ].filter(Boolean);
  const body = h('div', { style: 'display:grid;gap:12px' },
    h('div.sheet', rows.map(([k, v]) => h('div.sheet-row', h('span', k), h('span', v)))),
    o.warnings?.length ? h('div.warnings', o.warnings.map((w) => h('div.warn', cx.icon('alert'), h('span', w)))) : null,
    spec?.lines.length ? h('div.confirm-cmd', spec.lines.map((l, i) => [i ? '\n' : '', h('span.p', '$ '), l])) : null,
    o.next ? h('div.muted', { style: 'font-size:12.5px' }, 'Follow it: ', h('code', o.next)) : null,
    !mayApprove ? cx.banner(isBoard ? (cx.wears('Director') ? 'You have approved this proposal already.' : `Only Directors approve Board proposals: ${D.board.directors.map((x) => cx.name(x.who || x.id || x)).join(', ')}.`) : `Only ${cx.name(signerId)} can approve this, from their own Safe. Capxul never signs for anyone.`, { tone: 'warning' }) : null);
  let settled = false;
  const finish = (res) => { if (settled) return; settled = true; strip.unpin(); resolve(res); };
  const m = cx.modal({
    title: o.title || 'Approve', body,
    onClose: () => finish({ status: 'declined' }),
    actions: [
      cx.btn('Decline', { onClick: () => { finish({ status: 'declined' }); m.close(); toast('Declined. Nothing moved.', { tone: 'info' }); } }),
      cx.btn(isBoard ? 'Approve as a Director' : 'Approve with passkey', { kind: 'primary', icon: 'passkey', disabled: !mayApprove, reason: 'Not yours to approve', onClick: () => go() }),
    ],
  });
  function go() {
    const wait = h('div.passkey', h('div.ring'), h('b', 'Touch your passkey'), h('span.muted', `${me.name} · ${me.safe ? 'your Safe ' + fmt.addr(me.safe) : 'your account'}`));
    m.el.querySelector('.modal-body').replaceChildren(wait);
    m.el.querySelector('.modal-foot')?.replaceChildren();
    setTimeout(() => {
      fill(wait, h('div.ring'), h('b', 'Sending…'), h('span.muted', 'Capxul sponsors the gas; your Safe signs.'));
      setTimeout(() => {
        const at = cx.now.toISOString();
        if (isBoard) {
          const have = (o.board.have ?? 0) + 1, need = o.board.need ?? D.board.threshold;
          const remaining = Math.max(0, need - have);
          wait.classList.add('done');
          fill(wait, h('div.ring', cx.icon('check', { size: 26 })), h('b', remaining ? `Approved. ${remaining} more Director${remaining > 1 ? 's' : ''} to go.` : 'Approved and executed'), h('span.muted', `${o.board.proposal} · ${have} of ${need} approvals`));
          m.el.querySelector('.modal-foot').replaceChildren(cx.btn('Done', { kind: 'primary', onClick: () => m.close() }));
          finish(remaining ? { status: 'approved', remaining, at } : { status: 'done', tx: randHex(32), block: cx.blockAt(at), at });
        } else {
          const tx = randHex(32), block = cx.blockAt(at);
          wait.classList.add('done');
          fill(wait, h('div.ring', cx.icon('check', { size: 26 })), h('b', `Done · on chain in block ${fmt.int(block)}`), h('span', cx.tx(tx)));
          m.el.querySelector('.modal-foot').replaceChildren(cx.btn('Done', { kind: 'primary', onClick: () => m.close() }));
          // autoClose: the sheet closes itself (a step in a chain of approvals), and the promise resolves once it has
          if (o.autoClose) setTimeout(() => { finish({ status: 'done', tx, block, at }); m.close(); }, o.autoClose);
          else finish({ status: 'done', tx, block, at });
        }
      }, 900);
    }, 750);
  }
});

/**
 * The FDE's draft of a risky action, for one person to run: cx.draft({ for, by, title, why, steps, cmd, needs, onRun })
 * Only `for` (the asker) can run it; anyone else sees who can. onRun usually opens cx.approval.
 */
cx.draft = (o) => {
  const forId = o.for || meId;
  const mine = forId === meId;
  const spec = normCmd(o.cmd);
  return h('section.draft',
    h('header.draft-head', cx.icon('fde', { size: 14 }), h('span', 'Drafted by ', h('b', o.by ? cx.name(o.by) : "Harbourline's FDE"), ' for ', h('b', cx.name(forId)), ' to run'), o.at ? h('span', '· ' + fmt.agoLong(o.at)) : null),
    h('div.draft-body',
      h('h3', o.title),
      o.why ? h('p', { style: 'font-size:13.5px;color:var(--fg-2)' }, o.why) : null,
      o.steps?.length ? h('ol.draft-steps', o.steps.map((x) => h('li', x))) : null,
      spec?.lines.length ? h('div.confirm-cmd', spec.lines.map((l, i) => [i ? '\n' : '', h('span.p', '$ '), l])) : null,
      h('div.confirm-actions',
        cx.btn(o.runLabel || 'Run', { kind: 'primary', icon: 'terminal', cmd: o.cmd, needs: o.needs, disabled: !mine, reason: `Only ${cx.name(forId)} can run this. The FDE acts only with the asker's permissions.`, onClick: () => o.onRun?.() }),
        cx.btn('Copy the command', { onClick: () => copyText(spec?.lines.join('\n') || '') }),
        o.extra || null)));
};

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
cx.canonical = canonical;
/** SHA-256 of an object's canonical JSON (keys sorted), as 0x-hex: how every document hash in the data is made. */
cx.hashOf = async (obj) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(obj)));
  return '0x' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
let docIdx = null;
/** Any document a proof can allocate to, by name: invoices, payslips, expense claims, advances. */
cx.docByName = (name) => {
  if (!docIdx) {
    docIdx = new Map();
    const add = (arr, type) => (arr || []).forEach((d) => d?.name && docIdx.set(d.name, { type, doc: d }));
    add(D.books.salesInvoices, 'Sales Invoice'); add(D.books.purchaseInvoices, 'Purchase Invoice'); add(D.payroll.slips, 'Salary Slip');
    add(D.hr.expenseClaims, 'Expense Claim'); add(D.hr.advances, 'Employee Advance');
  }
  return docIdx.get(name) || null;
};
const ALLOC_ROUTE = { 'Sales Invoice': 'sales-invoice', 'Purchase Invoice': 'purchase-invoice', 'Salary Slip': 'payslip', 'Expense Claim': 'expense-claim', 'Employee Advance': 'advance' };
/**
 * Verify a payment's proof for real: re-hash the advice (SubtleCrypto), and check it names this payment, the token and
 * amount, each document's version and the allocations' sums. → Promise<[{ ok, label, detail }]>
 */
cx.verify = async (p) => {
  const pr = p.proof, a = pr?.advice;
  if (!a) return [{ ok: false, label: 'This payment has no advice to verify' }];
  const out = [];
  const hash = await cx.hashOf(a);
  out.push({ ok: hash === pr.documentHash, label: 'The stored advice hashes to the document hash on chain', detail: `SHA-256 of the advice: ${hash}` });
  out.push({ ok: a.origin === p.id, label: 'The advice is for this payment', detail: `origin ${a.origin}` });
  out.push({ ok: a.token === p.asset && String(a.amount) === String(p.amountRaw), label: 'Token and amount match what moved on chain', detail: `${a.token} ${a.amount} (raw, 6 decimals)` });
  const allocs = a.allocations || [];
  const docChecks = allocs.map((al) => { const d = cx.docByName(al.doc); return { al, d, ok: !d || !d.doc.contentHash || d.doc.contentHash === al.content }; });
  out.push({ ok: docChecks.every((x) => x.ok), label: allocs.length === 1 ? `${allocs[0].record} ${allocs[0].number || allocs[0].doc} re-hashes to the version paid` : `${allocs.length} documents re-hash to the versions paid`, detail: allocs.map((al) => `${al.doc}: ${fmt.hash(al.content)}`).join('\n') || 'No documents' });
  const gbp = allocs.filter((x) => x.currency === 'GBP').reduce((s2, x) => s2 + x.allocated, 0);
  const usd = allocs.filter((x) => x.currency !== 'GBP').reduce((s2, x) => s2 + x.allocated, 0);
  const sumOk = (!gbp || gbp === a.cash?.amount) && (!usd || usd * 10000 === Number(a.amount));
  out.push({ ok: sumOk, label: 'The allocations add up to what was paid', detail: gbp ? `${fmt.gbp(gbp / 100)} allocated of ${fmt.gbp((a.cash?.amount || 0) / 100)} cash` : `${fmt.usd(usd / 100)} allocated of ${fmt.usdc(Number(a.amount) / 1e6)}` });
  return out;
};
/**
 * The proof block for a payment (or a payslip's paymentInfo with o.payment): network, payment ID, document hash,
 * transaction and block, what it pays, Verify (real re-hash) and the raw advice. cx.proof(payment, { booked, title })
 */
cx.proof = (p, o = {}) => {
  if (!p) return null;
  const pr = p.proof;
  if (!pr) {
    return h('section.proof', h('header.proof-head', h('h3', cx.icon('shield'), 'Proof')), h('div.proof-body', h('p.muted', o.none || (p.deposit || p.kind === 'deposit' ? `No proof on chain: a bank deposit is matched by its reference${p.reference ? ' ' + p.reference : ''}.` : 'No proof yet: the payment has not settled on chain.'))));
  }
  const a = pr.advice || {};
  const checksEl = h('ul.checks', { hidden: true });
  const rawEl = h('pre.raw', { hidden: true }, JSON.stringify(a, null, 2));
  const firstContent = a.allocations?.[0]?.content;
  const verifyCmd = `capxul document verify --document-hash ${pr.documentHash}${firstContent ? ` --content-hash ${firstContent}` : ''}`;
  const verifyBtn = cx.btn('Verify', { kind: 'primary', icon: 'shield', cmd: verifyCmd, onClick: async () => {
    checksEl.hidden = false; fill(checksEl, h('li', h('span.mk', cx.icon('clock')), h('span', 'Re-hashing the advice…')));
    const res = await cx.verify(p);
    fill(checksEl);
    for (const [i, c] of res.entries()) {
      await new Promise((r) => setTimeout(r, i ? 160 : 60));
      checksEl.appendChild(h('li', { class: c.ok ? 'ok' : 'bad' }, h('span.mk', cx.icon(c.ok ? 'check' : 'x')), h('span', c.label, c.detail ? h('small', c.detail) : null)));
    }
    toast(res.every((c) => c.ok) ? 'Proof verified: every check passed' : 'Proof check failed', { tone: res.every((c) => c.ok) ? 'success' : 'danger' });
  } });
  const cash = a.cash ? fmt.money(a.cash.amount / 10 ** (a.cash.decimals ?? 2), a.cash.currency) + (a.cash.rate ? ` at 1 ${a.token} = £${a.cash.rate}` : '') : null;
  const allocs = (a.allocations || []).map((al) => {
    const route = ALLOC_ROUTE[al.record];
    const div = 10 ** (al.decimals ?? 2);
    return h('div.alloc',
      h('div.alloc-head', h('span.muted', al.record), route && cx.hasRoute(route) ? cx.link(al.number || al.doc, route, al.doc) : h('b', al.number || al.doc), al.date ? h('span.muted', fmt.date(al.date)) : null, h('span', { style: 'margin-left:auto' }, 'Allocated ', h('b', fmt.money(al.allocated / div, al.currency || 'GBP')))),
      al.lines?.length ? h('div.alloc-lines', al.lines.slice(0, 12).map((ln) => h('div.alloc-line', h('span', `${ln.idx} · ${ln.description}`), h('span.num', fmt.money(ln.amount / div, al.currency || 'GBP'), (ln.taxes || []).map((t) => h('span.muted', ` + ${t.name || t.tax || 'VAT'} ${t.rate != null ? t.rate + '%' : t.bps != null ? t.bps / 100 + '%' : ''} ${fmt.money((t.amount ?? 0) / div, al.currency || 'GBP')}`))))), al.lines.length > 12 ? h('div.muted', `and ${al.lines.length - 12} more lines`) : null) : null,
      h('div.muted', { style: 'font-size:12px' }, 'Version paid ', h('span.mono', fmt.hash(al.content))));
  });
  const adj = (a.adjustments || []).map((x) => h('div.alloc-line', h('span', `Adjustment: ${x.reason || x.kind || ''} ${x.party ? '· ' + x.party : ''}`), h('span.num', x.amount != null ? fmt.money(x.amount / (x.decimals ? 10 ** x.decimals : 1e6), x.token || a.token || 'USDC') : '')));
  return h('section.proof',
    h('header.proof-head', h('h3', cx.icon('shield'), h('span', o.title || 'Proof', h('small', o.subtitle || 'What this payment pays, committed on chain'))), h('div.proof-tools', verifyBtn, cx.btn('Raw', { onClick: () => { rawEl.hidden = !rawEl.hidden; } }), cx.btn('Save as PDF', { cmd: `capxul document render --document-hash ${pr.documentHash}${firstContent ? ` --content-hash ${firstContent}` : ''}`, onClick: () => toast('This is the command Capxul would run. The mock-up makes no downloads.') }))),
    h('div.proof-body',
      cx.kv([
        ['Network', `${pr.network || 'Base'} · chain ID ${pr.chainId || 8453}`],
        ['Payment ID', h('span.proof-hash', pr.paymentId)],
        ['Document hash', h('span.proof-hash', pr.documentHash)],
        ['Transaction', h('span', cx.tx(pr.tx), pr.block ? ` · block ${fmt.int(pr.block)}` : '', p.settledAt ? ` · ${fmt.utc(p.settledAt)}` : '')],
        pr.logIndex != null ? ['Log', `PaymentSent #${pr.logIndex}`] : null,
        pr.settledThrough ? ['Settled through', pr.settledThrough] : null,
        ['Finality', pr.finality || 'Final'],
        cash ? ['In pounds', cash] : null,
        a.batch ? ['Batch', `line ${a.batch.index ?? a.batch.line ?? '?'} of ${a.batch.count ?? '?'}${a.batch.run ? ' of run ' + a.batch.run : ''}`] : null,
        o.booked || p.voucher || p.books ? ['Booked', cx.hasRoute('payment-entry') ? cx.link(o.booked || p.voucher || p.books, 'payment-entry', o.booked || p.voucher || p.books) : (o.booked || p.voucher || p.books)] : null,
      ]),
      allocs.length ? h('div', { style: 'display:grid;gap:8px' }, h('div', { style: 'font-weight:600;font-size:13px' }, 'What it pays'), allocs, adj.length ? h('div.alloc', adj) : null, a.memo ? h('div.muted', 'Memo: ' + a.memo) : null) : null,
      checksEl, rawEl,
      h('div.confirm-cmd', h('span.p', '$ '), verifyCmd)));
};

/* =====================================================================================================
   The FDE (the shell's panel; fde.js supplies the answers or takes the panel over)
   ===================================================================================================== */

const fdeTurns = [];
cx.fde = {
  context: null,
  /** fde.js sets this: async (question, { context, me, history }) → { text, lookedAt: [{ command, result }], draft: cx.draft spec, links: [{ label, route, id }] } */
  answer: null,
  /** fde.js may set this to own the whole panel: (panelApi, { context, ask }) → void */
  mount: null,
  suggestions: ["What's due this week?", 'How much runway do we have?', "Who hasn't submitted timesheets?"],
  /** Open the FDE's panel, optionally asking a question straight away. */
  open(o = {}) {
    const context = o.context || cx.fde.context || 'Home';
    const panel = cx.panel.open({ key: 'fde', title: 'Ask the FDE', sub: `Harbourline's Forward Deployed Engineer, hosted by Capxul. It acts only with your permissions, as ${cx.me().name}.` });
    if (cx.fde.mount) { try { cx.fde.mount(panel, { context, ask: o.ask }); return; } catch (e) { console.error('fde.mount failed', e); } }
    const convo = h('div.chat');
    const ta = h('textarea.finput', { id: 'fde-ask', rows: 3, placeholder: 'Ask anything about Harbourline', 'aria-label': 'Ask the FDE' });
    const form = h('form.chat-form', { onsubmit: (e) => { e.preventDefault(); ask(ta.value); ta.value = ''; } },
      ta, h('div', { style: 'display:flex;gap:8px;align-items:center' }, h('button.btn.primary', { type: 'submit' }, cx.icon('send'), 'Ask'), h('span.muted', { style: 'font-size:12px' }, 'It drafts risky actions for you to run.')));
    const drawTurns = () => {
      fill(convo, ...fdeTurns.map((t) => h('div.chat-turn', { class: t.role },
        t.role === 'fde' && t.lookedAt?.length ? h('div.looked', h('span', 'What I looked at'), t.lookedAt.map((x) => h('div', h('code', '$ ' + x.command), x.result ? h('div', h('span', x.result)) : null))) : null,
        h('div.bubble', t.text),
        [].concat(t.draft || [], t.drafts || []).map((d) => cx.draft(d)),
        t.links?.length ? h('div.chips', t.links.map((l) => h('a.btn.sm', { href: cx.href(l.route, l.id) }, l.label))) : null)));
      if (!fdeTurns.length) convo.appendChild(h('div', { style: 'display:grid;gap:8px' }, h('p.muted', 'Ask about anything on this screen or in the company. Try:'), h('div.suggest', cx.fde.suggestions.map((sg) => h('button', { type: 'button', onclick: () => ask(sg) }, sg)))));
      // show the newest answer from its start (a long answer with drafts is read top down), else the bottom
      const turns = convo.querySelectorAll('.chat-turn');
      const last = turns[turns.length - 1], prevQ = turns[turns.length - 2];
      const top = (el) => el.getBoundingClientRect().top - panel.body.getBoundingClientRect().top + panel.body.scrollTop;
      panel.body.scrollTop = last && last.classList.contains('fde') && prevQ ? Math.max(0, top(prevQ) - 8) : panel.body.scrollHeight;
    };
    async function ask(q) {
      q = String(q || '').trim(); if (!q) return;
      const screenCmd = strip.get();
      strip.pin(`capxul org fde ask ${JSON.stringify(q)} --org harbourline`, 'Ask the FDE');
      fdeTurns.push({ role: 'user', text: q });
      fdeTurns.push({ role: 'fde', text: '…' });
      drawTurns();
      let ans;
      try { ans = cx.fde.answer ? await cx.fde.answer(q, { context, me: cx.me(), history: fdeTurns }) : null; } catch (e) { console.error('fde.answer failed', e); }
      if (!ans) {
        ans = { text: `I read "${context}" with your permissions. Here is the command behind this screen, so you can run it yourself.`, lookedAt: screenCmd?.lines?.length ? [{ command: screenCmd.lines[0], result: 'read' }] : [] };
      }
      fdeTurns[fdeTurns.length - 1] = { role: 'fde', ...ans };
      drawTurns();
    }
    panel.setBody(h('div', { style: 'display:grid;gap:10px' }, h('div.tag', { style: 'height:auto;padding:4px 8px;white-space:normal' }, 'You are looking at: ' + context), convo), form);
    drawTurns();
    if (o.ask) ask(o.ask); else setTimeout(() => ta.focus(), 30);
  },
};

/* =====================================================================================================
   Search
   ===================================================================================================== */

const searchProviders = [];
/** cx.search.add((q, limit) => [{ label, sub, kind, route, id }]) — the top bar's search asks every provider. */
cx.search = { add: (fn) => searchProviders.push(fn) };
function coreSearch(q) {
  const out = [];
  const t = q.toLowerCase();
  for (const ws of workspaces.values()) {
    if (ws.label.toLowerCase().includes(t)) out.push({ kind: 'Workspaces', label: ws.label, route: ws.route, icon: ws.icon });
    const walk = (items, sec) => items.forEach((it) => { if (it.items) walk(it.items, it.section); else if (it.label.toLowerCase().includes(t)) out.push({ kind: 'Pages', label: it.label, sub: [ws.label, sec].filter(Boolean).join(' › '), route: it.route, id: it.id, icon: ws.icon }); });
    walk(ws.nav || []);
  }
  for (const p of D.people) if (p.name.toLowerCase().includes(t) || (p.employee || '').toLowerCase().includes(t)) out.push({ kind: 'People', label: p.name, sub: `${p.designation} · ${p.employee}${p.status !== 'Active' ? ' · ' + p.status : ''}`, route: 'employee', id: p.employee, person: p.id });
  for (const o of D.others || []) if (o.name.toLowerCase().includes(t)) out.push({ kind: 'People', label: o.name, sub: o.role, person: o.id });
  // customers and suppliers: the parties the books bill and pay
  const owed = (list, key, id) => list.filter((i) => i[key] === id && i.outstanding > 0.005).reduce((s, i) => s + (i.baseOutstanding ?? i.outstanding * (i.conversionRate || 1)), 0);
  for (const c of D.books.customers || []) if (`${c.name} ${c.short || ''} ${c.id}`.toLowerCase().includes(t)) {
    const n = D.books.salesInvoices.filter((i) => i.customer === c.id).length;
    out.push({ kind: 'Customers', label: c.name, sub: [c.industry, `${fmt.plural(n, 'invoice')}`, owed(D.books.salesInvoices, 'customer', c.id) > 0 ? `${fmt.gbp(owed(D.books.salesInvoices, 'customer', c.id), 0)} owed` : null].filter(Boolean).join(' · '), route: routes.has('company') ? 'company' : 'accounts-receivable', id: routes.has('company') ? c.id : null, icon: 'crm' });
  }
  for (const sp of D.books.suppliers || []) if (`${sp.name} ${sp.id}`.toLowerCase().includes(t)) {
    const bills = D.books.purchaseInvoices.filter((i) => i.supplier === sp.id || i.supplierName === sp.name).sort((a, b) => String(b.postingDate).localeCompare(String(a.postingDate)));
    out.push({ kind: 'Suppliers', label: sp.name, sub: [sp.group, fmt.plural(bills.length, 'bill'), bills[0] ? `latest ${bills[0].name}` : null].filter(Boolean).join(' · '), route: bills[0] ? 'purchase-invoice' : 'purchase-invoices', id: bills[0]?.name || null, icon: 'file' });
  }
  for (const d of [...D.departments, ...D.allowances]) if (d.name.toLowerCase().includes(t)) out.push({ kind: 'Departments', label: cx.deptName(d.id), sub: 'Hat: ' + cx.holders(d.id).map(cx.name).join(', '), route: D.allowances.includes(d) ? 'allowance' : 'department', id: d.id, icon: 'departments' });
  return out;
}

/* =====================================================================================================
   The frame: top bar, sidebar, view
   ===================================================================================================== */

let frameReady = false;
let app, topbar, sidebar, view, scrim;
function setNav(open) { app.classList.toggle('nav-open', open); scrim.hidden = !open; }
function buildFrame() {
  app = document.getElementById('app');
  fill(app);
  topbar = h('header.topbar');
  sidebar = h('nav.sidebar', { 'aria-label': 'Workspaces' });
  view = h('div#view');
  scrim = h('div.scrim', { hidden: true, onclick: () => setNav(false) });
  app.append(topbar, h('div.frame', sidebar, h('main.main', { id: 'main' }, view)), scrim, h('div.toasts', { 'aria-live': 'polite' }), tip);
  frameReady = true;
  renderTopbar(); renderSidebar();
  document.addEventListener('pointerdown', (e) => { for (const p of [...openPops]) if (!p.wrap.contains(e.target)) p.close(); });
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape') {
      if (openPops.size) return closePops();
      if (modalStack.length) return modalStack[modalStack.length - 1].close();
      if (app.classList.contains('nav-open')) return setNav(false);
      if (panelState) return cx.panel.close();
    }
    if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) { e.preventDefault(); const i = topbar.querySelector('.tb-search input'); i.closest('.tb-search').classList.add('open'); i.focus(); }
  });
}
function brandMark() {
  return s('svg', { class: 'brand-mark', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    s('rect', { x: 6, y: 2.5, width: 12, height: 19, rx: 6, style: 'fill:none;stroke:var(--accent);stroke-width:1.8' }),
    s('path', { d: 'M6 12h12', style: 'stroke:var(--accent);stroke-width:1.8' }),
    s('circle', { cx: 12, cy: 7.4, r: 1.4, style: 'fill:var(--accent)' }));
}
function renderTopbar() {
  const me = cx.me();
  const menuBtn = h('button.iconbtn.tb-menu', { type: 'button', 'aria-label': 'Open the workspaces', onclick: () => setNav(!app.classList.contains('nav-open')) }, cx.icon('menu'));
  const brand = h('a.brand', { href: '#home', 'aria-label': 'Capxul home' }, brandMark(), h('span.brand-word', 'capxul'));
  // company and acting-as
  const compBtn = h('button.tb-company', { type: 'button', title: 'Acting as' }, h('b', acting === 'org' ? D.company.name : me.name), h('small', acting === 'org' ? 'acting as the company' : 'acting as yourself'), cx.icon('down', { size: 13 }));
  const comp = cx.popover(compBtn, () => [
    h('div.pop-label', 'Acting as'),
    ...menuItems([
      { label: D.company.name, sub: `${D.company.handle} · Treasury ${fmt.addr(D.company.treasury)}`, on: acting === 'org', icon: acting === 'org' ? 'check' : 'bank', cmd: 'capxul use org harbourline', onClick: () => cx.setActing('org') },
      { label: `Yourself (${me.name})`, sub: me.safe ? `Your Safe ${fmt.addr(me.safe)}` : 'Your own records', on: acting !== 'org', icon: acting !== 'org' ? 'check' : 'user', cmd: 'capxul use personal', onClick: () => cx.setActing('personal') },
    ], comp),
    h('div.pop-sep'),
    h('div.pop-note', `${D.company.address} · company ${D.company.companyNumber} · VAT ${D.company.vatNumber} · on Capxul since ${fmt.date(D.company.onCapxulSince)}`),
  ], { align: 'left' });
  // search
  const input = h('input', { type: 'search', id: 'tb-search', placeholder: 'Search people, invoices, deals, pages', 'aria-label': 'Search', autocomplete: 'off' });
  const results = h('div.pop.search-pop', { hidden: true, role: 'listbox' });
  const sWrap = h('div.tb-search', cx.icon('search'), input, h('kbd', '/'), results);
  let active = 0, list = [];
  const searchApi = { wrap: sWrap, close() { results.hidden = true; openPops.delete(searchApi); if (!input.value) sWrap.classList.remove('open'); } };
  const runSearch = () => {
    const q = input.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    list = coreSearch(q);
    for (const fn of searchProviders) { try { list.push(...(fn(q, 8) || [])); } catch (e) { console.error('search provider failed', e); } }
    const groups = new Map();
    for (const r of list) { if (!groups.has(r.kind)) groups.set(r.kind, []); if (groups.get(r.kind).length < 6) groups.get(r.kind).push(r); }
    list = [...groups.values()].flat();
    active = 0;
    fill(results, ...(list.length ? [...groups.entries()].flatMap(([k, rs]) => [h('div.pop-label', k), ...rs.map((r) => {
      const i = list.indexOf(r);
      return h('a.pop-item', { role: 'option', href: r.route ? cx.href(r.route, r.id) : '#' + cx.current.name, class: { on: i === active }, onclick: (e) => { if (!r.route) e.preventDefault(); searchApi.close(); input.value = ''; input.blur(); } },
        r.person ? cx.avatar(r.person, { size: 'sm' }) : cx.icon(r.icon || 'right'), h('span.grow', h('span.ttl', r.label), r.sub ? h('span.sub', r.sub) : null));
    })]) : [h('div.pop-note', `Nothing matches "${q}".`)]));
    results.hidden = false; openPops.add(searchApi);
  };
  input.addEventListener('input', runSearch);
  input.addEventListener('focus', () => { sWrap.classList.add('open'); if (input.value.trim().length >= 2) runSearch(); });
  input.addEventListener('blur', () => setTimeout(() => { if (!sWrap.contains(document.activeElement) && !input.value) sWrap.classList.remove('open'); }, 150));
  input.addEventListener('keydown', (e) => {
    const items = [...results.querySelectorAll('.pop-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); items.forEach((it, i) => it.classList.toggle('on', i === active)); }
    if (e.key === 'Enter' && items[active]) { e.preventDefault(); items[active].click(); }
    if (e.key === 'Escape') { input.value = ''; searchApi.close(); input.blur(); }
  });
  // today
  const today = h('div.tb-today', { title: `1 USDC = £${D.meta.rate.gbpPerUsdc} on ${fmt.date(D.meta.rate.asOf)}` }, h('b', `${fmt.weekday(cx.today)} ${fmt.date(cx.today)}`), h('small', `${fmt.time(D.meta.now)} London · 1 USDC = £${D.meta.rate.gbpPerUsdc}`));
  // notices
  const mine = () => (D.notices || []).filter((n) => n.to === meId);
  const unread = mine().filter((n) => !n.read).length;
  const bellBtn = h('button.iconbtn', { type: 'button', 'aria-label': `Notices, ${unread} unread` }, cx.icon('bell'), unread ? h('span.badge', String(unread)) : null);
  const bell = cx.popover(bellBtn, (p) => {
    const ns = mine().slice(0, 12);
    return [
      h('div', { style: 'display:flex;align-items:center;padding:4px 6px 4px 9px' }, h('b', { style: 'flex:1' }, 'Notices'), ns.some((n) => !n.read) ? h('button.btn.sm.ghost', { type: 'button', onclick: () => { mine().forEach((n) => { n.read = true; }); p.close(); renderTopbar(); } }, 'Mark all read') : null),
      ...(ns.length ? ns.map((n) => {
        const href = cx.refHref(n.ref);
        return h(href ? 'a.pop-item' : 'div.pop-item', { href, onclick: () => { n.read = true; p.close(); renderTopbar(); }, style: n.read ? 'opacity:.72' : null },
          h('span', { style: `width:7px;height:7px;border-radius:50%;flex:none;align-self:flex-start;margin-top:7px;background:${n.read ? 'transparent' : 'var(--accent)'}` }),
          h('span.grow', h('span', { style: 'display:block;white-space:normal;font-size:13px' }, n.text), h('span.sub', `${n.kind} · ${fmt.agoLong(n.at)}`)));
      }) : [h('div.pop-note', 'No notices for you.')]),
      routes.has('notices') ? h('div.pop-sep') : null,
      routes.has('notices') ? h('a.pop-item', { href: '#notices', onclick: () => p.close() }, cx.icon('list'), h('span.grow', 'All notices')) : null,
    ];
  }, { align: 'right' });
  // FDE
  const fdeBtn = h('button.tb-fde', { type: 'button', title: 'Ask the FDE', onclick: () => cx.fde.open() }, cx.icon('fde'), h('span', 'Ask the FDE'));
  // person
  const meBtn = h('button.tb-me', { type: 'button', 'aria-label': `Signed in as ${me.name}. Switch who you are viewing as` }, cx.avatar(meId), h('span.tb-me-text', h('b', me.name), h('small', me.designation || me.role || '')));
  const ps = cx.personas();
  const meMenu = cx.popover(meBtn, (p) => [
    h('div', { style: 'display:grid;gap:6px;padding:8px 9px 10px' },
      h('div', { style: 'display:flex;gap:10px;align-items:center' }, cx.avatar(meId, { size: 'lg' }), h('div', h('b', me.name), h('div.muted', { style: 'font-size:12.5px' }, me.companyEmail || me.email || ''))),
      (me.hats || []).length ? h('div.chips', me.hats.map(cx.hat)) : h('div.muted', { style: 'font-size:12.5px' }, 'Wears no hat'),
      h('div.muted', { style: 'font-size:12px' }, cx.hasSeat() ? `Has a seat · ${me.safe ? 'Safe ' + fmt.addr(me.safe) : ''}` : 'No seat at Harbourline: sees only their own records')),
    h('div.pop-sep'),
    h('div.pop-label', 'View as'),
    ...menuItems([...ps.seat, ...ps.noSeat].map((id, i) => ({ label: cx.name(id), sub: [(cx.person(id).hats || []).join(', ') || 'No hat', ps.noSeat.includes(id) ? 'no seat' : null].filter(Boolean).join(' · '), on: id === meId, icon: id === meId ? 'check' : 'user', onClick: () => cx.setMe(id) })), p),
  ], { align: 'right' });
  fill(topbar, menuBtn, brand, comp.wrap, sWrap, h('span.tb-spacer'), today, bell.wrap, fdeBtn, meMenu.wrap);
}
function renderSidebar() {
  if (!frameReady) return;
  const cur = cx.current.name;
  const ws0 = workspaceOf(cur);
  const seat = cx.hasSeat();
  const kids = [];
  const done = new Set();
  const groups = GROUPS.map((g) => ({ ...g, ids: [...g.ids] }));
  for (const id of workspaces.keys()) if (!groups.some((g) => g.ids.includes(id))) groups[groups.length - 1].ids.push(id);
  for (const g of groups) {
    const items = g.ids.map((id) => workspaces.get(id)).filter((ws) => ws && (seat || ws.seatless || ws.id === 'home'));
    if (!items.length) continue;
    kids.push(h('div.sb-group', g.label));
    for (const ws of items) {
      done.add(ws.id);
      const on = ws0 === ws || (!ws0 && ws.route === cur);
      const badge = typeof ws.badge === 'function' ? ws.badge() : ws.badge;
      kids.push(h('a.sb-ws', { href: cx.href(ws.route), class: { on }, 'aria-current': on ? 'page' : null }, cx.icon(ws.icon), h('span', ws.label), badge ? h('span.count', String(badge)) : null));
      if (on && ws.nav?.length) kids.push(h('div.sb-sub', navItems(ws.nav, cur, ws)));
    }
  }
  kids.push(h('div.sb-foot', D.meta.fictional));
  fill(sidebar, ...kids);
}
const secState = store.get('sections', {});
function navItems(items, cur, ws) {
  return items.flatMap((it) => {
    if (it.items) {
      const k = ws.id + ':' + it.section;
      const hasCur = navRoutes(it.items).includes(cur);
      const open = hasCur || (secState[k] ?? !it.collapsed);
      const box = h('div', { style: 'display:grid;gap:1px' }, navItems(it.items, cur, ws));
      box.hidden = !open;
      const btn = h('button.sb-sec', { type: 'button', 'aria-expanded': String(open), onclick: () => { const o2 = box.hidden; box.hidden = !o2; btn.setAttribute('aria-expanded', String(o2)); secState[k] = o2; store.set('sections', secState); } }, cx.icon('down'), it.section);
      return [btn, box];
    }
    const on = it.route === cur && (it.id == null || cx.slug(it.id) === cx.slug(cx.current.id)) || (it.match || []).includes(cur);
    const badge = typeof it.badge === 'function' ? it.badge() : it.badge;
    return [h('a.sb-link', { href: cx.href(it.route, it.id), class: { on }, 'aria-current': on ? 'page' : null }, h('span', it.label), badge != null ? h('span.count', String(badge)) : null)];
  });
}

/* =====================================================================================================
   Pages the shell owns: Home, not built yet, no seat, an error
   ===================================================================================================== */

function notBuilt(name, id) {
  return cx.page({ title: 'This screen is not built yet', crumbs: [{ label: 'Home', route: 'home' }], cmd: null,
    body: cx.card({ body: h('div', { style: 'display:grid;gap:8px' }, h('p', `The screen "${name}"${id ? ` for ${id}` : ''} arrives with its module.`), h('p', h('a', { href: '#home' }, 'Back to Home'))) }) });
}
function noSeatPage(ws) {
  const me = cx.me();
  return cx.page({ title: ws.label, cmd: { cli: `capxul org member invite ${me.personalEmail || me.email || me.companyEmail} --org harbourline`, who: 'whoever wears the People hat' },
    body: cx.card({ body: h('div', { style: 'display:grid;gap:10px;max-width:62ch' },
      h('p', h('b', `${me.name} has no seat at Harbourline.`), ` Without a seat Capxul shows only ${me.firstName || me.first}'s own records: payslips, leave, expense claims and money waiting for them. The company's ${ws.label.toLowerCase()} is not shown.`),
      h('p.muted', `A seat is offered by whoever wears the People hat (${(D.officerHats.people || []).filter((x) => !x.to).map((x) => cx.name(x.who)).join(', ')}). Harbourline uses ${D.seats.used} of its ${D.seats.limit} seats.`),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, cx.btn('Ask the FDE about seats', { icon: 'fde', onClick: () => cx.fde.open({ ask: 'How do I get a seat?' }) }), h('a.btn', { href: '#home' }, 'Home'))) }) });
}
function errorPage(name, e) {
  return cx.page({ title: 'This screen failed to draw', crumbs: [{ label: 'Home', route: 'home' }], cmd: null,
    body: cx.card({ body: h('div', { style: 'display:grid;gap:8px' }, h('p', `"${name}" threw an error while drawing.`), h('pre.raw', String(e && (e.stack || e.message) || e))) }) });
}
/** A placeholder workspace page for a module that is not built yet. */
cx.stubPage = (o) => cx.workspacePage({
  title: o.title, cmd: o.cmd, workspace: o.workspace,
  body: cx.card({ title: 'Coming in this workspace', body: h('div', { style: 'display:grid;gap:10px' }, h('p.muted', o.note || 'This workspace is being built.'), h('ul', { style: 'margin:0;padding-left:18px;display:grid;gap:3px' }, (o.screens || []).map((x) => h('li', x)))) }),
});

/* =====================================================================================================
   Walkthroughs: four stories through the mock-up, step by step, each step as the person who would act
   ===================================================================================================== */

const landSaltmarsh = () => { const d = (D.money.deposits || []).find((x) => x.id === 'bdep_arriving'); if (d?.status === 'Arriving') cx.native?.creditDeposit?.(d); return d; };
const TOURS = [
  { id: 'bridge', n: 1, title: 'A customer pays through Bridge', icon: 'bank',
    blurb: "Saltmarsh pays an invoice by bank transfer. Bridge turns the pounds into USDC in the Treasury; Capxul matches it to the invoice by its reference and books it.",
    steps: [
      { title: 'The invoice', as: 'maya', route: 'sales-invoice', id: 'ACC-SINV-2026-00052',
        text: 'Saltmarsh Distillery owes £13,680.00 on ACC-SINV-2026-00052. It quotes reference RF31 HL26 0052, and "How to pay" gives Harbourline\'s pound account at Bridge. The pill beside Unpaid says a payment is on its way.' },
      { title: 'The deposit', as: 'maya', route: 'deposit', id: 'bdep_arriving',
        text: 'Saltmarsh paid by Faster Payments this morning. Bridge has the pounds and is converting them to USDC. In a few seconds it lands in the Treasury (or press Check with Bridge), matched to the invoice by its reference.' },
      { title: 'Reconciled', as: 'maya', route: 'sales-invoice', id: 'ACC-SINV-2026-00052', state: { tab: 'Payments' }, before: landSaltmarsh,
        text: 'The invoice is Paid. Its payments list the entry Capxul booked against it. Nobody keyed anything: the reference did the matching.' },
      { title: 'The payment entry', as: 'maya', before: landSaltmarsh, resolve: () => { const d = landSaltmarsh(); return d?.voucher ? ['payment-entry', d.voucher] : ['payment-entries']; },
        text: 'Receive, from Saltmarsh: the USDC at its pounds into 1010 Treasury, Bridge\'s conversion fees to bank charges, and the receivable cleared against ACC-SINV-2026-00052.' },
      { title: 'The Treasury', as: 'maya', route: 'treasury', state: { tab: 'Statement' },
        text: 'The Treasury Safe\'s statement shows the USDC arriving, with its transaction on Base. The Safe and the books agree to the cent.' },
      { title: 'Every Bridge deposit', as: 'maya', route: 'bank', state: { tab: 'Deposits' },
        text: 'All the deposits Bridge has turned into USDC: matched by reference, matched by hand, or waiting for Books to review.' },
    ] },
  { id: 'payroll', n: 2, title: 'Month-end payroll in one batch', icon: 'payroll',
    blurb: 'October went out on 30 October in one approval, every payslip with its own proof. Then November: Isla, who wears People, prepares it; Maya, who wears the Harbourline hat, pays it.',
    steps: [
      { title: "October's run", as: 'maya', route: 'payroll-run', id: 'HR-PRUN-2026-00010', state: { tab: 'Accounting and payment' },
        text: 'HR-PRUN-2026-00010: one approval by Maya, one payment on Base per payslip, each with its document hash. Hannah Cole had no account yet, so hers waited for her in money waiting until she claimed it.' },
      { title: 'One payslip, its proof', as: 'maya', route: 'payslip', id: 'Sal Slip/HR-EMP-00003/00018', state: { tab: 'Payment' },
        text: "Ellis Hart's October pay went to his bank through Bridge. Press Verify: the page re-hashes the payment advice, which commits to the payslip's lines, and checks it against the hash on chain." },
      { title: 'Isla prepares November', as: 'isla', route: 'payroll-run-new',
        text: 'Isla wears People. She creates the run for November and submits the payslips. She cannot pay them: paying takes the Harbourline hat.' },
      { title: 'Maya pays everyone at once', as: 'maya',
        resolve: () => { const r = D.payroll.runs.find((x) => x.status === 'Submitted'); return r ? ['payroll-run', r.name, { tab: 'Accounting and payment' }] : ['payroll-runs']; },
        check: () => D.payroll.runs.some((x) => ['Submitted', 'Paid'].includes(x.status) && x.startDate === '2026-11-01'), unmet: "November's run is not submitted yet: go back a step and let Isla create and submit it.",
        text: 'On the submitted run Maya presses Pay: one passkey approval sends every payslip, each payment with its own proof. A payslip that is withheld stays out of the batch.' },
      { title: 'The salary register', as: 'maya', route: 'salary-register',
        text: 'Every payslip with what it paid, how it was paid, and its proof.' },
    ] },
  { id: 'hire', n: 3, title: 'The FDE drafts a new hire', icon: 'fde',
    blurb: "Maya tells the FDE that Owen Grady joins on 4 January. It drafts her two steps as founder, and People's three for Kwame, acting only with each person's permissions.",
    steps: [
      { title: 'Maya asks the FDE', as: 'maya', route: 'home', ask: 'Owen Grady joins on 4 January as a Senior Software Engineer. What do I need to do?',
        text: "The FDE reads the invitation, Engineering's budget and the options pool. It drafts Maya's steps for her to run and People's steps for Kwame. Press Review and approve on hers." },
      { title: "Engineering's budget", as: 'maya', route: 'department', id: 'engineering', state: { tab: 'Changes' },
        check: () => (D.departments.find((d) => d.id === 'engineering')?.changes || []).some((c) => /Owen/.test(c.note || '')), unmet: "Maya has not run her draft yet: go back a step and press Review and approve.",
        text: "Engineering's changes show the raise for Q1, signed with Maya's passkey as Harbourline, the hat above Engineering." },
      { title: "Owen's options", as: 'maya', route: 'proposals',
        text: 'The grant is a Board proposal. Maya approved it as she proposed it; Tom or Ruth makes it final.' },
      { title: 'Kwame adds the employee', as: 'kwame', route: 'employee-new', state: { fill: 'owen' },
        text: "Kwame wears People. The FDE's draft opens the employee form filled from Owen's offer. Maya could not do this herself: People cannot be worn with a department's hat." },
      { title: 'His seat', as: 'kwame', route: 'seats',
        text: "Owen's invitation went out on 3 November. When he accepts, he gets his own Safe and his own agent." },
    ] },
  { id: 'swap', n: 4, title: "A department's budget, a new person in its hat", icon: 'departments',
    blurb: "Delivery's budget belongs to Delivery, not to a person. Maya swaps Ravi in for Grace: the money, its payments and what Delivery set running stay with Delivery.",
    steps: [
      { title: 'Departments', as: 'maya', route: 'departments',
        text: "Each department has a quarterly budget in USDC. Whoever wears its hat now spends it and decides its people's leave and claims." },
      { title: "Delivery's budget", as: 'maya', route: 'department', id: 'delivery', state: { tab: 'Overview' },
        text: 'Spent, handed down, committed and left this quarter, and who can act on it now.' },
      { title: 'Swap the hat', as: 'maya', route: 'department', id: 'delivery', state: { tab: 'Holders' },
        text: 'Maya wears Harbourline, the hat above Delivery. Under Holders she adds Ravi Shah, then removes Grace Adeyemi: one passkey approval each.' },
      { title: 'Ravi can pay from it', as: 'ravi', route: 'send-money',
        check: () => cx.holders('delivery').includes('ravi'), unmet: 'Ravi does not wear the Delivery hat yet: go back a step and add him.',
        text: "Viewing as Ravi: Pay from now offers Delivery's budget, and its leave and claims come to him." },
      { title: 'Grace no longer can', as: 'grace', route: 'department', id: 'delivery', state: { tab: 'Holders' },
        check: () => !cx.holders('delivery').includes('grace'), unmet: 'Grace still wears the Delivery hat: go back two steps and remove her.',
        text: "Viewing as Grace: Delivery's controls are locked, with the reason. Her past approvals stay on the record." },
    ] },
];
let tour = null;
function tourGo(i) {
  if (!tour) return;
  const t = tour.t;
  tour.i = Math.max(0, Math.min(i, t.steps.length - 1));
  const st = t.steps[tour.i];
  try { st.before?.(); } catch (e) { console.error(e); }
  if (st.as && st.as !== meId && cx.person(st.as)) { meId = st.as; store.set('persona', meId); renderTopbar(); emit('persona', cx.me()); }
  const [route, id, state] = st.resolve ? st.resolve() : [st.route, st.id, st.state];
  cx.panel.close();
  cx.go(route, id, state);
  if (st.ask) setTimeout(() => cx.fde.open({ ask: st.ask }), 350);
}
cx.tours = {
  list: () => TOURS,
  start(id, i = 0) { const t = TOURS.find((x) => x.id === id); if (!t) return; tour = { t, i: 0 }; tourGo(i); },
  go: tourGo,
  end() { tour = null; render({ keepScroll: true }); },
  current: () => (tour ? { id: tour.t.id, step: tour.i } : null),
};
function tourBar() {
  const t = tour.t, st = t.steps[tour.i];
  const unmet = st.check && !st.check() ? st.unmet : null;
  const where = st.resolve ? null : cx.href(st.route, st.id);
  const away = where && location.hash !== where && !(location.hash === '' && st.route === 'home');
  return h('section.tour-bar', { role: 'region', 'aria-label': 'Walkthrough' },
    h('span.tour-step', `${t.n} · Step ${tour.i + 1} of ${t.steps.length}`),
    h('div.tour-text', h('b', `${t.title}: ${st.title}`), h('span', st.text), unmet ? h('span', { style: 'color:var(--t-orange)' }, unmet) : null, st.as ? h('span.faint', { style: 'font-size:12px' }, `Viewing as ${cx.name(st.as)}${cx.person(st.as)?.hats?.length ? ' · ' + cx.person(st.as).hats.join(', ') : ''}`) : null),
    h('div.tour-nav',
      away ? h('button.btn.sm', { type: 'button', onclick: () => tourGo(tour.i) }, 'Back to this step') : null,
      tour.i > 0 ? h('button.btn.sm', { type: 'button', onclick: () => tourGo(tour.i - 1) }, cx.icon('left'), 'Back') : null,
      tour.i < t.steps.length - 1 ? h('button.btn.sm.primary', { type: 'button', onclick: () => tourGo(tour.i + 1) }, 'Next', cx.icon('right'))
        : h('button.btn.sm.primary', { type: 'button', onclick: () => { cx.tours.end(); cx.go('home'); } }, cx.icon('check'), 'Finish'),
      h('button.btn.sm.ghost', { type: 'button', title: 'End the walkthrough', onclick: () => cx.tours.end() }, 'End')));
}
function toursCard() {
  return cx.card({ title: 'Walk through Harbourline', flush: true,
    actions: h('span.muted', { style: 'font-size:12.5px' }, 'Each step switches who you are viewing as'),
    body: h('div.tours', TOURS.map((t) => h('div.tour',
      h('h3', h('span.n', String(t.n)), t.title),
      h('p', t.blurb),
      h('ol', t.steps.map((s) => h('li', s.title))),
      h('button.btn.sm.primary.tour-go', { type: 'button', onclick: () => cx.tours.start(t.id) }, 'Start', cx.icon('right'))))) });
}
/** Home's index of every workspace and its pages, so every screen is two clicks from Home. */
function directoryCard() {
  const seat = cx.hasSeat();
  const groups = GROUPS.map((g) => ({ ...g, ids: [...g.ids] }));
  for (const id of workspaces.keys()) if (!groups.some((g) => g.ids.includes(id))) groups[groups.length - 1].ids.push(id);
  const flat = (items) => items.flatMap((it) => (it.items ? flat(it.items) : [it]));
  const cols = groups.flatMap((g) => g.ids.map((id) => workspaces.get(id)).filter((ws) => ws && ws.id !== 'home' && (seat || ws.seatless)))
    .map((ws) => h('div.wsdir-ws', h('a.wsdir-head', { href: cx.href(ws.route) }, cx.icon(ws.icon, { size: 15 }), ws.label),
      h('ul', flat(ws.nav || []).filter((it) => it.route !== ws.route || it.id).map((it) => h('li', cx.link(it.label, it.route, it.id))))));
  return cx.card({ title: 'Everything in Capxul', cmd: 'capxul --help', body: h('div.wsdir', cols) });
}

function greeting() { const hh = +london(D.meta.now).hh; return hh < 12 ? 'Good morning' : hh < 18 ? 'Good afternoon' : 'Good evening'; }
function homePage() {
  const me = cx.me();
  const seat = cx.hasSeat();
  const daysOn = Math.round((Date.parse(cx.today) - Date.parse(D.company.onCapxulSince)) / 86400000) + 1;
  const hello = h('div.home-hello',
    h('div', { style: 'display:grid;gap:4px' }, h('h1', `${greeting()}, ${me.firstName || me.first || me.name}`), h('p', `${D.company.name} · ${D.meta.counts?.activeEmployees ?? 25} people · day ${fmt.int(daysOn)} on Capxul`)),
    h('p.when', fmt.dateLong(cx.today), h('br'), h('span.faint', `${fmt.time(D.meta.now)} in London`)));
  const homeCmd = { cli: ['capxul balance --org harbourline', 'capxul org department list', 'capxul payment list --org harbourline --scheduled', 'capxul activity list --limit 5'], note: 'Home has no single command; each card shows its own.' };
  const askCard = cx.card({ title: 'Ask the FDE', cmd: 'capxul org fde ask "…" --org harbourline', body: h('div.ask',
    h('form', { onsubmit: (e) => { e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (v) cx.fde.open({ ask: v }); } }, h('input.finput', { id: 'home-ask', placeholder: 'Ask anything about Harbourline', 'aria-label': 'Ask the FDE' }), h('button.btn.primary', { type: 'submit' }, cx.icon('send'), h('span', 'Ask'))),
    h('div.suggest', cx.fde.suggestions.map((sg) => h('button', { type: 'button', onclick: () => cx.fde.open({ ask: sg }) }, sg))),
    h('p.muted', { style: 'font-size:12.5px' }, `Anyone can ask. The FDE acts only with your permissions and drafts risky actions for you to run.`)) });
  if (!seat) {
    const mine = (D.notices || []).filter((n) => n.to === meId);
    return cx.page({ title: '', hero: hello, cmd: { cli: ['capxul payroll payslip list', 'capxul hr leave balance', 'capxul payment claim'], note: 'Without a seat you see your own records.' }, fde: 'Home',
      body: [cx.banner(`${me.name} has no seat at Harbourline, so Capxul shows only ${me.firstName}'s own records.`, { tone: 'info' }),
        h('div.grid.c2', cx.card({ title: 'Your notices', body: mine.length ? h('ul.feed', mine.slice(0, 6).map((n) => h('li', cx.icon('bell'), h('span', n.text), h('span.ago', fmt.ago(n.at))))) : h('p.muted', 'No notices.'), flush: !!mine.length }), askCard), directoryCard()] });
  }
  // waiting for you
  const waits = (D.approvals?.waiting || []).filter((a) => (a.waitsFor || []).includes(meId));
  const allWaits = D.approvals?.waiting || [];
  const waitCard = cx.card({ title: h('span', 'Waiting for you ', h('span.muted', { style: 'font-weight:400' }, `· ${waits.length}`)), actions: routes.has('approvals') ? h('a.btn.sm', { href: '#approvals' }, `All ${allWaits.length} waiting`) : null, cmd: 'capxul org proposal list --status waiting · capxul org hr leave list --status open', flush: true,
    body: waits.length ? h('ul.wait-list', waits.slice(0, 5).map((a) => {
      const href = cx.refHref(a.ref);
      return h('li', cx.pill(a.kind === 'Board' ? 'Board' : a.kind, a.kind === 'Money' ? 'escrow' : a.kind === 'Board' ? 'purple' : 'blue'),
        h('div', { style: 'min-width:0' }, h('div.what', href ? h('a', { href }, a.what) : a.what), h('div.why', `${a.amount ? a.amount + ' · ' : ''}from ${cx.name(a.openedBy)} · ${fmt.agoLong(a.openedAt)} · ${a.because}`), a.command ? h('code', '$ ' + a.command) : null),
        href ? h('a.btn.sm', { href }, 'Open') : null);
    })) : h('div.empty', 'Nothing waits for you.') });
  // money position
  const sf = D.money.safes; const bank = D.books.bankAccounts?.[0];
  const bs = D.books.reports.balanceSheet.at(-1);
  const ar = bs?.assets?.find((x) => x.account === '1200')?.amount;
  const pos = (lbl, icon, val, unit, alt, href) => h(href ? 'a.position-cell' : 'div', { href }, h('span.lbl', cx.icon(icon, { size: 14 }), lbl), h('span.val', val, unit ? h('small', unit) : null), alt ? h('span.alt', alt) : null);
  const purpose = new Map(D.money.payments.map((p) => [p.id, p.purpose]));
  const monthly = new Map();
  for (const r of cx.rows('activity')) {
    if (r.direction === 'Between your Safes' || r.safe !== 'Treasury' || ['investment', 'transfer'].includes(purpose.get(r.payment))) continue;
    const m = String(r.at).slice(0, 7); const e = monthly.get(m) || { in: 0, out: 0 };
    if (r.amount > 0) e.in += r.amount; else e.out += -r.amount;
    monthly.set(m, e);
  }
  const months = [...monthly.keys()].sort().slice(-12);
  const flow = chart.bar({ labels: months.map((m) => fmt.monthShort(m)), series: [{ name: 'In', values: months.map((m) => monthly.get(m).in), color: 'pos' }, { name: 'Out', values: months.map((m) => monthly.get(m).out), color: 'neg' }], format: (v) => fmt.compact(v), tipFormat: (v) => fmt.usdc(v), height: 190, title: 'Treasury in and out by month' });
  const moneyCard = cx.card({ title: 'Money', cmd: 'capxul balance --org harbourline', actions: routes.has('money') ? h('a.btn.sm', { href: '#money' }, 'Open Money') : null, flush: true, body: [
    h('div.position',
      pos('Treasury', 'money', fmt.num(sf.treasury.balance, 2), 'USDC', `${fmt.gbp(sf.treasury.gbp)} · ${fmt.num(sf.treasury.available, 2)} available`, routes.has('treasury') ? '#treasury' : null),
      pos('Reserve Safe', 'shield', fmt.num(sf.reserve.balance, 2), 'USDC', `${fmt.gbp(sf.reserve.gbp)} · moves by Board proposal`, routes.has('reserve') ? '#reserve' : null),
      pos('Barclays', 'bank', fmt.gbp(bank?.balance), null, `·· ${bank?.last4} · statement to ${fmt.day(bank?.statementTo)}`, routes.has('bank-account') ? cx.href('bank-account', bank?.name) : null),
      pos('Money waiting', 'hourglass', fmt.num(sf.moneyWaiting.balance, 2), 'USDC', `${fmt.plural(sf.moneyWaiting.open, 'escrow')} open, to be claimed`, routes.has('money-waiting') ? '#money-waiting' : null),
      pos('Receivables', 'in', fmt.gbp(ar), null, 'owed by customers', routes.has('accounts-receivable') ? '#accounts-receivable' : null)),
    h('div', { style: 'padding:12px 14px 10px' }, h('div', { style: 'font-size:12.5px;color:var(--muted);margin-bottom:6px' }, 'Treasury in and out by month, in USDC, without the rounds and moves between Safes'), flow)] });
  // departments this quarter
  const q = cx.budgetOn('harbourline');
  const depts = D.departments.map((d) => {
    const b = cx.budgetOn(d.id); if (!b) return null;
    const holder = cx.holders(d.id).filter((x) => !String(x).startsWith('@'));
    const parts = [{ label: 'Spent', value: b.spent, color: '1' }];
    if (b.teamsAndAllowances) parts.push({ label: 'Handed down', value: b.teamsAndAllowances, color: '2' });
    if (b.committed) parts.push({ label: 'Committed', value: b.committed, color: '3' });
    return h(routes.has('department') ? 'a.dept-row' : 'div.dept-row', { href: routes.has('department') ? cx.href('department', d.id) : null, style: 'color:inherit;text-decoration:none' },
      h('div.top', h('b', d.name), h('small', holder.length ? `${holder.map(cx.name).join(', ')} wears the hat` : ''), h('span.grow'), h('small', `${fmt.usdc(b.left)} left`)),
      chart.meter({ total: b.amount, parts, warnAt: 0.85, format: (v) => fmt.num(v, 0), legend: false }));
  }).filter(Boolean);
  const deptCard = cx.card({ title: `Departments · ${q ? q.quarter.replace('-', ' ') : ''}`, cmd: 'capxul org department list', actions: routes.has('departments') ? h('a.btn.sm', { href: '#departments' }, 'All departments') : null,
    body: h('div', { style: 'display:grid;gap:12px' }, h('div.legend', { style: 'margin:0' }, h('span', h('i', { style: 'background:var(--chart-1)' }), 'Spent'), h('span', h('i', { style: 'background:var(--chart-2)' }), 'Handed down to departments'), h('span', h('i', { style: 'background:var(--chart-3)' }), 'Committed'), h('span', h('i', { style: 'background:var(--t-orange)' }), 'Above 85%')), h('div.dept-rows', depts)) });
  // coming up
  const coming = [];
  for (const sp of D.money.scheduled || []) coming.push({ day: sp.day, text: h('span', `${fmt.usdc(sp.amount)} to ${sp.to}`, h('span.muted', ` · ${cx.deptName(sp.budget)} · ${sp.what}`)), pill: cx.pill(sp.status), href: sp.payment && routes.has('payment') ? cx.href('payment', sp.payment) : null });
  const vote = (D.equity?.votes || []).find((v) => v.closes >= cx.today && !/executed|lapsed|failed|closed/i.test(v.status || ''));
  if (vote) coming.push({ day: vote.closes, text: h('span', `Vote ${vote.id} closes`, h('span.muted', ` · ${vote.title}`)), pill: cx.pill('Voting', 'orange'), href: routes.has('vote') ? cx.href('vote', vote.id) : null });
  const fh = D.fde?.hosting;
  if (fh?.due) coming.push({ day: fh.due, text: h('span', `FDE hosting due`, h('span.muted', ` · ${fmt.usdc(fh.price)} a month, paid through ${fmt.date(fh.paidThrough)}`)), pill: cx.pill('Due', 'orange'), href: routes.has('fde') ? '#fde' : null });
  const inv = (D.seats.invitations || []).find((x) => x.status === 'Pending');
  if (inv) coming.push({ day: inv.expires, text: h('span', `Invitation to ${inv.email} expires`, h('span.muted', inv.note ? ` · ${inv.note}` : '')), pill: cx.pill('Pending'), href: routes.has('seats') ? '#seats' : null });
  const lastRun = D.payroll.runs.at(-1);
  if (lastRun) {
    const nd = new Date(lastRun.endDate + 'T00:00:00Z'); nd.setUTCMonth(nd.getUTCMonth() + 2, 0);
    const day = nd.toISOString().slice(0, 10);
    coming.push({ day, text: h('span', `Payroll for ${fmt.month(day)}`, h('span.muted', ` · last month ${fmt.gbp(lastRun.totals.net)} net to ${lastRun.totals.employees} people`)), pill: cx.pill('Scheduled', 'blue'), href: routes.has('payroll') ? '#payroll' : null });
  }
  coming.sort((a, b) => a.day.localeCompare(b.day));
  const comingCard = cx.card({ title: 'Coming up', cmd: 'capxul payment list --org harbourline --scheduled', flush: true, body: h('ul.coming', coming.slice(0, 7).map((c) => {
    const p = ymd(c.day);
    return h('li', h('span.cal', h('b', String(p.d)), h('small', MONTHS[p.m - 1])), h('div', { style: 'min-width:0' }, c.href ? h('a', { href: c.href, style: 'color:inherit' }, c.text) : c.text), c.pill);
  })) });
  // latest activity
  const EV_ICON = { Money: 'money', People: 'hr', Payroll: 'payroll', Projects: 'projects', Agents: 'fde', Board: 'board', Equity: 'board', CRM: 'crm', Books: 'books', Departments: 'departments', Seats: 'seats' };
  const feedCard = cx.card({ title: 'Latest activity', cmd: 'capxul activity list --limit 5', actions: routes.has('activity') ? h('a.btn.sm', { href: '#activity' }, 'All activity') : null, flush: true, body: h('ul.feed', (D.events || []).slice(0, 6).map((e) => {
    const href = cx.refHref(e.ref);
    return h('li', e.who ? cx.avatar(e.who, { size: 'sm' }) : h('span.avatar.sm.t-gray', cx.icon(EV_ICON[e.kind] || 'activity', { size: 12 })), h('div', { style: 'min-width:0' }, href ? h('a', { href, style: 'color:inherit' }, e.text) : e.text, h('div.muted', { style: 'font-size:12px' }, e.kind)), h('span.ago', { title: fmt.datetime(e.at) }, fmt.ago(e.at)));
  })) });
  return cx.page({ title: '', hero: hello, cmd: homeCmd, fde: 'Home',
    body: [toursCard(), h('div.grid.side.home-cols', h('div.grid', waitCard, moneyCard, deptCard), h('div.grid', askCard, comingCard, feedCard)), directoryCard()] });
}

cx.workspace({ id: 'home', label: 'Home', icon: 'home', route: 'home', nav: [], seatless: true });
cx.route('home', () => homePage(), { workspace: 'home', title: 'Home' });

/* =====================================================================================================
   Boot
   ===================================================================================================== */

async function loadJson(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = +res.headers.get('content-length') || 8.7e6;
  if (!res.body?.getReader) return res.json();
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onProgress?.(Math.min(1, got / total));
  }
  const all = new Uint8Array(got); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return JSON.parse(new TextDecoder().decode(all));
}
async function boot() {
  const bar = document.getElementById('boot-bar');
  const note = document.getElementById('boot-note');
  try {
    D = await loadJson('data.json', (p) => { if (bar) bar.style.width = Math.max(8, p * 100).toFixed(0) + '%'; });
  } catch (e) {
    console.error('Could not load data.json', e);
    if (note) note.textContent = 'The data did not load. Serve this folder over HTTP and reload.';
    return;
  }
  cx.data = D;
  try { document.documentElement.lang = 'en-GB'; } catch { /* the wrapper may own the root */ }
  cx.today = D.meta.today;
  cx.now = new Date(D.meta.now);
  cx.company = D.company;
  indexPeople();
  const saved = store.get('persona', null);
  if (saved && cx.person(saved)) meId = saved;
  if (note) note.textContent = 'Opening the workspaces…';
  const failed = [];
  await Promise.all(MODULES.map((m) => import(`./${m}.js`).catch((e) => { failed.push(m); console.error(`Module ${m}.js failed to load:`, e); })));
  buildFrame();
  window.addEventListener('hashchange', () => render());
  await render();
  if (failed.length) toast(`Some modules did not load: ${failed.join(', ')}`, { tone: 'danger' });
  emit('ready', cx);
}
boot();
