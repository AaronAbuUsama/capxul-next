# Reassessment, 11 November 2026

Aaron asked (13:48 UTC): what is really on the critical path, have the milestones been reassessed, what can be done
now without him, a Cloudflare token, model runs or the Mac, and are the skills right. Written by a cloud thread on
branch `claude/project-thread-mwv0z6`, cut from `integration/build` at `30eb4ad`. It proposes; it changes nothing in
`plan/`. Changing milestones is Aaron's call.

## The honest state

**Product code that runs today:**

| What | Where | State |
|---|---|---|
| The v4 contracts, 15 of them, with 965 hermetic and 67 fork tests | `packages/contracts` | Real, brought whole from the old system, tested |
| A seeded chain with the contracts deployed, and an 18-step key-signed proof of a company's money life | `packages/contracts/state`, `packages/devnet` | Real, runs offline |
| Key signing | `packages/sdk` | Real, small |
| A Frappe v16 site app, a Core stub service, the CLI, the recorder, the clock, snapshots, worlds | `spikes/skeleton` (about 4,500 lines) | Throwaway. Its end-to-end script passed 119 of 119 on 10 November, **on stand-in contracts** |
| A sites machine on AWS, its DNS zone and certificate | `docs/mission/sites-host` | Exists. Nothing runs on it |

**Everything else is specification or tooling:** the blueprint (about 103,000 lines of typed records, 0 problems), the
plan, the portal (about 6,800 lines), the loop (about 5,300), the Runs app and ops. Of the eval claims, 9 are bound to
a check and 8 pass. **No product package exists yet**: no service, no product CLI, no Frappe app under `packages/`.
The two pieces that make Capxul Capxul, the real contracts and Frappe, have never run together.

So Aaron is right. Since Monday the effort went into the book and then into the factory and the portal. The book work
was worth it (it is what agents build from). The factory work has not yet produced product.

## Why the climb drifted

The `coordinate` skill defines the critical path as "the shortest chain that meets every unmet exit line of **the
current milestone**". m1's open exits are g7 (Aaron reads the portal), g8 (the shared world, which has no m1 task and
needs m2, m3 and m3b) and g9 (the orchestration layer). Read literally, the only exits a sweep could move were the
portal and the factory, so every sweep chose them. m1 cannot close as written, and the product exit sits behind two
tooling exits.

## The real critical path

The destination is Capxul's own company running on Capxul (GROUNDING, "Dogfood first"). The first proof of shape is the
thin line (`journey:thin_line`, 12 steps) in one world. The shortest chain:

1. **Real contracts under the test sites** (`m2-contracts-under-sites`). Its `needs` (`m3-door-clock`) is done, so it
   is unblocked today. This is the biggest product unknown: what a real payment must carry, and whether the Frappe
   side maps onto a company Safe, hats and budgets. **Foundational.**
2. **The spike graduates into packages** (`m2-graduate-spike`): the Frappe app, then the service (which is where
   `m2-lean-service` lands), then the CLI. **Foundational**: until this happens there is no product, only a proof.
3. **The thin line's twelve primary tests bound and passing** (the thin-line part of `m1-eval-coverage` only). This is
   how "done" is known. **Foundational**, but only the thin-line part.
4. **The production bench image** (`m3b-bench-image`). Independent of 1 to 3; can run in parallel.
5. **The first shared world on the machine** (`m3b-first-shared-world`): g8. Needs 1, 2 and 4, plus the machine (done).
6. Then breadth through the door (lead to paid invoice, onboard, close a month), people's sign-in, a real Bridge account,
   and Capxul's own company on it.

**Not on the critical path to the thin line:** g9 (sandbox, gate, board), g7, `m3-site-stops-calling` (only needed when
one bench serves worlds on other machines; on one machine the site and service sit side by side), the worlds platform
(`m3b-world-service` to `m3b-env`), `m1-time-proof`, the whole-book eval coverage climb, loop hardening and the model
gateway. They matter for scale and for running many agents, not for the first working product.

## New fact: the cloud can run the product stack

This thread ran in a Claude cloud container, with no Mac, no Aaron and no model gateway, and found that it can run the
stack: Docker works (started by the session), Foundry installs from npm, and the Solidity compiler runs through a
solc-js stand-in (the native download host is blocked). The spike's Frappe stack builds from Docker Hub and GitHub
through the proxy. See "What was done" below for exactly what ran. This matters for two reasons:

- product work no longer needs the Mac, so it is not blocked by the Mac going offline or by the permissions problem;
- g9's first condition ("agents run in a sandbox, not on Aaron's Mac, with the right tooling") may already be met by
  cloud sessions, without the Cloudflare Worker. That is Aaron's call, not assumed here.

## Milestones, before and after

| Before (plan today) | After (proposed) |
|---|---|
| **m1 Foundation**: g1 to g6 met; g7 portal read; g8 shared world (no task); g9 orchestration | **m1 Foundation**: close it on g1 to g6. Move g8 to m3. Move g9 to a separate **factory** track that does not gate product. Keep g7 as Aaron's read of the book, done when he has time, not a gate |
| **m2 Real chain under the test sites** | **m2 The thin line on real contracts, anywhere**: real contracts under the sites; the Frappe app and the service graduated into packages; the twelve thin-line tests bound and passing in a cloud container and on a laptop |
| **m3 Door, recorder, clock** (spike work done) | Folded: the spike already proves them; they graduate inside m2 and m4 |
| **m3b The cloud** | **m3 The thin line on the machine**: production bench image, the first shared world on the machine, g8. Worlds platform (registry, join, scenarios, datasets) moves to a later milestone |
| **m4 Compatibility climb** | **m4 Breadth through the door**: lead to paid invoice, onboarding, month close; then the Core groups operation by operation, scored |
| **m5 Company life** (simulation) | **m5 Capxul runs on Capxul**: people's sign-in, a real Bridge account, our own CRM and agents on it. The multi-month simulation follows it, it does not precede it |

**Recommendation:** adopt the "after" column. It puts the product on the path today, keeps every finished piece of
work, and moves nothing that is irreversible. The one thing that still needs the Mac (or AWS access from elsewhere) is
deploying to the sites machine in m3.

## What can be done now with none of: Aaron, a Cloudflare token, model runs, the Mac

Ranked by how much each shortens the path.

1. **Run the spike's end-to-end script in the cloud** as the baseline, so every later change has a before and after.
2. **Start `m2-contracts-under-sites`**: the spike's Core talks to the seeded real-v4 chain (company Safe through Companies
   House, authority installed, a department budget and hat, a payment through Budgets and Payments with the document hash),
   step by step, keeping the stand-in until the script passes on the real chain.
3. **Graduate the Frappe app** into `packages/frappe-app`, unchanged in behaviour, and rerun the bound site evals.
4. **Build the production bench image locally** (`m3b-bench-image`): Docker works here.
5. **Bind the thin line's twelve primary tests** (`evals/thin-line.md`) to checks, so the score tells the truth.
6. **The lean service's storage decision** in the blueprint (SQLite, the atomic cursor and outbox boundary).

Cannot be done here: deploying to the AWS machine (its credentials are on the Mac), anything on the portal or loop
host (they live on the Mac), and Aaron's reading.

## The skills kit, frankly

The five skills (`coordinate`, `plan-tasks`, `dispatch`, `ask-aaron`, `portal-ops`) are well written and small. They
are good at running a factory. They are the reason the factory ate the week:

- **`coordinate` aims at the milestone's exits, not the product.** Step 5 should start from the goal's destination (the
  thin line, then Capxul on Capxul) and treat a tooling exit as off the path unless a product task waits on it. Add one
  line: "a sweep that starts no product task must say why".
- **`dispatch` assumes the Mac does all real work** and gives cloud threads only research. Add the cloud container as a
  runtime for product tasks that need Docker, Foundry or Frappe, with the setup this thread used.
- **`portal-ops` still says "give him the exact command"** for Tailscale. That breaks Aaron's standing rule never to hand
  him a command. Replace it with: find a way, or put one concrete need on Questions.
- **Missing: a builder's skill for product slices.** Nothing says how to take a spike part into a package (the order:
  book first, move, rebind evals, delete from the spike). The agent profiles cover a loop builder, not a cloud session.
- **Missing: a measure of product movement.** The sweep reports tasks and runs; it should report the thin line's pass
  count, so a week of tooling shows as zero movement.
- `plan-tasks` and `ask-aaron` are right as they are.

## What was done in this thread

Recorded in the pull request for this branch, with the checks that could and could not run in the cloud.
