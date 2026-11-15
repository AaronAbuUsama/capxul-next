# blueprint

What Capxul does, declared once. Capxul is made of **things** (a company, an invitation, a budget, a world) and the
**verbs** done to them. Each thing is a folder and each verb a file in its `verbs/`, in the shape the command, the docs
page and the trace will share (`docs/design/blueprint.md`, parts 12 and 13, amended 15 November 2026):

    src/things/invitation/verbs/accept.ts   →   capxul invitation accept

A verb is an operation a door serves, or work no door serves (the pipeline's own: a world's reset, a run's verdict, the
gate), which has spans, logs and a budget but no Rpc (part 8). A verb's file holds everything about it: what is sent and answered, how it refuses, what it announces, its budget,
its examples and what it promises. The API's handlers, the SDK, the CLI, the pages and the checks are generated from
these files or checked against them. Only facts about Capxul live here; how they are written and checked is
`packages/blueprint-tools`.

| Where | What |
|---|---|
| `src/index.ts` | The one file other packages import from |
| `src/glossary.ts` | One word, one meaning: every agreed word and the old words it replaces; its page is [`generated/glossary.md`](generated/glossary.md) |
| `src/things/<thing>/` | One thing: `values.ts`, `events.ts`, `refusals.ts`, `lifecycle.ts` where it has one, `examples.ts` (example data its verbs share, until stage 2b folds it into them), and `verbs/<verb>.ts`, one file per verb. Nothing else |
| `src/common/` | What several things use: values, ids, refusals, the site's names (`site.ts`), the chain (`chain/`) |
| `src/starting-points/` | The named states journeys begin from (`points.ts`), and what each hands a journey (`facts.ts`) |
| `src/protocol/` | How a call travels: its paths, headers, sign-in and trace |
| `src/telemetry/` | The telemetry vocabulary, one file each: the conventions' version, the envelope, the producers, the step kinds, the metrics, the datasets and what watches them (part 10) |
| `src/generated/` | The indexes `pnpm generate` writes from the thing folders. Never edited |
| `generated/` | The pages `pnpm generate` writes: `index.md`, the map of every thing and verb, and one page per thing, opening with its commands, SDK calls, refusals with exit codes, and events; and `pnpm generate`'s `glossary.md` and `old-words.json`, the count of each old word still written (`pnpm words` fails when one grows). Never edited |
| `src/ratchets.ts` | The ratchet registry, R1 to R19 (R15 the old words, gated by `pnpm words`; R16 the names not from their path; R17 to R19 the formats item 3.10 added): what each list holds, how it is counted, what closes it; and each format's `unmigrated` list |
| `docs/` | `build-order.md`; `decisions.md` and `gaps.md` until they are folded |

To add a verb, add its file to its thing's `verbs/`, declared with `verb(...)` and named `<thing>.<verb>` from its
path, and run `pnpm generate`; a new thing is a new folder. A test fails any file under `src/` outside this layout. A
thing's `refusals.ts` holds only `refusal(...)`, its `events.ts` only `event(...)`. Names that differ from their path
today are on ratchet R16's list until their thing is climbed; the invitation is in every format (roadmap item 3.10).

`pnpm test` here runs the contract's tests, the delta check over the blueprint and its pages against their sources.

The scorecard, every thing against every format and ratchet: [generated/scorecard.md](generated/scorecard.md).
