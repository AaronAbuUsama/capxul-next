# Hosted-FDE dependency closure — 12 November 2026

This is archival evidence, not a runtime implementation or passing verdict. Full before sources are copied byte-for-byte from commit e30fd974a53518eb5a0ddbb9c5926c1604bd20b6, under their concept folders; worlds.ts is the original blueprint/devnet/worlds.ts. Nothing in this directory is imported by the blueprint.

## Authority and scope

Aaron accepted cut.fde-parked in plan/answers.jsonl, answer a-20261110T105549-97fc52 at 2026-11-10T10:55:49.335Z. blueprint/shared/cut.ts parks hosted tables, machines and processes. organizations.tables and aaron.frappe-shape reaffirm no hosted provisioning on 11 November; no later reversal was found by the integrator. organizations.hosted-fde-closure closes the stale implementation dependencies. Historical alternative choices and hosted rationales are not current authority.

Preserve ordinary company mint, deployMoney, founder install approval, finality, founder Seat, retry and failure handling. Preserve self-run agents with local keys, Board control, Party finality and AgentRemoved Seat cleanup. No org_fdes table, hosted key, host source door, borrowed asker authority or fabricated success is introduced. Other historical devnet worlds are preserved verbatim.

## Exact record and eval disposition

2752 → 2738 records; 5247 → 5227 evals. 21 removed eval IDs, 1 replacement eval IDs, 1 changed contract at a retained ID. Full old/new claim text, decider, subject, owner, source slice and prerequisite differences are in [disposition.json](disposition.json). No status/status.json or receipt is changed.

| Removed record | Owner | Disposition |
| --- | --- | --- |
| `integration:fde-host` | shared | parked by accepted cut |
| `call:fde-host.provision` | shared | parked by accepted cut |
| `event:org_fde_transitioned` | organizations | parked by accepted cut |
| `machine:org-fde` | organizations | parked by accepted cut |
| `transition:org-fde.provision` | organizations | parked by accepted cut |
| `transition:org-fde.start` | organizations | parked by accepted cut |
| `transition:org-fde.fall_due` | organizations | parked by accepted cut |
| `transition:org-fde.extend` | organizations | parked by accepted cut |
| `transition:org-fde.pause` | organizations | parked by accepted cut |
| `transition:org-fde.wake` | organizations | parked by accepted cut |
| `transition:org-fde.resume` | organizations | parked by accepted cut |
| `transition:org-fde.retire` | organizations | parked by accepted cut |
| `table:org-fdes` | organizations | parked by accepted cut |
| `transition:agent.found` | agents | parked by accepted cut |
| `workflow:agents.fde.follow-setup` | agents | parked by accepted cut |

| Removed eval / claim ID | Owner | Disposition |
| --- | --- | --- |
| `acc:org.seats.show/c-e972e82052a7c15d` | organizations | replaced-self-run-control |
| `tbl:org-fdes/schema` | organizations | parked-by-accepted-cut |
| `tbl:org-fdes/writers` | organizations | parked-by-accepted-cut |
| `tbl:org-fdes/tenancy` | organizations | parked-by-accepted-cut |
| `trn:org-fde.provision` | organizations | parked-by-accepted-cut |
| `trn:org-fde.start` | organizations | parked-by-accepted-cut |
| `trn:org-fde.fall_due` | organizations | parked-by-accepted-cut |
| `trn:org-fde.extend` | organizations | parked-by-accepted-cut |
| `trn:org-fde.pause` | organizations | parked-by-accepted-cut |
| `trn:org-fde.wake` | organizations | parked-by-accepted-cut |
| `trn:org-fde.resume` | organizations | parked-by-accepted-cut |
| `trn:org-fde.retire` | organizations | parked-by-accepted-cut |
| `trn:agent.found` | agents | parked-by-accepted-cut |
| `wfl:agents.fde.follow-setup/idempotent` | agents | parked-by-accepted-cut |
| `wfl:agents.fde.follow-setup/resume` | agents | parked-by-accepted-cut |
| `bud:agents.fde.follow-setup/p95` | agents | parked-by-accepted-cut |
| `wfl:agents.fde.follow-setup/wake/setup-ended` | agents | parked-by-accepted-cut |
| `int:fde-host/conformance` | shared | parked-by-accepted-cut |
| `int:fde-host.provision/PROVIDER_ERROR/c-b4e1521b3614f109` | shared | parked-by-accepted-cut |
| `int:fde-host.provision/RATE_LIMITED/c-082564ac625296da` | shared | parked-by-accepted-cut |
| `int:fde-host.provision/PROVIDER_RESPONSE_INVALID/c-64b9514111d2dff3` | shared | parked-by-accepted-cut |

## Replacement and retained contracts

The ordinary own-agent seat control replaces hosted org-with-fde with new org-with-own-agent (from org-ready; local env key, normal agent create --org, real Board proposal, then an explicit agent Seat offer). Agent creation alone does not create a Seat: the offer establishes ownAgent under the seats-show source contract. Existing org-with-agent has extra human members, so cannot independently prove seatsUsed=1. The pending-invitation control and ten-human-seat limit remain unchanged. No historical hosted world is rewritten or executed as a fake passing fixture.

- Replacement `acc:org.seats.show/c-c94d2b5d0bc5e8f4`: An open offer reserves a seat, and the Organization's own self-run agent rides beside the ten. Observes: cli: from org-with-pending-invitation, offersReserved 1; from org-with-own-agent, seatsUsed 1 and ownAgent true. The agent is created with a local key, its Board proposal approved, and explicitly offered an agent Seat, with no hosted birth.
- Retained `wfl:organizations.setups.set-up/idempotent`: removes only host provision from the setup idempotency key narrative. Mint/deploy signed-byte persistence and install approval idempotency remain required. Prior proof is stale, not passed.

The shared extension removes only fde-host integration/call/failures and dangling affects links in shared/time and shared/devnet/organization historical decisions. Chosen current-scope follower/snapshot decisions already park hosted namespaces. No Shared runtime, provider, spans or owner GUC code is touched. Legacy org.member.grant binding c-6412f20281167621 remains byte-identical and uniquely owned pending Board coordination.

The regenerated slice-0 set changes from 867 to 848 required evals. This is a declaration change only, not acceptance. Harness must independently regenerate after composition and prove the entire current gate in ONE fresh receipt-first Postgres/Ponder+ERPNext+v4 run, not a union of earlier proofs.
