// Stub for the hr module. Its builder replaces this whole file (see README.md in this folder).
import { cx } from './core.js';

cx.workspace({ id: 'hr', label: 'HR', icon: 'hr', route: 'hr', nav: [{ label: 'Home', route: 'hr' }], seatless: true });
cx.route('hr', () => cx.stubPage({ workspace: 'hr', title: 'HR', cmd: 'capxul org hr employee list', screens: ['Employees', 'Departments and designations', 'Holidays, leave types, allocations and leave', 'Attendance and check-ins', 'Expense claims and advances', 'Your own records: leave, payslips, claims, check in'] }), { workspace: 'hr', title: 'HR' });
