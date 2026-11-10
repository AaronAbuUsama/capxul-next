// Shared helpers for the Harbourline data generator: a seeded random generator, UTC dates, ids, hashes and money.
// No dependencies beyond Node's own modules. Everything here is deterministic.
import { createHash } from "node:crypto";

// ---------- random ----------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export const SEED = 20261109;
// One stream per name, so a change in one domain never shifts another domain's numbers.
export function rng(name) {
  const r = mulberry32((SEED ^ strSeed(name)) >>> 0);
  const api = {
    next: r,
    float: (a = 0, b = 1) => a + (b - a) * r(),
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    chance: (p) => r() < p,
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    weighted: (pairs) => {
      // pairs: [[value, weight], ...]
      const total = pairs.reduce((s, p) => s + p[1], 0);
      let x = r() * total;
      for (const [v, w] of pairs) {
        if ((x -= w) < 0) return v;
      }
      return pairs[pairs.length - 1][0];
    },
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    sample: (arr, n) => api.shuffle(arr).slice(0, n),
    hex: (bytes) => {
      let s = "";
      for (let i = 0; i < bytes; i++) s += Math.floor(r() * 256).toString(16).padStart(2, "0");
      return s;
    },
    normal: (mean, sd) => {
      const u = Math.max(r(), 1e-9);
      const v = r();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
  return api;
}

// ---------- dates (all UTC; London is GMT/BST but the generator stores UTC) ----------
export const DAY = 86400000;
export const TODAY = "2026-11-09";
export const NOW = "2026-11-09T10:45:00Z";
export const START = "2025-05-01";
export const ms = (d) => Date.parse(d.length === 10 ? d + "T00:00:00Z" : d);
export const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const isoTime = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
export const addDays = (d, n) => iso(ms(d) + n * DAY);
export const dow = (d) => new Date(ms(d)).getUTCDay(); // 0 Sun .. 6 Sat
export const isWeekend = (d) => dow(d) === 0 || dow(d) === 6;
export const ym = (d) => d.slice(0, 7);
export function addMonths(d, n) {
  const dt = new Date(ms(d));
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + n;
  const day = dt.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m, Math.min(day, last)));
}
export function monthStart(d) {
  return d.slice(0, 7) + "-01";
}
export function monthEnd(d) {
  const dt = new Date(ms(d));
  return iso(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
}
export function daysInMonth(d) {
  return Number(monthEnd(d).slice(8, 10));
}
export function eachDay(a, b) {
  const out = [];
  for (let t = ms(a); t <= ms(b); t += DAY) out.push(iso(t));
  return out;
}
export function months(a, b) {
  // first days of each month from a's month to b's month
  const out = [];
  let d = monthStart(a);
  while (d <= b) {
    out.push(d);
    d = addMonths(d, 1);
  }
  return out;
}
export function daysBetween(a, b) {
  return Math.round((ms(b) - ms(a)) / DAY);
}
export const minDate = (a, b) => (a < b ? a : b);
export const maxDate = (a, b) => (a > b ? a : b);
export function quarterOf(d) {
  const m = Number(d.slice(5, 7));
  return `${d.slice(0, 4)}-Q${Math.floor((m - 1) / 3) + 1}`;
}
export function quarterStart(q) {
  const [y, n] = q.split("-Q");
  return `${y}-${String((Number(n) - 1) * 3 + 1).padStart(2, "0")}-01`;
}
export function quarterEnd(q) {
  return monthEnd(addMonths(quarterStart(q), 2));
}
export function at(d, hh, mm = 0, ss = 0) {
  return `${d}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}Z`;
}
// UK tax year starting 6 April
export function taxYearStart(d) {
  const y = Number(d.slice(0, 4));
  const start = `${y}-04-06`;
  return d >= start ? start : `${y - 1}-04-06`;
}
// Harbourline's fiscal year starts 1 April
export function fiscalYear(d) {
  const y = Number(d.slice(0, 4));
  return d >= `${y}-04-01` ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// ---------- money: integers inside (pence, micro-USDC), numbers outside ----------
export const P = (x) => Math.round(x * 100); // pounds -> pence
export const U = (x) => Math.round(x * 1e6); // USDC -> micro
export const gbp = (pence) => Math.round(pence) / 100;
export const usdc = (micro) => Math.round(micro) / 1e6;
export const r2 = (x) => Math.round(x * 100) / 100;
export const r6 = (x) => Math.round(x * 1e6) / 1e6;
export function sum(arr, f = (x) => x) {
  let s = 0;
  for (const x of arr) s += f(x);
  return s;
}

// ---------- ids and hashes ----------
const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(timeMs, r) {
  let t = timeMs;
  let ts = "";
  for (let i = 0; i < 10; i++) {
    ts = CROCK[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCK[Math.floor(r.next() * 32)];
  return ts + rand;
}
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}
export { canonical };
// SHA-256 of the canonical JSON, as 0x-hex. The app can re-hash the same JSON with SubtleCrypto to verify a proof.
export function hashOf(obj) {
  return "0x" + createHash("sha256").update(canonical(obj)).digest("hex");
}
export function hex32(r) {
  return "0x" + r.hex(32);
}
export function address(r) {
  // mixed-case looking address (not a real checksum)
  const h = r.hex(20);
  let out = "0x";
  for (let i = 0; i < h.length; i++) out += r.chance(0.5) ? h[i].toUpperCase() : h[i];
  return out;
}

// Base: two-second blocks since launch
const BASE_GENESIS = Date.parse("2023-06-15T00:00:00Z");
export function blockAt(timeIso) {
  return Math.floor((Date.parse(timeIso) - BASE_GENESIS) / 2000);
}

// ---------- naming series (ERPNext's) ----------
export class Series {
  constructor() {
    this.counters = new Map();
  }
  next(prefix, width = 5) {
    const n = (this.counters.get(prefix) || 0) + 1;
    this.counters.set(prefix, n);
    return prefix + String(n).padStart(width, "0");
  }
  peek(prefix) {
    return this.counters.get(prefix) || 0;
  }
}

// ---------- words ----------
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words999(n) {
  let s = "";
  if (n >= 100) {
    s += ONES[Math.floor(n / 100)] + " Hundred";
    n %= 100;
    if (n) s += " And ";
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)];
    if (n % 10) s += "-" + ONES[n % 10];
  } else if (n > 0) s += ONES[n];
  return s;
}
function intWords(n) {
  if (n === 0) return "Zero";
  const parts = [];
  const units = [[1e6, "Million"], [1e3, "Thousand"]];
  for (const [v, w] of units) {
    if (n >= v) {
      parts.push(words999(Math.floor(n / v)) + " " + w);
      n %= v;
    }
  }
  if (n) parts.push(words999(n));
  return parts.join(", ");
}
// ERPNext's "In Words": "GBP Nine Thousand, Five Hundred And Forty only."
export function inWords(pence, currency = "GBP") {
  const whole = Math.floor(pence / 100);
  const frac = pence % 100;
  const big = { GBP: ["Pounds", "Pence"], USD: ["Dollars", "Cents"] }[currency] || ["", ""];
  let s = intWords(whole) + " " + big[0];
  if (frac) s += " and " + intWords(frac) + " " + big[1];
  return s + " only.";
}

export function slug(s) {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Compact table: {cols, rows}
export function table(cols, objs) {
  return { cols, rows: objs.map((o) => cols.map((c) => (o[c] === undefined ? null : o[c]))) };
}
