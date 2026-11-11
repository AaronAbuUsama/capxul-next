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
  if (c.email) return { word: 'By mailbox', tone: 'blue', line: 'Known by mailbox. Can be paid; the money waits in escrow until they claim it.' };
  return { word: 'Private', tone: 'gray', line: 'Not linked. Link to pay.' };
}
const companyCapxul = (co) => (co?.onCapxul ? { word: co.handle, tone: 'green' } : { word: 'Private', tone: 'gray' });
const counts = (items) => ({ email: items.filter((i) => i.kind === 'email').length, note: items.filter((i) => i.kind === 'note').length, task: items.filter((i) => i.kind === 'task').length, call: items.filter((i) => i.kind === 'call').length, whatsapp: items.filter((i) => i.kind === 'whatsapp').length, meeting: items.filter((i) => i.kind === 'meeting').length });

/* =====================================================================================================
   The sales agent. It brings leads in and moves them along: it logs every email and WhatsApp message from the
   shared mailbox and number, creates leads from the website form, email and WhatsApp, scores each one (fit,
   budget, timing, need), enriches the organisation, routes it to an owner, logs meetings from the owners'
   calendars, drafts follow-ups and proposes meetings for the owner to approve, and flags deals that have gone
   quiet. People decide, send and sell. Everything here is derived from each record's own history.
   ===================================================================================================== */

const AGENT = '@harbourline-sales';
const AGENT_NAME = 'Sales agent';
const agentAvatar = (size) => h('span.avatar.agent.t-teal', { class: size, title: AGENT_NAME, 'aria-hidden': 'true' }, 'SA');
const agentChip = () => h('span.person', agentAvatar('sm'), h('span', AGENT_NAME));
const isAgent = (id) => id === AGENT;
const whoChip = (id) => (isAgent(id) ? agentChip() : cx.personChip(id, { link: false }));
const whoName = (id) => (isAgent(id) ? 'the sales agent' : cx.name(id));
const hashOf = (t) => { let x = 2166136261; for (const c of String(t)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } return x; };
const pick = (key, arr) => arr[hashOf(key) % arr.length];
const isoPlus = (iso, mins) => new Date(Date.parse(iso) + mins * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;
const NOW0 = cx.now.toISOString().replace(/\.\d{3}Z$/, 'Z');
const TOUCH = new Set(['email', 'whatsapp', 'call', 'meeting']);
const lc1 = (t) => (t ? t[0].toLowerCase() + t.slice(1) : t);
const yours = (t) => String(t || '').replace(/\bour\b/g, 'your').replace(/\bOur\b/g, 'Your');
const uc1 = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const durHuman = (hrs) => (hrs == null ? '—' : hrs < 1 ? `${Math.max(1, Math.round(hrs * 60))} min` : hrs < 48 ? `${Math.round(hrs)} h` : hrs < 240 ? `${fmt.num(hrs / 24, 1)} days` : `${Math.round(hrs / 24)} days`);

/** How a lead reached Harbourline. */
const CHANNELS = ['Website form', 'Email', 'WhatsApp', 'Referral', 'Event', 'Campaign', 'Existing client'];
const CHANNEL_OF = { Website: 'Website form', Email: 'Email', Reference: 'Referral', Exhibition: 'Event', Campaign: 'Campaign', 'Existing Customer': 'Existing client' };
const CHANNEL_ICON = { 'Website form': 'globe', Email: 'mail', WhatsApp: 'message', Referral: 'user', Event: 'calendar', Campaign: 'send', 'Existing client': 'crm' };
const channelTag = (ch) => h('span.crm-tst', cx.icon(CHANNEL_ICON[ch] || 'crm', { size: 13 }), ch);

/** Industries Harbourline has won work in, with one client each, for "like Copperleaf". */
const WON_LIKE = new Map();
for (const d of C.deals) if (d.status === 'Won' && d.industry && !WON_LIKE.has(d.industry)) WON_LIKE.set(d.industry, companyName(d.company));
/** What each owner tends to look after, for routing. */
const OWNER_IND = new Map();
for (const l of C.leads) { if (!l.owner || !l.industry) continue; const m = OWNER_IND.get(l.owner) || new Map(); m.set(l.industry, (m.get(l.industry) || 0) + 1); OWNER_IND.set(l.owner, m); }
const topInd = (owner) => [...(OWNER_IND.get(owner) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
const SIZE_WORD = { '1-10': 'under 10 staff', '11-50': '11 to 50 staff', '51-200': '51 to 200 staff', '201-500': '201 to 500 staff', '501-1000': '501 to 1,000 staff', '1001-5000': 'over 1,000 staff', '1000+': 'over 1,000 staff' };
const JUNK_WHY = ['A services pitch to Harbourline, not a buyer', 'A link-building offer, not a buyer', 'An outsourcing pitch sent to many studios'];
const UNQ_WHY = ['The budget is too small for the scope', 'They want a fixed price for an open brief', 'They need it live within a month', 'They want a freelancer, not a studio'];

/** The lead's own history, oldest first (raw, without the derived items). */
const rawItems = (name) => (TL.get(name) || []).filter((i) => !i.derived).sort((a, b) => String(a.at).localeCompare(String(b.at)));
const textOf = (items) => items.map((i) => [i.body, i.content, i.note].filter(Boolean).join(' ')).join(' ');

/** Budget, timing and need as the agent reads them from the conversation so far. */
function readBudget(text) {
  let m = /Budget around £(\d+)k/.exec(text);
  if (m) return +m[1] >= 25 ? { level: 3, text: `About £${m[1]}k` } : { level: 1, text: `About £${m[1]}k, small for the scope` };
  if (/Budget signed off/.test(text)) return { level: 3, text: 'Signed off for this year' };
  m = /Budget depends on the board in (\w+)/.exec(text);
  if (m) return { level: 2, text: `Waits on the board in ${m[1]}` };
  if (/Budget not fixed/.test(text)) return { level: 2, text: 'Not fixed yet' };
  return { level: 0, text: 'Not known yet' };
}
function readTiming(text) {
  if (/Decision by the end of the quarter/.test(text)) return { level: 3, text: 'Deciding this quarter' };
  const m = /Peak is (\w+)/.exec(text);
  if (m) return { level: 3, text: `Must be ready before their ${m[1]} peak` };
  if (/next week or two|time next week|this week/.test(text)) return { level: 2, text: 'Talking to studios now' };
  return { level: 0, text: 'No date yet' };
}
function readNeed(l, items) {
  const em = items.find((i) => i.kind === 'email' && i.subject);
  if (em) {
    let t = em.subject.replace(/^(re|fwd?):\s*/i, '');
    if (l.org && t.endsWith(' for ' + l.org)) t = t.slice(0, -(' for ' + l.org).length);
    return t;
  }
  const n = items.find((i) => i.kind === 'note' && /looking at|interested in/i.test(i.content || ''));
  const m = n && /(?:looking at|interested in)\s+([^.]+)/i.exec(n.content);
  return m ? uc1(m[1]) : null;
}

/**
 * The agent's view of every lead: channel, arrival, qualification (fit, budget, timing, need, score, reason),
 * enrichment, routing, first reply and time to qualify. Recomputed when a record changes (cx.refresh).
 */
const QUAL = new Map();
function qualify(l) {
  const items = rawItems(l.name);
  const firstIn = items.find((i) => (i.kind === 'email' || i.kind === 'whatsapp') && i.direction === 'in');
  const creation = items.find((i) => i.kind === 'creation');
  let channel = CHANNEL_OF[l.source] || 'Email';
  if (channel === 'Website form' && l.mobile && hashOf(l.name) % 4 === 0) channel = 'WhatsApp';
  const captured = !!firstIn && firstIn.at <= (creation?.at || '9999') && channel !== 'Event';
  const arrival = captured ? (channel === 'WhatsApp' ? isoPlus(firstIn.at, -22) : firstIn.at) : creation?.at || l.createdAt;
  const scoredAt = isoPlus(arrival, 2 + (hashOf(l.name) % 3));
  const text = textOf(items);
  const need = readNeed(l, items);
  const budget = readBudget(text), timing = readTiming(text);
  const like = WON_LIKE.get(l.industry);
  const sizeOk = l.employees && l.employees !== '1-10';
  const fitLevel = like && sizeOk ? 3 : like || sizeOk ? 2 : 1;
  const fit = { level: fitLevel, text: like ? `${l.industry}, like ${like}` : l.industry ? `${l.industry} is new to Harbourline` : 'Sector unknown' };
  if (l.employees) fit.text += `; ${SIZE_WORD[l.employees] || l.employees}`;
  const needQ = { level: need ? 3 : 1, text: need || 'Not clear yet' };
  let score = 8 + fitLevel * 9 + budget.level * 7 + timing.level * 6 + (need ? 15 : 4) + (hashOf(l.name + 's') % 6);
  let reason = `${need ? uc1(need) + '. ' : ''}${fit.text}. Budget ${lc1(budget.text)}; ${lc1(timing.text)}.`;
  const junk = l.status === 'Junk';
  if (junk) {
    score = 3 + (hashOf(l.name) % 9);
    reason = pick(l.name, JUNK_WHY) + '.';
    fit.level = 1; fit.text = 'Not a buyer'; budget.level = 0; budget.text = 'None'; timing.level = 0; timing.text = 'None'; needQ.level = 0; needQ.text = 'None';
  } else if (l.status === 'Unqualified') {
    score = Math.min(score, 26 + (hashOf(l.name) % 18));
    reason = `${pick(l.name, UNQ_WHY)}. ${fit.text}.`;
  } else if (l.status === 'Qualified' || l.converted) score = Math.max(score, 70 + (hashOf(l.name) % 18));
  score = Math.max(1, Math.min(97, Math.round(score)));
  const updated = items.find((i) => i.kind === 'call' && i.status === 'Completed') || items.find((i) => i.kind === 'note' && /Budget|Decision|Peak/.test(i.content || ''));
  // routing
  const creator = creation?.by || l.owner;
  const tops = topInd(l.owner);
  const routeWhy = captured
    ? (l.industry && tops.includes(l.industry) ? `${cx.firstName(l.owner)} looks after ${l.industry}` : `next in the rotation for ${channel === 'WhatsApp' ? 'WhatsApp' : lc1(channel)} enquiries`)
    : creator === l.owner ? `${cx.firstName(l.owner)} brought it in` : `${cx.firstName(creator)} brought it in; ${cx.firstName(l.owner)} looks after ${l.industry || 'it'}`;
  // the first reply and the time to qualify
  const firstOut = items.find((i) => i.at > arrival && ((i.kind === 'email' || i.kind === 'whatsapp') && i.direction === 'out' || i.kind === 'call'));
  const qItem = items.find((i) => (i.kind === 'changed' && i.field === 'Status' && i.to === 'Qualified') || (i.kind === 'changes' && i.changes.some((c) => c[0] === 'Status' && c[2] === 'Qualified')) || i.kind === 'converted');
  const q = {
    channel, captured, arrival, scoredAt, score, reason, fit, budget, timing, need: needQ,
    updatedAt: updated && updated.at > scoredAt ? updated.at : null,
    routeWhy, creator,
    firstReplyAt: firstOut?.at || null, firstReplyHours: firstOut ? hoursBetween(arrival, firstOut.at) : null,
    qualifiedAt: qItem?.at || null, qualifyHours: qItem ? hoursBetween(arrival, qItem.at) : null,
    firstIn,
  };
  QUAL.set(l.name, q);
  return q;
}
const qualOf = (l) => QUAL.get(l.name) || qualify(l);
const scoreTone = (s) => (s >= 70 ? 'green' : s >= 45 ? 'yellow' : s >= 20 ? 'orange' : 'gray');
const scorePill = (s) => cx.pill(String(s), scoreTone(s));
const LEVEL = [['Unknown', 'gray'], ['Weak', 'red'], ['Partial', 'yellow'], ['Strong', 'green']];

/** Timeline items the agent adds: the lead it created, its score and routing, the WhatsApp that started it. */
const FREE_MAIL = /@(gmail|googlemail|hotmail|outlook|yahoo|icloud|me|live|btinternet|proton)\./i;
function deriveLeadItems(l) {
  if (!l.website && l.email && !FREE_MAIL.test(l.email) && l.status !== 'Junk') l.website = l.email.split('@')[1];
  const q = qualOf(l);
  const creation = q.captured ? rawItems(l.name).find((i) => i.kind === 'creation') : null;
  if (creation && creation.at > q.arrival) { creation.at = isoPlus(q.arrival, 1); TL.get(l.name).sort((a, b) => String(a.at).localeCompare(String(b.at))); }
  const out = [];
  if (q.channel === 'WhatsApp' && q.firstIn) {
    const first = l.firstName || 'them';
    out.push({ kind: 'whatsapp', direction: 'in', from: l.mobile, fromName: leadName(l), text: `Hi, is this Harbourline? We're ${l.org || 'a small team'} and we're looking at ${lc1(q.need.text === 'Not clear yet' ? 'a new project' : q.need.text)}. Can someone get back to me? ${first}`, at: q.arrival, loggedBy: AGENT });
  }
  out.push({ kind: 'agent', act: 'qualified', at: q.scoredAt, lead: l.name, captured: q.captured, loggedBy: AGENT });
  for (const it of out) { it.id = `agent_${l.name}_${it.kind}`; it.recordName = l.name; it.recordType = 'Lead'; it.derived = true; indexTl(it); }
}

/** Meetings the agent logged from the owners' calendars, and the ones booked ahead. */
const MEET_LOC = ['Video call', 'At their office', 'Harbourline studio, Hoxton'];
function deriveDealItems(d) {
  const items = [...(d.lead ? rawItems(d.lead) : []), ...rawItems(d.name)];
  const prim = primaryOf(d);
  const others = (d.contacts || []).map((c) => contactName(c.contact)).filter(Boolean);
  const people = [cx.name(d.owner), ...others.slice(0, 2)];
  const mk = (it) => Object.assign(it, { id: `agent_${d.name}_${it.title.replace(/\W+/g, '-')}`, recordName: d.name, recordType: 'Deal', kind: 'meeting', derived: true, loggedBy: AGENT, by: d.owner });
  const add = (it) => { indexTl(mk(it)); return it; };
  const moved = (to) => items.find((i) => (i.kind === 'changed' && i.field === 'Status' && i.to === to) || (i.kind === 'changes' && i.changes.some((c) => c[0] === 'Status' && c[2] === to)));
  const slot = (iso, back) => { const t = new Date(Date.parse(iso) - back * 3600000); t.setUTCMinutes(0, 0, 0); t.setUTCHours(t.getUTCHours() < 9 ? 9 : t.getUTCHours() > 16 ? 15 : t.getUTCHours()); return t.toISOString().replace(/\.\d{3}Z$/, 'Z'); };
  const demo = moved('Demo/Making');
  if (demo) add({ title: 'Discovery workshop', at: slot(demo.at, 26), minutes: 90, location: pick(d.name + 'w', MEET_LOC), attendees: people,
    notes: `Walked ${prim?.firstName || 'them'} through two similar projects, then through their brief for the ${lc1(d.subject)}. Agreed: Harbourline sends a scoped proposal${d.owner ? `; ${cx.firstName(d.owner)} writes it` : ''}.` });
  const neg = moved('Negotiation');
  if (neg) add({ title: 'Proposal walkthrough', at: slot(neg.at, 4), minutes: 60, location: pick(d.name + 'n', MEET_LOC), attendees: people,
    notes: `Went through the proposal line by line. ${prim?.firstName || 'They'} asked to phase the work and to see the support terms. Next: a revised plan and the contract.` });
  // booked ahead: a next step that names a call and a date
  const m = /(\d{1,2}) Nov/.exec(d.nextStep || '');
  if (m && !['Won', 'Lost'].includes(d.status) && /call/i.test(d.nextStep)) {
    const at = `2026-11-${String(m[1]).padStart(2, '0')}T${/with/i.test(d.nextStep) ? '10' : '14'}:00:00Z`;
    const booked = /with/i.test(d.nextStep);
    const it = mk({ title: d.nextStep.replace(/,?\s*(on\s+)?\d{1,2} Nov.*$/, '').trim(), at, minutes: 45, location: 'Video call', attendees: people, booked, upcoming: true, bookedAt: isoPlus(NOW0, -60 * 24 * 3 - 47),
      notes: booked ? 'Booked by the sales agent once ' + cx.firstName(d.owner) + ' approved: the first slot free in both calendars.' : null });
    if (booked) indexTl(it); else PROPOSED_MEETINGS.set(d.name, it);
  }
}
const PROPOSED_MEETINGS = new Map();

/** Who put an item on the timeline, and who drafted an outgoing email. */
function loggedBy(it) {
  if (it.loggedBy) return it.loggedBy;
  if (it.kind === 'email' || it.kind === 'whatsapp') return AGENT;
  if (it.kind === 'creation' && it.recordType === 'Lead') { const l = C.leads.find((x) => x.name === it.recordName); return l && qualOf(l).captured ? AGENT : it.by; }
  return it.by || null;
}
const draftedBy = (it) => (it.draftedBy !== undefined ? it.draftedBy : it.kind === 'email' && it.direction === 'out' && it.at >= '2026-03-01' && hashOf(it.id) % 3 !== 0 ? AGENT : null);

/** The last touchpoint on a record (emails, WhatsApp, calls, meetings; not future meetings). */
function lastTouch(rec) {
  const now = NOW();
  let best = null;
  for (const it of itemsOf(rec)) if (TOUCH.has(it.kind) && it.at <= now && !it.upcoming && (!best || it.at > best.at)) best = it;
  return best;
}
const STALE_DAYS = 14;
const isOpenDeal = (d) => ['open', 'ongoing'].includes(stageOf('deal', d.status));
function staleOf(d) {
  if (!isOpenDeal(d)) return null;
  const t = lastTouch(d);
  const days = t ? daysBetween(t.at, TODAY) : daysBetween(d.createdAt, TODAY);
  return days > STALE_DAYS ? days : null;
}
const TOUCH_WORD = { email: 'Email', whatsapp: 'WhatsApp', call: 'Call', meeting: 'Meeting' };
const touchCell = (rec) => { const t = lastTouch(rec); return t ? h('span.crm-tst', { title: fmt.datetime(t.at) }, cx.icon({ email: 'mail', whatsapp: 'message', call: 'phone', meeting: 'calendar' }[t.kind], { size: 13 }), `${TOUCH_WORD[t.kind]} · ${fmt.ago(t.at)}`) : h('span.faint', 'No touch yet'); };
const staleTag = (d) => { const n = staleOf(d); return n ? cx.pill(`Stale · ${n} d`, 'orange') : null; };

for (const l of C.leads) deriveLeadItems(l);
for (const d of C.deals) deriveDealItems(d);

/* ---------- what the agent proposes and what it did, for the assistant panel ---------- */

const DAYNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (d) => DAYNAME[new Date(dayOf(d) + 'T12:00:00Z').getUTCDay()];
function draftReply(l, q) {
  const first = l.firstName || 'there';
  const me = cx.firstName(l.owner);
  const like = WON_LIKE.get(l.industry);
  return `Hi ${first},\n\nThanks for getting in touch about ${q.need.level ? yours(lc1(q.need.text)) : 'your project'}.${like ? ` We did something close for ${like} last year and I'd be glad to show you.` : ''}\n\nWould 30 minutes on ${dayName(addDays(TODAY, 2))} or ${dayName(addDays(TODAY, 3))} work? I'll send a short deck of similar work before we talk.\n\n${me}`;
}
function draftNudge(name, first, me, topic) {
  return `Hi ${first},\n\nI wanted to check in on ${topic}. Is there anything you need from us before you decide, or a good time to talk this week?\n\n${me}`;
}
/** Send a drafted email once its owner approves it in the assistant panel. */
function sendDraft(kind, rec, d) {
  addItem(rec.name, recType(kind), { kind: 'email', direction: 'out', from: memberEmail(rec.owner), fromName: cx.name(rec.owner), to: [d.to], cc: [], subject: d.subject, body: d.body, attachments: [], draftedBy: AGENT, by: rec.owner });
  if (kind === 'lead' && rec.status === 'New') { rec.status = 'Contacted'; addChanges('lead', rec, [['Status', 'New', 'Contacted']]); }
  rec.modifiedAt = NOW();
  cx.toast(`Sent to ${d.to} (mock-up: nothing is sent)`, { tone: 'success' });
  cx.refresh();
}
function bookMeeting(d, it) {
  PROPOSED_MEETINGS.delete(d.name);
  const m = { ...it, proposed: false, booked: true, bookedAt: NOW(), notes: 'Booked by the sales agent once ' + cx.firstName(d.owner) + ' approved: the invite went to ' + (it.attendees.slice(1).join(' and ') || 'them') + '.' };
  indexTl(m);
  cx.toast(`${it.title} booked for ${fmt.datetime(it.at)} (mock-up: no invite is sent)`, { tone: 'success' });
  cx.refresh();
}
function registerAgentWork() {
  const add = cx.agentWork?.add;
  if (typeof add !== 'function') return;
  const put = (o) => { try { cx.agentWork.add({ agent: AGENT_NAME, module: 'crm', ...o }); } catch (e) { console.warn('agentWork.add', e); } };
  const quote = (d) => ` Draft to ${d.to}: "${d.body.split('\n').filter(Boolean).slice(1, -1).join(' ')}"`;
  const nowIso = NOW0;
  // replies drafted for new leads nobody has answered yet
  for (const l of C.leads) {
    if (l.converted || stageOf('lead', l.status) === 'lost') continue;
    const q = qualOf(l);
    const items = rawItems(l.name);
    const lastIn = [...items].reverse().find((i) => (i.kind === 'email' || i.kind === 'whatsapp') && i.direction === 'in');
    const lastOut = [...items].reverse().find((i) => ((i.kind === 'email' || i.kind === 'whatsapp') && i.direction === 'out') || i.kind === 'call');
    if (l.status === 'New' && lastIn && (!lastOut || lastOut.at < lastIn.at) && l.email) {
      const d = { to: l.email, subject: `Re: ${lastIn.subject || q.need.text}`, body: draftReply(l, q) };
      put({ key: `crm-reply-${l.name}`, kind: 'proposal', who: l.owner, at: isoPlus(q.scoredAt, 1), title: `Reply to ${leadName(l)}${l.org ? ' at ' + l.org : ''}`,
        detail: `Score ${q.score}: ${q.reason}` + quote(d), result: `Sent the reply to ${leadName(l)}`,
        route: ['lead', l.name], approveLabel: 'Send it', onApprove: () => sendDraft('lead', l, d) });
    } else if (l.status === 'Contacted' && lastOut && (!lastIn || lastIn.at < lastOut.at) && daysBetween(lastOut.at, TODAY) >= 7 && l.email) {
      const d = { to: l.email, subject: `Re: ${q.need.text}`, body: draftNudge(l.name, l.firstName || 'there', cx.firstName(l.owner), q.need.level ? yours(lc1(q.need.text)) : 'your project') };
      put({ key: `crm-nudge-${l.name}`, kind: 'proposal', who: l.owner, at: isoPlus(nowIso, -90 - (hashOf(l.name) % 120)), title: `Follow up with ${leadName(l)}${l.org ? ' at ' + l.org : ''}`,
        detail: `No reply since ${fmt.date(lastOut.at)}.` + quote(d), result: `Sent the follow-up to ${leadName(l)}`,
        route: ['lead', l.name], approveLabel: 'Send it', onApprove: () => sendDraft('lead', l, d) });
    }
  }
  // deals: nudges for quiet ones, meetings to book
  for (const d of C.deals) {
    if (!isOpenDeal(d)) continue;
    const p = primaryOf(d);
    const stale = staleOf(d);
    const meet = PROPOSED_MEETINGS.get(d.name);
    if (meet) put({ key: `crm-meet-${d.name}`, kind: 'proposal', who: d.owner, at: isoPlus(nowIso, -40), title: `Book "${meet.title}" with ${p?.name || dealTitle(d)}`,
      detail: `${fmt.datetime(meet.at)}, ${meet.minutes} min, video call: the first slot free in ${cx.firstName(d.owner)}'s and ${p?.firstName ? p.firstName + "'s" : 'their'} calendars. The invite is drafted.`,
      route: ['deal', d.name], approveLabel: 'Book it', result: `Booked "${meet.title}" with ${p?.name || dealTitle(d)}`, onApprove: () => bookMeeting(d, meet) });
    if (stale && p?.email) {
      const dd = { to: p.email, subject: `Re: ${d.subject}`, body: draftNudge(d.name, p.firstName || 'there', cx.firstName(d.owner), `the ${yours(lc1(d.subject))}`) };
      put({ key: `crm-stale-${d.name}`, kind: 'proposal', who: d.owner, at: isoPlus(nowIso, -150), title: `${dealTitle(d)} has gone quiet`,
        detail: `No touch for ${stale} days in ${d.status}. Next step: ${d.nextStep || 'none set'}.` + quote(dd), result: `Sent the check-in to ${p.name}`,
        route: ['deal', d.name], approveLabel: 'Send it', onApprove: () => sendDraft('deal', d, dd) });
    }
  }
  // done: the last seven days
  const since = addDays(TODAY, -6);
  for (const l of C.leads) {
    const q = qualOf(l);
    if (dayOf(q.scoredAt) < since) continue;
    put({ key: `crm-q-${l.name}`, kind: 'done', who: l.owner, at: q.scoredAt,
      title: `${q.captured ? 'Created and qualified' : 'Qualified'} ${leadName(l)}${l.org ? ', ' + l.org : ''}: score ${q.score}`,
      detail: `${q.channel}. ${q.reason} Routed to ${cx.name(l.owner)}: ${q.routeWhy}.`, route: ['lead', l.name] });
  }
  const logged = new Map();
  for (const it of C.timeline) if ((it.kind === 'email' || it.kind === 'whatsapp') && dayOf(it.at) >= since && it.at <= nowIso) { const k = dayOf(it.at); const e = logged.get(k) || { email: 0, whatsapp: 0, recs: new Set() }; e[it.kind]++; e.recs.add(it.recordName); logged.set(k, e); }
  for (const [day, e] of logged) {
    put({ key: `crm-log-${day}`, kind: 'done', who: null, at: `${day}T18:00:00Z` < nowIso ? `${day}T18:00:00Z` : nowIso,
      title: `Logged ${[e.email ? fmt.plural(e.email, 'email') : null, e.whatsapp ? fmt.plural(e.whatsapp, 'WhatsApp message') : null].filter(Boolean).join(' and ')} on ${fmt.plural(e.recs.size, 'record')}`,
      detail: 'From the shared sales mailbox and WhatsApp number, each on its record\'s timeline.', route: ['crm'] });
  }
  for (const d of C.deals) for (const it of TL.get(d.name) || []) if (it.kind === 'meeting' && it.upcoming && it.booked) {
    put({ key: `crm-booked-${d.name}`, kind: 'done', who: d.owner, at: it.bookedAt, title: `Booked "${it.title}" for ${fmt.datetime(it.at)}`, detail: `${dealTitle(d)}. The first slot free in both calendars.`, route: ['deal', d.name] });
  }
  const staleN = C.deals.filter(staleOf).length;
  if (staleN) put({ key: 'crm-stale-scan', kind: 'done', who: null, at: `${TODAY}T07:00:00Z`, title: `Flagged ${fmt.plural(staleN, 'deal')} with no touch for over two weeks`, detail: 'Marked Stale in the deal list, with a check-in drafted for each owner.', route: ['deals'] });
}

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
.crm-dash > .wide { grid-column: 1 / -1; } /* its own cards, not chart cards */
.crm-logged { display: flex; align-items: flex-start; gap: 6px; font-size: 11.5px; line-height: 16px; color: var(--muted); min-width: 0; }
.crm-logged > span { min-width: 0; overflow-wrap: anywhere; }
.crm-logged .avatar { width: 16px; height: 16px; font-size: 7.5px; }
.crm-score { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; align-items: center; }
.crm-score b { font: 600 20px/1 var(--font-ui); font-stretch: var(--wide); }
.crm-score .bar { height: 6px; border-radius: 3px; background: var(--sunk); overflow: hidden; }
.crm-score .bar i { display: block; height: 100%; }
.crm-qual { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; }
@media (max-width: 520px) { .crm-qual { grid-template-columns: minmax(0, 1fr); } }
.crm-qual > div { display: grid; gap: 2px; min-width: 0; }
.crm-qual small { color: var(--muted); font-size: 11.5px; }
.crm-qual span { overflow-wrap: anywhere; }
.crm-reason { color: var(--fg-2); overflow-wrap: anywhere; }
.crm-meet-h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.crm-meet-h .grow { flex: 1; }
.crm-list { display: grid; }
.crm-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 2px; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; min-width: 0; }
.crm-row:last-child { border-bottom: 0; }
.crm-row:hover { background: var(--hover); }
.crm-row .t { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crm-row .m { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 12px; color: var(--muted); min-width: 0; }
.crm-row .r { display: grid; justify-items: end; gap: 3px; font-size: 12px; color: var(--muted); }
.crm-next { font-size: 12.5px; color: var(--fg-2); overflow-wrap: anywhere; }
.kb-meta.crm-kbm .crm-next { white-space: normal; }
.crm-colsum { font-size: 12px; color: var(--muted); }
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
    { label: 'Pipeline', route: 'pipeline' },
    { label: 'Deals', route: 'deals', match: ['deal', 'deals-kanban', 'deals-grouped'] },
    { label: 'Contacts', route: 'contacts', match: ['contact'] },
    { label: 'Companies', route: 'companies', match: ['company'] },
    { label: 'Notes', route: 'crm-notes' },
    { label: 'Tasks', route: 'crm-tasks', match: ['crm-tasks-kanban'] },
    { label: 'Call logs', route: 'call-logs' },
    { section: 'Lead generation', items: [
      { label: 'Funnel', route: 'crm-funnel' },
      { label: 'Ideal customer', route: 'crm-icp' },
      { label: 'Prospects', route: 'prospects', match: ['prospect'] },
      { label: 'Outreach', route: 'sequences', match: ['sequence'] },
      { label: 'Inbound', route: 'crm-inbound' },
      { label: 'Nurture', route: 'nurture' },
      { label: 'Campaigns', route: 'campaigns', match: ['campaign'] },
    ] },
    { section: 'Reports', items: [{ label: 'Lead sources', route: 'crm-sources' }] },
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

/**
 * A dialog of fields: formModal({ title, model, fields, cols, submit, needs, check(model) → error text,
 * onSubmit(model, close), wide, intro }).
 */
function formModal(o) {
  const m = o.model;
  const mk = (f) => {
    if (!f) return null;
    if (f instanceof Node) return f;
    if (f.section) return h('div.crm-msec', f.section);
    if (f.node) return h('div.field', { class: { wide: f.wide } }, h('label', f.label), f.node);
    return cx.field({ ...f, model: m, edit: !f.readOnly, onChange: (v) => { f.onChange?.(v, m); } });
  };
  const body = h('div', { style: 'display:grid;gap:14px' },
    o.intro ? (o.intro instanceof Node ? o.intro : h('p.muted', { style: 'font-size:13px' }, o.intro)) : null,
    h('div.fields', { style: { '--cols': o.cols || 2 } }, o.fields.map(mk)));
  const md = cx.modal({
    title: o.title, wide: o.wide, body,
    actions: [cx.btn('Cancel', { onClick: () => md.close() }), cx.btn(o.submit || 'Save', { kind: 'primary', needs: o.needs, onClick: async () => {
      for (const f of o.fields) if (f && f.reqd && !f.readOnly && f.key && (m[f.key] == null || m[f.key] === '')) { cx.toast(`${f.label} is required.`, { tone: 'warning' }); return; }
      const err = o.check?.(m); if (err) { cx.toast(err, { tone: 'warning' }); return; }
      await o.onSubmit(m, () => md.close());
    } })],
  });
  return md;
}

/** The lost reason a lost status needs: resolves { reason, notes } or null. */
function askLostReason(kind, rec, to) {
  return new Promise((resolve) => {
    const m = { reason: '', notes: '' };
    let done = false;
    const md = cx.modal({
      title: 'Lost reason',
      body: h('div', { style: 'display:grid;gap:12px' },
        h('p.crm-lost', `Please provide a reason for marking this ${kind} as lost.`),
        cx.field({ label: 'Lost reason', key: 'reason', model: m, edit: true, reqd: true, type: 'select', options: [['', 'Choose a reason'], ...C.lostReasons] }),
        cx.field({ label: 'Lost notes', key: 'notes', model: m, edit: true, type: 'textarea', placeholder: 'Add more details about why it was lost' })),
      onClose: () => { if (!done) resolve(null); },
      actions: [cx.btn('Cancel', { onClick: () => md.close() }), cx.btn('Save', { kind: 'primary', onClick: () => {
        if (!m.reason) { cx.toast('Choose a lost reason.', { tone: 'warning' }); return; }
        if (m.reason === 'Other' && !m.notes.trim()) { cx.toast('Other needs lost notes.', { tone: 'warning' }); return; }
        done = true; md.close(); resolve({ reason: m.reason, notes: m.notes.trim() });
      } })],
    });
  });
}

/** Add an item to a record's timeline (and its own list). */
function addItem(recName, recordType, item) {
  const it = { id: newActId(), at: NOW(), by: cx.meId(), recordType, recordName: recName, ...item };
  C.timeline.push(it); indexTl(it);
  return it;
}
const recType = (kind) => (kind === 'lead' ? 'Lead' : kind === 'deal' ? 'Deal' : 'Contact');
/** Field changes as the CRM writes them: one line, or "Show +3 changes". */
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
  const changes = [['Status', from, to]];
  rec.status = to;
  if (kind === 'deal') {
    const p = stOf('deal', to).probability;
    if (p != null && rec.probability !== p) { changes.push(['Probability', rec.probability == null ? null : String(rec.probability), String(p)]); rec.probability = p; }
    if (to === 'Won') { rec.closedDate = TODAY; changes.push(['Closed Date', null, fmt.date(TODAY)]); }
  }
  if (lost) { rec.lostReason = lost.reason; rec.lostNotes = lost.notes || null; changes.push(['Lost Reason', null, lost.reason]); }
  addChanges(kind, rec, changes);
  cx.toast(`${recTitle(rec)} moved to ${to}`, { tone: 'success' });
  return true;
}
/** Log a call on a lead or deal without the form (other modules use it through cx.native). */
function logCallFor(kind, rec, o = {}) {
  const allow = cx.allowed(NEED);
  if (!allow.ok) { cx.toast(allow.reason, { tone: 'warning' }); return null; }
  const me = cx.me().name, other = o.other || recTitle(rec);
  const type = o.type || 'Outgoing', status = o.status || 'Completed';
  const at = o.at || NOW();
  const name = nextName('CALL-', C.calls.map((c) => c.name));
  const rec2 = { name, type, status, duration: status === 'Completed' ? Math.round((+o.minutes || 0) * 60) : 0, caller: type === 'Outgoing' ? me : other, receiver: type === 'Outgoing' ? other : me, note: o.note || null, at, by: cx.meId(), reference: rec.name, referenceType: recType(kind) };
  C.calls.push(rec2);
  addItem(rec.name, recType(kind), { kind: 'call', call: name, type: rec2.type, status: rec2.status, duration: rec2.duration, caller: rec2.caller, receiver: rec2.receiver, note: rec2.note, at });
  return rec2;
}
cx.native = Object.assign(cx.native || {}, { crmLogCall: logCallFor, crmMove: moveRecord });
/** The People hat's wearers, in a sentence, for locked controls. */
const lockLine = () => `Changes to the CRM need the People hat. ${namesList(peopleWearers())} ${peopleWearers().length === 1 ? 'wears' : 'wear'} it now.`;
/** For a member without the People hat: a quiet line saying who can change it. */
function readOnlyBanner(what) {
  if (cx.allowed(NEED).ok) return null;
  const forId = peopleWearers()[0];
  return cx.banner(h('span', `You can read ${what}. ${lockLine()}`), { tone: 'info', icon: 'lock' });
}

/* =====================================================================================================
   The activity timeline (oldest first, as the CRM shows it; a toggle turns it round)
   ===================================================================================================== */

const EMPTY = { email: 'No emails found', call: 'No call history', note: 'No notes found', task: 'No tasks found', whatsapp: 'No WhatsApp messages found', meeting: 'No meetings yet' };
/** The quiet line under a touchpoint: who put it on the timeline (and who drafted it). */
function loggedLine(it) {
  const by = loggedBy(it);
  const dr = draftedBy(it);
  if (!by && !dr) return null;
  const where = isAgent(by) && it.kind === 'email' ? ' from the sales mailbox' : isAgent(by) && it.kind === 'whatsapp' ? " from Harbourline's WhatsApp number" : isAgent(by) && it.kind === 'meeting' ? ' from ' + cx.firstName(it.by) + "'s calendar" : '';
  const text = dr
    ? `Drafted by the sales agent, approved and sent by ${cx.name(it.by || recOwner(it.recordName)) || 'its owner'}${by ? `; logged${where}` : ''}`
    : `Logged by ${whoName(by)}${where}`;
  return h('div.crm-logged', dr || isAgent(by) ? agentAvatar() : cx.avatar(by), h('span', text));
}
const recOwner = (name) => (C.leads.find((x) => x.name === name) || C.deals.find((x) => x.name === name))?.owner;
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
    loggedLine(it),
    ctx?.compose ? h('div.crm-mail-foot',
      cx.btn('Reply', { sm: true, icon: 'send', needs: NEED, onClick: () => ctx.compose.open({ replyTo: it }) }),
      cx.btn('Reply all', { sm: true, needs: NEED, onClick: () => ctx.compose.open({ replyTo: it, all: true }) })) : null);
  return actRow(out && it.by ? cx.avatar(it.by) : extAvatar(name), null, card, { ic: 'k-email' });
}
function callCard(it, ctx) {
  const c = callRec(it);
  const outb = c.type === 'Outgoing';
  const missed = c.status !== 'Completed';
  const card = h('div.crm-card.click', { onclick: () => callModal(c) },
    h('div.crm-call-h', cx.icon(outb ? 'out' : 'in', { size: 14 }), h('b', outb ? 'Outbound call' : 'Inbound call'), cx.pill(c.status), h('span.grow'), h('span.crm-badge', fmt.date(c.at)), h('span.crm-badge', durText(c.duration))),
    h('div.crm-call-who', extAvatar(c.caller, { size: 'sm' }), c.caller, cx.icon('right', { size: 12 }), extAvatar(c.receiver, { size: 'sm' }), c.receiver),
    c.note ? h('div', { style: 'color:var(--fg-2);white-space:pre-wrap;overflow-wrap:anywhere' }, c.note) : null,
    h('div.crm-logged', cx.avatar(c.by || it.by), h('span', `Logged by ${cx.name(c.by || it.by)}, with a short summary`)));
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
  return actRow(cx.icon('message'), line, h('div.crm-wa', waBubble(it), loggedLine(it)), { ic: 'k-whatsapp' });
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
  const signer = cx.holds(dept) ? cx.meId() : cx.holders(dept).find((x) => !String(x).startsWith('@')) || cx.meId();
  return cx.btn('Take it back', { sm: true, kind: 'danger', icon: 'swap', needs: { dept }, onClick: async () => {
    const r = await cx.approval({ title: `Take back ${fmt.usdc(esc.amount)} from ${esc.email}`, from: `Escrow ${fmt.addr(esc.escrowAddress)}`, to: `${cx.deptName(dept)} budget · Harbourline Treasury`, amount: esc.amount, asset: 'USDC', gbp: p?.gbp, rate: p?.rate, signer, hat: cx.deptName(dept), warnings: ['Nobody has claimed it yet. Once it is back, the claim link stops working.'] });
    if (r.status !== 'done') return;
    esc.status = 'Taken back'; esc.takenBackAt = r.at; esc.takenBackBy = cx.meId(); esc.takeBackTx = r.tx;
    if (p) p.status = 'Taken back';
    cx.toast(`${fmt.usdc(esc.amount)} is back in the ${cx.deptName(dept)} budget`, { tone: 'success' });
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
/** The agent's qualification of a lead, as it stands: score, the four checks, the organisation and the owner. */
function qualCard(l, o = {}) {
  const q = qualOf(l);
  const tone = scoreTone(q.score);
  const lvl = (x) => { if (!x.level) return h('span', cx.dot(x.text, 'gray')); const [w, t] = LEVEL[x.level]; return h('span', cx.dot(w, t), ' ', h('span.muted', x.text)); };
  return h('div.crm-card', { style: o.flat ? 'border:0;padding:0' : null },
    h('div.crm-score', h('b', String(q.score)), h('div', { style: 'display:grid;gap:4px;min-width:0' }, h('div.bar', h('i', { style: `width:${q.score}%;background:var(--t-${tone})` })), h('span.muted', { style: 'font-size:12px' }, 'Score out of 100'))),
    h('div.crm-reason', q.reason),
    h('div.crm-qual',
      h('div', h('small', 'Fit'), lvl(q.fit)), h('div', h('small', 'Budget'), lvl(q.budget)),
      h('div', h('small', 'Timing'), lvl(q.timing)), h('div', h('small', 'Need'), lvl(q.need))),
    o.org === false ? null : h('div.crm-qual',
      h('div', h('small', 'Organisation'), h('span', [l.org, l.employees ? SIZE_WORD[l.employees] || l.employees : null, l.industry].filter(Boolean).join(' · ') || '—')),
      h('div', h('small', 'Website'), h('span', l.website || '—')),
      h('div', h('small', 'Arrived by'), channelTag(q.channel)),
      h('div', h('small', 'Routed to'), h('span', l.owner ? cx.personChip(l.owner, { link: false }) : '—', h('span.muted', { style: 'font-size:12px' }, ' · ' + q.routeWhy)))),
    h('div.crm-logged', agentAvatar(), h('span', `Scored by the sales agent ${durHuman(hoursBetween(q.arrival, q.scoredAt))} after it arrived${q.updatedAt ? `; updated after the conversation on ${fmt.date(q.updatedAt)}` : ''}`)));
}
function meetingCard(it) {
  const end = isoPlus(it.at, it.minutes || 60);
  const card = h('div.crm-card',
    h('div.crm-meet-h', cx.icon('calendar', { size: 14 }), h('b', { style: 'overflow-wrap:anywhere' }, it.title), it.upcoming ? cx.pill(it.booked ? 'Booked' : 'Proposed', it.booked ? 'info' : 'muted') : null, h('span.grow'), h('span.crm-badge', `${fmt.day(it.at)}, ${fmt.time(it.at)} to ${fmt.time(end)}`), h('span.crm-badge', `${it.minutes || 60} min`)),
    h('div.crm-call-who', cx.icon('globe', { size: 12 }), it.location, h('span', '·'), (it.attendees || []).join(', ')),
    it.notes ? h('div', { style: 'color:var(--fg-2);white-space:pre-wrap;overflow-wrap:anywhere' }, it.notes) : null,
    loggedLine(it));
  return actRow(cx.icon('calendar'), [h('b', cx.name(it.by)), it.upcoming ? 'has a meeting booked' : 'had a meeting', when(it.at)], card, { ic: 'k-call' });
}
function actItem(it, ctx) {
  const kind = it.recordType === 'Lead' ? 'lead' : 'deal';
  const who = it.by ? h('b', cx.name(it.by)) : null;
  switch (it.kind) {
    case 'creation': {
      const by = loggedBy(it);
      if (kind === 'lead' && isAgent(by)) { const l = C.leads.find((x) => x.name === it.recordName); const q = l && qualOf(l); return actRow(agentAvatar(), [h('b', AGENT_NAME), `created this lead from ${q?.channel === 'Website form' ? 'the website form' : q?.channel === 'WhatsApp' ? 'a WhatsApp message' : q?.channel === 'Campaign' ? 'a reply to the campaign' : q?.channel === 'Referral' ? 'an introduction by email' : 'an email'}`, when(it.at)]); }
      return actRow(cx.icon(kind === 'lead' ? 'user' : 'crm'), [who, lineText(it), it.source ? h('span.muted', `· source ${it.source}`) : null, when(it.at)]);
    }
    case 'agent': {
      const l = C.leads.find((x) => x.name === it.recordName); if (!l) return null;
      const q = qualOf(l);
      return actRow(agentAvatar(), [h('b', AGENT_NAME), 'scored this lead and routed it', when(it.at)], h('div.crm-card',
        h('div.crm-call-h', scorePill(q.score), h('span.crm-reason', { style: 'flex:1;min-width:0' }, q.reason)),
        h('div.crm-call-who', h('span', [l.employees ? SIZE_WORD[l.employees] : null, l.industry, l.website].filter(Boolean).join(' · ') || 'Organisation not found'), h('span', '·'), h('span', 'routed to'), l.owner ? cx.personChip(l.owner, { link: false }) : '—', h('span', `(${q.routeWhy})`))));
    }
    case 'meeting': return meetingCard(it);
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
    cx.btn('Reply', { icon: 'mail', needs: NEED, onClick: () => api.open({}) }),
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
      const f = (spec) => cx.field({ ...spec, model: m, edit: true });
      cx.fill(root,
        h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('b', replyTo ? 'Reply' : 'New email'), h('span.muted', { style: 'font-size:12.5px' }, `from ${cx.me().name} <${memberEmail(cx.meId())}>`)),
        h('div.row2', f({ label: 'To', key: 'to' }), f({ label: 'Cc', key: 'cc', placeholder: 'Optional' })),
        f({ label: 'Subject', key: 'subject' }),
        f({ label: 'Message', key: 'body', type: 'textarea', rows: 6, placeholder: 'Write your email' }),
        h('div.crm-btnrow', cx.btn('Send', { kind: 'primary', icon: 'send', needs: NEED, onClick: () => {
          if (!m.to || !m.body.trim()) { cx.toast('Add who it goes to and a message.', { tone: 'warning' }); return; }
          if (!m.subject.trim()) { cx.toast('Add a subject.', { tone: 'warning' }); return; }
          sendPreview({ title: 'Send this email?', rows: [['From', `${cx.me().name} at Harbourline <${memberEmail(cx.meId())}>`], ['To', m.to], m.cc ? ['Cc', m.cc] : null, ['Subject', m.subject]], body: m.body, onSend: () => {
            addItem(ctx.rec.name, recType(ctx.kind), { kind: 'email', direction: 'out', from: memberEmail(cx.meId()), fromName: cx.me().name, to: [m.to], cc: m.cc ? m.cc.split(/[,\s]+/).filter(Boolean) : [], subject: m.subject, body: m.body, attachments: [], inReplyTo: replyTo?.id || null });
            ctx.rec.modifiedAt = NOW();
            cx.toast(`Sent to ${m.to} (mock-up: nothing is sent)`, { tone: 'success' });
            cx.refresh();
          } });
        } }), cx.btn('Discard', { kind: 'ghost', onClick: () => closed() }), h('span.grow'), h('span.muted', { style: 'font-size:12px' }, 'You answer a preview before it goes.')));
      root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => root.querySelector('textarea')?.focus(), 60);
    },
  };
  closed();
  return api;
}
/** The preview a send answers before it goes. */
function sendPreview(o) {
  const md = cx.modal({ title: o.title, body: h('div', { style: 'display:grid;gap:12px' },
    h('div.sheet', o.rows.filter(Boolean).map(([k, v]) => h('div.sheet-row', h('span', k), h('span', v)))),
    o.body ? h('div.crm-card', h('div.crm-mail-body', o.body)) : null,
    h('p.muted', { style: 'font-size:12.5px' }, 'Nothing goes until you press Send.')),
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
    c.note ? h('div.crm-card', h('b', 'Summary'), h('div', { style: 'white-space:pre-wrap;color:var(--fg-2)' }, c.note)) : null), actions: [{ label: 'Close', primary: true }] });
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
    title: 'Log a call', model: m, needs: NEED, submit: 'Log the call', 
    intro: 'Capxul has no telephony: a call you made or took on your phone is logged by hand.',
    fields: [
      { label: 'Type', key: 'type', type: 'select', options: ['Outgoing', 'Incoming'] },
      { label: 'Status', key: 'status', type: 'select', options: ['Completed', 'No Answer', 'Busy', 'Failed', 'Canceled'] },
      { label: 'Number', key: 'number' },
      { label: 'Started', node: startInput },
      { label: 'Duration (minutes)', key: 'minutes', type: 'int' },
      { label: 'Note', key: 'note', type: 'textarea', wide: true, placeholder: 'What was said' },
    ],
    onSubmit: (x, close) => {
      const me = cx.me().name, other = ctx.personName || ctx.name;
      const at = new Date(x.start + ':00Z').toISOString().replace(/\.\d{3}Z$/, 'Z');
      const name = nextName('CALL-', C.calls.map((c) => c.name));
      const rec = { name, type: x.type, status: x.status, duration: x.status === 'Completed' ? Math.round((+x.minutes || 0) * 60) : 0, caller: x.type === 'Outgoing' ? me : other, receiver: x.type === 'Outgoing' ? other : me, note: x.note || null, at, by: cx.meId(), reference: ctx.rec.name, referenceType: recType(ctx.kind) };
      C.calls.push(rec);
      addItem(ctx.rec.name, recType(ctx.kind), { kind: 'call', call: name, type: rec.type, status: rec.status, duration: rec.duration, caller: rec.caller, receiver: rec.receiver, note: rec.note, at });
      close(); cx.toast('Call logged', { tone: 'success' }); cx.refresh();
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
    title: note ? 'Edit note' : 'New note', model: m, cols: 1, needs: NEED, submit: note ? 'Update' : 'Create', 
    fields: [{ label: 'Title', key: 'title', reqd: true, placeholder: 'Call with John Doe' }, { label: 'Content', key: 'content', type: 'textarea', rows: 7, placeholder: 'Took a call with John Doe and discussed the new project.' }],
    onSubmit: (x, close) => {
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
      close(); cx.toast(note ? 'Note updated' : 'Note added', { tone: 'success' }); cx.refresh();
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
  formModal({
    title: t ? t.title : 'New task', model: m, needs: t ? (canMove || canEdit ? null : NEED) : NEED, submit: t ? 'Update' : 'Create', 
    intro: t ? h('div.muted', { style: 'font-size:12.5px' }, `${t.name} · on `, cx.link(recLabel(t.reference), recRoute(t.reference), t.reference), ` · added by ${cx.name(t.by)} ${fmt.agoLong(t.at)}`) : null,
    fields,
    check: (x) => (!t && !x.reference ? 'Choose the lead or deal this task is for.' : null),
    onSubmit: (x, close) => {
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
      close(); cx.toast(t ? 'Task updated' : 'Task created', { tone: 'success'}); cx.refresh();
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
  const first = ctx.firstName || (ctx.personName || ctx.name || '').split(' ')[0];
  const m = { text: '', template: WA_TEMPLATES[0].name };
  const box = h('div.crm-wa-box',
    open ? null : cx.banner(`The last message from ${first || 'them'} is more than 24 hours old, so WhatsApp only takes an approved template now.`, { tone: 'info' }),
    open ? cx.field({ label: 'Message', key: 'text', model: m, edit: true, type: 'textarea', rows: 2, placeholder: 'Type your message' })
      : cx.field({ label: 'Template', key: 'template', model: m, edit: true, type: 'select', options: WA_TEMPLATES.map((t) => [t.name, `${t.name}: ${t.text(first)}`]) }),
    h('div.crm-btnrow', h('span.muted', { style: 'font-size:12.5px' }, `To ${ctx.mobile}, from Harbourline's WhatsApp number`), h('span.grow'),
      cx.btn('Send', { kind: 'primary', icon: 'send', needs: NEED, onClick: () => {
        const text = open ? m.text.trim() : WA_TEMPLATES.find((t) => t.name === m.template).text(first);
        if (!text) { cx.toast('Type a message first.', { tone: 'warning' }); return; }
        sendPreview({ title: 'Send this WhatsApp message?', rows: [['To', ctx.mobile], ['From', "Harbourline's WhatsApp number"], open ? null : ['Template', m.template]], body: text, onSend: () => {
          addItem(ctx.rec.name, recType(ctx.kind), { kind: 'whatsapp', direction: 'out', from: 'Harbourline', to: ctx.mobile, text, template: open ? null : m.template, status: 'sent' });
          cx.toast(`Sent to ${ctx.mobile} (mock-up: nothing is sent)`, { tone: 'success' }); cx.refresh();
        } });
      } })));
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
 * and the change lands on the timeline. d: { label, get, set, display, type, options, text(v), noTimeline }
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
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const nv = read();
      if (String(nv ?? '') === String(v ?? '')) { wrap.replaceChild(val, input); return; }
      d.set(nv);
      if (!d.noTimeline) addChanges(o.kind, o.rec, [[d.field || d.label, v == null || v === '' ? null : (d.text ? d.text(v) : String(v)), nv == null || nv === '' ? '—' : (d.text ? d.text(nv) : String(nv))]]);
      cx.toast(`${d.label} saved`, { tone: 'success'});
      cx.refresh();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.stopPropagation(); done = true; wrap.replaceChild(val, input); } });
    if (d.type === 'select' || d.type === 'date') input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    wrap.replaceChild(input, val);
    input.focus();
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
    cx.btn('', { icon: 'file', title: 'Attach a file', sm: true, onClick: () => cx.toast('Attachments travel on emails in this mock-up.', { tone: 'info' }) }),
  ];
}
function leadSide(l, ctx) {
  const o = { kind: 'lead', rec: l };
  const F = (key, label, x = {}) => sideField({ label, get: () => l[key], set: (v) => { l[key] = v; }, ...x }, o);
  const ct = CONTACT.get(l.contact);
  const cap = l.converted && ct ? capxulOf(ct)
    : { line: 'A lead. Capxul names this person in its directory only once the lead is converted; until then Harbourline cannot pay them.' };
  return h('aside.crm-side',
    idBtn(l.name),
    h('div.crm-head', h('div.crm-head-top', extAvatar(leadName(l), { size: 'xl' }), h('div', { style: 'min-width:0' }, h('h2', leadName(l)), h('div.muted', [l.jobTitle, l.org].filter(Boolean).join(' at ')))),
      h('div.crm-quick', quickBtns(ctx, l.website))),
    sideSec('Qualification', [qualCard(l, { flat: true, org: false })], { key: 'lead-qual' }),
    sideSec('Organisation', [
      F('org', 'Company', { display: (v) => (v && l.company && COMPANY.has(l.company) ? cx.link(v, 'company', l.company) : v) }),
      F('website', 'Website'),
      F('industry', 'Sector', { type: 'select', options: INDUSTRIES }),
      F('employees', 'Size', { type: 'select', options: EMPLOYEES, display: (v) => (v ? SIZE_WORD[v] || v : null) }),
      F('territory', 'Territory', { type: 'select', options: TERRITORIES }),
      h('div.crm-logged', { style: 'padding:2px 4px 4px' }, agentAvatar(), h('span', `Enriched by the sales agent from the website and Companies House, ${fmt.date(qualOf(l).scoredAt)}`)),
    ], { key: 'lead-org' }),
    sideSec('Routing', [
      h('div.crm-f', h('div.crm-f-l', 'Arrived by'), h('div.crm-f-v', channelTag(qualOf(l).channel))),
      h('div.crm-f', h('div.crm-f-l', 'Arrived'), h('div.crm-f-v', fmt.datetime(qualOf(l).arrival))),
      h('div.crm-f', h('div.crm-f-l', 'First touch'), h('div.crm-f-v', srcNode(firstTouchOf(l)))),
      lastTouchOf(l).ref || lastTouchOf(l).route ? h('div.crm-f', h('div.crm-f-l', lastTouchOf(l).ref ? 'Introduced by' : 'Came in through'), h('div.crm-f-v', srcNode(lastTouchOf(l)))) : null,
      F('source', 'Source', { type: 'select', options: SOURCES }),
      F('owner', 'Lead owner', { type: 'select', options: ownerOpts, display: (v) => (v ? cx.personChip(v, { link: false }) : null), text: (v) => cx.name(v) }),
      h('div.crm-f', h('div.crm-f-l', 'Why them'), h('div.crm-f-v', uc1(qualOf(l).routeWhy))),
      h('div.crm-f', h('div.crm-f-l', 'First reply'), h('div.crm-f-v', qualOf(l).firstReplyAt ? `${durHuman(qualOf(l).firstReplyHours)} after it arrived` : h('span.faint', 'Not yet'))),
    ], { key: 'lead-routing' }),
    sideSec('Person', [
      F('firstName', 'First name'), F('lastName', 'Last name'), F('jobTitle', 'Job title'), F('email', 'Email'), F('mobile', 'Mobile no.'),
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
        { label: 'Set as primary contact', icon: 'check', needs: NEED, disabled: entry.primary, onClick: () => { const old = primaryOf(d); d.contacts.forEach((x) => { x.primary = x.contact === c.id; }); addChanges('deal', d, [['Primary Contact', old?.name || null, c.name]]); cx.toast(`${c.name} is the primary contact`, { tone: 'success'}); cx.refresh(); } },
        { label: 'Remove', icon: 'x', danger: true, needs: NEED, disabled: d.contacts.length < 2, reason: 'A deal keeps at least one contact.', onClick: () => { d.contacts = d.contacts.filter((x) => x.contact !== c.id); if (!d.contacts.some((x) => x.primary)) d.contacts[0].primary = true; addChanges('deal', d, [['Contacts', c.name, '—']]); cx.toast(`${c.name} removed from the deal`, { tone: 'success'}); cx.refresh(); } },
      ], { sm: true, kind: 'ghost' }),
      h('a.btn.sm.ghost', { href: cx.href('contact', c.id), title: `Open ${c.name}`, 'aria-label': `Open ${c.name}` }, cx.icon('right'))),
    body);
}
function addContactModal(d) {
  const m = { contact: '' };
  const here = contactsOfCompany(d.company).filter((c) => !d.contacts.some((x) => x.contact === c.id));
  const others = C.contacts.filter((c) => c.company !== d.company && !d.contacts.some((x) => x.contact === c.id));
  formModal({ title: 'Add a contact to the deal', model: m, cols: 1, needs: NEED, submit: 'Add', 
    fields: [{ label: 'Contact', key: 'contact', type: 'select', reqd: true, options: [['', 'Search contacts'], ...here.map((c) => [c.id, `${c.name} · ${companyName(d.company)}`]), ...others.map((c) => [c.id, `${c.name}${c.company ? ' · ' + companyName(c.company) : ''}`])] }],
    onSubmit: (x, close) => { d.contacts.push({ contact: x.contact, primary: !d.contacts.length }); addChanges('deal', d, [['Contacts', null, contactName(x.contact)]]); close(); cx.toast(`${contactName(x.contact)} added to the deal`, { tone: 'success' }); cx.refresh(); } });
}
function dealSide(d, ctx) {
  const o = { kind: 'deal', rec: d };
  const co = COMPANY.get(d.company) || { name: d.title, id: d.company };
  const F = (key, label, x = {}) => sideField({ label, get: () => d[key], set: (v) => { d[key] = v; }, ...x }, o);
  const CO = (key, label, x = {}) => sideField({ label, get: () => co[key], set: (v) => { co[key] = v; }, noTimeline: true, ...x }, o);
  const money = (v) => (v == null || v === '' ? null : fmt.money(v, d.currency, 2));
  return h('aside.crm-side',
    idBtn(d.name),
    h('div.crm-head', h('div.crm-head-top', extAvatar(co.name, { size: 'xl', square: true }), h('div', { style: 'min-width:0' }, h('h2', COMPANY.has(co.id) ? cx.link(co.name, 'company', co.id) : co.name), h('div.muted', co.onCapxul ? `${co.handle} · Safe ${fmt.addr(co.safe)}` : (co.website || '')))),
      h('div.crm-quick', quickBtns(ctx, co.website))),
    sideSec('Progress', [
      h('div.crm-f', h('div.crm-f-l', 'Stage'), h('div.crm-f-v', stDot('deal', d.status), ' ', staleTag(d))),
      F('owner', 'Deal owner', { type: 'select', options: ownerOpts, display: (v) => (v ? cx.personChip(v, { link: false }) : null), text: (v) => cx.name(v) }),
      h('div.crm-f', h('div.crm-f-l', 'Last touch'), h('div.crm-f-v', touchCell(d))),
      F('nextStep', 'Next step'),
      h('div.crm-f', h('div.crm-f-l', 'Next meeting'), h('div.crm-f-v', (() => { const m = itemsOf(d).find((i) => i.kind === 'meeting' && i.upcoming && i.at > NOW()); return m ? `${m.title}, ${fmt.datetime(m.at)}` : h('span.faint', 'None booked'); })())),
    ], { key: 'deal-progress' }),
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
  const notSaved = cx.pill('Not saved', 'orange'); notSaved.hidden = true;
  const saveBtn = cx.btn('Save', { kind: 'primary', sm: true, needs: NEED, onClick: () => {
    const ks = changed(); if (!ks.length) return;
    const LABEL = { firstName: 'First Name', lastName: 'Last Name', email: 'Email', mobile: 'Mobile No.', jobTitle: 'Job Title', org: 'Organization', website: 'Website', industry: 'Industry', territory: 'Territory', employees: 'No. of Employees', source: 'Source', owner: kind === 'lead' ? 'Lead Owner' : 'Deal Owner', probability: 'Probability', dealValue: 'Deal Value', expectedDealValue: 'Expected Deal Value', currency: 'Currency', expectedClosureDate: 'Expected Closure Date', nextStep: 'Next Step' };
    addChanges(kind, rec, ks.map((k) => [LABEL[k] || k, rec[k] == null || rec[k] === '' ? null : k === 'owner' ? cx.name(rec[k]) : String(rec[k]), k === 'owner' ? cx.name(draft[k]) : String(draft[k] ?? '—')]));
    for (const k of ks) rec[k] = ['probability', 'dealValue', 'expectedDealValue'].includes(k) && draft[k] != null && draft[k] !== '' ? +draft[k] : draft[k];
    cx.toast('Saved', { tone: 'success' }); cx.refresh();
  } });
  saveBtn.hidden = true;
  const onChange = () => { const n = changed().length; saveBtn.hidden = !n; notSaved.hidden = !n; };
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
    kind === 'deal' ? h('p.muted', { style: 'font-size:12.5px;padding:0 14px' }, "The company's own fields change on the company's page.") : null,
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
  return cx.menu(t.status, TASK_ST.map((st) => ({ label: h('span.crm-tst', taskIcon(st), st), on: st === t.status, needs: need, onClick: () => moveTask(t, st) })), { sm: true, kind: 'ghost' });
}
function moveTask(t, st) {
  if (t.status === st) return true;
  t.status = st; t.modifiedAt = NOW(); if (st === 'Done') t.doneAt = NOW();
  cx.toast(`${t.title}: ${st}`, { tone: 'success' });
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
  return cx.menu(stDot(kind, rec.status), ST[kind].map((st) => ({ label: stDot(kind, st.name), on: st.name === rec.status, needs: NEED, onClick: async () => { if (await moveRecord(kind, rec, st.name)) cx.refresh(); } })));
}
function ownerMenu(kind, rec) {
  const label = h('span.crm-sel', rec.owner ? cx.avatar(rec.owner, { size: 'sm' }) : cx.icon('user'), rec.owner ? cx.name(rec.owner) : 'Assign to');
  return cx.menu(label, [{ heading: kind === 'lead' ? 'Lead owner' : 'Deal owner' }, ...members().map((id) => ({ label: cx.name(id), on: id === rec.owner, needs: NEED, onClick: () => {
    if (id === rec.owner) return;
    const old = rec.owner; rec.owner = id;
    addChanges(kind, rec, [[kind === 'lead' ? 'Lead Owner' : 'Deal Owner', old ? cx.name(old) : null, cx.name(id)]]);
    cx.toast(`${cx.name(id)} owns ${recTitle(rec)} now`, { tone: 'success'});
    cx.refresh();
  } }))], { kind: 'ghost' });
}
function notFound(what, route, label) {
  return cx.page({ title: 'Not found', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }, { label, route }], body: cx.empty(`No such ${what}.`, cx.btn(`All ${label.toLowerCase()}`, { href: [route] })) });
}
function recordPage(kind, rec) {
  const isLead = kind === 'lead';
  const prim = isLead ? null : primaryOf(rec);
  const ctx = { kind, rec, name: recTitle(rec), personName: isLead ? leadName(rec) : prim?.name, firstName: isLead ? rec.firstName : prim?.firstName, toEmail: isLead ? rec.email : prim?.email, mobile: isLead ? rec.mobile : prim?.mobile };
  const cn = counts(itemsOf(rec));
  const tasks = recTasks(rec), notes = recNotes(rec);
  const c1 = composer(ctx), c2 = composer(ctx);
  const ctx1 = { ...ctx, compose: c1 }, ctx2 = { ...ctx, compose: c2 };
  let tabsEl = null;
  ctx.openEmail = () => { tabsEl?.show(0); c1.open({}); };
  const pane = (title, actions, body, foot) => h('div', h('div.crm-tabhead', h('h3', title), actions), h('div.crm-tabbody', body), foot || null);
  const newMenu = cx.menu('New', [
    { label: 'Email', icon: 'mail', needs: NEED, onClick: () => c1.open({}) },
    { label: 'Log a call', icon: 'phone', needs: NEED, onClick: () => logCallModal(ctx) },
    { label: 'Note', icon: 'note', needs: NEED, onClick: () => noteModal(ctx, null) },
    { label: 'Task', icon: 'task', needs: NEED, onClick: () => taskModal(ctx, null) },
    { label: 'WhatsApp message', icon: 'message', needs: NEED, onClick: () => tabsEl?.show(tabs.findIndex((t) => t.label === 'WhatsApp')) },
  ], { sm: true, icon: 'plus' });
  const tabs = [
    { label: 'Activity', render: () => pane('Activity', [orderBtn(), newMenu], activityList(rec, null, ctx1), c1.el) },
    { label: 'Emails', count: cn.email, render: () => pane('Emails', [orderBtn(), cx.btn('New email', { sm: true, icon: 'mail', needs: NEED, onClick: () => c2.open({}) })], activityList(rec, 'email', ctx2), c2.el) },
    { label: 'Data', render: () => dataTab(kind, rec) },
    { label: 'Calls', count: cn.call, render: () => pane('Calls', cx.btn('Log a call', { sm: true, icon: 'phone', needs: NEED, onClick: () => logCallModal(ctx) }), activityList(rec, 'call', ctx)) },
    { label: 'Meetings', count: cn.meeting, render: () => pane('Meetings', h('span.muted', { style: 'font-size:12.5px' }, 'From the owners\' calendars'), activityList(rec, 'meeting', ctx)) },
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
    isLead ? (rec.converted ? cx.btn('Open the deal', { kind: 'primary', icon: 'right', href: ['deal', rec.deal || rec.convertedTo] }) : cx.btn('Convert to deal', { kind: 'primary', icon: 'swap', needs: convertNeed, onClick: () => convertModal(rec) })) : null,
  ];
  const banner = readOnlyBanner(`this ${kind}`)
    || (isLead && rec.converted ? cx.banner(h('span', 'Converted to ', cx.link(rec.deal || rec.convertedTo, 'deal', rec.deal || rec.convertedTo), '. A converted lead leaves the Leads list, as the CRM does.'), { tone: 'info' }) : null)
    || (rec.lostReason ? cx.banner(`Lost: ${rec.lostReason}${rec.lostNotes ? `. ${rec.lostNotes}` : ''}`, { tone: 'warning' }) : null);
  const q = isLead ? qualOf(rec) : null;
  const sub = isLead
    ? `${rec.org ? rec.org + ' · ' : ''}${q.channel} · arrived ${fmt.agoLong(q.arrival)} · score ${q.score} · ${rec.name}`
    : `${rec.name} · ${rec.subject} · ${fmt.money(rec.dealValue, rec.currency)}${rec.status !== 'Won' && rec.status !== 'Lost' ? ` · ${rec.probability}% · closes ${fmt.date(rec.expectedClosureDate)}` : rec.closedDate ? ` · closed ${fmt.date(rec.closedDate)}` : ''}`;
  return cx.page({
    title: recTitle(rec), workspace: 'crm', status: isLead ? (rec.converted ? cx.pill('Converted', 'teal', { lg: true }) : null) : staleTag(rec),
    crumbs: [{ label: 'CRM', route: 'crm' }, { label: isLead ? 'Leads' : 'Deals', route: isLead ? 'leads' : 'deals' }],
    sub, actions, banner,
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
    title: 'Convert to deal', model: m, needs: NEED, submit: 'Convert', 
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
    check: (x) => (x.existingCompany && !x.company ? 'Please select an existing company' : x.existingContact && !x.contact ? 'Please select an existing contact' : null),
    onSubmit: (x, close) => {
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
      cx.toast(`Converted to ${name}`, { tone: 'success' });
      cx.go('deal', name);
    },
  });
}

cx.route('lead', (ctx) => { const l = cx.find(C.leads, 'name', ctx.id); return l ? recordPage('lead', l) : notFound('lead', 'leads', 'Leads'); }, { workspace: 'crm', title: 'Lead' });
cx.route('deal', (ctx) => { const d = cx.find(C.deals, 'name', ctx.id); return d ? recordPage('deal', d) : notFound('deal', 'deals', 'Deals'); }, { workspace: 'crm', title: 'Deal' });

/** A record's page context from its name (for actions started from a list). */
function ctxFor(name) {
  const l = C.leads.find((x) => x.name === name);
  if (l) return { kind: 'lead', rec: l, name: leadName(l), personName: leadName(l), firstName: l.firstName, toEmail: l.email, mobile: l.mobile };
  const d = C.deals.find((x) => x.name === name);
  if (d) { const p = primaryOf(d); return { kind: 'deal', rec: d, name: dealTitle(d), personName: p?.name, firstName: p?.firstName, toEmail: p?.email, mobile: p?.mobile }; }
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
  { label: 'This week', filter: (r) => !r.converted && dayOf(qualOf(r).arrival) >= addDays(TODAY, -6) },
  { label: 'New', stage: 'open', filter: (r) => !r.converted && stageOf('lead', r.status) === 'open' },
  { label: 'Ongoing', stage: 'ongoing', filter: (r) => !r.converted && stageOf('lead', r.status) === 'ongoing' },
  { label: 'Lost', stage: 'lost', filter: (r) => !r.converted && stageOf('lead', r.status) === 'lost' },
  { label: 'Converted', stage: 'converted', filter: (r) => !!r.converted },
];
const DEAL_TABS = [
  { label: 'All' },
  { label: 'Open', stage: 'open', filter: (r) => stageOf('deal', r.status) === 'open' },
  { label: 'Ongoing', stage: 'ongoing', filter: (r) => stageOf('deal', r.status) === 'ongoing' },
  { label: 'Stale', filter: (r) => !!staleOf(r) },
  { label: 'Won', stage: 'won', filter: (r) => r.status === 'Won' },
  { label: 'Lost', stage: 'lost', filter: (r) => r.status === 'Lost' },
];
function bulkStatus(kind, rows) {
  const m = { status: ST[kind][1].name, reason: '', notes: '' };
  const lostNow = () => isLost(kind, m.status);
  formModal({ title: `Change the status of ${fmt.plural(rows.length, kind)}`, model: m, needs: NEED, submit: 'Update',
    fields: [{ label: 'Status', key: 'status', type: 'select', options: ST[kind].map((x) => x.name) }, { label: 'Lost reason (for a lost status)', key: 'reason', type: 'select', options: [['', '—'], ...C.lostReasons] }, { label: 'Lost notes', key: 'notes', type: 'textarea', wide: true }],
    check: (x) => (lostNow() && !x.reason ? 'A lost status needs a reason.' : lostNow() && x.reason === 'Other' && !x.notes.trim() ? 'Other needs lost notes.' : null),
    onSubmit: (x, close) => {
      for (const r of rows) {
        if (r.status === x.status) continue;
        const ch = [['Status', r.status, x.status]]; r.status = x.status;
        if (kind === 'deal') { const p = stOf('deal', x.status).probability; if (p != null && r.probability !== p) { ch.push(['Probability', String(r.probability), String(p)]); r.probability = p; } if (x.status === 'Won') r.closedDate = TODAY; }
        if (lostNow()) { r.lostReason = x.reason; r.lostNotes = x.notes || null; ch.push(['Lost Reason', null, x.reason]); }
        addChanges(kind, r, ch);
      }
      close(); cx.toast(`${fmt.plural(rows.length, kind)} moved to ${x.status}`, { tone: 'success'}); cx.refresh();
    } });
}
function bulkOwner(kind, rows) {
  const m = { owner: cx.meId() };
  formModal({ title: `Assign ${fmt.plural(rows.length, kind)}`, model: m, cols: 1, needs: NEED, submit: 'Assign', 
    fields: [{ label: kind === 'lead' ? 'Lead owner' : 'Deal owner', key: 'owner', type: 'select', options: ownerOpts() }],
    onSubmit: (x, close) => { for (const r of rows) if (r.owner !== x.owner) { addChanges(kind, r, [[kind === 'lead' ? 'Lead Owner' : 'Deal Owner', r.owner ? cx.name(r.owner) : null, cx.name(x.owner)]]); r.owner = x.owner; } close(); cx.toast(`${fmt.plural(rows.length, kind)} assigned to ${cx.name(x.owner)}`, { tone: 'success'}); cx.refresh(); } });
}
function leadsList() {
  return cx.listView({
    key: 'crm-leads', rows: () => C.leads, id: (r) => r.name,
    titleCol: { key: 'fullName', label: 'Full name', get: leadName, render: (r) => h('span.crm-name', extAvatar(leadName(r), { size: 'sm' }), h('a', { href: cx.href('lead', r.name) }, leadName(r))), sub: (r) => (qualOf(r).need.level ? qualOf(r).need.text : '') },
    status: (r) => stDot('lead', r.status),
    columns: [
      { key: 'org', label: 'Company' },
      { key: 'channel', label: 'Arrived by', get: (r) => qualOf(r).channel, render: (r) => channelTag(qualOf(r).channel) },
      { key: 'score', label: 'Score', get: (r) => qualOf(r).score, render: (r) => scorePill(qualOf(r).score), keep: true },
      { key: 'owner', label: 'Assigned to', type: 'person' },
    ],
    modified: modifiedOf,
    filters: [{ key: 'fullName', label: 'Full name' }, { key: 'org', label: 'Company' }, { key: 'status', label: 'Status', type: 'select', options: ST.lead.map((x) => x.name) }, { key: 'channel', label: 'Arrived by', type: 'select', options: CHANNELS }, { key: 'owner', label: 'Assigned to', type: 'person', options: () => uniq(C.leads.map((l) => l.owner)) }],
    tabs: LEAD_TABS,
    sort: { options: [{ key: 'modified', label: 'Last modified', get: modifiedOf }, { key: 'arrived', label: 'Arrived', get: (r) => qualOf(r).arrival }, { key: 'score', label: 'Score', get: (r) => qualOf(r).score }, { key: 'fullName', label: 'Full name', get: leadName }], default: { key: 'modified', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'channel', label: 'Arrived by', get: (r) => qualOf(r).channel }, { key: 'owner', label: 'Lead owner', type: 'person' }, { key: 'industry', label: 'Sector' }],
    href: (r) => ['lead', r.name],
    bulk: [
      { label: 'Change status', icon: 'edit', needs: NEED, onClick: (rows) => bulkStatus('lead', rows) },
      { label: 'Assign to', icon: 'user', needs: NEED, onClick: (rows) => bulkOwner('lead', rows) },
      { label: 'Convert to deal', icon: 'swap', needs: NEED, onClick: (rows) => (rows.length === 1 ? (isLost('lead', rows[0].status) || rows[0].converted ? cx.toast(rows[0].converted ? 'That lead is converted already.' : 'Cannot convert a lost lead to deal', { tone: 'warning' }) : convertModal(rows[0])) : cx.toast('Convert one lead at a time: the dialog chooses its company and contact.', { tone: 'info' })) },
    ],
    views: viewList('leads', 'leads'),
    noun: 'lead', idLabel: 'ID', empty: 'No leads match.',
  });
}
const dealCompanyCell = (r) => h('span.crm-name', extAvatar(companyName(r.company) || r.title, { size: 'sm', square: true }), h('a', { href: cx.href('deal', r.name) }, dealTitle(r)));
function dealsList() {
  return cx.listView({
    key: 'crm-deals', rows: () => C.deals, id: (r) => r.name,
    titleCol: { key: 'companyName', label: 'Company', get: dealTitle, render: dealCompanyCell, sub: (r) => r.subject },
    status: (r) => { const t = staleTag(r); return t ? h('span.crm-tst', stDot('deal', r.status), t) : stDot('deal', r.status); },
    columns: [
      { key: 'dealValue', label: 'Deal value', type: 'currency', keep: true },
      { key: 'touch', label: 'Last touch', get: (r) => lastTouch(r)?.at || '', render: touchCell },
      { key: 'nextStep', label: 'Next step', render: (r) => (r.nextStep ? h('span.crm-next', r.nextStep) : h('span.faint', '—')) },
      { key: 'owner', label: 'Deal owner', type: 'person' },
    ],
    modified: modifiedOf,
    filters: [{ key: 'companyName', label: 'Company' }, { key: 'status', label: 'Status', type: 'select', options: ST.deal.map((x) => x.name) }, { key: 'owner', label: 'Deal owner', type: 'person', options: () => uniq(C.deals.map((d) => d.owner)) }, { key: 'source', label: 'Source', type: 'select' }],
    tabs: DEAL_TABS,
    sort: { options: [{ key: 'modified', label: 'Last modified', get: modifiedOf }, { key: 'touch', label: 'Last touch', get: (r) => lastTouch(r)?.at || '' }, { key: 'expectedClosureDate', label: 'Expected closure' }, { key: 'value', label: 'Deal value (in pounds)', get: (r) => toGbp(r.dealValue, r.currency) }, { key: 'createdAt', label: 'Created on' }], default: { key: 'modified', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'owner', label: 'Deal owner', type: 'person' }, { key: 'source', label: 'Source' }],
    href: (r) => ['deal', r.name],
    bulk: [{ label: 'Change status', icon: 'edit', needs: NEED, onClick: (rows) => bulkStatus('deal', rows) }, { label: 'Assign to', icon: 'user', needs: NEED, onClick: (rows) => bulkOwner('deal', rows) }],
    views: viewList('deals', 'deals'),
    noun: 'deal', idLabel: 'ID', empty: 'No deals match.',
  });
}
/** The pipeline board: the deals in play by stage, with each stage's value, and what won lately. */
function pipelineBoard() {
  const recentWon = addDays(TODAY, -60);
  const rows = C.deals.filter((d) => isOpenDeal(d) || (d.status === 'Won' && (d.closedDate || '') >= recentWon));
  const gbpOf = (d) => toGbp(d.dealValue, d.currency);
  const cols = ST.deal.filter((st) => st.type !== 'Lost').map((st) => {
    const items = rows.filter((r) => r.status === st.name).sort((a, b) => String(a.expectedClosureDate || '').localeCompare(String(b.expectedClosureDate || '')));
    return { key: st.name, label: `${st.name === 'Won' ? 'Won, last 60 days' : st.name} · ${fmt.compact(sum(items, gbpOf), 'GBP')}`, color: st.color, items };
  });
  const open = rows.filter(isOpenDeal);
  const weighted = sum(open, (d) => gbpOf(d) * (d.probability || 0) / 100);
  const stale = open.filter(staleOf).length;
  const card = (d) => {
    const p = primaryOf(d);
    return [
      h('div.kb-title', h('span.crm-name', extAvatar(companyName(d.company), { size: 'sm', square: true }), h('span', dealTitle(d)))),
      h('div.kb-meta.crm-kbm',
        h('span', d.subject),
        h('span', { style: 'color:var(--fg);font-weight:600' }, d.dealValue != null ? fmt.money(d.dealValue, d.currency, 0) : '—', h('span.muted', { style: 'font-weight:400' }, ` · ${d.probability ?? 0}%${d.status !== 'Won' && d.expectedClosureDate ? ' · closes ' + fmt.day(d.expectedClosureDate) : ''}`)),
        d.status === 'Won' ? h('span', `Won ${fmt.date(d.closedDate)}`) : touchCell(d),
        d.nextStep && d.status !== 'Won' ? h('span.crm-next', h('b', 'Next: '), d.nextStep) : null,
        p ? h('span', p.name) : null),
      h('div.crm-call-h', d.owner ? cx.personChip(d.owner, { link: false }) : null, h('span.grow'), staleTag(d)),
    ];
  };
  return h('div', { style: 'display:grid;gap:12px;min-width:0' },
    h('div.ncards', [
      cx.numberCard({ label: 'In play', value: fmt.int(open.length), sub: fmt.gbp(sum(open, gbpOf)) + ' of deal value', href: ['deals'] }),
      cx.numberCard({ label: 'Weighted', value: fmt.gbp(weighted), sub: 'value × each stage\'s probability' }),
      cx.numberCard({ label: 'Stale', value: fmt.int(stale), sub: `no touch for over two weeks`, href: ['deals'] }),
      cx.numberCard({ label: 'Won, last 60 days', value: fmt.int(rows.filter((d) => d.status === 'Won').length), sub: fmt.gbp(sum(rows.filter((d) => d.status === 'Won'), (d) => toGbp(d.dealValue, d.currency, d.closedDate))) }),
    ]),
    h('div.crm-views', h('span.muted', { style: 'font-size:12.5px' }, cx.allowed(NEED).ok ? 'Drag a deal to move it on. Won records the closed date; Lost asks why.' : lockLine())),
    cx.kanban({ key: 'crm-pipeline-kb', id: (r) => r.name, limit: 12, columns: cols, card,
      onMove: (d, to) => moveRecord('deal', d, to),
      onOpen: (d) => cx.go('deal', d.name) }));
}

/* ---------- the sources report ---------- */

const median = (arr) => { const a = arr.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const PERIODS = [['90', 'Last 90 days'], ['180', 'Last 6 months'], ['365', 'Last 12 months'], ['all', 'Since 1 May 2025']];
function sourcesPage() {
  const dealOfLead = (l) => C.deals.find((d) => d.name === (l.deal || l.convertedTo)) || null;
  const leadsIn = (period) => (period === 'all' ? C.leads : C.leads.filter((l) => dayOf(qualOf(l).arrival) >= addDays(TODAY, -(+period - 1))));
  const report = cx.reportView({
    key: 'crm-sources',
    filters: [{ key: 'period', label: 'Period', type: 'select', options: PERIODS, value: '180' }],
    run: (v) => {
      const leads = leadsIn(v.period);
      const by = new Map(CHANNELS.map((c) => [c, []]));
      for (const l of leads) by.get(qualOf(l).channel)?.push(l);
      const rowOf = (label, ls) => {
        const qualified = ls.filter((l) => l.converted || l.status === 'Qualified');
        const deals = ls.map(dealOfLead).filter(Boolean);
        const won = deals.filter((d) => d.status === 'Won');
        return {
          channel: label, leads: ls.length, score: ls.length ? Math.round(avg(ls.map((l) => qualOf(l).score))) : null,
          qualified: qualified.length, qualRate: ls.length ? qualified.length / ls.length : null,
          deals: deals.length, won: won.length, wonValue: sum(won, (d) => toGbp(d.dealValue, d.currency, d.closedDate)),
          reply: median(ls.map((l) => qualOf(l).firstReplyHours)), qualify: median(qualified.map((l) => qualOf(l).qualifyHours)),
        };
      };
      const rows = CHANNELS.map((c) => rowOf(c, by.get(c))).filter((r) => r.leads);
      const all = rowOf('All channels', leads);
      const dur = (x) => (x == null ? '—' : durHuman(x));
      return {
        summary: [
          { label: 'Leads in', value: fmt.int(all.leads) },
          { label: 'Qualified', value: all.qualRate == null ? '—' : fmt.pct(all.qualRate, 0), sub: `${fmt.int(all.qualified)} of ${fmt.int(all.leads)}` },
          { label: 'Scored by the agent', value: dur(median(leads.map((l) => hoursBetween(qualOf(l).arrival, qualOf(l).scoredAt)))), sub: 'median, after arrival' },
          { label: 'First reply', value: dur(all.reply), sub: 'median, after arrival' },
          { label: 'Time to qualify', value: dur(all.qualify), sub: 'median, arrival to Qualified' },
          { label: 'Won', value: fmt.gbp(all.wonValue), sub: fmt.plural(all.won, 'deal') },
        ],
        columns: [
          { key: 'channel', label: 'Arrived by', width: '150px' },
          { key: 'leads', label: 'Leads', type: 'int' },
          { key: 'score', label: 'Avg. score', type: 'int' },
          { key: 'qualified', label: 'Qualified', type: 'int' },
          { key: 'qualPct', label: 'Qualified %' },
          { key: 'deals', label: 'Deals', type: 'int' },
          { key: 'won', label: 'Won', type: 'int' },
          { key: 'wonValue', label: 'Won value', type: 'currency' },
          { key: 'replyT', label: 'First reply' },
          { key: 'qualifyT', label: 'Time to qualify' },
        ],
        rows: rows.map((r) => ({ ...r, qualPct: r.qualRate == null ? '—' : fmt.pct(r.qualRate, 0), replyT: dur(r.reply), qualifyT: dur(r.qualify) })),
        totals: { channel: 'All channels', leads: all.leads, score: all.score, qualified: all.qualified, qualPct: all.qualRate == null ? '—' : fmt.pct(all.qualRate, 0), deals: all.deals, won: all.won, wonValue: all.wonValue, replyT: dur(all.reply), qualifyT: dur(all.qualify) },
        chartTitle: 'Leads by how they arrived',
        chart: cx.chart.bar({ labels: rows.map((r) => r.channel), stacked: true, height: 220, format: (x) => fmt.int(x),
          series: [{ name: 'Qualified', values: rows.map((r) => r.qualified), color: 'pos' }, { name: 'Not qualified', values: rows.map((r) => r.leads - r.qualified), color: 'muted' }] }),
      };
    },
    footnote: 'A lead counts in the period it arrived. Qualified means a person marked it Qualified or converted it to a deal; the agent only scores.',
  });
  // conversion by stage, over the same leads (all time, so late stages have had time to happen)
  const leads = C.leads;
  const reached = (l, names) => l.converted || names.includes(l.status) || rawItems(l.name).some((i) => (i.kind === 'changed' && i.field === 'Status' && names.includes(i.to)) || (i.kind === 'changes' && i.changes.some((c) => c[0] === 'Status' && names.includes(c[2]))));
  const deals = C.deals.filter((d) => d.lead);
  const dealReached = (d, names) => names.includes(d.status) || itemsOf(d).some((i) => (i.kind === 'changed' && i.field === 'Status' && names.includes(i.to)) || (i.kind === 'changes' && i.changes.some((c) => c[0] === 'Status' && names.includes(c[2]))));
  const later = (from) => ST.deal.slice(ST.deal.findIndex((s) => s.name === from)).filter((s) => s.type !== 'Lost').map((s) => s.name);
  const stages = [
    ['Arrived', leads.length],
    ['Contacted', leads.filter((l) => reached(l, ['Contacted', 'Nurture', 'Qualified'])).length],
    ['Qualified', leads.filter((l) => reached(l, ['Qualified'])).length],
    ['Deal', deals.length],
    ['Proposal', deals.filter((d) => dealReached(d, later('Proposal/Quotation'))).length],
    ['Negotiation', deals.filter((d) => dealReached(d, later('Negotiation'))).length],
    ['Won', deals.filter((d) => d.status === 'Won').length],
  ];
  const conv = cx.card({ title: 'Conversion by stage', body: [
    h('p.muted', { style: 'font-size:12.5px;margin-bottom:8px' }, 'Every lead since May 2025, and how far it got. Each bar shows the share of the stage before it.'),
    cx.chart.hbar({ items: stages.map(([label, value], i) => ({ label: i ? `${label} · ${fmt.pct(value / (stages[i - 1][1] || 1), 0)}` : label, value, color: i === stages.length - 1 ? 'pos' : '2' })), format: (x) => fmt.int(x) }),
  ] });
  return cx.page({ title: 'Lead sources', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }],
    sub: 'Where leads come from, how fast they get an answer, and how many turn into work.',
    fde: 'The lead sources report in the CRM',
    body: [report, conv] });
}
cx.route('crm-sources', () => sourcesPage(), { workspace: 'crm', title: 'Lead sources' });

/* ---------- every touchpoint with a person or a company, across their leads and deals ---------- */

function touchpointsFor(recs, match) {
  const seen = new Set();
  const out = [];
  for (const r of recs) for (const it of itemsOf(r)) {
    if (seen.has(it.id) || !(TOUCH.has(it.kind) || it.kind === 'agent')) continue;
    if (match && !match(it)) continue;
    seen.add(it.id); out.push(it);
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
function touchpointList(items) {
  if (!items.length) return cx.empty('No touchpoints yet');
  return h('div.crm-acts', items.map((it) => h('div', { style: 'display:grid;gap:2px;min-width:0' },
    actItem(it, null),
    h('div.crm-logged', { style: 'padding-left:40px;margin-top:-4px' }, 'on ', cx.link(recLabel(it.recordName), recRoute(it.recordName), it.recordName)))));
}
function newLeadModal(preset = {}) {
  const m = { firstName: '', lastName: '', email: '', mobile: '', jobTitle: '', org: '', website: '', revenue: '', territory: 'United Kingdom', employees: '', industry: '', source: 'Website', status: preset.status || 'New', owner: members().includes(cx.meId()) ? cx.meId() : members()[0] };
  formModal({
    title: 'New lead', model: m, needs: NEED, submit: 'Create', 
    fields: [
      { section: 'Person' }, { label: 'First name', key: 'firstName', placeholder: 'Rohan' }, { label: 'Last name', key: 'lastName', placeholder: 'Mehta' },
      { label: 'Email', key: 'email', placeholder: 'rohan@parcelpoint.io' }, { label: 'Mobile no.', key: 'mobile', placeholder: '+44 7700 900634' }, { label: 'Job title', key: 'jobTitle', placeholder: 'CTO' },
      { section: 'Company' }, { label: 'Company', key: 'org', placeholder: 'Parcelpoint' }, { label: 'Website', key: 'website', placeholder: 'parcelpoint.io' },
      { label: 'Annual revenue', key: 'revenue', type: 'float' }, { label: 'Territory', key: 'territory', type: 'select', options: TERRITORIES },
      { label: 'No. of employees', key: 'employees', type: 'select', options: [['', '—'], ...EMPLOYEES] }, { label: 'Industry', key: 'industry', type: 'select', options: [['', '—'], ...INDUSTRIES] },
      { section: 'Lead' }, { label: 'Status', key: 'status', type: 'select', options: ST.lead.map((x) => x.name) }, { label: 'Source', key: 'source', type: 'select', options: SOURCES },
      { label: 'Lead owner', key: 'owner', type: 'select', options: ownerOpts() },
    ],
    check: (x) => (!x.firstName && !x.org && !x.email ? 'A lead needs a first name, a company name or an email.' : isLost('lead', x.status) ? 'A new lead starts in an open status; move it to a lost one from its page, with the reason.' : null),
    onSubmit: (x, close) => {
      const name = nextName(`CRM-LEAD-${TODAY.slice(0, 4)}-`, C.leads.map((l) => l.name));
      const co = C.companies.find((c) => x.org && c.name.toLowerCase() === x.org.toLowerCase());
      const at = NOW();
      const l = { createdAt: at, company: co?.id || null, org: x.org || null, contact: null, status: 'New', converted: false, owner: x.owner, source: x.source, deal: null, name, firstName: x.firstName, lastName: x.lastName, email: x.email || null, mobile: x.mobile || null, jobTitle: x.jobTitle || null, website: x.website || null, territory: x.territory, industry: x.industry || null, employees: x.employees || null, modifiedAt: at };
      C.leads.push(l);
      addItem(name, 'Lead', { kind: 'creation', text: `${cx.name(cx.meId())} created this lead`, source: x.source, at });
      deriveLeadItems(l);
      if (x.status !== 'New') { l.status = x.status; addChanges('lead', l, [['Status', 'New', x.status]]); }
      close(); cx.toast(`Created ${name}`, { tone: 'success'}); cx.go('lead', name);
    },
  });
}
function newDealModal(preset = {}) {
  const m = { existingCompany: 1, company: preset.company || '', newCompany: '', website: '', industry: '', territory: 'United Kingdom', existingContact: 1, contact: preset.contact || '', firstName: '', lastName: '', email: '', mobile: '', status: preset.status || 'Qualification', owner: members().includes(cx.meId()) ? cx.meId() : members()[0], value: '', currency: 'GBP', closeBy: addDays(TODAY, 60), nextStep: '', source: 'Existing Customer' };
  formModal({
    title: 'New deal', model: m, needs: NEED, submit: 'Create', wide: true,
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
    check: (x) => (x.existingCompany && !x.company && !x.newCompany ? 'Please select an existing company, or name a new one.' : !x.existingCompany && !x.newCompany ? 'Name the new company.' : null),
    onSubmit: (x, close) => {
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
      close(); cx.toast(`Created ${name}`, { tone: 'success'}); cx.go('deal', name);
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
  const create = cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, onClick: () => newLeadModal() });
  let body;
  if (view === 'list') body = leadsList();
  else if (view === 'kanban') {
    const rows = C.leads.filter((l) => !l.converted).sort((a, b) => String(modifiedOf(b)).localeCompare(String(modifiedOf(a))));
    body = h('div', { style: 'display:grid;gap:10px;min-width:0' }, viewBar(viewList('leads', 'leads-kanban'), h('span.muted', { style: 'font-size:12.5px' }, cx.allowed(NEED).ok ? 'Drag a card to change its status.' : lockLine())),
      cx.kanban({ key: 'crm-leads-kb', id: (r) => r.name, limit: 15,
        columns: ST.lead.map((st) => ({ key: st.name, label: st.name, color: st.color, items: rows.filter((r) => r.status === st.name) })),
        card: (l) => [h('div.kb-title', h('span.crm-name', extAvatar(leadName(l), { size: 'sm' }), h('span', leadName(l)))), h('div.kb-meta.crm-kbm', l.org ? h('span', l.org) : null, qualOf(l).need.level ? h('span', qualOf(l).need.text) : null, h('span.crm-tst', channelTag(qualOf(l).channel), scorePill(qualOf(l).score))), h('div.crm-call-h', l.owner ? cx.personChip(l.owner, { link: false }) : null, h('span.grow'), h('span.crm-when', { title: fmt.datetime(modifiedOf(l)) }, fmt.ago(modifiedOf(l)))), kbCounts(l)],
        onMove: (l, to) => moveRecord('lead', l, to),
        onOpen: (l) => cx.go('lead', l.name),
        colMenu: (col) => [{ label: 'New lead here', icon: 'plus', needs: NEED, onClick: () => newLeadModal({ status: col.key }) }] }));
  } else {
    body = groupedView({ key: 'leads', kind: 'lead', noun: 'lead', views: viewList('leads', 'leads-grouped'), rows: () => C.leads.filter((l) => !l.converted), titleLabel: 'Full name',
      title: (l) => h('span.crm-name', extAvatar(leadName(l), { size: 'sm' }), h('a', { href: cx.href('lead', l.name) }, leadName(l))),
      fields: [{ key: 'status', label: 'Status', order: ST.lead.map((x) => x.name) }, { key: 'source', label: 'Source' }, { key: 'owner', label: 'Lead owner', type: 'person' }, { key: 'territory', label: 'Territory' }, { key: 'industry', label: 'Industry' }],
      columns: [{ label: 'Company', render: (l) => l.org || '' }, { label: 'Status', render: (l) => stDot('lead', l.status) }, { label: 'Email', opt: true, render: (l) => l.email || '' }, { label: 'Assigned to', opt: true, render: (l) => (l.owner ? cx.personChip(l.owner, { link: false }) : '') }, { label: 'Last modified', opt: true, render: (l) => h('span.ago', fmt.ago(modifiedOf(l))) }],
      href: (l) => ['lead', l.name] });
  }
  return cx.page({ title: 'Leads', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }], actions: [create], body, fde: 'The Leads list in the CRM' });
}
function dealsPage(view) {
  const create = cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, onClick: () => newDealModal() });
  let body;
  const gbpSum = (list) => fmt.compact(sum(list, (d) => toGbp(d.dealValue, d.currency)), 'GBP');
  if (view === 'list') body = dealsList();
  else if (view === 'pipeline') body = pipelineBoard();
  else if (view === 'kanban') {
    const rows = [...C.deals].sort((a, b) => String(modifiedOf(b)).localeCompare(String(modifiedOf(a))));
    body = h('div', { style: 'display:grid;gap:10px;min-width:0' }, viewBar(viewList('deals', 'deals-kanban'), h('span.muted', { style: 'font-size:12.5px' }, cx.allowed(NEED).ok ? 'Drag a card to change its status. Won records the closed date; Lost asks why.' : lockLine())),
      cx.kanban({ key: 'crm-deals-kb', id: (r) => r.name, limit: 12,
        columns: ST.deal.map((st) => ({ key: st.name, label: st.name, color: st.color, items: rows.filter((r) => r.status === st.name) })),
        card: (d) => { const p = primaryOf(d); return [h('div.kb-title', h('span.crm-name', extAvatar(companyName(d.company), { size: 'sm', square: true }), h('span', dealTitle(d)))), h('div.kb-meta.crm-kbm', h('span', d.subject), h('span', { style: 'color:var(--fg);font-weight:600' }, d.dealValue != null ? fmt.money(d.dealValue, d.currency, 0) : '—', h('span.muted', { style: 'font-weight:400' }, ` · ${d.probability ?? 0}%`)), isOpenDeal(d) ? touchCell(d) : null, d.nextStep && isOpenDeal(d) ? h('span.crm-next', h('b', 'Next: '), d.nextStep) : null), h('div.crm-call-h', d.owner ? cx.personChip(d.owner, { link: false }) : null, h('span.grow'), staleTag(d) || h('span.crm-when', fmt.ago(modifiedOf(d)))), kbCounts(d)]; },
        onMove: (d, to) => moveRecord('deal', d, to),
        onOpen: (d) => cx.go('deal', d.name),
        colMenu: (col) => [{ label: 'New deal here', icon: 'plus', needs: NEED, onClick: () => newDealModal({ status: col.key }) }] }));
  } else {
    body = groupedView({ key: 'deals', kind: 'deal', noun: 'deal', views: viewList('deals', 'deals-grouped'), rows: () => C.deals, titleLabel: 'Company', sum: (list) => gbpSum(list),
      title: dealCompanyCell,
      fields: [{ key: 'status', label: 'Status', order: ST.deal.map((x) => x.name) }, { key: 'owner', label: 'Deal owner', type: 'person' }, { key: 'source', label: 'Source' }, { key: 'territory', label: 'Territory' }, { key: 'industry', label: 'Industry' }],
      columns: [{ label: 'Deal value', num: true, render: (d) => (d.dealValue != null ? fmt.money(d.dealValue, d.currency, 0) : '') }, { label: 'Status', render: (d) => stDot('deal', d.status) }, { label: 'Deal owner', opt: true, render: (d) => (d.owner ? cx.personChip(d.owner, { link: false }) : '') }, { label: 'Last modified', opt: true, render: (d) => h('span.ago', fmt.ago(modifiedOf(d))) }],
      href: (d) => ['deal', d.name] });
  }
  return cx.page({ title: view === 'pipeline' ? 'Pipeline' : 'Deals', workspace: 'crm', crumbs: view === 'pipeline' ? [{ label: 'CRM', route: 'crm' }, { label: 'Deals', route: 'deals' }] : [{ label: 'CRM', route: 'crm' }], sub: view === 'pipeline' ? 'The deals in play by stage, with what each stage is worth, and what won in the last 60 days.' : null, actions: [create], body, fde: view === 'pipeline' ? 'The Pipeline view of open deals' : 'The Deals list in the CRM' });
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
  formModal({ title: 'New contact', model: m, needs: NEED, submit: 'Create', 
    fields: [{ label: 'First name', key: 'firstName', reqd: true }, { label: 'Last name', key: 'lastName' }, { label: 'Email', key: 'email' }, { label: 'Mobile no.', key: 'mobile' },
      { label: 'Company', key: 'company', type: 'select', options: [['', '—'], ...C.companies.map((c) => [c.id, c.name])] }, { label: 'Designation', key: 'designation' }],
    onSubmit: (x, close) => {
      const name = [x.firstName, x.lastName].filter(Boolean).join(' ');
      let id = cx.slug(name).toLowerCase(); if (CONTACT.has(id)) id += '-' + (C.contacts.length + 1);
      const rec = { id, firstName: x.firstName, lastName: x.lastName, name, company: x.company || null, designation: x.designation || null, email: x.email || null, mobile: x.mobile || null, onCapxul: false, handle: null, primary: false, createdAt: NOW() };
      C.contacts.push(rec); CONTACT.set(id, rec);
      close(); cx.toast(`${name} added to Harbourline's contacts`, { tone: 'success' }); cx.go('contact', id);
    } });
}
function newCompanyModal() {
  const m = { name: '', website: '', description: '', revenue: '', currency: 'GBP', territory: 'United Kingdom', employees: '', industry: '' };
  formModal({ title: 'New company', model: m, needs: NEED, submit: 'Create', 
    fields: [{ label: 'Company name', key: 'name', reqd: true, wide: true }, { label: 'Website', key: 'website' }, { label: 'Annual revenue', key: 'revenue', type: 'float' }, { label: 'Currency', key: 'currency', type: 'select', options: ['GBP', 'USD', 'EUR'] },
      { label: 'Territory', key: 'territory', type: 'select', options: TERRITORIES }, { label: 'No. of employees', key: 'employees', type: 'select', options: [['', '—'], ...EMPLOYEES] }, { label: 'Industry', key: 'industry', type: 'select', options: [['', '—'], ...INDUSTRIES] },
      { label: 'Company description', key: 'description', type: 'textarea', wide: true }],
    onSubmit: (x, close) => {
      let id = cx.slug(x.name).toLowerCase(); if (COMPANY.has(id)) id += '-2';
      const rec = { id, name: x.name, website: x.website || null, industry: x.industry || null, territory: x.territory, employees: x.employees || null, annualRevenue: x.revenue ? +x.revenue : null, currency: x.currency, description: x.description || null, onCapxul: false, handle: null, safe: null, isCustomer: false };
      C.companies.push(rec); COMPANY.set(id, rec);
      close(); cx.toast(`${x.name} added`, { tone: 'success' }); cx.go('company', id);
    } });
}
function linkModal(rec, isCompany) {
  const m = { to: rec.email || '' };
  formModal({ title: `Link ${rec.name} to pay`, model: m, cols: 1, needs: NEED, submit: 'Preview the link', 
    intro: 'A private entry has no Party: money cannot reach it. Name the mailbox, handle or address it belongs to. Capxul shows who that is before it links, and links once.',
    fields: [{ label: 'Email, @handle or 0x address', key: 'to', reqd: true }],
    onSubmit: (x, close) => {
      close();
      sendPreview({ title: `Link ${rec.name}?`, rows: [['Entry', rec.name], ['Links to', x.to], ['After', /^@|^0x/.test(x.to) ? 'Payments go straight to them.' : 'Payments go to that mailbox; until its owner joins Capxul, money waits in escrow for them to claim.']], onSend: () => {
        if (/^@/.test(x.to)) { rec.handle = x.to; rec.onCapxul = true; } else if (/^0x/.test(x.to)) { rec.safe = x.to; rec.onCapxul = true; rec.handle = rec.handle || fmt.addr(x.to); } else rec.email = x.to;
        rec.linked = x.to;
        cx.toast(`${rec.name} is linked: ${x.to}`, { tone: 'success' }); cx.refresh();
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
    !c.onCapxul && !c.email ? h('div', cx.btn('Link to pay', { sm: true, icon: 'link', needs: NEED, onClick: () => linkModal(c) })) : null);
}
function contactPage(c) {
  const o = { kind: 'contact', rec: c };
  const F = (key, label, x = {}) => sideField({ label, get: () => c[key], set: (v) => { c[key] = v; if (key === 'firstName' || key === 'lastName') c.name = [c.firstName, c.lastName].filter(Boolean).join(' '); }, noTimeline: true, ...x }, o);
  const deals = dealsOfContact(c.id);
  const money = (TL.get(c.id) || []).filter((i) => i.kind === 'money');
  const leads = leadsOfContact(c.id);
  const mail = (x) => x && c.email && String(x).toLowerCase() === c.email.toLowerCase();
  const theirs = (it) => { const l = C.leads.find((x) => x.name === it.recordName); const d = C.deals.find((x) => x.name === it.recordName); return (l && l.contact === c.id) || (d && primaryOf(d)?.id === c.id); };
  const touches = touchpointsFor([...leads, ...deals], (it) => (it.kind === 'email' ? [it.from, ...(it.to || []), ...(it.cc || [])].some(mail) || (!c.email && theirs(it))
    : it.kind === 'meeting' ? (it.attendees || []).includes(c.name)
    : it.kind === 'call' ? [callRec(it).caller, callRec(it).receiver].includes(c.name) || theirs(it)
    : theirs(it)));
  const tabs = [
    { label: 'Activity', count: touches.length, render: () => h('div', { style: 'padding:14px' }, touchpointList(touches)) },
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
    actions: [cx.btn('New deal', { kind: 'primary', icon: 'plus', needs: NEED, onClick: () => newDealModal({ company: c.company || '', contact: c.id }) })],
    banner: readOnlyBanner('this contact'),
    fde: `Contact ${c.name}${c.company ? ' at ' + companyName(c.company) : ''}`,
    body: h('div.crm-rec.left', side, h('div.crm-main', cx.tabs(tabs, { key: 'crm-contact' }))),
  });
}
function companyPage(co) {
  const o = { kind: 'company', rec: co };
  const F = (key, label, x = {}) => sideField({ label, get: () => co[key], set: (v) => { co[key] = v; }, noTimeline: true, ...x }, o);
  const deals = dealsOfCompany(co.id);
  const people = contactsOfCompany(co.id);
  const touches = touchpointsFor([...C.leads.filter((l) => l.company === co.id || (!l.company && l.org === co.name)), ...deals]);
  const money = C.timeline.filter((i) => i.kind === 'money' && i.company === co.id);
  const paid = money.filter((i) => i.direction === 'in');
  const projects = (D.projects?.projects || []).filter((p) => p.customer === co.id);
  const cap = co.onCapxul
    ? h('div.crm-f-cap', h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, h('b', 'Capxul'), cx.pill(co.handle, 'green')), h('span', `A Capxul Organization, ${co.handle}. Pays to its company Safe ${fmt.addr(co.safe)}.`), paid.length ? h('span', `Paid since ${fmt.month(dayOf(paid[0].at).slice(0, 7))}: `, h('b', fmt.usdc(sum(paid, (i) => i.amount))), `, ${fmt.plural(paid.length, 'invoice')}.`) : null)
    : h('div.crm-f-cap', h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, h('b', 'Capxul'), cx.pill('Private', 'gray')), h('span', 'Private: not on Capxul. Its people can be paid by mailbox.'), paid.length ? h('span', `It has paid ${fmt.plural(paid.length, 'invoice')} on chain from a link: `, h('b', fmt.usdc(sum(paid, (i) => i.amount))), '.') : null);
  const tabs = [
    { label: 'Activity', count: touches.length, render: () => h('div', { style: 'padding:14px' }, touchpointList(touches)) },
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
    actions: [cx.btn('Add contact', { icon: 'user', needs: NEED, onClick: () => newContactModal({ company: co.id }) }), cx.btn('New deal', { kind: 'primary', icon: 'plus', needs: NEED, onClick: () => newDealModal({ company: co.id }) })],
    banner: readOnlyBanner('this company'),
    fde: `Company ${co.name}${co.onCapxul ? ' (' + co.handle + ' on Capxul)' : ''}`,
    body: h('div.crm-rec.left', side, h('div.crm-main', cx.tabs(tabs, { key: 'crm-company' }))),
  });
}
cx.route('contacts', () => cx.page({
  title: 'Contacts', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }],
  actions: [cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, onClick: () => newContactModal() })],
  fde: 'The contacts in Harbourline\'s CRM',
  body: cx.listView({
    key: 'crm-contacts', rows: () => C.contacts, id: (r) => r.id, showId: false,
    titleCol: { key: 'name', label: 'Name', render: (r) => h('span.crm-name', extAvatar(r.name, { size: 'sm' }), h('a', { href: cx.href('contact', r.id) }, r.name)), sub: (r) => r.designation || '' },
    columns: [{ key: 'email', label: 'Email' }, { key: 'mobile', label: 'Phone' }, { key: 'capxul', label: 'Capxul', get: (r) => capxulOf(r).word, render: (r) => cx.pill(capxulOf(r).word, capxulOf(r).tone), keep: true }, { key: 'companyName', label: 'Company', get: (r) => companyName(r.company) }],
    modified: contactModified,
    filters: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'companyName', label: 'Company', type: 'select' }, { key: 'capxul', label: 'Capxul', type: 'select', options: ['By mailbox', 'Private', ...uniq(C.contacts.filter((c) => c.handle).map((c) => c.handle))] }],
    sort: { options: [{ key: 'modified', label: 'Last modified', get: (r) => contactModified(r) || '' }, { key: 'name', label: 'Name' }], default: { key: 'modified', dir: 'desc' } },
    groupBy: [{ key: 'companyName', label: 'Company', get: (r) => companyName(r.company) }, { key: 'capxul', label: 'Capxul', get: (r) => capxulOf(r).word }],
    href: (r) => ['contact', r.id],
    noun: 'contact',
  }),
}), { workspace: 'crm', title: 'Contacts' });
cx.route('contact', (ctx) => { const c = cx.find(C.contacts, 'id', ctx.id); return c ? contactPage(c) : notFound('contact', 'contacts', 'Contacts'); }, { workspace: 'crm', title: 'Contact' });
cx.route('companies', () => cx.page({
  title: 'Companies', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }],
  actions: [cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, onClick: () => newCompanyModal() })],
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
    actions: [cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, onClick: () => pickRecord('New note: which lead or deal?', (ctx) => noteModal(ctx, null)) })],
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
        onMove: (t, to) => { const ok = taskMoveNeed(t)(); if (ok !== true) { cx.toast(ok, { tone: 'warning' }); return false; } t.status = to; t.modifiedAt = NOW(); cx.toast(`${t.title}: ${to}`, { tone: 'success' }); return true; },
        onOpen: (t) => taskModal(ctxFor(t.reference), t) }));
  }
  return cx.page({ title: 'Tasks', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }], sub: 'The CRM\'s own tasks, on leads and deals. Project tasks live in Projects.',
    actions: [cx.btn('Create', { kind: 'primary', icon: 'plus', needs: NEED, onClick: () => taskModal(null, null) })],
    fde: 'The CRM tasks', body });
}
cx.route('crm-tasks', () => crmTasksPage(false), { workspace: 'crm', title: 'Tasks' });
cx.route('crm-tasks-kanban', () => crmTasksPage(true), { workspace: 'crm', title: 'Tasks' });

const callFrom = (c) => (c.type === 'Outgoing' ? HL_PHONE : numberOf(c.caller, c.reference));
const callTo = (c) => (c.type === 'Outgoing' ? numberOf(c.receiver, c.reference) : HL_PHONE);
cx.route('call-logs', () => cx.page({
  title: 'Call logs', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }],
  actions: [cx.btn('Log a call', { kind: 'primary', icon: 'phone', needs: NEED, onClick: () => pickRecord('Log a call: which lead or deal?', (ctx) => logCallModal(ctx)) })],
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
  const leadsIn = (a, b) => leads.filter((l) => inR(qualOf(l).arrival, a, b));
  const dealsIn = (a, b) => deals.filter((d) => inR(d.createdAt, a, b));
  const wonIn = (a, b) => deals.filter((d) => d.status === 'Won' && inR(d.closedDate, a, b));
  const gbp = (d) => toGbp(d.dealValue, d.currency, d.closedDate || d.createdAt);
  const ongoing = deals.filter(isOpenDeal);
  const won = wonIn(from, TODAY), wonBefore = wonIn(pFrom, pTo);
  const arrived = leadsIn(from, TODAY);
  const replyH = median(arrived.map((l) => qualOf(l).firstReplyHours));
  const replyBefore = median(leadsIn(pFrom, pTo).map((l) => qualOf(l).firstReplyHours));
  const stale = ongoing.filter(staleOf);
  const weighted = sum(ongoing, (d) => toGbp(d.dealValue, d.currency) * (d.probability || 0) / 100);
  const cards = [
    { label: 'Leads in', value: fmt.int(arrived.length), sub: RANGES.find(([k]) => k === range)[1].toLowerCase(), delta: pctDelta(arrived.length, leadsIn(pFrom, pTo).length, noun), href: ['leads'] },
    { label: 'Scored 60 or more', value: fmt.int(arrived.filter((l) => qualOf(l).score >= 60).length), sub: 'by the sales agent, on arrival', href: ['leads'] },
    { label: 'First reply', value: replyH == null ? '—' : durHuman(replyH), sub: 'median, after a lead arrives', delta: replyH != null && replyBefore != null ? { text: `${durHuman(replyBefore)} in the ${noun} before`, good: replyH <= replyBefore } : null, href: ['crm-sources'] },
    { label: 'Pipeline', value: fmt.gbp(weighted), sub: `weighted, ${fmt.plural(ongoing.length, 'deal')} in play`, href: ['pipeline'] },
    { label: 'Stale deals', value: fmt.int(stale.length), sub: `no touch for over two weeks`, href: ['deals'] },
    { label: 'Won', value: fmt.gbp(sum(won, gbp)), sub: won.length ? fmt.plural(won.length, 'deal') + ': ' + won.map((d) => companyName(d.company)).slice(0, 2).join(', ') + (won.length > 2 ? '…' : '') : 'none in the range', delta: pctDelta(won.length, wonBefore.length, noun), href: ['deals'] },
  ];
  // the latest arrivals and the deals in play, as lists
  const inbound = [...leads].filter((l) => !l.converted || dayOf(qualOf(l).arrival) >= addDays(TODAY, -14)).sort((a, b) => String(qualOf(b).arrival).localeCompare(String(qualOf(a).arrival))).slice(0, 8);
  const inboundList = h('div.crm-list', inbound.map((l) => { const q = qualOf(l); return h('a.crm-row', { href: cx.href('lead', l.name) },
    extAvatar(leadName(l), { size: 'sm' }),
    h('div', { style: 'display:grid;gap:2px;min-width:0' }, h('span.t', `${leadName(l)}${l.org ? ' · ' + l.org : ''}`), h('span.m', channelTag(q.channel), h('span', q.need.level ? q.need.text : 'Need not clear yet'), h('span', '→ ' + cx.name(l.owner)))),
    h('div.r', scorePill(q.score), h('span', { title: fmt.datetime(q.arrival) }, fmt.ago(q.arrival)))); }));
  const inPlay = [...ongoing].sort((a, b) => (staleOf(b) || 0) - (staleOf(a) || 0) || String(a.expectedClosureDate).localeCompare(String(b.expectedClosureDate)));
  const playList = inPlay.length ? h('div.crm-list', inPlay.map((d) => h('a.crm-row', { href: cx.href('deal', d.name) },
    extAvatar(companyName(d.company), { size: 'sm', square: true }),
    h('div', { style: 'display:grid;gap:2px;min-width:0' }, h('span.t', dealTitle(d)), h('span.m', stDot('deal', d.status), touchCell(d), d.nextStep ? h('span', 'Next: ' + d.nextStep) : null)),
    h('div.r', h('span', { style: 'color:var(--fg);font-weight:600' }, fmt.money(d.dealValue, d.currency, 0)), staleTag(d) || h('span', cx.name(d.owner)))))) : cx.empty('No deals in play');
  // charts
  const daily = n <= 90;
  const buckets = daily ? Array.from({ length: n }, (_, i) => addDays(from, i)) : monthsBetween(monthKey(from), monthKey(TODAY));
  const bucketOf = (d) => (daily ? dayOf(d) : monthKey(d));
  const countBy = (arr, get) => { const m = new Map(buckets.map((b) => [b, 0])); for (const x of arr) { const k = bucketOf(get(x)); if (m.has(k)) m.set(k, m.get(k) + 1); } return buckets.map((b) => m.get(b)); };
  const trend = cx.chart.line({ labels: buckets.map((b) => (daily ? fmt.day(b) : monthLabel(b))), height: 220, format: (v) => fmt.int(v),
    series: [{ name: 'Leads in', values: countBy(arrived, (l) => qualOf(l).arrival), color: '2' }, { name: 'Deals', values: countBy(dealsIn(from, TODAY), (d) => d.createdAt), color: '3' }, { name: 'Won deals', values: countBy(won, (d) => d.closedDate), color: 'pos' }] });
  const fMonths = monthsBetween(monthKey(range === 'all' ? '2025-05-01' : addDays(TODAY, -Math.max(n, 90))), monthKey(addDays(TODAY, 100)));
  const forecast = fMonths.map((ym) => sum(ongoing.filter((d) => monthKey(d.expectedClosureDate) === ym), (d) => toGbp(d.dealValue, d.currency) * (d.probability || 0) / 100));
  const actual = fMonths.map((ym) => sum(deals.filter((d) => d.status === 'Won' && monthKey(d.closedDate) === ym), gbp));
  const fc = cx.chart.bar({ labels: fMonths.map(monthLabel), height: 220, format: (v) => fmt.compact(v, 'GBP'), tipFormat: (v) => fmt.gbp(v),
    series: [{ name: 'Forecasted', values: forecast, color: '3' }, { name: 'Actual (won)', values: actual, color: '1' }] });
  const tally = (arr, get) => { const m = new Map(); for (const x of arr) { const k = get(x) || 'Not set'; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const PAL = ['1', '2', '3', '4', '5', '6'];
  const leadsR = range === 'all' ? leads : arrived;
  const dealsR = range === 'all' ? deals : dealsIn(from, TODAY);
  const donutOf = (pairs) => (pairs.length ? cx.chart.donut({ items: pairs.map(([label, value], i) => ({ label, value, color: PAL[i % 6] })), center: fmt.int(sum(pairs, (p) => p[1])), format: (v) => fmt.int(v) }) : cx.empty('Nothing in this range'));
  const hbarOf = (pairs, color) => (pairs.length ? cx.chart.hbar({ items: pairs.map(([label, value]) => ({ label, value, color })), format: (v) => fmt.int(v) }) : cx.empty('Nothing in this range'));
  const byStage = ongoing.length ? cx.chart.donut({ items: ST.deal.filter((x) => ['Open', 'Ongoing'].includes(x.type)).map((x) => ({ label: x.name, value: ongoing.filter((d) => d.status === x.name).length, color: x.color })).filter((x) => x.value), center: String(ongoing.length), format: (v) => fmt.int(v) }) : cx.empty('No ongoing deals');
  const scoreBands = [['70 to 100', (s) => s >= 70], ['45 to 69', (s) => s >= 45 && s < 70], ['20 to 44', (s) => s >= 20 && s < 45], ['Under 20', (s) => s < 20]];
  const charts = [
    { title: 'Sales trend', sub: 'Leads in, deals and wins, by ' + (daily ? 'day' : 'month'), node: trend, wide: true },
    { title: 'Leads by how they arrived', node: donutOf(tally(leadsR, (l) => qualOf(l).channel)), href: ['crm-sources'] },
    { title: 'Leads by score', sub: 'The sales agent\'s score on arrival', node: hbarOf(scoreBands.map(([label, f]) => [label, leadsR.filter((l) => f(qualOf(l).score)).length]).filter((p) => p[1]), '2') },
    { title: 'Forecasted revenue', sub: 'Deal value × probability, by expected closure month, against what was won', node: fc, wide: true },
    { title: 'Deals by stage', sub: 'The pipeline now', node: byStage },
    { title: 'Deals by salesperson', node: hbarOf(tally(dealsR, (d) => cx.name(d.owner)), '1') },
    { title: 'Lost deal reasons', sub: 'Why deals were lost', node: hbarOf(tally(dealsR.filter((d) => d.status === 'Lost'), (d) => d.lostReason), 'neg') },
  ];
  const rangeSel = h('select.ctl', { 'aria-label': 'Range', onchange: (e) => { cx.store.set('crm-dash', { range: e.target.value, user }); cx.refresh(); } }, RANGES.map(([k, l]) => h('option', { value: k, selected: k === range }, l)));
  const userSel = h('select.ctl', { 'aria-label': 'Sales user', onchange: (e) => { cx.store.set('crm-dash', { range, user: e.target.value }); cx.refresh(); } }, h('option', { value: '' }, 'All sales users'), uniq([...C.deals, ...C.leads].map((r) => r.owner)).map((id) => h('option', { value: id, selected: id === user }, cx.name(id))));
  return cx.page({
    title: 'Dashboard', workspace: 'crm', crumbs: [{ label: 'CRM', route: 'crm' }],
    sub: `${fmt.date(from)} to ${fmt.date(TODAY)}${user ? ' · ' + cx.name(user) : ''} · amounts in pounds; a dollar deal counts at the day's rate`,
    actions: [cx.btn('Funnel', { icon: 'report', href: ['crm-funnel'] }), cx.btn('Lead sources', { icon: 'report', href: ['crm-sources'] }), cx.btn('Pipeline', { icon: 'kanban', kind: 'primary', href: ['pipeline'] })],
    fde: `The CRM dashboard, ${RANGES.find(([k]) => k === range)[1].toLowerCase()}`,
    body: [
      h('div.crm-dash-bar', h('label', 'Range', rangeSel), h('label', 'Sales user', userSel)),
      h('div.ncards', cards.map((c) => cx.numberCard(c))),
      h('div.grid.c2.crm-dash',
        cx.card({ title: 'Latest leads', actions: cx.btn('All leads', { sm: true, kind: 'ghost', href: ['leads'] }), body: inboundList }),
        cx.card({ title: 'Deals in play', actions: cx.btn('Pipeline', { sm: true, kind: 'ghost', href: ['pipeline'] }), body: playList }),
        charts.map((c) => cx.card({ class: 'chart-card' + (c.wide ? ' wide' : ''), title: c.title, actions: c.href ? cx.btn('Open', { sm: true, kind: 'ghost', href: c.href }) : null, body: [c.sub ? h('p.muted', { style: 'font-size:12.5px;margin-bottom:8px' }, c.sub) : null, c.node] }))),
    ],
  });
}
cx.route('crm', () => crmDashboard(), { workspace: 'crm', title: 'CRM' });

/* =====================================================================================================
   Lead generation. The ideal customer profile Harbourline set with the FDE; prospect lists the sales agent
   builds against it from public sources, each prospect with why it fits; outreach sequences whose every batch
   a person approves before it is sent, with replies captured on the record; inbound capture (the website form,
   events, referrals); nurture for leads that are not ready; campaigns and their results; the funnel by month and
   attribution down to won revenue. Everything is derived from the CRM's own records and these few definitions.
   ===================================================================================================== */

const LG_NEED = { any: ['People', 'Growth', 'Director'] };
const ICP_NEED = { any: ['Director', 'Growth'] };
const atOn = (day, hh, key) => `${dayOf(day)}T${String(hh).padStart(2, '0')}:${String((hashOf(String(key)) % 50) + 5).padStart(2, '0')}:00Z`;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const monthOf = (d) => dayOf(d).slice(0, 7);
const tbl = (head, rows, o = {}) => h('div.tbl-scroll', h('table.tbl', { class: o.cls }, h('thead', h('tr', head.map((c) => h('th', { class: c.num ? 'num' : c.opt ? 'opt' : null }, c.label)))),
  h('tbody', rows.length ? rows : h('tr', h('td', { colspan: head.length, class: 'muted' }, o.empty || 'Nothing yet')))));
const td = (v, o = {}) => h('td', { class: [o.num && 'num', o.opt && 'opt', o.wrap && 'wrap'].filter(Boolean).join(' ') || null }, v ?? h('span.faint', '—'));
const pctOr = (a, b) => (b ? fmt.pct(a / b, 0) : '—');
const daysTxt = (d) => (d == null ? '—' : d < 1 ? 'under a day' : `${fmt.num(d, d < 10 ? 1 : 0)} days`);

/* ---------- the ideal customer profile ---------- */

const ICP = {
  version: 3, setAt: '2026-01-20T11:00:00Z', setWith: ['maya', 'samw', 'leo'], reviewedAt: '2026-10-02T15:00:00Z',
  sectors: [
    { ind: 'Real Estate', label: 'Housing associations and landlords', tier: 'Core' },
    { ind: 'Health Care', label: 'Health care groups and clinics', tier: 'Core' },
    { ind: 'Food', label: 'Food and drink brands', tier: 'Core' },
    { ind: 'Retail', label: 'Retail brands', tier: 'Core' },
    { ind: 'Education', label: 'School trusts and colleges', tier: 'Adjacent' },
    { ind: 'Energy', label: 'Energy and utilities', tier: 'Adjacent' },
    { ind: 'Transportation', label: 'Transport operators', tier: 'Adjacent' },
    { ind: 'Hospitality', label: 'Hotels and hospitality groups', tier: 'Adjacent' },
    { ind: 'Software', label: 'Software companies', tier: 'Referral only' },
  ],
  sizes: [['1-10', 'Not a fit'], ['11-50', 'With a funding round or a named budget'], ['51-200', 'Core'], ['201-500', 'Core'], ['501-1000', 'Core'], ['1001-5000', 'Through a referral']],
  regions: [['London and the South East', 'Core'], ['Rest of England', 'Core'], ['Scotland and Wales', 'Good'], ['Outside the UK', 'Through a referral']],
  minProject: 25000,
  signals: [
    { key: 'tender', label: 'A published tender for digital work', weight: 25, source: 'Find a Tender, Contracts Finder' },
    { key: 'funding', label: 'A funding round in the last six months', weight: 20, source: 'Companies House share allotments, trade press' },
    { key: 'office', label: 'New sites, offices or clinics opening', weight: 15, source: 'Press releases, company websites' },
    { key: 'planning', label: 'A planning application for a new school, shop or site', weight: 15, source: 'Local planning portals' },
    { key: 'hiring', label: 'Hiring for a digital, product or ecommerce role', weight: 15, source: 'Job boards, careers pages' },
    { key: 'leader', label: 'A new chief executive or digital director', weight: 10, source: 'Press, company websites' },
  ],
  exclude: ['Clients with an open deal: their owner looks after them', 'Studios and agencies selling their services to Harbourline', 'Anyone who asked not to be contacted', 'Gambling, tobacco and crypto'],
  history: [],
};
{
  const small = C.leads.filter((l) => l.employees === '1-10' && dayOf(l.createdAt) < '2026-10-02');
  const smallWon = small.filter((l) => C.deals.some((d) => d.lead === l.name && d.status === 'Won')).length;
  ICP.history = [
    { v: 1, at: '2026-01-20T11:00:00Z', by: ['maya', 'samw', 'leo'], text: 'First version, set with the FDE from eight months of won and lost deals: four core sectors, 51 to 1,000 staff, England first.' },
    { v: 2, at: '2026-05-12T14:20:00Z', by: ['leo'], text: 'Added school trusts as an adjacent sector after Mosaic Learning, and hiring for a digital role as a signal.' },
    { v: 3, at: '2026-10-02T15:00:00Z', by: ['maya', 'leo'], text: `Dropped teams under 10 staff (${fmt.plural(small.length, 'lead')} since May 2025, ${smallWon ? smallWon + ' bought' : 'none bought'}) and set a first project of £25,000 or more.` },
  ];
}
const TIER_PTS = { Core: 32, Adjacent: 22, 'Referral only': 6 };
const TIER_TONE = { Core: 'green', Adjacent: 'blue', 'Referral only': 'yellow', Good: 'blue', 'Through a referral': 'yellow', 'Not a fit': 'gray', 'With a funding round or a named budget': 'yellow' };
const TIERS = ['Core', 'Adjacent', 'Referral only', 'Not a fit'];
const sectorOf = (ind) => ICP.sectors.find((s) => s.ind === ind) || null;
const sizeTier = (e) => ICP.sizes.find((s) => s[0] === e)?.[1] || 'Not known';
const regionTier = (r) => ICP.regions.find((x) => x[0] === r)?.[1] || 'Good';
const CITIES = {
  'London and the South East': ['London', 'Brighton', 'Reading', 'Guildford', 'Canterbury', 'Oxford', 'Maidstone', 'Southampton', 'Milton Keynes'],
  'Rest of England': ['Manchester', 'Leeds', 'Bristol', 'Birmingham', 'Nottingham', 'Sheffield', 'Norwich', 'York', 'Exeter', 'Leicester', 'Newcastle', 'Derby', 'Plymouth'],
  'Scotland and Wales': ['Edinburgh', 'Glasgow', 'Cardiff', 'Swansea', 'Aberdeen', 'Dundee'],
};
const regionOf = (city, terr) => Object.keys(CITIES).find((r) => CITIES[r].includes(city)) || (terr && terr !== 'United Kingdom' ? 'Outside the UK' : 'Rest of England');
const cityPick = (key) => { const x = hashOf(key + 'c') % 100; return pick(key + 'cc', CITIES[x < 45 ? 'London and the South East' : x < 88 ? 'Rest of England' : 'Scotland and Wales']); };
/** How well a prospect fits the profile, and why, against the profile as it stands now. */
function fitOf(p) {
  const sec = sectorOf(p.ind), tier = sec?.tier || 'Not listed';
  const sz = sizeTier(p.employees), rt = regionTier(p.region);
  const sig = ICP.signals.find((s) => s.key === p.signal.key);
  const age = daysBetween(p.signal.at, p.listedAt);
  const like = WON_LIKE.get(p.ind);
  const sizePts = sz === 'Core' ? ({ '51-200': 16, '201-500': 21, '501-1000': 19 }[p.employees] || 18) : sz.startsWith('With') ? (p.signal.key === 'funding' ? 15 : 7) : sz.startsWith('Through') ? 5 : 0;
  const fresh = age <= 14 ? 1 : age <= 30 ? 0.8 : age <= 60 ? 0.6 : 0.4;
  const score = clamp(Math.round((TIER_PTS[tier] || 0) + sizePts + ({ Core: 11, Good: 7 }[rt] || 2) + (sig?.weight || 8) * fresh + (like ? 3 : 0) + (p.email ? 4 : 0)), 5, 97);
  const art = tier === 'Core' ? 'a core sector' : tier === 'Adjacent' ? 'an adjacent sector' : tier === 'Referral only' ? 'only through a referral' : tier === 'Not a fit' ? 'not a sector Harbourline looks for' : 'not in the profile';
  return { score, tier, reasons: [
    `${sec ? sec.label : p.ind}: ${art}${like ? `; like ${like}` : ''}`,
    `${uc1(SIZE_WORD[p.employees] || 'size unknown')}: ${sz === 'Core' ? 'the size Harbourline does best' : lc1(sz)}`,
    `${p.city}: ${lc1(p.region)}${rt === 'Core' ? ', a core area' : ''}`,
    `${p.signal.text} (${p.signal.source}, ${fmt.date(p.signal.at)})`,
  ] };
}

/* ---------- campaigns: letters, events, paid posts (outreach sequences join them below) ---------- */

const CAMPAIGNS = [
  { id: 'CMP-2025-01', name: 'Spring studio letter 2025', type: 'Newsletter', start: '2025-05-02', end: '2025-06-30', owner: 'maya', reached: 640, clicks: 71, about: 'Three recent projects and a short note on accessible booking flows.' },
  { id: 'CMP-2025-02', name: 'Retail and Hospitality Design Show, Olympia', type: 'Event', format: 'Stand', start: '2025-06-19', end: '2025-06-20', owner: 'maya', place: 'Olympia, London', reached: 212, capture: 'Badge scans, uploaded the next morning', cost: 6400 },
  { id: 'CMP-2025-03', name: 'Field operations posts on LinkedIn', type: 'Paid social', start: '2025-08-25', end: '2025-10-15', owner: 'samw', reached: 18400, clicks: 236, cost: 2400, about: 'Sponsored posts on route planning and field-service tools, aimed at operations directors.' },
  { id: 'CMP-2025-04', name: 'Open studio, Hoxton Design Week', type: 'Event', format: 'Own event', start: '2025-09-04', owner: 'maya', place: 'Harbourline studio, Hoxton', reached: 58, capture: 'Sign-in sheet', cost: 1200 },
  { id: 'CMP-2025-05', name: 'Autumn studio letter 2025', type: 'Newsletter', start: '2025-09-30', end: '2025-12-15', owner: 'samw', reached: 780, clicks: 64, about: 'The Northstar loyalty app, and what changes when a service goes self-serve.' },
  { id: 'CMP-2026-01', name: 'Digital on a budget: a breakfast talk', type: 'Event', format: 'Own event', start: '2026-01-06', owner: 'leo', place: 'Harbourline studio, Hoxton', reached: 41, capture: 'Sign-in sheet', cost: 900 },
  { id: 'CMP-2026-02', name: 'Winter studio letter 2026', type: 'Newsletter', start: '2026-01-08', end: '2026-03-31', owner: 'leo', reached: 920, clicks: 58, about: 'Fernhill Energy\'s customer app, one year on.' },
  { id: 'CMP-2026-03', name: 'Leisure and Venues Expo, Birmingham', type: 'Event', format: 'Stand', start: '2026-02-12', end: '2026-02-13', owner: 'leo', place: 'NEC, Birmingham', reached: 164, capture: 'Badge scans, uploaded the next morning', cost: 4800 },
  { id: 'CMP-2026-04', name: 'Spring studio letter 2026: the Larkspur app', type: 'Newsletter', start: '2026-04-28', end: '2026-07-15', owner: 'leo', reached: 1040, clicks: 92, about: 'How Larkspur Coffee moved its loyalty scheme into one app.' },
  { id: 'CMP-2026-05', name: 'Summer open studio', type: 'Event', format: 'Own event', start: '2026-07-23', owner: 'maya', place: 'Harbourline studio, Hoxton', reached: 64, capture: 'Sign-in sheet', cost: 1500 },
  { id: 'CMP-2026-06', name: 'Autumn studio letter 2026: Pennant Rail', type: 'Newsletter', start: '2026-09-10', end: '2026-11-30', owner: 'leo', reached: 1180, clicks: 104, about: 'Pennant Rail\'s passenger information service, and three things we learnt.' },
  { id: 'CMP-2026-07', name: 'Design for housing and care: a breakfast talk', type: 'Event', format: 'Own event', start: '2026-10-08', owner: 'samw', place: 'Harbourline studio, Hoxton', reached: 37, capture: 'Sign-in sheet', cost: 850 },
  { id: 'CMP-2026-08', name: 'Makers and Independents Fair, Spitalfields', type: 'Event', format: 'Stand', start: '2026-10-30', end: '2026-10-31', owner: 'samw', place: 'Old Spitalfields Market, London', reached: 96, capture: 'Badge scans, uploaded the next morning', cost: 2200 },
  { id: 'CMP-2026-09', name: 'Accessible public services: a breakfast talk', type: 'Event', format: 'Own event', start: '2026-11-26', owner: 'maya', place: 'Harbourline studio, Hoxton', capture: 'Invitations and replies', cost: 950, upcoming: true, about: 'Two short talks on services people can use the first time: housing repairs and school admissions. Thirty seats.' },
];
const CAMP = new Map(CAMPAIGNS.map((c) => [c.id, c]));
/** The campaign a lead came in through: the event it was met at, or the letter or post it answered. */
const CAMP_OF = new Map();
/** Website-form leads who first clicked through from a studio letter. */
const NEWS_FIRST = new Map();
for (const l of C.leads) {
  const q = qualOf(l), d = dayOf(q.arrival);
  if (q.channel === 'Event') {
    const ev = CAMPAIGNS.filter((c) => c.type === 'Event' && !c.upcoming && c.start <= d && daysBetween(c.start, d) <= 30).sort((a, b) => b.start.localeCompare(a.start))[0];
    if (ev) CAMP_OF.set(l.name, ev);
  } else if (q.channel === 'Campaign') {
    const c = CAMPAIGNS.filter((c) => c.type !== 'Event' && c.start <= d && (c.end || c.start) >= d).sort((a, b) => b.start.localeCompare(a.start))[0]
      || CAMPAIGNS.filter((c) => c.type === 'Newsletter' && c.start <= d).sort((a, b) => b.start.localeCompare(a.start))[0];
    if (c) CAMP_OF.set(l.name, c);
  } else if (q.channel === 'Website form' && hashOf(l.name + 'nl') % 4 === 0) {
    const c = CAMPAIGNS.find((c) => c.type === 'Newsletter' && c.start <= d && c.end >= d);
    if (c) NEWS_FIRST.set(l.name, c);
  }
}
/** Who introduced each referral: a client's contact, or a partner studio. */
const PARTNERS = [{ name: 'Kiln Developers', what: 'a development partner' }, { name: 'Northbank Brand Partners', what: 'a brand agency Harbourline works with' }, { name: 'Fieldwork Research', what: 'a user research partner' }];
const REFERRAL = new Map();
for (const l of C.leads) {
  if (qualOf(l).channel !== 'Referral') continue;
  const d = dayOf(qualOf(l).arrival);
  const cands = C.deals.filter((x) => x.status === 'Won' && x.closedDate && x.closedDate < d && x.company && x.company !== l.company && companyName(x.company) !== l.org).map((x) => ({ deal: x, c: primaryOf(x) })).filter((x) => x.c);
  if (cands.length && hashOf(l.name + 'rf') % 4) { const x = cands[hashOf(l.name + 'rc') % cands.length]; REFERRAL.set(l.name, { kind: 'Client', who: x.c.name, contact: x.c.id, company: x.deal.company, org: companyName(x.deal.company) }); }
  else { const p = pick(l.name + 'rp', PARTNERS); REFERRAL.set(l.name, { kind: 'Partner', who: p.name, org: p.name, what: p.what }); }
}

/* ---------- prospect lists and their outreach sequences ---------- */

const LISTS = [
  { id: 'PL-2026-01', name: 'Food and drink brands after a funding round', ind: 'Food', signal: 'funding', builtAt: '2026-01-26', owner: 'samw', n: 34, batch: 9, sizes: ['11-50', '51-200', '201-500'], pain: 'the website and the online shop usually have to grow up quickly', idea: 'a shop that a two-person team can run without a developer' },
  { id: 'PL-2026-02', name: 'Retail brands hiring for ecommerce', ind: 'Retail', signal: 'hiring', builtAt: '2026-03-16', owner: 'samw', n: 38, batch: 10, sizes: ['11-50', '51-200', '201-500'], pain: 'the new person usually inherits a shop that is hard to change', idea: 'a 90-day plan the new hire can own from their first week' },
  { id: 'PL-2026-03', name: 'Health care groups opening new clinics', ind: 'Health Care', signal: 'office', builtAt: '2026-04-06', owner: 'leo', n: 44, batch: 11, sizes: ['51-200', '201-500', '501-1000'], pain: 'booking and patient information tend to split across the sites', idea: 'one booking flow for every clinic, with each site\'s own hours' },
  { id: 'PL-2026-04', name: 'School trusts with a new school in planning', ind: 'Education', signal: 'planning', builtAt: '2026-04-20', owner: 'leo', n: 36, batch: 9, sizes: ['51-200', '201-500', '501-1000'], pain: 'parents and staff need one place for admissions, news and forms', idea: 'one admissions journey across every school in the trust' },
  { id: 'PL-2026-05', name: 'Food and drink brands opening shops', ind: 'Food', signal: 'planning', builtAt: '2026-05-11', owner: 'samw', n: 30, batch: 10, sizes: ['11-50', '51-200', '201-500'], pain: 'click-and-collect and the brand\'s own site tend to need a rethink', idea: 'click-and-collect that works the day the shop opens' },
  { id: 'PL-2026-06', name: 'School trusts hiring a digital lead', ind: 'Education', signal: 'hiring', builtAt: '2026-09-21', owner: 'leo', n: 41, batch: 7, sizes: ['51-200', '201-500', '501-1000'], pain: 'the first job is usually to tidy up a dozen school websites', idea: 'one design system for every school site in the trust', event: 'CMP-2026-09', interested: 1 },
  { id: 'PL-2026-07', name: 'Housing associations with a repairs or tenant services tender', ind: 'Real Estate', signal: 'tender', builtAt: '2026-10-19', owner: 'samw', n: 52, batch: 12, sizes: ['51-200', '201-500', '501-1000'], pain: 'tenants judge the whole service by how easy it is to report a repair', idea: 'reporting a repair in under two minutes, from a phone, with a photo', event: 'CMP-2026-09', interested: 2 },
  { id: 'PL-2026-08', name: 'Health care groups hiring digital product roles', ind: 'Health Care', signal: 'hiring', builtAt: '2026-11-06', owner: 'leo', n: 14, sizes: ['51-200', '201-500', '501-1000'], pending: true },
];
const LIST = new Map(LISTS.map((L) => [L.id, L]));
const FIRSTS = ['Hannah', 'James', 'Aisha', 'Tom', 'Callum', 'Sophie', 'Daniel', 'Fatima', 'Owen', 'Rachel', 'Marcus', 'Chloe', 'Imran', 'Laura', 'Gareth', 'Niamh', 'Ben', 'Yasmin', 'Rhys', 'Claire', 'Joe', 'Eleanor', 'Kwesi', 'Megan', 'Lucy', 'Adam', 'Sana', 'Fraser', 'Holly', 'Nathan', 'Zainab', 'Euan', 'Kate', 'Simon', 'Dev', 'Alice', 'Connor', 'Bethan', 'Martha', 'Kofi'];
const LASTS = ['Carter', 'Hughes', 'Patel', 'Morris', 'Begum', 'Reid', 'Walsh', 'Khan', 'Price', 'Doyle', 'Fletcher', 'Lloyd', 'Campbell', 'Turner', 'Bennett', 'Murray', 'Okoro', 'Evans', 'Gill', 'Hart', 'Lewis', 'Mason', 'Noor', 'Parry', 'Quinn', 'Rowe', 'Stewart', 'Tait', 'Vaughan', 'Wood', 'Young', 'Malik', 'Sinclair', 'Hale', 'Dunn', 'Iqbal', 'Jarvis', 'Kerr'];
const ORG_POOL = {
  Food: [['Hearth', 'Saltbox', 'Greyfriars', 'Kiln Lane', 'Bramley', 'Fenland', 'Quince', 'Ember', 'Hopwood', 'Red Kite', 'Cobble', 'Wildacre', 'Juniper', 'Blackthorn', 'Seven Hills', 'Honeycomb', 'Millstone', 'Wheatsheaf', 'Old Dairy', 'Foxhole', 'Sorrel', 'Pebble', 'Marram', 'Tidemill', 'Larkhill', 'Coldharbour', 'Rookery', 'Damson', 'Gorse', 'Hazelbrook', 'Nettlebed', 'Orchard Row', 'Pantile', 'Quarry Lane', 'Rushmere', 'Sloe', 'Tollgate', 'Underhill', 'Wychwood', 'Yarrow'], ['Coffee Roasters', 'Bakery', 'Gin', 'Brewing', 'Kitchen', 'Foods', 'Chocolate', 'Cider', 'Tea', 'Creamery']],
  Retail: [['Fellside', 'Northlight', 'Stonebridge', 'Ashlar', 'Moss & Fern', 'Tamsin', 'Hollins', 'Cardew', 'Brackenridge', 'Selby', 'Linwood', 'Penhallow', 'Arkwright', 'Grove Street', 'Thornfield', 'Bellmont', 'Maple & Tide', 'Wren & Weave', 'Harbour & Hide', 'Calloway', 'Alder & Ash', 'Birchfield', 'Cobalt Lane', 'Dovecote', 'Elm & Iron', 'Fairhaven', 'Glenrock', 'Hatherley', 'Inglewood', 'Kestrel Row', 'Lowther', 'Merrow', 'Netherby', 'Oxley', 'Priory Lane', 'Redgrave', 'Saltire', 'Trevose', 'Upton & Vale', 'Warwick Row'], ['Outdoor', 'Homeware', 'Knitwear', 'Footwear', 'Cycles', 'Books', 'Interiors', 'Ceramics', 'Supply', 'Workwear']],
  'Health Care': [['Elmwood', 'Westbrook', 'Northgate', 'Cedar', 'Linnet', 'Ashgrove', 'Meadowbank', 'Kingsway', 'Brookside', 'Hillcrest', 'Thornbury', 'Fairfield', 'Greenway', 'Parkside', 'Lindley', 'Beacon', 'Southdown', 'Harlow Vale', 'Wyndham', 'Rosewood', 'Abbeyfield', 'Bridgeway', 'Castlegate', 'Dalton', 'Eastleigh', 'Foxley', 'Glebe', 'Holmwood', 'Ivydene', 'Juniper Lane', 'Kenmore', 'Langley', 'Millbrook', 'Newlands', 'Oakfield', 'Pinewood', 'Queensway', 'Ravenscroft', 'Sandown', 'Tarnside', 'Upland', 'Valley Road', 'Wellington', 'Yewtree', 'Ashby Road', 'Belmont'], ['Dental Group', 'Physio', 'Health Partnership', 'Clinics', 'Eye Care', 'Care Group', 'Medical Group', 'Hearing Centres', 'Vets', 'Pharmacy Group']],
  Education: [['Thames Valley', 'Wessex', 'Broadland', 'Peak', 'Mercia', 'Forest', 'Coastal', 'Severn', 'Northern Star', 'Endeavour', 'Oak Hill', 'Riverside', 'Pathways', 'Unity', 'Horizon', 'Compass', 'Beacon Hill', 'Kite', 'Lighthouse', 'Chalk Hills', 'Fenway', 'Bridgewater', 'Aspire', 'Brook Valley', 'Cathedral', 'Dales', 'East Anglia', 'Flying High', 'Greenfields', 'Harmony', 'Ignite', 'Keystone', 'Lakeside', 'Marlborough', 'Nova', 'Orchard Hill', 'Pioneer', 'Quest', 'Rosemary', 'Summit', 'Tamworth', 'Uplands', 'Vale of York', 'Weald and Downs', 'Yorkshire Dales', 'Arden Valley', 'Brightstar'], ['Academy Trust', 'Learning Trust', 'Schools Partnership', 'Education Trust', 'Multi-Academy Trust']],
  'Real Estate': [['Thameside', 'Weald', 'Medway', 'Chiltern', 'Severn Vale', 'Pennine', 'Kennet', 'Tamar', 'Solent', 'Cotswold', 'Marches', 'Wyvern', 'Brookmere', 'Calder Valley', 'Ouse Valley', 'Downland', 'Rother', 'Avonside', 'Lune Valley', 'Trent and Dove', 'Wansbeck', 'Exe Valley', 'Mendip', 'Fylde', 'Aire Valley', 'Blackwater', 'Cheviot', 'Derwent', 'Eden Valley', 'Fenland', 'Gower', 'Humber', 'Irwell', 'Kingsbridge', 'Lea Valley', 'Malvern', 'Nene Valley', 'Orwell', 'Purbeck', 'Quantock', 'Ribble', 'Stour Valley', 'Teme', 'Ure', 'Wear Valley', 'Wolds', 'Arun', 'Bure', 'Colne', 'Dart', 'Erewash', 'Frome', 'Glen', 'Hamble', 'Itchen', 'Kent Coast'], ['Housing', 'Homes', 'Housing Association', 'Housing Group', 'Homes Trust']],
};
const DOMAIN = { 'Real Estate': '.org.uk', Education: '.org.uk', 'Health Care': '.co.uk', Food: '.co.uk', Retail: '.co.uk' };
const HIRE_ROLE = { Food: 'Head of Ecommerce', Retail: 'Head of Ecommerce', 'Health Care': 'Head of Digital Product', Education: 'Trust Digital Lead', 'Real Estate': 'Head of Digital Services' };
const usedOrg = new Set([...C.companies.map((c) => c.name), ...C.leads.map((l) => l.org)].filter(Boolean).map((s) => s.toLowerCase()));
const usedPre = new Map();
function orgName(L, i) {
  const [pre, suf] = ORG_POOL[L.ind];
  const taken = usedPre.get(L.id) || usedPre.set(L.id, new Set()).get(L.id);
  for (let k = 0; k < 800; k++) {
    const a = pre[hashOf(`${L.id}${i}a${k}`) % pre.length];
    if (taken.has(a) && k < 400) continue;
    const nm = `${a} ${suf[hashOf(`${L.id}${i}b${k}`) % suf.length]}`;
    if (!usedOrg.has(nm.toLowerCase())) { usedOrg.add(nm.toLowerCase()); taken.add(a); return nm; }
  }
  return `${pre[i % pre.length]} ${suf[i % suf.length]}`;
}
function contactRole(L, key) {
  if (L.signal === 'funding') return pick(key + 'r', ['Founder', 'Chief Executive', 'Managing Director']);
  if (L.signal === 'hiring') return pick(key + 'r', L.ind === 'Education' ? ['Chief Operating Officer', 'Chief Executive'] : ['Marketing Director', 'Chief Operating Officer', 'Chief Executive']);
  if (L.signal === 'tender') return pick(key + 'r', ['Head of Customer Services', 'Director of Housing Services', 'Digital Transformation Lead']);
  if (L.signal === 'planning') return L.ind === 'Education' ? pick(key + 'r', ['Chief Operating Officer', 'Chief Executive']) : 'Managing Director';
  return pick(key + 'r', ['Operations Director', 'Chief Executive', 'Head of Patient Services']);
}
function sigFor(L, key, city) {
  const x = hashOf(key + 'sig');
  const at = addDays(L.builtAt, -(3 + (x % 48)));
  let text, thing, source;
  switch (L.signal) {
    case 'funding': { const amt = [1.2, 1.8, 2.5, 3.2, 4.5, 6][x % 6]; text = `Raised £${amt}m in a ${amt < 3 ? 'seed round' : 'Series A round'}`; thing = 'round'; source = x % 2 ? 'Companies House: new shares allotted' : 'Trade press'; break; }
    case 'hiring': thing = HIRE_ROLE[L.ind]; text = `Hiring a ${thing}`; source = pick(key + 'js', ['Job boards', 'Their careers page']); break;
    case 'office': { const n = 1 + (x % 3); thing = n === 1 ? 'new clinic' : 'new clinics'; text = `Opening ${n === 1 ? 'a new clinic' : n + ' new clinics'} in and around ${city}`; source = 'Press release'; break; }
    case 'planning': thing = L.ind === 'Education' ? pick(key + 'pl', ['primary school', 'secondary school', 'sixth-form centre']) : 'shop and café'; text = `Planning application for a new ${thing} in ${city}`; source = `${city} planning portal`; break;
    default: thing = pick(key + 'td', ['repairs reporting service', 'tenant portal', 'customer contact service', 'tenant app']); text = `Tender for a ${thing}, closing ${fmt.date(addDays(L.builtAt, 21 + (x % 30)))}`; source = 'Find a Tender'; break;
  }
  return { key: L.signal, text, thing, source, at };
}
/** The five steps of a list's sequence; each renders for one prospect. */
const STEP_DAYS = [0, 3, 7, 12, 18];
function stepsOf(L) {
  const like = WON_LIKE.get(L.ind);
  const me = cx.firstName(L.owner);
  const ev = L.event ? CAMP.get(L.event) : null;
  const subj0 = (p) => ({ funding: 'Congratulations on the round', hiring: `Your ${p.signal.thing} role`, office: `The ${p.signal.thing} in ${p.city}`, planning: `The new ${p.signal.thing} in ${p.city}`, tender: `Your ${p.signal.thing} tender` }[L.signal]);
  const hook = (p) => ({ funding: `I saw that ${p.org} has just raised new money. Congratulations.`, hiring: `I saw that ${p.org} is hiring a ${p.signal.thing}.`, office: `I saw that ${p.org} is opening ${p.signal.thing} in and around ${p.city}.`, planning: `I saw the planning application for ${p.org}'s new ${p.signal.thing} in ${p.city}.`, tender: `I saw ${p.org}'s tender for a ${p.signal.thing}.` }[L.signal]);
  return [
    { kind: 'email', label: 'First email', subject: subj0, body: (p) => `Hi ${p.first},\n\n${hook(p)} When that happens, ${L.pain}. We're Harbourline, a design and engineering studio in Hoxton${like ? `; we did this for ${like}` : ''}.\n\nWould 20 minutes next week be useful? I'll bring two examples.\n\n${me}` },
    { kind: 'linkedin', label: 'LinkedIn note', subject: () => 'Connection request', body: (p) => `Hi ${p.first}, I run new work at Harbourline, a studio in Hoxton. ${hook(p)} Happy to connect and swap notes.` },
    { kind: 'email', label: 'Follow-up with a case study', subject: (p) => `Re: ${subj0(p)}`, body: (p) => `Hi ${p.first},\n\nIn case it's useful, here is how we approached ${like ? `this for ${like}` : 'something similar for a client'}: two pages, no sign-up.\n\n${me}` },
    ev ? { kind: 'event', label: 'Invitation', event: ev.id, subject: () => `An invitation: ${ev.name}, ${fmt.day(ev.start)}`, body: (p) => `Hi ${p.first},\n\nWe're hosting a breakfast at the studio in Hoxton on ${fmt.dateLong(ev.start)}. ${ev.about} Would you like to come?\n\n${me}` }
      : { kind: 'email', label: 'One idea for them', subject: (p) => `One idea for ${p.org}`, body: (p) => `Hi ${p.first},\n\nOne idea we keep coming back to: ${L.idea}. Happy to sketch it for ${p.org} if that's useful.\n\n${me}` },
    { kind: 'email', label: 'Last note', subject: (p) => `Re: ${subj0(p)}`, body: (p) => `Hi ${p.first},\n\nI won't keep writing. If this comes up later in the year, I'd be glad to help.\n\n${me}` },
  ].map((s, i) => ({ ...s, step: i, day: STEP_DAYS[i] }));
}
const REPLY_TONE = { Interested: 'green', 'Wrote in': 'green', 'Not now': 'blue', 'Not interested': 'gray', 'Wrong person': 'yellow', Unsubscribe: 'red', 'Out of office': 'muted', Bounced: 'red' };
function replyText(p) {
  const r = p.reply, me = cx.firstName(p.owner);
  switch (r.cls) {
    case 'Interested': return `Thanks ${me}, good timing. We're working through exactly this at the moment. Could we talk next week? Tuesday or Wednesday morning suits me.\n\n${p.first}`;
    case 'Not now': return `Thanks for this. Not for us this year: our budget is set until ${fmt.month(r.until)}. Do get back in touch then.\n\n${p.first}`;
    case 'Not interested': return `Thanks, but we have this covered with our current agency.\n\n${p.first}`;
    case 'Wrong person': return `I'm not the right person for this. ${r.colleague} looks after it; I've copied them in.`;
    case 'Unsubscribe': return 'Please take me off your list.';
    case 'Out of office': return `I'm out of the office until ${fmt.date(r.until)} with limited access to email.`;
    case 'Bounced': return 'The address no longer exists.';
    default: return '';
  }
}

const PROSPECTS = [];
const PROS = new Map();
const PROS_OF_LEAD = new Map();
const SEQS = [];
const SEQ = new Map();
const NOT_FIT = ['Part of a larger group that buys centrally', 'Already on a long contract with another studio', 'The signal turned out to be an old story', 'Smaller than it looked: under 10 staff'];
{
  let n = 0;
  const mapped = new Set();
  const openAt = (d, day) => dayOf(d.createdAt) < day && (!d.closedDate || d.closedDate > day);
  for (const L of LISTS) {
    if (!L.pending) { L.seq = 'SEQ-' + L.id.slice(3); L.seqName = 'Outreach: ' + lc1(L.name); }
    const from = addDays(L.builtAt, 3), to = addDays(L.builtAt, 45);
    const leads = L.pending ? [] : C.leads.filter((l) => !mapped.has(l.name) && l.industry === L.ind && ['Email', 'Campaign', 'Website'].includes(l.source) && l.status !== 'Junk' && L.sizes.includes(l.employees)
      && dayOf(qualOf(l).arrival) >= from && dayOf(qualOf(l).arrival) <= to
      && !C.deals.some((d) => (d.company === l.company || companyName(d.company) === l.org) && openAt(d, L.builtAt))).slice(0, 3);
    leads.forEach((l) => mapped.add(l.name));
    const items = [];
    for (let i = 0; i < L.n - leads.length; i++) {
      const key = `${L.id}:${i}`, city = cityPick(key), org = orgName(L, i);
      const first = pick(key + 'f', FIRSTS), last = pick(key + 'l', LASTS);
      const dom = org.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '') + DOMAIN[L.ind];
      items.push({ key, org, ind: L.ind, employees: pick(key + 'e', L.sizes), city, region: regionOf(city), website: dom, first, last, role: contactRole(L, key), email: `${first.toLowerCase()}.${last.toLowerCase()}@${dom}`, signal: sigFor(L, key, city) });
    }
    for (const l of leads) {
      const co = COMPANY.get(l.company);
      const city = co?.address ? co.address.split(',')[0] : cityPick(l.name);
      items.splice(hashOf(l.name) % (items.length + 1), 0, { key: l.name, org: l.org, ind: l.industry, employees: l.employees, city, region: regionOf(city, l.territory), website: l.website, first: l.firstName, last: l.lastName, role: l.jobTitle || contactRole(L, l.name), email: l.email, signal: sigFor(L, l.name, city), lead: l.name });
    }
    // clients the agent left out: their owner looks after them
    const ex = C.companies.filter((co) => co.industry === L.ind && C.deals.some((d) => d.company === co.id && dayOf(d.createdAt) < L.builtAt)).slice(0, 3).map((co) => {
      const ds = C.deals.filter((d) => d.company === co.id && dayOf(d.createdAt) < L.builtAt).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const open = ds.find((d) => openAt(d, L.builtAt)), won = ds.find((d) => d.status === 'Won' && d.closedDate <= L.builtAt);
      const city = co.address ? co.address.split(',')[0] : cityPick(co.id);
      return { key: co.id, org: co.name, company: co.id, ind: co.industry, employees: co.employees, city, region: regionOf(city, co.territory), website: co.website, first: '', last: '', role: '', email: '', signal: sigFor(L, co.id, city), excluded: open ? `An open deal with ${cx.name(open.owner)}` : won ? `A client since ${fmt.date(won.closedDate)}; ${cx.name(won.owner)} looks after them` : `Talked to in ${fmt.month(ds[0].createdAt)}; ${cx.name(ds[0].owner)} decides`, deal: (open || won || ds[0]).name };
    });
    let k = 0;
    const listed = [];
    for (const p of [...items, ...ex]) {
      Object.assign(p, { id: `PRS-2026-${String(++n).padStart(5, '0')}`, list: L.id, seq: L.seq || null, owner: L.owner, listedAt: atOn(L.builtAt, 7, p.key), name: [p.first, p.last].filter(Boolean).join(' '), listName: L.name, touches: [] });
      listed.push(p);
      if (p.excluded) { p.status = 'Excluded'; continue; }
      if (L.pending) { p.status = 'Waiting for approval'; continue; }
      if (!p.lead && hashOf(p.key + 'nf') % 100 < 6) { p.status = 'Not a fit'; p.whyNot = pick(p.key + 'wn', NOT_FIT); continue; }
      let enrol = addDays(L.builtAt, 1 + 7 * Math.floor(k / L.batch) + (k % 2)); k++;
      const lead = p.lead ? C.leads.find((l) => l.name === p.lead) : null;
      if (lead) { const back = addDays(dayOf(qualOf(lead).arrival), -(9 + (hashOf(p.key) % 6))); enrol = back < addDays(L.builtAt, 1) ? addDays(L.builtAt, 1) : back < enrol ? back : enrol; }
      p.enrolAt = enrol;
      p.touches = STEP_DAYS.map((d, s) => ({ step: s, at: atOn(addDays(enrol, d), s === 1 ? 12 : 8, p.key + s), state: 'Scheduled' }));
      let stopAt = null;
      if (lead) { p.reply = { cls: 'Wrote in', at: qualOf(lead).arrival, via: qualOf(lead).channel }; stopAt = p.reply.at; }
      else {
        const sent = p.touches.filter((t) => t.at < NOW0);
        const x = hashOf(p.key + 'o') % 100;
        const cls = x < 3 ? 'Bounced' : x < 7 ? 'Unsubscribe' : x < 14 ? 'Not now' : x < 18 ? 'Not interested' : x < 21 ? 'Wrong person' : x < 24 ? 'Out of office' : null;
        if (cls && sent.length) {
          const t = cls === 'Bounced' ? p.touches[0] : sent[hashOf(p.key + 'r') % sent.length];
          const at = cls === 'Bounced' ? isoPlus(t.at, 3) : isoPlus(t.at, 60 * (5 + (hashOf(p.key + 'ra') % 40)));
          if (at < NOW0) {
            p.reply = { cls, at, step: t.step, via: t.step === 1 ? 'LinkedIn' : 'Email' };
            if (cls === 'Not now') { p.reply.until = addDays(dayOf(at), 100 + (hashOf(p.key) % 80)); if (p.reply.until < TODAY) p.checkedBack = atOn(p.reply.until, 9, p.key + 'cb'); }
            if (cls === 'Out of office') p.reply.until = addDays(dayOf(at), 5 + (hashOf(p.key) % 9));
            if (cls === 'Wrong person') { const f = pick(p.key + 'wf', FIRSTS), ln = pick(p.key + 'wl', LASTS); p.reply.colleague = `${f} ${ln}`; p.contactWas = p.name; p.first = f; p.last = ln; p.name = `${f} ${ln}`; p.email = `${f.toLowerCase()}.${ln.toLowerCase()}@${p.website}`; p.role = pick(p.key + 'wr', ['Head of Digital', 'Digital Programme Manager', 'Head of Marketing']); }
            if (['Bounced', 'Unsubscribe', 'Not now', 'Not interested'].includes(cls)) stopAt = at;
            if (cls === 'Out of office') { const shift = Math.max(0, daysBetween(at, p.reply.until)); for (const tt of p.touches) if (tt.at > at) tt.at = isoPlus(tt.at, shift * 1440); }
          }
        }
      }
      for (const t of p.touches) {
        if (stopAt && t.at > stopAt) t.state = 'Stopped';
        else if (t.at < NOW0) { t.state = 'Sent'; t.approvedBy = L.owner; t.approvedAt = isoPlus(t.at, -(25 + (hashOf(p.key + t.step) % 200))); }
        else t.state = dayOf(t.at) <= addDays(TODAY, 1) ? 'Waiting for approval' : 'Scheduled';
      }
    }
    // live lists: the latest interested replies, waiting for their owner to make them leads
    if (L.interested) {
      const cands = listed.filter((p) => p.touches.length && !p.reply && p.touches.filter((t) => t.state === 'Sent').length >= 2).sort((a, b) => hashOf(a.key + 'i') - hashOf(b.key + 'i')).slice(0, L.interested);
      cands.forEach((p, i) => {
        const last = p.touches.filter((t) => t.state === 'Sent').at(-1);
        let at = isoPlus(last.at, 60 * (18 + i * 5)); if (at >= NOW0) at = isoPlus(NOW0, -(70 + i * 140));
        p.reply = { cls: 'Interested', at, step: last.step, via: last.step === 1 ? 'LinkedIn' : 'Email' };
        for (const t of p.touches) if (t.at > at) t.state = 'Stopped';
      });
    }
    for (const p of listed) {
      if (p.status) continue;
      const r = p.reply?.cls;
      p.status = p.lead ? 'Lead' : r === 'Interested' ? 'Replied' : r === 'Bounced' ? 'Bounced' : r === 'Unsubscribe' ? 'Do not contact' : r === 'Not now' ? (p.checkedBack ? 'Closed' : 'Nurture') : r === 'Not interested' ? 'Closed'
        : p.touches.some((t) => ['Waiting for approval', 'Scheduled', 'Approved'].includes(t.state)) ? 'In sequence' : 'No reply';
      if (p.lead) PROS_OF_LEAD.set(p.lead, p);
    }
    for (const p of listed) { PROSPECTS.push(p); PROS.set(p.id, p); }
    if (!L.pending) { const S = { id: L.seq, name: L.seqName, list: L, owner: L.owner, steps: stepsOf(L) }; SEQS.push(S); SEQ.set(S.id, S); }
  }
}
const prosOf = (L) => PROSPECTS.filter((p) => p.list === L.id);
const SIGNAL_WORD = { tender: 'Tenders', funding: 'Funding rounds', office: 'New sites', planning: 'Planning applications', hiring: 'Job ads', leader: 'New leaders' };
const excerpt = (t, n = 90) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); if (x.length <= n) return x; const cut = x.slice(0, n); return cut.slice(0, cut.lastIndexOf(' ')) + '…'; };
const lgTitle = (name, route, id, square) => h('span.crm-name.lg-ttl', extAvatar(name, { size: 'sm', square }), h('a', { href: cx.href(route, id) }, name));
const enrolled = (ps) => ps.filter((p) => p.touches.length);
const seqStatus = (S) => (prosOf(S.list).some((p) => p.status === 'In sequence' || p.status === 'Replied') ? 'Live' : 'Finished');
const P_TONE = { 'Approved for outreach': 'teal', 'In sequence': 'blue', Replied: 'green', Lead: 'teal', Nurture: 'blue', 'No reply': 'gray', Closed: 'gray', Bounced: 'orange', 'Do not contact': 'red', 'Not a fit': 'gray', Excluded: 'muted', 'Waiting for approval': 'yellow' };
const pStatus = (p) => cx.pill(p.status, P_TONE[p.status] || 'gray');
const fitPill = (p) => scorePill(fitOf(p).score);
const nextTouch = (p) => p.touches.find((t) => ['Waiting for approval', 'Approved', 'Scheduled'].includes(t.state)) || null;

/* the outreach before a lead wrote in, on the lead's own timeline */
for (const p of PROSPECTS) {
  if (!p.lead) continue;
  const S = SEQ.get(p.seq);
  for (const t of p.touches) {
    if (t.state !== 'Sent' || S.steps[t.step].kind !== 'email') continue;
    const st = S.steps[t.step];
    indexTl({ id: `lg_${p.id}_${t.step}`, kind: 'email', direction: 'out', from: memberEmail(p.owner), fromName: cx.name(p.owner), to: [p.email].filter(Boolean), cc: [], subject: st.subject(p), body: st.body(p), attachments: [], at: t.at, by: p.owner, draftedBy: AGENT, loggedBy: AGENT, recordName: p.lead, recordType: 'Lead', derived: true, outreach: p.seq });
  }
}

/* ---------- where a lead came from: first and last touch ---------- */

const ATTR_GROUPS = ['Outreach', 'Events', 'Newsletters', 'Paid social', 'Referrals', 'Website', 'Direct', 'Existing clients'];
function lastTouchOf(l) {
  const q = qualOf(l), c = CAMP_OF.get(l.name);
  switch (q.channel) {
    case 'Event': return c ? { group: 'Events', label: c.name, route: 'campaign', id: c.id } : { group: 'Events', label: 'Other events' };
    case 'Campaign': return c ? { group: c.type === 'Paid social' ? 'Paid social' : 'Newsletters', label: c.name, route: 'campaign', id: c.id } : { group: 'Newsletters', label: 'Other letters' };
    case 'Referral': { const r = REFERRAL.get(l.name); return { group: 'Referrals', label: r?.kind === 'Partner' ? 'From partners' : 'From clients', ref: r }; }
    case 'Website form': return { group: 'Website', label: 'Website form' };
    case 'WhatsApp': return { group: 'Website', label: 'WhatsApp from the website' };
    case 'Existing client': return { group: 'Existing clients', label: 'More work from clients' };
    default: return { group: 'Direct', label: 'Email to the studio' };
  }
}
function firstTouchOf(l) {
  const p = PROS_OF_LEAD.get(l.name);
  if (p && SEQ.get(p.seq)) { const S = SEQ.get(p.seq); return { group: 'Outreach', label: S.name, route: 'sequence', id: S.id }; }
  const n = NEWS_FIRST.get(l.name);
  if (n) return { group: 'Newsletters', label: n.name, route: 'campaign', id: n.id };
  return lastTouchOf(l);
}
const srcNode = (s) => (s.route ? cx.link(s.label, s.route, s.id) : s.ref ? h('span', s.ref.contact ? cx.link(s.ref.who, 'contact', s.ref.contact) : s.ref.who, h('span.muted', ` · ${s.ref.kind === 'Client' ? s.ref.org : s.ref.what}`)) : h('span', s.label));
const leadDeal = (l) => C.deals.find((d) => d.name === (l.deal || l.convertedTo)) || C.deals.find((d) => d.lead === l.name) || null;
const dealGbp = (d) => toGbp(d.dealValue, d.currency, d.closedDate || d.createdAt);
/** A set of leads' results: qualified, deals, won and what was won. */
function resultsOf(leads) {
  const q = leads.filter((l) => qualOf(l).qualifiedAt || l.converted);
  const deals = leads.map(leadDeal).filter(Boolean);
  const won = deals.filter((d) => d.status === 'Won');
  return { leads: leads.length, qualified: q.length, deals: deals.length, won: won.length, wonValue: sum(won, dealGbp), open: deals.filter(isOpenDeal).length, openValue: sum(deals.filter(isOpenDeal), (d) => toGbp(d.dealValue, d.currency)) };
}

/* ---------- the funnel: when each record reached each stage ---------- */

const LATER_PROP = ['Proposal/Quotation', 'Negotiation', 'Ready to Close', 'Won'];
function proposalAt(d) {
  const it = itemsOf(d).find((i) => (i.kind === 'changed' && i.field === 'Status' && LATER_PROP.includes(i.to)) || (i.kind === 'changes' && i.changes.some((c) => c[0] === 'Status' && LATER_PROP.includes(c[2]))));
  if (it) return it.at;
  if (!LATER_PROP.includes(d.status)) return null;
  return d.status === 'Won' && d.closedDate ? isoPlus(d.createdAt, Math.round((Date.parse(d.closedDate + 'T12:00:00Z') - Date.parse(d.createdAt)) / 120000)) : d.createdAt;
}
const daysOf = (a, b) => (a && b ? (Date.parse(b.length === 10 ? b + 'T12:00:00Z' : b) - Date.parse(a.length === 10 ? a + 'T12:00:00Z' : a)) / 86400000 : null);
const FPERIODS = [['ytd', 'This year'], ['6', 'Last 6 months'], ['12', 'Last 12 months'], ['all', 'Since May 2025']];
function periodMonths(k) {
  const to = monthOf(TODAY);
  if (k === 'ytd') return monthsBetween('2026-01', to);
  if (k === 'all') return monthsBetween('2025-05', to);
  const all = monthsBetween('2025-01', to);
  return all.slice(-(+k));
}
function funnelData(months) {
  const inM = (at) => at && months.includes(monthOf(at));
  const pros = enrolled(PROSPECTS).filter((p) => inM(p.enrolAt));
  const leads = C.leads.filter((l) => l.status !== 'Junk' && inM(qualOf(l).arrival));
  const quals = C.leads.filter((l) => inM(qualOf(l).qualifiedAt));
  const props = C.deals.filter((d) => inM(proposalAt(d)));
  const won = C.deals.filter((d) => d.status === 'Won' && inM(d.closedDate));
  const dealOfL = (l) => leadDeal(l);
  return {
    pros, leads, quals, props, won,
    conv: [
      { n: pros.filter((p) => p.lead).length, of: pros.length, open: pros.filter((p) => ['In sequence', 'Replied'].includes(p.status)).length, t: median(pros.filter((p) => p.lead).map((p) => daysOf(p.enrolAt, qualOf(C.leads.find((l) => l.name === p.lead)).arrival))) },
      { n: leads.filter((l) => qualOf(l).qualifiedAt).length, of: leads.length, open: leads.filter((l) => !qualOf(l).qualifiedAt && !l.converted && stageOf('lead', l.status) !== 'lost').length, t: median(leads.map((l) => qualOf(l).qualifyHours).filter((x) => x != null).map((x) => x / 24)) },
      { n: quals.filter((l) => { const d = dealOfL(l); return d && proposalAt(d); }).length, of: quals.length, open: quals.filter((l) => { const d = dealOfL(l); return !d ? !isLost('lead', l.status) : !proposalAt(d) && isOpenDeal(d); }).length, t: median(quals.map((l) => { const d = dealOfL(l); return d && proposalAt(d) ? daysOf(qualOf(l).qualifiedAt, proposalAt(d)) : null; })) },
      { n: props.filter((d) => d.status === 'Won').length, of: props.length, open: props.filter(isOpenDeal).length, t: median(props.filter((d) => d.status === 'Won').map((d) => daysOf(proposalAt(d), d.closedDate))) },
    ],
  };
}

/* ---------- nurture ---------- */

const TRACKS = [
  { id: 'date', name: 'Check back on a date', cadence: 'Once, on the date they gave', what: 'A personal note from the owner, on the month they named.' },
  { id: 'cases', name: 'Sector case studies', cadence: 'Every six weeks', what: 'A short case study from their own sector, sent by their owner.' },
  { id: 'letter', name: 'Studio letter', cadence: 'Every quarter', what: 'The studio letter: recent work and one idea. The next one goes on 8 Dec.' },
];
const NEXT_LETTER = '2026-12-08';
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const nextMonthStart = (name) => { const m = MONTHS_FULL.indexOf(name) + 1; if (!m) return null; const y = m >= +TODAY.slice(5, 7) ? 2026 : 2027; return `${y}-${String(m).padStart(2, '0')}-0${2 + (hashOf(name) % 5)}`; };
const NURTURE_SIG = [
  (k) => ({ text: `Posted a job for a ${pick(k, ['Head of Digital', 'Digital Product Manager', 'Ecommerce Manager'])}`, source: 'Job boards' }),
  (k) => ({ text: `Announced a new site in ${cityPick(k)}`, source: 'Press release' }),
  (k) => ({ text: 'A new chief executive started this month', source: 'Their website' }),
];
/** Everyone in nurture: leads in Nurture, and prospects who said "not now". */
function nurtureRows() {
  const out = [];
  for (const l of C.leads.filter((x) => x.status === 'Nurture' && !x.converted)) {
    const q = qualOf(l), text = textOf(rawItems(l.name));
    const board = /Budget depends on the board in (\w+)/.exec(text);
    const track = board ? 'date' : hashOf(l.name + 'tr') % 2 ? 'cases' : 'letter';
    const last = lastTouch(l)?.at || q.arrival;
    const next = track === 'date' ? nextMonthStart(board[1]) : track === 'cases' ? (() => { let d = addDays(dayOf(last), 42); while (d < TODAY) d = addDays(d, 42); return d; })() : NEXT_LETTER;
    const sig = hashOf(l.name + 'ns') % 3 === 0 ? { ...pick(l.name + 'sg', NURTURE_SIG)(l.name), at: addDays(TODAY, -(2 + (hashOf(l.name) % 12))) } : null;
    out.push({ kind: 'lead', rec: l, id: l.name, name: leadName(l), org: l.org, owner: l.owner, why: board ? `Budget waits on the board in ${board[1]}` : q.budget.level === 2 ? `Budget ${lc1(q.budget.text)}` : `Not ready yet: ${lc1(q.timing.text)}`, track, last, next, sig, route: ['lead', l.name] });
  }
  for (const p of PROSPECTS.filter((x) => x.status === 'Nurture')) {
    out.push({ kind: 'prospect', rec: p, id: p.id, name: p.name, org: p.org, owner: p.owner, why: `Said not now: budget set until ${fmt.month(p.reply.until)}`, track: 'date', last: p.reply.at, next: p.reply.until, sig: null, route: ['prospect', p.id] });
  }
  return out.sort((a, b) => String(a.next).localeCompare(String(b.next)));
}
const cameBack = () => C.timeline.filter((i) => (i.kind === 'changed' && i.field === 'Status' && i.from === 'Nurture' && !['Unqualified', 'Junk'].includes(i.to)) || (i.kind === 'changes' && i.changes.some((c) => c[0] === 'Status' && c[1] === 'Nurture' && !['Unqualified', 'Junk'].includes(c[2]))));

/* ---------- actions: approving a batch, making a lead from a reply ---------- */

function approveTouches(list, label) {
  const now = NOW();
  for (const { p, t } of list) { t.state = t.at <= now ? 'Sent' : 'Approved'; t.approvedBy = cx.meId(); t.approvedAt = now; }
  const first = list.map((x) => x.t.at).sort()[0];
  cx.toast(`Approved ${fmt.plural(list.length, label)}: ${first <= now ? 'sent now' : `they go out ${dayOf(first) === TODAY ? 'today' : 'tomorrow'} at ${fmt.time(first)}`} (mock-up: nothing is sent)`, { tone: 'success' });
  cx.refresh();
}
function leadFromProspect(p) {
  if (p.lead) { cx.go('lead', p.lead); return; }
  const S = SEQ.get(p.seq);
  const name = nextName(`CRM-LEAD-${TODAY.slice(0, 4)}-`, C.leads.map((l) => l.name));
  const at = NOW();
  const l = { createdAt: at, company: null, org: p.org, contact: null, status: 'New', converted: false, owner: p.owner, source: 'Campaign', deal: null, name, firstName: p.first, lastName: p.last, email: p.email, mobile: null, jobTitle: p.role, website: p.website, territory: 'United Kingdom', industry: p.ind, employees: p.employees, modifiedAt: at };
  C.leads.push(l);
  for (const t of p.touches) if (t.state === 'Sent' && S.steps[t.step].kind === 'email') { const st = S.steps[t.step]; indexTl({ id: `lg_${p.id}_${t.step}`, kind: 'email', direction: 'out', from: memberEmail(p.owner), fromName: cx.name(p.owner), to: [p.email], cc: [], subject: st.subject(p), body: st.body(p), attachments: [], at: t.at, by: p.owner, draftedBy: AGENT, loggedBy: AGENT, recordName: name, recordType: 'Lead', derived: true, outreach: p.seq }); }
  const st = S.steps[p.reply.step];
  addItem(name, 'Lead', { kind: 'email', direction: 'in', from: p.email, fromName: p.name, to: [memberEmail(p.owner)], cc: [], subject: `Re: ${st.subject(p).replace(/^Re: /, '')}`, body: replyText(p), attachments: [], at: p.reply.at, by: null, loggedBy: AGENT });
  addItem(name, 'Lead', { kind: 'creation', text: `${cx.name(cx.meId())} created this lead`, source: 'Campaign', at });
  deriveLeadItems(l);
  p.lead = name; p.status = 'Lead'; PROS_OF_LEAD.set(name, p);
  cx.toast(`Created ${name} for ${p.name} at ${p.org}, owned by ${cx.name(p.owner)}`, { tone: 'success', action: { label: 'Open', onClick: () => cx.go('lead', name) } });
  cx.refresh();
}
function markProspect(p, status, why) {
  p.status = status; if (why) p.whyNot = why;
  for (const t of p.touches) if (['Waiting for approval', 'Scheduled', 'Approved'].includes(t.state)) t.state = 'Stopped';
  cx.toast(`${p.org}: ${status === 'Do not contact' ? 'on the do-not-contact list; nothing more goes to them' : lc1(status)}`, { tone: 'success' });
  cx.refresh();
}

/* ---------- parts ---------- */

const touchIcon = { email: 'mail', linkedin: 'link', event: 'calendar' };
const T_TONE = { Sent: 'green', Approved: 'teal', 'Waiting for approval': 'yellow', Scheduled: 'muted', Stopped: 'gray' };
function touchLine(p, t) {
  const who = cx.name(t.approvedBy || p.owner);
  switch (t.state) {
    case 'Sent': return `Drafted by the sales agent; approved by ${who}${t.approvedAt ? ' on ' + fmt.date(t.approvedAt) : ''}${SEQ.get(p.seq)?.steps[t.step].kind === 'linkedin' ? `, and sent from ${cx.firstName(p.owner)}'s own profile` : ''}`;
    case 'Approved': return `Approved by ${who}; goes out ${fmt.datetime(t.at)}`;
    case 'Waiting for approval': return `Drafted by the sales agent; waiting for ${cx.name(p.owner)} to approve`;
    case 'Scheduled': return `Drafted on the day and sent to ${cx.name(p.owner)} to approve first`;
    default: return 'Not sent: the sequence stopped';
  }
}
function touchRow(p, t) {
  const S = SEQ.get(p.seq), st = S.steps[t.step];
  const body = h('div.crm-mail-body.clamp', st.body(p));
  const more = h('button.crm-more', { type: 'button', onclick: () => { const c = body.classList.toggle('clamp'); more.textContent = c ? 'Show more' : 'Show less'; } }, 'Show more');
  const card = h('div.crm-card', { style: t.state === 'Stopped' ? 'opacity:.6' : null },
    h('div.crm-mail-head', h('b', `Step ${t.step + 1} · ${st.label}`), cx.pill(t.state, T_TONE[t.state]), h('span.grow'), h('span.crm-when', { title: fmt.datetime(t.at) }, `Day ${st.day} · ${fmt.datetime(t.at)}`)),
    st.kind === 'linkedin' ? null : h('div.crm-mail-to', 'To ', p.name ? `${p.name} <${p.email}>` : '—'),
    st.kind === 'linkedin' ? null : h('div.crm-mail-subj', st.subject(p)),
    body, more,
    h('div.crm-logged', agentAvatar(), h('span', touchLine(p, t))));
  return actRow(cx.icon(touchIcon[st.kind]), null, card, { ic: st.kind === 'linkedin' ? 'k-call' : 'k-email' });
}
function replyRow(p) {
  const r = p.reply;
  if (r.cls === 'Wrote in') {
    return actRow(cx.icon('in'), [h('b', p.name), `wrote in by ${lc1(r.via === 'Website form' ? 'the website form' : r.via)}`, when(r.at)],
      h('div.crm-card', h('div.crm-call-h', cx.pill('Became a lead', 'teal'), cx.link(p.lead, 'lead', p.lead)), h('div.crm-logged', agentAvatar(), h('span', 'Matched to this prospect by the sales agent; the outreach stopped'))), { ic: 'k-whatsapp' });
  }
  const card = h('div.crm-card',
    h('div.crm-mail-head', h('b', r.cls === 'Bounced' ? 'Mail delivery' : p.name), h('span.muted', { style: 'font-size:12px' }, r.cls === 'Bounced' ? '' : `<${p.email}>`), h('span.grow'), cx.pill(r.cls, REPLY_TONE[r.cls])),
    h('div.crm-mail-body', replyText(p)),
    h('div.crm-logged', agentAvatar(), h('span', `Logged by the sales agent from ${r.via === 'LinkedIn' ? `${cx.firstName(p.owner)}'s LinkedIn messages` : 'the sales mailbox'}; sorted as ${r.cls}${r.cls === 'Not now' ? `, with a check back in ${fmt.month(r.until)}` : r.cls === 'Out of office' ? `; the next steps moved to after ${fmt.date(r.until)}` : r.cls === 'Unsubscribe' ? '; added to the do-not-contact list' : r.cls === 'Wrong person' ? `; ${r.colleague} is now the contact` : ''}`)));
  return actRow(cx.icon('in'), [h('b', r.cls === 'Bounced' ? 'The first email' : p.contactWas || p.name), r.cls === 'Bounced' ? 'bounced' : `replied ${r.via === 'LinkedIn' ? 'on LinkedIn' : 'by email'}`, when(r.at)], card, { ic: r.cls === 'Interested' ? 'k-whatsapp' : 'k-email' });
}
const lgCrumbs = (label, route) => [{ label: 'CRM', route: 'crm' }, ...(label ? [{ label, route }] : [])];
const statCards = (cards) => h('div.ncards', cards.map((c) => cx.numberCard(c)));
const listCard = (L) => {
  const ps = prosOf(L), en = enrolled(ps);
  const S = SEQ.get(L.seq);
  const st = L.pending ? 'Waiting for approval' : seqStatus(S);
  return h('a.lg-list', { href: cx.href('prospects'), onclick: (e) => { e.preventDefault(); cx.go('prospects', null, { list: { filters: { listName: L.name }, tab: 'All' } }); } },
    h('div.crm-call-h', cx.pill(st, st === 'Live' ? 'blue' : st === 'Finished' ? 'gray' : 'yellow'), h('span.grow'), h('span.crm-when', `Built ${fmt.date(L.builtAt)}`)),
    h('h4', L.name),
    h('div.m', h('span', fmt.plural(ps.filter((p) => p.status !== 'Excluded').length, 'prospect')), h('span', `${fmt.int(en.length)} reached`), h('span', fmt.plural(ps.filter((p) => p.reply && !['Bounced', 'Out of office', 'Wrote in'].includes(p.reply.cls)).length, 'reply', 'replies')), h('span', fmt.plural(ps.filter((p) => p.lead).length, 'lead'))),
    h('div.crm-call-h', cx.personChip(L.owner, { link: false }), h('span.grow'), h('span.crm-tst.muted', { style: 'font-size:12px' }, cx.icon('eye', { size: 12 }), SIGNAL_WORD[L.signal])));
};

/* ---------- the pages ---------- */

function icpPage() {
  const decided = (ind) => C.deals.filter((d) => d.industry === ind && ['Won', 'Lost'].includes(d.status));
  const secRows = ICP.sectors.map((s) => {
    const leads = C.leads.filter((l) => l.industry === s.ind && l.status !== 'Junk');
    const r = resultsOf(leads);
    const dec = decided(s.ind), won = dec.filter((d) => d.status === 'Won');
    return h('tr', td(h('b', s.label)), td(cx.pill(s.tier, TIER_TONE[s.tier])), td(fmt.int(leads.length), { num: true }), td(fmt.int(r.qualified), { num: true, opt: true }), td(fmt.int(won.length), { num: true }), td(fmt.gbp(sum(won, dealGbp), 0), { num: true }), td(dec.length ? fmt.pct(won.length / dec.length, 0) : '—', { num: true, opt: true }));
  });
  const fits = (l) => ['Core', 'Adjacent'].includes(sectorOf(l.industry)?.tier) && !['1-10', '11-50'].includes(l.employees) && !!l.employees;
  const real = C.leads.filter((l) => l.status !== 'Junk');
  const cmp = [['Fit the profile', real.filter(fits)], ['Do not fit', real.filter((l) => !fits(l))]].map(([label, ls]) => { const r = resultsOf(ls); return h('tr', td(h('b', label)), td(fmt.int(r.leads), { num: true }), td(pctOr(r.qualified, r.leads), { num: true }), td(fmt.int(r.won), { num: true }), td(fmt.gbp(r.wonValue, 0), { num: true }), td(r.leads ? fmt.gbp(r.wonValue / r.leads, 0) : '—', { num: true, opt: true })); });
  const sigRows = ICP.signals.map((s) => {
    const ps = enrolled(PROSPECTS).filter((p) => p.signal.key === s.key);
    const rep = ps.filter((p) => p.reply && !['Bounced', 'Out of office'].includes(p.reply.cls));
    return h('tr', td(h('b', s.label)), td(String(s.weight), { num: true }), td(s.source, { opt: true, wrap: true }), td(fmt.int(ps.length), { num: true }), td(pctOr(rep.length, ps.length), { num: true }), td(fmt.int(ps.filter((p) => p.lead).length), { num: true }));
  });
  return cx.page({
    title: 'Ideal customer profile', workspace: 'crm', crumbs: lgCrumbs(),
    status: [cx.pill(`Version ${ICP.version}`, 'info')],
    sub: `Set with the FDE on ${fmt.date(ICP.setAt)} by ${namesList(ICP.setWith)}; last reviewed ${fmt.date(ICP.reviewedAt)}. The sales agent builds prospect lists against it and scores each prospect's fit.`,
    actions: [cx.btn('Review with the FDE', { icon: 'fde', onClick: () => cx.fde.open({ ask: 'Review our ideal customer profile with me: what does our won work say we should change?', context: 'The ideal customer profile in the CRM' }) }), cx.btn('Edit', { kind: 'primary', icon: 'edit', needs: ICP_NEED, onClick: icpEdit })],
    fde: `The ideal customer profile, version ${ICP.version}`,
    body: [
      cx.card({ title: 'Sectors', body: [h('p.muted', { style: 'font-size:12.5px;margin-bottom:8px' }, 'Each sector\'s record since May 2025: leads, qualified, deals won and the win rate of deals decided.'),
        tbl([{ label: 'Sector' }, { label: 'In the profile' }, { label: 'Leads', num: true }, { label: 'Qualified', num: true, opt: true }, { label: 'Won', num: true }, { label: 'Won value', num: true }, { label: 'Win rate', num: true, opt: true }], secRows)] }),
      h('div.grid.c2',
        cx.card({ title: 'Size and place', body: [
          h('div.crm-msec', { style: 'padding-top:0' }, 'Size'), cx.kv(ICP.sizes.map(([k, t]) => [uc1(SIZE_WORD[k] || k), cx.pill(t, TIER_TONE[t] || 'gray')])),
          h('div.crm-msec', 'Place'), cx.kv(ICP.regions.map(([k, t]) => [k, cx.pill(t, TIER_TONE[t] || 'gray')])),
          h('div.crm-msec', 'Budget'), cx.kv([['First project', `${fmt.gbp(ICP.minProject, 0)} or more`]])] }),
        cx.card({ title: 'Leave out', body: h('ul.lg-reasons', ICP.exclude.map((x) => h('li', x))) })),
      cx.card({ title: 'Signals', body: [h('p.muted', { style: 'font-size:12.5px;margin-bottom:8px' }, 'What tells the agent an organisation may need Harbourline now, where it looks, and how prospects with each signal answered.'),
        tbl([{ label: 'Signal' }, { label: 'Weight', num: true }, { label: 'Where the agent looks', opt: true }, { label: 'Prospects', num: true }, { label: 'Replied', num: true }, { label: 'Leads', num: true }], sigRows)] }),
      cx.card({ title: 'Does the profile predict?', body: [h('p.muted', { style: 'font-size:12.5px;margin-bottom:8px' }, 'Every lead since May 2025, split by whether it is in a sector of the profile with 51 staff or more.'),
        tbl([{ label: '' }, { label: 'Leads', num: true }, { label: 'Qualified', num: true }, { label: 'Won', num: true }, { label: 'Won value', num: true }, { label: 'Per lead', num: true, opt: true }], cmp)] }),
      cx.card({ title: 'Changes', body: cx.timeline(ICP.history.map((x) => ({ at: x.at, who: x.by[0], kind: 'change', text: `made version ${x.v}${x.by.length > 1 ? ` with ${namesList(x.by.slice(1))}` : ''}: ${lc1(x.text)}` }))) }),
    ],
  });
}
function icpEdit() {
  const m = {};
  ICP.sectors.forEach((s, i) => { m['s' + i] = s.tier; });
  ICP.signals.forEach((s, i) => { m['g' + i] = s.weight; });
  m.minProject = ICP.minProject;
  formModal({ title: 'Edit the ideal customer profile', model: m, needs: ICP_NEED, submit: 'Save', wide: true,
    intro: 'The agent scores every prospect against this, and builds new lists from it. Saving makes a new version.',
    fields: [{ section: 'Sectors' }, ...ICP.sectors.map((s, i) => ({ label: s.label, key: 's' + i, type: 'select', options: TIERS })),
      { section: 'Signal weights' }, ...ICP.signals.map((s, i) => ({ label: s.label, key: 'g' + i, type: 'int' })),
      { section: 'Budget' }, { label: 'First project of at least (£)', key: 'minProject', type: 'int' }],
    onSubmit: (x, close) => {
      const ch = [];
      ICP.sectors.forEach((s, i) => { if (x['s' + i] !== s.tier) { ch.push(`${s.label} ${lc1(s.tier)} to ${lc1(x['s' + i])}`); s.tier = x['s' + i]; } });
      ICP.signals.forEach((s, i) => { const w = +x['g' + i] || 0; if (w !== s.weight) { ch.push(`${lc1(s.label)} weighs ${w}`); s.weight = w; } });
      if (+x.minProject && +x.minProject !== ICP.minProject) { ch.push(`first project ${fmt.gbp(+x.minProject, 0)} or more`); ICP.minProject = +x.minProject; }
      close();
      if (!ch.length) { cx.toast('Nothing changed', { tone: 'info' }); return; }
      ICP.version++; ICP.reviewedAt = NOW();
      ICP.history.push({ v: ICP.version, at: NOW(), by: [cx.meId()], text: uc1(ch.join('; ')) + '.' });
      cx.toast(`Saved version ${ICP.version}. Fit scores follow it.`, { tone: 'success' });
      cx.refresh();
    } });
}

function prospectsPage(ctx) {
  const lists = h('div.lg-lists', LISTS.slice().reverse().map(listCard));
  const list = cx.listView({
    key: 'lg-prospects', rows: () => PROSPECTS, id: (r) => r.id,
    titleCol: { key: 'org', label: 'Organisation', render: (r) => lgTitle(r.org, 'prospect', r.id, true), sub: (r) => r.signal.text },
    status: (r) => pStatus(r),
    columns: [
      { key: 'fit', label: 'Fit', get: (r) => fitOf(r).score, render: fitPill, keep: true },
      { key: 'place', label: 'Place', get: (r) => r.city },
      { key: 'next', label: 'Next touch', get: (r) => nextTouch(r)?.at || '', render: (r) => { const t = nextTouch(r); return t ? h('span.crm-tst', { title: fmt.datetime(t.at) }, cx.icon(touchIcon[SEQ.get(r.seq)?.steps[t.step].kind] || 'mail', { size: 13 }), `Step ${t.step + 1} · ${fmt.day(t.at)}`) : h('span.faint', '—'); } },
      { key: 'owner', label: 'Owner', type: 'person' },
    ],
    filters: [{ key: 'org', label: 'Organisation' }, { key: 'listName', label: 'List', type: 'select', options: LISTS.map((L) => L.name) }, { key: 'status', label: 'Status', type: 'select', options: Object.keys(P_TONE) }, { key: 'owner', label: 'Owner', type: 'person', options: () => uniq(LISTS.map((L) => L.owner)) }],
    tabs: [
      { label: 'All', filter: (r) => r.status !== 'Excluded' },
      { label: 'In sequence', filter: (r) => r.status === 'In sequence' },
      { label: 'Replied', filter: (r) => !!r.reply && !['Bounced', 'Out of office'].includes(r.reply.cls) },
      { label: 'Became leads', filter: (r) => !!r.lead },
      { label: 'Waiting for approval', filter: (r) => r.status === 'Waiting for approval' },
      { label: 'Left out', filter: (r) => ['Excluded', 'Not a fit', 'Do not contact', 'Bounced'].includes(r.status) },
    ],
    sort: { options: [{ key: 'listed', label: 'Listed', get: (r) => r.listedAt }, { key: 'fit', label: 'Fit', get: (r) => fitOf(r).score }, { key: 'org', label: 'Organisation' }], default: { key: 'listed', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'listName', label: 'List' }, { key: 'region', label: 'Region' }],
    href: (r) => ['prospect', r.id],
    bulk: [{ label: 'Not a fit', icon: 'x', needs: LG_NEED, onClick: (rows) => { rows.forEach((p) => { p.status = 'Not a fit'; p.whyNot = 'Taken off by hand'; p.touches.forEach((t) => { if (['Waiting for approval', 'Scheduled', 'Approved'].includes(t.state)) t.state = 'Stopped'; }); }); cx.toast(`${fmt.plural(rows.length, 'prospect')} taken off their lists`, { tone: 'success' }); cx.refresh(); } }],
    noun: 'prospect', showId: false, empty: 'No prospects match.',
  });
  return cx.page({ title: 'Prospects', workspace: 'crm', crumbs: lgCrumbs(),
    sub: 'Organisations the sales agent found in public sources that fit the ideal customer profile. A person approves each list before any outreach starts.',
    actions: [cx.btn('Ideal customer', { icon: 'user', href: ['crm-icp'] }), cx.btn('Outreach', { icon: 'send', kind: 'primary', href: ['sequences'] })],
    fde: 'The prospect lists in the CRM', body: [lists, list] });
}

function prospectPage(p) {
  const L = LIST.get(p.list), S = SEQ.get(p.seq);
  const f = fitOf(p);
  const tone = scoreTone(f.score);
  const actions = [
    p.lead ? cx.btn('Open the lead', { kind: 'primary', icon: 'right', href: ['lead', p.lead] })
      : p.reply?.cls === 'Interested' ? cx.btn('Make a lead', { kind: 'primary', icon: 'plus', needs: LG_NEED, onClick: () => leadFromProspect(p) }) : null,
    p.touches.length || p.status === 'Waiting for approval' ? cx.menu(null, [
      { label: 'Not a fit', icon: 'x', needs: LG_NEED, onClick: () => markProspect(p, 'Not a fit', 'Taken off by hand') },
      { label: 'Do not contact', icon: 'lock', needs: LG_NEED, danger: true, onClick: async () => { if (await cx.confirm({ title: `Never contact ${p.org} again?`, body: 'They leave every list and sequence, and the agent will not list them again.', confirmLabel: 'Do not contact', danger: true })) markProspect(p, 'Do not contact'); } },
    ]) : null,
  ];
  const fitCard = cx.card({ title: 'Why it fits', body: [
    h('div.crm-score', h('b', String(f.score)), h('div', { style: 'display:grid;gap:4px;min-width:0' }, h('div.bar', h('i', { style: `width:${f.score}%;background:var(--t-${tone})` })), h('span.muted', { style: 'font-size:12px' }, `Fit out of 100, against version ${ICP.version} of the profile`))),
    h('ul.lg-reasons', f.reasons.map((r) => h('li', r))),
    p.excluded ? h('div.crm-reason', h('b', 'Left out: '), p.excluded, '. ', p.deal ? cx.link('Open the deal', 'deal', p.deal) : null) : null,
    p.status === 'Not a fit' ? h('div.crm-reason', h('b', 'Not a fit: '), p.whyNot) : null,
    h('div.crm-logged', agentAvatar(), h('span', `Found and enriched by the sales agent on ${fmt.date(p.listedAt)}: size and place from Companies House, the contact from their website`)),
  ] });
  const acts = [];
  if (p.touches.length) for (const t of p.touches) { acts.push({ at: t.at, n: touchRow(p, t) }); }
  if (p.reply) acts.push({ at: p.reply.at, n: replyRow(p) });
  if (p.checkedBack) acts.push({ at: p.checkedBack, n: actRow(cx.icon('mail'), [h('b', cx.name(p.owner)), 'checked back, as they asked', when(p.checkedBack)], h('div.crm-card', h('div.crm-mail-body', `Hi ${p.first},\n\nYou asked me to get back in touch about now. Is this a better time to talk?\n\n${cx.firstName(p.owner)}`), h('div.crm-logged', agentAvatar(), h('span', `Drafted by the sales agent on the date they gave; approved by ${cx.name(p.owner)}. No answer in three weeks, so the prospect is closed.`))), { ic: 'k-email' }) });
  acts.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const outCard = cx.card({ title: S ? 'Outreach' : 'Outreach', actions: S ? cx.btn('Open the sequence', { sm: true, kind: 'ghost', href: ['sequence', S.id] }) : null,
    body: acts.length ? h('div.crm-acts', acts.map((a) => a.n)) : cx.empty(p.status === 'Waiting for approval' ? `Nothing is sent until ${cx.name(L.owner)} approves the list.` : p.excluded ? 'No outreach: Harbourline already knows them.' : 'No outreach: taken off the list before anything went.') });
  const side = h('aside.crm-side',
    idBtn(p.id),
    h('div.crm-head', h('div.crm-head-top', extAvatar(p.org, { size: 'xl', square: true }), h('div', { style: 'min-width:0' }, h('h2', p.org), h('div.muted', [sectorOf(p.ind)?.label || p.ind, p.city].filter(Boolean).join(' · '))))),
    sideSec('Organisation', [cx.kv([['Website', p.website], ['Size', SIZE_WORD[p.employees] || p.employees], ['Place', `${p.city}, ${p.region}`], ['Signal', p.signal.text], ['Found in', `${p.signal.source}, ${fmt.date(p.signal.at)}`]])], { key: 'pr-org' }),
    p.name ? sideSec('Contact', [cx.kv([['Name', p.name], ['Role', p.role], ['Email', p.email], p.contactWas ? ['Before', `${p.contactWas}, who passed it on`] : null])], { key: 'pr-contact' }) : null,
    sideSec('List', [cx.kv([['List', L.name], ['Owner', cx.personChip(p.owner, { link: false })], ['Sequence', S ? cx.link(S.name, 'sequence', S.id) : 'Not started'], ['Status', pStatus(p)], p.lead ? ['Lead', cx.link(p.lead, 'lead', p.lead)] : null])], { key: 'pr-list' }));
  return cx.page({ title: p.org, workspace: 'crm', crumbs: lgCrumbs('Prospects', 'prospects'), status: [pStatus(p)],
    sub: `${p.id} · ${L.name} · fit ${f.score}`, actions,
    fde: `Prospect ${p.id}: ${p.org}, ${p.status}, on the list "${L.name}"`,
    body: h('div.crm-rec', h('div', { style: 'display:grid;gap:14px;min-width:0' }, fitCard, outCard), side) });
}

function seqTotals(S) {
  const ps = prosOf(S.list), en = enrolled(ps);
  const touches = en.flatMap((p) => p.touches.map((t) => ({ p, t })));
  const replies = en.filter((p) => p.reply && !['Bounced', 'Out of office', 'Wrote in'].includes(p.reply.cls));
  const leads = ps.filter((p) => p.lead).map((p) => C.leads.find((l) => l.name === p.lead)).filter(Boolean);
  return { ps, en, touches, sent: touches.filter((x) => x.t.state === 'Sent'), waiting: touches.filter((x) => x.t.state === 'Waiting for approval'), replies, interested: en.filter((p) => p.reply && ['Interested', 'Wrote in'].includes(p.reply.cls)), leads, res: resultsOf(leads) };
}
function sequencesPage() {
  const rows = SEQS.slice().reverse().map((S) => {
    const x = seqTotals(S), st = seqStatus(S);
    return h('tr', td(h('a', { href: cx.href('sequence', S.id) }, S.name)), td(cx.pill(st, st === 'Live' ? 'blue' : 'gray')), td(cx.personChip(S.owner, { link: false }), { opt: true }), td(fmt.int(x.en.length), { num: true }), td(fmt.int(x.sent.length), { num: true, opt: true }), td(pctOr(x.replies.length, x.en.length), { num: true }), td(fmt.int(x.leads.length), { num: true }), td(x.res.wonValue ? fmt.gbp(x.res.wonValue, 0) : x.res.open ? h('span.muted', `${fmt.gbp(x.res.openValue, 0)} open`) : '—', { num: true }), td(x.waiting.length ? cx.pill(`${x.waiting.length} to approve`, 'yellow') : '', { opt: true }));
  });
  const all = SEQS.map(seqTotals);
  const en = sum(all, (x) => x.en.length), rep = sum(all, (x) => x.replies.length);
  return cx.page({ title: 'Outreach', workspace: 'crm', crumbs: lgCrumbs(),
    sub: 'Sequences of emails, LinkedIn notes and invitations to prospects. The sales agent drafts each message; its owner approves every batch before it is sent, and any reply stops the sequence.',
    actions: [cx.btn('Prospects', { icon: 'list', href: ['prospects'] }), cx.btn('Waiting for you', { kind: 'primary', icon: 'check', onClick: () => cx.agentWork?.open?.('for') })],
    fde: 'The outreach sequences in the CRM',
    body: [
      statCards([
        { label: 'Prospects reached', value: fmt.int(en), sub: `${SEQS.length} sequences since January` },
        { label: 'Reply rate', value: pctOr(rep, en), sub: `${fmt.int(rep)} replies, any kind` },
        { label: 'Leads', value: fmt.int(sum(all, (x) => x.leads.length)), sub: `${fmt.int(sum(all, (x) => x.res.qualified))} qualified` },
        { label: 'Won', value: fmt.gbp(sum(all, (x) => x.res.wonValue), 0), sub: `plus ${fmt.gbp(sum(all, (x) => x.res.openValue), 0)} in open deals` },
        { label: 'Waiting for approval', value: fmt.int(sum(all, (x) => x.waiting.length)), sub: 'messages drafted for their owners' },
      ]),
      cx.card({ title: 'Sequences', flush: true, body: tbl([{ label: 'Sequence' }, { label: 'Status' }, { label: 'Owner', opt: true }, { label: 'Reached', num: true }, { label: 'Sent', num: true, opt: true }, { label: 'Replied', num: true }, { label: 'Leads', num: true }, { label: 'Won', num: true }, { label: '', opt: true }], rows) }),
    ] });
}
function sequencePage(S) {
  const x = seqTotals(S), L = S.list, st = seqStatus(S);
  const preview = x.en.find((p) => p.name && !p.lead) || x.en[0];
  const stepRows = S.steps.map((s) => {
    const at = x.touches.filter((y) => y.t.step === s.step);
    const n = (state) => at.filter((y) => y.t.state === state).length;
    const rep = x.en.filter((p) => p.reply && p.reply.step === s.step && !['Bounced', 'Out of office'].includes(p.reply.cls)).length;
    const body = h('div.crm-mail-body', { hidden: true, style: 'margin-top:6px' }, preview ? `${s.kind === 'linkedin' ? '' : 'Subject: ' + s.subject(preview) + '\n\n'}${s.body(preview)}` : '');
    const tog = h('button.crm-more', { type: 'button', onclick: () => { body.hidden = !body.hidden; tog.textContent = body.hidden ? `Show it, as drafted for ${preview?.org}` : 'Hide'; } }, `Show it, as drafted for ${preview?.org}`);
    return h('div.lg-step', h('div.lg-day', `Day ${s.day}`), h('div', { style: 'min-width:0;display:grid;gap:4px' },
      h('div.crm-call-h', cx.icon(touchIcon[s.kind], { size: 14 }), h('b', s.label), s.kind === 'linkedin' ? h('span.muted', { style: 'font-size:12px' }, `from ${cx.firstName(S.owner)}'s profile`) : s.kind === 'event' ? cx.link(CAMP.get(s.event).name, 'campaign', s.event) : null),
      h('div.m.muted', { style: 'font-size:12px;display:flex;flex-wrap:wrap;gap:2px 12px' }, h('span', `${n('Sent')} sent`), n('Waiting for approval') ? h('span', `${n('Waiting for approval')} waiting for approval`) : null, n('Approved') ? h('span', `${n('Approved')} approved`) : null, n('Scheduled') ? h('span', `${n('Scheduled')} scheduled`) : null, h('span', `${n('Stopped')} stopped`), h('span', `${rep} ${rep === 1 ? 'reply' : 'replies'}`)),
      preview ? tog : null, body));
  });
  const replies = x.en.filter((p) => p.reply && p.reply.cls !== 'Bounced').sort((a, b) => String(b.reply.at).localeCompare(String(a.reply.at)));
  const repList = replies.length ? h('div.crm-list', replies.map((p) => h('a.crm-row', { href: cx.href('prospect', p.id) },
    extAvatar(p.org, { size: 'sm', square: true }),
    h('div', { style: 'display:grid;gap:2px;min-width:0' }, h('span.t', `${p.contactWas || p.name} · ${p.org}`), h('span.m', h('span', excerpt(replyText(p))))),
    h('div.r', cx.pill(p.reply.cls === 'Wrote in' ? 'Became a lead' : p.reply.cls, REPLY_TONE[p.reply.cls]), h('span', { title: fmt.datetime(p.reply.at) }, fmt.ago(p.reply.at)))))) : cx.empty('No replies yet');
  const list = cx.listView({ key: 'lg-seq-' + S.id, strip: false, rows: () => x.en, id: (r) => r.id, pageSize: 20,
    titleCol: { key: 'org', label: 'Prospect', render: (r) => lgTitle(r.org, 'prospect', r.id, true), sub: (r) => r.name },
    status: pStatus,
    columns: [{ key: 'fit', label: 'Fit', get: (r) => fitOf(r).score, render: fitPill, keep: true }, { key: 'done', label: 'Steps sent', get: (r) => r.touches.filter((t) => t.state === 'Sent').length, render: (r) => `${r.touches.filter((t) => t.state === 'Sent').length} of 5` }, { key: 'next', label: 'Next touch', get: (r) => nextTouch(r)?.at || '', render: (r) => { const t = nextTouch(r); return t ? `Step ${t.step + 1} · ${fmt.day(t.at)}` : h('span.faint', '—'); } }],
    filters: [{ key: 'org', label: 'Prospect' }, { key: 'status', label: 'Status', type: 'select' }],
    href: (r) => ['prospect', r.id], noun: 'prospect', showId: false, empty: 'Nobody in this sequence yet.' });
  return cx.page({ title: S.name, workspace: 'crm', crumbs: lgCrumbs('Outreach', 'sequences'), status: [cx.pill(st, st === 'Live' ? 'blue' : 'gray', { lg: true })],
    sub: `${S.id} · ${fmt.plural(x.en.length, 'prospect')} from "${L.name}" · owner ${cx.name(S.owner)}`,
    actions: [x.waiting.length ? cx.btn(`Approve ${x.waiting.length} waiting`, { kind: 'primary', icon: 'check', onClick: () => cx.agentWork?.open?.('for') }) : null, cx.btn('The prospects', { icon: 'list', onClick: () => cx.go('prospects', null, { list: { filters: { listName: L.name }, tab: 'All' } }) })],
    fde: `The outreach sequence ${S.name}`,
    body: [
      statCards([
        { label: 'Reached', value: fmt.int(x.en.length), sub: `${fmt.plural(x.sent.length, 'message')} sent` },
        { label: 'Replied', value: pctOr(x.replies.length, x.en.length), sub: `${fmt.int(x.replies.length)} replies, ${fmt.int(x.interested.length)} interested` },
        { label: 'Leads', value: fmt.int(x.leads.length), sub: `${fmt.int(x.res.qualified)} qualified, ${fmt.int(x.res.deals)} deals` },
        { label: 'Won', value: fmt.gbp(x.res.wonValue, 0), sub: x.res.open ? `${fmt.gbp(x.res.openValue, 0)} in open deals` : fmt.plural(x.res.won, 'deal') },
      ]),
      h('div.grid.side',
        cx.card({ title: 'Steps', body: h('div.lg-steps', stepRows) }),
        cx.card({ title: 'How it sends', body: cx.kv([
          ['Approval', `${cx.name(S.owner)} approves each batch before it goes`],
          ['Sends from', `${cx.firstName(S.owner)}'s mailbox; LinkedIn notes from ${cx.firstName(S.owner)}'s own profile`],
          ['Stops when', 'They reply, the email bounces, or they ask to stop'],
          ['Out of office', 'Waits until they are back'],
          ['Pace', `Up to ${L.batch} new prospects a week`],
          ['Started', fmt.date(addDays(L.builtAt, 1))],
        ]) })),
      cx.card({ title: 'Replies', body: repList }),
      cx.card({ title: 'Prospects in this sequence', body: list }),
    ] });
}

function inboundPage() {
  const web = C.leads.filter((l) => ['Website form', 'WhatsApp'].includes(qualOf(l).channel)).sort((a, b) => String(qualOf(b).arrival).localeCompare(String(qualOf(a).arrival)));
  const since = addDays(TODAY, -89);
  const web90 = web.filter((l) => dayOf(qualOf(l).arrival) >= since);
  const PAGES = ['Contact page', 'A case study', 'Services pages', 'The home page'];
  const pageOf = (l) => pick(l.name + 'pg', PAGES);
  const webTab = () => h('div', { style: 'display:grid;gap:14px;min-width:0' },
    statCards([
      { label: 'Enquiries, last 90 days', value: fmt.int(web90.length), sub: `${fmt.int(web90.filter((l) => l.status === 'Junk').length)} filtered as spam` },
      { label: 'Qualified', value: pctOr(resultsOf(web.filter((l) => l.status !== 'Junk')).qualified, web.filter((l) => l.status !== 'Junk').length), sub: 'of real enquiries since May 2025' },
      { label: 'First reply', value: durHuman(median(web90.map((l) => qualOf(l).firstReplyHours))), sub: 'median, after it arrived' },
      { label: 'Won from the form', value: fmt.gbp(resultsOf(web).wonValue, 0), sub: 'since May 2025' },
    ]),
    h('div.grid.c2',
      cx.card({ title: 'The form', body: cx.kv([
        ['Where', 'harbourline.studio/contact, and the end of every case study'],
        ['Asks for', 'Name, email, organisation, what they need, a budget range, when they need it, how they heard of Harbourline'],
        ['Becomes', 'A lead in the CRM within minutes, scored and routed to an owner'],
        ['Spam', 'Sales pitches and link offers are marked Junk, not deleted'],
        ['WhatsApp', 'The number on the contact page; messages become leads the same way'],
      ]) }),
      cx.card({ title: 'Where they filled it in', body: cx.chart.hbar({ items: PAGES.map((pg, i) => ({ label: pg, value: web90.filter((l) => pageOf(l) === pg).length, color: String(i + 1) })), format: (v) => fmt.int(v) }) })),
    cx.card({ title: 'Latest enquiries', body: h('div.crm-list', web.slice(0, 10).map((l) => { const q = qualOf(l); return h('a.crm-row', { href: cx.href('lead', l.name) }, extAvatar(leadName(l), { size: 'sm' }),
      h('div', { style: 'display:grid;gap:2px;min-width:0' }, h('span.t', `${leadName(l)}${l.org ? ' · ' + l.org : ''}`), h('span.m', channelTag(q.channel), h('span', pageOf(l)), h('span', q.need.level ? q.need.text : 'Need not clear yet'))),
      h('div.r', l.status === 'Junk' ? cx.pill('Spam', 'gray') : scorePill(q.score), h('span', { title: fmt.datetime(q.arrival) }, fmt.ago(q.arrival)))); })) }));
  const events = CAMPAIGNS.filter((c) => c.type === 'Event').slice().reverse();
  const evTab = () => {
    const rows = events.map((c) => {
      const ls = [...CAMP_OF.entries()].filter(([, v]) => v === c).map(([k]) => C.leads.find((l) => l.name === k));
      const r = resultsOf(ls.filter((l) => l.status !== 'Junk'));
      return h('tr', td(h('a', { href: cx.href('campaign', c.id) }, c.name)), td(fmt.date(c.start)), td(c.format, { opt: true }), td(c.upcoming ? h('span.muted', `${invitesOf(c).length} invited`) : fmt.int(c.reached), { num: true }), td(c.upcoming ? '—' : fmt.int(ls.length), { num: true }), td(c.upcoming ? '—' : fmt.int(r.qualified), { num: true, opt: true }), td(r.wonValue ? fmt.gbp(r.wonValue, 0) : '—', { num: true }), td(fmt.gbp(c.cost, 0), { num: true, opt: true }));
    });
    return h('div', { style: 'display:grid;gap:14px;min-width:0' },
      h('p.muted', { style: 'font-size:12.5px' }, 'Stands at fairs and Harbourline\'s own breakfasts and open studios. Badge scans and sign-in sheets come in the next morning; each person becomes a lead, scored like any other.'),
      cx.card({ title: 'Events', flush: true, body: tbl([{ label: 'Event' }, { label: 'Date' }, { label: 'Format', opt: true }, { label: 'People met', num: true }, { label: 'Leads', num: true }, { label: 'Qualified', num: true, opt: true }, { label: 'Won', num: true }, { label: 'Cost', num: true, opt: true }], rows) }));
  };
  const refs = C.leads.filter((l) => REFERRAL.has(l.name)).sort((a, b) => String(qualOf(b).arrival).localeCompare(String(qualOf(a).arrival)));
  const refTab = () => {
    const by = new Map();
    for (const l of refs) { const r = REFERRAL.get(l.name); const k = r.who; const e = by.get(k) || { r, n: 0, won: 0 }; e.n++; const d = leadDeal(l); if (d?.status === 'Won') e.won += dealGbp(d); by.set(k, e); }
    const top = [...by.values()].sort((a, b) => b.won - a.won || b.n - a.n).slice(0, 8);
    return h('div', { style: 'display:grid;gap:14px;min-width:0' },
      statCards([
        { label: 'Referrals', value: fmt.int(refs.length), sub: 'since May 2025' },
        { label: 'From clients', value: fmt.int(refs.filter((l) => REFERRAL.get(l.name).kind === 'Client').length), sub: `${fmt.int(refs.filter((l) => REFERRAL.get(l.name).kind === 'Partner').length)} from partners` },
        { label: 'Qualified', value: pctOr(resultsOf(refs).qualified, refs.length), sub: 'the best rate of any source' },
        { label: 'Won', value: fmt.gbp(resultsOf(refs).wonValue, 0), sub: fmt.plural(resultsOf(refs).won, 'deal') },
      ]),
      h('div.grid.c2',
        cx.card({ title: 'Who refers', body: cx.chart.hbar({ items: top.map((e) => ({ label: e.r.kind === 'Client' ? `${e.r.who}, ${e.r.org}` : e.r.who, value: e.n, color: e.r.kind === 'Client' ? '1' : '3', href: e.r.contact ? ['contact', e.r.contact] : null })), format: (v) => fmt.int(v) }) }),
        cx.card({ title: 'Latest referrals', body: h('div.crm-list', refs.slice(0, 8).map((l) => { const r = REFERRAL.get(l.name); const d = leadDeal(l); return h('a.crm-row', { href: cx.href('lead', l.name) }, extAvatar(l.org || leadName(l), { size: 'sm', square: true }),
          h('div', { style: 'display:grid;gap:2px;min-width:0' }, h('span.t', l.org || leadName(l)), h('span.m', h('span', `From ${r.who}${r.kind === 'Client' ? ', ' + r.org : ''}`))),
          h('div.r', d ? stDot('deal', d.status) : stDot('lead', l.status), h('span', fmt.ago(qualOf(l).arrival)))); })) })));
  };
  return cx.page({ title: 'Inbound', workspace: 'crm', crumbs: lgCrumbs(),
    sub: 'Leads who came to Harbourline: through the website form, at events, and by introduction.',
    actions: [cx.btn('Lead sources', { icon: 'report', href: ['crm-sources'] })],
    fde: 'Inbound lead capture in the CRM',
    body: cx.tabs([{ label: 'Website form', count: web90.length, render: webTab }, { label: 'Events', count: events.length, render: evTab }, { label: 'Referrals', count: refs.length, render: refTab }], { key: 'lg-inbound' }) });
}
/** Invitations to an upcoming event: the invitation step of the sequences that point at it. */
function invitesOf(c) {
  const out = [];
  for (const S of SEQS) { const st = S.steps.find((s) => s.event === c.id); if (!st) continue; for (const p of enrolled(prosOf(S.list))) { const t = p.touches[st.step]; if (t && ['Sent', 'Approved', 'Waiting for approval'].includes(t.state)) out.push({ p, t, rsvp: t.state !== 'Sent' ? 'Not sent yet' : hashOf(p.id + 'rsvp') % 100 < 22 ? 'Coming' : hashOf(p.id + 'rsvp') % 100 < 35 ? 'Cannot make it' : 'No answer yet' }); } }
  return out;
}

function nurturePage() {
  const rows = nurtureRows();
  const back = PROSPECTS.filter((p) => p.checkedBack && dayOf(p.checkedBack) >= addDays(TODAY, -364)).length + cameBack().filter((i) => dayOf(i.at) >= addDays(TODAY, -364)).length;
  const thisMonth = rows.filter((r) => monthOf(r.next) <= monthOf(TODAY));
  const trackName = (id) => TRACKS.find((t) => t.id === id)?.name;
  const list = cx.listView({ key: 'lg-nurture', strip: false, rows: () => rows, id: (r) => r.id,
    titleCol: { key: 'name', label: 'Who', render: (r) => lgTitle(r.name || r.org, r.route[0], r.route[1]), sub: (r) => r.org },
    status: (r) => (r.sig ? cx.pill('A new signal', 'green') : cx.pill(r.kind === 'lead' ? 'Lead' : 'Prospect', r.kind === 'lead' ? 'blue' : 'muted')),
    columns: [
      { key: 'why', label: 'Why not now', render: (r) => h('span.crm-next', r.why) },
      { key: 'track', label: 'Track', get: (r) => trackName(r.track) },
      { key: 'next', label: 'Next touch', type: 'date', keep: true },
      { key: 'sig', label: 'Since then', get: (r) => r.sig?.text || '', render: (r) => (r.sig ? h('span.crm-next', `${r.sig.text} (${r.sig.source}, ${fmt.day(r.sig.at)})`) : h('span.faint', '—')) },
      { key: 'owner', label: 'Owner', type: 'person' },
    ],
    filters: [{ key: 'name', label: 'Who' }, { key: 'track', label: 'Track', type: 'select', options: TRACKS.map((t) => t.name), get: (r) => trackName(r.track) }, { key: 'owner', label: 'Owner', type: 'person', options: () => uniq(rows.map((r) => r.owner)) }],
    tabs: [{ label: 'All' }, { label: 'A new signal', filter: (r) => !!r.sig }, { label: 'Due this month', filter: (r) => monthOf(r.next) <= monthOf(TODAY) }],
    sort: { options: [{ key: 'next', label: 'Next touch' }, { key: 'name', label: 'Who' }], default: { key: 'next', dir: 'asc' } },
    href: (r) => r.route, noun: 'record', showId: false, empty: 'Nobody in nurture.' });
  return cx.page({ title: 'Nurture', workspace: 'crm', crumbs: lgCrumbs(),
    sub: 'Leads and prospects who are not ready yet. Each stays in touch on a track until they are, and the sales agent watches for signs that the time has come.',
    fde: 'Nurture in the CRM',
    body: [
      statCards([
        { label: 'In nurture', value: fmt.int(rows.length), sub: `${fmt.int(rows.filter((r) => r.kind === 'lead').length)} leads, ${fmt.int(rows.filter((r) => r.kind === 'prospect').length)} prospects` },
        { label: 'A new signal', value: fmt.int(rows.filter((r) => r.sig).length), sub: 'may be ready to talk' },
        { label: 'Due this month', value: fmt.int(thisMonth.length), sub: 'touches to send' },
        { label: 'Checked back', value: fmt.int(back), sub: 'on the date they gave, last 12 months' },
      ]),
      h('div.grid.c3', TRACKS.map((t) => cx.card({ title: t.name, body: [h('div.crm-next', t.what), cx.kv([['Cadence', t.cadence], ['In it now', fmt.int(rows.filter((r) => r.track === t.id).length)]])] }))),
      cx.card({ title: 'Everyone in nurture', body: list }),
    ] });
}

/** Every campaign and sequence as one row with its results. */
function campaignRows() {
  const leadsOfCamp = (c) => C.leads.filter((l) => CAMP_OF.get(l.name) === c || NEWS_FIRST.get(l.name) === c);
  const rows = CAMPAIGNS.map((c) => { const ls = leadsOfCamp(c).filter((l) => l.status !== 'Junk'); const r = resultsOf(ls); return { id: c.id, c, name: c.name, type: c.type, start: c.start, end: c.end || c.start, owner: c.owner, reached: c.upcoming ? invitesOf(c).length : c.reached, leads: ls.length, junk: leadsOfCamp(c).length - ls.length, ...r, cost: c.cost || 0, route: ['campaign', c.id], status: c.upcoming ? 'Upcoming' : (c.end || c.start) >= TODAY ? 'Running' : 'Finished' }; });
  for (const S of SEQS) { const x = seqTotals(S); const last = x.touches.map((y) => y.t.at).sort().at(-1); rows.push({ id: S.id, name: S.name, type: 'Outreach', start: addDays(S.list.builtAt, 1), end: dayOf(last || S.list.builtAt), owner: S.owner, reached: x.en.length, leads: x.leads.length, junk: 0, ...x.res, cost: 0, route: ['sequence', S.id], status: seqStatus(S) === 'Live' ? 'Running' : 'Finished' }); }
  return rows;
}
const C_TONE = { Running: 'blue', Upcoming: 'yellow', Finished: 'gray' };
function campaignsPage() {
  const rows = campaignRows();
  const types = ['Outreach', 'Event', 'Newsletter', 'Paid social'];
  const list = cx.listView({ key: 'lg-campaigns', rows: () => rows, id: (r) => r.id,
    titleCol: { key: 'name', label: 'Campaign', render: (r) => h('a', { href: cx.href(r.route[0], r.route[1]) }, r.name), sub: (r) => `${r.type} · ${fmt.date(r.start)}${r.end !== r.start ? ' to ' + fmt.date(r.end) : ''}` },
    status: (r) => cx.pill(r.status, C_TONE[r.status]),
    columns: [
      { key: 'reached', label: 'Reached', type: 'int' },
      { key: 'leads', label: 'Leads', type: 'int', keep: true },
      { key: 'qualified', label: 'Qualified', type: 'int' },
      { key: 'won', label: 'Won', type: 'int' },
      { key: 'cost', label: 'Cost', type: 'currency', render: (r) => (r.cost ? fmt.gbp(r.cost, 0) : h('span.faint', 'Staff time')) },
      { key: 'owner', label: 'Owner', type: 'person' },
    ],
    right: { key: 'wonValue', label: 'Won value', type: 'currency' },
    filters: [{ key: 'name', label: 'Campaign' }, { key: 'type', label: 'Type', type: 'select', options: types }, { key: 'owner', label: 'Owner', type: 'person', options: () => uniq(rows.map((r) => r.owner)) }],
    tabs: [{ label: 'All' }, ...types.map((t) => ({ label: t === 'Outreach' ? 'Outreach' : t === 'Event' ? 'Events' : t === 'Newsletter' ? 'Letters' : t, filter: (r) => r.type === t })), { label: 'Running', filter: (r) => r.status !== 'Finished' }],
    sort: { options: [{ key: 'start', label: 'Started' }, { key: 'wonValue', label: 'Won value' }, { key: 'leads', label: 'Leads' }], default: { key: 'start', dir: 'desc' } },
    groupBy: [{ key: 'type', label: 'Type' }, { key: 'owner', label: 'Owner', type: 'person' }],
    href: (r) => r.route, noun: 'campaign', showId: false, empty: 'No campaigns match.' });
  const byType = types.map((t, i) => ({ label: t === 'Event' ? 'Events' : t === 'Newsletter' ? 'Studio letters' : t, value: sum(rows.filter((r) => r.type === t), (r) => r.wonValue), color: String(i + 1) }));
  const spent = sum(rows, (r) => r.cost), wonV = sum(rows, (r) => r.wonValue);
  return cx.page({ title: 'Campaigns', workspace: 'crm', crumbs: lgCrumbs(),
    sub: 'Outreach sequences, events, studio letters and paid posts, each with what it brought in.',
    actions: [cx.btn('Funnel', { icon: 'report', href: ['crm-funnel'] })],
    fde: 'Campaigns and their results in the CRM',
    body: [
      statCards([
        { label: 'Campaigns', value: fmt.int(rows.length), sub: `${fmt.int(rows.filter((r) => r.status !== 'Finished').length)} running or upcoming` },
        { label: 'Leads', value: fmt.int(sum(rows, (r) => r.leads)), sub: `${fmt.int(sum(rows, (r) => r.qualified))} qualified` },
        { label: 'Won', value: fmt.gbp(wonV, 0), sub: fmt.plural(sum(rows, (r) => r.won), 'deal') },
        { label: 'Spent', value: fmt.gbp(spent, 0), sub: spent ? `${fmt.num(wonV / spent, 1)}× back in won work` : 'staff time only' },
      ]),
      h('div.grid.c2', cx.card({ title: 'Won value by kind of campaign', body: cx.chart.hbar({ items: byType, format: (v) => fmt.compact(v, 'GBP') }) }),
        cx.card({ title: 'Leads by kind of campaign', body: cx.chart.hbar({ items: types.map((t, i) => ({ label: t === 'Event' ? 'Events' : t === 'Newsletter' ? 'Studio letters' : t, value: sum(rows.filter((r) => r.type === t), (r) => r.leads), color: String(i + 1) })), format: (v) => fmt.int(v) }) })),
      list,
    ] });
}
function campaignPage(c) {
  const ls = C.leads.filter((l) => CAMP_OF.get(l.name) === c || NEWS_FIRST.get(l.name) === c).sort((a, b) => String(qualOf(b).arrival).localeCompare(String(qualOf(a).arrival)));
  const real = ls.filter((l) => l.status !== 'Junk');
  const r = resultsOf(real);
  const status = c.upcoming ? 'Upcoming' : (c.end || c.start) >= TODAY ? 'Running' : 'Finished';
  const inv = c.upcoming ? invitesOf(c) : [];
  const leadList = ls.length ? h('div.crm-list', ls.map((l) => { const q = qualOf(l), d = leadDeal(l); return h('a.crm-row', { href: cx.href('lead', l.name) }, extAvatar(leadName(l), { size: 'sm' }),
    h('div', { style: 'display:grid;gap:2px;min-width:0' }, h('span.t', `${leadName(l)}${l.org ? ' · ' + l.org : ''}`), h('span.m', NEWS_FIRST.get(l.name) === c ? h('span', 'Clicked through, then used the website form') : h('span', q.channel), h('span', `→ ${cx.name(l.owner)}`))),
    h('div.r', l.status === 'Junk' ? cx.pill('Spam', 'gray') : d ? stDot('deal', d.status) : stDot('lead', l.status), d?.status === 'Won' ? h('span', fmt.gbp(dealGbp(d), 0)) : h('span', fmt.ago(q.arrival)))); })) : cx.empty(c.upcoming ? 'Leads come after the event.' : 'No leads from this one.');
  const invCard = c.upcoming ? cx.card({ title: 'Invitations', body: [
    statCards([{ label: 'Invited', value: fmt.int(inv.filter((x) => x.t.state === 'Sent').length), sub: 'through outreach so far' }, { label: 'Coming', value: fmt.int(inv.filter((x) => x.rsvp === 'Coming').length), sub: `of 30 seats` }, { label: 'To approve', value: fmt.int(inv.filter((x) => x.t.state === 'Waiting for approval').length), sub: 'invitations drafted' }]),
    h('p.muted', { style: 'font-size:12.5px;margin:10px 0 2px' }, 'Sent as a step of the school trust and housing sequences, each batch approved by its owner. Answers are logged as they come in.'),
    h('div.crm-list', inv.filter((x) => x.t.state === 'Sent').sort((a, b) => (a.rsvp === 'Coming' ? 0 : 1) - (b.rsvp === 'Coming' ? 0 : 1) || String(b.t.at).localeCompare(String(a.t.at))).slice(0, 15).map((x) => h('a.crm-row', { href: cx.href('prospect', x.p.id) }, extAvatar(x.p.org, { size: 'sm', square: true }), h('div', { style: 'display:grid;gap:2px;min-width:0' }, h('span.t', `${x.p.name} · ${x.p.org}`), h('span.m', h('span', `Invited ${fmt.day(x.t.at)}`))), h('div.r', cx.pill(x.rsvp, x.rsvp === 'Coming' ? 'green' : x.rsvp === 'Cannot make it' ? 'gray' : 'muted'))))),
  ] }) : null;
  return cx.page({ title: c.name, workspace: 'crm', crumbs: lgCrumbs('Campaigns', 'campaigns'), status: [cx.pill(status, C_TONE[status], { lg: true })],
    sub: `${c.id} · ${c.type}${c.format ? ' · ' + c.format : ''} · ${fmt.date(c.start)}${c.end && c.end !== c.start ? ' to ' + fmt.date(c.end) : ''} · owner ${cx.name(c.owner)}`,
    actions: [cx.btn('All campaigns', { icon: 'list', href: ['campaigns'] })],
    fde: `The campaign ${c.name}`,
    body: [
      c.upcoming ? null : statCards([
        { label: c.type === 'Event' ? 'People met' : c.type === 'Paid social' ? 'Seen by' : 'Sent to', value: fmt.int(c.reached), sub: c.clicks ? `${fmt.int(c.clicks)} clicked through` : c.capture || '' },
        { label: 'Leads', value: fmt.int(real.length), sub: ls.length - real.length ? `${ls.length - real.length} more filtered as spam` : 'no spam' },
        { label: 'Qualified', value: fmt.int(r.qualified), sub: `${fmt.int(r.deals)} became deals` },
        { label: 'Won', value: fmt.gbp(r.wonValue, 0), sub: c.cost ? `${fmt.gbp(c.cost, 0)} spent${r.wonValue ? `, ${fmt.num(r.wonValue / c.cost, 1)}× back` : ''}` : 'staff time only' },
      ]),
      h('div.grid.side',
        invCard || cx.card({ title: 'Leads', body: leadList }),
        cx.card({ title: 'Details', body: cx.kv([['Type', c.type], c.format ? ['Format', c.format] : null, c.place ? ['Where', c.place] : null, ['When', `${fmt.date(c.start)}${c.end && c.end !== c.start ? ' to ' + fmt.date(c.end) : ''}`], ['Owner', cx.personChip(c.owner, { link: false })], c.capture ? ['Leads captured by', c.capture] : null, c.about ? ['About', c.about] : null, ['Cost', c.cost ? fmt.gbp(c.cost, 0) : 'Staff time only']]) })),
    ] });
}

function funnelPage() {
  const st = cx.store.get('crm-funnel', { period: 'ytd' });
  const period = FPERIODS.some(([k]) => k === st.period) ? st.period : 'ytd';
  const months = periodMonths(period);
  const F = funnelData(months);
  const wonV = sum(F.won, dealGbp);
  const stages = [
    { label: 'Prospects', n: F.pros.length, sub: 'reached by outreach' },
    { label: 'Leads', n: F.leads.length, sub: 'in, not counting spam' },
    { label: 'Qualified', n: F.quals.length, sub: 'by a person' },
    { label: 'Proposal', n: F.props.length, sub: 'sent a proposal' },
    { label: 'Won', n: F.won.length, sub: fmt.gbp(wonV, 0) },
  ];
  const max = Math.max(1, ...stages.map((s) => s.n));
  const convLine = (c, i) => h('div.lg-conv', h('b', pctOr(c.n, c.of)), h('span', `${i === 0 ? 'of prospects reached became leads' : 'moved on'}: ${c.n} of ${c.of}`), c.open ? h('span.muted', `${c.open} still open`) : null, h('span.muted', `median ${daysTxt(c.t)} to move on`));
  const funnel = h('div.lg-funnel', stages.map((s, i) => [
    i ? convLine(F.conv[i - 1], i - 1) : null,
    h('div.lg-stage', h('div.lg-stage-l', s.label), h('div.lg-bar', h('i', { style: `width:${Math.max(1.5, (s.n / max) * 100)}%;background:var(--chart-${i === 4 ? 1 : 2})` })), h('div.lg-stage-n', fmt.int(s.n), h('small', s.sub))),
  ]));
  const inM = (at, m) => at && monthOf(at) === m;
  const mRows = months.map((m) => {
    const won = C.deals.filter((d) => d.status === 'Won' && inM(d.closedDate, m));
    const leads = C.leads.filter((l) => l.status !== 'Junk' && inM(qualOf(l).arrival, m));
    return { m, pros: enrolled(PROSPECTS).filter((p) => inM(p.enrolAt, m)).length, leads: leads.length, fromPros: leads.filter((l) => PROS_OF_LEAD.has(l.name)).length, quals: C.leads.filter((l) => inM(qualOf(l).qualifiedAt, m)).length, props: C.deals.filter((d) => inM(proposalAt(d), m)).length, won: won.length, wonV: sum(won, dealGbp) };
  });
  const chart = cx.chart.bar({ labels: months.map(monthLabel), height: 220, format: (v) => fmt.int(v),
    series: [{ name: 'Leads', values: mRows.map((r) => r.leads), color: '2' }, { name: 'Qualified', values: mRows.map((r) => r.quals), color: '3' }, { name: 'Proposal', values: mRows.map((r) => r.props), color: '4' }, { name: 'Won', values: mRows.map((r) => r.won), color: 'pos' }] });
  const table = tbl([{ label: 'Month' }, { label: 'Prospects', num: true }, { label: 'Leads', num: true }, { label: 'From outreach', num: true, opt: true }, { label: 'Qualified', num: true }, { label: 'Proposal', num: true }, { label: 'Won', num: true }, { label: 'Won value', num: true }],
    mRows.slice().reverse().map((r) => h('tr', td(fmt.month(r.m)), td(r.pros ? fmt.int(r.pros) : '—', { num: true }), td(fmt.int(r.leads), { num: true }), td(r.fromPros ? fmt.int(r.fromPros) : '—', { num: true, opt: true }), td(fmt.int(r.quals), { num: true }), td(fmt.int(r.props), { num: true }), td(fmt.int(r.won), { num: true }), td(r.wonV ? fmt.gbp(r.wonV, 0) : '—', { num: true }))));
  // in each stage now, and for how long
  const nowRows = [
    ['Prospects', PROSPECTS.filter((p) => p.status === 'In sequence'), (p) => p.enrolAt, 'prospects'],
    ['Leads', C.leads.filter((l) => !l.converted && ['open', 'ongoing'].includes(stageOf('lead', l.status))), (l) => qualOf(l).arrival, 'leads'],
    ['Qualified', C.deals.filter((d) => isOpenDeal(d) && !proposalAt(d)), (d) => d.createdAt, 'deals'],
    ['Proposal', C.deals.filter((d) => isOpenDeal(d) && proposalAt(d)), (d) => proposalAt(d), 'pipeline'],
  ].map(([label, recs, at, route], i) => h('tr', td(h('a', { href: cx.href(route) }, label)), td(fmt.int(recs.length), { num: true }), td(daysTxt(median(recs.map((r) => daysOf(at(r), NOW0)))), { num: true }), td(daysTxt(F.conv[i].t), { num: true }), td(pctOr(F.conv[i].n, F.conv[i].of), { num: true, opt: true })));
  const periodSel = h('select.ctl', { 'aria-label': 'Period', onchange: (e) => { cx.store.set('crm-funnel', { period: e.target.value }); cx.refresh(); } }, FPERIODS.map(([k, l]) => h('option', { value: k, selected: k === period }, l)));
  return cx.page({ title: 'Funnel', workspace: 'crm', crumbs: lgCrumbs(),
    sub: `${fmt.month(months[0])} to ${fmt.month(months.at(-1))} · each stage counts what reached it in the period; each step's rate follows those records on`,
    actions: [cx.btn('Campaigns', { icon: 'send', href: ['campaigns'] }), cx.btn('Lead sources', { icon: 'report', href: ['crm-sources'] })],
    fde: `The CRM funnel, ${FPERIODS.find(([k]) => k === period)[1].toLowerCase()}`,
    body: [
      h('div.crm-dash-bar', h('label', 'Period', periodSel)),
      h('div.grid.c2',
        cx.card({ title: 'From prospect to won', body: funnel }),
        cx.card({ title: 'By month', body: chart })),
      cx.card({ title: 'Time in each stage', flush: true, body: tbl([{ label: 'Stage' }, { label: 'In it now', num: true }, { label: 'For (median)', num: true }, { label: 'To move on (median)', num: true }, { label: 'Move on', num: true, opt: true }], nowRows) }),
      cx.card({ title: 'Month by month', flush: true, body: table }),
      attributionReport(),
    ] });
}
function attributionReport() {
  return cx.reportView({
    key: 'lg-attribution',
    filters: [{ key: 'model', label: 'Credit', type: 'select', options: [['first', 'First touch'], ['last', 'Last touch']], value: 'first' }, { key: 'period', label: 'Leads in', type: 'select', options: PERIODS, value: 'all' }],
    run: (v) => {
      const leads = C.leads.filter((l) => l.status !== 'Junk' && (v.period === 'all' || dayOf(qualOf(l).arrival) >= addDays(TODAY, -(+v.period - 1))));
      const of = v.model === 'last' ? lastTouchOf : firstTouchOf;
      const groups = new Map(ATTR_GROUPS.map((g) => [g, new Map()]));
      for (const l of leads) { const s = of(l); const g = groups.get(s.group) || groups.get('Direct'); const e = g.get(s.label) || { s, leads: [] }; e.leads.push(l); g.set(s.label, e); }
      const costOf = (s) => (s.route === 'campaign' ? CAMP.get(s.id)?.cost || 0 : 0);
      const all = resultsOf(leads);
      const row = (label, ls, indent, extra = {}) => { const r = resultsOf(ls); return { source: label, indent, leads: r.leads, qualified: r.qualified, deals: r.deals, won: r.won, wonValue: r.wonValue, share: all.wonValue ? fmt.pct(r.wonValue / all.wonValue, 0) : '—', perLead: r.leads ? r.wonValue / r.leads : 0, ...extra }; };
      const rows = [];
      for (const g of ATTR_GROUPS) {
        const m = groups.get(g); if (!m.size) continue;
        const ls = [...m.values()].flatMap((e) => e.leads);
        rows.push(row(g, ls, 0, { group: true, cost: sum([...m.values()], (e) => costOf(e.s)) || null }));
        for (const e of [...m.values()].sort((a, b) => resultsOf(b.leads).wonValue - resultsOf(a.leads).wonValue || b.leads.length - a.leads.length)) rows.push(row(e.s.label, e.leads, 1, { id: e.s.label, cost: costOf(e.s) || null, link: e.s.route ? [e.s.route, e.s.id] : null }));
      }
      const top = rows.filter((r) => r.indent === 0).sort((a, b) => b.wonValue - a.wonValue);
      return {
        summary: [
          { label: 'Leads', value: fmt.int(all.leads) }, { label: 'Won', value: fmt.gbp(all.wonValue, 0), sub: fmt.plural(all.won, 'deal') },
          { label: 'Biggest source', value: top[0]?.source || '—', sub: top[0] ? fmt.gbp(top[0].wonValue, 0) : '' },
          { label: 'From outreach', value: fmt.gbp(rows.find((r) => r.source === 'Outreach' && r.indent === 0)?.wonValue || 0, 0), sub: v.model === 'first' ? 'credited to the first touch' : 'credited to the last touch' },
        ],
        columns: [
          { key: 'source', label: 'Source', width: '260px', href: (r) => r.link || null },
          { key: 'leads', label: 'Leads', type: 'int' }, { key: 'qualified', label: 'Qualified', type: 'int' }, { key: 'deals', label: 'Deals', type: 'int' }, { key: 'won', label: 'Won', type: 'int' },
          { key: 'wonValue', label: 'Won value', type: 'currency' }, { key: 'share', label: 'Share' }, { key: 'perLead', label: 'Won per lead', type: 'currency' }, { key: 'cost', label: 'Cost', type: 'currency' },
        ],
        rows, totals: { source: 'All sources', leads: all.leads, qualified: all.qualified, deals: all.deals, won: all.won, wonValue: all.wonValue, share: '100%', perLead: all.leads ? all.wonValue / all.leads : 0, cost: sum(CAMPAIGNS, (c) => c.cost || 0) },
        chartTitle: 'Won value by source',
        chart: cx.chart.hbar({ items: top.filter((r) => r.wonValue).map((r, i) => ({ label: r.source, value: r.wonValue, color: String((i % 6) + 1) })), format: (x) => fmt.compact(x, 'GBP') }),
      };
    },
    footnote: 'First touch credits what first put Harbourline in front of them: an outreach email or a studio letter, even if they later used the website form. Last touch credits how they finally got in touch. Won value is in pounds at the day\'s rate.',
  });
}

/* ---------- routes and search ---------- */

cx.route('crm-funnel', () => funnelPage(), { workspace: 'crm', title: 'Funnel' });
cx.route('crm-icp', () => icpPage(), { workspace: 'crm', title: 'Ideal customer profile' });
cx.route('prospects', (ctx) => prospectsPage(ctx), { workspace: 'crm', title: 'Prospects' });
cx.route('prospect', (ctx) => { const p = cx.find(PROSPECTS, 'id', ctx.id); return p ? prospectPage(p) : notFound('prospect', 'prospects', 'Prospects'); }, { workspace: 'crm', title: 'Prospect' });
cx.route('sequences', () => sequencesPage(), { workspace: 'crm', title: 'Outreach' });
cx.route('sequence', (ctx) => { const S = cx.find(SEQS, 'id', ctx.id); return S ? sequencePage(S) : notFound('sequence', 'sequences', 'Outreach'); }, { workspace: 'crm', title: 'Outreach sequence' });
cx.route('crm-inbound', () => inboundPage(), { workspace: 'crm', title: 'Inbound' });
cx.route('nurture', () => nurturePage(), { workspace: 'crm', title: 'Nurture' });
cx.route('campaigns', () => campaignsPage(), { workspace: 'crm', title: 'Campaigns' });
cx.route('campaign', (ctx) => { const c = cx.find(CAMPAIGNS, 'id', ctx.id); return c ? campaignPage(c) : notFound('campaign', 'campaigns', 'Campaigns'); }, { workspace: 'crm', title: 'Campaign' });
cx.search.add((qq, limit) => {
  const t = qq.toLowerCase(), out = [];
  const take = (arr, f) => { let n = 0; for (const x of arr) { if (n >= limit) break; const r = f(x); if (r) { out.push(r); n++; } } };
  take(PROSPECTS, (p) => (`${p.org} ${p.name} ${p.id}`.toLowerCase().includes(t) ? { kind: 'CRM prospects', label: p.org, sub: `${p.id} · ${p.status} · fit ${fitOf(p).score}`, route: 'prospect', id: p.id, icon: 'crm' } : null));
  take([...SEQS.map((S) => ({ label: S.name, sub: `${S.id} · outreach`, route: 'sequence', id: S.id })), ...CAMPAIGNS.map((c) => ({ label: c.name, sub: `${c.id} · ${c.type}`, route: 'campaign', id: c.id }))], (x) => (x.label.toLowerCase().includes(t) ? { kind: 'CRM campaigns', ...x, icon: 'send' } : null));
  return out;
});

/* ---------- what the sales agent proposes and did for lead generation, in the assistant panel ---------- */

function registerLeadGenWork() {
  if (typeof cx.agentWork?.add !== 'function') return;
  const put = (o) => { try { cx.agentWork.add({ agent: AGENT_NAME, module: 'crm', ...o }); } catch (e) { console.warn('agentWork.add', e); } };
  const since = addDays(TODAY, -6);
  // batches waiting for approval, one per sequence and step
  for (const S of SEQS) {
    const x = seqTotals(S);
    const by = new Map();
    for (const y of x.waiting) { const k = y.t.step; (by.get(k) || by.set(k, []).get(k)).push(y); }
    for (const [step, list] of by) {
      const st = S.steps[step];
      const noun = st.kind === 'linkedin' ? 'LinkedIn note' : st.kind === 'event' ? 'invitation' : 'email';
      const first = list.map((y) => y.t.at).sort()[0];
      put({ key: `lg-batch-${S.id}-${step}`, kind: 'proposal', who: S.owner, needs: LG_NEED, at: isoPlus(NOW0, -(30 + step * 17)),
        title: `Approve ${fmt.plural(list.length, noun)}: step ${step + 1} of ${lc1(S.name)}`,
        detail: `${st.label}, due ${dayOf(first) === TODAY ? 'today' : 'tomorrow'} from ${st.kind === 'linkedin' ? 'your profile' : 'your mailbox'}. Each is written for its prospect; nothing goes until you approve.`,
        steps: [...list.slice(0, 5).map((y) => `${y.p.name}, ${y.p.org}: "${st.subject(y.p)}"`), list.length > 5 ? `and ${list.length - 5} more` : null].filter(Boolean),
        route: ['sequence', S.id], approveLabel: 'Approve and send', onApprove: () => approveTouches(list, noun) });
    }
    // interested replies, to become leads
    for (const p of x.en.filter((pp) => pp.reply?.cls === 'Interested' && !pp.lead)) {
      put({ key: `lg-lead-${p.id}`, kind: 'proposal', who: p.owner, needs: LG_NEED, at: isoPlus(p.reply.at, 4),
        title: `Make a lead: ${p.name} at ${p.org} replied "interested"`,
        detail: `Fit ${fitOf(p).score}: ${p.signal.text.toLowerCase()}. They asked to talk next week. The outreach has stopped; the lead goes to you with the thread on its timeline.`,
        route: ['prospect', p.id], approveLabel: 'Make the lead', result: `Made a lead for ${p.name} at ${p.org}`, onApprove: () => leadFromProspect(p) });
    }
    for (const p of x.en.filter((pp) => pp.reply && dayOf(pp.reply.at) >= since)) {
      if (p.reply.cls === 'Interested') continue;
      put({ key: `lg-reply-${p.id}`, kind: 'done', who: p.owner, at: isoPlus(p.reply.at, 2),
        title: `Logged a reply from ${p.contactWas || p.name}, ${p.org}: ${lc1(p.reply.cls === 'Wrote in' ? 'became a lead' : p.reply.cls)}`,
        detail: p.reply.cls === 'Not now' ? `Moved to nurture, to check back in ${fmt.month(p.reply.until)}.` : p.reply.cls === 'Out of office' ? `Held the next steps until ${fmt.date(p.reply.until)}.` : p.reply.cls === 'Unsubscribe' ? 'Added to the do-not-contact list; nothing more goes to them.' : p.reply.cls === 'Wrong person' ? `${p.reply.colleague} is now the contact; the next steps go to them.` : p.reply.cls === 'Bounced' ? 'Stopped the sequence for them.' : 'Stopped the sequence for them.',
        route: ['prospect', p.id] });
    }
  }
  // lists: one waiting for approval, and the ones built lately
  for (const L of LISTS) {
    const ps = prosOf(L);
    if (L.pending) put({ key: `lg-list-${L.id}`, kind: 'proposal', who: L.owner, needs: LG_NEED, at: atOn(L.builtAt, 9, L.id),
      title: `Start outreach to ${fmt.plural(ps.filter((p) => !p.excluded).length, 'prospect')}: ${lc1(L.name)}`,
      detail: `Built from job boards and careers pages against the profile; each has a named contact and why it fits. The sequence is five steps over 18 days, and each batch comes to you before it goes.`,
      steps: ps.slice().sort((a, b) => fitOf(b).score - fitOf(a).score).slice(0, 4).map((p) => `${p.org} (fit ${fitOf(p).score}): ${p.signal.text}`),
      route: ['prospects'], approveLabel: 'Approve the list', result: `Approved the list "${L.name}"`,
      onApprove: () => { L.pending = false; ps.filter((p) => !p.excluded).forEach((p) => { p.status = 'Approved for outreach'; }); cx.toast(`Approved "${L.name}": the first emails come to you for approval tomorrow (mock-up: nothing is sent)`, { tone: 'success' }); cx.refresh(); } });
    if (dayOf(L.builtAt) >= addDays(TODAY, -13)) put({ key: `lg-built-${L.id}`, kind: 'done', who: L.owner, at: atOn(L.builtAt, 8, L.id),
      title: `Built a prospect list: ${fmt.plural(ps.filter((p) => !p.excluded).length, 'organisation')}, ${lc1(L.name)}`,
      detail: `From ${ICP.signals.find((s) => s.key === L.signal).source}; enriched each with size, place and a named contact.${ps.some((p) => p.excluded) ? ` Left out ${namesList(ps.filter((p) => p.excluded).map((p) => p.org))}: Harbourline already works with them.` : ''}`,
      route: ['prospects'] });
  }
  // nurture: leads showing a new signal, with a check-in drafted for their owner
  for (const r of nurtureRows().filter((x) => x.sig && x.kind === 'lead')) {
    const l = r.rec, em = l.email;
    if (!em) continue;
    const d = { to: em, subject: `Checking in, ${l.org || leadName(l)}`, body: `Hi ${l.firstName || 'there'},\n\nI saw that you ${lc1(r.sig.text.replace(/^Posted/, 'have posted').replace(/^Announced/, 'have announced'))}. Congratulations. When we last spoke the timing wasn't right; if it is now, I'd be glad to pick up where we left off.\n\n${cx.firstName(l.owner)}` };
    put({ key: `lg-nurture-${l.name}`, kind: 'proposal', who: l.owner, at: atOn(r.sig.at, 9, l.name),
      title: `${l.org || leadName(l)} may be ready to talk again`,
      detail: `${r.sig.text} (${r.sig.source}, ${fmt.date(r.sig.at)}). In nurture since: ${lc1(r.why)}. Draft to ${em}: "${d.body.split('\n').filter(Boolean).slice(1, -1).join(' ')}"`,
      route: ['lead', l.name], approveLabel: 'Send it', result: `Sent the check-in to ${leadName(l)}`, onApprove: () => sendDraft('lead', l, d) });
  }
  // the profile: a change the record supports, for the people who own it
  const edu = sectorOf('Education');
  if (edu && edu.tier !== 'Core') {
    const en = enrolled(PROSPECTS), eduEn = en.filter((p) => p.ind === 'Education');
    const rr = (ps) => ps.filter((p) => p.reply && ['Interested', 'Wrote in', 'Not now'].includes(p.reply.cls)).length / (ps.length || 1);
    put({ key: 'lg-icp-education', kind: 'proposal', who: ['maya', 'leo'], needs: ICP_NEED, at: '2026-11-06T16:10:00Z',
      title: 'Make school trusts a core sector in the ideal customer profile',
      detail: `Trusts answer outreach well: ${fmt.pct(rr(eduEn), 0)} replied with interest or a "not now", against ${fmt.pct(rr(en.filter((p) => p.ind !== 'Education')), 0)} elsewhere. Brightwater Schools Trust and Pinecrest Academy Trust came from it. It would score them higher and put them in more lists.`,
      route: ['crm-icp'], approveLabel: 'Make it core', result: 'Made school trusts a core sector',
      onApprove: () => { edu.tier = 'Core'; ICP.version++; ICP.reviewedAt = NOW(); ICP.history.push({ v: ICP.version, at: NOW(), by: [cx.meId()], text: 'Made school trusts a core sector, on the outreach replies.' }); cx.toast(`Saved version ${ICP.version} of the profile: school trusts are core`, { tone: 'success' }); cx.refresh(); } });
  }
  // inbound: events and referrals this fortnight
  for (const c of CAMPAIGNS.filter((x) => x.type === 'Event' && !x.upcoming && x.start >= addDays(TODAY, -13))) {
    const ls = C.leads.filter((l) => CAMP_OF.get(l.name) === c);
    if (ls.length) put({ key: `lg-event-${c.id}`, kind: 'done', who: c.owner, at: atOn(addDays(c.end || c.start, 3), 9, c.id), title: `Scored ${fmt.plural(ls.length, 'lead')} from ${c.name}`, detail: `${namesList(ls.map((l) => l.org || leadName(l)))}, from the badge scans; each routed to an owner.`, route: ['campaign', c.id] });
  }
}

cx.style('crm-leadgen', `
.lg-funnel { display: grid; gap: 4px; min-width: 0; }
.lg-stage { display: grid; grid-template-columns: 84px minmax(0, 1fr) 112px; gap: 10px; align-items: center; min-width: 0; }
.lg-stage-l { font-weight: 600; font-size: 13px; }
.lg-bar { height: 26px; background: var(--sunk); border-radius: 4px; overflow: hidden; min-width: 0; }
.lg-bar i { display: block; height: 100%; border-radius: 4px; }
.lg-stage-n { font: 600 15px/1.15 var(--font-ui); text-align: right; white-space: nowrap; min-width: 0; }
.lg-stage-n small { display: block; font-weight: 400; color: var(--muted); font-size: 11.5px; }
.lg-conv { display: flex; flex-wrap: wrap; gap: 2px 10px; padding: 2px 0 2px 94px; font-size: 12px; color: var(--fg-2); min-width: 0; }
@media (max-width: 560px) { .lg-stage { grid-template-columns: 70px minmax(0, 1fr) 92px; } .lg-conv { padding-left: 0; } }
.lg-lists { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr)); min-width: 0; }
.lg-list { display: grid; gap: 6px; align-content: start; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface); color: inherit; text-decoration: none; min-width: 0; }
.lg-list:hover { border-color: var(--line-2); }
.lg-list h4 { font: 600 13.5px/1.35 var(--font-ui); overflow-wrap: anywhere; }
.lg-list .m { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 12px; color: var(--muted); }
.lg-reasons { margin: 8px 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; color: var(--fg-2); overflow-wrap: anywhere; }
.lg-steps { display: grid; min-width: 0; }
.lg-step { display: grid; grid-template-columns: 50px minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--line); min-width: 0; }
.lg-step:first-child { padding-top: 0; }
.lg-step:last-child { border-bottom: 0; }
.lg-day { font: 600 12px/1.3 var(--font-ui); color: var(--muted); padding-top: 2px; }
.lg-ttl { min-width: 190px; }
@media (max-width: 700px) { .lg-ttl { min-width: 130px; } }
`);

cx.on('route', () => QUAL.clear());
cx.native = Object.assign(cx.native || {}, { crmQualification: (name) => { const l = C.leads.find((x) => x.name === name); return l ? qualOf(l) : null; }, crmStale: (name) => { const d = C.deals.find((x) => x.name === name); return d ? staleOf(d) : null; } });
registerAgentWork();
registerLeadGenWork();
