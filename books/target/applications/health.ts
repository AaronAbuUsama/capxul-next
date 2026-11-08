// Applications' health area: the deployment's answer to `doctor --online`. It moved here from old
// operator's diagnostics (decision concepts.devnet): `doctor` checks the deployment and the app key,
// which is what the bootstrap describes. The old environment, clock and chain-head diagnostics are not
// ported (decision applications.health-only).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_applications } from "../shared/foundation.ts";
import { error_INVALID_INPUT } from "../shared/vocabulary.ts";

const ASIS = "docs/as-is/archive/operator/diagnostics.ts";
const OLD = "packages/backend/src/operator/diagnostics";

const S = Schema.String;

export const rpc_applications_health_check = defineRpc({
  id: "applications.health.check",
  title: "Echo a nonce with the deployment that answered",
  about:
    "Answers the caller's nonce (1 to 128 printable characters, else INVALID_INPUT), the deployment's name (`devnet`, " +
    "`staging`), the commit it runs (DEPLOYED_GIT_SHA, null on a devnet built from a working tree) and its clock. It reads " +
    "no table and calls nothing, so an answer proves the deployment is up and that this request reached it, not that " +
    "its dependencies are well. The caller checks the echo before it reports the deployment reached.",
  concept: concept_applications,
  kind: "query",
  who: "Anyone who can reach the deployment. No sign-in is needed.",
  input: Schema.Struct({ nonce: S }),
  output: Schema.Struct({ nonce: S, deployment: S, commit: Schema.NullOr(S), at: Schema.Number }),
  errors: [error_INVALID_INPUT],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${ASIS}:25`, `${OLD}/operations/health.ts:13`, `${OLD}/reads.ts:13`],
});
