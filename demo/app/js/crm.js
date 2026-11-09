// CRM: the dashboard; leads and deals as lists, group-by tables and kanban boards; the lead and deal pages with their
// whole activity timeline (emails, WhatsApp, calls, notes, tasks, status changes and the money the chain proves);
// contacts, companies, notes, tasks and call logs. Every member reads the CRM; whoever wears the People hat changes it.
import { cx, h, s } from './core.js';

const D = cx.data;
const C = D.crm;
const fmt = cx.fmt;
const TODAY = cx.today;
const T0 = performance.now();
/** The clock for new records: the mock-up's "now", moving forward with the session. */
const NOW = () => new Date(cx.now.getTime() + Math.max(1000, Math.round(performance.now() - T0))).toISOString().replace(/\.\d{3}Z$/, 'Z');
const HL_PHONE = '+44 20 7946 0321';
const NEED = 'People';

/* =====================================================================================================
   Indexes and small helpers
   ===================================================================================================== */

const COMPANY = new Map(C.companies.map((c) => [c.id, c]));
const CONTACT = new Map(C.contacts.map((c) => [c.id, c]));
const PAYMENT = new Map(D.money.payments.map((p) => [p.id, p]));
const TL = new Map();
function indexTl(it) { let a = TL.get(it.recordName); if (!a) TL.set(it.recordName, (a = [])); a.push(it); }
C.timeline.forEach(indexTl);
const MEMBER_EMAIL = new Map((D.seats.members || []).filter((m) => m.email).map((m) => [m.id, m.email]));
const memberEmail = (id) => MEMBER_EMAIL.get(id) || `${String(cx.firstName(id)).toLowerCase()}@harbourline.studio`;
/** Members who can own a lead or deal: people with a seat. */
const members = () => (D.seats.members || []).filter((m) => m.kind === 'Person' && m.status === 'Active' && cx.person(m.id)?.kind === 'employee').map((m) => m.id);
const peopleWearers = () => D.people.filter((p) => (p.hats || []).includes('People')).map((p) => p.id);
const namesList = (ids) => { const n = ids.map(cx.name); return n.length <= 1 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n.at(-1); };
const q = (v) => (/[\s"'&|;<>()$`\\]/.test(String(v ?? '')) || v === '' ? JSON.stringify(String(v ?? '')) : String(v));
const sum = (arr, f) => arr.reduce((a, x) => a + (+(f ? f(x) : x) || 0), 0);
const r2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
const dayOf = (iso) => String(iso || '').slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(dayOf(b) + 'T00:00:00Z') - Date.parse(dayOf(a) + 'T00:00:00Z')) / 86400000);
const addDays = (d, n) => { const t = new Date(dayOf(d) + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const when = (iso) => h('span.crm-when', { title: fmt.datetime(iso) }, fmt.agoLong(iso));
const initials = (name) => String(name || '?').replace(/[^A-Za-z0-9 &-]/g, '').split(/[\s&-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const TONES = ['teal', 'blue', 'purple', 'orange', 'green', 'escrow', 'yellow', 'red'];
const toneFor = (t) => { let x = 0; for (const c of String(t)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return TONES[x % TONES.length]; };
/** Initials for someone outside Harbourline (a lead, a contact) or a company (square). */
const extAvatar = (name, o = {}) => h('span.avatar', { class: ['t-' + toneFor(name), o.size, o.square && 'crm-sq'], 'aria-hidden': 'true' }, initials(name));
const toGbp = (v, cur, day) => (cur === 'GBP' || !v ? +v || 0 : (+v || 0) * cx.rate(day || TODAY));
let seq = 0;
const newActId = () => `act_new_${++seq}`;
/** The next free name in a series: nextName('CRM-DEAL-2026-', names) → CRM-DEAL-2026-00026. */
function nextName(prefix, names, pad = 5) {
  let max = 0;
  for (const n of names) if (n && String(n).startsWith(prefix)) max = Math.max(max, +String(n).slice(prefix.length) || 0);
  return prefix + String(max + 1).padStart(pad, '0');
}

/* ---------- statuses ---------- */

const ST = { lead: C.statuses.lead, deal: C.statuses.deal };
const stOf = (kind, name) => ST[kind].find((x) => x.name === name) || { name, color: 'gray', type: 'Open' };
const stDot = (kind, name) => cx.dot(name, stOf(kind, name).color);
const isLost = (kind, name) => stOf(kind, name).type === 'Lost';
const stageOf = (kind, name) => stOf(kind, name).type.toLowerCase();
const TASK_ST = ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled'];
const TASK_COLOR = { Backlog: 'gray', Todo: 'gray', 'In Progress': 'blue', Done: 'green', Canceled: 'red' };
const PRIORITIES = ['Low', 'Medium', 'High'];

/** The CRM task's status icon: dashed circle, circle, half circle, check, cross. */
function taskIcon(status) {
  const st = { width: 15, height: 15, viewBox: '0 0 16 16', class: 'crm-tico', 'aria-hidden': 'true' };
  const ring = (extra) => s('circle', { cx: 8, cy: 8, r: 6.2, style: `fill:none;stroke:currentColor;stroke-width:1.5;${extra || ''}` });
  switch (status) {
    case 'Backlog': return s('svg', { ...st, style: 'color:var(--faint)' }, ring('stroke-dasharray:2.2 2.2'));
    case 'Todo': return s('svg', { ...st, style: 'color:var(--muted)' }, ring());
    case 'In Progress': return s('svg', { ...st, style: 'color:var(--t-yellow)' }, ring(), s('path', { d: 'M8 4.2a3.8 3.8 0 0 1 0 7.6z', style: 'fill:currentColor' }));
    case 'Done': return s('svg', { ...st, style: 'color:var(--t-green)' }, s('circle', { cx: 8, cy: 8, r: 7, style: 'fill:currentColor' }), s('path', { d: 'M5 8.2 7 10.2 11 6', style: 'fill:none;stroke:var(--surface);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round' }));
    default: return s('svg', { ...st, style: 'color:var(--faint)' }, s('circle', { cx: 8, cy: 8, r: 7, style: 'fill:currentColor' }), s('path', { d: 'M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8', style: 'fill:none;stroke:var(--surface);stroke-width:1.6;stroke-linecap:round' }));
  }
}
/** Priority as three bars, filled to its level. */
function prioIcon(p) {
  const n = { Low: 1, Medium: 2, High: 3 }[p] || 0;
  return s('svg', { width: 14, height: 14, viewBox: '0 0 14 14', class: 'crm-prio', 'aria-hidden': 'true' },
    [0, 1, 2].map((i) => s('rect', { x: 1 + i * 4.5, y: 9 - i * 3.5, width: 3, height: 4 + i * 3.5, rx: 1, style: `fill:${i < n ? (n === 3 ? 'var(--t-red)' : 'var(--fg-2)') : 'var(--line-2)'}` })));
}
const taskStatus = (st) => h('span.crm-tst', taskIcon(st), st);
const prio = (p) => (p ? h('span.crm-tst', prioIcon(p), p) : h('span.faint', '—'));

/* ---------- records ---------- */

const leadName = (l) => [l.firstName, l.lastName].filter(Boolean).join(' ') || l.org || l.email || l.name;
const companyName = (id) => COMPANY.get(id)?.name || id || '';
const contactName = (id) => CONTACT.get(id)?.name || id || '';
const primaryOf = (deal) => CONTACT.get((deal.contacts || []).find((c) => c.primary)?.contact || deal.contacts?.[0]?.contact) || null;
const dealTitle = (d) => companyName(d.company) || d.title;
const recKind = (rec) => (String(rec.name || '').startsWith('CRM-LEAD') ? 'lead' : 'deal');
const recTitle = (rec) => (recKind(rec) === 'lead' ? leadName(rec) : dealTitle(rec));
const recRoute = (name) => (String(name).startsWith('CRM-LEAD') ? 'lead' : String(name).startsWith('CRM-DEAL') ? 'deal' : 'contact');
const recLabel = (name) => { const l = C.leads.find((x) => x.name === name); if (l) return `${leadName(l)}${l.org ? ', ' + l.org : ''}`; const d = C.deals.find((x) => x.name === name); if (d) return dealTitle(d); return contactName(name); };
/** Everything on a record's timeline; a deal's starts with its lead's. */
function itemsOf(rec) {
  const own = TL.get(rec.name || rec.id) || [];
  const lead = rec.lead ? TL.get(rec.lead) || [] : [];
  return [...lead, ...own].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
function modifiedOf(rec) {
  let m = rec.modifiedAt || rec.createdAt || '';
  for (const it of TL.get(rec.name || rec.id) || []) if (it.at > m) m = it.at;
  return m || null;
}
const leadsOfContact = (id) => C.leads.filter((l) => l.contact === id);
const dealsOfContact = (id) => C.deals.filter((d) => (d.contacts || []).some((c) => c.contact === id));
const dealsOfCompany = (id) => C.deals.filter((d) => d.company === id);
const contactsOfCompany = (id) => C.contacts.filter((c) => c.company === id);
function contactModified(c) {
  let m = c.createdAt || '';
  for (const r of [...leadsOfContact(c.id), ...dealsOfContact(c.id)]) { const x = modifiedOf(r); if (x && x > m) m = x; }
  for (const it of TL.get(c.id) || []) if (it.at > m) m = it.at;
  return m || null;
}
function companyModified(co) {
  let m = '';
  for (const r of [...C.leads.filter((l) => l.company === co.id), ...dealsOfCompany(co.id)]) { const x = modifiedOf(r); if (x && x > m) m = x; }
  return m || null;
}
/** How Capxul knows a person: on Capxul (a handle), by mailbox (money waits in escrow), or private. */
function capxulOf(c) {
  if (!c) return { word: 'Private', tone: 'gray', line: 'Not linked. Link to pay.' };
  if (c.onCapxul && c.handle) return { word: c.handle, tone: 'green', line: `On Capxul as ${c.handle}.` };
  if (c.email) return { word: 'By mailbox', tone: 'blue', line: 'Known by mailbox. Can be paid; the money waits in escrow until they claim it with payment claim.' };
  return { word: 'Private', tone: 'gray', line: 'Not linked. Link to pay.' };
}
const companyCapxul = (co) => (co?.onCapxul ? { word: co.handle, tone: 'green' } : { word: 'Private', tone: 'gray' });
const counts = (items) => ({ email: items.filter((i) => i.kind === 'email').length, note: items.filter((i) => i.kind === 'note').length, task: items.filter((i) => i.kind === 'task').length, call: items.filter((i) => i.kind === 'call').length, whatsapp: items.filter((i) => i.kind === 'whatsapp').length });

/* =====================================================================================================
   Styles (tokens only)
   ===================================================================================================== */

cx.style('crm', `
.crm-sq { border-radius: 5px; }
.avatar.xl { width: 46px; height: 46px; font-size: 16px; }
.crm-when { color: var(--faint); font-size: 12px; white-space: nowrap; }
.crm-name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.crm-name > a, .crm-name > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crm-tst { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.crm-tico, .crm-prio { flex: none; }
.crm-views { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
.crm-views > * { min-width: 0; max-width: 100%; }
.crm-views .grow { flex: 1; }
.crm-rec { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 14px; align-items: start; min-width: 0; }
@media (max-width: 980px) { .crm-rec { grid-template-columns: minmax(0, 1fr); } .crm-rec > .crm-side { order: -1; } }
.crm-rec.left { grid-template-columns: 330px minmax(0, 1fr); }
@media (max-width: 980px) { .crm-rec.left { grid-template-columns: minmax(0, 1fr); } }
.crm-main { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); min-width: 0; }
.crm-side { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); min-width: 0; font-size: 13px; position: sticky; top: calc(var(--topbar-h) + var(--safe-t) + 12px); }
@media (max-width: 980px) { .crm-side { position: static; } }
.crm-id { display: flex; align-items: center; gap: 6px; width: 100%; padding: 9px 14px; border: 0; border-bottom: 1px solid var(--line); background: none; color: var(--muted); font: 12px/1.4 var(--font-mono); cursor: pointer; text-align: left; }
.crm-id:hover { color: var(--fg); }
.crm-id .ic { width: 13px; height: 13px; margin-left: auto; }
.crm-head { display: grid; gap: 10px; padding: 14px; border-bottom: 1px solid var(--line); }
.crm-head-top { display: flex; gap: 12px; align-items: center; min-width: 0; }
.crm-head-top h2 { font: 600 16px/1.25 var(--font-ui); font-stretch: var(--wide); overflow-wrap: anywhere; }
.crm-head-top .muted { font-size: 12.5px; overflow-wrap: anywhere; }
.crm-quick { display: flex; flex-wrap: wrap; gap: 6px; }
.crm-quick .btn { width: 32px; padding: 0; justify-content: center; }
.crm-sec { border-bottom: 1px solid var(--line); }
.crm-sec:last-child { border-bottom: 0; }
.crm-sec-h { display: flex; align-items: center; gap: 4px; padding: 4px 8px 4px 4px; }
.crm-sec-t { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; padding: 6px 10px; border: 0; background: none; cursor: pointer; font: 600 13px/1.3 var(--font-ui); color: var(--fg); text-align: left; }
.crm-sec-t .ic { width: 13px; height: 13px; color: var(--muted); transition: transform .15s; }
.crm-sec-t[aria-expanded="false"] .ic { transform: rotate(-90deg); }
.crm-sec-b { display: grid; gap: 2px; padding: 0 10px 12px; }
.crm-f { display: grid; grid-template-columns: minmax(0, 38%) minmax(0, 1fr); gap: 8px; align-items: center; min-height: 30px; }
.crm-f-l { color: var(--muted); font-size: 12.5px; padding-left: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crm-f-v { min-width: 0; padding: 5px 6px; border-radius: 4px; overflow-wrap: anywhere; font-size: 13px; text-align: left; border: 1px solid transparent; background: none; color: var(--fg); font-family: inherit; }
button.crm-f-v { cursor: text; width: 100%; }
button.crm-f-v:hover { background: var(--hover); border-color: var(--line); }
.crm-f .finput { height: 30px; font-size: 13px; }
.crm-f-cap { display: grid; gap: 4px; padding: 8px; margin: 2px 4px 6px; border-radius: var(--r); background: var(--accent-soft); color: var(--fg-2); font-size: 12.5px; }
.crm-f-cap b { color: var(--fg); }
.crm-pc { border: 1px solid var(--line); border-radius: var(--r); margin: 0 4px 6px; }
.crm-pc-h { display: flex; align-items: center; gap: 8px; padding: 7px 8px; min-width: 0; }
.crm-pc-h .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.crm-pc-b { display: grid; gap: 3px; padding: 0 10px 9px 36px; font-size: 12.5px; color: var(--fg-2); overflow-wrap: anywhere; }
.crm-tabhead { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 14px 4px; }
.crm-tabhead h3 { font: 600 15px/1.3 var(--font-ui); flex: 1; }
.crm-tabbody { padding: 6px 14px 16px; min-width: 0; }
.crm-acts { position: relative; display: grid; min-width: 0; }
.crm-act { position: relative; display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; padding: 7px 0; min-width: 0; }
.crm-act::before { content: ""; position: absolute; left: 14.5px; top: 0; bottom: 0; width: 1px; background: var(--line); }
.crm-act:first-child::before { top: 18px; }
.crm-act:last-child::before { bottom: calc(100% - 18px); }
.crm-act-ic { position: relative; z-index: 1; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--surface); border: 1px solid var(--line); color: var(--muted); }
.crm-act-ic .ic { width: 14px; height: 14px; }
.crm-act-ic.k-dot { border: 0; background: transparent; }
.crm-act-ic.k-dot::after { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--line-2); box-shadow: 0 0 0 3px var(--surface); }
.crm-act-ic.k-email { color: var(--t-blue); } .crm-act-ic.k-whatsapp { color: var(--t-green); } .crm-act-ic.k-call { color: var(--t-purple); }
.crm-act-ic.k-note { color: var(--t-yellow); } .crm-act-ic.k-task { color: var(--t-teal); } .crm-act-ic.k-money { color: var(--accent); border-color: var(--accent); }
.crm-act-ic.k-missed { color: var(--t-red); border-color: var(--t-red); }
.crm-act-ic .avatar { width: 30px; height: 30px; font-size: 11px; }
.crm-act-main { display: grid; gap: 7px; min-width: 0; padding-top: 5px; }
.crm-act-line { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: baseline; font-size: 13px; color: var(--fg-2); min-width: 0; }
.crm-act-line b { color: var(--fg); font-weight: 600; }
.crm-act-line .crm-when { margin-left: auto; }
.crm-act-line .dot { font-weight: 500; color: var(--fg); }
.crm-card { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); padding: 10px 12px; display: grid; gap: 7px; min-width: 0; font-size: 13px; }
.crm-card.click { cursor: pointer; }
.crm-card.click:hover { border-color: var(--line-2); }
.crm-mail-head { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; min-width: 0; }
.crm-mail-head .grow { flex: 1; }
.crm-mail-to { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.crm-mail-subj { font-weight: 600; overflow-wrap: anywhere; }
.crm-mail-body { white-space: pre-wrap; color: var(--fg-2); line-height: 1.55; overflow-wrap: anywhere; }
.crm-mail-body.clamp { display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.crm-more { border: 0; background: none; padding: 0; color: var(--link); cursor: pointer; font-size: 12.5px; justify-self: start; }
.crm-att { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 4px; font-size: 12px; background: var(--surface-2); max-width: 100%; }
.crm-att span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crm-att small { color: var(--muted); }
.crm-mail-foot { display: flex; flex-wrap: wrap; gap: 6px; }
.crm-call-h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.crm-call-h .grow { flex: 1; }
.crm-badge { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 10px; background: var(--sunk); color: var(--fg-2); font-size: 11.5px; white-space: nowrap; }
.crm-call-who { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--muted); font-size: 12.5px; }
.crm-wa { display: grid; gap: 6px; }
.crm-bub { max-width: min(78%, 520px); padding: 7px 10px 5px; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--line); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; justify-self: start; }
.crm-bub.out { justify-self: end; background: var(--accent-soft); border-color: transparent; }
.crm-bub small { display: block; text-align: right; color: var(--faint); font-size: 11px; margin-top: 2px; }
.crm-wa-day { justify-self: center; font-size: 11.5px; color: var(--muted); background: var(--sunk); padding: 1px 8px; border-radius: 9px; margin: 6px 0 2px; }
.crm-wa-box { display: grid; gap: 8px; border-top: 1px solid var(--line); padding: 12px 14px; }
.crm-chg { display: grid; gap: 4px; padding: 6px 0 0; font-size: 12.5px; color: var(--fg-2); }
.crm-compose { border-top: 1px solid var(--line); padding: 12px 14px; display: grid; gap: 10px; }
.crm-compose .row2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 640px) { .crm-compose .row2 { grid-template-columns: minmax(0, 1fr); } }
.crm-btnrow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.crm-btnrow .grow { flex: 1; }
.crm-trow { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 4px; border-bottom: 1px solid var(--line); cursor: pointer; }
.crm-trow:hover { background: var(--hover); }
.crm-trow .meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--muted); }
.crm-trow .ttl { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crm-notes { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); }
.crm-note { display: grid; gap: 8px; align-content: start; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface); cursor: pointer; min-height: 150px; min-width: 0; }
.crm-note:hover { border-color: var(--line-2); }
.crm-note h4 { font: 600 13.5px/1.35 var(--font-ui); overflow-wrap: anywhere; }
.crm-note p { font-size: 12.5px; color: var(--fg-2); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.crm-note footer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin-top: auto; }
.crm-note footer .grow { flex: 1; }
.crm-kb-counts { display: flex; gap: 10px; color: var(--muted); font-size: 12px; }
.crm-kb-counts span { display: inline-flex; align-items: center; gap: 3px; }
.crm-kb-counts .ic { width: 12px; height: 12px; }
.kb-meta.crm-kbm { display: grid; gap: 3px; color: var(--muted); font-size: 12.5px; min-width: 0; }
.kb-meta.crm-kbm > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.crm-grp td { background: var(--surface-2); font-weight: 600; }
.crm-grp button { display: inline-flex; align-items: center; gap: 8px; border: 0; background: none; padding: 0; cursor: pointer; font: inherit; color: inherit; }
.crm-grp button .ic { width: 13px; height: 13px; color: var(--muted); transition: transform .15s; }
.crm-grp button[aria-expanded="false"] .ic { transform: rotate(-90deg); }
.crm-grp small { color: var(--muted); font-weight: 500; margin-left: 4px; }
.crm-dash-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.crm-dash-bar label { display: grid; gap: 2px; font-size: 11.5px; color: var(--muted); }
.crm-msec { grid-column: 1 / -1; font: 600 12px/1.3 var(--font-ui); letter-spacing: .05em; text-transform: uppercase; color: var(--faint); padding-top: 4px; }
.crm-toggle { display: flex; align-items: center; justify-content: space-between; gap: 10px; grid-column: 1 / -1; }
.crm-lost { font-size: 13.5px; color: var(--fg-2); }
.crm-money-k { display: grid; gap: 6px; }
.crm-pipe { height: 6px; border-radius: 3px; background: var(--sunk); overflow: hidden; min-width: 60px; }
.crm-pipe i { display: block; height: 100%; background: var(--accent); }
.crm-sel { display: inline-flex; align-items: center; gap: 6px; }
.btn[hidden], .pill[hidden] { display: none !important; }
.crm-dash > .wide { grid-column: 1 / -1; }
.crm-pc-b[hidden], .crm-sec-b[hidden], .crm-chg[hidden], .crm-compose[hidden] { display: none !important; }
`);

/* =====================================================================================================
   Workspace and search
   ===================================================================================================== */

const openTasksFor = (id) => C.tasks.filter((t) => t.assignedTo === id && ['Backlog', 'Todo', 'In Progress'].includes(t.status)).length;
cx.workspace({
  id: 'crm', label: 'CRM', icon: 'crm', route: 'crm',
  badge: () => openTasksFor(cx.meId()) || null,
  nav: [
    { label: 'Dashboard', route: 'crm' },
    { label: 'Leads', route: 'leads', match: ['lead', 'leads-kanban', 'leads-grouped'] },
    { label: 'Deals', route: 'deals', match: ['deal', 'deals-kanban', 'deals-grouped'] },
    { label: 'Contacts', route: 'contacts', match: ['contact'] },
    { label: 'Companies', route: 'companies', match: ['company'] },
    { label: 'Notes', route: 'crm-notes' },
    { label: 'Tasks', route: 'crm-tasks', match: ['crm-tasks-kanban'] },
    { label: 'Call logs', route: 'call-logs' },
    { section: 'Public views', items: [{ label: 'Pipeline', route: 'pipeline' }] },
  ],
});

cx.search.add((qq, limit) => {
  const t = qq.toLowerCase();
  const out = [];
  const take = (arr, f) => { let n = 0; for (const x of arr) { if (n >= limit) break; const r = f(x); if (r) { out.push(r); n++; } } };
  take(C.leads, (l) => (!l.converted && `${leadName(l)} ${l.org || ''} ${l.name} ${l.email || ''}`.toLowerCase().includes(t) ? { kind: 'CRM leads', label: `${leadName(l)}${l.org ? ' · ' + l.org : ''}`, sub: `${l.name} · ${l.status}`, route: 'lead', id: l.name, icon: 'crm' } : null));
  take(C.deals, (d) => (`${d.title} ${d.name}`.toLowerCase().includes(t) ? { kind: 'CRM deals', label: d.title, sub: `${d.name} · ${d.status} · ${fmt.money(d.dealValue, d.currency, 0)}`, route: 'deal', id: d.name, icon: 'crm' } : null));
  take(C.contacts, (c) => (`${c.name} ${c.email || ''}`.toLowerCase().includes(t) ? { kind: 'CRM contacts', label: c.name, sub: [c.designation, companyName(c.company)].filter(Boolean).join(' · '), route: 'contact', id: c.id, icon: 'user' } : null));
  take(C.companies, (c) => (`${c.name} ${c.website || ''}`.toLowerCase().includes(t) ? { kind: 'CRM companies', label: c.name, sub: [c.industry, c.territory].filter(Boolean).join(' · '), route: 'company', id: c.id, icon: 'crm' } : null));
  take(C.tasks, (k) => (k.title.toLowerCase().includes(t) ? { kind: 'CRM tasks', label: k.title, sub: `${k.status} · ${cx.name(k.assignedTo)} · on ${recLabel(k.reference)}`, route: recRoute(k.reference), id: k.reference, icon: 'task' } : null));
  return out;
});

/* =====================================================================================================
   Shared parts: the form modal, the lost reason, moving a record, timeline items
   ===================================================================================================== */

/** The command block, as lines. */
function cmdBlock(spec) {
  const lines = [].concat(spec?.cli || spec || []).filter(Boolean);
  return lines.length ? h('div.confirm-cmd', lines.map((l, i) => [i ? '\n' : '', h('span.p', '$ '), l])) : null;
}
/**
 * A dialog of fields with a live command: formModal({ title, model, fields, cols, submit, needs, cmd(model), who,
 * check(model) → error text, onSubmit(model, close), wide, intro }).
 */
function formModal(o) {
  const m = o.model;
  const cmdBox = h('div');
  const drawCmd = () => { const spec = o.cmd?.(m); cx.fill(cmdBox, cmdBlock(spec)); if (spec) cx.showAction(spec, o.title); };
  const mk = (f) => {
    if (!f) return null;
    if (f instanceof Node) return f;
    if (f.section) return h('div.crm-msec', f.section);
    if (f.node) return h('div.field', { class: { wide: f.wide } }, h('label', f.label), f.node);
    return cx.field({ ...f, model: m, edit: !f.readOnly, onChange: (v, k) => { f.onChange?.(v, m); drawCmd(); } });
  };
  const body = h('div', { style: 'display:grid;gap:14px' },
    o.intro ? (o.intro instanceof Node ? o.intro : h('p.muted', { style: 'font-size:13px' }, o.intro)) : null,
    h('div.fields', { style: { '--cols': o.cols || 2 } }, o.fields.map(mk)),
    cmdBox,
    o.who ? h('div.muted', { style: 'font-size:12.5px' }, 'Who may run it: ' + o.who) : null);
  drawCmd();
  const md = cx.modal({
    title: o.title, wide: o.wide, body,
    onClose: () => cx.clearAction(),
    actions: [cx.btn('Cancel', { onClick: () => md.close() }), cx.btn(o.submit || 'Save', { kind: 'primary', needs: o.needs, onClick: async () => {
      for (const f of o.fields) if (f && f.reqd && !f.readOnly && f.key && (m[f.key] == null || m[f.key] === '')) { cx.toast(`${f.label} is required.`, { tone: 'warning' }); return; }
      const err = o.check?.(m); if (err) { cx.toast(err, { tone: 'warning' }); return; }
      await o.onSubmit(m, () => md.close(), o.cmd?.(m));
    } })],
  });
  return md;
}

/** The lost reason a lost status needs: resolves { reason, notes } or null. */
function askLostReason(kind, rec, to) {
  return new Promise((resolve) => {
    const m = { reason: '', notes: '' };
    let done = false;
    const cmd = () => `capxul org crm ${kind} move ${rec.name} ${q(to)} --reason ${q(m.reason || '<reason>')}${m.notes ? ` --notes ${q(m.notes)}` : ''}`;
    const box = h('div');
    const draw = () => cx.fill(box, cmdBlock(cmd()));
    const md = cx.modal({
      title: 'Lost reason',
      body: h('div', { style: 'display:grid;gap:12px' },
        h('p.crm-lost', `Please provide a reason for marking this ${kind} as lost.`),
        cx.field({ label: 'Lost reason', key: 'reason', model: m, edit: true, reqd: true, type: 'select', options: [['', 'Choose a reason'], ...C.lostReasons], onChange: draw }),
        cx.field({ label: 'Lost notes', key: 'notes', model: m, edit: true, type: 'textarea', placeholder: 'Add more details about why it was lost', onChange: draw }),
        box),
      onClose: () => { if (!done) resolve(null); },
      actions: [cx.btn('Cancel', { onClick: () => md.close() }), cx.btn('Save', { kind: 'primary', onClick: () => {
        if (!m.reason) { cx.toast('Choose a lost reason.', { tone: 'warning' }); return; }
        if (m.reason === 'Other' && !m.notes.trim()) { cx.toast('Other needs lost notes.', { tone: 'warning' }); return; }
        done = true; md.close(); resolve({ reason: m.reason, notes: m.notes.trim() });
      } })],
    });
    draw();
  });
}

/** Add an item to a record's timeline (and its own list). */
function addItem(recName, recordType, item) {
  const it = { id: newActId(), at: NOW(), by: cx.meId(), recordType, recordName: recName, ...item };
  C.timeline.push(it); indexTl(it);
  return it;
}
const recType = (kind) => (kind === 'lead' ? 'Lead' : kind === 'deal' ? 'Deal' : 'Contact');
/** Field changes as Frappe writes them: one line, or "Show +3 changes". */
function addChanges(kind, rec, changes) {
  if (!changes.length) return;
  const me = cx.name(cx.meId());
  if (changes.length === 1) { const [field, from, to] = changes[0]; addItem(rec.name, recType(kind), { kind: 'changed', field, from, to, text: `${me} changed ${field} from ${from ?? ''} to ${to}` }); }
  else addItem(rec.name, recType(kind), { kind: 'changes', changes, text: `Show +${changes.length} changes from ${me}` });
  rec.modifiedAt = NOW();
}
/** Move a lead or deal to a status (the lost ones ask for a reason). Resolves true when it moved. */
async function moveRecord(kind, rec, to) {
  const from = rec.status;
  if (from === to) return false;
  const allow = cx.allowed(NEED);
  if (!allow.ok) { cx.toast(allow.reason, { tone: 'warning' }); return false; }
  let lost = null;
  if (isLost(kind, to)) { lost = await askLostReason(kind, rec, to); if (!lost) return false; }
  const cmd = `capxul org crm ${kind} move ${rec.name} ${q(to)}${lost ? ` --reason ${q(lost.reason)}${lost.notes ? ` --notes ${q(lost.notes)}` : ''}` : ''}`;
  const changes = [['Status', from, to]];
  rec.status = to;
  if (kind === 'deal') {
    const p = stOf('deal', to).probability;
    if (p != null && rec.probability !== p) { changes.push(['Probability', rec.probability == null ? null : String(rec.probability), String(p)]); rec.probability = p; }
    if (to === 'Won') { rec.closedDate = TODAY; changes.push(['Closed Date', null, fmt.date(TODAY)]); }
  }
  if (lost) { rec.lostReason = lost.reason; rec.lostNotes = lost.notes || null; changes.push(['Lost Reason', null, lost.reason]); }
  addChanges(kind, rec, changes);
  cx.showAction(cmd, 'Move', { pin: true });
  cx.toast(`${recTitle(rec)} moved to ${to}`, { tone: 'success', cmd });
  return true;
}
/** The People hat's wearers, in a sentence, for locked controls. */
const lockLine = () => `Changes to the CRM need the People hat. ${namesList(peopleWearers())} ${peopleWearers().length === 1 ? 'wears' : 'wear'} it now.`;
/** For a member without the People hat: a quiet line and the FDE's offer to draft the change for a wearer. */
function readOnlyBanner(what) {
  if (cx.allowed(NEED).ok) return null;
  const forId = peopleWearers()[0];
  return cx.banner(h('span', `You can read ${what}. ${lockLine()}`), { tone: 'info', icon: 'lock', action: cx.btn('Ask the FDE to draft it', { sm: true, icon: 'fde', onClick: () => cx.fde.open({ ask: `I want to change ${what}. Draft the command for ${cx.name(forId)}, who wears the People hat.` }) }) });
}

/* =====================================================================================================
   The activity timeline (oldest first, as the CRM shows it; a toggle turns it round)
   ===================================================================================================== */

const EMPTY = { email: 'No emails found', call: 'No call history', note: 'No notes found', task: 'No tasks found', whatsapp: 'No WhatsApp messages found' };
const lineText = (it) => { const n = cx.name(it.by); const t = it.text || ''; return n && t.startsWith(n) ? t.slice(n.length).trimStart() : t; };
const durText = (sec) => { if (!sec) return '0s'; const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60; return hh ? `${hh}h ${mm}m` : `${mm}m ${ss}s`; };
function actRow(icon, line, card, o = {}) {
  return h('div.crm-act', h('div.crm-act-ic', { class: o.ic }, icon || null), h('div.crm-act-main', line ? h('div.crm-act-line', line) : null, card || null));
}
const valNode = (kind, field, v) => (field === 'Status' && v ? stDot(kind, v) : h('b', v == null || v === '' ? '—' : String(v)));
const noteRec = (it) => (it.note ? C.notes.find((n) => n.name === it.note) : C.notes.find((n) => n.reference === it.recordName && n.at === it.at && n.title === it.title)) || null;
const taskRec = (it) => (it.task ? C.tasks.find((t) => t.name === it.task) : C.tasks.find((t) => t.reference === it.recordName && t.at === it.at && t.title === it.title)) || null;
const callRec = (it) => (it.call ? C.calls.find((c) => c.name === it.call) : C.calls.find((c) => c.reference === it.recordName && c.at === it.at)) || it;

function emailCard(it, ctx) {
  const out = it.direction === 'out';
  const name = it.fromName || it.from;
  const body = h('div.crm-mail-body', it.body || '');
  const long = (it.body || '').split('\n').length > 7 || (it.body || '').length > 480;
  if (long) body.classList.add('clamp');
  const more = long ? h('button.crm-more', { type: 'button', onclick: () => { const c = body.classList.toggle('clamp'); more.textContent = c ? 'Show more' : 'Show less'; } }, 'Show more') : null;
  const card = h('div.crm-card',
    h('div.crm-mail-head', h('b', name), h('span.muted', { style: 'font-size:12px;overflow-wrap:anywhere' }, `<${it.from}>`), h('span.grow'), when(it.at)),
    h('div.crm-mail-to', 'To ', (it.to || []).join(', '), it.cc?.length ? ` · Cc ${it.cc.join(', ')}` : ''),
    h('div.crm-mail-subj', it.subject || '(no subject)'),
    body, more,
    it.attachments?.length ? h('div.chips', it.attachments.map((a) => h('span.crm-att', cx.icon('file', { size: 13 }), h('span', a.name), a.size ? h('small', a.size) : null))) : null,
    ctx?.compose ? h('div.crm-mail-foot',
      cx.btn('Reply', { sm: true, icon: 'send', needs: NEED, cmd: `capxul org crm email send ${ctx.rec.name} --in-reply-to ${it.id} --body-file reply.md --confirm`, onClick: () => ctx.compose.open({ replyTo: it }) }),
      cx.btn('Reply all', { sm: true, needs: NEED, cmd: `capxul org crm email send ${ctx.rec.name} --in-reply-to ${it.id} --body-file reply.md${(it.cc || []).map((c) => ' --cc ' + c).join('')} --confirm`, onClick: () => ctx.compose.open({ replyTo: it, all: true }) })) : null);
  return actRow(out && it.by ? cx.avatar(it.by) : extAvatar(name), null, card, { ic: 'k-email' });
}
function callCard(it, ctx) {
  const c = callRec(it);
  const outb = c.type === 'Outgoing';
  const missed = c.status !== 'Completed';
  const card = h('div.crm-card.click', { onclick: () => callModal(c) },
    h('div.crm-call-h', cx.icon(outb ? 'out' : 'in', { size: 14 }), h('b', outb ? 'Outbound call' : 'Inbound call'), cx.pill(c.status), h('span.grow'), h('span.crm-badge', fmt.date(c.at)), h('span.crm-badge', durText(c.duration))),
    h('div.crm-call-who', extAvatar(c.caller, { size: 'sm' }), c.caller, cx.icon('right', { size: 12 }), extAvatar(c.receiver, { size: 'sm' }), c.receiver),
    c.note ? h('div', { style: 'color:var(--fg-2);white-space:pre-wrap;overflow-wrap:anywhere' }, c.note) : null);
  const line = [h('b', c.caller), outb ? 'has made a call' : 'has reached out', when(c.at)];
  return actRow(cx.icon('phone'), line, card, { ic: missed ? 'k-missed' : 'k-call' });
}
function noteCard(it, ctx) {
  const n = noteRec(it) || it;
  const card = h('div.crm-card.click', { onclick: () => noteModal(ctx, n.name ? n : null, n) }, h('b', n.title), n.content ? h('div', { style: 'color:var(--fg-2);white-space:pre-wrap;overflow-wrap:anywhere' }, n.content) : null);
  return actRow(cx.icon('note'), [h('b', cx.name(it.by)), 'added a note', when(it.at)], card, { ic: 'k-note' });
}
function taskCard(it, ctx) {
  const t = taskRec(it) || it;
  const card = h('div.crm-card.click', { onclick: () => taskModal(ctx, t.name ? t : null) },
    h('div.crm-call-h', taskIcon(t.status), h('b', { style: 'overflow-wrap:anywhere' }, t.title)),
    h('div.crm-call-who', t.assignedTo ? cx.personChip(t.assignedTo, { link: false }) : h('span', 'Unassigned'), t.due ? h('span', '· due ', fmt.datetime(t.due)) : null, h('span', '·'), prio(t.priority), h('span', '·'), h('span', t.status)));
  return actRow(cx.icon('task'), [h('b', cx.name(it.by)), 'added a task', when(it.at)], card, { ic: 'k-task' });
}
function waBubble(it) {
  const out = it.direction === 'out';
  return h('div.crm-bub', { class: { out } }, it.template ? h('div.muted', { style: 'font-size:11.5px' }, `Template · ${it.template}`) : null, it.text, h('small', fmt.time(it.at), out ? ` · ${it.status || 'sent'}` : ''));
}
function waRow(it) {
  const out = it.direction === 'out';
  const line = out ? [h('b', it.by ? cx.name(it.by) : 'Harbourline'), 'sent a WhatsApp message', when(it.at)] : [h('b', it.fromName || it.from), 'sent a WhatsApp message', when(it.at)];
  return actRow(cx.icon('message'), line, h('div.crm-wa', waBubble(it)), { ic: 'k-whatsapp' });
}
function moneyCard(it, ctx) {
  const p = PAYMENT.get(it.payment);
  const esc = it.escrow ? D.money.escrows.find((e) => e.payment === it.payment) : null;
  const proofBox = h('div', { hidden: true });
  const toggle = p ? cx.btn('Show the proof', { sm: true, icon: 'shield', onClick: (e) => { proofBox.hidden = !proofBox.hidden; if (!proofBox.firstChild) proofBox.appendChild(cx.proof(p)); e.currentTarget.querySelector('span:last-child').textContent = proofBox.hidden ? 'Show the proof' : 'Hide the proof'; } }) : null;
  const card = h('div.crm-card',
    h('div.crm-call-h', h('b', { style: 'font-size:15px' }, fmt.usdc(it.amount)), cx.dir(it.direction === 'in' ? 'In' : 'Out'),
      esc ? cx.pill(esc.status === 'Open' ? 'Money waiting' : esc.status) : cx.pill('Settled', 'success'),
      h('span.grow'), it.invoice ? h('span', 'invoice ', cx.link(it.invoice, 'sales-invoice', it.invoice)) : esc?.what ? h('span.muted', esc.what) : null),
    cx.kv([
      p?.proof?.paymentId ? ['Payment ID', cx.hashChip(p.proof.paymentId, { kind: 'hash' })] : ['Payment', h('span.mono', it.payment)],
      ['Document hash', cx.hashChip(it.documentHash, { kind: 'hash' })],
      it.tx ? ['Transaction', h('span', cx.tx(it.tx), it.block ? ` · block ${fmt.int(it.block)}` : '')] : (p?.proof?.tx ? ['Transaction', h('span', cx.tx(p.proof.tx), p.proof.block ? ` · block ${fmt.int(p.proof.block)}` : '')] : null),
      ['On chain', fmt.utc(it.at)],
      esc ? ['Escrow', h('span', esc.status === 'Open' ? `Waiting for ${esc.email} to claim it since ${fmt.date(esc.fundedAt)}` : esc.status === 'Claimed' ? `Claimed ${fmt.datetime(esc.claimedAt)}` : `Taken back ${fmt.datetime(esc.takenBackAt)}`)] : null,
    ]),
    h('div.crm-btnrow', toggle, esc && esc.status === 'Open' ? takeBackBtn(esc, p) : null, p && cx.hasRoute('payment') ? cx.btn('Open the payment', { sm: true, href: ['payment', p.id] }) : null),
    proofBox);
  return actRow(cx.icon('shield'), [h('b', it.text.split(' · ')[0])], card, { ic: 'k-money' });
}
/** Take back money waiting in escrow, until it is claimed: whoever wears the budget's hat now approves. */
function takeBackBtn(esc, p) {
  const dept = esc.from;
  const signer = cx.holders(dept).find((x) => !String(x).startsWith('@')) || cx.meId();
  const cmd = `capxul payment cancel ${p?.proof?.paymentId || esc.payment} --org harbourline`;
  return cx.btn('Take it back', { sm: true, kind: 'danger', icon: 'swap', needs: { dept }, cmd, onClick: async () => {
    const r = await cx.approval({ title: `Take back ${fmt.usdc(esc.amount)} from ${esc.email}`, from: `Escrow ${fmt.addr(esc.escrowAddress)}`, to: `${cx.deptName(dept)} budget · Harbourline Treasury`, amount: esc.amount, asset: 'USDC', gbp: p?.gbp, rate: p?.rate, signer, hat: cx.deptName(dept), cmd, next: `capxul payment wait ${esc.payment}`, warnings: ['Nobody has claimed it yet. Once it is back, the claim link stops working.'] });
    if (r.status !== 'done') return;
    esc.status = 'Taken back'; esc.takenBackAt = r.at; esc.takenBackBy = cx.meId(); esc.takeBackTx = r.tx;
    if (p) p.status = 'Taken back';
    cx.toast(`${fmt.usdc(esc.amount)} is back in the ${cx.deptName(dept)} budget`, { tone: 'success', cmd });
    cx.refresh();
  } });
}
function changesRow(it, kind) {
  const name = cx.name(it.by);
  const n = it.changes.length;
  const list = h('div.crm-chg', { hidden: true }, it.changes.map(([f, a, b]) => h('div', h('b', f), a == null || a === '' ? [' added as ', valNode(kind, f, b)] : [' changed from ', valNode(kind, f, a), ' to ', valNode(kind, f, b)])));
  const btn = h('button.crm-more', { type: 'button', onclick: () => { list.hidden = !list.hidden; btn.textContent = list.hidden ? `Show +${n} changes from ${name}` : `Hide the ${n} changes`; } }, `Show +${n} changes from ${name}`);
  return actRow(null, [btn, when(it.at)], list, { ic: 'k-dot' });
}
function actItem(it, ctx) {
  const kind = it.recordType === 'Lead' ? 'lead' : 'deal';
  const who = it.by ? h('b', cx.name(it.by)) : null;
  switch (it.kind) {
    case 'creation': return actRow(cx.icon(kind === 'lead' ? 'user' : 'crm'), [who, lineText(it), it.source ? h('span.muted', `· source ${it.source}`) : null, when(it.at)]);
    case 'converted': return actRow(cx.icon('swap'), [who, ctx?.kind === 'lead' ? ['converted this lead to ', cx.link(it.deal, 'deal', it.deal)] : 'converted the lead to this deal', when(it.at)], null, { ic: 'k-task' });
    case 'changed': return actRow(null, it.from == null || it.from === '' ? [who, 'added', h('b', it.field), 'as', valNode(kind, it.field, it.to), when(it.at)] : [who, 'changed', h('b', it.field), 'from', valNode(kind, it.field, it.from), 'to', valNode(kind, it.field, it.to), when(it.at)], null, { ic: 'k-dot' });
    case 'changes': return changesRow(it, kind);
    case 'email': return emailCard(it, ctx);
    case 'call': return callCard(it, ctx);
    case 'note': return noteCard(it, ctx);
    case 'task': return taskCard(it, ctx);
    case 'whatsapp': return waRow(it);
    case 'money': return moneyCard(it, ctx);
    default: return actRow(null, [who, it.text || it.kind, when(it.at)], null, { ic: 'k-dot' });
  }
}
function activityList(rec, filter, ctx) {
  let items = itemsOf(rec);
  if (filter) items = items.filter((i) => i.kind === filter);
  if (cx.store.get('crm-order', 'asc') === 'desc') items = [...items].reverse();
  if (!items.length) return cx.empty(EMPTY[filter] || 'No activity yet');
  return h('div.crm-acts', items.map((it) => actItem(it, ctx)));
}
const orderBtn = () => { const desc = cx.store.get('crm-order', 'asc') === 'desc'; return cx.btn(desc ? 'Newest first' : 'Oldest first', { sm: true, kind: 'ghost', icon: 'sort', title: 'Change the order', onClick: () => { cx.store.set('crm-order', desc ? 'asc' : 'desc'); cx.refresh(); } }); };

/* =====================================================================================================
   Writing on a record: email, WhatsApp, calls, notes, tasks (each with its command)
   ===================================================================================================== */

/** The email composer under the Activity and Emails tabs. */
function composer(ctx) {
  const root = h('div.crm-compose');
  const closed = () => cx.fill(root, h('div.crm-btnrow',
    cx.btn('Reply', { icon: 'mail', needs: NEED, cmd: `capxul org crm email send ${ctx.rec.name} --subject "…" --body-file reply.md --confirm`, onClick: () => api.open({}) }),
    h('span.muted', { style: 'font-size:12.5px' }, ctx.toEmail ? `Emails go from the CRM mailbox to ${ctx.toEmail} and land on this timeline.` : 'This record has no email address yet.')));
  const api = {
    el: root,
    open(o = {}) {
      if (!cx.allowed(NEED).ok) { cx.toast(lockLine(), { tone: 'warning' }); return; }
      const last = o.replyTo || [...itemsOf(ctx.rec)].reverse().find((i) => i.kind === 'email');
      const replyTo = o.replyTo || null;
      const m = {
        to: replyTo ? (replyTo.direction === 'in' ? replyTo.from : (replyTo.to || [])[0]) : ctx.toEmail || '',
        cc: o.all && replyTo?.cc?.length ? replyTo.cc.join(', ') : '',
        subject: last ? (/^re:/i.test(last.subject) ? last.subject : 'Re: ' + last.subject) : '', body: '',
      };
      const cmd = () => `capxul org crm email send ${ctx.rec.name} ${replyTo ? `--in-reply-to ${replyTo.id}` : `--subject ${q(m.subject || '…')}`} --body-file reply.md${m.to && m.to !== ctx.toEmail ? ` --to ${m.to}` : ''}${m.cc ? m.cc.split(/[,\s]+/).filter(Boolean).map((c) => ' --cc ' + c).join('') : ''} --confirm`;
      const cmdBox = h('div');
      const draw = () => { cx.fill(cmdBox, cmdBlock(cmd())); cx.showAction(cmd(), 'Send an email', { pin: true }); };
      const f = (spec) => cx.field({ ...spec, model: m, edit: true, onChange: draw });
      cx.fill(root,
        h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('b', replyTo ? 'Reply' : 'New email'), h('span.muted', { style: 'font-size:12.5px' }, `from ${cx.me().name} <${memberEmail(cx.meId())}>`)),
        h('div.row2', f({ label: 'To', key: 'to' }), f({ label: 'Cc', key: 'cc', placeholder: 'Optional' })),
        f({ label: 'Subject', key: 'subject' }),
        f({ label: 'Message', key: 'body', type: 'textarea', rows: 6, placeholder: 'Write your email' }),
        cmdBox,
        h('div.crm-btnrow', cx.btn('Send', { kind: 'primary', icon: 'send', needs: NEED, onClick: () => {
          if (!m.to || !m.body.trim()) { cx.toast('Add who it goes to and a message.', { tone: 'warning' }); return; }
          if (!m.subject.trim()) { cx.toast('Add a subject.', { tone: 'warning' }); return; }
          sendPreview({ title: 'Send this email?', rows: [['From', `${cx.me().name} at Harbourline <${memberEmail(cx.meId())}>`], ['To', m.to], m.cc ? ['Cc', m.cc] : null, ['Subject', m.subject]], body: m.body, cmd: cmd(), onSend: () => {
            addItem(ctx.rec.name, recType(ctx.kind), { kind: 'email', direction: 'out', from: memberEmail(cx.meId()), fromName: cx.me().name, to: [m.to], cc: m.cc ? m.cc.split(/[,\s]+/).filter(Boolean) : [], subject: m.subject, body: m.body, attachments: [], inReplyTo: replyTo?.id || null });
            ctx.rec.modifiedAt = NOW();
            cx.toast(`Email sent to ${m.to}`, { tone: 'success', cmd: cmd() });
            cx.refresh();
          } });
        } }), cx.btn('Discard', { kind: 'ghost', onClick: () => { cx.clearAction(); closed(); } }), h('span.grow'), h('span.muted', { style: 'font-size:12px' }, 'You answer a preview before it goes.')));
      draw();
      root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => root.querySelector('textarea')?.focus(), 60);
    },
  };
  closed();
  return api;
}
/** The preview a send answers (the command ends in --confirm). */
function sendPreview(o) {
  const md = cx.modal({ title: o.title, body: h('div', { style: 'display:grid;gap:12px' },
    h('div.sheet', o.rows.filter(Boolean).map(([k, v]) => h('div.sheet-row', h('span', k), h('span', v)))),
    o.body ? h('div.crm-card', h('div.crm-mail-body', o.body)) : null,
    cmdBlock(o.cmd),
    h('p.muted', { style: 'font-size:12.5px' }, 'The FDE can draft a send, but only you can answer its preview.')),
  actions: [cx.btn('Back', { onClick: () => md.close() }), cx.btn('Send', { kind: 'primary', icon: 'send', onClick: () => { md.close(); o.onSend(); } })] });
}
function callModal(c) {
  const rec = c.reference;
  cx.modal({ title: `${c.type === 'Outgoing' ? 'Outbound' : 'Inbound'} call`, body: h('div', { style: 'display:grid;gap:12px' },
    cx.kv([
      ['Type', c.type], ['Status', cx.pill(c.status)], ['Duration', durText(c.duration)],
      ['Caller', c.caller], ['Receiver', c.receiver],
      ['From', c.type === 'Outgoing' ? HL_PHONE : numberOf(c.caller, rec)], ['To', c.type === 'Outgoing' ? numberOf(c.receiver, rec) : HL_PHONE],
      ['Started', fmt.datetime(c.at)], ['Telephony medium', 'Manual'],
      rec ? ['Record', cx.link(recLabel(rec), recRoute(rec), rec)] : null,
    ]),
    c.note ? h('div.crm-card', h('b', 'Note'), h('div', { style: 'white-space:pre-wrap;color:var(--fg-2)' }, c.note)) : null,
    cmdBlock(`capxul org crm timeline ${rec} --kind call`)), actions: [{ label: 'Close', primary: true }] });
}
function numberOf(personName, rec) {
  const ct = C.contacts.find((c) => c.name === personName); if (ct?.mobile) return ct.mobile;
  const l = C.leads.find((x) => leadName(x) === personName); if (l?.mobile) return l.mobile;
  const r = C.leads.find((x) => x.name === rec); return r?.mobile || '—';
}
function logCallModal(ctx) {
  const m = { type: 'Outgoing', status: 'Completed', number: ctx.mobile || '', start: `${TODAY}T10:30`, minutes: 15, note: '' };
  const startInput = h('input.finput', { type: 'datetime-local', value: m.start, oninput: (e) => { m.start = e.target.value; } });
  formModal({
    title: 'Log a call', model: m, needs: NEED, submit: 'Log the call', who: 'whoever wears the People hat',
    intro: 'Capxul has no telephony: a call you made or took on your phone is logged by hand.',
    fields: [
      { label: 'Type', key: 'type', type: 'select', options: ['Outgoing', 'Incoming'] },
      { label: 'Status', key: 'status', type: 'select', options: ['Completed', 'No Answer', 'Busy', 'Failed', 'Canceled'] },
      { label: 'Number', key: 'number' },
      { label: 'Started', node: startInput },
      { label: 'Duration (minutes)', key: 'minutes', type: 'int' },
      { label: 'Note', key: 'note', type: 'textarea', wide: true, placeholder: 'What was said' },
    ],
    cmd: (x) => `capxul org crm call log ${ctx.rec.name} --type ${x.type.toLowerCase()} --status ${x.status.toLowerCase().replace(/ /g, '-')}${x.number ? ` --number ${q(x.number)}` : ''} --start ${x.start} --duration ${Math.round((+x.minutes || 0) * 60)}${x.note ? ` --note ${q(x.note)}` : ''}`,
    onSubmit: (x, close, cmd) => {
      const me = cx.me().name, other = ctx.personName || ctx.name;
      const at = new Date(x.start + ':00Z').toISOString().replace(/\.\d{3}Z$/, 'Z');
      const name = nextName('CALL-', C.calls.map((c) => c.name));
      const rec = { name, type: x.type, status: x.status, duration: x.status === 'Completed' ? Math.round((+x.minutes || 0) * 60) : 0, caller: x.type === 'Outgoing' ? me : other, receiver: x.type === 'Outgoing' ? other : me, note: x.note || null, at, by: cx.meId(), reference: ctx.rec.name, referenceType: recType(ctx.kind) };
      C.calls.push(rec);
      addItem(ctx.rec.name, recType(ctx.kind), { kind: 'call', call: name, type: rec.type, status: rec.status, duration: rec.duration, caller: rec.caller, receiver: rec.receiver, note: rec.note, at });
      close(); cx.toast('Call logged', { tone: 'success', cmd }); cx.refresh();
    },
  });
}
function noteModal(ctx, note, shown) {
  const n = note || shown;
  if (n && !cx.allowed(NEED).ok) {
    cx.modal({ title: n.title, body: h('div', { style: 'display:grid;gap:10px' }, h('div', { style: 'white-space:pre-wrap;color:var(--fg-2)' }, n.content || ''), h('div.muted', { style: 'font-size:12.5px' }, `${cx.name(n.by)} · ${fmt.datetime(n.at)}`), cx.banner(lockLine(), { tone: 'info', icon: 'lock' })), actions: [{ label: 'Close', primary: true }] });
    return;
  }
  const m = { title: n?.title || '', content: n?.content || '' };
  const recName = ctx?.rec?.name || n?.reference;
  formModal({
    title: note ? 'Edit note' : 'New note', model: m, cols: 1, needs: NEED, submit: note ? 'Update' : 'Create', who: 'whoever wears the People hat',
    fields: [{ label: 'Title', key: 'title', reqd: true, placeholder: 'Call with John Doe' }, { label: 'Content', key: 'content', type: 'textarea', rows: 7, placeholder: 'Took a call with John Doe and discussed the new project.' }],
    cmd: (x) => (note ? `capxul org crm note change ${note.name} --title ${q(x.title)} --content ${q(x.content)}` : `capxul org crm note add ${recName} ${q(x.title || '<title>')}${x.content ? ` --content ${q(x.content)}` : ''}`),
    onSubmit: (x, close, cmd) => {
      if (note) {
        const it = C.timeline.find((t) => t.kind === 'note' && (t.note === note.name || (t.recordName === note.reference && t.at === note.at && t.title === note.title)));
        note.title = x.title; note.content = x.content; if (it) { it.title = x.title; it.content = x.content; }
      } else {
        const name = nextName('note_', C.notes.map((y) => y.name), 0);
        const at = NOW();
        const kind = recRoute(recName);
        C.notes.push({ name, title: x.title, content: x.content, by: cx.meId(), at, reference: recName, referenceType: kind === 'lead' ? 'Lead' : 'Deal' });
        addItem(recName, kind === 'lead' ? 'Lead' : 'Deal', { kind: 'note', note: name, title: x.title, content: x.content, at });
      }
      close(); cx.toast(note ? 'Note updated' : 'Note added', { tone: 'success', cmd }); cx.refresh();
    },
  });
}
const dueInput = (m) => h('input.finput', { type: 'datetime-local', value: m.due || '', oninput: (e) => { m.due = e.target.value; } });
function taskModal(ctx, task, preset = {}) {
  const t = task;
  const canMove = t ? cx.wears('People') || t.assignedTo === cx.meId() : cx.wears('People');
  const canEdit = cx.wears('People');
  const recName = ctx?.rec?.name || t?.reference || preset.reference || '';
  const m = { title: t?.title || '', description: t?.description || '', status: t?.status || preset.status || 'Todo', assignedTo: t?.assignedTo || cx.meId(), due: t?.due ? t.due.slice(0, 16) : '', priority: t?.priority || 'Medium', reference: recName };
  const recOpts = recordOptions();
  const fields = [
    { label: 'Title', key: 'title', reqd: true, wide: true, readOnly: !!t && !canEdit, placeholder: 'Call with John Doe' },
    { label: 'Description', key: 'description', type: 'textarea', wide: true, readOnly: !!t && !canEdit, placeholder: 'Took a call with John Doe and discussed the new project.' },
    !ctx?.rec && !t ? { label: 'Record', key: 'reference', type: 'select', options: recOpts, wide: true } : null,
    { label: 'Status', key: 'status', type: 'select', options: t ? TASK_ST : ['Backlog', 'Todo'], readOnly: !!t && !canMove },
    { label: 'Assigned to', key: 'assignedTo', type: 'select', options: members().map((id) => [id, cx.name(id)]), readOnly: !!t && !canEdit, render: (d) => cx.personChip(d.assignedTo, { link: false }) },
    { label: 'Due date', node: dueInput(m) },
    { label: 'Priority', key: 'priority', type: 'select', options: PRIORITIES, readOnly: !!t && !canEdit },
  ];
  const cmd = (x) => {
    if (!t) return `capxul org crm task create ${x.reference || '<record>'} ${q(x.title || '<title>')} --assigned-to ${memberEmail(x.assignedTo)}${x.due ? ` --due ${x.due}` : ''} --priority ${x.priority.toLowerCase()} --status ${x.status.toLowerCase()}${x.description ? ` --description ${q(x.description)}` : ''}`;
    const lines = [];
    const flags = [];
    if (x.title !== t.title) flags.push(`--title ${q(x.title)}`);
    if (x.assignedTo !== t.assignedTo) flags.push(`--assigned-to ${memberEmail(x.assignedTo)}`);
    if ((x.due || '') !== (t.due ? t.due.slice(0, 16) : '')) flags.push(x.due ? `--due ${x.due}` : '--clear due');
    if (x.priority !== t.priority) flags.push(`--priority ${x.priority.toLowerCase()}`);
    if (x.description !== (t.description || '')) flags.push(`--description ${q(x.description)}`);
    if (flags.length) lines.push(`capxul org crm task change ${t.name} ${flags.join(' ')}`);
    if (x.status !== t.status) lines.push(`capxul org crm task move ${t.name} ${q(x.status)}`);
    return lines.length ? lines : [`capxul org crm task change ${t.name}`];
  };
  formModal({
    title: t ? t.title : 'New task', model: m, needs: t ? (canMove || canEdit ? null : NEED) : NEED, submit: t ? 'Update' : 'Create', who: t ? 'whoever wears the People hat; the assignee moves their own task' : 'whoever wears the People hat',
    intro: t ? h('div.muted', { style: 'font-size:12.5px' }, `${t.name} · on `, cx.link(recLabel(t.reference), recRoute(t.reference), t.reference), ` · added by ${cx.name(t.by)} ${fmt.agoLong(t.at)}`) : null,
    fields, cmd,
    check: (x) => (!t && !x.reference ? 'Choose the lead or deal this task is for.' : null),
    onSubmit: (x, close, spec) => {
      if (!t) {
        const name = nextName('CRM-TASK-', C.tasks.map((y) => y.name));
        const at = NOW();
        const rec = { name, title: x.title, description: x.description, status: x.status, priority: x.priority, assignedTo: x.assignedTo, due: x.due ? x.due + ':00Z' : null, at, by: cx.meId(), reference: x.reference, referenceType: recRoute(x.reference) === 'lead' ? 'Lead' : 'Deal' };
        C.tasks.push(rec);
        addItem(x.reference, rec.referenceType, { kind: 'task', task: name, title: rec.title, description: rec.description, status: rec.status, priority: rec.priority, assignedTo: rec.assignedTo, due: rec.due, at });
      } else {
        Object.assign(t, { title: x.title, description: x.description, priority: x.priority, assignedTo: x.assignedTo, due: x.due ? x.due + ':00Z' : null });
        if (x.status !== t.status) { t.status = x.status; if (x.status === 'Done') t.doneAt = NOW(); }
        t.modifiedAt = NOW();
      }
      close(); cx.toast(t ? 'Task updated' : 'Task created', { tone: 'success', cmd: [].concat(spec)[0] }); cx.refresh();
    },
  });
}
/** Every open lead and deal, for pickers. */
function recordOptions() {
  return [['', 'Choose a lead or deal'],
    ...C.deals.filter((d) => !['Won', 'Lost'].includes(d.status)).map((d) => [d.name, `${d.name} · ${d.title}`]),
    ...C.leads.filter((l) => !l.converted && !isLost('lead', l.status)).map((l) => [l.name, `${l.name} · ${leadName(l)}${l.org ? ', ' + l.org : ''}`])];
}
const WA_TEMPLATES = [
  { name: 'follow_up', text: (n) => `Hi ${n}, following up on our conversation. Is there a good time to speak this week?` },
  { name: 'meeting_reminder', text: (n) => `Hi ${n}, a reminder of our meeting. Reply here if the time no longer works.` },
  { name: 'proposal_sent', text: (n) => `Hi ${n}, we've sent our proposal to your inbox. Happy to walk you through it.` },
];
/** The WhatsApp tab: the thread and the message box (a text inside the 24-hour window, else a template). */
function whatsappPane(ctx) {
  const msgs = itemsOf(ctx.rec).filter((i) => i.kind === 'whatsapp');
  const thread = h('div.crm-wa', { style: 'padding:6px 14px 14px' });
  let lastDay = '';
  for (const m of msgs) { const d = dayOf(m.at); if (d !== lastDay) { thread.appendChild(h('div.crm-wa-day', fmt.date(d))); lastDay = d; } thread.appendChild(waBubble(m)); }
  if (!msgs.length) thread.appendChild(cx.empty(ctx.mobile ? 'No WhatsApp messages found' : 'No mobile number'));
  if (!ctx.mobile) return h('div', thread, h('div.crm-wa-box', h('p.muted', 'Add a mobile number to send WhatsApp messages.')));
  const lastIn = [...msgs].reverse().find((x) => x.direction === 'in');
  const open = lastIn && Date.parse(NOW()) - Date.parse(lastIn.at) < 86400000;
  const first = (ctx.personName || ctx.name || '').split(' ')[0];
  const m = { text: '', template: WA_TEMPLATES[0].name };
  const cmd = () => (open ? `capxul org crm whatsapp send ${ctx.rec.name} --text ${q(m.text || '…')} --confirm` : `capxul org crm whatsapp send ${ctx.rec.name} --template ${m.template} --param ${q(first)} --confirm`);
  const cmdBox = h('div');
  const draw = () => cx.fill(cmdBox, cmdBlock(cmd()));
  const box = h('div.crm-wa-box',
    open ? null : cx.banner(`The last message from ${first || 'them'} is more than 24 hours old, so WhatsApp only takes an approved template now.`, { tone: 'info' }),
    open ? cx.field({ label: 'Message', key: 'text', model: m, edit: true, type: 'textarea', rows: 2, placeholder: 'Type your message', onChange: draw })
      : cx.field({ label: 'Template', key: 'template', model: m, edit: true, type: 'select', options: WA_TEMPLATES.map((t) => [t.name, `${t.name}: ${t.text(first)}`]), onChange: draw }),
    cmdBox,
    h('div.crm-btnrow', h('span.muted', { style: 'font-size:12.5px' }, `To ${ctx.mobile}, from Harbourline's WhatsApp number`), h('span.grow'),
      cx.btn('Send', { kind: 'primary', icon: 'send', needs: NEED, onClick: () => {
        const text = open ? m.text.trim() : WA_TEMPLATES.find((t) => t.name === m.template).text(first);
        if (!text) { cx.toast('Type a message first.', { tone: 'warning' }); return; }
        sendPreview({ title: 'Send this WhatsApp message?', rows: [['To', ctx.mobile], ['From', "Harbourline's WhatsApp number"], open ? null : ['Template', m.template]], body: text, cmd: cmd(), onSend: () => {
          addItem(ctx.rec.name, recType(ctx.kind), { kind: 'whatsapp', direction: 'out', from: 'Harbourline', to: ctx.mobile, text, template: open ? null : m.template, status: 'sent' });
          cx.toast('WhatsApp message sent', { tone: 'success', cmd: cmd() }); cx.refresh();
        } });
      } })));
  draw();
  return h('div', thread, box);
}

/* =====================================================================================================
   The side panel: inline fields, sections, people on a deal
   ===================================================================================================== */

const LEAD_FLAG = { firstName: '--first-name', lastName: '--last-name', email: '--email', mobile: '--mobile', jobTitle: '--job-title', org: '--company', website: '--website', industry: '--industry', territory: '--territory', employees: '--employees', source: '--source', owner: '--owner' };
const DEAL_FLAG = { probability: '--probability', dealValue: '--value', expectedDealValue: '--expected-value', currency: '--currency', expectedClosureDate: '--close-by', nextStep: '--next-step', owner: '--owner', source: '--source' };
const CO_FLAG = { name: '', description: '--description', industry: '--industry', employees: '--employees', website: '--website', territory: '--territory', annualRevenue: '--revenue', currency: '--currency' };
const flagVal = (k, v) => (k === 'owner' ? memberEmail(v) : q(v));
const EMPLOYEES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
const SOURCES = uniq([...C.leads.map((l) => l.source), ...C.deals.map((d) => d.source), 'Website', 'Reference', 'Existing Customer', 'Exhibition', 'Email', 'Campaign', 'Cold Calling', 'Advertisement']);
const INDUSTRIES = uniq([...C.companies.map((c) => c.industry), ...C.leads.map((l) => l.industry)]);
const TERRITORIES = uniq([...C.companies.map((c) => c.territory), ...C.leads.map((l) => l.territory)]);
const ownerOpts = () => members().map((id) => [id, cx.name(id)]);

/**
 * One field of the side panel. Click to edit (People hat); Enter or leaving the field saves it at once, with its
 * command, and the change lands on the timeline. d: { label, get, set, display, type, options, cmd(v), text(v), noTimeline }
 */
function sideField(d, o) {
  const canEdit = !d.readOnly && cx.allowed(NEED).ok;
  const v = d.get();
  const shown = d.display ? d.display(v) : v;
  const disp = shown == null || shown === '' ? h('span.faint', '—') : shown;
  const wrap = h('div.crm-f', h('div.crm-f-l', { title: d.label }, d.label));
  const val = canEdit ? h('button.crm-f-v', { type: 'button', title: 'Click to edit' }, disp) : h('div.crm-f-v', { title: d.readOnly ? null : lockLine() }, disp);
  wrap.appendChild(val);
  if (!canEdit) return wrap;
  val.addEventListener('click', () => {
    let input;
    if (d.type === 'select') input = h('select.finput', { 'aria-label': d.label }, [['', '—'], ...(typeof d.options === 'function' ? d.options() : d.options)].map((op) => { const [a, b] = Array.isArray(op) ? op : [op, op]; return h('option', { value: a, selected: String(a) === String(v ?? '') }, b); }));
    else input = h('input.finput', { 'aria-label': d.label, type: d.type === 'date' ? 'date' : d.type === 'number' ? 'number' : 'text', step: d.type === 'number' ? 'any' : null, value: v ?? '' });
    const read = () => (d.type === 'number' ? (input.value === '' ? null : +input.value) : input.value.trim());
    const pin = () => cx.showAction(d.cmd(read() ?? ''), `Change ${d.label}`, { pin: true });
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const nv = read();
      if (String(nv ?? '') === String(v ?? '')) { wrap.replaceChild(val, input); cx.clearAction(); return; }
      d.set(nv);
      if (!d.noTimeline) addChanges(o.kind, o.rec, [[d.field || d.label, v == null || v === '' ? null : (d.text ? d.text(v) : String(v)), nv == null || nv === '' ? '—' : (d.text ? d.text(nv) : String(nv))]]);
      cx.toast(`${d.label} saved`, { tone: 'success', cmd: d.cmd(nv ?? '') });
      cx.refresh();
    };
    input.addEventListener('input', pin);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.stopPropagation(); done = true; wrap.replaceChild(val, input); cx.clearAction(); } });
    if (d.type === 'select' || d.type === 'date') input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    wrap.replaceChild(input, val);
    input.focus(); pin();
  });
  return wrap;
}
function sideSec(title, kids, o = {}) {
  const key = 'crm-sec:' + (o.key || title);
  let open = cx.store.get(key, o.open ?? true);
  const body = h('div.crm-sec-b', kids);
  body.hidden = !open;
  const tog = h('button.crm-sec-t', { type: 'button', 'aria-expanded': String(open), onclick: () => { open = !open; tog.setAttribute('aria-expanded', String(open)); body.hidden = !open; cx.store.set(key, open); } }, cx.icon('down'), h('span', title), o.count != null ? h('small.muted', { style: 'font-weight:500' }, String(o.count)) : null);
  return h('section.crm-sec', h('div.crm-sec-h', tog, o.add || null), body);
}
const idBtn = (id) => h('button.crm-id', { type: 'button', title: 'Copy the ID', onclick: () => cx.copy(id) }, id, cx.icon('copy'));
function quickBtns(ctx, site) {
  return [
    cx.btn('', { icon: 'mail', title: 'Send an email', needs: NEED, sm: true, onClick: () => ctx.openEmail?.() }),
    site ? cx.btn('', { icon: 'globe', title: 'Go to website', sm: true, onClick: () => cx.toast(`Opens https://${site} in a new tab. The mock-up stays on this page.`, { tone: 'info' }) }) : null,
    cx.btn('', { icon: 'file', title: 'Attach a file', sm: true, onClick: () => cx.toast('Capxul names attachments on emails; it does not keep files in this version.', { tone: 'info' }) }),
  ];
}
function leadSide(l, ctx) {
  const o = { kind: 'lead', rec: l };
  const F = (key, label, x = {}) => sideField({ label, get: () => l[key], set: (v) => { l[key] = v; }, cmd: (v) => `capxul org crm lead change ${l.name} ${LEAD_FLAG[key]} ${flagVal(key, v)}`, ...x }, o);
  const ct = CONTACT.get(l.contact);
  const cap = l.converted && ct ? capxulOf(ct)
    : { line: 'A lead. Capxul names this person in its directory only once the lead is converted; until then Harbourline cannot pay them.' };
  return h('aside.crm-side',
    idBtn(l.name),
    h('div.crm-head', h('div.crm-head-top', extAvatar(leadName(l), { size: 'xl' }), h('div', { style: 'min-width:0' }, h('h2', leadName(l)), h('div.muted', [l.jobTitle, l.org].filter(Boolean).join(' at ')))),
      h('div.crm-quick', quickBtns(ctx, l.website))),
    sideSec('Details', [
      F('org', 'Company', { display: (v) => (v && l.company && COMPANY.has(l.company) ? cx.link(v, 'company', l.company) : v) }),
      F('website', 'Website'),
      F('territory', 'Territory', { type: 'select', options: TERRITORIES }),
      F('industry', 'Industry', { type: 'select', options: INDUSTRIES }),
      F('jobTitle', 'Job title'),
      F('source', 'Source', { type: 'select', options: SOURCES }),
      F('owner', 'Lead owner', { type: 'select', options: ownerOpts, display: (v) => (v ? cx.personChip(v, { link: false }) : null), text: (v) => cx.name(v) }),
      F('employees', 'No. of employees', { type: 'select', options: EMPLOYEES }),
    ], { key: 'lead-details' }),
    sideSec('Person', [
      F('firstName', 'First name'), F('lastName', 'Last name'), F('email', 'Email'), F('mobile', 'Mobile no.'),
      h('div.crm-f-cap', h('b', 'Capxul'), h('span', cap.line), l.converted && ct ? cx.link(`Open ${ct.name}`, 'contact', ct.id) : null),
    ], { key: 'lead-person' }),
    l.lostReason ? sideSec('Lost details', [sideField({ label: 'Lost reason', get: () => l.lostReason, readOnly: true }, o), sideField({ label: 'Lost notes', get: () => l.lostNotes, readOnly: true }, o)]) : null);
}
function contactBlock(d, entry) {
  const c = CONTACT.get(entry.contact);
  if (!c) return null;
  const key = 'crm-pc:' + d.name + ':' + c.id;
  let open = cx.store.get(key, !!entry.primary);
  const cap = capxulOf(c);
  const body = h('div.crm-pc-b', c.email ? h('span', cx.icon('mail', { size: 12 }), ' ', c.email) : null, c.mobile ? h('span', cx.icon('phone', { size: 12 }), ' ', c.mobile) : null, c.designation ? h('span.muted', c.designation) : null, h('span', cx.pill(cap.word, cap.tone), ' ', h('span.muted', cap.line)));
  body.hidden = !open;
  const tog = h('button.crm-sec-t', { type: 'button', 'aria-expanded': String(open), style: 'padding:2px 0', onclick: () => { open = !open; tog.setAttribute('aria-expanded', String(open)); body.hidden = !open; cx.store.set(key, open); } }, cx.icon('down'), extAvatar(c.name, { size: 'sm' }), h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, c.name));
  return h('div.crm-pc',
    h('div.crm-pc-h', tog, entry.primary ? cx.pill('Primary', 'green') : null,
      cx.menu(null, [
        { label: 'Set as primary contact', icon: 'check', needs: NEED, disabled: entry.primary, cmd: `capxul org crm deal change ${d.name} --primary ${c.id}`, onClick: () => { const old = primaryOf(d); d.contacts.forEach((x) => { x.primary = x.contact === c.id; }); addChanges('deal', d, [['Primary Contact', old?.name || null, c.name]]); cx.toast(`${c.name} is the primary contact`, { tone: 'success', cmd: `capxul org crm deal change ${d.name} --primary ${c.id}` }); cx.refresh(); } },
        { label: 'Remove', icon: 'x', danger: true, needs: NEED, disabled: d.contacts.length < 2, reason: 'A deal keeps at least one contact.', cmd: `capxul org crm deal change ${d.name} --clear contact:${c.id}`, onClick: () => { d.contacts = d.contacts.filter((x) => x.contact !== c.id); if (!d.contacts.some((x) => x.primary)) d.contacts[0].primary = true; addChanges('deal', d, [['Contacts', c.name, '—']]); cx.toast(`${c.name} removed from the deal`, { tone: 'success', cmd: `capxul org crm deal change ${d.name} --clear contact:${c.id}` }); cx.refresh(); } },
      ], { sm: true, kind: 'ghost' }),
      h('a.btn.sm.ghost', { href: cx.href('contact', c.id), title: `Open ${c.name}`, 'aria-label': `Open ${c.name}` }, cx.icon('right'))),
    body);
}
function addContactModal(d) {
  const m = { contact: '' };
  const here = contactsOfCompany(d.company).filter((c) => !d.contacts.some((x) => x.contact === c.id));
  const others = C.contacts.filter((c) => c.company !== d.company && !d.contacts.some((x) => x.contact === c.id));
  formModal({ title: 'Add a contact to the deal', model: m, cols: 1, needs: NEED, submit: 'Add', who: 'whoever wears the People hat',
    fields: [{ label: 'Contact', key: 'contact', type: 'select', reqd: true, options: [['', 'Search contacts'], ...here.map((c) => [c.id, `${c.name} · ${companyName(d.company)}`]), ...others.map((c) => [c.id, `${c.name}${c.company ? ' · ' + companyName(c.company) : ''}`])] }],
    cmd: (x) => `capxul org crm deal change ${d.name} --contact ${x.contact || '<contact>'}`,
    onSubmit: (x, close, cmd) => { d.contacts.push({ contact: x.contact, primary: !d.contacts.length }); addChanges('deal', d, [['Contacts', null, contactName(x.contact)]]); close(); cx.toast(`${contactName(x.contact)} added to the deal`, { tone: 'success', cmd }); cx.refresh(); } });
}
function dealSide(d, ctx) {
  const o = { kind: 'deal', rec: d };
  const co = COMPANY.get(d.company) || { name: d.title, id: d.company };
  const F = (key, label, x = {}) => sideField({ label, get: () => d[key], set: (v) => { d[key] = v; }, cmd: (v) => `capxul org crm deal change ${d.name} ${DEAL_FLAG[key]} ${flagVal(key, v)}`, ...x }, o);
  const CO = (key, label, x = {}) => sideField({ label, get: () => co[key], set: (v) => { co[key] = v; }, noTimeline: true, cmd: (v) => `capxul contact change ${co.id} ${CO_FLAG[key]} ${q(v)} --org harbourline`, ...x }, o);
  const money = (v) => (v == null || v === '' ? null : fmt.money(v, d.currency, 2));
  return h('aside.crm-side',
    idBtn(d.name),
    h('div.crm-head', h('div.crm-head-top', extAvatar(co.name, { size: 'xl', square: true }), h('div', { style: 'min-width:0' }, h('h2', COMPANY.has(co.id) ? cx.link(co.name, 'company', co.id) : co.name), h('div.muted', co.onCapxul ? `${co.handle} · Safe ${fmt.addr(co.safe)}` : (co.website || '')))),
      h('div.crm-quick', quickBtns(ctx, co.website))),
    sideSec('Contacts', d.contacts.map((e) => contactBlock(d, e)), { key: 'deal-contacts', count: d.contacts.length, add: cx.btn('', { sm: true, kind: 'ghost', icon: 'plus', title: 'Add a contact', needs: NEED, onClick: () => addContactModal(d) }) }),
    sideSec('Forecasted sales', [
      F('expectedClosureDate', 'Expected closure date', { type: 'date', display: (v) => (v ? fmt.date(v) : null), text: (v) => (v ? fmt.date(v) : '') }),
      F('probability', 'Probability', { type: 'number', display: (v) => (v == null ? null : v + '%') }),
      F('expectedDealValue', 'Expected deal value', { type: 'number', display: money, text: money }),
      F('dealValue', 'Deal value', { type: 'number', display: money, text: money }),
    ], { key: 'deal-forecast' }),
    sideSec('Company details', [
      CO('name', 'Company', { readOnly: true, display: (v) => (COMPANY.has(co.id) ? cx.link(v, 'company', co.id) : v) }),
      CO('description', 'Company description'),
      CO('industry', 'Industry', { type: 'select', options: INDUSTRIES }),
      CO('employees', 'No. of employees', { type: 'select', options: EMPLOYEES }),
      CO('website', 'Website'),
      CO('territory', 'Territory', { type: 'select', options: TERRITORIES }),
      CO('annualRevenue', 'Annual revenue', { type: 'number', display: (v) => (v == null ? null : fmt.money(v, co.currency || 'GBP', 2)) }),
      F('closedDate', 'Closed date', { readOnly: true, display: (v) => (v ? fmt.date(v) : null) }),
      F('nextStep', 'Next step'),
      F('owner', 'Deal owner', { type: 'select', options: ownerOpts, display: (v) => (v ? cx.personChip(v, { link: false }) : null), text: (v) => cx.name(v) }),
    ], { key: 'deal-company' }),
    isLost('deal', d.status) ? sideSec('Lost details', [F('lostReason', 'Lost reason', { readOnly: true }), F('lostNotes', 'Lost notes', { readOnly: true })], { key: 'deal-lost' }) : null);
}

/* =====================================================================================================
   The Data tab: the record's fields as a form, saved together
   ===================================================================================================== */

function dataTab(kind, rec) {
  const canEdit = cx.allowed(NEED).ok;
  const draft = { ...rec };
  const co = kind === 'deal' ? COMPANY.get(rec.company) || {} : COMPANY.get(rec.company) || null;
  const FLAGS = kind === 'lead' ? LEAD_FLAG : DEAL_FLAG;
  const changed = () => Object.keys(FLAGS).filter((k) => String(draft[k] ?? '') !== String(rec[k] ?? ''));
  const cmdFor = () => { const ks = changed(); return `capxul org crm ${kind} change ${rec.name}${ks.length ? ' ' + ks.map((k) => `${FLAGS[k]} ${flagVal(k, draft[k])}`).join(' ') : ''}`; };
  const notSaved = cx.pill('Not saved', 'orange'); notSaved.hidden = true;
  const saveBtn = cx.btn('Save', { kind: 'primary', sm: true, needs: NEED, onClick: () => {
    const ks = changed(); if (!ks.length) return;
    const cmd = cmdFor();
    const LABEL = { firstName: 'First Name', lastName: 'Last Name', email: 'Email', mobile: 'Mobile No.', jobTitle: 'Job Title', org: 'Organization', website: 'Website', industry: 'Industry', territory: 'Territory', employees: 'No. of Employees', source: 'Source', owner: kind === 'lead' ? 'Lead Owner' : 'Deal Owner', probability: 'Probability', dealValue: 'Deal Value', expectedDealValue: 'Expected Deal Value', currency: 'Currency', expectedClosureDate: 'Expected Closure Date', nextStep: 'Next Step' };
    addChanges(kind, rec, ks.map((k) => [LABEL[k] || k, rec[k] == null || rec[k] === '' ? null : k === 'owner' ? cx.name(rec[k]) : String(rec[k]), k === 'owner' ? cx.name(draft[k]) : String(draft[k] ?? '—')]));
    for (const k of ks) rec[k] = ['probability', 'dealValue', 'expectedDealValue'].includes(k) && draft[k] != null && draft[k] !== '' ? +draft[k] : draft[k];
    cx.toast('Saved', { tone: 'success', cmd }); cx.refresh();
  } });
  saveBtn.hidden = true;
  const onChange = () => { const n = changed().length; saveBtn.hidden = !n; notSaved.hidden = !n; if (n) cx.showAction(cmdFor(), 'Save', { pin: true }); };
  const owner = { label: kind === 'lead' ? 'Lead owner' : 'Deal owner', key: 'owner', type: 'select', options: ownerOpts(), render: (x) => cx.personChip(x.owner, { link: false }) };
  const ro = (label, value, x = {}) => ({ label, value: value ?? '', readOnly: true, ...x });
  let secs;
  if (kind === 'lead') {
    secs = [
      { label: 'Details', columns: [
        [{ label: 'Company', key: 'org' }, ro('Company description', co?.description), { label: 'Industry', key: 'industry', type: 'select', options: INDUSTRIES }, { label: 'No. of employees', key: 'employees', type: 'select', options: EMPLOYEES }],
        [{ label: 'Website', key: 'website' }, { label: 'Job title', key: 'jobTitle' }],
        [{ label: 'Territory', key: 'territory', type: 'select', options: TERRITORIES }, { label: 'Source', key: 'source', type: 'select', options: SOURCES }, owner]] },
      { label: 'Person', columns: [[{ label: 'Email', key: 'email' }], [{ label: 'First name', key: 'firstName' }, { label: 'Mobile no.', key: 'mobile' }], [{ label: 'Last name', key: 'lastName' }]] },
    ];
  } else {
    secs = [
      { label: 'Details', columns: [
        [ro('Company', co.name), ro('Company description', co.description), ro('Industry', co.industry), ro('No. of employees', co.employees), ro('Annual revenue', co.annualRevenue != null ? fmt.money(co.annualRevenue, co.currency || 'GBP') : '')],
        [ro('Website', co.website), ro('Closed date', rec.closedDate ? fmt.date(rec.closedDate) : ''), { label: 'Next step', key: 'nextStep' }, { label: 'Deal value', key: 'dealValue', type: 'currency', currency: rec.currency }],
        [ro('Territory', co.territory), { label: 'Probability', key: 'probability', type: 'percent' }, owner, { label: 'Expected deal value', key: 'expectedDealValue', type: 'currency', currency: rec.currency }, { label: 'Expected closure date', key: 'expectedClosureDate', type: 'date' }, { label: 'Currency', key: 'currency', type: 'select', options: ['GBP', 'USD', 'EUR'] }]] },
      isLost('deal', rec.status) ? { label: 'Lost', columns: [[ro('Lost reason', rec.lostReason)], [ro('Lost notes', rec.lostNotes, { type: 'textarea' })]] } : null,
      rec.project ? { label: 'Project', columns: [[{ label: 'Project', value: rec.project, readOnly: true, type: 'link', href: ['project', rec.project] }], [ro('Source', rec.source)]] } : null,
    ].filter(Boolean);
  }
  const body = h('div', secs.map((sec) => cx.section(sec, { doc: draft, editable: canEdit, onChange })));
  return h('div', h('div.crm-tabhead', h('h3', 'Data'), notSaved, saveBtn),
    kind === 'deal' ? h('p.muted', { style: 'font-size:12.5px;padding:0 14px' }, "The company's own fields change on the company, with capxul contact change.") : null,
    body);
}

/* =====================================================================================================
   The lead and deal pages
   ===================================================================================================== */

const recTasks = (rec) => C.tasks.filter((t) => t.reference === rec.name || (rec.lead && t.reference === rec.lead)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
const recNotes = (rec) => C.notes.filter((n) => n.reference === rec.name || (rec.lead && n.reference === rec.lead)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
function taskRows(tasks, ctx) {
  if (!tasks.length) return cx.empty('No tasks found');
  return h('div', tasks.map((t) => h('div.crm-trow', { onclick: (e) => { if (e.target.closest('.menu-wrap')) return; taskModal(ctx, t); } },
    taskIcon(t.status),
    h('div', { style: 'min-width:0;display:grid;gap:2px' }, h('span.ttl', t.title), h('span.meta', t.assignedTo ? cx.personChip(t.assignedTo, { link: false }) : 'Unassigned', t.due ? h('span', { title: fmt.datetime(t.due) }, fmt.datetime(t.due)) : null, prio(t.priority))),
    taskMoveMenu(t))));
}
function taskMoveMenu(t) {
  const need = () => cx.wears('People') || t.assignedTo === cx.meId() || `Moving a task needs the People hat, or to be its assignee. ${namesList(peopleWearers())} wear People; ${cx.name(t.assignedTo)} is the assignee.`;
  return cx.menu(t.status, TASK_ST.map((st) => ({ label: h('span.crm-tst', taskIcon(st), st), on: st === t.status, needs: need, cmd: `capxul org crm task move ${t.name} ${q(st)}`, onClick: () => moveTask(t, st) })), { sm: true, kind: 'ghost' });
}
function moveTask(t, st) {
  if (t.status === st) return true;
  const cmd = `capxul org crm task move ${t.name} ${q(st)}`;
  t.status = st; t.modifiedAt = NOW(); if (st === 'Done') t.doneAt = NOW();
  cx.toast(`${t.title}: ${st}`, { tone: 'success', cmd }); cx.showAction(cmd, 'Move the task', { pin: true });
  cx.refresh();
  return true;
}
function noteGrid(notes, ctx) {
  if (!notes.length) return cx.empty('No notes found');
  return h('div.crm-notes', notes.map((n) => noteTile(n, ctx)));
}
function noteTile(n, ctx, withRecord) {
  return h('article.crm-note', { tabindex: '0', onclick: () => noteModal(ctx, n), onkeydown: (e) => { if (e.key === 'Enter') noteModal(ctx, n); } },
    h('h4', n.title), h('p', n.content || ''),
    withRecord ? h('div', { style: 'font-size:12px' }, 'on ', cx.link(recLabel(n.reference), recRoute(n.reference), n.reference)) : null,
    h('footer', cx.avatar(n.by, { size: 'sm' }), h('span', cx.name(n.by)), h('span.grow'), h('span', { title: fmt.datetime(n.at) }, fmt.ago(n.at))));
}
function statusMenu(kind, rec) {
  return cx.menu(stDot(kind, rec.status), ST[kind].map((st) => ({ label: stDot(kind, st.name), on: st.name === rec.status, needs: NEED, cmd: `capxul org crm ${kind} move ${rec.name} ${q(st.name)}${st.type === 'Lost' ? ' --reason "…"' : ''}`, onClick: async () => { if (await moveRecord(kind, rec, st.name)) cx.refresh(); } })));
}
function ownerMenu(kind, rec) {
  const label = h('span.crm-sel', rec.owner ? cx.avatar(rec.owner, { size: 'sm' }) : cx.icon('user'), rec.owner ? cx.name(rec.owner) : 'Assign to');
  return cx.menu(label, [{ heading: kind === 'lead' ? 'Lead owner' : 'Deal owner' }, ...members().map((id) => ({ label: cx.name(id), on: id === rec.owner, needs: NEED, cmd: `capxul org crm ${kind} change ${rec.name} --owner ${memberEmail(id)}`, onClick: () => {
    if (id === rec.owner) return;
    const old = rec.owner; rec.owner = id;
    addChanges(kind, rec, [[kind === 'lead' ? 'Lead Owner' : 'Deal Owner', old ? cx.name(old) : null, cx.name(id)]]);
    cx.toast(`${cx.name(id)} owns ${recTitle(rec)} now`, { tone: 'success', cmd: `capxul org crm ${kind} change ${rec.name} --owner ${memberEmail(id)}` });
    cx.refresh();
  } }))], { kind: 'ghost' });
}
function notFound(what, route, label) {
  return cx.page({ title: 'Not found', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }, { label, route }], body: cx.empty(`No such ${what}.`, cx.btn(`All ${label.toLowerCase()}`, { href: [route] })) });
}
function recordPage(kind, rec) {
  const isLead = kind === 'lead';
  const prim = isLead ? null : primaryOf(rec);
  const ctx = { kind, rec, name: recTitle(rec), personName: isLead ? leadName(rec) : prim?.name, toEmail: isLead ? rec.email : prim?.email, mobile: isLead ? rec.mobile : prim?.mobile };
  const cn = counts(itemsOf(rec));
  const tasks = recTasks(rec), notes = recNotes(rec);
  const c1 = composer(ctx), c2 = composer(ctx);
  const ctx1 = { ...ctx, compose: c1 }, ctx2 = { ...ctx, compose: c2 };
  let tabsEl = null;
  ctx.openEmail = () => { tabsEl?.show(0); c1.open({}); };
  const pane = (title, actions, body, foot) => h('div', h('div.crm-tabhead', h('h3', title), actions), h('div.crm-tabbody', body), foot || null);
  const newMenu = cx.menu('New', [
    { label: 'Email', icon: 'mail', needs: NEED, cmd: `capxul org crm email send ${rec.name} --subject "…" --body-file email.md --confirm`, onClick: () => c1.open({}) },
    { label: 'Log a call', icon: 'phone', needs: NEED, cmd: `capxul org crm call log ${rec.name} --type outgoing --status completed --start ${TODAY}T10:30`, onClick: () => logCallModal(ctx) },
    { label: 'Note', icon: 'note', needs: NEED, cmd: `capxul org crm note add ${rec.name} "<title>" --content "…"`, onClick: () => noteModal(ctx, null) },
    { label: 'Task', icon: 'task', needs: NEED, cmd: `capxul org crm task create ${rec.name} "<title>" --assigned-to ${memberEmail(cx.meId())}`, onClick: () => taskModal(ctx, null) },
    { label: 'WhatsApp message', icon: 'message', needs: NEED, cmd: `capxul org crm whatsapp send ${rec.name} --text "…" --confirm`, onClick: () => tabsEl?.show(6) },
  ], { sm: true, icon: 'plus' });
  const tabs = [
    { label: 'Activity', render: () => pane('Activity', [orderBtn(), newMenu], activityList(rec, null, ctx1), c1.el) },
    { label: 'Emails', count: cn.email, render: () => pane('Emails', [orderBtn(), cx.btn('New email', { sm: true, icon: 'mail', needs: NEED, onClick: () => c2.open({}) })], activityList(rec, 'email', ctx2), c2.el) },
    { label: 'Data', render: () => dataTab(kind, rec) },
    { label: 'Calls', count: cn.call, render: () => pane('Calls', cx.btn('Log a call', { sm: true, icon: 'phone', needs: NEED, onClick: () => logCallModal(ctx) }), activityList(rec, 'call', ctx)) },
    { label: 'Tasks', count: tasks.length, render: () => pane('Tasks', cx.btn('New task', { sm: true, icon: 'task', needs: NEED, onClick: () => taskModal(ctx, null) }), taskRows(tasks, ctx)) },
    { label: 'Notes', count: notes.length, render: () => pane('Notes', cx.btn('New note', { sm: true, icon: 'note', needs: NEED, onClick: () => noteModal(ctx, null) }), noteGrid(notes, ctx)) },
    { label: 'WhatsApp', count: cn.whatsapp, render: () => h('div', h('div.crm-tabhead', h('h3', 'WhatsApp'), h('span.muted', { style: 'font-size:12.5px' }, ctx.mobile || '')), whatsappPane(ctx)) },
  ];
  tabsEl = cx.tabs(tabs, { key: 'crm-rec' });
  const lostLead = isLead && isLost('lead', rec.status);
  const convertNeed = () => (lostLead ? 'Cannot convert a lost lead to deal' : cx.allowed(NEED).ok || lockLine());
  const actions = [
    ownerMenu(kind, rec),
    statusMenu(kind, rec),
    isLead ? (rec.converted ? cx.btn('Open the deal', { kind: 'primary', icon: 'right', href: ['deal', rec.deal || rec.convertedTo] }) : cx.btn('Convert to deal', { kind: 'primary', icon: 'swap', needs: convertNeed, cmd: `capxul org crm lead convert ${rec.name}`, onClick: () => convertModal(rec) })) : null,
  ];
  const banner = readOnlyBanner(`this ${kind}`)
    || (isLead && rec.converted ? cx.banner(h('span', 'Converted to ', cx.link(rec.deal || rec.convertedTo, 'deal', rec.deal || rec.convertedTo), '. A converted lead leaves the Leads list, as the CRM does.'), { tone: 'info' }) : null)
    || (rec.lostReason ? cx.banner(`Lost: ${rec.lostReason}${rec.lostNotes ? `. ${rec.lostNotes}` : ''}`, { tone: 'warning' }) : null);
  const sub = isLead
    ? `${rec.name}${rec.org ? ' · ' + rec.org : ''} · ${rec.source || 'no source'} · created ${fmt.agoLong(rec.createdAt)}`
    : `${rec.name} · ${rec.subject} · ${fmt.money(rec.dealValue, rec.currency)}${rec.status !== 'Won' && rec.status !== 'Lost' ? ` · ${rec.probability}% · closes ${fmt.date(rec.expectedClosureDate)}` : rec.closedDate ? ` · closed ${fmt.date(rec.closedDate)}` : ''}`;
  return cx.page({
    title: recTitle(rec), workspace: 'crm', status: isLead && rec.converted ? cx.pill('Converted', 'teal', { lg: true }) : null,
    crumbs: [{ label: 'CRM', route: 'crm' }, { label: isLead ? 'Leads' : 'Deals', route: isLead ? 'leads' : 'deals' }],
    sub, actions, banner,
    cmd: { cli: [`capxul org crm ${kind} get ${rec.name}`, `capxul org crm timeline ${rec.name}`], sdk: [`client.org(orgId).crm.${kind}s.get("${rec.name}")`, `client.org(orgId).crm.timeline("${rec.name}")`].join('\n') },
    fde: isLead ? `Lead ${rec.name}: ${leadName(rec)}${rec.org ? ' of ' + rec.org : ''}, status ${rec.status}, owned by ${cx.name(rec.owner)}` : `Deal ${rec.name}: ${rec.title}, ${rec.status}, ${fmt.money(rec.dealValue, rec.currency)} at ${rec.probability}%, owned by ${cx.name(rec.owner)}`,
    body: h('div.crm-rec', h('div.crm-main', tabsEl), isLead ? leadSide(rec, ctx) : dealSide(rec, ctx)),
  });
}

/* ---------- convert a lead into a deal ---------- */

function convertModal(l) {
  const co = l.company ? COMPANY.get(l.company) : C.companies.find((c) => c.name === l.org) || null;
  const ct = l.contact ? CONTACT.get(l.contact) : C.contacts.find((c) => c.email && c.email === l.email) || null;
  const m = { existingCompany: co ? 1 : 0, company: co?.id || '', existingContact: ct ? 1 : 0, contact: ct?.id || '', value: '', currency: co?.currency === 'USD' ? 'USD' : 'GBP', closeBy: addDays(TODAY, 60) };
  formModal({
    title: 'Convert to deal', model: m, needs: NEED, submit: 'Convert', who: 'whoever wears the People hat',
    intro: `${leadName(l)}${l.org ? ' of ' + l.org : ''} becomes a deal in Qualification. Its activity moves with it.`,
    fields: [
      { section: 'Company' },
      { label: 'Choose existing', key: 'existingCompany', type: 'check', checkLabel: 'Use a company already in the book' },
      { label: 'Company', key: 'company', type: 'select', options: [['', l.org ? `New: ${l.org}` : 'Choose a company'], ...C.companies.map((c) => [c.id, c.name])] },
      { section: 'Contact' },
      { label: 'Choose existing', key: 'existingContact', type: 'check', checkLabel: 'Use a contact already in the book' },
      { label: 'Contact', key: 'contact', type: 'select', options: [['', `New: ${leadName(l)}`], ...C.contacts.map((c) => [c.id, `${c.name}${c.company ? ' · ' + companyName(c.company) : ''}`])] },
      { section: 'Deal' },
      { label: 'Expected deal value', key: 'value', type: 'float' },
      { label: 'Currency', key: 'currency', type: 'select', options: ['GBP', 'USD', 'EUR'] },
      { label: 'Expected closure date', key: 'closeBy', type: 'date', reqd: true },
    ],
    cmd: (x) => `capxul org crm lead convert ${l.name}${x.existingCompany && x.company ? ` --company ${x.company}` : ''}${x.existingContact && x.contact ? ` --contact ${x.contact}` : ''}${x.value ? ` --value ${x.value} --expected-value ${x.value}` : ''} --currency ${x.currency} --close-by ${x.closeBy}`,
    check: (x) => (x.existingCompany && !x.company ? 'Please select an existing company' : x.existingContact && !x.contact ? 'Please select an existing contact' : null),
    onSubmit: (x, close, cmd) => {
      let companyId = x.existingCompany ? x.company : null;
      if (!companyId) {
        const found = C.companies.find((c) => c.name === l.org);
        if (found) companyId = found.id;
        else {
          companyId = cx.slug(l.org || leadName(l)).toLowerCase();
          const rec = { id: companyId, name: l.org || leadName(l), website: l.website || null, industry: l.industry || null, territory: l.territory || null, employees: l.employees || null, annualRevenue: null, currency: x.currency, description: null, onCapxul: false, handle: null, safe: null, isCustomer: false };
          C.companies.push(rec); COMPANY.set(companyId, rec);
        }
      }
      let contactId = x.existingContact ? x.contact : null;
      if (!contactId) {
        const found = l.email ? C.contacts.find((c) => c.email === l.email) : null;
        if (found) contactId = found.id;
        else {
          contactId = cx.slug(leadName(l)).toLowerCase();
          const rec = { id: contactId, firstName: l.firstName, lastName: l.lastName, name: leadName(l), company: companyId, designation: l.jobTitle || null, email: l.email || null, mobile: l.mobile || null, onCapxul: false, handle: null, primary: true, createdAt: NOW() };
          C.contacts.push(rec); CONTACT.set(contactId, rec);
        }
      }
      const name = nextName(`CRM-DEAL-${TODAY.slice(0, 4)}-`, C.deals.map((d) => d.name));
      const first = itemsOf(l).find((i) => i.kind === 'email' && i.subject);
      const subject = first ? first.subject.replace(/^(re|fwd?):\s*/i, '').replace(/ for .*$/, '') : 'New engagement';
      const val = x.value ? +x.value : null;
      const deal = { title: `${companyName(companyId)}: ${subject}`, subject, company: companyId, contacts: [{ contact: contactId, primary: true }], status: 'Qualification', probability: 10, dealValue: val, currency: x.currency, expectedDealValue: val, expectedClosureDate: x.closeBy, closedDate: null, nextStep: null, owner: l.owner || cx.meId(), lostReason: null, lostNotes: null, createdAt: NOW(), source: l.source, territory: l.territory, industry: l.industry, project: null, lead: l.name, name };
      C.deals.push(deal);
      const from = l.status;
      l.converted = true; l.deal = name; l.convertedTo = name; l.contact = contactId; l.company = companyId;
      if (from !== 'Qualified') { l.status = 'Qualified'; addChanges('lead', l, [['Status', from, 'Qualified']]); }
      addItem(l.name, 'Lead', { kind: 'converted', deal: name, text: `${cx.name(cx.meId())} converted the lead to this deal` });
      close();
      cx.toast(`Converted to ${name}`, { tone: 'success', cmd });
      cx.go('deal', name);
    },
  });
}

cx.route('lead', (ctx) => { const l = cx.find(C.leads, 'name', ctx.id); return l ? recordPage('lead', l) : notFound('lead', 'leads', 'Leads'); }, { workspace: 'crm', title: 'Lead' });
cx.route('deal', (ctx) => { const d = cx.find(C.deals, 'name', ctx.id); return d ? recordPage('deal', d) : notFound('deal', 'deals', 'Deals'); }, { workspace: 'crm', title: 'Deal' });

/** A record's page context from its name (for actions started from a list). */
function ctxFor(name) {
  const l = C.leads.find((x) => x.name === name);
  if (l) return { kind: 'lead', rec: l, name: leadName(l), personName: leadName(l), toEmail: l.email, mobile: l.mobile };
  const d = C.deals.find((x) => x.name === name);
  if (d) { const p = primaryOf(d); return { kind: 'deal', rec: d, name: dealTitle(d), personName: p?.name, toEmail: p?.email, mobile: p?.mobile }; }
  return null;
}
/** Choose the lead or deal first, then run next(ctx). */
function pickRecord(title, next) {
  const m = { record: '' };
  formModal({ title, model: m, cols: 1, needs: NEED, submit: 'Next', fields: [{ label: 'Lead or deal', key: 'record', type: 'select', reqd: true, options: recordOptions() }],
    onSubmit: (x, close) => { close(); next(ctxFor(x.record)); } });
}

/* =====================================================================================================
   Lists: leads, deals, the Pipeline view; group-by; kanban
   ===================================================================================================== */

const viewList = (base, active) => [{ label: 'List', route: base, icon: 'list' }, { label: 'Group by', route: base + '-grouped', icon: 'report' }, { label: 'Kanban', route: base + '-kanban', icon: 'kanban' }].map((v) => ({ ...v, active: v.route === active }));
const viewBar = (views, ...left) => h('div.crm-views', ...left, h('span.grow'), h('div.btn-group', views.map((v) => h('a.btn', { href: cx.href(v.route), class: { primary: v.active }, 'aria-current': v.active ? 'page' : null }, cx.icon(v.icon), h('span', v.label)))));
const kbCounts = (rec) => { const c = counts(itemsOf(rec)); const t = recTasks(rec).length; return h('div.crm-kb-counts', h('span', { title: 'Emails' }, cx.icon('mail'), c.email), h('span', { title: 'Notes' }, cx.icon('note'), c.note), h('span', { title: 'Tasks' }, cx.icon('task'), t), h('span', { title: 'Calls' }, cx.icon('phone'), c.call)); };
const LEAD_TABS = [
  { label: 'All', filter: (r) => !r.converted },
  { label: 'New', stage: 'open', filter: (r) => !r.converted && stageOf('lead', r.status) === 'open' },
  { label: 'Ongoing', stage: 'ongoing', filter: (r) => !r.converted && stageOf('lead', r.status) === 'ongoing' },
  { label: 'Lost', stage: 'lost', filter: (r) => !r.converted && stageOf('lead', r.status) === 'lost' },
  { label: 'Converted', stage: 'converted', filter: (r) => !!r.converted },
];
const DEAL_TABS = [
  { label: 'All' },
  { label: 'Open', stage: 'open', filter: (r) => stageOf('deal', r.status) === 'open' },
  { label: 'Ongoing', stage: 'ongoing', filter: (r) => stageOf('deal', r.status) === 'ongoing' },
  { label: 'Won', stage: 'won', filter: (r) => r.status === 'Won' },
  { label: 'Lost', stage: 'lost', filter: (r) => r.status === 'Lost' },
];
function listCmd(kind, tabs) {
  return (st) => {
    const stage = st.filters.status ? stageOf(kind, st.filters.status) : tabs[st.tab]?.stage;
    const extra = Object.entries(st.filters).filter(([k, v]) => v && k !== 'status').map(([k]) => k);
    return { cli: `capxul org crm ${kind} list${stage ? ' --stage ' + stage : ''}`, sdk: `client.org(orgId).crm.${kind}s.list(${stage ? `{ stage: "${stage}" }` : ''})`,
      note: st.filters.status || extra.length || st.conds.length ? 'The other filters narrow the list on this screen.' : null };
  };
}
function bulkStatus(kind, rows) {
  const m = { status: ST[kind][1].name, reason: '', notes: '' };
  const lostNow = () => isLost(kind, m.status);
  formModal({ title: `Change the status of ${fmt.plural(rows.length, kind)}`, model: m, needs: NEED, submit: 'Update', who: 'whoever wears the People hat',
    fields: [{ label: 'Status', key: 'status', type: 'select', options: ST[kind].map((x) => x.name) }, { label: 'Lost reason (for a lost status)', key: 'reason', type: 'select', options: [['', '—'], ...C.lostReasons] }, { label: 'Lost notes', key: 'notes', type: 'textarea', wide: true }],
    cmd: (x) => rows.slice(0, 4).map((r) => `capxul org crm ${kind} move ${r.name} ${q(x.status)}${lostNow() ? ` --reason ${q(x.reason || '…')}${x.notes ? ` --notes ${q(x.notes)}` : ''}` : ''}`).concat(rows.length > 4 ? [`# and ${rows.length - 4} more`] : []),
    check: (x) => (lostNow() && !x.reason ? 'A lost status needs a reason.' : lostNow() && x.reason === 'Other' && !x.notes.trim() ? 'Other needs lost notes.' : null),
    onSubmit: (x, close, cmd) => {
      for (const r of rows) {
        if (r.status === x.status) continue;
        const ch = [['Status', r.status, x.status]]; r.status = x.status;
        if (kind === 'deal') { const p = stOf('deal', x.status).probability; if (p != null && r.probability !== p) { ch.push(['Probability', String(r.probability), String(p)]); r.probability = p; } if (x.status === 'Won') r.closedDate = TODAY; }
        if (lostNow()) { r.lostReason = x.reason; r.lostNotes = x.notes || null; ch.push(['Lost Reason', null, x.reason]); }
        addChanges(kind, r, ch);
      }
      close(); cx.toast(`${fmt.plural(rows.length, kind)} moved to ${x.status}`, { tone: 'success', cmd: [].concat(cmd)[0] }); cx.refresh();
    } });
}
function bulkOwner(kind, rows) {
  const m = { owner: cx.meId() };
  formModal({ title: `Assign ${fmt.plural(rows.length, kind)}`, model: m, cols: 1, needs: NEED, submit: 'Assign', who: 'whoever wears the People hat',
    fields: [{ label: kind === 'lead' ? 'Lead owner' : 'Deal owner', key: 'owner', type: 'select', options: ownerOpts() }],
    cmd: (x) => rows.slice(0, 4).map((r) => `capxul org crm ${kind} change ${r.name} --owner ${memberEmail(x.owner)}`).concat(rows.length > 4 ? [`# and ${rows.length - 4} more`] : []),
    onSubmit: (x, close, cmd) => { for (const r of rows) if (r.owner !== x.owner) { addChanges(kind, r, [[kind === 'lead' ? 'Lead Owner' : 'Deal Owner', r.owner ? cx.name(r.owner) : null, cx.name(x.owner)]]); r.owner = x.owner; } close(); cx.toast(`${fmt.plural(rows.length, kind)} assigned to ${cx.name(x.owner)}`, { tone: 'success', cmd: [].concat(cmd)[0] }); cx.refresh(); } });
}
function leadsList() {
  return cx.listView({
    key: 'crm-leads', rows: () => C.leads, id: (r) => r.name,
    titleCol: { key: 'fullName', label: 'Full name', get: leadName, render: (r) => h('span.crm-name', extAvatar(leadName(r), { size: 'sm' }), h('a', { href: cx.href('lead', r.name) }, leadName(r))) },
    status: (r) => stDot('lead', r.status),
    columns: [{ key: 'org', label: 'Company' }, { key: 'email', label: 'Email' }, { key: 'mobile', label: 'Mobile no.' }, { key: 'owner', label: 'Assigned to', type: 'person' }],
    modified: modifiedOf,
    filters: [{ key: 'fullName', label: 'Full name' }, { key: 'email', label: 'Email' }, { key: 'org', label: 'Company' }, { key: 'status', label: 'Status', type: 'select', options: ST.lead.map((x) => x.name) }, { key: 'source', label: 'Source', type: 'select' }],
    tabs: LEAD_TABS,
    sort: { options: [{ key: 'modified', label: 'Last modified', get: modifiedOf }, { key: 'createdAt', label: 'Created on' }, { key: 'fullName', label: 'Full name', get: leadName }], default: { key: 'modified', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'owner', label: 'Lead owner', type: 'person' }, { key: 'source', label: 'Source' }, { key: 'territory', label: 'Territory' }],
    href: (r) => ['lead', r.name],
    bulk: [
      { label: 'Change status', icon: 'edit', needs: NEED, onClick: (rows) => bulkStatus('lead', rows) },
      { label: 'Assign to', icon: 'user', needs: NEED, onClick: (rows) => bulkOwner('lead', rows) },
      { label: 'Convert to deal', icon: 'swap', needs: NEED, onClick: (rows) => (rows.length === 1 ? (isLost('lead', rows[0].status) || rows[0].converted ? cx.toast(rows[0].converted ? 'That lead is converted already.' : 'Cannot convert a lost lead to deal', { tone: 'warning' }) : convertModal(rows[0])) : cx.toast('Convert one lead at a time: the dialog chooses its company and contact.', { tone: 'info' })) },
    ],
    views: viewList('leads', 'leads'),
    cmd: listCmd('lead', LEAD_TABS),
    noun: 'lead', idLabel: 'ID', empty: 'No leads match.',
  });
}
const dealCompanyCell = (r) => h('span.crm-name', extAvatar(companyName(r.company) || r.title, { size: 'sm', square: true }), h('a', { href: cx.href('deal', r.name) }, dealTitle(r)));
function dealsList(pipeline) {
  const cols = pipeline
    ? [{ key: 'dealValue', label: 'Deal value', type: 'currency', keep: true }, { key: 'probability', label: 'Probability', render: (r) => h('span.crm-tst', h('span.crm-pipe', h('i', { style: { width: (r.probability || 0) + '%' } })), (r.probability ?? 0) + '%') }, { key: 'expectedClosureDate', label: 'Expected closure', type: 'date' }, { key: 'owner', label: 'Deal owner', type: 'person' }]
    : [{ key: 'revenue', label: 'Annual revenue', get: (r) => COMPANY.get(r.company)?.annualRevenue, render: (r) => { const co = COMPANY.get(r.company); return co?.annualRevenue != null ? fmt.money(co.annualRevenue, co.currency || 'GBP', 2) : h('span.faint', '—'); }, align: 'right' },
      { key: 'email', label: 'Email', get: (r) => primaryOf(r)?.email }, { key: 'mobile', label: 'Mobile no.', get: (r) => primaryOf(r)?.mobile }, { key: 'owner', label: 'Assigned to', type: 'person' }];
  return cx.listView({
    key: pipeline ? 'crm-pipeline' : 'crm-deals', rows: () => (pipeline ? C.deals.filter((d) => ['open', 'ongoing'].includes(stageOf('deal', d.status))) : C.deals), id: (r) => r.name,
    titleCol: { key: 'companyName', label: 'Company', get: dealTitle, render: dealCompanyCell, sub: (r) => r.subject },
    status: (r) => stDot('deal', r.status),
    columns: cols, modified: modifiedOf,
    filters: [{ key: 'companyName', label: 'Company' }, { key: 'status', label: 'Status', type: 'select', options: ST.deal.map((x) => x.name) }, { key: 'owner', label: 'Deal owner', type: 'person', options: () => uniq(C.deals.map((d) => d.owner)) }, { key: 'source', label: 'Source', type: 'select' }],
    tabs: pipeline ? null : DEAL_TABS,
    sort: { options: [{ key: 'modified', label: 'Last modified', get: modifiedOf }, { key: 'expectedClosureDate', label: 'Expected closure' }, { key: 'value', label: 'Deal value (in pounds)', get: (r) => toGbp(r.dealValue, r.currency) }, { key: 'createdAt', label: 'Created on' }], default: pipeline ? { key: 'expectedClosureDate', dir: 'asc' } : { key: 'modified', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'owner', label: 'Deal owner', type: 'person' }, { key: 'territory', label: 'Territory' }, { key: 'source', label: 'Source' }],
    href: (r) => ['deal', r.name],
    bulk: [{ label: 'Change status', icon: 'edit', needs: NEED, onClick: (rows) => bulkStatus('deal', rows) }, { label: 'Assign to', icon: 'user', needs: NEED, onClick: (rows) => bulkOwner('deal', rows) }],
    views: pipeline ? null : viewList('deals', 'deals'),
    cmd: pipeline ? { cli: 'capxul org crm deal list --stage ongoing', sdk: 'client.org(orgId).crm.deals.list({ stage: "ongoing" })', filters: false, note: 'Pipeline is a public view: Qualification to Ready to Close, soonest closing first.' } : listCmd('deal', DEAL_TABS),
    noun: 'deal', idLabel: 'ID', empty: 'No deals match.',
  });
}
function newLeadModal(preset = {}) {
  const m = { firstName: '', lastName: '', email: '', mobile: '', jobTitle: '', org: '', website: '', revenue: '', territory: 'United Kingdom', employees: '', industry: '', source: 'Website', status: preset.status || 'New', owner: members().includes(cx.meId()) ? cx.meId() : members()[0] };
  formModal({
    title: 'New lead', model: m, needs: NEED, submit: 'Create', who: 'whoever wears the People hat',
    fields: [
      { section: 'Person' }, { label: 'First name', key: 'firstName', placeholder: 'Rohan' }, { label: 'Last name', key: 'lastName', placeholder: 'Mehta' },
      { label: 'Email', key: 'email', placeholder: 'rohan@parcelpoint.io' }, { label: 'Mobile no.', key: 'mobile', placeholder: '+44 7700 900634' }, { label: 'Job title', key: 'jobTitle', placeholder: 'CTO' },
      { section: 'Company' }, { label: 'Company', key: 'org', placeholder: 'Parcelpoint' }, { label: 'Website', key: 'website', placeholder: 'parcelpoint.io' },
      { label: 'Annual revenue', key: 'revenue', type: 'float' }, { label: 'Territory', key: 'territory', type: 'select', options: TERRITORIES },
      { label: 'No. of employees', key: 'employees', type: 'select', options: [['', '—'], ...EMPLOYEES] }, { label: 'Industry', key: 'industry', type: 'select', options: [['', '—'], ...INDUSTRIES] },
      { section: 'Lead' }, { label: 'Status', key: 'status', type: 'select', options: ST.lead.map((x) => x.name) }, { label: 'Source', key: 'source', type: 'select', options: SOURCES },
      { label: 'Lead owner', key: 'owner', type: 'select', options: ownerOpts() },
    ],
    cmd: (x) => {
      const f = [['--first-name', x.firstName], ['--last-name', x.lastName], ['--email', x.email], ['--mobile', x.mobile], ['--job-title', x.jobTitle], ['--company', x.org], ['--website', x.website], ['--industry', x.industry], ['--territory', x.territory], ['--employees', x.employees], ['--revenue', x.revenue], ['--source', x.source], ['--owner', memberEmail(x.owner)]].filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k} ${q(v)}`);
      return [`capxul org crm lead create ${f.join(' ')}`, x.status !== 'New' ? `capxul org crm lead move <new lead> ${q(x.status)}` : null].filter(Boolean);
    },
    check: (x) => (!x.firstName && !x.org && !x.email ? 'A lead needs a first name, a company name or an email.' : isLost('lead', x.status) ? 'A new lead starts in an open status; move it to a lost one from its page, with the reason.' : null),
    onSubmit: (x, close, cmd) => {
      const name = nextName(`CRM-LEAD-${TODAY.slice(0, 4)}-`, C.leads.map((l) => l.name));
      const co = C.companies.find((c) => x.org && c.name.toLowerCase() === x.org.toLowerCase());
      const at = NOW();
      const l = { createdAt: at, company: co?.id || null, org: x.org || null, contact: null, status: 'New', converted: false, owner: x.owner, source: x.source, deal: null, name, firstName: x.firstName, lastName: x.lastName, email: x.email || null, mobile: x.mobile || null, jobTitle: x.jobTitle || null, website: x.website || null, territory: x.territory, industry: x.industry || null, employees: x.employees || null, modifiedAt: at };
      C.leads.push(l);
      addItem(name, 'Lead', { kind: 'creation', text: `${cx.name(cx.meId())} created this lead`, source: x.source, at });
      if (x.status !== 'New') { l.status = x.status; addChanges('lead', l, [['Status', 'New', x.status]]); }
      close(); cx.toast(`Created ${name}`, { tone: 'success', cmd: [].concat(cmd)[0] }); cx.go('lead', name);
    },
  });
}
function newDealModal(preset = {}) {
  const m = { existingCompany: 1, company: preset.company || '', newCompany: '', website: '', industry: '', territory: 'United Kingdom', existingContact: 1, contact: preset.contact || '', firstName: '', lastName: '', email: '', mobile: '', status: preset.status || 'Qualification', owner: members().includes(cx.meId()) ? cx.meId() : members()[0], value: '', currency: 'GBP', closeBy: addDays(TODAY, 60), nextStep: '', source: 'Existing Customer' };
  formModal({
    title: 'New deal', model: m, needs: NEED, submit: 'Create', who: 'whoever wears the People hat', wide: true,
    fields: [
      { section: 'Company' }, { label: 'Choose existing', key: 'existingCompany', type: 'check', checkLabel: 'A company already in the book' },
      { label: 'Company', key: 'company', type: 'select', options: [['', 'Choose a company'], ...C.companies.map((c) => [c.id, c.name])] },
      { label: 'Or a new company', key: 'newCompany', placeholder: 'Company name' }, { label: 'Website', key: 'website' },
      { label: 'Industry', key: 'industry', type: 'select', options: [['', '—'], ...INDUSTRIES] }, { label: 'Territory', key: 'territory', type: 'select', options: TERRITORIES },
      { section: 'Contact' }, { label: 'Choose existing', key: 'existingContact', type: 'check', checkLabel: 'A person already in the book' },
      { label: 'Contact', key: 'contact', type: 'select', options: [['', 'Choose a contact'], ...C.contacts.map((c) => [c.id, `${c.name}${c.company ? ' · ' + companyName(c.company) : ''}`])] },
      { label: 'Or a new person: first name', key: 'firstName' }, { label: 'Last name', key: 'lastName' }, { label: 'Email', key: 'email' }, { label: 'Mobile no.', key: 'mobile' },
      { section: 'Deal' }, { label: 'Status', key: 'status', type: 'select', options: ST.deal.filter((x) => x.type !== 'Lost').map((x) => x.name) }, { label: 'Deal owner', key: 'owner', type: 'select', options: ownerOpts() },
      { label: 'Expected deal value', key: 'value', type: 'float' }, { label: 'Currency', key: 'currency', type: 'select', options: ['GBP', 'USD', 'EUR'] },
      { label: 'Expected closure date', key: 'closeBy', type: 'date' }, { label: 'Source', key: 'source', type: 'select', options: SOURCES },
      { label: 'Next step', key: 'nextStep', wide: true, placeholder: 'Scope call on Thursday' },
    ],
    cmd: (x) => {
      const lines = [];
      const coRef = x.existingCompany && x.company ? x.company : '<new company>';
      if (!(x.existingCompany && x.company)) lines.push(`capxul contact create ${q(x.newCompany || '<name>')} --type company${x.website ? ' --website ' + q(x.website) : ''}${x.industry ? ' --industry ' + q(x.industry) : ''} --territory ${q(x.territory)} --org harbourline`);
      const ctRef = x.existingContact && x.contact ? x.contact : (x.firstName || x.email ? '<new contact>' : null);
      if (!(x.existingContact && x.contact) && (x.firstName || x.email)) lines.push(`capxul contact create ${q([x.firstName, x.lastName].filter(Boolean).join(' ') || x.email)} --type person${x.email ? ' --email ' + x.email : ''}${x.mobile ? ' --phone ' + q(x.mobile) : ''} --company ${coRef} --org harbourline`);
      lines.push(`capxul org crm deal create --company ${coRef}${ctRef ? ` --contact ${ctRef} --primary ${ctRef}` : ''} --owner ${memberEmail(x.owner)}${x.value ? ` --value ${x.value} --expected-value ${x.value}` : ''} --currency ${x.currency} --close-by ${x.closeBy}${x.nextStep ? ' --next-step ' + q(x.nextStep) : ''} --source ${q(x.source)}`);
      if (x.status !== 'Qualification') lines.push(`capxul org crm deal move <new deal> ${q(x.status)}`);
      return lines;
    },
    check: (x) => (x.existingCompany && !x.company && !x.newCompany ? 'Please select an existing company, or name a new one.' : !x.existingCompany && !x.newCompany ? 'Name the new company.' : null),
    onSubmit: (x, close, cmd) => {
      let coId = x.existingCompany && x.company ? x.company : null;
      if (!coId) { coId = cx.slug(x.newCompany).toLowerCase(); if (!COMPANY.has(coId)) { const rec = { id: coId, name: x.newCompany, website: x.website || null, industry: x.industry || null, territory: x.territory, employees: null, annualRevenue: null, currency: x.currency, description: null, onCapxul: false, handle: null, safe: null, isCustomer: false }; C.companies.push(rec); COMPANY.set(coId, rec); } }
      let ctId = x.existingContact && x.contact ? x.contact : null;
      if (!ctId && (x.firstName || x.email)) { ctId = cx.slug([x.firstName, x.lastName].filter(Boolean).join(' ') || x.email).toLowerCase(); if (!CONTACT.has(ctId)) { const rec = { id: ctId, firstName: x.firstName, lastName: x.lastName, name: [x.firstName, x.lastName].filter(Boolean).join(' ') || x.email, company: coId, designation: null, email: x.email || null, mobile: x.mobile || null, onCapxul: false, handle: null, primary: true, createdAt: NOW() }; C.contacts.push(rec); CONTACT.set(ctId, rec); } }
      const name = nextName(`CRM-DEAL-${TODAY.slice(0, 4)}-`, C.deals.map((d) => d.name));
      const val = x.value ? +x.value : null;
      const at = NOW();
      const d = { title: `${companyName(coId)}: New deal`, subject: 'New deal', company: coId, contacts: ctId ? [{ contact: ctId, primary: true }] : [], status: 'Qualification', probability: 10, dealValue: val, currency: x.currency, expectedDealValue: val, expectedClosureDate: x.closeBy, closedDate: null, nextStep: x.nextStep || null, owner: x.owner, lostReason: null, lostNotes: null, createdAt: at, source: x.source, territory: x.territory, industry: COMPANY.get(coId)?.industry || x.industry || null, project: null, lead: null, name };
      C.deals.push(d);
      addItem(name, 'Deal', { kind: 'creation', text: `${cx.name(cx.meId())} created this deal`, at });
      if (x.status !== 'Qualification') { d.status = x.status; d.probability = stOf('deal', x.status).probability; addChanges('deal', d, [['Status', 'Qualification', x.status]]); }
      close(); cx.toast(`Created ${name}`, { tone: 'success', cmd: [].concat(cmd).at(-1) }); cx.go('deal', name);
    },
  });
}
/** The group-by view: one table, grouped by a field, each group collapsible with its count (and value, for deals). */
const grpCollapsed = new Map();
function groupedView(o) {
  const field = cx.store.get('crm-grp:' + o.key, o.fields[0].key);
  const f = o.fields.find((x) => x.key === field) || o.fields[0];
  const collapsed = grpCollapsed.get(o.key) || new Set(); grpCollapsed.set(o.key, collapsed);
  const rows = o.rows();
  const groups = new Map();
  for (const r of rows) { const v = (f.get ? f.get(r) : r[f.key]) || '(not set)'; if (!groups.has(v)) groups.set(v, []); groups.get(v).push(r); }
  const order = f.order ? [...groups.keys()].sort((a, b) => f.order.indexOf(a) - f.order.indexOf(b)) : [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length);
  const box = h('div.lv-card');
  const draw = () => {
    const body = [];
    for (const g of order) {
      const list = groups.get(g); const open = !collapsed.has(g);
      body.push(h('tr.crm-grp', h('td', { colspan: o.columns.length + 1 }, h('button', { type: 'button', 'aria-expanded': String(open), onclick: () => { open ? collapsed.add(g) : collapsed.delete(g); draw(); } }, cx.icon('down'), f.label2 ? f.label2(g) : f.key === 'status' ? stDot(o.kind, g) : f.type === 'person' ? cx.personChip(g, { link: false }) : g, h('small', fmt.int(list.length)), o.sum ? h('small', '· ' + o.sum(list)) : null))));
      if (open) for (const r of list) body.push(h('tr.click', { onclick: (e) => { if (e.target.closest('a')) return; cx.go(...o.href(r)); } }, h('td', o.title(r)), o.columns.map((c) => h('td', { class: { num: c.num, opt: c.opt } }, c.render(r)))));
    }
    cx.fill(box, h('div.lv-top', h('span', `${fmt.int(rows.length)} ${o.noun}s in ${fmt.plural(order.length, 'group')}`), h('span.grow'), cx.btn(collapsed.size ? 'Expand all' : 'Collapse all', { sm: true, kind: 'ghost', onClick: () => { if (collapsed.size) collapsed.clear(); else order.forEach((g) => collapsed.add(g)); draw(); } })),
      h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', o.titleLabel), o.columns.map((c) => h('th', { class: { num: c.num, opt: c.opt } }, c.label)))), h('tbody', body))));
  };
  draw();
  const sel = h('select.ctl', { 'aria-label': 'Group by', style: 'width:auto', onchange: (e) => { cx.store.set('crm-grp:' + o.key, e.target.value); cx.refresh(); } }, o.fields.map((x) => h('option', { value: x.key, selected: x.key === f.key }, x.label)));
  return h('div', { style: 'display:grid;gap:10px;min-width:0' }, viewBar(o.views, h('label.crm-sel', { style: 'font-size:13px;color:var(--muted)' }, 'Group by', sel)), box);
}
function leadsPage(view) {
  const create = cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, cmd: 'capxul org crm lead create --first-name … --company …', onClick: () => newLeadModal() });
  let body;
  if (view === 'list') body = leadsList();
  else if (view === 'kanban') {
    const rows = C.leads.filter((l) => !l.converted).sort((a, b) => String(modifiedOf(b)).localeCompare(String(modifiedOf(a))));
    body = h('div', { style: 'display:grid;gap:10px;min-width:0' }, viewBar(viewList('leads', 'leads-kanban'), h('span.muted', { style: 'font-size:12.5px' }, cx.allowed(NEED).ok ? 'Drag a card to change its status.' : lockLine())),
      cx.kanban({ key: 'crm-leads-kb', id: (r) => r.name, limit: 15,
        columns: ST.lead.map((st) => ({ key: st.name, label: st.name, color: st.color, items: rows.filter((r) => r.status === st.name) })),
        card: (l) => [h('div.kb-title', h('span.crm-name', extAvatar(leadName(l), { size: 'sm' }), h('span', leadName(l)))), h('div.kb-meta.crm-kbm', l.org ? h('span', l.org) : null, l.email ? h('span', l.email) : null, l.mobile ? h('span', l.mobile) : null), h('div.crm-call-h', l.owner ? cx.personChip(l.owner, { link: false }) : null, h('span.grow'), h('span.crm-when', { title: fmt.datetime(modifiedOf(l)) }, fmt.ago(modifiedOf(l)))), kbCounts(l)],
        onMove: (l, to) => moveRecord('lead', l, to),
        onOpen: (l) => cx.go('lead', l.name),
        colMenu: (col) => [{ label: 'New lead here', icon: 'plus', needs: NEED, onClick: () => newLeadModal({ status: col.key }) }] }));
    cx.setCommand({ cli: 'capxul org crm lead list', sdk: 'client.org(orgId).crm.leads.list()', note: 'A drag runs capxul org crm lead move.' });
  } else {
    body = groupedView({ key: 'leads', kind: 'lead', noun: 'lead', views: viewList('leads', 'leads-grouped'), rows: () => C.leads.filter((l) => !l.converted), titleLabel: 'Full name',
      title: (l) => h('span.crm-name', extAvatar(leadName(l), { size: 'sm' }), h('a', { href: cx.href('lead', l.name) }, leadName(l))),
      fields: [{ key: 'status', label: 'Status', order: ST.lead.map((x) => x.name) }, { key: 'source', label: 'Source' }, { key: 'owner', label: 'Lead owner', type: 'person' }, { key: 'territory', label: 'Territory' }, { key: 'industry', label: 'Industry' }],
      columns: [{ label: 'Company', render: (l) => l.org || '' }, { label: 'Status', render: (l) => stDot('lead', l.status) }, { label: 'Email', opt: true, render: (l) => l.email || '' }, { label: 'Assigned to', opt: true, render: (l) => (l.owner ? cx.personChip(l.owner, { link: false }) : '') }, { label: 'Last modified', opt: true, render: (l) => h('span.ago', fmt.ago(modifiedOf(l))) }],
      href: (l) => ['lead', l.name] });
    cx.setCommand({ cli: 'capxul org crm lead list', sdk: 'client.org(orgId).crm.leads.list()', note: 'Group by is drawn on this screen from the list.' });
  }
  return cx.page({ title: 'Leads', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }], actions: [create], body, fde: 'The Leads list in the CRM' });
}
function dealsPage(view) {
  const create = cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, cmd: 'capxul org crm deal create --company … --owner …', onClick: () => newDealModal() });
  let body;
  const gbpSum = (list) => fmt.compact(sum(list, (d) => toGbp(d.dealValue, d.currency)), 'GBP');
  if (view === 'list') body = dealsList(false);
  else if (view === 'pipeline') body = dealsList(true);
  else if (view === 'kanban') {
    const rows = [...C.deals].sort((a, b) => String(modifiedOf(b)).localeCompare(String(modifiedOf(a))));
    body = h('div', { style: 'display:grid;gap:10px;min-width:0' }, viewBar(viewList('deals', 'deals-kanban'), h('span.muted', { style: 'font-size:12.5px' }, cx.allowed(NEED).ok ? 'Drag a card to change its status. Won records the closed date; Lost asks why.' : lockLine())),
      cx.kanban({ key: 'crm-deals-kb', id: (r) => r.name, limit: 12,
        columns: ST.deal.map((st) => ({ key: st.name, label: st.name, color: st.color, items: rows.filter((r) => r.status === st.name) })),
        card: (d) => { const p = primaryOf(d); return [h('div.kb-title', h('span.crm-name', extAvatar(companyName(d.company), { size: 'sm', square: true }), h('span', dealTitle(d)))), h('div.kb-meta.crm-kbm', h('span', d.subject), h('span', { style: 'color:var(--fg);font-weight:600' }, d.dealValue != null ? fmt.money(d.dealValue, d.currency, 0) : '—', h('span.muted', { style: 'font-weight:400' }, ` · ${d.probability ?? 0}%`)), p?.email ? h('span', p.email) : null), h('div.crm-call-h', d.owner ? cx.personChip(d.owner, { link: false }) : null, h('span.grow'), h('span.crm-when', fmt.ago(modifiedOf(d)))), kbCounts(d)]; },
        onMove: (d, to) => moveRecord('deal', d, to),
        onOpen: (d) => cx.go('deal', d.name),
        colMenu: (col) => [{ label: 'New deal here', icon: 'plus', needs: NEED, onClick: () => newDealModal({ status: col.key }) }] }));
    cx.setCommand({ cli: 'capxul org crm deal list', sdk: 'client.org(orgId).crm.deals.list()', note: 'A drag runs capxul org crm deal move.' });
  } else {
    body = groupedView({ key: 'deals', kind: 'deal', noun: 'deal', views: viewList('deals', 'deals-grouped'), rows: () => C.deals, titleLabel: 'Company', sum: (list) => gbpSum(list),
      title: dealCompanyCell,
      fields: [{ key: 'status', label: 'Status', order: ST.deal.map((x) => x.name) }, { key: 'owner', label: 'Deal owner', type: 'person' }, { key: 'source', label: 'Source' }, { key: 'territory', label: 'Territory' }, { key: 'industry', label: 'Industry' }],
      columns: [{ label: 'Deal value', num: true, render: (d) => (d.dealValue != null ? fmt.money(d.dealValue, d.currency, 0) : '') }, { label: 'Status', render: (d) => stDot('deal', d.status) }, { label: 'Deal owner', opt: true, render: (d) => (d.owner ? cx.personChip(d.owner, { link: false }) : '') }, { label: 'Last modified', opt: true, render: (d) => h('span.ago', fmt.ago(modifiedOf(d))) }],
      href: (d) => ['deal', d.name] });
    cx.setCommand({ cli: 'capxul org crm deal list', sdk: 'client.org(orgId).crm.deals.list()', note: 'Group by is drawn on this screen from the list.' });
  }
  return cx.page({ title: view === 'pipeline' ? 'Pipeline' : 'Deals', workspace: 'crm', crumbs: view === 'pipeline' ? [{ label: 'CRM', route: 'crm' }, { label: 'Deals', route: 'deals' }] : [{ label: 'CRM', route: 'crm' }], sub: view === 'pipeline' ? 'A public view: the deals still in play, soonest closing first.' : null, actions: [create], body, fde: view === 'pipeline' ? 'The Pipeline view of open deals' : 'The Deals list in the CRM' });
}
cx.route('leads', () => leadsPage('list'), { workspace: 'crm', title: 'Leads' });
cx.route('leads-kanban', () => leadsPage('kanban'), { workspace: 'crm', title: 'Leads' });
cx.route('leads-grouped', () => leadsPage('group'), { workspace: 'crm', title: 'Leads' });
cx.route('deals', () => dealsPage('list'), { workspace: 'crm', title: 'Deals' });
cx.route('deals-kanban', () => dealsPage('kanban'), { workspace: 'crm', title: 'Deals' });
cx.route('deals-grouped', () => dealsPage('group'), { workspace: 'crm', title: 'Deals' });
cx.route('pipeline', () => dealsPage('pipeline'), { workspace: 'crm', title: 'Pipeline' });

/* =====================================================================================================
   Contacts and companies (the CRM's Organizations, called Companies in Capxul)
   ===================================================================================================== */

const escrowsFor = (email) => (email ? D.money.escrows.filter((e) => e.email && e.email.toLowerCase() === email.toLowerCase()) : []);
function newContactModal(preset = {}) {
  const m = { firstName: '', lastName: '', email: '', mobile: '', company: preset.company || '', designation: '' };
  formModal({ title: 'New contact', model: m, needs: NEED, submit: 'Create', who: 'whoever wears the People hat',
    fields: [{ label: 'First name', key: 'firstName', reqd: true }, { label: 'Last name', key: 'lastName' }, { label: 'Email', key: 'email' }, { label: 'Mobile no.', key: 'mobile' },
      { label: 'Company', key: 'company', type: 'select', options: [['', '—'], ...C.companies.map((c) => [c.id, c.name])] }, { label: 'Designation', key: 'designation' }],
    cmd: (x) => `capxul contact create ${q([x.firstName, x.lastName].filter(Boolean).join(' ') || '<name>')} --type person${x.email ? ' --email ' + x.email : ''}${x.mobile ? ' --phone ' + q(x.mobile) : ''}${x.designation ? ' --designation ' + q(x.designation) : ''}${x.company ? ' --company ' + x.company : ''} --org harbourline`,
    onSubmit: (x, close, cmd) => {
      const name = [x.firstName, x.lastName].filter(Boolean).join(' ');
      let id = cx.slug(name).toLowerCase(); if (CONTACT.has(id)) id += '-' + (C.contacts.length + 1);
      const rec = { id, firstName: x.firstName, lastName: x.lastName, name, company: x.company || null, designation: x.designation || null, email: x.email || null, mobile: x.mobile || null, onCapxul: false, handle: null, primary: false, createdAt: NOW() };
      C.contacts.push(rec); CONTACT.set(id, rec);
      close(); cx.toast(`${name} added to Harbourline's contacts`, { tone: 'success', cmd }); cx.go('contact', id);
    } });
}
function newCompanyModal() {
  const m = { name: '', website: '', description: '', revenue: '', currency: 'GBP', territory: 'United Kingdom', employees: '', industry: '' };
  formModal({ title: 'New company', model: m, needs: NEED, submit: 'Create', who: 'whoever wears the People hat',
    fields: [{ label: 'Company name', key: 'name', reqd: true, wide: true }, { label: 'Website', key: 'website' }, { label: 'Annual revenue', key: 'revenue', type: 'float' }, { label: 'Currency', key: 'currency', type: 'select', options: ['GBP', 'USD', 'EUR'] },
      { label: 'Territory', key: 'territory', type: 'select', options: TERRITORIES }, { label: 'No. of employees', key: 'employees', type: 'select', options: [['', '—'], ...EMPLOYEES] }, { label: 'Industry', key: 'industry', type: 'select', options: [['', '—'], ...INDUSTRIES] },
      { label: 'Company description', key: 'description', type: 'textarea', wide: true }],
    cmd: (x) => `capxul contact create ${q(x.name || '<name>')} --type company${x.website ? ' --website ' + q(x.website) : ''}${x.industry ? ' --industry ' + q(x.industry) : ''} --territory ${q(x.territory)}${x.employees ? ' --employees ' + x.employees : ''}${x.revenue ? ` --revenue ${x.revenue} --currency ${x.currency}` : ''}${x.description ? ' --description ' + q(x.description) : ''} --org harbourline`,
    onSubmit: (x, close, cmd) => {
      let id = cx.slug(x.name).toLowerCase(); if (COMPANY.has(id)) id += '-2';
      const rec = { id, name: x.name, website: x.website || null, industry: x.industry || null, territory: x.territory, employees: x.employees || null, annualRevenue: x.revenue ? +x.revenue : null, currency: x.currency, description: x.description || null, onCapxul: false, handle: null, safe: null, isCustomer: false };
      C.companies.push(rec); COMPANY.set(id, rec);
      close(); cx.toast(`${x.name} added`, { tone: 'success', cmd }); cx.go('company', id);
    } });
}
function linkModal(rec, isCompany) {
  const m = { to: rec.email || '' };
  formModal({ title: `Link ${rec.name} to pay`, model: m, cols: 1, needs: NEED, submit: 'Preview the link', who: 'whoever wears the People hat',
    intro: 'A private entry has no Party: money cannot reach it. Name the mailbox, handle or address it belongs to. Capxul shows who that is before it links, and links once.',
    fields: [{ label: 'Email, @handle or 0x address', key: 'to', reqd: true }],
    cmd: (x) => `capxul contact link ${rec.id} ${x.to || '<email|@handle|0x…>'} --confirm --org harbourline`,
    onSubmit: (x, close, cmd) => {
      close();
      sendPreview({ title: `Link ${rec.name}?`, rows: [['Entry', rec.name], ['Links to', x.to], ['After', /^@|^0x/.test(x.to) ? 'Payments go straight to that Party.' : 'Payments go to that mailbox; until its owner joins Capxul, money waits in escrow for them to claim.']], cmd, onSend: () => {
        if (/^@/.test(x.to)) { rec.handle = x.to; rec.onCapxul = true; } else if (/^0x/.test(x.to)) { rec.safe = x.to; rec.onCapxul = true; rec.handle = rec.handle || fmt.addr(x.to); } else rec.email = x.to;
        rec.linked = x.to;
        cx.toast(`${rec.name} is linked: ${x.to}`, { tone: 'success', cmd }); cx.refresh();
      } });
    } });
}
const dealsTable = (deals) => cx.grid({ numbered: false, empty: 'No deals yet. Use New deal to create one.', rowHref: (d) => ['deal', d.name], rows: deals, columns: [
  { key: 'subject', label: 'Deal', render: (d) => cx.link(d.subject || d.title, 'deal', d.name) },
  { key: 'dealValue', label: 'Amount', type: 'currency', render: (d) => (d.dealValue != null ? fmt.money(d.dealValue, d.currency) : '—') },
  { key: 'status', label: 'Status', render: (d) => stDot('deal', d.status) },
  { key: 'email', label: 'Email', opt: true, render: (d) => primaryOf(d)?.email || '' },
  { key: 'mobile', label: 'Mobile no.', opt: true, render: (d) => primaryOf(d)?.mobile || '' },
  { key: 'owner', label: 'Deal owner', opt: true, render: (d) => (d.owner ? cx.personChip(d.owner, { link: false }) : '') },
  { key: 'modified', label: 'Last modified', opt: true, render: (d) => h('span.ago', { title: fmt.datetime(modifiedOf(d)) }, fmt.ago(modifiedOf(d))) },
] });
function moneyList(items) {
  if (!items.length) return cx.empty('No money has moved on chain with them.');
  return h('div.crm-acts', [...items].sort((a, b) => String(b.at).localeCompare(String(a.at))).map((it) => moneyCard(it)));
}
function contactCapxul(c) {
  const cap = capxulOf(c);
  const esc = escrowsFor(c.email);
  const open = esc.filter((e) => e.status === 'Open');
  return h('div.crm-f-cap',
    h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, h('b', 'Capxul'), cx.pill(cap.word, cap.tone)),
    c.onCapxul && c.handle ? h('span', `On Capxul as ${c.handle}.${c.safe ? ` Pays to their Safe ${fmt.addr(c.safe)}.` : ' Paid to their Safe.'}`) : h('span', cap.line),
    open.map((e) => { const p = PAYMENT.get(e.payment); return h('div', { style: 'display:grid;gap:6px;margin-top:4px' }, h('span', h('b', fmt.usdc(e.amount)), ` sent from ${cx.deptName(e.from)} by ${cx.name(e.sentBy)}, waiting for ${c.firstName || c.name} to claim it since ${fmt.date(e.fundedAt)}.`), h('div.crm-btnrow', takeBackBtn(e, p), p && cx.hasRoute('payment') ? cx.btn('Open the payment', { sm: true, href: ['payment', p.id] }) : null)); }),
    esc.filter((e) => e.status !== 'Open').map((e) => h('span.muted', `${fmt.usdc(e.amount)} ${e.status === 'Claimed' ? 'claimed ' + fmt.date(e.claimedAt) : 'taken back ' + fmt.date(e.takenBackAt)}.`)),
    !c.onCapxul && !c.email ? h('div', cx.btn('Link to pay', { sm: true, icon: 'link', needs: NEED, cmd: `capxul contact link ${c.id} <email|@handle|0x…> --confirm --org harbourline`, onClick: () => linkModal(c) })) : null);
}
function contactPage(c) {
  const o = { kind: 'contact', rec: c };
  const F = (key, label, x = {}) => sideField({ label, get: () => c[key], set: (v) => { c[key] = v; if (key === 'firstName' || key === 'lastName') c.name = [c.firstName, c.lastName].filter(Boolean).join(' '); }, noTimeline: true, cmd: (v) => `capxul contact change ${c.id} ${{ firstName: '--first-name', lastName: '--last-name', email: '--email', mobile: '--phone', designation: '--designation', company: '--company' }[key]} ${q(v)} --org harbourline`, ...x }, o);
  const deals = dealsOfContact(c.id);
  const money = (TL.get(c.id) || []).filter((i) => i.kind === 'money');
  const leads = leadsOfContact(c.id);
  const tabs = [
    { label: 'Deals', count: deals.length, render: () => h('div', { style: 'padding:14px' }, dealsTable(deals)) },
    leads.length ? { label: 'Leads', count: leads.length, render: () => h('div', { style: 'padding:14px' }, cx.grid({ numbered: false, rows: leads, rowHref: (l) => ['lead', l.name], columns: [{ key: 'name', label: 'Lead', render: (l) => cx.link(l.name, 'lead', l.name) }, { key: 'status', label: 'Status', render: (l) => stDot('lead', l.status) }, { key: 'source', label: 'Source' }, { key: 'createdAt', label: 'Created', type: 'date' }] })) } : null,
    money.length ? { label: 'Money', count: money.length, render: () => h('div', { style: 'padding:14px' }, moneyList(money)) } : null,
  ].filter(Boolean);
  const side = h('aside.crm-side',
    h('div.crm-head', h('div.crm-head-top', extAvatar(c.name, { size: 'xl' }), h('div', { style: 'min-width:0' }, h('h2', c.name), h('div.muted', [c.designation, companyName(c.company)].filter(Boolean).join(' at ')))),
      h('div.crm-quick', cx.btn('', { icon: 'mail', title: 'Send an email', sm: true, onClick: () => cx.toast(deals[0] ? 'Emails are sent from a lead or deal, so they land on its timeline. Open a deal below.' : 'Emails are sent from a lead or deal, so they land on its timeline.', { tone: 'info' }) }))),
    sideSec('Details', [contactCapxul(c), F('firstName', 'First name'), F('lastName', 'Last name'), F('email', 'Email'), F('mobile', 'Mobile no.'),
      F('company', 'Company', { type: 'select', options: () => C.companies.map((x) => [x.id, x.name]), display: (v) => (v && COMPANY.has(v) ? cx.link(companyName(v), 'company', v) : null) }), F('designation', 'Designation')], { key: 'contact-details' }));
  return cx.page({
    title: c.name, workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }, { label: 'Contacts', route: 'contacts' }],
    sub: [c.designation, companyName(c.company), c.email].filter(Boolean).join(' · '),
    actions: [cx.btn('New deal', { kind: 'primary', icon: 'plus', needs: NEED, cmd: `capxul org crm deal create --company ${c.company || '<company>'} --contact ${c.id} --primary ${c.id}`, onClick: () => newDealModal({ company: c.company || '', contact: c.id }) })],
    banner: readOnlyBanner('this contact'),
    cmd: { cli: `capxul contact get ${c.id} --org harbourline`, sdk: `client.account.addressBook.get("${c.id}", { org: "harbourline" })` },
    fde: `Contact ${c.name}${c.company ? ' at ' + companyName(c.company) : ''}`,
    body: h('div.crm-rec.left', side, h('div.crm-main', cx.tabs(tabs, { key: 'crm-contact' }))),
  });
}
function companyPage(co) {
  const o = { kind: 'company', rec: co };
  const F = (key, label, x = {}) => sideField({ label, get: () => co[key], set: (v) => { co[key] = v; }, noTimeline: true, cmd: (v) => `capxul contact change ${co.id} ${CO_FLAG[key] || '--' + key} ${q(v)} --org harbourline`, ...x }, o);
  const deals = dealsOfCompany(co.id);
  const people = contactsOfCompany(co.id);
  const money = C.timeline.filter((i) => i.kind === 'money' && i.company === co.id);
  const paid = money.filter((i) => i.direction === 'in');
  const projects = (D.projects?.projects || []).filter((p) => p.customer === co.id);
  const cap = co.onCapxul
    ? h('div.crm-f-cap', h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, h('b', 'Capxul'), cx.pill(co.handle, 'green')), h('span', `A Capxul Organization, ${co.handle}. Pays to its company Safe ${fmt.addr(co.safe)}.`), paid.length ? h('span', `Paid since ${fmt.month(dayOf(paid[0].at).slice(0, 7))}: `, h('b', fmt.usdc(sum(paid, (i) => i.amount))), `, ${fmt.plural(paid.length, 'invoice')}.`) : null)
    : h('div.crm-f-cap', h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, h('b', 'Capxul'), cx.pill('Private', 'gray')), h('span', 'Private: not on Capxul. Its people can be paid by mailbox.'), paid.length ? h('span', `It has paid ${fmt.plural(paid.length, 'invoice')} on chain from a link: `, h('b', fmt.usdc(sum(paid, (i) => i.amount))), '.') : null);
  const tabs = [
    { label: 'Deals', count: deals.length, render: () => h('div', { style: 'padding:14px' }, dealsTable(deals)) },
    { label: 'Contacts', count: people.length, render: () => h('div', { style: 'padding:14px' }, cx.grid({ numbered: false, rows: people, empty: 'No contacts yet.', rowHref: (c) => ['contact', c.id], columns: [
      { key: 'name', label: 'Name', render: (c) => h('span.crm-name', extAvatar(c.name, { size: 'sm' }), cx.link(c.name, 'contact', c.id)) }, { key: 'email', label: 'Email' }, { key: 'mobile', label: 'Phone', opt: true },
      { key: 'cap', label: 'Capxul', render: (c) => cx.pill(capxulOf(c).word, capxulOf(c).tone) }, { key: 'mod', label: 'Last modified', opt: true, render: (c) => h('span.ago', fmt.ago(contactModified(c))) }] })) },
    money.length ? { label: 'Money', count: money.length, render: () => h('div', { style: 'padding:14px' }, moneyList(money)) } : null,
  ].filter(Boolean);
  const side = h('aside.crm-side',
    h('div.crm-head', h('div.crm-head-top', extAvatar(co.name, { size: 'xl', square: true }), h('div', { style: 'min-width:0' }, h('h2', co.name), h('div.muted', co.website || ''))),
      h('div.crm-quick', co.website ? cx.btn('', { icon: 'globe', title: 'Open website', sm: true, onClick: () => cx.toast(`Opens https://${co.website} in a new tab. The mock-up stays on this page.`, { tone: 'info' }) }) : null)),
    sideSec('Details', [cap,
      F('name', 'Company name', { readOnly: true }), F('description', 'Company description'), F('website', 'Website'), F('territory', 'Territory', { type: 'select', options: TERRITORIES }),
      F('industry', 'Industry', { type: 'select', options: INDUSTRIES }), F('employees', 'No. of employees', { type: 'select', options: EMPLOYEES }),
      F('annualRevenue', 'Annual revenue', { type: 'number', display: (v) => (v == null ? null : fmt.money(v, co.currency || 'GBP')) }),
      projects.length ? h('div.crm-f', h('div.crm-f-l', 'Projects'), h('div.crm-f-v', { style: 'display:grid;gap:2px' }, projects.map((p) => cx.link(`${p.name} · ${p.projectName}`, 'project', p.name)))) : null], { key: 'company-details' }));
  return cx.page({
    title: co.name, workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }, { label: 'Companies', route: 'companies' }],
    sub: [co.industry, co.territory, co.onCapxul ? co.handle : null].filter(Boolean).join(' · '),
    actions: [cx.btn('Add contact', { icon: 'user', needs: NEED, cmd: `capxul contact create "<name>" --type person --company ${co.id} --org harbourline`, onClick: () => newContactModal({ company: co.id }) }), cx.btn('New deal', { kind: 'primary', icon: 'plus', needs: NEED, cmd: `capxul org crm deal create --company ${co.id}`, onClick: () => newDealModal({ company: co.id }) })],
    banner: readOnlyBanner('this company'),
    cmd: { cli: [`capxul contact get ${co.id} --org harbourline`, `capxul org crm deal list --company ${co.id}`] },
    fde: `Company ${co.name}${co.onCapxul ? ' (' + co.handle + ' on Capxul)' : ''}`,
    body: h('div.crm-rec.left', side, h('div.crm-main', cx.tabs(tabs, { key: 'crm-company' }))),
  });
}
cx.route('contacts', () => cx.page({
  title: 'Contacts', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }],
  actions: [cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, cmd: 'capxul contact create "<name>" --type person --org harbourline', onClick: () => newContactModal() })],
  fde: 'The contacts in Harbourline\'s CRM',
  body: cx.listView({
    key: 'crm-contacts', rows: () => C.contacts, id: (r) => r.id, showId: false,
    titleCol: { key: 'name', label: 'Name', render: (r) => h('span.crm-name', extAvatar(r.name, { size: 'sm' }), h('a', { href: cx.href('contact', r.id) }, r.name)), sub: (r) => r.designation || '' },
    columns: [{ key: 'email', label: 'Email' }, { key: 'mobile', label: 'Phone' }, { key: 'companyName', label: 'Company', get: (r) => companyName(r.company) }, { key: 'capxul', label: 'Capxul', get: (r) => capxulOf(r).word, render: (r) => cx.pill(capxulOf(r).word, capxulOf(r).tone), keep: true }],
    modified: contactModified,
    filters: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'companyName', label: 'Company', type: 'select' }, { key: 'capxul', label: 'Capxul', type: 'select', options: ['By mailbox', 'Private', ...uniq(C.contacts.filter((c) => c.handle).map((c) => c.handle))] }],
    sort: { options: [{ key: 'modified', label: 'Last modified', get: (r) => contactModified(r) || '' }, { key: 'name', label: 'Name' }], default: { key: 'modified', dir: 'desc' } },
    groupBy: [{ key: 'companyName', label: 'Company', get: (r) => companyName(r.company) }, { key: 'capxul', label: 'Capxul', get: (r) => capxulOf(r).word }],
    href: (r) => ['contact', r.id],
    cmd: { cli: 'capxul contact list --org harbourline', sdk: 'client.account.addressBook.list({ org: "harbourline" })', filters: false },
    noun: 'contact',
  }),
}), { workspace: 'crm', title: 'Contacts' });
cx.route('contact', (ctx) => { const c = cx.find(C.contacts, 'id', ctx.id); return c ? contactPage(c) : notFound('contact', 'contacts', 'Contacts'); }, { workspace: 'crm', title: 'Contact' });
cx.route('companies', () => cx.page({
  title: 'Companies', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }],
  actions: [cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, cmd: 'capxul contact create "<name>" --type company --org harbourline', onClick: () => newCompanyModal() })],
  fde: 'The companies in Harbourline\'s CRM',
  body: cx.listView({
    key: 'crm-companies', rows: () => C.companies, id: (r) => r.id, showId: false,
    titleCol: { key: 'name', label: 'Company', render: (r) => h('span.crm-name', extAvatar(r.name, { size: 'sm', square: true }), h('a', { href: cx.href('company', r.id) }, r.name)) },
    columns: [{ key: 'website', label: 'Website' }, { key: 'industry', label: 'Industry' }, { key: 'annualRevenue', label: 'Annual revenue', type: 'currency', render: (r) => (r.annualRevenue != null ? fmt.money(r.annualRevenue, r.currency || 'GBP', 2) : h('span.faint', '—')) }, { key: 'capxul', label: 'Capxul', get: (r) => companyCapxul(r).word, render: (r) => cx.pill(companyCapxul(r).word, companyCapxul(r).tone) }],
    modified: companyModified,
    filters: [{ key: 'name', label: 'Company' }, { key: 'territory', label: 'Territory', type: 'select' }, { key: 'industry', label: 'Industry', type: 'select' }, { key: 'employees', label: 'No. of employees', type: 'select', options: EMPLOYEES }],
    sort: { options: [{ key: 'modified', label: 'Last modified', get: (r) => companyModified(r) || '' }, { key: 'name', label: 'Company' }, { key: 'annualRevenue', label: 'Annual revenue' }], default: { key: 'modified', dir: 'desc' } },
    groupBy: [{ key: 'industry', label: 'Industry' }, { key: 'territory', label: 'Territory' }],
    href: (r) => ['company', r.id],
    cmd: { cli: 'capxul contact list --org harbourline', sdk: 'client.account.addressBook.list({ org: "harbourline" })', filters: false, note: 'Companies are the book\'s entries of --type company.' },
    noun: 'company', nouns: 'companies',
  }),
}), { workspace: 'crm', title: 'Companies' });
cx.route('company', (ctx) => { const co = cx.find(C.companies, 'id', ctx.id); return co ? companyPage(co) : notFound('company', 'companies', 'Companies'); }, { workspace: 'crm', title: 'Company' });

/* =====================================================================================================
   Notes, tasks and call logs
   ===================================================================================================== */

const notesState = { q: '', type: '', by: '', limit: 24 };
cx.route('crm-notes', () => {
  const grid = h('div');
  const draw = () => {
    const t = notesState.q.toLowerCase();
    const list = C.notes.filter((n) => (!t || `${n.title} ${n.content}`.toLowerCase().includes(t)) && (!notesState.type || n.referenceType === notesState.type) && (!notesState.by || n.by === notesState.by)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    cx.fill(grid, list.length ? h('div.crm-notes', list.slice(0, notesState.limit).map((n) => noteTile(n, ctxFor(n.reference), true))) : cx.empty('No notes yet'),
      h('div.lv-foot', { style: 'border:0;padding:12px 0' }, h('span', `${fmt.int(Math.min(notesState.limit, list.length))} of ${fmt.int(list.length)}`), list.length > notesState.limit ? cx.btn('Load more', { sm: true, kind: 'ghost', onClick: () => { notesState.limit += 24; draw(); } }) : null));
  };
  const bar = h('div.lv-bar',
    h('input.ctl', { type: 'search', placeholder: 'Title or content', 'aria-label': 'Search notes', value: notesState.q, oninput: (e) => { notesState.q = e.target.value; notesState.limit = 24; draw(); } }),
    h('select.ctl', { 'aria-label': 'Record', onchange: (e) => { notesState.type = e.target.value; draw(); } }, [['', 'Leads and deals'], ['Lead', 'On leads'], ['Deal', 'On deals']].map(([v, l]) => h('option', { value: v, selected: v === notesState.type }, l))),
    h('select.ctl', { 'aria-label': 'Author', onchange: (e) => { notesState.by = e.target.value; draw(); } }, h('option', { value: '' }, 'Anyone'), uniq(C.notes.map((n) => n.by)).map((id) => h('option', { value: id, selected: id === notesState.by }, cx.name(id)))));
  draw();
  return cx.page({ title: 'Notes', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }],
    actions: [cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, cmd: 'capxul org crm note add <record> "<title>" --content "…"', onClick: () => pickRecord('New note: which lead or deal?', (ctx) => noteModal(ctx, null)) })],
    cmd: { cli: 'capxul org crm timeline <record> --kind note', note: 'Notes have no list of their own: each lead\'s and deal\'s timeline holds its notes. A note is never removed.' },
    fde: 'Every note in the CRM', body: [bar, grid] });
}, { workspace: 'crm', title: 'Notes' });

const TASK_TABS = [
  { label: 'Open', stage: ['open', 'working'], filter: (t) => ['Backlog', 'Todo', 'In Progress'].includes(t.status) },
  { label: 'Done', stage: ['done'], filter: (t) => t.status === 'Done' },
  { label: 'Canceled', stage: ['cancelled'], filter: (t) => t.status === 'Canceled' },
  { label: 'All', stage: [] },
];
const taskMoveNeed = (t) => () => cx.wears('People') || t.assignedTo === cx.meId() || `Moving a task needs the People hat, or to be its assignee (${cx.name(t.assignedTo)}).`;
function crmTasksPage(kanban) {
  const views = [{ label: 'List', route: 'crm-tasks', icon: 'list', active: !kanban }, { label: 'Kanban', route: 'crm-tasks-kanban', icon: 'kanban', active: kanban }];
  let body;
  if (!kanban) {
    body = cx.listView({
      key: 'crm-tasks', rows: () => C.tasks, id: (r) => r.name,
      titleCol: { key: 'title', label: 'Title', render: (r) => h('span.crm-name', taskIcon(r.status), h('span', r.title)), sub: (r) => `on ${recLabel(r.reference)}` },
      status: (r) => h('span.crm-tst', r.status),
      columns: [{ key: 'priority', label: 'Priority', render: (r) => prio(r.priority) }, { key: 'due', label: 'Due date', type: 'datetime' }, { key: 'assignedTo', label: 'Assigned to', type: 'person' }],
      modified: (r) => r.modifiedAt || r.at,
      filters: [{ key: 'title', label: 'Title' }, { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES }, { key: 'assignedTo', label: 'Assigned to', type: 'person' }, { key: 'status', label: 'Status', type: 'select', options: TASK_ST }],
      tabs: TASK_TABS,
      sort: { options: [{ key: 'due', label: 'Due date' }, { key: 'modified', label: 'Last modified', get: (r) => r.modifiedAt || r.at }], default: { key: 'modified', dir: 'desc' } },
      groupBy: [{ key: 'assignedTo', label: 'Assigned to', type: 'person' }, { key: 'priority', label: 'Priority' }],
      onOpen: (r) => taskModal(ctxFor(r.reference), r),
      views,
      cmd: (st) => { const stages = TASK_TABS[st.tab]?.stage || []; const who = st.filters.assignedTo; return { cli: `capxul org crm task list${stages.map((x) => ' --stage ' + x).join('')}${who ? ' --assigned-to ' + memberEmail(who) : ''}`, sdk: `client.org(orgId).crm.tasks.list(${stages.length || who ? `{ ${[stages.length ? `stage: ${JSON.stringify(stages)}` : null, who ? `assignedTo: "${memberEmail(who)}"` : null].filter(Boolean).join(', ')} }` : ''})` }; },
      noun: 'task', showId: true,
    });
  } else {
    const who = cx.store.get('crm-tasks-who', '');
    const rows = C.tasks.filter((t) => !who || t.assignedTo === who).sort((a, b) => String(b.modifiedAt || b.at).localeCompare(String(a.modifiedAt || a.at)));
    const sel = h('select.ctl', { 'aria-label': 'Assigned to', style: 'width:auto', onchange: (e) => { cx.store.set('crm-tasks-who', e.target.value); cx.refresh(); } }, h('option', { value: '' }, 'Everyone'), uniq(C.tasks.map((t) => t.assignedTo)).map((id) => h('option', { value: id, selected: id === who }, cx.name(id))));
    body = h('div', { style: 'display:grid;gap:10px;min-width:0' }, viewBar(views, sel),
      cx.kanban({ key: 'crm-tasks-kb', id: (r) => r.name, limit: 12,
        columns: TASK_ST.map((st) => ({ key: st, label: st, color: TASK_COLOR[st], items: rows.filter((t) => t.status === st) })),
        card: (t) => [h('div.kb-title', h('span.crm-name', taskIcon(t.status), h('span', t.title))), t.description ? h('div.kb-meta.crm-kbm', h('span', t.description)) : null, h('div.kb-meta.crm-kbm', h('span', 'on ', recLabel(t.reference))), h('div.crm-call-h', prio(t.priority), h('span.grow'), t.due ? h('span.crm-when', fmt.date(t.due)) : null), t.assignedTo ? cx.personChip(t.assignedTo, { link: false }) : null],
        onMove: (t, to) => { const ok = taskMoveNeed(t)(); if (ok !== true) { cx.toast(ok, { tone: 'warning' }); return false; } const cmd = `capxul org crm task move ${t.name} ${q(to)}`; t.status = to; t.modifiedAt = NOW(); cx.toast(`${t.title}: ${to}`, { tone: 'success', cmd }); cx.showAction(cmd, 'Move the task', { pin: true }); return true; },
        onOpen: (t) => taskModal(ctxFor(t.reference), t) }));
    cx.setCommand({ cli: `capxul org crm task list${who ? ' --assigned-to ' + memberEmail(who) : ''}`, note: 'A drag runs capxul org crm task move. The assignee may move their own task.' });
  }
  return cx.page({ title: 'Tasks', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }], sub: 'The CRM\'s own tasks, on leads and deals. Project tasks live in Projects.',
    actions: [cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, cmd: 'capxul org crm task create <record> "<title>"', onClick: () => taskModal(null, null) })],
    fde: 'The CRM tasks', body });
}
cx.route('crm-tasks', () => crmTasksPage(false), { workspace: 'crm', title: 'Tasks' });
cx.route('crm-tasks-kanban', () => crmTasksPage(true), { workspace: 'crm', title: 'Tasks' });

const callFrom = (c) => (c.type === 'Outgoing' ? HL_PHONE : numberOf(c.caller, c.reference));
const callTo = (c) => (c.type === 'Outgoing' ? numberOf(c.receiver, c.reference) : HL_PHONE);
cx.route('call-logs', () => cx.page({
  title: 'Call logs', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }],
  actions: [cx.btn('Log a call', { kind: 'primary', icon: 'phone', needs: NEED, cmd: 'capxul org crm call log <record> --type outgoing --status completed', onClick: () => pickRecord('Log a call: which lead or deal?', (ctx) => logCallModal(ctx)) })],
  fde: 'The CRM call logs',
  body: cx.listView({
    key: 'crm-calls', rows: () => C.calls, id: (r) => r.name,
    titleCol: { key: 'caller', label: 'Caller', render: (r) => h('span.crm-name', extAvatar(r.caller, { size: 'sm' }), h('span', r.caller)), sub: (r) => `on ${recLabel(r.reference)}` },
    status: (r) => r.status,
    columns: [{ key: 'receiver', label: 'Receiver' }, { key: 'type', label: 'Type', render: (r) => h('span.crm-tst', cx.icon(r.type === 'Outgoing' ? 'out' : 'in', { size: 13 }), r.type) }, { key: 'duration', label: 'Duration', align: 'right', render: (r) => durText(r.duration) }, { key: 'from', label: 'From', get: callFrom }, { key: 'to', label: 'To', get: callTo }],
    right: { key: 'at', label: 'Created on', type: 'datetime' },
    filters: [{ key: 'type', label: 'Type', type: 'select', options: ['Outgoing', 'Incoming'] }, { key: 'status', label: 'Status', type: 'select' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' }],
    sort: { options: [{ key: 'at', label: 'Created on' }, { key: 'duration', label: 'Duration' }], default: { key: 'at', dir: 'desc' } },
    groupBy: [{ key: 'caller', label: 'Caller' }, { key: 'status', label: 'Status' }],
    onOpen: (r) => callModal(r),
    cmd: { cli: 'capxul org crm timeline <record> --kind call', filters: false, note: 'Call logs have no list of their own: each record\'s timeline holds its calls. Every log is manual; Capxul has no telephony.' },
    noun: 'call', showId: false,
  }),
}), { workspace: 'crm', title: 'Call logs' });

/* =====================================================================================================
   The dashboard
   ===================================================================================================== */

const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['60', 'Last 60 days'], ['90', 'Last 90 days'], ['all', 'Since 1 May 2025']];
const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthKey = (d) => dayOf(d).slice(0, 7);
const monthLabel = (ym) => `${MONTHS3[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
function monthsBetween(a, b) { const out = []; let [y, m] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); while (y < yb || (y === yb && m <= mb)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } return out; }
const pctDelta = (now, before, noun) => (before && now === before ? { text: `the same as the ${noun} before` } : before ? { text: `${now >= before ? '+' : '−'}${Math.abs(Math.round(((now - before) / before) * 100))}% on the ${noun} before`, good: now >= before } : now ? { text: `none in the ${noun} before`, good: true } : null);
const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);
function crmDashboard() {
  const st = cx.store.get('crm-dash', { range: '30', user: '' });
  const range = RANGES.some(([k]) => k === st.range) ? st.range : '30';
  const user = st.user || '';
  const n = range === 'all' ? daysBetween('2025-05-01', TODAY) + 1 : +range;
  const from = addDays(TODAY, -(n - 1)), pFrom = addDays(from, -n), pTo = addDays(from, -1);
  const noun = range === 'all' ? 'period' : `${n} days`;
  const own = (r) => !user || r.owner === user;
  const inR = (d, a, b) => !!d && dayOf(d) >= a && dayOf(d) <= b;
  const leads = C.leads.filter(own), deals = C.deals.filter(own);
  const leadsIn = (a, b) => leads.filter((l) => inR(l.createdAt, a, b));
  const dealsIn = (a, b) => deals.filter((d) => inR(d.createdAt, a, b));
  const wonIn = (a, b) => deals.filter((d) => d.status === 'Won' && inR(d.closedDate, a, b));
  const gbp = (d) => toGbp(d.dealValue, d.currency, d.closedDate || d.createdAt);
  const ongoing = deals.filter((d) => ['open', 'ongoing'].includes(stageOf('deal', d.status)));
  const won = wonIn(from, TODAY), wonBefore = wonIn(pFrom, pTo);
  const leadTimes = won.filter((d) => d.lead).map((d) => { const l = C.leads.find((x) => x.name === d.lead); return l ? daysBetween(l.createdAt, d.closedDate) : null; }).filter((x) => x != null);
  const dealTimes = won.map((d) => daysBetween(d.createdAt, d.closedDate));
  const paid = C.timeline.filter((i) => i.kind === 'money' && i.direction === 'in' && inR(i.at, from, TODAY));
  const cards = [
    { label: 'Total leads', value: fmt.int(leadsIn(from, TODAY).length), sub: RANGES.find(([k]) => k === range)[1].toLowerCase(), delta: pctDelta(leadsIn(from, TODAY).length, leadsIn(pFrom, pTo).length, noun), href: ['leads'], cmd: 'capxul org crm lead list' },
    { label: 'Avg. time to close a lead', value: leadTimes.length ? `${Math.round(avg(leadTimes))} days` : '—', sub: 'lead created to deal won', cmd: 'capxul org crm deal list --stage won' },
    { label: 'Ongoing deals', value: fmt.int(ongoing.length), sub: 'not yet won or lost', href: ['pipeline'], cmd: 'capxul org crm deal list --stage ongoing' },
    { label: 'Won deals', value: fmt.int(won.length), sub: won.length ? won.map((d) => companyName(d.company)).slice(0, 2).join(', ') + (won.length > 2 ? '…' : '') : 'none in the range', delta: pctDelta(won.length, wonBefore.length, noun), href: ['deals'], cmd: 'capxul org crm deal list --stage won' },
    { label: 'Avg. won deal value', value: won.length ? fmt.gbp(avg(won.map(gbp))) : '—', sub: 'in pounds', cmd: 'capxul org crm deal list --stage won' },
    { label: 'Avg. deal value', value: [...ongoing, ...won].length ? fmt.gbp(avg([...ongoing, ...won].map(gbp))) : '—', sub: 'ongoing and won', cmd: 'capxul org crm deal list --stage ongoing' },
    { label: 'Avg. time to close a deal', value: dealTimes.length ? `${Math.round(avg(dealTimes))} days` : '—', sub: 'deal created to won', cmd: 'capxul org crm deal list --stage won' },
    { label: 'Paid on chain', value: fmt.usdc(sum(paid, (i) => i.amount)), sub: paid.length ? `${fmt.plural(paid.length, 'payment')} from customers on Capxul, each with its proof` : 'no customer paid on chain in the range', cmd: 'capxul org crm timeline <deal> --kind money' },
  ];
  // charts
  const daily = n <= 90;
  const buckets = daily ? Array.from({ length: n }, (_, i) => addDays(from, i)) : monthsBetween(monthKey(from), monthKey(TODAY));
  const bucketOf = (d) => (daily ? dayOf(d) : monthKey(d));
  const countBy = (arr, get) => { const m = new Map(buckets.map((b) => [b, 0])); for (const x of arr) { const k = bucketOf(get(x)); if (m.has(k)) m.set(k, m.get(k) + 1); } return buckets.map((b) => m.get(b)); };
  const trend = cx.chart.line({ labels: buckets.map((b) => (daily ? fmt.day(b) : monthLabel(b))), height: 220, format: (v) => fmt.int(v),
    series: [{ name: 'Leads', values: countBy(leadsIn(from, TODAY), (l) => l.createdAt), color: '2' }, { name: 'Deals', values: countBy(dealsIn(from, TODAY), (d) => d.createdAt), color: '3' }, { name: 'Won deals', values: countBy(won, (d) => d.closedDate), color: 'pos' }] });
  const fMonths = monthsBetween(monthKey(range === 'all' ? '2025-05-01' : addDays(TODAY, -Math.max(n, 90))), monthKey(addDays(TODAY, 100)));
  const forecast = fMonths.map((ym) => sum(ongoing.filter((d) => monthKey(d.expectedClosureDate) === ym), (d) => toGbp(d.expectedDealValue ?? d.dealValue, d.currency) * (d.probability || 0) / 100));
  const actual = fMonths.map((ym) => sum(deals.filter((d) => d.status === 'Won' && monthKey(d.closedDate) === ym), gbp));
  const fc = cx.chart.bar({ labels: fMonths.map(monthLabel), height: 220, format: (v) => fmt.compact(v, 'GBP'), tipFormat: (v) => fmt.gbp(v),
    series: [{ name: 'Forecasted', values: forecast, color: '3' }, { name: 'Actual (won)', values: actual, color: '1' }] });
  const leadsR = range === 'all' ? leads : leadsIn(from, TODAY);
  const dealsR = range === 'all' ? deals : dealsIn(from, TODAY);
  const funnel = cx.chart.hbar({ items: [{ label: 'Leads', value: leadsR.length, color: '2', href: ['leads'] }, { label: 'Deals', value: dealsR.length, color: '3', href: ['deals'] }, { label: 'Won', value: (range === 'all' ? deals.filter((d) => d.status === 'Won') : won).length, color: 'pos' }], format: (v) => fmt.int(v) });
  const byStage = cx.chart.donut({ items: ST.deal.filter((x) => ['Open', 'Ongoing'].includes(x.type)).map((x) => ({ label: x.name, value: ongoing.filter((d) => d.status === x.name).length, color: x.color })).filter((x) => x.value), center: String(ongoing.length), format: (v) => fmt.int(v) });
  const tally = (arr, get) => { const m = new Map(); for (const x of arr) { const k = get(x) || 'Not set'; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const PAL = ['1', '2', '3', '4', '5', '6'];
  const donutOf = (pairs) => (pairs.length ? cx.chart.donut({ items: pairs.map(([label, value], i) => ({ label, value, color: PAL[i % 6] })), center: fmt.int(sum(pairs, (p) => p[1])), format: (v) => fmt.int(v) }) : cx.empty('Nothing in this range'));
  const hbarOf = (pairs, color, route) => (pairs.length ? cx.chart.hbar({ items: pairs.map(([label, value]) => ({ label, value, color })), format: (v) => fmt.int(v) }) : cx.empty('Nothing in this range'));
  const lostR = dealsR.filter((d) => d.status === 'Lost');
  const charts = [
    { title: 'Sales trend', sub: 'Leads, deals and wins, by ' + (daily ? 'day' : 'month'), node: trend, wide: true, cmd: 'capxul org crm lead list · capxul org crm deal list' },
    { title: 'Forecasted revenue', sub: 'Expected value × probability, by expected closure month, against what was won', node: fc, wide: true, cmd: 'capxul org crm deal list --stage ongoing' },
    { title: 'Funnel conversion', sub: 'Lead to deal to won', node: funnel, cmd: 'capxul org crm lead list --stage converted' },
    { title: 'Deals by stage', sub: 'The pipeline now', node: ongoing.length ? byStage : cx.empty('No ongoing deals'), cmd: 'capxul org crm deal list --stage ongoing' },
    { title: 'Leads by source', node: donutOf(tally(leadsR, (l) => l.source)), cmd: 'capxul org crm lead list' },
    { title: 'Deals by source', node: donutOf(tally(dealsR, (d) => d.source)), cmd: 'capxul org crm deal list' },
    { title: 'Deals by territory', node: hbarOf(tally(dealsR, (d) => d.territory), '2'), cmd: 'capxul org crm deal list' },
    { title: 'Deals by salesperson', node: hbarOf(tally(dealsR, (d) => cx.name(d.owner)), '1'), cmd: 'capxul org crm deal list' },
    { title: 'Lost deal reasons', sub: 'Why deals were lost', node: hbarOf(tally(lostR, (d) => d.lostReason), 'neg'), cmd: 'capxul org crm deal list --stage lost' },
  ];
  const rangeSel = h('select.ctl', { 'aria-label': 'Range', onchange: (e) => { cx.store.set('crm-dash', { range: e.target.value, user }); cx.refresh(); } }, RANGES.map(([k, l]) => h('option', { value: k, selected: k === range }, l)));
  const userSel = h('select.ctl', { 'aria-label': 'Sales user', onchange: (e) => { cx.store.set('crm-dash', { range, user: e.target.value }); cx.refresh(); } }, h('option', { value: '' }, 'All sales users'), uniq([...C.deals, ...C.leads].map((r) => r.owner)).map((id) => h('option', { value: id, selected: id === user }, cx.name(id))));
  return cx.page({
    title: 'Dashboard', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }],
    sub: `${fmt.date(from)} to ${fmt.date(TODAY)}${user ? ' · ' + cx.name(user) : ''} · amounts in pounds; a dollar deal counts at the day's rate`,
    actions: [cx.btn('Refresh', { icon: 'refresh', onClick: () => cx.refresh() })],
    cmd: { cli: ['capxul org crm deal list --stage ongoing', 'capxul org crm lead list --stage open'], note: 'The dashboard has no command of its own: its cards count these lists.' },
    fde: `The CRM dashboard, ${RANGES.find(([k]) => k === range)[1].toLowerCase()}`,
    body: [
      h('div.crm-dash-bar', h('label', 'Range', rangeSel), h('label', 'Sales user', userSel)),
      h('div.ncards', cards.map((c) => cx.numberCard(c))),
      h('div.grid.c2.crm-dash', charts.map((c) => cx.card({ class: 'chart-card' + (c.wide ? ' wide' : ''), title: c.title, cmd: c.cmd, body: [c.sub ? h('p.muted', { style: 'font-size:12.5px;margin-bottom:8px' }, c.sub) : null, c.node] }))),
    ],
  });
}
cx.route('crm', () => crmDashboard(), { workspace: 'crm', title: 'CRM' });
