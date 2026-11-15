# The blueprint: design, decision by decision

The blueprint-first phase's plan, agreed with Aaron one decision at a time, starting 15 November 2026. Each section
records one agreed decision and its date. Once the design is agreed, this file becomes the roadmap's restack and the
changes to `AGENTS.md`, made by pull request with the build on `slice/blueprint`.

**The goal, in Aaron's words:** "The ultimate goal of the blueprint is to make sure that there can never be drift from
it in the future. It should fully spec the system, and nothing that should be in it should be rolled by hand."

| # | Decision | State |
|---|---|---|
| 1 | The blueprint's purpose and boundary | Agreed, 15 November 2026 |
| — | Account version (raised from the account identity decision) | Agreed, 15 November 2026 |
| 2 | What "no drift" means as checks | Proposed |
| 3 | The shape: files, indexes, READMEs, the top level | Not started |
| 4 | The pipeline as operations, with a 10-minute run budget | Not started |
| 5 | The telemetry model in the blueprint | Not started |
| 6 | The sequence and the roadmap's restack | Not started |

## 1. The blueprint's purpose and boundary

Agreed with Aaron, 15 November 2026 (option B: everything a check can judge).

**The rule.** The blueprint owns a fact when two places must agree on it, or a check judges work against it, and no
compiled source already owns it better. It never says how something is built or where it runs. Everything else that
uses a fact it owns gets it by generation, by an import that lint enforces, or by a check of what ran against it. A
fact it does not own has another named single owner, and the blueprint imports a generated copy of it.

| Fact | In the blueprint? | How |
|---|---|---|
| Operations, outcomes, events, refusals and their exit codes, claims | In | As today |
| Machines (lifecycles) | In | As decided on 15 November 2026. Operations and events are named by import, not by string (today's machine format names them by string to avoid an import cycle; decision 3 removes the cycle) |
| Roles and who may call (`allowed`) | In | As decided on 15 November 2026 (5.1) |
| Steps and logs | In | Every span of our own code is a declared step, with its kind; every log has a schema |
| Telemetry vocabulary | In: the envelope, attribute names, the conventions' version, producers, step kinds, metrics, logical datasets, fields marked sensitive. Out: sinks, routing, keys and creating datasets, which stay in `packages/platform` | The blueprint names; the platform wires (T2 to T8) |
| Starting worlds | In | Typed steps with their payloads, not prose (7.2) |
| The pipeline's own work | In | Declared operations in the same format (T5, B2a): world make, reset, snapshot save and restore, site claim, starting-world make, journey, run. Work no door serves has no Rpc but has steps, logs and a budget. Where it lives: decision 4 |
| Budgets | The target is in. Whether it is measured, its basis and its p95 are generated from measured runs, never typed | |
| Frappe | In: Capxul's names on a site (`site.ts`), and per primitive which side owns each fact, the key that reconciles them and how their lifecycles line up. Out: Frappe's own doctype schemas | The Python module stays generated |
| Contract interfaces | Out: the compiled contracts own them (3.1), and the blueprint imports the generated ABI. In: which chain logs become which events, which reverts become which refusals | |
| Limits and settings a caller can see | In: quotas, lifetimes, the timeouts lifecycle rule 6 calls declared settings | |
| Account identity | In: grade groups, account version, chain id per grade, the email's normalisation, the derivation (decided 15 November 2026) | |
| Proof names and the verdict schema | In, beside the pipeline's work. This moves them from the runner, where `proof-and-telemetry.md` placed them, because the roadmap names proofs and checks read them | |
| Handlers, SQL, infrastructure (what runs where, sizes, resources), design reasoning | Out, always | Reasoning lives in the roadmap |

Options weighed: A, the product contract only (operations, machines, roles), leaving pipeline and telemetry names to
drift; C, B plus infrastructure, which would copy the Alchemy configuration and redesign the world package against the
agreed plan.

## The account version

Agreed with Aaron, 15 November 2026: the account version stays as the roadmap's "Account identity" decision records
it. It is not the protocol's major version: it changes only when an input of the derivation changes (the salt rule,
the Safe factory, its singleton or module, the starting owner), so a person's Safe address survives protocol releases
that do not touch the derivation. Aaron had first asked for a salt versioned to the protocol's major version; this
replaces that request.
