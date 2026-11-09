// Stub for the accounting module. Its builder replaces this whole file (see README.md in this folder).
import { cx } from './core.js';

cx.workspace({ id: 'books', label: 'Books', icon: 'books', route: 'books', nav: [{ label: 'Home', route: 'books' }] });
cx.route('books', () => cx.stubPage({ workspace: 'books', title: 'Books', cmd: 'capxul org books reports profit-and-loss --from 2026-04-01 --to 2026-10-31', screens: ['Chart of accounts', 'Sales and purchase invoices', 'Payment entries with their proof', 'Journal entries', 'General ledger, trial balance, profit and loss, balance sheet, cash flow', 'Receivables and payables with ageing', 'Banking: Barclays reconciliation', 'Cost centres'] }), { workspace: 'books', title: 'Books' });
