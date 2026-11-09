// Stub for the money module. Its builder replaces this whole file (see README.md in this folder).
import { cx } from './core.js';

cx.workspace({ id: 'money', label: 'Money', icon: 'money', route: 'money', nav: [{ label: 'Home', route: 'money' }] });
cx.route('money', () => cx.stubPage({ workspace: 'money', title: 'Money', cmd: 'capxul balance --org harbourline', screens: ['Money overview (the Treasury, the Reserve Safe, Barclays, money waiting)', 'Treasury and Reserve Safe with their chain statements', 'Payments, each with its proof', 'Scheduled payments', 'Money waiting (escrows) with claim and take back', 'Bank: deposits through Bridge, payouts through Bridge, bank details, saved accounts', 'Requests to pay'] }), { workspace: 'money', title: 'Money' });

cx.workspace({ id: 'departments', label: 'Departments', icon: 'departments', route: 'departments', nav: [{ label: 'Home', route: 'departments' }] });
cx.route('departments', () => cx.stubPage({ workspace: 'departments', title: 'Departments', cmd: 'capxul org department list', screens: ['Departments and their quarterly budgets', 'A department, its hat holders over time, and a swap', 'Allowances', 'Payout ceilings'] }), { workspace: 'departments', title: 'Departments' });
