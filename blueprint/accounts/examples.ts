// The examples of accounts' operations. Not a record and not a module in index.ts: operations.ts imports the lists.
// Ids 800 to 849 are accounts'. `auth login` for a new agent takes `--country`; the example uses the neutral code ZZ.

import {
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROFILE_NOT_FOUND,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { ADDRESS, ID, PEOPLE, hash, ok, refused, uuid } from "../shared/examples.ts";

const hannah = PEOPLE.hannah.email;
const ready = (safe: string, collected = 0) => ({ setupState: "ready", setupUrl: null, next: null, safe, claimed: true, collected });
const needsSetup = {
  setupState: "setup-required",
  setupUrl: "https://app.capxul.test/setup",
  next: { argv: ["capxul", "account", "retry", "--json"] },
  safe: ADDRESS.priya,
  claimed: false,
  collected: 0,
};
const signedIn = (email: string, userId: string, setup: unknown) => ({
  authenticated: true,
  email,
  authUserId: userId,
  expiresAt: Date.parse("2026-03-12T09:30:00Z"),
  setup,
});

export const examples_account_retry = [
  ok("Hannah's account is ready", "capxul account retry --json", ready(ADDRESS.hannah)),
  ok("Priya has not finished setup: the link to finish it", "capxul account retry --email priya.raman@northwind.test --json", needsSetup),
  refused("Not signed in", "capxul account retry --json", error_NOT_AUTHENTICATED),
  refused("The Safe is already claimed by another signer", "capxul account retry --json", error_WRONG_STATE),
];

export const examples_account_show = [
  ok("Hannah's Safe is ready", "capxul account show --json", { lifecycle: { status: "ready", safe: ADDRESS.hannah, canTransact: true, collecting: false } }),
  ok("Priya's setup is still running", "capxul account show --email priya.raman@northwind.test --json", { lifecycle: { status: "settingUp", step: "claiming" } }),
  ok("A setup the chain refused", "capxul account show --email priya.raman@northwind.test --json", {
    lifecycle: { status: "failed", at: "claiming", error: { code: "WRONG_STATE", message: "The Safe is already claimed by another signer." } },
  }),
  refused("Run before the profile was completed", "capxul account show --json", error_PROFILE_NOT_FOUND),
  refused("The profile is done but the Safe's setup has not started", "capxul account show --json", error_SMART_ACCOUNT_MISSING),
  refused("Not signed in", "capxul account show --json", error_NOT_AUTHENTICATED),
];

export const examples_auth_login = [
  ok("Without a terminal it only sends the code", `capxul auth login --email ${hannah} --json`, {
    authenticated: false,
    status: "otp-required",
    email: hannah,
    journeyId: uuid(801),
    next: { argv: ["capxul", "auth", "verify", "<code>", "--email", hannah, "--json"] },
  }),
  ok("With the code on standard input it finishes in one go", `capxul auth login --email ${hannah} --otp-stdin --json`, signedIn(hannah, ID.hannah, ready(ADDRESS.hannah))),
  ok(
    "An agent signs in with its own key",
    `capxul auth login --own-key file --name ledger-agent --country ZZ --handle ledger-agent --email ${hannah} --otp-stdin --json`,
    { handle: "ledger-agent", kind: "agent", owner: hannah },
  ),
  refused("A name without --own-key", `capxul auth login --email ${hannah} --name ledger-agent --json`, error_CLI_USAGE),
  refused("The code is wrong", `capxul auth login --email ${hannah} --otp-stdin --json`, error_INVALID_INPUT),
  refused("The agent's key signs for no account", `capxul auth login --own-key file --email ${hannah} --otp-stdin --json`, error_NOT_AUTHENTICATED),
];

export const examples_auth_verify = [
  ok("Finish the sign-in the login started", `capxul auth verify 482913 --email ${PEOPLE.priya.email} --json`, signedIn(PEOPLE.priya.email, ID.priya, needsSetup)),
  refused("No sign-in is waiting for a code on this machine", "capxul auth verify 482913 --json", error_CLI_USAGE),
];

export const examples_dev_fund = [
  ok("Fund Hannah's own Safe with the default 100 USDC", "capxul dev fund --json", { amount: { asset: "USDC", value: "100.00" }, txHash: hash("d1") }),
  ok("Fund Northwind's company Safe on a local devnet", "capxul dev fund 5000 --org northwind --json", { amount: { asset: "USDC", value: "5000.00" }, txHash: hash("d2") }),
  refused("The Organization handle does not exist", "capxul dev fund 5000 --org nowhere --json", error_INVALID_INPUT),
  refused("--org outside a local devnet", "capxul dev fund 5000 --org northwind --json", error_WRONG_ENVIRONMENT),
  refused("Still on the waitlist", "capxul dev fund --json", error_FEATURE_NOT_AVAILABLE),
  refused("Not signed in", "capxul dev fund --json", error_NOT_AUTHENTICATED),
  refused("The Safe's setup has not started", "capxul dev fund --json", error_SMART_ACCOUNT_MISSING),
];
