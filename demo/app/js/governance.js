// Stub for the governance module. Its builder replaces this whole file (see README.md in this folder).
import { cx } from './core.js';

cx.workspace({ id: 'approvals', label: 'Approvals', icon: 'approvals', route: 'approvals', nav: [{ label: 'Home', route: 'approvals' }], badge: () => cx.data.approvals.waiting.filter((a) => a.waitsFor.includes(cx.meId())).length || null });
cx.route('approvals', () => cx.stubPage({ workspace: 'approvals', title: 'Approvals', cmd: 'capxul org proposal list --status waiting --org harbourline', screens: ['What waits for whom', 'The hand-over: approve with your passkey'] }), { workspace: 'approvals', title: 'Approvals' });

cx.workspace({ id: 'board', label: 'Board and equity', icon: 'board', route: 'board', nav: [{ label: 'Home', route: 'board' }] });
cx.route('board', () => cx.stubPage({ workspace: 'board', title: 'Board and equity', cmd: 'capxul org board show', screens: ['The Board, Directors and threshold', 'Board proposals and their approvals', 'Cap table, rounds, SAFEs, option grants', 'Shareholder votes'] }), { workspace: 'board', title: 'Board and equity' });

cx.workspace({ id: 'seats', label: 'Seats and agents', icon: 'seats', route: 'seats', nav: [{ label: 'Home', route: 'seats' }] });
cx.route('seats', () => cx.stubPage({ workspace: 'seats', title: 'Seats and agents', cmd: 'capxul org seats show', screens: ['Seats: 14 of 20 in use, buy seats', 'Members and invitations', 'Agents, one per seat, and the company\'s FDE'] }), { workspace: 'seats', title: 'Seats and agents' });
