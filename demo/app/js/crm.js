// Stub for the crm module. Its builder replaces this whole file (see README.md in this folder).
import { cx } from './core.js';

cx.workspace({ id: 'crm', label: 'CRM', icon: 'crm', route: 'crm', nav: [{ label: 'Home', route: 'crm' }] });
cx.route('crm', () => cx.stubPage({ workspace: 'crm', title: 'CRM', cmd: 'capxul org crm deal list --stage ongoing', screens: ['Leads and deals: lists and kanban', 'Lead and deal pages with their activity', 'Companies and contacts', 'Notes, tasks and call logs'] }), { workspace: 'crm', title: 'CRM' });
