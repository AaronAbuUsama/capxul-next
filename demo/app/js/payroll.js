// Stub for the payroll module. Its builder replaces this whole file (see README.md in this folder).
import { cx } from './core.js';

cx.workspace({ id: 'payroll', label: 'Payroll', icon: 'payroll', route: 'payroll', nav: [{ label: 'Home', route: 'payroll' }] });
cx.route('payroll', () => cx.stubPage({ workspace: 'payroll', title: 'Payroll', cmd: 'capxul org payroll run list', screens: ['Salary components, structures and assignments', 'Payroll runs, month by month, paid in one batch with proof', 'Payslips', 'Salary register'] }), { workspace: 'payroll', title: 'Payroll' });
