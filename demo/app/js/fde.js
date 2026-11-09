// Stub for the fde module. Its builder replaces this whole file (see README.md in this folder).
import { cx } from './core.js';

cx.workspace({ id: 'fde', label: 'FDE', icon: 'fde', route: 'fde', nav: [{ label: 'Home', route: 'fde' }], seatless: true });
cx.route('fde', () => cx.stubPage({ workspace: 'fde', title: 'FDE', cmd: 'capxul org fde show', screens: ['Harbourline\'s FDE: hosting, guests, conversations', 'Talk to the FDE: answers with the commands it would run, drafts for you to run'] }), { workspace: 'fde', title: 'FDE' });

cx.workspace({ id: 'activity', label: 'Activity', icon: 'activity', route: 'activity', nav: [{ label: 'Home', route: 'activity' }] });
cx.route('activity', () => cx.stubPage({ workspace: 'activity', title: 'Activity', cmd: 'capxul activity list --org harbourline', screens: ['The money feed', 'Events', 'Notices'] }), { workspace: 'activity', title: 'Activity' });
