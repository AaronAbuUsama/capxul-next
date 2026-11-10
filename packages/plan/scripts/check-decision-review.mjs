// Check coverage of the historical cut input independently of its review manifest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { records } from '../../../blueprint/index.ts';

const json = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const input = json('docs/design/cut-proposal.json').decisions.filter(x => x.verdict === 'rewrite');
const review = json('docs/design/decision-review.json').reviews;
const history = json('docs/cut-archive/decision-review-history.json');
const decisions = new Map(records.filter(r => r._kind === 'decision').map(r => [r.id, r]));
assert.equal(new Set(review.map(x => x.id)).size, review.length, 'review ids repeat');
assert.deepEqual(review.map(x => x.id).sort(), input.map(x => x.id).sort(), 'review must cover exactly the rewrite list');
for (const r of review) {
  assert.ok(['archived', 'rewritten', 'confirmed'].includes(r.disposition), r.id);
  assert.ok(r.reason && r.authority && fs.existsSync(r.path), `${r.id}: missing evidence`);
  const d = decisions.get(r.id);
  if (d) {
    assert.match(d.why, /Review, 11 November 2026:/, `${r.id}: missing in-record review`);
    assert.ok(history.some(x => x.id === r.id && x.original.includes(`"${r.id}"`)), `${r.id}: missing original`);
    if (r.disposition !== 'confirmed') assert.equal(d.chosen, 'current-scope', r.id);
  } else {
    assert.ok(r.path.startsWith('docs/cut-archive/') || (r.id === 'devnet.head-follows-world' && decisions.has('devnet.site-follows-world')), r.id);
  }
}
console.log(`decision review: ${review.length} reviewed, ${history.length} originals preserved, 0 unreviewed`);
const evals = json('var/blueprint/evals.json');
const ids = new Map();
for (const e of evals) ids.set(e.id, (ids.get(e.id) || 0) + 1);
const repeated = Array.from(ids).filter(([, count]) => count > 1);
console.log(`eval identity: ${evals.length} rows, ${ids.size} unique ids, ${repeated.length} repeated ids`);
console.log(`task checks: ${repeated.length ? 1 : 2} pass, ${repeated.length ? 1 : 0} fail, 0 unverifiable, 0 error`);
if (repeated.length) process.exitCode = 1;
