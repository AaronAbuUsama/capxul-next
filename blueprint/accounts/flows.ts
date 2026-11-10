// The accounts concept's Core SDK flows (A4: the SDK owns every flow and all signing).
//
// - client.auth.sign-in and client.auth.verify-otp: the sign-in commands. Sessions, codes and an
//   agent's key challenge are access' rpcs; these flows sit in accounts because both commands end by
//   reporting the account's setup (shared decision `operations.sign-in-in-accounts`).
// - client.account.setup: the web app's setup page (React SDK), the only caller of the setup start.
// - client.operator.waitlist.admit: the operator's waitlist tool, the only caller of an admission.
//
// client.account.setup and client.operator.waitlist.admit implement no operation; they are the surfaces P2 lets an
// rpc be reached from. The owner's later collection of its claim escrows, `payment claim`, is payments' flow
// client.payments.claim over this concept's rpc `accounts.setup.collect` (aaron.payment-claim, payments.claim-command).

import { Schema } from "effect";
import { budget, defineFlow } from "../../packages/blueprint-engine/src/index.ts";
import { integration_openfort } from "../shared/external.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { rpc_accounts_admission_admit } from "./admission.ts";
import {
  rpc_access_sign_in_challenge,
  rpc_access_sign_in_send_code,
  rpc_access_sign_in_verify_code,
  rpc_access_sign_in_with_key,
} from "../access/sign-in.ts";
import { rpc_accounts_setup_check, rpc_accounts_setup_lifecycle, rpc_accounts_setup_start, SetupCheck } from "./setup.ts";

const CLI = "apps/cli/src";
const SDK = "packages/sdk/src";

const S = Schema.String;

/** A signed-in person, as the sign-in commands print them. */
const SignedIn = Schema.Struct({
  authenticated: Schema.Literal(true),
  email: S,
  authUserId: S,
  expiresAt: Schema.Number,
  setup: SetupCheck,
});

/** An agent signed in with its own key (designed W9). */
const SignedInAsAgent = Schema.Struct({ handle: S, kind: Schema.Literal("agent"), owner: S });

/** A sign-in that sent the code and stopped: no terminal and no `--otp-stdin`. */
const CodeSent = Schema.Struct({
  authenticated: Schema.Literal(false),
  status: Schema.Literal("otp-required"),
  email: S,
  journeyId: S,
  next: Schema.Struct({ argv: Schema.Array(S) }),
});

export const flow_client_auth_sign_in = defineFlow({
  id: "client.auth.sign-in",
  title: "Sign in by an emailed code, or as an agent by its own key",
  about:
    "A person: access sends a six-digit code to the email. At a terminal the flow asks for it (three tries; a wrong code " +
    "is asked again, then the backend's INVALID_INPUT ends it); with `--otp-stdin` it reads one; with neither (a script, " +
    "an agent, `--json`) it stops with `otp-required`, the waiting sign-in saved on this machine and the `capxul auth " +
    "verify` argv, and saves no session. A verified code returns the session, which the flow saves and makes current, " +
    "then it reads the account's setup (`accounts.setup.check`): a refused setup reads `setup-required` with its code, " +
    "since signing in must still succeed. An agent (`--own-key file|env`, no email): access issues a challenge, the " +
    "agent's key signs it on this machine, and access signs in as the agent whose Safe that key solely owns " +
    "(NOT_AUTHENTICATED for no agent, or a frozen one); its account is made by `agent create`, not here. It never opens a " +
    "browser. Its refusals are its steps': a wrong or expired code, too many tries, an unknown or frozen agent.",
  component: component_core_sdk,
  sdk: "client.auth.signIn",
  input: Schema.Union([
    Schema.Struct({ email: S, code: Schema.Literals(["prompt", "stdin", "none"]) }),
    Schema.Struct({ ownKey: Schema.Literals(["file", "env"]) }),
  ]),
  output: Schema.Union([SignedIn, CodeSent, SignedInAsAgent]),
  steps: [
    { name: "send-code", rpc: rpc_access_sign_in_send_code, about: "A person: access sends the code to the email, within its send cooldown." },
    { name: "code", local: "prompt", about: "Asks for the code at a terminal (three tries) or reads one from stdin; with neither, saves the waiting sign-in and stops." },
    { name: "verify", rpc: rpc_access_sign_in_verify_code, about: "Checks the code; a verified one returns the session." },
    { name: "challenge", rpc: rpc_access_sign_in_challenge, about: "An agent: a fresh challenge for its Safe, kept on this machine with its key." },
    { name: "sign-challenge", local: "sign", about: "The agent's own key, from its file or CAPXUL_PRIVATE_KEY, signs the challenge here." },
    { name: "key-sign-in", rpc: rpc_access_sign_in_with_key, about: "Access checks the signature against the agent's Safe owner and returns its session." },
    { name: "save", local: "cache", about: "Saves the session on this machine and makes the person or agent current." },
    { name: "setup", rpc: rpc_accounts_setup_check, about: "A person's setup: `ready`, or `setup-required` with the setup page and the argv that checks again." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: { ...budget("vendor"), excludes: ["sdk.step.code"] },
  was: [`${CLI}/commands/auth`, `${CLI}/auth/profile-report.ts:36`, `${SDK}/access`, "apps/docs/factory/operations/auth.login.yaml"],
});

export const flow_client_auth_verify_otp = defineFlow({
  id: "client.auth.verify-otp",
  title: "Finish a waiting sign-in with its code",
  about:
    "Finds the sign-in `auth login` saved on this machine (the last one, or the one for `--email`); none is the CLI's " +
    "CLI_USAGE, pointing to `capxul auth login`. Takes the code as an argument or from `--otp-stdin`, one try. Access " +
    "checks it (a wrong code INVALID_INPUT, an expired one OTP_EXPIRED); a verified code's session is saved and made " +
    "current, and the waiting sign-in cleared. Then it reads the setup as `auth login` does, and never opens a browser.",
  component: component_core_sdk,
  sdk: "client.auth.verifyOtp",
  input: Schema.Struct({ code: S, email: Schema.optionalKey(S) }),
  output: SignedIn,
  steps: [
    { name: "waiting", local: "cache", about: "The waiting sign-in for `--email`, or the last one; none ends with CLI_USAGE." },
    { name: "verify", rpc: rpc_access_sign_in_verify_code, about: "Checks the code once; a verified one returns the session." },
    { name: "save", local: "cache", about: "Saves the session, makes the person current and clears the waiting sign-in." },
    { name: "setup", rpc: rpc_accounts_setup_check, about: "The setup: `ready`, or `setup-required` with the setup page; a refused setup reads `setup-required`." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("write"),
  was: [`${CLI}/commands/auth`, "apps/docs/factory/operations/auth.verify.yaml"],
});

export const flow_client_account_setup = defineFlow({
  id: "client.account.setup",
  title: "Set up the person's own Safe in the web app",
  about:
    "Serves the web app's setup page (React SDK), not the CLI: the CLI never starts setup. After the person's profile " +
    "(parties' flow on the same page), it reads the embedded signer's address (Openfort; nothing is signed for the " +
    "claim, which Companies House's claim role sends), starts or " +
    "resumes the setup (`accounts.setup.start`), and follows it (`accounts.setup.lifecycle`) until the Safe is claimed " +
    "or the setup fails. When claim escrows were waiting for the person, the setup opens one approval to collect them, " +
    "and the page hands the person to the approval page to sign it.",
  component: component_core_sdk,
  surfaces: ["react"],
  sdk: "client.account.setup",
  input: Schema.Struct({}),
  output: Schema.Struct({ lifecycle: Schema.Unknown }),
  steps: [
    { name: "signer", local: "sign", about: "The embedded wallet's address, after its readiness cycle." },
    { name: "start", rpc: rpc_accounts_setup_start, about: "Starts, resumes or retries the setup with that signer." },
    { name: "follow", rpc: rpc_accounts_setup_lifecycle, about: "Reads where setup stands, once a second, until it is ready or failed." },
    { name: "claim", local: "wait", about: "Waits for the chain: the claim's receipt and Ponder indexing it." },
    { name: "collect", local: "wait", about: "When an approval to collect claim escrows is open, the person signs it on the approval page." },
  ],
  errors: [],
  calls: [integration_openfort.c.getAddress],
  spans: [],
  budget: budget("vendor"),
  was: [`${SDK}/accounts/account-setup.ts:86`, `${SDK}/accounts/account-lane.ts:72`, "apps/docs/factory/operations/account.retry.yaml"],
});

export const flow_client_operator_waitlist_admit = defineFlow({
  id: "client.operator.waitlist.admit",
  title: "The operator's waitlist tool admits a wave of mailboxes",
  about:
    "Serves the operator's waitlist tool (old `beta-waitlist.ts admit`), run with the deployment's operator key, not the " +
    "CLI. It sends the emails and the operator's label to `accounts.admission.admit` and prints who was admitted, who " +
    "was already and which were not emails. It is the only way an operator admits a waiting person in a closed beta.",
  component: component_core_sdk,
  surfaces: ["sdk"],
  sdk: "client.operator.waitlist.admit",
  input: Schema.Struct({ emails: Schema.Array(S), by: S }),
  output: Schema.Struct({ admitted: Schema.Array(S), already: Schema.Array(S), invalid: Schema.Array(S) }),
  steps: [{ name: "admit", rpc: rpc_accounts_admission_admit, about: "Admits the wave in one transaction." }],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("write"),
  was: ["packages/backend/scripts/beta-waitlist.ts", "packages/backend/src/access/waitlist/operations/admit.ts:23"],
});
