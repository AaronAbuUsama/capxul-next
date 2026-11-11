export const meta = {
  name: 'book-target-architecture',
  description: 'Design the target architecture of the rebuild as typed records, with every judgment recorded',
  phases: [
    { title: 'Design', detail: 'concept map, components, environments, shared vocabulary, integrations, contracts' },
    { title: 'Review', detail: 'an adversarial architect checks it against the decisions and the evidence' },
  ],
}

const BRIEF = `You design the TARGET architecture of the Capxul rebuild as typed design-book records. This is the top of the target book; per-concept target designs come next, built on what you write.

Read first:
- The accepted decisions: /home/user/capxul-next/docs/decisions/policy-pack.md (P1 to P10, all accepted as recommended) and these architecture decisions, accepted by Aaron on 7 November 2026: A1 Effect 4 on Node with one Postgres, Ponder on the same Postgres; A2 Effect Workflow and Cluster on Postgres for durable work (behind a spike; DBOS is the fallback); A3 behaviour split three ways: boundary (a frozen operation is implemented by one rpc or one Core SDK flow), state (tables and state machines, every write a named transition, other concepts reached through procedures), time (an rpc is one transaction; a long-lived business object is one durable process that owns its machine, resumed by signals and timers); A4 the Core SDK owns every flow and all signing, and the CLI calls exactly one SDK method per command. Every frozen operation stays (books/frozen/operations.ts); equity, directors and voting are low priority, off the critical path.
- Specs: /home/user/capxul-next/docs/spec/*.md (50-design-book.md is the record schema). Findings: docs/mission/findings.md, docs/as-is/payments.md.
- The schema: /home/user/capxul-next/packages/book/src/records/*.ts and packages/book/src/budgets.ts (class defaults). A target book is built with stage "target", which enforces target rules (see checkTargetRules in packages/book/src/build.ts).
- The as-is evidence: books/as-is/shared/foundation.ts (all 17 old concepts and their real import edges, including the 15-concept cycle), books/as-is/payments/ (a fully booked old concept). Other as-is concepts are being booked right now; read what exists.
- The old repo, read only, at /home/user/factory (branch integration/factory): docs/planning/protocol-v4/ for the v4 contracts.

Write, in /home/user/capxul-next/books/target/:
1. CONVENTIONS.md: folders and export names for the target book, the same shape as books/as-is/CONVENTIONS.md, plus the target rules every concept designer follows (events one per machine named <machine>_transitioned, defined in the concept's data.ts; budgets from class defaults with why on overrides; tenant-first keys; acceptance as {claim, observes, was}; durable processes per long-lived object; procedures only for same-money-fact writes, the outbox (a workflow triggered by a transition) for the rest; no unreached rpc; one SDK flow per multi-step operation, the CLI calling one SDK method).
2. shared/foundation.ts: the system; the components (backend on Node, Postgres, Ponder, the chain, the bundler and paymaster, the Core SDK, the React SDK, the CLI, the MCP server, the devnet) with a dependency graph that has NO cycle; the TARGET concept map: decide the concepts, their names and boundaries, and dependsOn as a DAG with no cycle. You may merge, split or rename old concepts; every old concept's responsibilities must land somewhere, and every frozen operation's area must map to a concept. The environments: devnet and the new staging.
3. shared/vocabulary.ts: the error records the target keeps (start from the old codes in books/as-is/shared/vocabulary.ts; keep codes the frozen book's refusals name; drop or merge the rest with a decision). No events here: each concept's events live with its machines.
4. shared/external.ts: the integrations as Effect services (chain RPC and evidence, bundler and paymaster, the indexer via SQL views, Bridge, mail, Openfort signer, Chainlink prices, PostHog through the gateway) with calls, timeouts, retries, budgets (class defaults) and failures mapped to errors; and the v4 contracts only (policy P9), with the functions and events the product uses.
5. shared/decisions.ts: one decision record (defineDecision) for EVERY judgment you make: each concept merge, split or rename and why, each dependency direction, each dropped error code, each component choice. affects lists the records.
6. index.ts collecting the shared records, and a build check: cd /home/user/capxul-next && npx tsc -p books, then a script that builds books/target with stage "target" (write books/target/index.ts so packages/book/src/main.ts can build it; main.ts reads stage from the module's export const stage).
Also write /home/user/capxul-next/docs/decisions/target-architecture.md: the concept map as a table (target concept, owns, old concepts it absorbs, dependsOn), the component diagram as mermaid, and every judgment with its reason. Keep it readable.

Decide everything yourself; record each decision. Typecheck until clean. Do not commit.`

const OUT = {
  type: 'object',
  properties: {
    concepts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, absorbs: { type: 'array', items: { type: 'string' } }, dependsOn: { type: 'array', items: { type: 'string' } } }, required: ['id', 'absorbs', 'dependsOn'] } },
    decisions: { type: 'integer' },
    files: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['concepts', 'decisions', 'files', 'notes'],
}
const REV = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: { problem: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' } }, required: ['problem', 'evidence', 'fixed'] } },
    concepts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, absorbs: { type: 'array', items: { type: 'string' } }, dependsOn: { type: 'array', items: { type: 'string' } } }, required: ['id', 'absorbs', 'dependsOn'] } },
    notes: { type: 'string' },
  },
  required: ['findings', 'concepts', 'notes'],
}

phase('Design')
const design = await agent(BRIEF, { label: 'design:architecture', phase: 'Design', schema: OUT })
phase('Review')
const review = await agent(`You are an ADVERSARIAL ARCHITECT reviewing the target architecture another agent just wrote in /home/user/capxul-next/books/target/ and docs/decisions/target-architecture.md. Its brief:\n${BRIEF}\n\nIts report: ${JSON.stringify(design || {})}\n\nCheck: the concept map has no cycle and every old concept's responsibilities and every frozen operation's area land in exactly one target concept; boundaries follow how money and authority actually flow (use the as-is evidence and the payments findings); the decisions follow the accepted policies and A1 to A4; every judgment is a decision record with a reason; components and integrations match the stack (Effect 4, Node, Postgres, Ponder on the same Postgres, Effect Workflow); errors kept cover every refusal the frozen book names; v4 contracts only. Fix what is wrong in place, add a decision record for each change, and make sure npx tsc -p books is clean and the target book builds with stage "target" with no problems in the shared records. Report findings and the final concept map.`, { label: 'review:architecture', phase: 'Review', schema: REV })
return { design, review }
