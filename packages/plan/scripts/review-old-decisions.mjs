// One-off migration for m1-old-decisions. Kept as an auditable recipe; refuses a second application.
import fs from 'node:fs';
import ts from 'typescript';
const proposal = JSON.parse(fs.readFileSync('docs/design/cut-proposal.json', 'utf8'));
const targets = proposal.decisions.filter(x => x.verdict === 'rewrite');
const archived = JSON.parse(fs.readFileSync('docs/cut-archive/index.json', 'utf8'));
const files = [];
function walk(dir) { for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
  if (e.name === 'baseline' || e.name === 'src/generated') continue;
  const p = `${dir}/${e.name}`;
  if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p);
} }
walk('blueprint');
const locations = new Map();
for (const path of files) {
  const text = fs.readFileSync(path, 'utf8');
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  function visit(n) {
    if (ts.isCallExpression(n) && ['defineDecision', 'dec'].includes(n.expression.getText(tree)) && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
      const obj = n.arguments[0];
      const id = obj.properties.find(p => p.name?.getText(tree) === 'id');
      if (id && ts.isStringLiteral(id.initializer)) locations.set(id.initializer.text, {path,text,tree,obj});
    }
    ts.forEachChild(n, visit);
  }
  visit(tree);
}
const confirmed = new Set(['system.frozen-behaviour','payroll.surface-moves','payroll.budgets','payroll.dropped','payroll.flows','payroll.payee-reads','banking.flows','banking.worlds','requests.acceptance-rewrites','requests.budget-overrides','requests.invoicing-hat','requests.owner-tenancy','requests.telemetry','requests.worlds','applications.invoicing-hat','activity.row-ids','activity.row-shapes','activity.valuation','notices.chain-reads','notices.first-attempt','notices.no-staleness-check','notices.priority-and-budgets','notices.recipients','devnet.fault-switches','devnet.no-machines','devnet.mine-to-depth','devnet.only-miner','devnet.followers','devnet.running-stops','devnet.follow-at-a-rate','devnet.warp-barrier','journeys.onto-target','journeys.steps']);
function current(id) {
  if (id.startsWith('swarm.')) return ['portal.plan-page', 'The coordinator authors plan/plan.json through pnpm plan; the portal shows tasks and blockers. packages/loop runs isolated lane worktrees with a maker, independent review and gates before integration. There is no swarmD migration, ledger, account namespace or nested-manager entry gate. Budgets, model routing and concurrency are loop configuration, not the old stage profiles.'];
  if (id.startsWith('devnet.') || id.startsWith('time.')) return ['devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world', 'A world has a real anvil and one lean service with SQLite and its folded-in log reader; full worlds also have company sites on the shared bench. Business dates and scheduled jobs follow the world clock; transport, session and queue lifetimes use real elapsed time. Clock advances wait for due work and chain facts. A snapshot carries the whole world and site backups, and restore into another world preserves lineage. Seasons and hosted FDEs are parked, not prerequisites.'];
  if (id.startsWith('books.') || id.includes('books') || id === 'responsibilities.keepers') return ['cut.books; plugs.repoint-money-fact; plugs.late-and-closed', 'ERPNext on the company site is the book of record. Core retains append-only chain money facts, prices and the read models still in the blueprint, not a parallel editable accounting system. The service sends idempotent events to the site; plugs post and reverse its entries. Closed periods and late events follow plugs.late-and-closed. Old chart import, voucher sync, payroll accrual and optional-head algorithms are not current implementation instructions.'];
  if (id.startsWith('payroll.') || id === 'payments.payroll-door' || id.includes('payments-payroll') || id === 'surface.payroll-group') return ['cut.payroll; cut.agreements-in-payments; plugs.held-payment', 'Frappe HR owns employees, structures, runs, accruals and salary slips, reached through the door. The eleven chain agreement operations remain in payments under their payroll command spelling. A submitted payroll payment is held for the appropriate signer and paid by Core; the site posts the result. Do not create a second Core Employee, slip, Additional Salary or accrual, or run the old payroll head-sync. Agreement collection remains a chain money fact, not a second salary run.'];
  if (id.startsWith('contacts.') || id.includes('contacts') || id.includes('contact-get') || id === 'banking.private-entries') return ['cut.contacts; sites.crm; plugs.roles-follow-hats', 'Frappe CRM and core Contact/Address own the address book and CRM. The door reaches those documents under the caller\'s site roles, projected from hats. Core parties maps identities and Safes; banking retains Party-keyed bank accounts. The removed contacts.book rpcs and contact-get composition are historical, not a second CRM or permission system.'];
  if (id.startsWith('documents.') || id === 'concepts.documents') return ['cut.documents; plugs.document-canon', 'Core documents retains canonical bytes and hash verification for chain-backed documents and their participant admissions. Print Format, rendering, exporting and salary slips belong to the company site through the door. This decision grants no new cross-tenant read and does not restore the removed rendering rpc or Core payroll slip storage.'];
  if (id.startsWith('requests.') || id.startsWith('banking.') || id === 'payments.money-sides') return ['cut.requests; plugs.held-payment; plugs.repoint-money-fact', 'Core keeps payment requests, payer inbox, chain settlement and banking money facts. ERPNext owns invoices, services and timesheets through the door. Document meaning travels with the held payment and settlement event to its site; the site is the ledger authority, never an optional head with a second author. Matching a bank deposit identifies its request and must not post the credited money twice. Removed service and bill-time rpcs are not restored.'];
  if (id.startsWith('notices.')) return ['cut.notices; cut.fde-parked; plugs.service-calls-site', 'Core notices follow the surviving money and authority transitions. Frappe HR sends HR and payslip notifications on the site; Core does not duplicate them. Head-stalled and hosted-FDE notices are historical because there is no optional head connection and FDE hosting is parked. The service calls sites, never relies on a site reaching a local service.'];
  if (id.startsWith('parties.') || id === 'concepts.parties') return ['aaron.frappe-native; plugs.user-from-hat; sites.door', 'Core parties owns identity-to-Safe resolution, not company business contacts. Frappe owns Customer, Supplier, Contact and Employee on the hosted company site. The door acts as the caller and site roles follow hats; this is not synchronization with an optional externally connected head.'];
  if (id.startsWith('indexing.') || id === 'integrations.indexer') return ['devnet.lean-world; plugs.event-order; plugs.reversal-not-deletion', 'Indexed chain facts remain ordered, idempotent and reversible on reorg; only the chain reader writes them. In simulated worlds that reader is folded into the lean service and SQLite, not a Ponder/Postgres sidecar. The service projects facts to the company site with ordered idempotent events and explicit reversals, not a head sync.'];
  if (id.startsWith('organizations.') || id.startsWith('agents.') || id === 'rules.fde-acts-for-asker') return ['cut.organizations; cut.fde-parked; sites.lifecycle; plugs.roles-follow-hats', 'Organizations retains company identity, membership, setup and chain authority. Setup provisions its hosted company site; site lifecycle belongs to sites and hat-to-role projection to plugs. There is no optional head connection or Core-authored business-data sync. Hosted FDEs are parked; agents retain only their explicitly granted chain authority and cannot borrow an asker\'s authority by implication.'];
  if (id.startsWith('aaron.')) return ['aaron.frappe-native; aaron.one-door; sites.features-reachability; plugs.roles-follow-hats', 'The later owner rulings aaron.frappe-native and aaron.one-door refine this earlier ruling: Frappe is accounting, HR/payroll, CRM and projects, not a replica of Core-owned business tables. Every company has its hosted site and the door reaches it as the caller. Projects is a default site feature. People hats project to the appropriate site roles; Core retains identity, authority and chain money. This is a coordinator reconciliation of the earlier words, not a new answer attributed to Aaron.'];
  if (id.startsWith('tooling.')) return ['system.layout; sites.door; portal.plan-page', 'Generated files remain reproducible, carry provenance and are never edited by hand. Current checks are pnpm test, blueprint, frozen, layout and contract reconciliation. The door generates reach to the hosted site; no generator or hook requires an optional Frappe head or swarmD. Plan and loop own coordination.'];
  return ['cut.principle; aaron.one-door; sites.door; portal.plan-page', 'The built blueprint is the current dependency map: Core owns identity, authority and chain money; sites owns hosted company sites; plugs joins Core to Frappe. Frappe owns accounting, HR/payroll, CRM and projects, reached as the caller through the door. Each frozen capability is booked or classified by shared/cut.ts, never both. New explicit operations still need a cited owner ruling and acceptance claims; generated door verbs reach Frappe without booking a parallel operation per DocType. The coordinator authors build order and budgets in the plan; archived concepts and parked equity/FDE work are not active lanes.'];
}
const edits = new Map(); const reviews=[]; const history=[];
for (const t of targets) {
  const loc = locations.get(t.id);
  if (!loc) {
    const old = archived.find(x => x.key === `decision:${t.id}`);
    if (!old) {
      if (t.id !== 'devnet.head-follows-world') throw new Error(`Unaccounted decision ${t.id}`);
      reviews.push({id:t.id, disposition:'rewritten', reason:'Renamed and rewritten as devnet.site-follows-world by the earlier world-clock pass; the real hosted site follows its world, not an optional head.', authority:'devnet.site-follows-world', path:'blueprint/devnet/decisions.ts'}); continue;
    }
    reviews.push({id:t.id, disposition:'archived', reason:old.reason, authority:old.carriedBy, path:old.archivedTo}); continue;
  }
  const {path,text,tree,obj}=loc;
  const props=new Map(obj.properties.filter(p=>p.name).map(p=>[p.name.getText(tree),p]));
  const [authority,rule]=current(t.id);
  const confirm=confirmed.has(t.id);
  const title=props.get('title').initializer;
  const oldTitle=ts.isStringLiteral(title)?title.text:t.id;
  const disposition=t.id.startsWith('swarm.') || t.id.includes('head-sync') || t.id==='notices.head-and-fde' || t.id==='devnet.command-worlds' || t.id==='devnet.payslip-world' ? 'archived' : confirm?'confirmed':'rewritten';
  const reason=confirm ? `The surviving rule (${oldTitle}) still applies. Removed subjects in its historical evidence are not restored; ${authority} governs their replacement.` : rule;
  history.push({id:t.id,path,original:text.slice(obj.getStart(tree),obj.end)});
  reviews.push({id:t.id,disposition,reason,authority,path});
  const changes=edits.get(path)||[];
  if(confirm) {
    const p=props.get('why'); changes.push({start:p.initializer.getStart(tree),end:p.initializer.end,value:`${p.initializer.getText(tree)} + ${JSON.stringify(' Review, 11 November 2026: '+reason)}`});
  } else {
    const values={title:`${disposition==='archived'?'Archived: ':''}${oldTitle}`.slice(0,80),question:`What is the current scope of ${t.id} after the Frappe-native cut?`,options:[{label:'current-scope',text:rule},{label:'historical',text:'The superseded decision text is preserved in docs/cut-archive/decision-review-history.json. It is evidence, not current implementation instructions.'}],chosen:'current-scope',why:`Review, 11 November 2026: ${disposition === 'archived'?'Archive the old mechanism, retaining this id for references. ':''}${rule} Authority: ${authority}.`,source:`The coordinator, 11 November 2026; m1-old-decisions; reconciles ${t.id}; ${authority}`};
    for(const [key,value] of Object.entries(values)) {const p=props.get(key);if(!p)throw new Error(`${t.id} lacks ${key}`);changes.push({start:p.initializer.getStart(tree),end:p.initializer.end,value:JSON.stringify(value,null,2)});}
  }
  edits.set(path,changes);
}
if(fs.existsSync('docs/cut-archive/decision-review-history.json')) throw new Error('Already applied');
fs.writeFileSync('docs/cut-archive/decision-review-history.json',JSON.stringify(history,null,2)+'\n');
fs.writeFileSync('docs/design/decision-review.json',JSON.stringify({task:'m1-old-decisions',date:'2026-11-11',proposal:'docs/design/cut-proposal.json',reviews},null,2)+'\n');
for(const [path,changes] of edits){let text=fs.readFileSync(path,'utf8'); for(const c of changes.sort((a,b)=>b.start-a.start))text=text.slice(0,c.start)+c.value+text.slice(c.end);fs.writeFileSync(path,text);}
console.log(`${reviews.length} decisions reviewed; ${history.length} original records preserved`);
