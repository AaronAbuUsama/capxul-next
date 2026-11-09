// Governance: what waits for whom (approvals), the Board with its Directors, threshold, officer hats and proposals,
// equity (cap table, rounds and SAFEs, options, shareholder votes, an exit preview), and seats and agents (the seat
// meter, buying seats, members, invitations, each seat's agent). Everything reads cx.data (fictional sample data);
// actions change it in memory and redraw. Money helpers come from money.js through cx.native, read at call time.
import { cx, h } from './core.js';

const D = cx.data;
const fmt = cx.fmt;
const ORG = '--org harbourline';
const N = () => cx.native || {};
const T = D.money.safes.treasury;
const E = D.equity;
const B = D.board;
const S = D.seats;
let tick = 0;
const stamp = () => (N().stamp ? N().stamp() : new Date(cx.now.getTime() + ++tick * 43000).toISOString());
const r2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
const pct = (x, dp = 2) => `${fmt.num(x, dp)}%`;
const tabsV = (t, o) => { const el = cx.tabs(t, o); el.style.minWidth = '0'; return el; };
const formV = (o) => { const f = cx.formView(o); f.classList.add('gv-formv'); return f; };
const addEvent = (text, ref, kind) => (N().addEvent ? N().addEvent(text, ref, kind) : D.events.unshift({ at: stamp(), kind, text, ref, who: cx.meId() }));
const addNotice = (to, text, ref, kind) => N().addNotice?.(to, text, ref, kind);
const dropWaiting = (pred) => { const w = D.approvals.waiting; for (let i = w.length - 1; i >= 0; i--) if (pred(w[i])) w.splice(i, 1); };
const directors = () => B.directors.map((d) => d.who);
const safeOf = (id) => cx.person(id)?.safe || S.members.find((m) => m.id === id)?.safe || '';
const isDirector = () => cx.wears('Director');
/** A short deterministic hex from any text (for decoded calls' raw data). */
function hexOf(text, len = 64) { let a = 0x811c9dc5, out = ''; for (let i = 0; out.length < len; i++) { a ^= text.charCodeAt(i % text.length) + i; a = Math.imul(a, 16777619) >>> 0; out += a.toString(16).padStart(8, '0'); } return '0x' + out.slice(0, len); }

cx.style('governance', `
.gv-formv .form-side .card-body > * { min-width: 0; }
.gv-formv .form-side .hash { white-space: normal; flex-wrap: wrap; max-width: 100%; }
.gv-wait { list-style: none; margin: 0; padding: 0; }
.gv-wait > li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px 12px; align-items: start; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.gv-wait > li:last-child { border-bottom: 0; }
.gv-wait .what { font-weight: 600; overflow-wrap: anywhere; }
.gv-wait .why { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.gv-wait code { display: block; margin-top: 4px; font-size: 11.5px; color: var(--faint); overflow-wrap: anywhere; white-space: normal; }
.gv-wait .act { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
@media (max-width: 640px) { .gv-wait > li { grid-template-columns: minmax(0, 1fr); } .gv-wait .act { justify-content: flex-start; } }
.gv-chipbar { display: flex; flex-wrap: wrap; gap: 6px; }
.gv-chipbar button { height: 28px; padding: 0 10px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--surface); color: var(--fg-2); font: 500 12.5px var(--font-ui); cursor: pointer; }
.gv-chipbar button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--fg); }
.gv-who { padding: 10px 14px 4px; font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--faint); border-bottom: 1px solid var(--line); background: var(--surface-2); }
.gv-stack { display: flex; height: 22px; border-radius: 4px; overflow: hidden; background: var(--sunk); }
.gv-stack i { display: block; height: 100%; min-width: 2px; }
.gv-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--fg-2); margin-top: 8px; }
.gv-legend span { display: inline-flex; align-items: center; gap: 6px; }
.gv-legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.gv-calls { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; counter-reset: c; }
.gv-calls li { counter-increment: c; display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; font: 12.5px/1.5 var(--font-mono); overflow-wrap: anywhere; }
.gv-calls li::before { content: counter(c); width: 22px; height: 22px; border-radius: 50%; background: var(--sunk); display: grid; place-items: center; font: 600 11px var(--font-ui); color: var(--fg-2); }
.gv-tally { display: grid; gap: 6px; }
.gv-tally .row { display: grid; grid-template-columns: 74px minmax(0, 1fr) auto; gap: 10px; align-items: center; font-size: 13px; }
.gv-tally .track { height: 10px; border-radius: 5px; background: var(--sunk); position: relative; overflow: hidden; }
.gv-tally .track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; }
.gv-quorum { position: relative; height: 0; }
.gv-meter { display: grid; gap: 6px; }
.gv-seatgrid { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 4px; max-width: 420px; }
.gv-seatgrid i { aspect-ratio: 1; border-radius: 3px; background: var(--sunk); border: 1px solid var(--line); }
.gv-seatgrid i.used { background: var(--accent); border-color: var(--accent); }
.gv-seatgrid i.held { background: var(--t-orange-bg); border-color: var(--t-orange); }
.gv-seatgrid i.bought { border-style: dashed; }
.gv-vest { height: 6px; border-radius: 3px; background: var(--sunk); overflow: hidden; min-width: 70px; }
.gv-vest i { display: block; height: 100%; background: var(--chart-1); }
`);

/* =====================================================================================================
   Workspaces
   ===================================================================================================== */

const mineWaiting = () => D.approvals.waiting.filter((a) => (a.waitsFor || []).includes(cx.meId()) && !(a.kind === 'Board' && (a.approvedBy || []).includes(cx.meId())));
cx.workspace({ id: 'approvals', label: 'Approvals', icon: 'approvals', route: 'approvals', nav: [{ label: 'What waits', route: 'approvals' }], badge: () => mineWaiting().length || null });
cx.workspace({
  id: 'board', label: 'Board and equity', icon: 'board', route: 'board',
  badge: () => B.proposals.filter((p) => p.status === 'Waiting' && directors().includes(cx.meId()) && !p.approvals.some((a) => a.who === cx.meId())).length || null,
  nav: [
    { label: 'Board', route: 'board' },
    { label: 'Proposals', route: 'proposals', match: ['proposal'] },
    { section: 'Equity', items: [
      { label: 'Cap table', route: 'cap-table' },
      { label: 'Rounds and SAFEs', route: 'rounds', match: ['round'] },
      { label: 'Options', route: 'options' },
      { label: 'Votes', route: 'votes', match: ['vote'] },
    ] },
  ],
});
cx.workspace({ id: 'seats', label: 'Seats and agents', icon: 'seats', route: 'seats', nav: [{ label: 'Seats', route: 'seats', match: ['member'] }, { label: 'Agents', route: 'agents', match: ['agent'] }] });

/* =====================================================================================================
   Board proposals: approve, reject, effects
   ===================================================================================================== */

const SP_TONE = { Waiting: 'orange', Executed: 'green', Failed: 'red', Rejected: 'muted', Replaced: 'muted' };
const spPill = (sp, o) => cx.pill(sp.status === 'Waiting' ? `Waiting · ${sp.approvals.length} of ${sp.threshold}` : sp.status, SP_TONE[sp.status], o);
async function boardAsk(o) {
  if (N().boardAsk) return N().boardAsk(o);
  cx.toast('Board proposals need the money module.', { tone: 'warning' });
  return null;
}
/** What an executed proposal changes in the data, for the ones the story leaves waiting. */
function applyProposal(sp) {
  if (/^Grant Books to Nadia/.test(sp.title)) {
    (D.officerHats.books ||= []).push({ who: 'nadia', from: cx.today });
    for (const rec of [cx.person('nadia'), D.people.find((p) => p.id === 'nadia'), S.members.find((m) => m.id === 'nadia')]) if (rec && !rec.hats.includes('Books')) rec.hats.push('Books');
    addNotice('nadia', 'You now wear the Books hat (granted by the Board)', { type: 'proposal', id: sp.id }, 'Board');
  }
  if (/^Raise Harbourline's budget/.test(sp.title)) {
    const ch = D.departments[0].changes.find((c) => c.proposal === sp.id); if (ch) { ch.state = 'Applied'; ch.signedAs = 'the Board'; }
    const c = D.payoutCeilings.find((x) => x.year === Number(cx.today.slice(0, 4))); if (c) { c.left = r2(c.left + 2400000 - c.ceiling); c.ceiling = 2400000; }
  }
  const sp0 = /^Reject proposal: (.*)$/.exec(sp.title);
  if (sp0) { const tgt = B.proposals.find((x) => x.nonce === sp.nonce && x.id !== sp.id && x.status === 'Waiting'); if (tgt) { tgt.status = 'Rejected'; dropWaiting((a) => a.ref?.id === tgt.id); } }
}
async function approveProposal(sp) {
  const cmd = `capxul org proposal approve ${sp.id} ${ORG}`;
  const r = await cx.approval({ title: `Board proposal ${sp.id}: ${sp.title}`, board: { proposal: sp.id, nonce: sp.nonce, have: sp.approvals.length, need: sp.threshold, approvedBy: sp.approvals.map((a) => a.who) }, warnings: [sp.note ? `Note: ${sp.note}` : null, ...sp.calls.map((c, i) => `${i + 1} · ${c}`)].filter(Boolean), cmd, next: `capxul org proposal wait ${sp.id} ${ORG}` });
  if (r.status === 'declined') return;
  sp.approvals.push({ who: cx.meId(), at: r.at });
  const w = D.approvals.waiting.find((a) => a.ref?.type === 'proposal' && a.ref.id === sp.id);
  if (sp.approvals.length >= sp.threshold) {
    sp.status = 'Executed'; sp.executedAt = r.at; sp.executionTx = r.tx || cx.randHex(32); sp.executionBlock = r.block || cx.blockAt(r.at);
    B.nextNonce = Math.max(B.nextNonce, sp.nonce + 1); T.waiting = Math.max(0, (T.waiting || 1) - 1);
    applyProposal(sp);
    dropWaiting((a) => a.ref?.type === 'proposal' && a.ref.id === sp.id);
    addEvent(`Board proposal ${sp.id} executed: ${sp.title}`, { type: 'proposal', id: sp.id }, 'Board');
    addNotice(directors().filter((x) => x !== cx.meId()), `Board proposal ${sp.id} executed: ${sp.title}`, { type: 'proposal', id: sp.id }, 'Board');
    cx.toast(`${sp.id} executed at block ${fmt.int(sp.executionBlock)}.`, { tone: 'success', cmd });
  } else {
    if (w) { w.approvedBy = sp.approvals.map((a) => a.who); w.waitsFor = directors().filter((x) => !w.approvedBy.includes(x)); }
    cx.toast(`Approved. ${sp.threshold - sp.approvals.length} more to execute ${sp.id}.`, { tone: 'success', cmd });
  }
  cx.refresh();
}
async function rejectProposal(sp) {
  const cmd = `capxul org proposal reject ${sp.id} ${ORG}`;
  const ok = await cx.confirm({ title: `Propose to reject ${sp.id}?`, body: `A rejection is a proposal at the same nonce (${sp.nonce}). It needs ${B.threshold} Directors too; once it executes, ${sp.id} can never run.`, cmd, who: 'any Director', danger: true, confirmLabel: 'Propose the rejection' });
  if (!ok) return;
  const r = await cx.approval({ title: `Reject ${sp.id}: ${sp.title}`, board: { proposal: `${sp.id} (rejection)`, nonce: sp.nonce, have: 0, need: B.threshold, approvedBy: [] }, cmd });
  if (r.status === 'declined') return;
  const n = Math.max(...B.proposals.map((x) => Number(x.id.slice(3)))) + 1;
  const id = 'sp_' + String(n).padStart(4, '0');
  const at = r.at;
  B.proposals.push({ id, nonce: sp.nonce, title: `Reject proposal: ${sp.title}`, kind: 'Rejection', note: null, calls: [`Safe: reject nonce ${sp.nonce} (an empty transaction)`], proposedBy: cx.meId(), createdAt: at, threshold: B.threshold, directors: directors(), approvals: [{ who: cx.meId(), at }], status: 'Waiting', executedAt: null, safeTxHash: cx.randHex(32), executionTx: null, executionBlock: null, why: null, ref: { type: 'proposal', id: sp.id } });
  D.approvals.waiting.unshift({ kind: 'Board', what: `Board proposal ${id}: reject ${sp.id}`, amount: null, openedBy: cx.meId(), openedAt: at, waitsFor: directors().filter((x) => x !== cx.meId()), because: 'Directors approve Board proposals', approvedBy: [cx.meId()], ref: { type: 'proposal', id }, command: `capxul org proposal approve ${id} ${ORG}` });
  cx.toast(`Proposed ${id} to reject ${sp.id}.`, { tone: 'success', cmd });
  cx.go('proposal', id);
}

/* =====================================================================================================
   Approvals: what waits for whom
   ===================================================================================================== */

const KIND_TONE = { Board: 'purple', Money: 'escrow', HR: 'blue', Banking: 'teal', People: 'gray' };
function actionFor(a) {
  const ref = a.ref || {};
  const mine = (a.waitsFor || []).includes(cx.meId());
  if (ref.type === 'proposal') {
    const sp = B.proposals.find((x) => x.id === ref.id);
    if (!sp || sp.status !== 'Waiting') return [cx.btn('Open', { sm: true, href: ['proposal', ref.id] })];
    if (sp.approvals.some((x) => x.who === cx.meId())) return [h('span.muted', { style: 'font-size:12.5px' }, `Approved by you · waiting for ${a.waitsFor.map(cx.firstName).join(' or ')}`), cx.btn('Open', { sm: true, href: ['proposal', ref.id] })];
    return [cx.btn('Open', { sm: true, href: ['proposal', ref.id] }), cx.btn('Approve', { sm: true, kind: 'primary', icon: 'passkey', needs: () => isDirector() || 'Only Directors approve Board proposals.', cmd: a.command, onClick: () => approveProposal(sp) })];
  }
  if (ref.type === 'vote') return [cx.btn('Open', { sm: true, href: ['vote', ref.id] }), mine ? cx.btn('Vote', { sm: true, kind: 'primary', cmd: a.command, onClick: () => castVote(E.votes.find((v) => v.id === ref.id)) }) : null].filter(Boolean);
  if (ref.type === 'payment' && a.action === 'Take back') return [cx.btn('Open', { sm: true, href: ['payment', ref.id] }), mine ? cx.btn('Take back', { sm: true, kind: 'danger', cmd: a.command, onClick: () => { const p = N().findPayment?.(ref.id); if (p) N().takeBack(p); } }) : null].filter(Boolean);
  if (ref.type === 'payment') return [mine ? cx.btn('Review and approve', { sm: true, kind: 'primary', icon: 'passkey', cmd: a.command, onClick: () => { const p = N().findPayment?.(ref.id); if (p) N().approvePrepared(p); } }) : cx.btn('Open', { sm: true, href: ['payment', ref.id] })];
  if (ref.type === 'fde') return [cx.btn(mine ? 'Pay for hosting' : 'Open', { sm: true, kind: mine ? 'primary' : null, cmd: a.command, onClick: () => cx.go('fde', null, { tab: 'Hosting' }) })];
  if (ref.type === 'invitation') return [cx.btn('Open', { sm: true, href: ['seats'] })];
  if (ref.type === 'deposit') return [cx.btn(mine ? 'Match' : 'Open', { sm: true, kind: mine ? 'primary' : null, href: ['deposit', ref.id], cmd: a.command })];
  const route = cx.refRoute(ref);
  return [route && cx.hasRoute(route[0]) ? cx.btn(mine ? 'Decide' : 'Open', { sm: true, kind: mine ? 'primary' : null, href: route, cmd: a.command }) : null].filter(Boolean);
}
function waitItem(a, { showWho } = {}) {
  const href = cx.refHref(a.ref);
  return h('li',
    cx.pill(a.kind, KIND_TONE[a.kind] || 'gray'),
    h('div', { style: 'min-width:0;display:grid;gap:2px' },
      h('div.what', href ? h('a', { href }, a.what) : a.what),
      h('div.why', [a.amount ? `${a.amount} · ` : '', a.openedBy ? `opened by ${cx.name(a.openedBy)} · ` : '', fmt.agoLong(a.openedAt), a.expires ? ` · expires ${a.expires.length > 10 ? fmt.datetime(a.expires) : fmt.date(a.expires)}` : ''].join('')),
      h('div.why', showWho ? `Waits for ${a.waitsFor.map(cx.name).join(' or ')}: ${a.because}` : (a.waitsFor || []).includes(cx.meId()) ? `Yours: ${/^(wears|holds)/.test(a.because) ? 'it waits for whoever ' + a.because : a.because}` : a.because),
      a.command ? h('code', '$ ' + a.command) : null),
    h('div.act', actionFor(a)));
}
function standing(id = cx.meId()) {
  const p = cx.person(id);
  const budgets = [...D.departments.filter((d) => cx.holds(d.id, id)).map((d) => d.name), ...D.allowances.filter((a) => cx.holders(a.id).includes(id)).map((a) => a.name + ' allowance')];
  return { role: directors().includes(id) ? 'Director' : p?.seat || p?.seatMember ? 'Member' : 'No seat', hats: p?.hats || [], budgets, director: directors().includes(id), people: cx.wears('People', id), books: cx.wears('Books', id), invoicing: cx.wears('Invoicing', id) };
}
cx.route('approvals', () => {
  const me = cx.meId();
  const kinds = ['Money', 'Board', 'HR', 'Banking', 'People'];
  let filt = cx.store.get('approvals-kinds', []);
  const listMine = h('div');
  const listOthers = h('div');
  const chipbar = h('div.gv-chipbar');
  const pass = (a) => !filt.length || filt.includes(a.kind);
  const draw = () => {
    cx.fill(chipbar, kinds.map((k) => h('button', { type: 'button', 'aria-pressed': String(filt.includes(k)), onclick: () => { filt = filt.includes(k) ? filt.filter((x) => x !== k) : [...filt, k]; cx.store.set('approvals-kinds', filt); draw(); } }, `${k} · ${D.approvals.waiting.filter((a) => a.kind === k).length}`)), filt.length ? h('button', { type: 'button', onclick: () => { filt = []; cx.store.set('approvals-kinds', filt); draw(); } }, 'Clear') : null);
    const mine = D.approvals.waiting.filter((a) => (a.waitsFor || []).includes(me) && pass(a));
    cx.fill(listMine, mine.length ? h('ul.gv-wait', mine.map((a) => waitItem(a))) : cx.empty('Nothing waits for you.'));
    const groups = new Map();
    for (const a of D.approvals.waiting.filter((x) => pass(x) && !(x.waitsFor || []).includes(me))) { const k = a.waitsFor.map(cx.name).join(' or '); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
    cx.fill(listOthers, groups.size ? [...groups.entries()].map(([who, items]) => h('div', h('div.gv-who', who), h('ul.gv-wait', items.map((a) => waitItem(a, { showWho: true }))))) : cx.empty('Nothing else is waiting.'));
  };
  draw();
  const st = standing(me);
  const recent = (D.approvals.recent || []).slice(0, 40);
  const doneTab = () => cx.card({ flush: true, cmd: 'capxul payment wait <approval>', body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Signed'), h('th', 'Signer'), h('th', 'Hat'), h('th.opt', 'Opened'), h('th', 'Status'), h('th.opt', 'Approval'))), h('tbody', recent.map((a) => h('tr', h('td', fmt.datetime(a.signedAt)), h('td', cx.personChip(a.signer)), h('td', cx.hat(a.hat)), h('td.opt', fmt.datetime(a.openedAt)), h('td', cx.pill(a.status, 'green')), h('td.opt.mono', { style: 'font-size:12px' }, a.id.slice(0, 18) + '…')))))) });
  return cx.page({
    title: 'Approvals',
    actions: [cx.btn('Ask the FDE', { icon: 'fde', onClick: () => cx.fde.open({ ask: "What's waiting for me, and what should I do first?" }) })],
    cmd: { cli: [`capxul org proposal list ${ORG} --status waiting`, `capxul org hr leave list ${ORG} --status open`, `capxul bank deposits ${ORG} --unmatched`, `capxul org me ${ORG}`], note: 'Approvals has no single command (a gap the book records): each row shows its own.' },
    body: [
      h('div.grid.side',
        h('div', { style: 'display:grid;gap:12px;min-width:0' }, chipbar, tabsV([
          { label: 'Waiting for you', count: mineWaiting().length, render: () => cx.card({ flush: true, body: listMine }) },
          { label: 'Waiting for others', count: D.approvals.waiting.filter((a) => !(a.waitsFor || []).includes(me)).length, render: () => cx.card({ flush: true, body: listOthers }) },
          { label: 'Done', count: recent.length, render: doneTab },
        ], { key: 'approvals' })),
        cx.card({ title: 'Your standing', cmd: `capxul org me ${ORG}`, body: h('div', { style: 'display:grid;gap:10px' },
          h('div', { style: 'display:flex;gap:10px;align-items:center' }, cx.avatar(me), h('div', h('b', cx.name(me)), h('div.muted', { style: 'font-size:12.5px' }, st.role))),
          cx.kv([
            ['Hats', st.hats.length ? h('span.chips', st.hats.map((x) => cx.hat(x))) : 'none'],
            ['Can spend from', st.budgets.join(', ') || 'no budget'],
            ['Director', st.director ? `yes: ${B.threshold} of ${B.directors.length} approve changes` : 'no'],
            ['Manage people', st.people ? 'yes (People)' : 'no'],
            ['Books', st.books ? 'yes' : 'no'],
          ]),
          h('p.mx-note', { style: 'font-size:12.5px;color:var(--muted)' }, 'An item that waits for a hat shows every current wearer, so a swap changes who sees it at once.')) })),
    ],
  });
}, { workspace: 'approvals', title: 'Approvals' });

/* =====================================================================================================
   The Board
   ===================================================================================================== */

const OFFICER = { books: { name: 'Books', what: 'the chart, assets, annotations, bank details (with a Director)', permission: 'manage-books' }, invoicing: { name: 'Invoicing', what: 'requests, services, bank matches, the Organization\'s keys', permission: 'issue-invoices' }, people: { name: 'People', what: 'invitations and seats, the contact book and CRM, HR records, projects', permission: 'manage-people' } };
const wearersNow = (k) => (D.officerHats[k] || []).filter((x) => !x.to || x.to > cx.today).map((x) => x.who);
function grantHat(kind, revoke) {
  const seated = S.members.filter((m) => m.kind === 'Person' && m.status === 'Active');
  const model = { who: '', hat: kind || 'books', note: '' };
  const cmdOf = () => `capxul org member ${revoke ? 'revoke' : 'grant'} ${cx.person(model.who)?.companyEmail || cx.person(model.who)?.email || '<email>'} --permission ${OFFICER[model.hat].permission}${model.note ? ` --note ${JSON.stringify(model.note)}` : ''} ${ORG}`;
  const err = h('div', { style: 'color:var(--neg);font-size:12.5px' });
  const opts = () => (revoke ? wearersNow(model.hat) : seated.map((m) => m.id).filter((id) => !wearersNow(model.hat).includes(id)));
  const whoField = h('div');
  const drawWho = () => cx.fill(whoField, cx.field({ label: 'Member', type: 'select', edit: true, model, key: 'who', options: [['', 'Choose'], ...opts().map((id) => [id, cx.name(id)])], onChange: () => cx.showAction(cmdOf(), revoke ? 'Revoke' : 'Grant', { pin: true }) }));
  drawWho();
  cx.modal({ title: revoke ? 'Revoke an officer hat' : 'Grant an officer hat', body: h('div', { style: 'display:grid;gap:10px' },
    h('div.fields', { style: { '--cols': 2 } }, cx.field({ label: 'Hat', type: 'select', edit: true, model, key: 'hat', options: Object.entries(OFFICER).map(([k, v]) => [k, v.name]), onChange: () => { model.who = ''; drawWho(); } }), whoField, cx.field({ label: 'Note for the Directors', edit: true, model, key: 'note', wide: true })), err,
    h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'Officer hats carry no money: they are Capxul\'s own permissions. The Board grants and revokes them by proposal.')),
  actions: [{ label: 'Back' }, { label: 'Propose to the Board', primary: true, needs: () => isDirector() || 'Only Directors propose to the Board.', cmd: cmdOf(), onClick: async (close) => {
    if (!model.who) { err.textContent = 'Choose a member.'; return; }
    if (!revoke && model.hat === 'people' && D.departments.some((d) => cx.holders(d.id).includes(model.who))) { err.textContent = `ROLE_CONFLICT · ${cx.name(model.who)} holds a department, so cannot wear People while they do.`; return; }
    close();
    await boardAsk({ title: `${revoke ? 'Revoke' : 'Grant'} ${OFFICER[model.hat].name} ${revoke ? 'from' : 'to'} ${cx.name(model.who)}`, calls: [`Hats.${revoke ? 'burn' : 'mint'}(${OFFICER[model.hat].name}, ${cx.name(model.who)})`], note: model.note || null, cmd: cmdOf() });
  } }] });
}
cx.route('board', () => {
  const waiting = B.proposals.filter((p) => p.status === 'Waiting');
  const dirRows = B.directors.map((d) => {
    const p = cx.person(d.who);
    return h('tr', h('td', cx.personChip(d.who), d.who === cx.meId() ? h('span.muted', ' (you)') : null, p?.role ? h('div.muted', { style: 'font-size:12px' }, p.role) : null), h('td', cx.addr(p?.safe || '')), h('td', d.signs ? 'Yes' : 'No'), h('td.opt', d.seatClass), h('td.opt.wrap', d.electedBy), h('td', fmt.date(d.termEnds)));
  });
  const hist = [
    ...B.thresholdHistory.map((t) => ({ at: t.from + 'T09:00:00Z', kind: 'change', text: t.threshold === 1 ? 'Board set up with the founder as the only Director; threshold 1' : `Threshold ${t.threshold - 1} → ${t.threshold}` })),
    ...B.directors.filter((d) => d.from > '2025-05-01').map((d) => ({ at: d.from + 'T09:01:00Z', who: d.who, kind: 'approval', text: `was seated as a Director (${d.electedBy.split(';')[0]})` })),
    { at: B.handover + 'T12:00:00Z', kind: 'status', text: 'Equity handed over to the shareholders\' vote: Directors are now elected by the shareholders' },
    ...Object.entries(D.officerHats).flatMap(([k, arr]) => arr.map((x) => ({ at: x.from + 'T09:30:00Z', who: x.who, kind: 'link', text: `wears the ${OFFICER[k].name} hat${x.to ? ' until ' + fmt.date(x.to) : ''}` }))),
  ];
  return cx.page({
    title: 'Board', sub: `${B.directors.length} Directors · ${B.threshold} of ${B.directors.length} approve every Board proposal`,
    actions: [cx.btn('Grant an officer hat', { icon: 'hat', needs: () => isDirector() || 'Only Directors propose to the Board.', cmd: `capxul org member grant <email> --permission manage-books ${ORG}`, onClick: () => grantHat('books') }), cx.btn('Proposals', { kind: 'primary', icon: 'list', href: ['proposals'], cmd: `capxul org proposal list ${ORG} --status waiting` })],
    cmd: { cli: `capxul org board show ${ORG}`, sdk: 'client.org(orgId).board.get()', json: { safe: T.address, directors: B.directors.map((d) => ({ who: cx.person(d.who)?.companyEmail || cx.person(d.who)?.email, safe: safeOf(d.who), signs: d.signs, termEnds: d.termEnds })), threshold: B.threshold, nonce: B.nextNonce, waiting: waiting.length, handedOver: B.handover } },
    body: [
      cx.card({ title: 'Directors', flush: true, cmd: `capxul org board show ${ORG}`, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Director'), h('th', 'Safe'), h('th', 'Signs Board proposals'), h('th.opt', 'Seat'), h('th.opt', 'Elected by'), h('th', 'Term ends'))), h('tbody', dirRows))) }),
      h('div.grid.c2',
        cx.card({ title: 'Threshold', body: h('div', { style: 'display:grid;gap:8px' }, h('div', { style: 'font:600 22px var(--font-ui)' }, `${B.threshold} of ${B.directors.length}`), h('p', 'Directors must approve every Board proposal.'), h('p', { style: 'font-size:12.5px;color:var(--muted)' }, `Changed by the shareholders' vote since the equity handover on ${fmt.date(B.handover)}. Before it, the founder's Safe set it.`)) }),
        cx.card({ title: 'Treasury', cmd: `capxul org director list ${ORG}`, body: cx.kv([['Address', cx.addr(T.address)], ['Next nonce', String(B.nextNonce)], ['Proposals waiting', waiting.length ? h('span', waiting.map((p, i) => [i ? ', ' : '', cx.link(p.id, 'proposal', p.id)])) : 'none'], ['Reserve Safe', cx.addr(D.money.safes.reserve.address)]]) })),
      cx.card({ title: 'Officer hats', flush: true, actions: h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, cx.btn('Grant', { sm: true, needs: () => isDirector() || 'Only Directors.', cmd: `capxul org member grant <email> --permission <permission> ${ORG}`, onClick: () => grantHat('books') }), cx.btn('Revoke', { sm: true, needs: () => isDirector() || 'Only Directors.', cmd: `capxul org member revoke <email> --permission <permission> ${ORG}`, onClick: () => grantHat('books', true) })), body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Hat'), h('th', 'What it lets you do'), h('th', 'Worn by'))), h('tbody', Object.entries(OFFICER).map(([k, v]) => h('tr', h('td', cx.hat(v.name)), h('td.wrap', v.what), h('td', h('div.chips', wearersNow(k).map((w) => cx.personChip(w)))))))) ) }),
      cx.card({ title: 'History', body: cx.timeline(hist) }),
    ],
  });
}, { workspace: 'board', title: 'Board' });

/* proposals */
cx.route('proposals', () => {
  const list = cx.listView({
    key: 'proposals', rows: () => B.proposals, id: (p) => p.id, noun: 'proposal', showId: true,
    titleCol: { key: 'title', label: 'Proposal', sub: (p) => `${p.id} · ${p.calls.length} call${p.calls.length > 1 ? 's' : ''}` },
    status: (p) => spPill(p),
    columns: [
      { key: 'nonce', label: 'Nonce', type: 'int' },
      { key: 'kind', label: 'Kind' },
      { key: 'note', label: 'Note' },
      { key: 'proposedBy', label: 'Proposed by', type: 'person' },
      { key: 'approvals', label: 'Approvals', get: (p) => `${p.approvals.length} of ${p.threshold}` },
    ],
    right: { key: 'createdAt', label: 'When', type: 'date' },
    filters: [{ key: 'title', label: 'Proposal' }, { key: 'kind', label: 'Kind', type: 'select', options: ['Transaction', 'Rejection', 'Scheduled payment'] }, { key: 'proposedBy', label: 'Proposed by', type: 'select', options: directors().map((d) => [d, cx.name(d)]) }],
    tabs: [{ label: 'Waiting', filter: (p) => p.status === 'Waiting' }, { label: 'Executed', filter: (p) => p.status === 'Executed' }, { label: 'Rejected', filter: (p) => p.status === 'Rejected' }, { label: 'Replaced', filter: (p) => p.status === 'Replaced' }, { label: 'All' }],
    sort: { options: [{ key: 'nonce', label: 'Nonce' }, { key: 'createdAt', label: 'Created' }], default: { key: 'nonce', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'proposedBy', label: 'Proposed by', type: 'person' }, { key: 'kind', label: 'Kind' }],
    href: (p) => ['proposal', p.id],
    cmd: (st) => ({ cli: `capxul org proposal list ${ORG}${['--status waiting', '--status executed', '--status rejected', '--status replaced', ''][st.tab] ? ' ' + ['--status waiting', '--status executed', '--status rejected', '--status replaced', ''][st.tab] : ''}`, sdk: `client.org(orgId).proposals.list({ status: "${['waiting', 'executed', 'rejected', 'replaced', 'all'][st.tab]}" })` }),
  });
  return cx.page({ title: 'Board proposals', crumbs: [{ label: 'Board and equity', route: 'board' }], actions: [cx.menu('New proposal', [
    { label: 'Grant an officer hat', icon: 'hat', needs: () => isDirector() || 'Only Directors.', cmd: `capxul org member grant <email> --permission <permission> ${ORG}`, onClick: () => grantHat('books') },
    { label: 'Pay from the Treasury', icon: 'send', needs: () => isDirector() || 'Only Directors.', cmd: `capxul payment send <to> <amount> ${ORG} --as-directors`, onClick: () => cx.go('send-money', null, { from: 'board' }) },
    { label: 'Change a top department\'s budget', icon: 'departments', href: ['departments'] },
    { label: 'Set the payout ceiling', icon: 'shield', href: ['payout-ceilings'] },
  ], { kind: 'primary' })], body: list });
}, { workspace: 'board', title: 'Board proposals' });

/* proposal */
const CONTRACTS = { Budgets: '0x3B1e0aD5c3f2B7e94a1C8d6F05e7b2A9c41D7e20', Roles: '0x6aF04C1d9E3b8a2F7c5D06e1B93a4c8E2f0D5b71', Hats: '0x3bc1A0Ad72417f2d411118085256fC53CBdDd137', Safe: T.address, 'Reserve Safe': D.money.safes.reserve.address, Equity: '0x9C2e7B5a1D4f8E03c6A9b2D7e5F1a4C8b3E6d90F', Options: '0x9C2e7B5a1D4f8E03c6A9b2D7e5F1a4C8b3E6d90F' };
function callTarget(c) { const k = Object.keys(CONTRACTS).find((x) => c.startsWith(x)); return k ? [k, CONTRACTS[k]] : ['Safe', T.address]; }
cx.route('proposal', (ctx) => {
  const sp = cx.find(B.proposals, 'id', ctx.id);
  if (!sp) return cx.page({ title: 'Not found', body: cx.empty('No such proposal', cx.btn('Proposals', { href: ['proposals'] })) });
  const dir = isDirector();
  const approved = sp.approvals.some((a) => a.who === cx.meId());
  const raw = h('pre.raw', { hidden: true }, JSON.stringify(sp.calls.map((c) => { const [, to] = callTarget(c); return { to, value: '0', data: hexOf(c, 136), operation: 0 }; }), null, 2));
  const target = sp.ref?.type === 'proposal' ? B.proposals.find((x) => x.id === sp.ref.id) : null;
  const sections = [
    { label: 'What it does', node: h('div', { style: 'display:grid;gap:10px' }, h('p', sp.title + '.'), h('ol.gv-calls', sp.calls.map((c) => { const [k, to] = callTarget(c); return h('li', h('span', c, h('span', { style: 'color:var(--faint)' }, ` → ${k} ${fmt.addr(to)}`))); })), h('div', cx.btn('Raw', { sm: true, onClick: () => { raw.hidden = !raw.hidden; } })), raw) },
    sp.note || sp.why ? { label: 'Note', fields: [{ label: 'Note', value: sp.note, wide: true }, { label: 'Why the Board', value: sp.why || 'It moves the Treasury\'s money or authority, which only the Board can.', wide: true }] } : null,
    { label: 'Approvals', node: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Director'), h('th', 'Approved'), h('th.opt', 'From'))), h('tbody', sp.directors.map((d) => { const a = sp.approvals.find((x) => x.who === d); return h('tr', h('td', cx.personChip(d)), h('td', a ? h('span', cx.pill('Approved', 'green'), ' ', fmt.datetime(a.at)) : h('span.muted', 'not yet')), h('td.opt', cx.addr(safeOf(d)))); }))), sp.status === 'Waiting' ? h('p', { style: 'padding:8px 0 0;font-size:13px' }, sp.threshold - sp.approvals.length === 1 ? 'The next approval executes it.' : `${sp.threshold - sp.approvals.length} more approvals execute it.`) : null) },
    { label: 'Details', fields: [{ label: 'Proposal ID', value: sp.id, type: 'mono' }, { label: 'Nonce', value: String(sp.nonce) }, { label: 'Kind', value: sp.kind }, { label: 'Safe transaction hash', render: () => cx.hashChip(sp.safeTxHash) }, { label: 'Proposed by', render: () => h('span', cx.personChip(sp.proposedBy), h('span.muted', ` from Safe ${fmt.addr(safeOf(sp.proposedBy))}`)) }, { label: 'Created', value: fmt.datetime(sp.createdAt) }, { label: 'Threshold', value: `${sp.threshold} of ${sp.directors.length}` }, target ? { label: 'Rejects', render: () => cx.link(target.id, 'proposal', target.id) } : null].filter(Boolean) },
    sp.status === 'Executed' ? { label: 'Execution', fields: [{ label: 'Executed', value: fmt.datetime(sp.executedAt) }, { label: 'Transaction', render: () => (sp.executionTx ? cx.tx(sp.executionTx) : h('span.faint', '—')) }, { label: 'Block', value: sp.executionBlock ? fmt.int(sp.executionBlock) : null }] } : null,
  ].filter(Boolean);
  const tl = [{ at: sp.createdAt, who: sp.proposedBy, kind: 'created', text: `proposed it at nonce ${sp.nonce}` }, ...sp.approvals.map((a) => ({ at: a.at, who: a.who, kind: 'approval', text: 'approved it from their Safe' })), sp.executedAt ? { at: sp.executedAt, kind: 'submitted', text: `Executed at block ${fmt.int(sp.executionBlock)}` } : null].filter(Boolean);
  const actions = sp.status === 'Waiting' ? [
    cx.btn('Wait for it', { icon: 'clock', cmd: `capxul org proposal wait ${sp.id} ${ORG}`, onClick: () => cx.toast(`Waiting for ${sp.threshold - sp.approvals.length} more approval${sp.threshold - sp.approvals.length > 1 ? 's' : ''}.`, { cmd: `capxul org proposal wait ${sp.id}` }) }),
    sp.kind !== 'Rejection' ? cx.btn('Reject', { kind: 'danger', needs: () => dir || 'Only Directors.', cmd: `capxul org proposal reject ${sp.id} ${ORG}`, onClick: () => rejectProposal(sp) }) : null,
    cx.btn(approved ? 'Approved by you' : 'Approve', { kind: 'primary', icon: 'passkey', disabled: approved, reason: 'You approved it already.', needs: () => dir || "Only Directors approve. You're a member.", cmd: `capxul org proposal approve ${sp.id} ${ORG}`, onClick: () => approveProposal(sp) }),
  ].filter(Boolean) : [];
  return cx.page({
    title: sp.title, crumbs: [{ label: 'Board and equity', route: 'board' }, { label: 'Proposals', route: 'proposals' }],
    status: [spPill(sp, { lg: true })], sub: `${sp.id} · nonce ${sp.nonce} · proposed by ${cx.name(sp.proposedBy)} ${fmt.agoLong(sp.createdAt)}`,
    actions, banner: sp.status === 'Waiting' && !dir ? cx.banner("Only Directors approve. You're a member: you can read exactly what it does.", { tone: 'info' }) : null,
    cmd: { cli: `capxul org proposal get ${sp.id} ${ORG}`, sdk: `client.org(orgId).proposals.get("${sp.id}")`, json: { id: sp.id, nonce: sp.nonce, status: sp.status.toLowerCase(), safeTxHash: sp.safeTxHash, calls: sp.calls, approvals: sp.approvals.map((a) => a.who), threshold: sp.threshold } },
    fde: `Board proposal ${sp.id}: ${sp.title}`,
    body: formV({ doc: sp, tabKey: 'proposal', tabs: [{ label: 'Details', sections }], side: { id: sp.id, title: `Nonce ${sp.nonce}`, cmd: `capxul org proposal get ${sp.id}`, assigned: sp.directors.filter((d) => !sp.approvals.some((a) => a.who === d)), created: { by: sp.proposedBy, at: sp.createdAt }, modified: { by: sp.approvals.at(-1)?.who, at: sp.executedAt || sp.approvals.at(-1)?.at || sp.createdAt } }, timeline: { items: tl } }),
  });
}, { workspace: 'board', title: 'Board proposal' });

/* =====================================================================================================
   Equity: cap table, rounds, options, votes
   ===================================================================================================== */

const CT_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--t-teal)', 'var(--t-escrow)', 'var(--faint)'];
const optionsGranted = () => E.grants.filter((g) => g.status === 'Active').reduce((s, g) => s + g.shares, 0);
function capRows(diluted) {
  const holders = E.capTable.filter((r) => !['options', 'pool'].includes(r.id));
  const opt = optionsGranted();
  const pool = E.pool.reserved - opt;
  const issued = holders.reduce((s, r) => s + r.common + r.seed, 0);
  const total = diluted ? issued + opt + pool : issued;
  const rows = holders.map((r) => ({ ...r, asConverted: r.common + r.seed, share: (r.common + r.seed) / total }));
  if (diluted) rows.push({ id: 'options', name: `Options granted (${E.grants.filter((g) => g.status === 'Active').length} holders)`, member: null, common: 0, seed: 0, asConverted: opt, share: opt / total }, { id: 'pool', name: 'Pool not yet granted', member: null, common: 0, seed: 0, asConverted: pool, share: pool / total });
  return { rows, total, issued };
}
function exitPreview() {
  const model = { proceeds: 30000000 };
  const out = h('div');
  const pref = E.rounds.reduce((s, r) => s + r.raised, 0);
  const run = () => {
    const P = model.proceeds || 0;
    const { rows } = capRows(true);
    const shares = rows.filter((r) => r.id !== 'pool');
    const all = shares.reduce((s, r) => s + r.asConverted, 0);
    const seedShares = shares.reduce((s, r) => s + r.seed, 0);
    const convertEach = P / all;
    const prefPerSeed = pref / seedShares;
    const converts = convertEach >= prefPerSeed;
    const commonPool = converts ? P : Math.max(0, P - Math.min(P, pref));
    const commonShares = converts ? all : all - seedShares;
    const perCommon = commonShares ? commonPool / commonShares : 0;
    const payout = (r) => (converts ? r.asConverted * perCommon : r.seed ? Math.min(P, pref) * (r.seed / seedShares) + r.common * perCommon : r.asConverted * perCommon);
    cx.fill(out, h('div', { style: 'display:grid;gap:10px' },
      cx.kv([['Seed Preferred', converts ? `converts to Common: ${fmt.usd ? '' : ''}${fmt.num(convertEach, 4)} USDC a share beats its 1x preference (${fmt.num(prefPerSeed, 4)})` : `takes its 1x preference: ${fmt.usdc(Math.min(P, pref))}`], ['Per Common share', fmt.usdc(perCommon, 4)]]),
      h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Holder'), h('th.num', 'Shares'), h('th.num', 'Proceeds'))), h('tbody', shares.map((r) => h('tr', h('td', r.name), h('td.num', fmt.int(r.asConverted)), h('td.num', fmt.usdc(payout(r))))))))));
  };
  run();
  cx.modal({ title: 'Preview an exit', wide: true, body: h('div', { style: 'display:grid;gap:12px' }, cx.field({ label: 'Proceeds (USDC)', type: 'usdc', edit: true, model, key: 'proceeds', onChange: () => { run(); cx.showAction(`capxul org exit preview --proceeds ${model.proceeds} ${ORG}`, 'Preview an exit', { pin: true }); } }), out, h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'Options are shown as if exercised; their strike is ignored. A preview changes nothing.')), actions: [{ label: 'Close', primary: true }] });
}
function issueShares() {
  const model = { cls: 'Common', to: '', shares: 10000 };
  cx.modal({ title: 'Issue shares', body: h('div.fields', { style: { '--cols': 2 } }, cx.field({ label: 'Class', type: 'select', edit: true, model, key: 'cls', options: E.classes.map((c) => c.name) }), cx.field({ label: 'To (email or @handle)', edit: true, model, key: 'to' }), cx.field({ label: 'Shares', type: 'int', edit: true, model, key: 'shares' })),
    actions: [{ label: 'Back' }, { label: 'Propose to the Board', primary: true, needs: () => isDirector() || 'Only Directors.', cmd: `capxul org equity issue --class ${model.cls} --to <who> --shares <n> ${ORG}`, onClick: async (close) => { if (!model.to) return; close(); await boardAsk({ title: `Issue ${fmt.int(model.shares)} ${model.cls} to ${model.to}`, calls: [`Equity.issue(${model.cls}, ${model.to}, ${model.shares})`], cmd: `capxul org equity issue --class ${q(model.cls)} --to ${model.to} --shares ${model.shares} ${ORG}` }); } }] });
}
const q = (s) => (/\s/.test(s) ? `"${s}"` : s);
cx.route('cap-table', () => {
  let diluted = cx.store.get('cap-diluted', true);
  const box = h('div', { style: 'display:grid;gap:14px' });
  const draw = () => {
    const { rows, total } = capRows(diluted);
    cx.setCommand({ cli: `capxul org cap-table ${ORG}${diluted ? ' --fully-diluted' : ''}`, sdk: `client.org(orgId).equity.capTable({ fullyDiluted: ${diluted} })`, json: { at: cx.today, fullyDiluted: diluted, total, holders: rows.map((r) => ({ holder: r.name, common: r.common, seedPreferred: r.seed, asConverted: r.asConverted, percent: +(r.share * 100).toFixed(2) })) } });
    cx.fill(box,
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, h('div.btn-group', cx.btn('Issued', { sm: true, kind: diluted ? null : 'primary', onClick: () => { diluted = false; cx.store.set('cap-diluted', false); draw(); } }), cx.btn('Fully diluted', { sm: true, kind: diluted ? 'primary' : null, onClick: () => { diluted = true; cx.store.set('cap-diluted', true); draw(); } })), h('span', { style: 'color:var(--muted);font-size:13px' }, `as at ${fmt.date(cx.today)} · ${fmt.int(total)} shares`)),
      cx.card({ title: 'Ownership', body: h('div', h('div.gv-stack', rows.map((r, i) => h('i', { style: { width: (r.share * 100).toFixed(3) + '%', background: CT_COLORS[i % CT_COLORS.length] }, title: `${r.name}: ${pct(r.share * 100)}` }))), h('div.gv-legend', rows.map((r, i) => h('span', h('i', { style: { background: CT_COLORS[i % CT_COLORS.length] } }), `${r.name} ${pct(r.share * 100)}`)))) }),
      cx.card({ flush: true, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Holder'), h('th.opt', 'Member'), h('th.num', 'Common'), h('th.num', 'Seed Preferred'), h('th.num.opt', 'As converted'), h('th.num', diluted ? 'Fully diluted' : 'Issued'))),
        h('tbody', rows.map((r) => h('tr', { class: r.member === null ? 'group' : '' }, h('td.wrap', h('b', r.name), r.vesting ? h('div', { style: 'font-size:12px;color:var(--muted)' }, `vesting: ${fmt.int(r.vesting.vested)} vested of ${fmt.int(r.common)}`) : r.contact && r.contact !== r.name ? h('div', { style: 'font-size:12px;color:var(--muted)' }, r.contact) : null), h('td.opt', r.member === null ? '' : r.member ? 'yes' : 'no'), h('td.num', r.common ? fmt.int(r.common) : ''), h('td.num', r.seed ? fmt.int(r.seed) : ''), h('td.num.opt', fmt.int(r.asConverted)), h('td.num', pct(r.share * 100)))),
          h('tr.total', h('td', 'Total'), h('td.opt'), h('td.num', fmt.int(rows.reduce((s, r) => s + r.common, 0))), h('td.num', fmt.int(rows.reduce((s, r) => s + r.seed, 0))), h('td.num.opt', fmt.int(total)), h('td.num', '100%'))))) }),
      h('div.grid.c2', E.classes.map((c) => cx.card({ title: c.name, body: cx.kv([['Authorised', fmt.int(c.authorised)], ['Issued', fmt.int(c.issued)], ['Votes a share', String(c.votes)], ['Preference', c.preference || 'none']]) }))));
  };
  draw();
  return cx.page({
    title: 'Cap table', crumbs: [{ label: 'Board and equity', route: 'board' }],
    actions: [cx.btn('Preview an exit', { icon: 'chart', cmd: `capxul org exit preview --proceeds 30000000 ${ORG}`, onClick: exitPreview }), cx.btn('Issue shares', { kind: 'primary', icon: 'plus', needs: () => isDirector() || 'Only Directors (a Board proposal).', cmd: `capxul org equity issue --class Common --to <who> --shares <n> ${ORG}`, onClick: issueShares })],
    cmd: { cli: `capxul org cap-table ${ORG} --fully-diluted`, sdk: 'client.org(orgId).equity.capTable({ fullyDiluted: true })' },
    body: box,
  });
}, { workspace: 'board', title: 'Cap table' });

cx.route('rounds', () => {
  const rows = E.rounds.map((r) => h('tr.click', { onclick: () => cx.go('round', r.id) }, h('td', h('a', { href: cx.href('round', r.id) }, h('b', r.name)), h('div', { style: 'font-size:12px;color:var(--muted)' }, r.id)), h('td', r.kind === 'SAFE' ? 'SAFE' : `Priced, ${r.class}`), h('td.wrap', r.terms), h('td.num', `${fmt.num(r.raised, 2)} of ${fmt.num(r.target, 0)}`), h('td.wrap.opt', r.investments.map((i) => `${i.name} ${fmt.num(i.amount, 0)}`).join('; ')), h('td', cx.pill(r.converted ? `Closed · converted ${fmt.date(r.converted)}` : r.status, 'green')), h('td.opt', `${fmt.date(r.opened)} to ${fmt.date(r.closed)}`)));
  return cx.page({
    title: 'Rounds and SAFEs', crumbs: [{ label: 'Board and equity', route: 'board' }],
    actions: [cx.btn('New round', { kind: 'primary', icon: 'plus', needs: () => isDirector() || 'Only Directors.', cmd: `capxul org round create --class "Seed Preferred" --pre-money <n> --raise <n> --pay-by <day> --terms terms.pdf ${ORG}`, onClick: () => cx.toast('A new round starts with a Board proposal and a shareholder vote. The command is on the strip.', { tone: 'info', cmd: `capxul org round create --class "Series A Preferred" --pre-money 24000000 --raise 6000000 --pay-by 2027-06-30 --terms series-a-terms.pdf ${ORG}` }) })],
    cmd: { cli: [`capxul org round show rd_0002 ${ORG}`, `capxul org safe show rd_0001 ${ORG}`], note: 'No list command: each round shows on its own.' },
    body: [cx.card({ flush: true, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Round'), h('th', 'Kind'), h('th', 'Terms'), h('th.num', 'Raised (USDC)'), h('th.opt', 'Investors'), h('th', 'Status'), h('th.opt', 'Dates'))), h('tbody', rows))) }),
      cx.banner(`The rounds' money sits in the Reserve Safe (${fmt.usdc(D.money.safes.reserve.balance)}) and moves to the Treasury only by Board proposal.`, { tone: 'info' })],
  });
}, { workspace: 'board', title: 'Rounds and SAFEs' });
cx.route('round', (ctx) => {
  const r = cx.find(E.rounds, 'id', ctx.id);
  if (!r) return cx.page({ title: 'Not found', body: cx.empty('No such round', cx.btn('Rounds', { href: ['rounds'] })) });
  const safe = r.kind === 'SAFE';
  const seed = E.rounds.find((x) => x.kind !== 'SAFE');
  const sections = [
    { label: 'Terms', fields: [{ label: 'Kind', value: safe ? 'SAFE (simple agreement for future equity)' : `Priced round, ${r.class}` }, { label: 'Terms', value: r.terms, wide: true }, safe ? { label: 'Valuation cap', value: fmt.usdc(r.cap, 0) } : { label: 'Pre-money', value: fmt.usdc(r.preMoney, 0) }, safe ? { label: 'Discount', value: 'none' } : { label: 'Price a share', value: `${r.price} USDC` }, { label: 'Target', value: fmt.usdc(r.target, 0) }, { label: 'Raised', value: fmt.usdc(r.raised, 0) }, r.lead ? { label: 'Lead', value: r.lead } : null, { label: 'Terms document', render: () => h('span', cx.hashChip(r.termsHash), h('span', { style: 'color:var(--muted);font-size:12px' }, ' matches the signed copy')) }].filter(Boolean) },
    { label: 'Investors', node: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Investor'), h('th.opt', 'Committed'), h('th', 'Paid'), h('th.num', 'Amount (USDC)'), h('th.num', 'Shares'), h('th', 'Status'), h('th.opt', 'Payment'))), h('tbody', r.investments.map((i) => h('tr', h('td', h('b', i.name)), h('td.opt', fmt.date(i.committedAt)), h('td', fmt.date(i.paidAt)), h('td.num', fmt.num(i.amount, 2)), h('td.num', fmt.int(i.shares)), h('td', cx.pill(i.status, 'green')), h('td.opt', i.payment ? cx.link('payment and proof', 'payment', i.payment) : '—')))))) },
    safe && r.converted ? { label: 'Conversion', fields: [{ label: 'Converted', value: fmt.date(r.converted) }, { label: 'Into', value: `Seed Preferred, at the seed round (${seed?.id})` }, { label: 'Shares', value: fmt.int(r.investments.reduce((s, i) => s + (i.shares || 0), 0)) }, { label: 'Price', value: `${fmt.num(r.cap / 10810811, 4)} USDC a share (cap ÷ fully diluted)` }] } : null,
    { label: 'Where the money is', fields: [{ label: 'Paid into', render: () => cx.link('Reserve Safe', 'reserve') }, { label: 'Moves by', value: 'Board proposal only' }] },
  ].filter(Boolean);
  return cx.page({
    title: r.name, crumbs: [{ label: 'Board and equity', route: 'board' }, { label: 'Rounds and SAFEs', route: 'rounds' }],
    status: [cx.pill(r.converted ? 'Closed · converted' : r.status, 'green', { lg: true })], sub: `${r.id} · ${fmt.date(r.opened)} to ${fmt.date(r.closed)} · ${fmt.usdc(r.raised, 0)} raised`,
    actions: [cx.btn('Close', { disabled: true, reason: 'It is closed already.', cmd: `capxul org ${safe ? 'safe' : 'round'} close ${r.id} ${ORG}` })],
    cmd: { cli: `capxul org ${safe ? 'safe' : 'round'} show ${r.id} ${ORG}`, sdk: `client.org(orgId).${safe ? 'safes' : 'rounds'}.show("${r.id}")`, json: { id: r.id, name: r.name, kind: r.kind, raised: String(r.raised), status: r.status.toLowerCase(), termsHash: r.termsHash, investments: r.investments.map((i) => ({ investor: i.name, amount: String(i.amount), shares: i.shares, status: i.status.toLowerCase() })) } },
    body: formV({ doc: r, tabKey: 'round', tabs: [{ label: 'Details', sections }], side: { id: r.id, title: r.name, cmd: `capxul org ${safe ? 'safe' : 'round'} show ${r.id}`, tags: [r.kind, r.class || 'SAFE'], created: { by: 'maya', at: r.opened + 'T09:00:00Z' } }, timeline: { items: [{ at: r.opened + 'T09:00:00Z', who: 'maya', kind: 'created', text: `opened ${r.name}` }, ...r.investments.map((i) => ({ at: i.paidAt + 'T15:00:00Z', kind: 'money', text: `${i.name} paid ${fmt.usdc(i.amount, 0)}`, href: i.payment ? ['payment', i.payment] : null })), { at: r.closed + 'T17:00:00Z', kind: 'status', text: 'Closed' }, r.converted ? { at: r.converted + 'T12:00:00Z', kind: 'change', text: 'Converted into Seed Preferred' } : null].filter(Boolean) } }),
  });
}, { workspace: 'board', title: 'Round' });

function grantOptions() {
  const model = { to: '', shares: 40000, strike: 0.25, start: '2026-12-01' };
  const cmdOf = () => `capxul org options grant --to ${model.to || '<email>'} --shares ${model.shares} --strike ${model.strike} --agreement option-agreement.pdf --vest 4y --cliff 1y --start ${model.start} ${ORG}`;
  cx.modal({ title: 'Grant options', body: h('div', { style: 'display:grid;gap:10px' }, h('div.fields', { style: { '--cols': 2 } }, cx.field({ label: 'To (email)', edit: true, model, key: 'to', placeholder: 'owen.grady@gmail.com' }), cx.field({ label: 'Shares', type: 'int', edit: true, model, key: 'shares' }), cx.field({ label: 'Strike (USDC)', type: 'float', edit: true, model, key: 'strike' }), cx.field({ label: 'Vesting starts', type: 'date', edit: true, model, key: 'start' })), h('p', { style: 'font-size:12.5px;color:var(--muted)' }, `4 years, 1-year cliff. The pool has ${fmt.int(E.pool.reserved - optionsGranted())} left.`)),
    actions: [{ label: 'Back' }, { label: 'Propose to the Board', primary: true, needs: () => isDirector() || 'Only Directors.', cmd: cmdOf(), onClick: async (close) => { if (!model.to) return; if (model.shares > E.pool.reserved - optionsGranted()) { cx.toast('The pool has too few options left. Vote vt_0005 would add 1,000,000.', { tone: 'warning' }); return; } close(); await boardAsk({ title: `Grant ${fmt.int(model.shares)} options to ${model.to}`, calls: [`Options.grant(${model.to}, ${model.shares}, strike ${model.strike}, 4y/1y from ${model.start})`], cmd: cmdOf() }); } }] });
}
cx.route('options', () => {
  const pool = E.pool;
  const granted = optionsGranted();
  const left = pool.reserved - granted;
  const grants = [...E.grants].sort((a, b) => a.start.localeCompare(b.start));
  const table = cx.listView({
    key: 'option-grants', rows: () => grants, id: (g) => g.id, noun: 'grant', showId: true,
    titleCol: { key: 'name', label: 'Grantee', sub: (g) => `${g.vesting} from ${fmt.date(g.start)}` },
    status: (g) => ({ text: g.status === 'Ended' ? `Ended ${fmt.date(g.ended)}` : g.status, tone: g.status === 'Active' ? 'green' : 'muted' }),
    columns: [
      { key: 'shares', label: 'Shares', type: 'int' },
      { key: 'strike', label: 'Strike', render: (g) => `${fmt.num(g.strike, 2)} USDC` },
      { key: 'cliff', label: 'Cliff', type: 'date' },
      { key: 'vested', label: 'Vested', render: (g) => h('div', { style: 'display:grid;gap:3px' }, h('span', g.vested ? fmt.int(g.vested) : g.status === 'Ended' ? `0 · ${fmt.int(g.shares)} back to the pool` : `0 (cliff ${fmt.date(g.cliff)})`), h('div.gv-vest', h('i', { style: { width: ((g.vested / g.shares) * 100).toFixed(1) + '%' } }))) },
      { key: 'exercised', label: 'Exercised', type: 'int' },
    ],
    right: { key: 'value', label: 'Agreement', render: (g) => cx.hashChip(g.agreementHash) },
    filters: [{ key: 'name', label: 'Grantee' }, { key: 'status', label: 'Status', type: 'select' }],
    tabs: [{ label: 'All' }, { label: 'Active', filter: (g) => g.status === 'Active' }, { label: 'Ended', filter: (g) => g.status !== 'Active' }],
    sort: { options: [{ key: 'start', label: 'Start' }, { key: 'shares', label: 'Shares' }], default: { key: 'start', dir: 'asc' } },
    onOpen: (g) => grantPanel(g),
    cmd: { cli: `capxul org options show ${ORG}`, sdk: 'client.org(orgId).options.show()' },
  });
  return cx.page({
    title: 'Options', crumbs: [{ label: 'Board and equity', route: 'board' }],
    actions: [cx.btn('Grant options', { kind: 'primary', icon: 'plus', needs: () => isDirector() || 'Only Directors (a Board proposal).', cmd: `capxul org options grant --to <email> --shares <n> --strike <n> --agreement option-agreement.pdf --vest 4y --cliff 1y --start <day> ${ORG}`, onClick: grantOptions })],
    cmd: { cli: `capxul org options show ${ORG}`, sdk: 'client.org(orgId).options.show()' },
    body: [
      h('div.ncards', cx.numberCard({ label: 'Pool reserved', value: fmt.int(pool.reserved) }), cx.numberCard({ label: 'Granted and active', value: fmt.int(granted), sub: `${E.grants.filter((g) => g.status === 'Active').length} holders` }), cx.numberCard({ label: 'Left to grant', value: fmt.int(left) }), cx.numberCard({ label: 'Top-up proposed', value: fmt.int(pool.topUpProposed), sub: h('span', 'by vote ', cx.link(pool.topUpVote, 'vote', pool.topUpVote)), href: ['vote', pool.topUpVote] })),
      table,
      h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'A grantee\'s side: capxul shares shows their shares, waiting grants, options vested and exercised; capxul shares exercise <grant> exercises them.'),
    ],
  });
}, { workspace: 'board', title: 'Options' });
function grantPanel(g) {
  const months = []; const start = new Date(g.start + 'T00:00:00Z');
  for (let i = 0; i <= 48; i += 3) { const d = new Date(start); d.setUTCMonth(d.getUTCMonth() + i); months.push({ label: fmt.monthShort(d.toISOString().slice(0, 7)) + ' ' + d.toISOString().slice(2, 4), v: g.status === 'Ended' && d.toISOString().slice(0, 10) > g.ended ? null : i < 12 ? 0 : Math.round((g.shares * i) / 48) }); }
  cx.panel.open({ title: `${g.name} · ${fmt.int(g.shares)} options`, sub: `${g.id} · strike ${g.strike} USDC · ${g.vesting} from ${fmt.date(g.start)}`, body: h('div', { style: 'display:grid;gap:12px' },
    cx.kv([['Grantee', cx.personChip(g.grantee)], ['Status', g.status === 'Ended' ? `Ended ${fmt.date(g.ended)}: ${fmt.int(g.shares)} back to the pool` : 'Active'], ['Vested today', fmt.int(g.vested)], ['Cliff', fmt.date(g.cliff)], ['Exercised', fmt.int(g.exercised)], ['Agreement', cx.hashChip(g.agreementHash)]]),
    cx.chart.line({ labels: months.map((m) => m.label), series: [{ name: 'Vested', values: months.map((m) => m.v ?? 0) }], area: true, height: 180, format: (v) => fmt.compact(v), tipFormat: (v) => fmt.int(v) + ' vested' }),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, cx.btn('End this grant', { kind: 'danger', disabled: g.status !== 'Active', reason: 'It has ended.', needs: () => isDirector() || 'Only Directors.', cmd: `capxul org options end ${g.id} ${ORG}`, onClick: () => { cx.panel.close(); boardAsk({ title: `End ${g.name}'s option grant (${fmt.int(g.shares - g.vested)} unvested back to the pool)`, calls: [`Options.end(${g.id})`], cmd: `capxul org options end ${g.id} ${ORG}` }); } }))) });
}

/* votes */
const VOTE_TONE = { Voting: 'orange', Proposed: 'blue', Executed: 'green', Lapsed: 'muted', Failed: 'red', Proposing: 'blue' };
const SHAREHOLDER_OF = { maya: 'maya', tom: 'tom', ruth: 'northbank' };
function castVote(v) {
  if (!v) return;
  const holder = SHAREHOLDER_OF[cx.meId()];
  const row = holder && E.capTable.find((r) => r.id === holder);
  const weight = row ? row.common + row.seed : 0;
  const already = (v.castBy || []).some((c) => c[0] === cx.meId());
  if (!row) { cx.toast(`${cx.me().name} holds no shares, so has no vote.`, { tone: 'warning' }); return; }
  if (already) { cx.toast('You have voted on this already.', { tone: 'info' }); return; }
  const model = { choice: 'for', reason: '' };
  const cmdOf = () => `capxul vote cast ${v.id} --${model.choice}${model.reason ? ` --reason ${JSON.stringify(model.reason)}` : ''}`;
  cx.modal({ title: `Vote on ${v.id}`, body: h('div', { style: 'display:grid;gap:10px' }, h('p', h('b', v.title)), cx.kv([['You vote', `${fmt.int(weight)} shares${holder !== cx.meId() ? ` for ${row.name}` : ''}`], ['Closes', fmt.date(v.closes)]]), cx.field({ label: 'Your vote', type: 'select', edit: true, model, key: 'choice', options: [['for', 'For'], ['against', 'Against'], ['abstain', 'Abstain']], onChange: () => cx.showAction(cmdOf(), 'Vote', { pin: true }) }), cx.field({ label: 'Reason (optional)', edit: true, model, key: 'reason' })),
    actions: [{ label: 'Back' }, { label: 'Cast with passkey', primary: true, cmd: cmdOf(), onClick: async (close) => {
      close();
      const r = await cx.approval({ title: `Vote ${model.choice} on ${v.id}`, from: `${row.name} · ${fmt.int(weight)} shares`, to: v.title, signer: cx.meId(), cmd: cmdOf() });
      if (r.status !== 'done') return;
      v[model.choice] = (v[model.choice] || 0) + weight;
      (v.castBy ||= []).push([cx.meId(), weight, model.choice, r.at]);
      dropWaiting((a) => a.ref?.type === 'vote' && a.ref.id === v.id && a.waitsFor.length === 1 && a.waitsFor[0] === cx.meId());
      addEvent(`${cx.name(cx.meId())} voted ${model.choice} on ${v.id}`, { type: 'vote', id: v.id }, 'Equity');
      cx.toast(`Vote cast: ${model.choice}, ${fmt.int(weight)} shares.`, { tone: 'success', cmd: cmdOf() }); cx.refresh();
    } }] });
}
cx.route('votes', () => {
  const list = cx.listView({
    key: 'votes', rows: () => [...E.votes].reverse(), id: (v) => v.id, noun: 'vote', showId: true,
    titleCol: { key: 'title', label: 'Vote', sub: (v) => `${v.id} · ${v.matter}` },
    status: (v) => ({ text: v.status, tone: VOTE_TONE[v.status] }),
    columns: [{ key: 'opens', label: 'Opens', type: 'date' }, { key: 'closes', label: 'Closes', type: 'date' }, { key: 'for', label: 'For', type: 'int' }, { key: 'against', label: 'Against', type: 'int' }, { key: 'abstain', label: 'Abstain', type: 'int' }, { key: 'quorum', label: 'Quorum', render: (v) => `${v.quorum}%` }],
    right: { key: 'turnout', label: 'Turnout', render: (v) => pct(((v.for + v.against + v.abstain) / v.eligible) * 100, 1) },
    filters: [{ key: 'title', label: 'Vote' }, { key: 'status', label: 'Status', type: 'select' }, { key: 'matter', label: 'Matter', type: 'select' }],
    href: (v) => ['vote', v.id], cmd: { cli: `capxul org vote list ${ORG}`, sdk: 'client.org(orgId).votes.list()' },
  });
  return cx.page({ title: 'Shareholder votes', crumbs: [{ label: 'Board and equity', route: 'board' }], actions: [cx.btn('New vote', { kind: 'primary', icon: 'plus', needs: () => isDirector() || 'Only Directors.', cmd: `capxul org vote create authorise --class Common --authorised 21000000 --note "Pool top-up" ${ORG}`, onClick: () => cx.toast('A vote opens with a Board proposal; the command is on the strip.', { tone: 'info' }) })], body: list });
}, { workspace: 'board', title: 'Votes' });
cx.route('vote', (ctx) => {
  const v = cx.find(E.votes, 'id', ctx.id);
  if (!v) return cx.page({ title: 'Not found', body: cx.empty('No such vote', cx.btn('Votes', { href: ['votes'] })) });
  const cast = v.for + v.against + v.abstain;
  const bar = (label, n, color) => h('div.row', h('span', label), h('div.track', h('i', { style: { width: ((n / v.eligible) * 100).toFixed(2) + '%', background: color } })), h('span.num', `${fmt.int(n)} · ${pct((n / v.eligible) * 100, 1)}`));
  const voted = new Set((v.castBy || []).map((c) => c[0]));
  const holders = E.capTable.filter((r) => !['options', 'pool'].includes(r.id) && (v.matter === 'approve-round' || v.opens >= B.handover || r.common > 0));
  const who = Object.entries(SHAREHOLDER_OF).find(([, hId]) => hId);
  const notYet = holders.filter((r) => !voted.has(Object.keys(SHAREHOLDER_OF).find((k) => SHAREHOLDER_OF[k] === r.id) || r.id));
  const open = v.status === 'Voting';
  return cx.page({
    title: v.title, crumbs: [{ label: 'Board and equity', route: 'board' }, { label: 'Votes', route: 'votes' }],
    status: [cx.pill(v.status, VOTE_TONE[v.status], { lg: true })], sub: `${v.id} · ${v.matter} · ${fmt.date(v.opens)} to ${fmt.date(v.closes)}`,
    actions: open ? [cx.btn('Vote', { kind: 'primary', icon: 'passkey', needs: () => !!SHAREHOLDER_OF[cx.meId()] || 'Only shareholders vote.', cmd: `capxul vote cast ${v.id} --for`, onClick: () => castVote(v) })] : [],
    cmd: { cli: `capxul org vote show ${v.id} ${ORG}`, sdk: `client.org(orgId).votes.show("${v.id}")`, json: { id: v.id, matter: v.matter, status: v.status.toLowerCase(), opens: v.opens, closes: v.closes, tally: { for: v.for, against: v.against, abstain: v.abstain }, eligible: v.eligible, quorum: v.quorum } },
    body: [
      h('div.grid.c2',
        cx.card({ title: 'Tally', body: h('div', { style: 'display:grid;gap:10px' }, h('div.gv-tally', bar('For', v.for, 'var(--pos)'), bar('Against', v.against, 'var(--neg)'), bar('Abstain', v.abstain, 'var(--faint)')), h('p', { style: 'font-size:13px' }, `Turnout ${pct((cast / v.eligible) * 100, 1)} of ${fmt.int(v.eligible)} eligible shares; quorum ${v.quorum}%. ${cast / v.eligible >= v.quorum / 100 ? (v.for > v.against ? 'Quorum met; carried so far.' : 'Quorum met; not carried.') : 'Quorum not met yet.'}`)) }),
        cx.card({ title: 'The matter', body: cx.kv([['Matter', v.matter], ['Title', v.title], ['Opens', fmt.date(v.opens)], ['Closes', fmt.date(v.closes)], ['Eligible', `${fmt.int(v.eligible)} shares, one vote each`], v.id === E.pool.topUpVote ? ['If carried', `Common authorised grows by ${fmt.int(E.pool.topUpProposed)} for the option pool`] : null]) })),
      cx.card({ title: 'Ballots', flush: true, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Shareholder'), h('th.num', 'Shares'), h('th', 'Vote'), h('th', 'When'))), h('tbody', (v.castBy || []).map((c) => h('tr', h('td', cx.personChip(c[0])), h('td.num', fmt.int(c[1])), h('td', cx.pill(c[2], c[2] === 'for' ? 'green' : c[2] === 'against' ? 'red' : 'muted')), h('td', fmt.datetime(c[3])))), open ? notYet.map((r) => h('tr', h('td', r.name, h('span', { style: 'color:var(--muted)' }, ' · not voted yet')), h('td.num', fmt.int(r.common + r.seed)), h('td', h('span', { style: 'color:var(--faint)' }, '—')), h('td', ''))) : null))) }),
    ],
  });
}, { workspace: 'board', title: 'Vote' });

/* =====================================================================================================
   Seats, members, invitations, agents
   ===================================================================================================== */

const persons = () => S.members.filter((m) => m.kind === 'Person' && m.status === 'Active');
const seatsUsed = () => persons().length;
const offers = () => S.invitations.filter((i) => i.status === 'Pending').length;
function buySeats() {
  const budgets = (N().payableBudgets?.() || []).filter((b) => b === 'capxul' || !N().isAllowance?.(b) || b === 'subscriptions');
  const model = { n: 5, from: budgets.includes('capxul') ? 'capxul' : budgets[0] || '' };
  const cmdOf = () => `capxul org seats buy ${model.n} ${ORG} --from ${model.from || '<budget>'}`;
  const err = h('div', { style: 'color:var(--neg);font-size:12.5px' });
  const sum = h('div');
  const upd = () => { cx.fill(sum, cx.kv([['Price', `${S.price.toFixed(2)} USDC a seat, once`], ['Total', `${(S.price * (model.n || 0)).toFixed(2)} USDC`], ['Seats after', `${S.limit + (model.n || 0)}`], ['Left in the budget', model.from ? `${fmt.usdc(N().leftOf?.(model.from) ?? 0)}` : '—']])); cx.showAction(cmdOf(), 'Buy seats', { pin: true }); };
  upd();
  cx.modal({ title: 'Buy seats', body: h('div', { style: 'display:grid;gap:10px' }, h('div.fields', { style: { '--cols': 2 } }, cx.field({ label: 'Seats', type: 'int', edit: true, model, key: 'n', onChange: upd }), cx.field({ label: 'Pay from', type: 'select', edit: true, model, key: 'from', options: budgets.length ? budgets.map((b) => [b, cx.deptName(b)]) : [['', 'No budget you hold']], onChange: upd })), sum, err, h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'Seats are bought by a People-hat wearer from a budget whose hat they wear now. People paid by Harbourline don\'t need a seat.')),
    actions: [{ label: 'Back' }, { label: 'Review and approve', primary: true, needs: () => cx.wears('People') || 'Needs the People hat.', cmd: cmdOf(), onClick: async (close) => {
      if (!(model.n > 0)) { err.textContent = 'At least one seat.'; return; }
      if (!model.from) { err.textContent = `ROLE_PERMISSION_DENIED · ${cx.me().name} holds no budget to pay from. The Capxul allowance pays for seats.`; return; }
      const total = S.price * model.n;
      if (total > (N().leftOf?.(model.from) ?? 0)) { err.textContent = `PAYROLL_BUDGET_EXCEEDED · ${cx.deptName(model.from)} has ${fmt.usdc(N().leftOf(model.from))} left this month.`; return; }
      close();
      const p = await N().payFromBudget({ title: `Buy ${model.n} seats`, to: `Capxul · ${model.n} seats`, payee: N().CAPXUL_PAYEE, amount: total, budget: model.from, memo: `${model.n} seats`, cmd: cmdOf() });
      if (!p) return;
      S.purchases.push({ at: p.settledAt, seats: model.n, price: S.price, total, by: cx.meId(), from: model.from, payment: p.id, limitBefore: S.limit, limitAfter: S.limit + model.n });
      S.history.push({ from: cx.today, limit: S.limit + model.n, note: `Bought ${model.n} for ${fmt.usdc(total)}` });
      S.limit += model.n; S.bought += model.n;
      const u = S.usage.at(-1); if (u) u.limit = S.limit;
      cx.toast(`Bought ${model.n} seats. Harbourline has ${S.limit}.`, { tone: 'success', cmd: cmdOf() }); cx.refresh();
    } }] });
}
function invite() {
  const model = { email: '', kind: 'Person' };
  const err = h('div', { style: 'color:var(--neg);font-size:12.5px' });
  const cmdOf = () => `capxul org member invite ${model.email || '<email>'}${model.kind === 'Agent' ? ' --agent' : ''} ${ORG} --request-key …`;
  cx.modal({ title: 'Invite someone', body: h('div', { style: 'display:grid;gap:10px' }, h('div.fields', { style: { '--cols': 2 } }, cx.field({ label: 'Email or @handle', edit: true, model, key: 'email', onChange: () => cx.showAction(cmdOf(), 'Invite', { pin: true }) }), cx.field({ label: 'Kind', type: 'select', edit: true, model, key: 'kind', options: ['Person', 'Agent'] })), err, h('p', { style: 'font-size:12.5px;color:var(--muted)' }, `${seatsUsed()} of ${S.limit} seats in use, ${offers()} held for invitations. An agent rides on its owner's seat.`)),
    actions: [{ label: 'Back' }, { label: 'Preview', cmd: `capxul org member invite ${model.email || '<email>'} --preview ${ORG}`, onClick: () => { err.textContent = ''; cx.toast(model.kind === 'Agent' ? 'Preview: the agent rides on your seat; no seat used.' : seatsUsed() + offers() >= S.limit ? `SEAT_LIMIT_REACHED · All ${S.limit} seats are in use. Buy more seats (10.00 USDC each).` : `Preview: one seat held until they accept; ${S.limit - seatsUsed() - offers() - 1} left after.`, { tone: 'info', cmd: `capxul org member invite ${model.email} --preview` }); } }, { label: 'Send the invitation', primary: true, needs: () => cx.wears('People') || 'Needs the People hat.', cmd: cmdOf(), onClick: (close) => {
      if (!/@/.test(model.email)) { err.textContent = 'An email or an @handle.'; return; }
      if (model.kind === 'Person' && seatsUsed() + offers() >= S.limit) { err.textContent = `SEAT_LIMIT_REACHED · All ${S.limit} seats are in use. Buy more seats (10.00 USDC each).`; return; }
      const at = stamp();
      S.invitations.push({ id: cx.newId('inv'), email: model.email, kind: model.kind, sentBy: cx.meId(), sentAt: at, status: 'Pending', acceptedAt: null, expires: new Date(Date.parse(at) + 14 * 864e5).toISOString().slice(0, 10), offers: null });
      S.offersReserved = offers();
      close(); cx.toast(`Invitation sent to ${model.email}.`, { tone: 'success', cmd: cmdOf() }); cx.refresh();
    } }] });
}
cx.route('seats', () => {
  const used = seatsUsed();
  const held = offers();
  const agents = S.members.filter((m) => m.kind === 'Agent');
  const grid = h('div.gv-seatgrid', Array.from({ length: S.limit }, (_, i) => h('i', { class: { used: i < used, held: i >= used && i < used + held, bought: i >= 10 }, title: i < used ? cx.name(persons()[i]?.id) : i < used + held ? 'Held for an invitation' : 'Free' })));
  const members = cx.listView({
    key: 'seat-members', rows: () => S.members, id: (m) => m.id, noun: 'member',
    titleCol: { key: 'name', label: 'Name', render: (m) => h('span', { style: 'display:inline-flex;gap:8px;align-items:center' }, cx.avatar(m.id, { size: 'sm' }), h('span', h('a', { href: cx.href(m.kind === 'Agent' ? 'agent' : 'member', m.id) }, m.kind === 'Agent' ? m.id : cx.name(m.id)), h('div', { style: 'font-size:12px;color:var(--muted)' }, m.kind === 'Agent' ? m.name || cx.person(m.id)?.label : m.email))) },
    status: (m) => ({ text: m.status, tone: m.status === 'Active' ? 'green' : 'muted' }),
    columns: [
      { key: 'kind', label: 'Kind' },
      { key: 'seat', label: 'Seat' },
      { key: 'hats', label: 'Hats worn now', render: (m) => (m.hats?.length ? h('div.chips', m.hats.map((x) => cx.hat(x))) : h('span', { style: 'color:var(--faint)' }, 'none')) },
      { key: 'departmentsHeld', label: 'Departments held', get: (m) => (m.departmentsHeld || []).map((d) => cx.deptName(d)).join(', ') },
      { key: 'joined', label: 'Joined', type: 'date' },
    ],
    filters: [{ key: 'name', label: 'Name', get: (m) => cx.name(m.id) }, { key: 'kind', label: 'Kind', type: 'select', options: ['Person', 'Agent'] }],
    tabs: [{ label: 'All' }, { label: 'People', filter: (m) => m.kind === 'Person' }, { label: 'Agents', filter: (m) => m.kind === 'Agent' }, { label: 'Wearing hats', filter: (m) => m.hats?.length }],
    sort: { options: [{ key: 'joined', label: 'Joined' }, { key: 'name', label: 'Name', get: (m) => cx.name(m.id) }], default: { key: 'joined', dir: 'asc' } },
    groupBy: [{ key: 'kind', label: 'Kind' }, { key: 'seat', label: 'Seat' }],
    href: (m) => [m.kind === 'Agent' ? 'agent' : 'member', m.id],
  });
  const invs = [...S.invitations].reverse();
  const invTable = h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Invitee'), h('th', 'Kind'), h('th', 'Status'), h('th.opt', 'Sent by'), h('th', 'Sent'), h('th.opt', 'Expires'), h('th', ''))), h('tbody', invs.map((i) => h('tr', h('td.wrap', h('b', i.email), i.note ? h('div', { style: 'font-size:12px;color:var(--muted)' }, i.note) : null), h('td', i.kind), h('td', cx.pill(i.status, i.status === 'Pending' ? 'orange' : i.status === 'Active' ? 'green' : 'muted')), h('td.opt', cx.name(i.sentBy)), h('td', fmt.date(i.sentAt)), h('td.opt', i.status === 'Pending' ? fmt.date(i.expires) : i.acceptedAt ? `accepted ${fmt.date(i.acceptedAt)}` : ''),
    h('td', i.status === 'Pending' ? cx.menu(null, [{ label: 'Resend', icon: 'mail', needs: () => cx.wears('People') || 'Needs the People hat.', cmd: `capxul org invite resend ${i.id} ${ORG}`, onClick: () => cx.toast(`Resent to ${i.email}.`, { cmd: `capxul org invite resend ${i.id}` }) }, { label: 'Cancel', icon: 'x', danger: true, needs: () => cx.wears('People') || 'Needs the People hat.', cmd: `capxul org invite cancel ${i.id} ${ORG}`, onClick: async () => { if (await cx.confirm({ title: `Cancel the invitation to ${i.email}?`, body: 'The seat it held is free again.', cmd: `capxul org invite cancel ${i.id} ${ORG}`, danger: true, confirmLabel: 'Cancel it', cancelLabel: 'Keep it' })) { i.status = 'Cancelled'; S.offersReserved = offers(); dropWaiting((a) => a.ref?.type === 'invitation' && a.what.includes(i.email)); cx.toast('Cancelled.', { cmd: `capxul org invite cancel ${i.id}` }); cx.refresh(); } } }]) : null))))));
  return cx.page({
    title: 'Seats', sub: `${used} of ${S.limit} seats in use · ${held} held for an invitation · ${agents.length - 1} agents on their owners' seats · and the company's FDE`,
    actions: [cx.btn('Invite someone', { icon: 'plus', needs: () => cx.wears('People') || 'Needs the People hat.', cmd: `capxul org member invite <email> ${ORG} --request-key …`, onClick: invite }), cx.btn('Buy seats', { kind: 'primary', icon: 'seats', needs: () => cx.wears('People') || 'Needs the People hat.', cmd: `capxul org seats buy 5 ${ORG} --from capxul`, onClick: buySeats })],
    cmd: { cli: [`capxul org seats show ${ORG}`, `capxul org member list ${ORG}`], sdk: 'client.org(orgId).seats.show()', json: { seatLimit: S.limit, seatsUsed: used, offersReserved: held, seatsBought: S.bought, ownAgent: S.ownAgent, price: `${S.price.toFixed(2)} USDC` } },
    body: [
      h('div.grid.c2',
        cx.card({ title: 'Seats', body: h('div', { style: 'display:grid;gap:10px' }, grid, h('div.gv-legend', h('span', h('i', { style: 'background:var(--accent)' }), `In use ${used}`), h('span', h('i', { style: 'background:var(--t-orange-bg);border:1px solid var(--t-orange)' }), `Held ${held}`), h('span', h('i', { style: 'background:var(--sunk);border:1px solid var(--line)' }), `Free ${S.limit - used - held}`)), h('p', { style: 'font-size:13px' }, `Started with 10. ${S.purchases.map((p) => `Bought ${p.seats} on ${fmt.date(p.at)} for ${fmt.usdc(p.total)}`).join('. ')}. One more costs ${fmt.usdc(S.price)}, once.`)) }),
        cx.card({ title: 'Seats in use by month', body: cx.chart.bar({ labels: S.usage.map((u) => fmt.monthShort(u.month)), series: [{ name: 'In use', values: S.usage.map((u) => u.used), color: '1' }], line: { name: 'Seats', values: S.usage.map((u) => u.limit) }, height: 180, format: (v) => String(Math.round(v)) }) })),
      cx.card({ title: 'Members', flush: true, cmd: `capxul org member list ${ORG}`, body: h('div', { style: 'min-width:0;padding:10px' }, members) }),
      h('p', { style: 'font-size:12.5px;color:var(--muted)' }, S.note || 'People paid by Harbourline don\'t need a seat.'),
      cx.card({ title: 'Invitations', flush: true, cmd: `capxul org invite list ${ORG}`, body: invTable }),
      cx.card({ title: 'Seat purchases', flush: true, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'When'), h('th.num', 'Seats'), h('th.num', 'Paid'), h('th', 'Bought by'), h('th.opt', 'From'), h('th', 'Limit'), h('th.opt', 'Payment'))), h('tbody', S.purchases.map((p) => h('tr', h('td', fmt.datetime(p.at)), h('td.num', String(p.seats)), h('td.num', fmt.usdc(p.total)), h('td', cx.personChip(p.by)), h('td.opt', cx.deptName(p.from)), h('td', `${p.limitBefore} → ${p.limitAfter}`), h('td.opt', cx.link('payment and proof', 'payment', p.payment))))))) }),
    ],
  });
}, { workspace: 'seats', title: 'Seats' });

cx.route('member', (ctx) => {
  const m = cx.find(S.members, 'id', ctx.id);
  if (!m) return cx.page({ title: 'Not found', body: cx.empty('No such member', cx.btn('Seats', { href: ['seats'] })) });
  if (m.kind === 'Agent') { cx.go('agent', m.id); return cx.page({ title: m.id }); }
  const p = cx.person(m.id);
  const st = standing(m.id);
  const origin = (hat) => {
    const d = D.departments.find((x) => x.name === hat);
    if (d) { const hh = d.holders.find((x) => x.who === m.id && !x.to); const ch = d.changes.find((c) => /Create|Add holder/.test(c.kind) && c.terms.includes(cx.name(m.id))); return `${d.name} department · since ${fmt.date(hh?.from)}${ch ? ` · signed by ${ch.signedBy === 'board' ? 'the Board' : cx.name(ch.signedBy)}` : ''}`; }
    const a = D.allowances.find((x) => `${x.name} allowance` === hat); if (a) return `allowance under ${cx.deptName(a.parent)} · by Board proposal`;
    if (hat === 'Director') { const dd = B.directors.find((x) => x.who === m.id); return `since ${fmt.date(dd?.from)} · ${dd?.electedBy}`; }
    const k = Object.keys(OFFICER).find((x) => OFFICER[x].name === hat); if (k) { const w = D.officerHats[k].find((x) => x.who === m.id && !x.to); const sp = B.proposals.find((x) => x.title.includes(hat) && x.title.includes(cx.name(m.id)) && x.status === 'Executed'); return `officer hat · since ${fmt.date(w?.from)}${sp ? ` · ${sp.id}` : ''}`; }
    return '';
  };
  const agent = D.agents.find((a) => a.owner === m.id);
  return cx.page({
    title: cx.name(m.id), crumbs: [{ label: 'Seats and agents', route: 'seats' }],
    status: [cx.pill(m.status, 'green', { lg: true })], sub: `${m.kind} · own seat · joined ${fmt.date(m.joined)}${p?.designation ? ' · ' + p.designation : ''}`,
    actions: [cx.btn('Grant a permission', { icon: 'hat', needs: () => isDirector() || 'Only Directors (a Board proposal).', cmd: `capxul org member grant ${m.email} --permission manage-books ${ORG}`, onClick: () => grantHat('books') }), p?.employee && cx.hasRoute('employee') ? cx.btn('Employee record', { icon: 'hr', href: ['employee', p.employee] }) : null].filter(Boolean),
    cmd: { cli: m.id === cx.meId() ? `capxul org me ${ORG}` : `capxul org member get ${m.account || m.email} ${ORG}`, sdk: m.id === cx.meId() ? 'client.org(orgId).me()' : `client.org(orgId).members.get("${m.account || m.email}")`, json: { account: m.account, email: m.email, role: st.role.toLowerCase(), hats: m.hats, canManagePeople: st.people, canSpend: st.budgets, isDirector: st.director, safe: m.safe } },
    body: [
      h('div.grid.c2',
        cx.card({ title: 'Hats worn now', body: m.hats.length ? h('div', { style: 'display:grid;gap:8px' }, m.hats.map((x) => h('div', cx.hat(x), h('div', { style: 'font-size:12.5px;color:var(--muted);margin-top:3px' }, origin(x))))) : h('p', { style: 'color:var(--muted)' }, 'None.') }),
        cx.card({ title: 'What they can do', cmd: m.id === cx.meId() ? `capxul org me ${ORG}` : null, body: cx.kv([['Spend from', st.budgets.join(', ') || 'no budget'], ['Director', st.director ? 'yes' : 'no'], ['Manage people', st.people ? 'yes' : 'no'], ['Books', st.books ? 'yes' : 'no'], ['Invoicing', st.invoicing ? 'yes' : 'no']]) })),
      h('div.grid.c2',
        cx.card({ title: 'Their agent', body: agent ? h('div', { style: 'display:grid;gap:6px' }, h('div', cx.link(agent.handle, 'agent', agent.handle), ' ', cx.pill(agent.state, agent.state === 'Active' ? 'green' : 'orange')), h('div', { style: 'font-size:12.5px;color:var(--muted)' }, `${agent.name} · Safe ${fmt.addr(agent.safe)} · holds ${fmt.usdc(agent.holds)}`)) : h('div', { style: 'display:grid;gap:8px' }, h('p', { style: 'color:var(--muted)' }, 'No agent yet. Every seat may have one.'), m.id === cx.meId() ? cx.btn('Create my agent', { sm: true, icon: 'plus', cmd: `capxul agent create "Helper" --handle ${m.id}-helper`, onClick: () => createAgent() }) : null) }),
        cx.card({ title: 'Paid by and Safe', body: cx.kv([['Paid by (HR)', p?.department ? cx.deptName(p.department) : '—'], ['Holds', st.budgets.length ? st.budgets.join(', ') : 'no department'], ['Personal Safe', m.safe ? cx.addr(m.safe) : '—'], ['Account', h('span.mono', m.account || '—')]]) })),
      h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'Being paid by a department (HR) is a different thing from holding its hat. A seat never ends: people leave a department, not the company.'),
    ],
  });
}, { workspace: 'seats', title: 'Member' });

/* agents */
const AG_TONE = { Creating: 'blue', Active: 'green', Frozen: 'orange', Removed: 'muted', Failed: 'red' };
function agentAction(a, verb) {
  const cmds = { Freeze: `capxul agent freeze ${a.handle}`, Unfreeze: `capxul agent unfreeze ${a.handle}`, 'Rotate key': `capxul agent key rotate ${a.handle}`, Sweep: `capxul agent sweep ${a.handle} --asset USDC`, Remove: `capxul agent remove ${a.handle}` };
  return async () => {
    const cmd = cmds[verb];
    if (['Remove', 'Freeze'].includes(verb) && !(await cx.confirm({ title: `${verb} ${a.handle}?`, body: verb === 'Freeze' ? 'Freezing stops its key at once. It keeps its hats: to take it out of an allowance, revoke the allowance.' : `${a.handle} stops for good. Sweep what it holds first.`, cmd, who: `${cx.name(a.owner)}, its owner`, danger: true, confirmLabel: verb }))) return;
    const r = await cx.approval({ title: `${verb} ${a.handle}`, from: `${cx.name(a.owner)}'s Safe`, to: `${a.handle} · Safe ${fmt.addr(a.safe)}`, amount: verb === 'Sweep' ? a.holds : null, signer: a.owner, cmd });
    if (r.status !== 'done') return;
    const what = { Freeze: `Frozen by ${cx.name(a.owner)}`, Unfreeze: `Unfrozen by ${cx.name(a.owner)}`, 'Rotate key': 'Key rotated', Sweep: `Swept ${fmt.usdc(a.holds)} back to ${cx.name(a.owner)}`, Remove: `Removed by ${cx.name(a.owner)}` }[verb];
    a.changes.push({ at: r.at, what, tx: r.tx });
    if (verb === 'Freeze') a.state = 'Frozen'; if (verb === 'Unfreeze') a.state = 'Active'; if (verb === 'Remove') a.state = 'Removed'; if (verb === 'Sweep') a.holds = 0; if (verb === 'Rotate key') a.signer = cx.randHex(20);
    const mm = S.members.find((x) => x.id === a.handle); if (mm && verb === 'Remove') mm.status = 'Removed';
    addEvent(`${a.handle}: ${what}`, { type: 'agent', id: a.handle }, 'Agents');
    cx.toast(`${a.handle}: ${what.toLowerCase()}.`, { tone: 'success', cmd }); cx.refresh();
  };
}
function createAgent() {
  const model = { name: 'Helper', handle: `${cx.meId()}-helper` };
  cx.modal({ title: 'Create your agent', body: h('div', { style: 'display:grid;gap:10px' }, h('div.fields', { style: { '--cols': 2 } }, cx.field({ label: 'Name', edit: true, model, key: 'name' }), cx.field({ label: 'Handle', edit: true, model, key: 'handle' })), h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'It rides on your seat, with its own Safe and key. You can freeze, re-key, sweep or remove it; it can never change itself.')),
    actions: [{ label: 'Back' }, { label: 'Create', primary: true, cmd: `capxul agent create ${JSON.stringify(model.name)} --handle ${model.handle}`, onClick: async (close) => {
      close();
      const r = await cx.approval({ title: `Create @${model.handle}`, from: `${cx.me().name}'s Safe`, to: `@${model.handle}`, signer: cx.meId(), cmd: `capxul agent create ${JSON.stringify(model.name)} --handle ${model.handle}` });
      if (r.status !== 'done') return;
      const handle = '@' + model.handle;
      D.agents.push({ handle, name: model.name, owner: cx.meId(), created: cx.today, state: 'Active', hats: [], ownerName: cx.me().name, safe: cx.randHex(20), signer: cx.randHex(20), keyKept: `in a file on ${cx.me().firstName || cx.me().name}'s machine`, holds: 0, changes: [{ at: r.at, what: 'Created', tx: r.tx }], recent: [] });
      S.members.push({ id: handle, name: model.name, email: null, kind: 'Agent', seat: `Rides on ${cx.me().name}'s`, joined: cx.today, status: 'Active', safe: D.agents.at(-1).safe, hats: [], departmentsHeld: [] });
      cx.toast(`Created ${handle}.`, { tone: 'success' });
      cx.go('agents');
    } }] });
}
cx.route('agents', () => {
  const seatAgents = D.agents;
  const fde = D.fde?.hosting;
  const mineHas = D.agents.some((a) => a.owner === cx.meId() && a.state !== 'Removed');
  const row = (a) => h('tr.click', { onclick: () => cx.go('agent', a.handle) }, h('td', h('span', { style: 'display:inline-flex;gap:8px;align-items:center' }, cx.avatar(a.handle, { size: 'sm' }), h('span', h('a', { href: cx.href('agent', a.handle) }, a.handle), h('div', { style: 'font-size:12px;color:var(--muted)' }, a.name)))), h('td', cx.personChip(a.owner)), h('td', cx.pill(a.state, AG_TONE[a.state])), h('td.opt', cx.addr(a.safe)), h('td.num', fmt.usdc(a.holds)), h('td.wrap', a.hats.length ? h('div.chips', a.hats.map((x) => cx.hat(x))) : h('span', { style: 'color:var(--faint)' }, 'none')), h('td.opt', fmt.date(a.created)));
  return cx.page({
    title: 'Agents', crumbs: [{ label: 'Seats and agents', route: 'seats' }],
    actions: [cx.btn('Create my agent', { kind: 'primary', icon: 'plus', disabled: mineHas || !cx.hasSeat(), reason: mineHas ? 'You have an agent already: one per seat.' : 'Needs a seat.', cmd: `capxul agent create "Helper" --handle ${cx.meId()}-helper`, onClick: createAgent })],
    cmd: { cli: ['capxul agent list', 'capxul agent show @kwame-ops'], sdk: 'client.me.agents.list()', note: 'capxul agent list shows your own agents; this page shows every seat\'s.' },
    body: [
      cx.card({ title: 'Seat agents', flush: true, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Agent'), h('th', 'Owner'), h('th', 'State'), h('th.opt', 'Safe'), h('th.num', 'Holds'), h('th', 'Hats'), h('th.opt', 'Created'))), h('tbody', seatAgents.map(row)))) }),
      cx.card({ title: 'The company\'s agent', body: fde ? h('div', { style: 'display:grid;gap:6px' }, h('div', h('a', { href: '#fde' }, h('b', fde.handle)), ' ', cx.pill(fde.status, 'green'), h('span', { style: 'color:var(--muted)' }, ` · Harbourline's Forward Deployed Engineer · hosted by Capxul since ${fmt.date(fde.started)}`)), h('p', { style: 'font-size:13px' }, 'It wears no hats of its own: it acts with each asker\'s hats, and hands over anything that needs a signature.')) : cx.empty('No company agent.') }),
      h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'One agent per seat, with its own Safe and key. Its owner can freeze, re-key, sweep or remove it; it can never change itself.'),
    ],
  });
}, { workspace: 'seats', title: 'Agents' });
cx.route('agent', (ctx) => {
  if (cx.slug(ctx.id) === cx.slug(D.fde?.hosting?.handle)) { cx.go('fde'); return cx.page({ title: 'FDE' }); }
  const a = D.agents.find((x) => cx.slug(x.handle) === cx.slug(ctx.id));
  if (!a) return cx.page({ title: 'Not found', body: cx.empty('No such agent', cx.btn('Agents', { href: ['agents'] })) });
  const owner = a.owner === cx.meId();
  const need = () => owner || `Only ${cx.name(a.owner)}, its owner, can do this, from their own Safe.`;
  const btn = (verb, kind) => cx.btn(verb, { kind, needs: need, cmd: { Freeze: `capxul agent freeze ${a.handle}`, Unfreeze: `capxul agent unfreeze ${a.handle}`, 'Rotate key': `capxul agent key rotate ${a.handle}`, Sweep: `capxul agent sweep ${a.handle} --asset USDC`, Remove: `capxul agent remove ${a.handle}` }[verb], onClick: agentAction(a, verb) });
  return cx.page({
    title: a.handle, crumbs: [{ label: 'Seats and agents', route: 'seats' }, { label: 'Agents', route: 'agents' }],
    status: [cx.pill(a.state, AG_TONE[a.state], { lg: true })], sub: h('span', `${a.name} · owned by `, cx.personChip(a.owner), ` · rides on ${cx.firstName(a.owner)}'s seat`),
    actions: a.state === 'Removed' ? [] : [cx.menu(null, [{ label: 'Rotate key', icon: 'key', needs: need, cmd: `capxul agent key rotate ${a.handle}`, onClick: agentAction(a, 'Rotate key') }, { label: 'Sweep to owner', icon: 'swap', needs: need, cmd: `capxul agent sweep ${a.handle} --asset USDC`, onClick: agentAction(a, 'Sweep') }, { divider: true }, { label: 'Remove', icon: 'trash', danger: true, needs: need, cmd: `capxul agent remove ${a.handle}`, onClick: agentAction(a, 'Remove') }]), a.state === 'Frozen' ? btn('Unfreeze', 'primary') : btn('Freeze', 'danger')],
    cmd: { cli: `capxul agent show ${a.handle}`, sdk: `client.me.agents.get("${a.handle}")`, json: { handle: a.handle, owner: cx.person(a.owner)?.companyEmail, state: a.state.toLowerCase(), safe: a.safe, signer: a.signer, holdings: [{ asset: 'USDC', balance: String(a.holds) }], hats: a.hats } },
    banner: a.state === 'Frozen' ? cx.banner(`${a.handle} is frozen: its key can sign nothing. ${a.changes.at(-1)?.what || ''}.`, { tone: 'warning' }) : null,
    body: [
      h('div.grid.c2',
        cx.card({ title: 'Agent', body: cx.kv([['Handle', a.handle], ['Owner', cx.personChip(a.owner)], ['Key', h('span', cx.addr(a.signer), h('span', { style: 'color:var(--muted)' }, `, kept ${a.keyKept}`))], ['Safe', cx.addr(a.safe)], ['Holds', `${fmt.usdc(a.holds)} (read from the chain)`], ['Hats', a.hats.length ? h('span.chips', a.hats.map((x) => cx.hat(x))) : 'none'], ['Created', fmt.date(a.created)]]) }),
        cx.card({ title: 'Changes', body: cx.timeline(a.changes.map((c) => ({ at: c.at, kind: /Frozen/.test(c.what) ? 'cancelled' : /Created/.test(c.what) ? 'created' : 'change', text: c.what, sub: c.tx ? fmt.hash(c.tx) : null }))) })),
      cx.card({ title: 'What it did recently', flush: true, cmd: `capxul activity list --account ${a.handle}`, body: a.recent.length ? h('ul.feed', [...a.recent].reverse().map((x) => h('li', cx.icon('money'), x.payment ? h('a', { href: cx.href('payment', x.payment), style: 'color:inherit' }, x.what) : h('span', x.what), h('span.ago', { title: fmt.datetime(x.at) }, fmt.ago(x.at))))) : cx.empty('Nothing yet.') }),
      h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'Freezing stops its key at once. It keeps its hats: to take it out of an allowance, revoke the allowance. An agent can never change itself.'),
    ],
  });
}, { workspace: 'seats', title: 'Agent' });

/* =====================================================================================================
   Search
   ===================================================================================================== */

cx.search.add((qs, limit) => {
  const t = qs.toLowerCase();
  const out = [];
  for (const p of B.proposals) if (out.length < limit && (p.id.includes(t) || p.title.toLowerCase().includes(t))) out.push({ kind: 'Board proposals', label: `${p.id} · ${p.title}`, sub: p.status, route: 'proposal', id: p.id, icon: 'board' });
  for (const v of E.votes) if (v.id.includes(t) || v.title.toLowerCase().includes(t)) out.push({ kind: 'Votes', label: `${v.id} · ${v.title}`, sub: v.status, route: 'vote', id: v.id, icon: 'board' });
  for (const a of D.agents) if (a.handle.includes(t) || a.name.toLowerCase().includes(t)) out.push({ kind: 'Agents', label: a.handle, sub: `${a.name} · ${cx.name(a.owner)}`, route: 'agent', id: a.handle, icon: 'fde' });
  for (const r of E.rounds) if (r.name.toLowerCase().includes(t) || r.id.includes(t)) out.push({ kind: 'Rounds', label: r.name, sub: `${r.id} · ${fmt.usdc(r.raised, 0)}`, route: 'round', id: r.id, icon: 'board' });
  return out;
});

cx.native = Object.assign(cx.native || {}, { approveProposal, castVote, buySeats, standing });
