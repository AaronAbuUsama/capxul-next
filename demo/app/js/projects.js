// Stub for the projects module. Its builder replaces this whole file (see README.md in this folder).
import { cx } from './core.js';

cx.workspace({ id: 'projects', label: 'Projects', icon: 'projects', route: 'projects', nav: [{ label: 'Home', route: 'projects' }] });
cx.route('projects', () => cx.stubPage({ workspace: 'projects', title: 'Projects', cmd: 'capxul org projects list --status open', screens: ['Projects with progress, costing and billing', 'Tasks: list, kanban and Gantt', 'Timesheets and billing', 'Activity types', 'Project billing summary'] }), { workspace: 'projects', title: 'Projects' });
