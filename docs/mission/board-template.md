# Mission board template

Mission Control publishes this board as an Artifact with a shared database (the
`db` capability), so Mission Control and Aaron see the same live state. It
changes rows with `ArtifactData`, and never by republishing the page. The page
shows the header, then one section per milestone in critical-path order, then
the tasks inside each milestone.

## Header (one row, `mission`)

| Field | Meaning |
|---|---|
| `goal` | One sentence each for both goals: Capxul rebuilt, and swarmD able to build it. |
| `understanding` | Mission Control's read-back of the mission. At most 200 words. |
| `critical_path` | The ordered milestone ids. |
| `now` | What is moving right now, in one line. |
| `needs_aaron` | Open decision packs, each linked. |
| `updated_at` | When the row last changed. |

## Milestone (`milestones` collection)

| Field | Meaning |
|---|---|
| `id` | For example `M2`. |
| `title` | The outcome, not the activity. Example: "A unit mission converges on swarmD without a person". |
| `critical` | `true` when it is on the critical path; `false` for work in parallel or at low priority. |
| `exit` | The checks that close it: observable, each one a command, a scoreboard value or a link. |
| `needs` | The milestone ids it waits on. |
| `state` | `not started`, `active`, `blocked`, `done` or `dropped`. |
| `evidence` | Links that prove the exit checks, once done. |

## Task (`tasks` collection)

| Field | Meaning |
|---|---|
| `id` | For example `M2.3`. |
| `milestone` | The milestone id. |
| `objective` | The goal, plus how to tell it is met. It holds no steps. |
| `owner` | The thread or router that owns it: a Claude session id, `swarmd:<ns>/<router>`, or `aaron`. |
| `kind` | `design`, `build`, `fix-swarmd`, `decision`, `ops` or `research`. |
| `state` | `queued`, `running`, `review`, `blocked`, `done` or `dropped`. |
| `blocker` | When blocked: what blocks it, and the way around it being tried. |
| `pr` | The pull request or branch going into the integration branch. |
| `evidence` | Links to the eval run, the trace or the scoreboard entry. |
| `cost` | Spend so far, where it is known. |
| `updated_at` | When the row last changed. |

## Rules

- **A task's state comes from its owner's report or from the PR,** never from
  hope. A task is `done` only when its evidence link proves its objective.
- **A blocked task names a way around it.** Mission Control tries that way
  before it asks Aaron.
- **Rows are added, and they change state.** A dropped task stays on the board,
  marked `dropped`, with its reason.
