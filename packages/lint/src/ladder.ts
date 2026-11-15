// The ladder: the rungs `pnpm check` climbs in order, and the proof after them, each with its command and what fails
// it. Declared once here; `pnpm generate` writes the table in AGENTS.md ("The ladder") from it.

/** One rung of the ladder, in the words of its row in AGENTS.md. */
export interface Rung {
  /** Its number and name, such as `1. Shape`. */
  readonly rung: string;
  /** The command or commands that run it, in Markdown. */
  readonly command: string;
  /** What fails it, in Markdown. */
  readonly fails: string;
}

/** The rungs, in the order they run. Rungs 1 to 5 are `pnpm check`; rung 6 is the proof in a fresh world. */
export const LADDER: ReadonlyArray<Rung> = [
  {
    rung: "1. Shape",
    command: "`pnpm shape`",
    fails:
      "An entry at the top level, a package or a file under `docs/` that `packages/lint/src/shape.ts` does not list; a package or spike with no `README.md`; a source file under `packages/` over 300 lines; the two lists of entry files in `.oxlintrc.json` naming different paths",
  },
  {
    rung: "2. Format",
    command: "`pnpm format:check`, `pnpm generate:check`, `pnpm seed:check`",
    fails:
      "TypeScript or JavaScript under `packages/` that oxfmt would change (config: `packages/lint/oxfmt.json`); a generated file that `pnpm generate` would write differently (it builds the contracts with Foundry first, `packages/generate`); a seeded chain state (`packages/contracts/state/core.json`, `deployments/devnet.json`) that `pnpm seed` would rebuild differently",
  },
  {
    rung: "3. Lint",
    command: "`pnpm lint`",
    fails:
      "Any finding of `.oxlintrc.json`, every rule an error: oxlint's correctness and suspicious rules and a few more, all of Effect's rules from `@effect/tsgo` but two (each off with its reason), and ours from `packages/lint` (below)",
  },
  {
    rung: "4. Types",
    command: "`pnpm types`",
    fails: "A type error in any TypeScript package, or an Effect language service error or warning (`effect-tsgo tsc`)",
  },
  {
    rung: "5. Tests",
    command: "`pnpm test`, then `pnpm delta:check` (and `pnpm ratchets` from 3.6)",
    fails:
      "A failing unit test in any package (`pnpm frappe:test` and `pnpm status:test` included). Foundry's tests in `packages/contracts` are not in it: CI builds only the contracts, not their tests. Then the delta check: an operation that lacks a format that exists and is not on that format's `unmigrated` list (`packages/blueprint-tools/src/checks/formats.ts`). From 3.6, a ratchet whose list grew",
  },
  {
    rung: "6. Proof",
    command: "`packages/runner/run.sh scenarios` (and `prove.yml` from 4.5)",
    fails:
      "A scenario that fails in a fresh world; from 3.7, a newly declared move, refusal or outcome no journey reaches. CI runs it in `.github/workflows/world.yml` once the bootstrap has given CI its Cloudflare and Neon keys (roadmap step 1.8)",
  },
];
