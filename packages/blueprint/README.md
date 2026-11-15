# blueprint

What Capxul does, declared once. Capxul is made of **things** (a company, an invitation, a budget, a world) and the
**verbs** done to them. Each thing is a folder and each verb a file, in the shape the command, the docs page and the
trace will share (`docs/design/blueprint.md`, parts 12 and 13):

    src/things/invitation/accept.ts   →   capxul invitation accept

A verb's file holds everything about it: what is sent and answered, how it refuses, what it announces, its budget,
its examples and what it promises. The API's handlers, the SDK, the CLI, the pages and the checks are generated from
these files or checked against them. Only facts about Capxul live here; how they are written and checked is
`packages/blueprint-tools`.

| Where | What |
|---|---|
| `src/index.ts` | The one file other packages import from |
| `src/glossary.ts` | One word, one meaning: every agreed word and the old words it replaces; its page is [`generated/glossary.md`](generated/glossary.md) |
| `src/things/<thing>/` | One thing: `values.ts`, `events.ts`, `refusals.ts`, `lifecycle.ts` where it has one, `examples.ts` (example data its verbs share, until stage 2b folds it into them), and one file per verb |
| `src/common/` | What several things use: values, ids, refusals, the site's names (`site.ts`), the chain (`chain/`) |
| `src/starting-points/` | The named states journeys begin from (`points.ts`), and what each hands a journey (`facts.ts`) |
| `src/protocol/` | How a call travels: its paths, headers, sign-in and trace |
| `src/generated/` | The indexes `pnpm generate` writes from the thing folders. Never edited |
| `generated/` | The pages `pnpm claims` writes: `index.md`, the map of every thing and verb, and one page per thing; and `pnpm generate`'s `glossary.md` and `old-words.json`, the count of each old word still written (`pnpm words` fails when one grows). Never edited |
| `docs/` | `build-order.md`; `decisions.md` and `gaps.md` until they are folded |

To add a verb, add its file to its thing's folder and run `pnpm generate` and `pnpm claims`; a new thing is a new
folder. A test fails any file under `src/` outside this layout. Today's names (`invite.accept`, `org`, claims) stay
until the glossary's renames (roadmap item 3.8).

`pnpm test` here runs the contract's tests; the toolkit's (`pnpm --filter @capxul/blueprint-tools test`) check the
pages and the delta check, `pnpm delta:check`.
