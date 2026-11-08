export const meta = {
  name: 'book-frozen-refusals',
  description: 'Restore or justify the 25 frozen refusals the target book dropped, one fixer then an adversarial reviewer per owning concept',
  phases: [
    { title: 'Fix', detail: 'one fixer per concept restores each dropped refusal or records a decision naming it' },
    { title: 'Review', detail: 'an adversarial reviewer per concept refutes every drop that weakens the frozen surface' },
  ],
}

const CONTEXT = `You are fixing the TARGET design book of the Capxul rebuild in /home/user/capxul-next/books/target/.
Read first: docs/design-book.md (how the book works), books/target/CONVENTIONS.md, docs/decisions/policy-pack.md (P9 drops everything pre-v4; P10 is the ladder that says which old text is the specification: the designed v4 block where one exists), and the schema in packages/book/src/records/*.ts.
The frozen surface: books/frozen/operations.ts (generated; NEVER edit). Each frozen operation has page refusals (frozen[id].refusals) and, for 81 operations, a designed v4 block whose refusals (frozen[id].designed.refusals) carry the v4 contract error each maps from. The CLI's refusals and exit codes are part of the frozen public surface.
The check: cd /home/user/capxul-next && node --experimental-strip-types tools/check-frozen.ts . It requires every refusal code from the page AND the designed block to be a refusal of the target operation record, unless a decision record whose affects lists that operation names the code (in its title, question, options, chosen or why) and says why it is dropped.
Build: npx tsc -p books && node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target-<your concept> . It must stay at 0 problems. Note the rule refusal-not-produced: a refusal you restore must be an error something under the operation can produce (its rpc or flow, their procedures, steps, or integration failures), so restoring may mean adding the error to an rpc's or flow's errors, or mapping a contract revert, which is real design.
The default is to RESTORE the refusal: design where it comes from and give it a world (refusals' given: a devnet world from books/target/devnet; '?' only if no world can reach it, which is a gap). Drop one only when it cannot happen in the target at all (for example the operation is FEATURE_NOT_AVAILABLE always in its designed block, or the refusal is a pre-v4 path P9 removes), and then the decision record says which policy or fact makes it impossible. Never drop a refusal because it is inconvenient, and never weaken a frozen acceptance line.
Do not commit. Edit only your concept's folder.`

const FIX = {
  type: 'object',
  properties: {
    concept: { type: 'string' },
    restored: { type: 'array', items: { type: 'object', properties: { operation: { type: 'string' }, code: { type: 'string' }, how: { type: 'string' } }, required: ['operation', 'code', 'how'] } },
    dropped: { type: 'array', items: { type: 'object', properties: { operation: { type: 'string' }, code: { type: 'string' }, decision: { type: 'string' }, why: { type: 'string' } }, required: ['operation', 'code', 'decision', 'why'] } },
    checkBreachesLeft: { type: 'integer', description: 'breaches tools/check-frozen.ts still reports for your operations' },
    buildProblems: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['concept', 'restored', 'dropped', 'checkBreachesLeft', 'buildProblems', 'notes'],
}

const REVIEW = {
  type: 'object',
  properties: {
    concept: { type: 'string' },
    refuted: { type: 'array', items: { type: 'object', properties: { operation: { type: 'string' }, code: { type: 'string' }, problem: { type: 'string' }, fixed: { type: 'boolean' } }, required: ['operation', 'code', 'problem', 'fixed'] } },
    upheld: { type: 'array', items: { type: 'string' } },
    checkBreachesLeft: { type: 'integer' },
    buildProblems: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['concept', 'refuted', 'upheld', 'checkBreachesLeft', 'buildProblems', 'notes'],
}

return await pipeline(
  args.groups,
  (g) => agent(`${CONTEXT}\n\nYOUR CONCEPT: ${g.concept} (folder books/target/${g.concept}). The breaches in your operations:\n${g.breaches.join('\n')}\n\nFor each, read the operation's frozen page and designed block, the target operation record, the rpc or flow implementing it and the concept's decisions. Restore the refusal where it can happen, with where it comes from; otherwise record a decision naming the code and the policy or fact that makes it impossible. Run the check and the build until your operations have no breach and the book has 0 problems. Report each restored and dropped refusal.`,
    { label: `fix:${g.concept}`, phase: 'Fix', schema: FIX }),
  (fixed, g) => agent(`${CONTEXT}\n\nYou are the ADVERSARIAL REVIEWER for ${g.concept}. The fixer's report: ${JSON.stringify(fixed)}\n\nTry to refute every DROPPED refusal: can it in fact happen in the target design (an unauthenticated caller, a bad input, a caller without the role, a wrong state, a v4 contract revert the designed block maps)? If it can, restore it yourself (edit only books/target/${g.concept}) and remove or revise the decision. For every RESTORED refusal, check that its world can reach it and the build's refusal-not-produced rule holds for a real reason, not by adding the error to an unrelated errors list. Then run the check and the build. Report what you refuted (and whether you fixed it) and what you upheld.`,
    { label: `review:${g.concept}`, phase: 'Review', schema: REVIEW }),
)