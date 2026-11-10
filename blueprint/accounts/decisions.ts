// Every judgment of the accounts design, as a decision record linked to the records it shapes.
//
// Made by Claude on 8 November 2026 under the accepted decisions A1-A4 and P1-P10 and the shared
// target decisions, with the as-is book (docs/as-is/archive/accounts, docs/as-is/archive/access) and the old code
// (/home/user/factory, integration/factory) as evidence.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { contract_companies_house_claimer, contract_erc20, contract_escrow, integration_service_signer } from "../shared/external.ts";
import { concept_accounts, concept_organizations, concept_payments } from "../shared/foundation.ts";
import { error_PROFILE_NOT_FOUND, error_SMART_ACCOUNT_MISSING, error_WRONG_ENVIRONMENT } from "../shared/vocabulary.ts";
import { rpc_accounts_admission_admit,  } from "./admission.ts";
import {
  event_personal_safe_transitioned,
  event_referral_transitioned,
  event_waitlist_entry_transitioned,
  machine_personal_safe,
  machine_referral,
  machine_waitlist_entry,
  table_personal_safes,
  table_referral_codes,
  table_referrals,
  table_admissions,
} from "./data.ts";
import {
  flow_client_account_setup,
  flow_client_auth_sign_in,
  flow_client_auth_verify_otp,
  flow_client_operator_waitlist_admit,
} from "./flows.ts";
import { rpc_accounts_grants_fund } from "./grants.ts";
import * as ops from "./operations.ts";
import { procedure_accounts_admit } from "./procedures.ts";
import { workflow_accounts_setup_personal_safe } from "./processes.ts";
import { rpc_accounts_setup_check, rpc_accounts_setup_collect, rpc_accounts_setup_lifecycle, rpc_accounts_setup_start } from "./setup.ts";

const by = (evidence: string) => `Claude, accounts design, 8 November 2026; evidence: ${evidence}`;

const ALL_OPERATIONS = [
  ops.operation_account_retry,
  ops.operation_account_show,
  ops.operation_auth_login,
  ops.operation_auth_verify,
  ops.operation_dev_fund,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_accounts_tables = defineDecision({
  id: "accounts.tables",
  title: "Four tables: the old eight admission and Safe stores shrink to what is used",
  question:
    "Old accounts kept accounts, smartAccounts, welcomeFundingGrants and serviceLanes; old access kept betaWaitlist, " +
    "betaWaitlistWindows, referralCodes and referrals. Which does the target keep, and in what shape?",
  options: [
    {
      label: "four",
      text:
        "admissions, referral-codes, referrals and personal-safes. The logical Account row, the welcome-grant rows, the " +
        "service-key lane and the request form's IP window go; no chain id column.",
    },
    { label: "port", text: "Keep all eight with their columns, renamed to snake case." },
    { label: "one-mailbox-row", text: "As four, but merge the waitlist entry and the referral code into one row per mailbox." },
  ],
  chosen: "four",
  why:
    "The logical Account (`account_` + ULID bound to the Safe) was a second identity next to the Party; in the target the " +
    "person's Party in parties is the name money is routed to, and the Safe is a pure function of the email, so the row " +
    "holds nothing a reader cannot get from parties and personal-safes (P2). Welcome grants are a step of the setup " +
    "process, whose instance makes them once, so their rows and machine are plumbing (P3). The lane is the service-signer " +
    "integration's (shared `responsibilities.service-lanes`). The IP window served only the public form, which is not " +
    "ported. One deployment runs one chain, so a chain column would be the same value in every row. The entry and the " +
    "code stay apart: a code is made for a person who never joined, and making an entry for them would send a `join` " +
    "that never happened.",
  source: by("packages/backend/src/accounts/tables.ts:15,35,62; packages/backend/src/access/tables.ts:177,213,229; docs/as-is/archive/accounts/data.ts"),
  affects: [table_admissions, table_referral_codes, table_referrals, table_personal_safes, concept_accounts],
});

export const decision_accounts_mailbox_tenancy = defineDecision({
  id: "accounts.mailbox-tenancy",
  title: "Admission and referrals are keyed by the mailbox; a referral is its referrer's",
  question:
    "P8 gives a person's rows a `person_id`. An invite, an operator or an Organization's invitation admits an email that " +
    "may never have signed in. What is the tenant of the waitlist, the codes and the referrals?",
  options: [
    { label: "mailbox", text: "Tenancy `person` with the normalized email as the tenant column; a referral row is the referrer's, with a unique cross-tenant index on the referee." },
    { label: "person-id", text: "Require a principal: admitting a friend would first create their principal in access, which accounts cannot write." },
    { label: "global", text: "System-only rows read through accounts' rpcs, with no tenant column." },
  ],
  chosen: "mailbox",
  why:
    "Access knows a person by their email, so the mailbox is the person's identity before and after they sign in, and the " +
    "row-level policy can match the session's verified email as it matches its person id. `global` is for rows only the " +
    "system writes, and a person writes their own note. A referral is acted on by its referrer (invite, list, counts), " +
    "so it is theirs; the friend sees only who referred them, through `by-referee`, which is cross-tenant by design " +
    "because the first referral of a mailbox wins whoever made it. personal-safes is a signed-in person's, so it keys on " +
    "`person_id`.",
  source: by("P8; packages/backend/src/access/tables.ts:177,229; docs/as-is/archive/access/data.ts (beta-waitlist, referrals)"),
  affects: [
    table_admissions,
    table_referral_codes,
    table_referrals,
    table_personal_safes,
  ],
});

export const decision_accounts_stored_states = defineDecision({
  id: "accounts.stored-states",
  title: "The waitlist entry and the referral store their state; births are transitions",
  question:
    "The old waitlist entry was admitted when `admittedAt` was set, and a referral's stage was the last of four " +
    "timestamps. P7 makes every status write a named transition with one event. What do the machines look like?",
  options: [
    {
      label: "stored",
      text:
        "A `status` and a `stage` column, with `waitlist-entry` (join, admit, admit_unlisted) and `referral` (attribute, admit, " +
        "qualify, reward, void); a birth is a transition from no state, so it sends its event too.",
    },
    { label: "derived", text: "Keep the timestamps and derive the state in reads; book the events on the rpcs." },
  ],
  chosen: "stored",
  why:
    "P7 sends events only from transitions, and the frozen operations name `waitlist_entry_transitioned` and " +
    "`referral_transitioned` on joins, admissions, attributions and voids, so each change must be a transition. A birth " +
    "(`from: []`) is how a row that starts life admitted (`admit_unlisted`) or attributed sends its one event without a " +
    "fake earlier state. The stage timestamps stay as columns, because `referral list` prints them. The old " +
    "`self_referral` void reason, which no code produced, is dropped; the old `joined` and `admitted` transition names " +
    "become verbs.",
  source: by("docs/as-is/archive/access/data.ts (machine_waitlist_entry, machine_referral); packages/backend/src/access/referrals/views.ts:8; P7"),
  affects: [machine_waitlist_entry, machine_referral, event_waitlist_entry_transitioned, event_referral_transitioned],
});

export const decision_accounts_events = defineDecision({
  id: "accounts.events",
  title: "Accounts' events carry no mailbox",
  question: "Each machine's event carries the ids a funnel needs. Admission and referral rows are keyed by email. Does the event carry it?",
  options: [
    { label: "no-mailbox", text: "No email in any property: `person_id` where it is known, the setup's person and Safe, and the runtime's actor." },
    { label: "mailbox", text: "Carry the email, as the row's id." },
  ],
  chosen: "no-mailbox",
  why:
    "Events leave Capxul for PostHog through the outbox; an email there is personal data in an analytics store, and the " +
    "old events never carried one (they were sent as the person or the referrer). The setup's event carries the person " +
    "and the Safe, which is enough for the activation funnel; an admission of a mailbox nobody has signed in with has no " +
    "person to name yet, and its later `personal_safe_transitioned` does.",
  source: by("packages/observability/src/events/referrals.ts:15,31; P7 (props: from, to, transition and the ids)"),
  affects: [event_waitlist_entry_transitioned, event_referral_transitioned, event_personal_safe_transitioned],
});

// ── the personal Safe ───────────────────────────────────────────────────────────────────────

export const decision_accounts_setup_process = defineDecision({
  id: "accounts.setup-process",
  title: "One durable process per personal Safe; ready at the claim, collection after",
  question:
    "The old claim was one Convex action the browser awaited: a ten-minute lock, a recorded submission, a send under the " +
    "service key's lane, a receipt wait and six store mutations. The designed v4 text adds collecting the claim escrows. " +
    "What is the target's shape, and when is the account ready?",
  options: [
    {
      label: "process",
      text:
        "A workflow instance per personal-safes row (claiming, collecting, ready, failed), run after each setup start: the " +
        "claim through the service signer, a wait for the chain and Ponder, then one collection approval; ready at the claim.",
    },
    { label: "awaited-action", text: "Keep one rpc that claims and waits for the receipt, with a lock row." },
    { label: "ready-after-collection", text: "As process, but the account is not ready until the person signs the collection." },
  ],
  chosen: "process",
  why:
    "A personal Safe's setup is on the shared list of long-lived objects (`rules.durable-processes`): it waits on the " +
    "chain and on a person and must survive a crash between broadcast and receipt, which an rpc cannot (A3). The " +
    "instance is the lock, and the service signer's recorded send is CAP-1097's never-twice rule, so the lock, lane and " +
    "store mutations go. Only chain proof moves it to `claim` (the claim's CapxulSafeClaimed, or the Safe already owned " +
    "by exactly this signer), and only the chain's refusal or a send that never left fails it. Ready does not wait on the " +
    "collection: the Safe is the person's at the claim, the escrows stay theirs to claim later (`payment claim`) or " +
    "their sender's to take back (D12), and holding sign-in at `setup-required` for an unsigned approval would block everything else.",
  source: by("docs/as-is/archive/accounts/claims.ts; packages/backend/src/accounts/claims/operations/claim.ts:34; account.retry.yaml (designed call)"),
  affects: [workflow_accounts_setup_personal_safe, machine_personal_safe, table_personal_safes, event_personal_safe_transitioned],
});

export const decision_accounts_setup_in_web_app = defineDecision({
  id: "accounts.setup-in-web-app",
  title: "The web app starts setup; the CLI only reads it",
  question:
    "No frozen operation starts a Safe's setup: `account retry` 'never opens a browser and never sets up the account from " +
    "the CLI'. P2 keeps no rpc nothing reaches. How is the setup start reached?",
  options: [
    { label: "web-flow", text: "`accounts.setup.start` is a step of `client.account.setup`, the web app's setup page, which also reads the signer and follows the setup." },
    { label: "cli", text: "Let `account retry` start setup." },
  ],
  chosen: "web-flow",
  why:
    "The designed text says setup in the browser ends with the claim, and the person's embedded signer lives only there. " +
    "P2 allows an rpc reached by a flow that serves another surface and says so; the start is an rpc (one transaction), and " +
    "the waiting is the process's. The start is idempotent on the person: the same signer answers the setup as it stands, " +
    "another signer is refused while a setup is live, and a failed setup is retried. The old provision, confirm-deployment " +
    "and claim rows collapse into it.",
  source: by("account.retry.yaml (changes, designed summary); packages/sdk/src/accounts/account-setup.ts:86; P2"),
  affects: [rpc_accounts_setup_start, flow_client_account_setup, ops.operation_account_retry],
});

export const decision_accounts_profile_before_setup = defineDecision({
  id: "accounts.profile-before-setup",
  title: "Setup follows the profile; the person's Party is parties' own",
  question:
    "The person's Party must route money to their Safe, and the old onboarding asked for a profile before the Safe. Does " +
    "the setup write the Party, and does it need the profile?",
  options: [
    { label: "profile-first", text: "The start needs the person's completed profile (PROFILE_NOT_FOUND) and writes nothing in parties." },
    { label: "register", text: "The start invokes `parties.register` with the person's Safe." },
    { label: "no-profile", text: "Set up the Safe with or without a profile." },
  ],
  chosen: "profile-first",
  why:
    "Parties gives every mailbox its Party at the email-derived Safe from the start and claims it for the person when they " +
    "complete their profile; `parties.register` is for Organizations' and agents' births only. The Safe is the same pure " +
    "function of the email either way, so a write from accounts would only repeat what parties holds. Requiring the " +
    "profile keeps one order on the setup page (profile, then Safe) and gives `account show` the PROFILE_NOT_FOUND its " +
    "frozen mistake names, which parties' design expects accounts to answer.",
  source: by("blueprint/parties/data.ts (parties, profiles); blueprint/parties/procedures.ts (parties.register); account.show.yaml (mistakes)"),
  affects: [rpc_accounts_setup_start, rpc_accounts_setup_lifecycle, rpc_accounts_setup_check, error_PROFILE_NOT_FOUND, table_personal_safes],
});

export const decision_accounts_setup_reads = defineDecision({
  id: "accounts.setup-reads",
  title: "Two setup reads: `account show`'s lifecycle and `account retry`'s check",
  question:
    "`account show` prints a failed lifecycle with its step and code; `account retry` refuses a chain-refused setup with " +
    "WRONG_STATE or INVALID_INPUT (designed); `auth login` and `auth verify` must report the setup and still succeed. One " +
    "read or several?",
  options: [
    {
      label: "two-reads",
      text:
        "`accounts.setup.lifecycle` for show (SMART_ACCOUNT_MISSING before any setup) and `accounts.setup.check` for retry; the " +
        "sign-in flows call check and read its refusals as `setup-required`.",
    },
    { label: "one-read", text: "One read returning everything as data, with two flows that turn data into refusals." },
  ],
  chosen: "two-reads",
  why:
    "Each command is then one rpc (A4), and the server, not the client, decides each refusal, so `rpc:<id>/errors` sees " +
    "it. `account show`'s mistake says it refuses before setup with PROFILE_NOT_FOUND or SMART_ACCOUNT_MISSING: the first " +
    "before the profile, the second after it and before the setup starts (`accounts.profile-before-setup`). " +
    "The old `loading` lifecycle was the SDK's own state before a session; without a session the target refuses " +
    "NOT_AUTHENTICATED, so it is gone. A claimed Safe reads `ready` while its escrows are collected. Show takes an optional " +
    "`personId` that must be the caller's, so its fourth acceptance line stays checkable.",
  source: by("account.show.yaml (mistakes, acceptance 4); account.retry.yaml (designed refusals); packages/sdk/src/accounts/account-lifecycle.ts:92"),
  affects: [
    rpc_accounts_setup_lifecycle,
    rpc_accounts_setup_check,
    ops.operation_account_show,
    ops.operation_account_retry,
    flow_client_auth_sign_in,
    flow_client_auth_verify_otp,
    error_SMART_ACCOUNT_MISSING,
    error_PROFILE_NOT_FOUND,
  ],
});

export const decision_accounts_welcome_grants = defineDecision({
  id: "accounts.welcome-grants",
  title: "Welcome grants are a staging-only step of the setup, with no table",
  question: "Old staging minted welcome test tokens into each new Safe through a grants table, a machine and a batch action. Keep them?",
  options: [
    { label: "setup-step", text: "One step of the setup process, after the claim, on staging with welcome funding on; once per asset by the instance." },
    { label: "drop", text: "Drop them: `dev fund` gives test money on request." },
    { label: "port", text: "Keep the grants table, its machine and a workflow." },
  ],
  chosen: "setup-step",
  why:
    "The concept map keeps welcome grants. The old table existed to make a mint happen once across repeated provisions " +
    "and repairs; one process instance per Safe already does that, and a failed mint is in its trace. An Organization's " +
    "welcome grant, if organizations keeps it, is a step of its own setup.",
  source: by("packages/backend/src/accounts/grants/operations/mint-welcome-grants.ts:20; packages/backend/src/accounts/tables.ts:62"),
  affects: [workflow_accounts_setup_personal_safe, concept_accounts],
});

// ── admission ───────────────────────────────────────────────────────────────────────────────

export const decision_accounts_qualify_from_chain = defineDecision({
  id: "accounts.qualify-from-chain",
  title: "Referral rewards follow the chain's CapxulSafeClaimed",
  question: "A referrer earns an invite when the person they referred gets a live Safe. What starts the qualify?",
  options: [
    { label: "chain-event", text: "A workflow per referral, triggered by the indexed CapxulSafeClaimed, finds the mailbox by the Safe." },
    { label: "setup-step", text: "A step of the setup process, in the claim's transaction." },
  ],
  chosen: "chain-event",
  why:
    "The concept map counts invites 'from the chain's Safe claims'. The chain event is the proof a reward pays for, it " +
    "still arrives when the setup that sent the claim died before recording it, and it keeps referrals out of the " +
    "setup's code. Its run is one transaction, keyed by the friend's mailbox, so a replayed or reindexed event earns " +
    "nothing twice. The old qualify, scheduled from the claim action, did the same work.",
  source: by("shared decision concepts.accounts; packages/backend/src/access/referrals/operations/qualify.ts:31; CapxulSafeClaimed"),
  affects: [machine_referral, contract_companies_house_claimer],
});

export const decision_accounts_operator_tools = defineDecision({
  id: "accounts.operator-tools",
  title: "The operator admits through its tool's flow; grant and void are one rpc",
  question:
    "Only `waitlist invites grant` of the operator's tool is frozen (with `invites void` beside it), but `waitlist status` " +
    "claims a person waits 'until an operator admits them'. What of the operator's admit, void and list?",
  options: [
    {
      label: "operator-surface",
      text:
        "`accounts.admission.admit`, reached by the operator tool's flow; grant and void one rpc that implements the frozen " +
        "operation; `waitlist list` dropped.",
    },
    { label: "no-admit", text: "Drop the operator's admission: only invites, invitations and the open gate admit." },
    { label: "one-rpc", text: "One rpc for the whole tool, with an input per subcommand." },
  ],
  chosen: "operator-surface",
  why:
    "The concept map gives accounts 'an operator's admissions', and the second `waitlist status` line cannot be checked " +
    "without one, so it stays; P2 lets it be reached by a flow that names its surface. Grant and void are the frozen " +
    "operation's two subcommands (its synopsis and its `referral_transitioned voided` event), so they share its rpc. " +
    "`waitlist list` is read by no frozen operation and no claim, so it goes (P2). An operator acts with the " +
    "deployment's operator key; without it every operator rpc is NOT_AUTHENTICATED.",
  source: by("waitlist.invites.grant.yaml (designed synopsis, also); waitlist.status.yaml (acceptance 2); packages/backend/scripts/beta-waitlist.ts"),
  affects: [
    rpc_accounts_admission_admit,
    flow_client_operator_waitlist_admit,
  ],
});

export const decision_accounts_admission_paths = defineDecision({
  id: "accounts.admission-paths",
  title: "The request form, the held sign-in record and the list email are not ported",
  question:
    "Old access also put people on the list through a public request form (paced per IP), recorded every sign-in the gate " +
    "held, and emailed a held person that they were on the list. Keep them?",
  options: [
    { label: "drop", text: "Drop all three: `waitlist join` is the way onto the list, and admissions come from operators, invites, invitations and rewards." },
    { label: "keep", text: "Port the form as an HTTP route, the hold record and the email." },
  ],
  chosen: "drop",
  why:
    "No frozen operation reaches the form or its window (P2), and the system's HTTP routes are the bootstrap, OAuth and " +
    "Bridge's webhook. The hold wrote a row inside a refusal, which the target's refusals forbid ('changes nothing'), and " +
    "it existed for the operator's list, which is dropped. The 'on the list' email followed old profile onboarding; any " +
    "email after a change is notices', from `waitlist_entry_transitioned`.",
  source: by("docs/as-is/archive/access/waitlist.ts (record, request, hold, deliver-on-the-list); P2; system_capxul surfaces"),
  affects: [table_admissions, machine_waitlist_entry, ],
});

export const decision_accounts_door = defineDecision({
  id: "accounts.door",
  title: "The door holds only `accounts.admit`; the concepts above read accounts' tables",
  question: "What does accounts offer the concepts above it (organizations, agents, payments, equity, notices)?",
  options: [
    { label: "admit-only", text: "One procedure, `accounts.admit`; the rest read personal-safes and admissions, or follow accounts' events." },
    { label: "read-procedures", text: "Procedures for each read (is admitted, live Safe of a person), as the old door had." },
  ],
  chosen: "admit-only",
  why:
    "A procedure is for a write that must commit with the invoker's (P4); reads need none, because a concept may read the " +
    "tables of what it depends on. Organizations needs 'the founder is admitted with a claimed Safe' (the two tables) and " +
    "follows no accounts event, since an invitee takes the Seat on accepting and no Seat waits; payments reads a live " +
    "Safe from the chain. `accounts.admit` takes what carries the admission (an invitation's Organization, or since " +
    "aaron.money-waiting-reminders an escrowed Payment: accounts.money-waiting-admits), answers whether it admitted, and " +
    "never welcomes an invitee or a recipient twice, as the shared ruling needs.",
  source: by("shared decision procedures.accounts-admit; org.member.invite.yaml (acceptance 1); packages/backend/src/accounts/index.ts"),
  affects: [procedure_accounts_admit, table_personal_safes, table_admissions, concept_organizations],
});

// ── commands ────────────────────────────────────────────────────────────────────────────────

export const decision_accounts_sign_in_flow = defineDecision({
  id: "accounts.sign-in-flow",
  title: "`auth login` is one flow for a person's code and an agent's own key",
  question:
    "`auth login` signs a person in by an emailed code; designed W9 adds `--own-key`, an agent signing a challenge. The old " +
    "`--own-key` also made an AI's account. One SDK method or two, and what of the account-making flags?",
  options: [
    { label: "one-flow", text: "`client.auth.sign-in` with both branches; the agent's account is `agent create`'s, so `--own-key` only signs in." },
    { label: "two-methods", text: "`signIn` and `signInWithKey`, the CLI choosing by flag." },
  ],
  chosen: "one-flow",
  why:
    "A4: the command calls exactly one SDK method, whichever flags it has. The designed text supersedes the old note that " +
    "`--own-key` makes an account (P10): `agent create` makes it, and `--name`, `--country` and `--handle` stay the CLI's " +
    "CLI_USAGE when given without `--own-key`, as the frozen mistake says. Both sign-in flows end by reading the setup, " +
    "which is why they are accounts' (shared `operations.sign-in-in-accounts`); their refusals are access' rpcs' " +
    "(INVALID_INPUT, OTP_EXPIRED, NOT_AUTHENTICATED), surfaced once the terminal's tries are spent.",
  source: by("auth.login.yaml (notes, mistakes, designed W9); auth.verify.yaml; A4; P10"),
  affects: [flow_client_auth_sign_in, flow_client_auth_verify_otp, ops.operation_auth_login, ops.operation_auth_verify],
});

export const decision_accounts_faucet = defineDecision({
  id: "accounts.faucet",
  title: "`dev fund` sends one faucet mint and answers at broadcast",
  question:
    "The old faucet minted from a backend-owned faucet Safe as a sponsored UserOperation and waited for inclusion inside " +
    "the request. The target has a faucet service key, and an rpc may not wait for the chain. What does `dev fund` do?",
  options: [
    { label: "send", text: "One action rpc: check, send the mint through the service signer, answer the hash at broadcast." },
    { label: "await", text: "Wait for the receipt in the rpc, as the old one did." },
    { label: "process", text: "A grant row and a workflow, polled by the SDK until minted." },
  ],
  chosen: "send",
  why:
    "Rule 5 keeps waits out of rpcs, and a test mint is not a long-lived object worth a table and a process. The service " +
    "signer records the signed bytes before broadcasting, so a lost answer lands or is looked up, never sent twice. It is " +
    "refused off test networks, and `--org` off a devnet, with WRONG_ENVIRONMENT (no devnet world reaches that refusal; " +
    "the staging `live:*` evals do). Admission is required, as `waitlist status` says of the faucet, and the person's " +
    "Safe is the one their setup names. The mint is the test tokens' open `ERC20.mint(recipient, amount)` (shared " +
    "`contracts.test-token-mint`), named in the `chain` of this rpc and of the setup's staging welcome step.",
  source: by("dev.fund.yaml; waitlist.status.yaml (notes); packages/backend/src/accounts/grants/external/mints.ts:76; packages/contracts/src/TestMoneyToken.sol:22"),
  affects: [rpc_accounts_grants_fund, workflow_accounts_setup_personal_safe, ops.operation_dev_fund, integration_service_signer, contract_erc20, error_WRONG_ENVIRONMENT],
});

export const decision_accounts_dropped_rows = defineDecision({
  id: "accounts.dropped-rows",
  title: "Old accounts' and access' internal rows are not ported",
  question: "Which old rows of accounts and of access' waitlist and referrals have no target counterpart?",
  options: [
    {
      label: "drop",
      text:
        "safes.provision, confirm-deployment, both loads, read-safe and record-deployment; the six claim store mutations; the " +
        "lanes; the telemetry posters; the grants' four transitions and batch; waitlist hold, list, record, request and its " +
        "preflight; both delivery workflows.",
    },
    { label: "port", text: "Port each as an rpc or workflow of accounts." },
  ],
  chosen: "drop",
  why:
    "The setup start, the two setup reads and the setup process do what provision, claim, the loads and confirm-deployment " +
    "did, and Ponder proves a deployment, so nothing confirms one by hand. The store mutations, lanes and grant " +
    "transitions were steps of one action (P3); the posters were telemetry, which transitions now send (P7). The waitlist " +
    "rows go with the form and the hold (`accounts.admission-paths`); the welcome and on-the-list emails are notices'. " +
    "Balances, summaries, approvals and agents left for activity, approvals and agents by the shared decisions.",
  source: by("docs/as-is/archive/accounts/safes.ts, claims.ts, grants.ts, lanes.ts; docs/as-is/archive/access/waitlist.ts, referrals.ts; P2; P3"),
  affects: [rpc_accounts_setup_start, rpc_accounts_setup_check, rpc_accounts_setup_lifecycle, workflow_accounts_setup_personal_safe, concept_accounts],
});

export const decision_accounts_worlds = defineDecision({
  id: "accounts.worlds",
  title: "The devnet worlds accounts' refusals and claims start from",
  question: "Which named devnet snapshots do accounts' refusals and acceptance lines need?",
  options: [
    {
      label: "eleven",
      text:
        "signed-out (nobody signed in here); person-signed-in (access': signed in, not on the list); person-on-waitlist " +
        "(signed in, on the list, closed beta); " +
        "person-admitted-no-profile (admitted, no profile); person-unclaimed (admitted, profile done, Safe not set up); " +
        "person-admitted-no-invites (all invites " +
        "spent); two-people-admitted (two admitted mailboxes with profiles, one signed " +
        "in); person-ready (Safe set up); setup-refused-other-signer (claim refused by SwapRefused); " +
        "setup-refused-non-ascii-email (claim refused by EmailNotNormalized); person-on-waitlist-open-beta " +
        "(person-on-waitlist with the `beta-access` gate on for everyone).",
    },
    { label: "per-test", text: "Build each state inside each eval from a fresh devnet." },
  ],
  chosen: "eleven",
  why:
    "Names already used by other concepts for the same state (signed-out, person-signed-in, person-on-waitlist, person-unclaimed, " +
    "person-ready) are reused, since a world is one shared snapshot. Each is made by running operations as the devnet's " +
    "fixed identities and saved (shared " +
    "`responsibilities.operator-proof-tools`): sign-in, `waitlist join`, the operator's admission, invites, the web setup " +
    "flow. The refused setups need the chain to refuse: the first restarts setup with a second signer after a claim " +
    "landed with the first; the second signs in with a mailbox whose local part is not ASCII (sign-in keeps it, " +
    "access.email-rule). The open beta is a world, not a `dev gates set` step: that command scripts only Organization " +
    "gates (devnet.scripted-gates), so the world builder seeds the PostHog fake with `beta-access` on at rollout 100 " +
    "for everyone before the sync. Only `dev fund`'s " +
    "WRONG_ENVIRONMENT has no devnet world (`?`). No acceptance claim names a mechanism; one, `waitlist status` #2, is " +
    "rewritten for Aaron's money-waiting ruling and also starts from devnet's person-with-money-waiting " +
    "(accounts.money-waiting-admits). Every operation is `normal`, since no pilot of the spine is among them.",
  source: by("docs/spec/30-capxul-evals.md; ICompaniesHouseClaimer.sol (SwapRefused, EmailNotNormalized); blueprint/baseline/operations.ts"),
  affects: [...ALL_OPERATIONS],
});

export const decision_accounts_no_acceptance = defineDecision({
  id: "accounts.no-acceptance",
  title: "dev fund and the waitlist grant get no acceptance lines from the design",
  question:
    "`dev fund` and `waitlist invites grant` had no acceptance lines in the old book, so each shows a no-acceptance gap. Should " +
    "the design write lines for them?",
  options: [
    { label: "none-yet", text: "Write none. Their returns, refusals, events and budgets are still evals; new lines need Aaron." },
    { label: "write-them", text: "Write acceptance lines for them now." },
  ],
  chosen: "none-yet",
  why:
    "An acceptance line is frozen surface (P1), and a line the design wrote would be a new public claim, which is Aaron's to " +
    "accept (equity.acceptance, devnet.no-acceptance). Both are operator and test tooling, and their refusals and returns are checked.",
  source: `Claude, handoff to the build, 8 November 2026; evidence: the no-acceptance gaps of the built target book`,
  affects: [concept_accounts, ops.operation_dev_fund],
});

// ── money waiting admits its recipient (aaron.money-waiting-reminders, 8 November 2026) ─────

export const decision_accounts_money_waiting_admits = defineDecision({
  id: "accounts.money-waiting-admits",
  title: "Money waiting in a claim escrow admits its recipient, as an invitation does",
  question:
    "Aaron ruled that waiting money admits its recipient to the beta as an invitation does (aaron.money-waiting-reminders): " +
    "without it, a recipient who is not admitted cannot set up the account that collects. Accounts owns admission. How is " +
    "a mailbox with money waiting for it in a claim escrow admitted, and what does `waitlist status` #2 now claim?",
  options: [
    {
      label: "procedure-at-escrow",
      text:
        "Payments invokes `accounts.admit` (`via` escrow, `ref` the Payment) in the transaction that moves a claim " +
        "escrow's Payment to `escrowed`, with the mailbox the Payment keeps; the admission is recorded (`escrow:<payment " +
        "id>`), never undone, and notices sends no second welcome: the money-waiting email is it. `waitlist status` #2 " +
        "names the second way in, the frozen claim first in its `was`.",
    },
    {
      label: "derived-at-gate",
      text:
        "Nothing is recorded: the beta gate (setup, the faucet, `referral invite`, `org create`) and `waitlist status` " +
        "read indexing's open claim escrows whose payee is the caller's email-derived Safe, and let the caller through " +
        "while one is open.",
    },
    { label: "at-prepare", text: "Admit when the payment is prepared, before the payer signs and before any money waits." },
  ],
  chosen: "procedure-at-escrow",
  why:
    "The ruling says 'as an invitation does', and an invitation admits through `accounts.admit` in the transaction " +
    "that writes it (procedures.accounts-admit): recorded, permanent, and the email that tells the person is the welcome. " +
    "The same moment for money is when it starts to wait: the escrow's funding is indexed and payments drives `escrow` (payments.escrow-on-funding). That is " +
    "the transition notices' money-waiting email follows, so the recipient is admitted before the email that sends " +
    "them to set up can arrive. Payments sits above accounts and holds the mailbox (`payee_mailbox`, " +
    "payments.claim-escrow-mailbox); accounts cannot follow payments' event (a cycle), and nothing below payments knows " +
    "the mailbox: the escrow names only the derived Safe and parties keeps only a digest. Derived at the gate would " +
    "need every gate, organizations' `org create` among them, to read the chain, and money taken back before the " +
    "recipient signs in would leave them waiting again, which an invitation never does. At prepare would admit for " +
    "money that may never be signed. The transaction stays narrow: `escrow` invokes nothing else (sys:tx-width). The " +
    "frozen `waitlist status` #2 ('stays `waiting` until an operator admits them') kept its words while invitations " +
    "and referrals also admitted; with money now admitting a person nobody invited, it names that way too, and the " +
    "operator's way is unchanged. Proven from devnet's person-with-money-waiting. For the payments designer: invoke " +
    "`accounts.admit` from `payments.lifecycle.payment`'s `escrow` step; for the shared owner, procedures.accounts-admit " +
    "gains this second invoker. For Aaron: as with an invitation then cancelled, any admitted payer can admit any " +
    "mailbox, a +tag of their own included, for a small payment taken back at once, outside the referral cap of 10; " +
    "the recommendation is to keep that for the beta, as ruled, with no minimum amount.",
  source: by("blueprint/shared/rulings.ts (aaron.money-waiting-reminders); procedures.accounts-admit; payments.claim-escrow-mailbox; waitlist.status.yaml #2"),
  affects: [
    procedure_accounts_admit,
    table_admissions,
    machine_waitlist_entry,
    event_waitlist_entry_transitioned,
    concept_payments,
  ],
});

// ── the owner claims whenever it chooses (aaron.escrow-general; spelled by aaron.payment-claim, 8 November 2026) ──

export const decision_accounts_collect_any_time = defineDecision({
  id: "accounts.collect-any-time",
  title: "`payment claim`: the owner claims its claim escrows whenever it chooses",
  question:
    "aaron.escrow-general: the escrow's owner 'can claim that money whenever they want'. Setup collects what waits at " +
    "the claim, but nothing collected an escrow that opens after setup (a dated payment paid after the payee signed up), " +
    "one the person declined or let lapse at setup, or one funded while setup ran. How does the owner collect later?",
  options: [
    {
      label: "account-collect",
      text:
        "A new operation, `account collect` (id `account.collect`, rules.new-operations), booked here first. Its rpc " +
        "reads indexing's open owner-collects escrows whose owner is the caller's set-up Safe and that hold their " +
        "amount, and opens one approval from that Safe calling `collect` on each, which the person signs on the " +
        "approval page. Nothing waiting answers `nothing_waiting` and opens nothing; a landed collection answers " +
        "`collected`. Setup keeps its own collection at the claim.",
    },
    {
      label: "payment-claim",
      text:
        "As aaron.payment-claim rules: the same capability as account-collect, spelled `payment claim` (id " +
        "`payment.claim`, area payments, SDK `client.payments.claim`), booked by payments over this concept's rpc " +
        "`accounts.setup.collect` (payments.claim-command). One approval collects every escrow waiting for the Safe; " +
        "no payment id, no `--request-key`; the same answers, refusals and worlds. The sender's take-back stays " +
        "`payment cancel`.",
    },
    {
      label: "payment-claim-each",
      text:
        "As docs/design/new-commands.md section 6 first listed it: `payment claim [<payment>]`, with `--request-key`, " +
        "one escrow or all, and WRONG_STATE for one its sender already took back.",
    },
    {
      label: "auto-approval",
      text:
        "Open a collection approval for the payee each time an escrow opens for a live Safe: approvals expire, so the " +
        "money would again have no way out after the deadline.",
    },
    { label: "setup-again", text: "Run the setup process again on demand: setup is one process per Safe and ends at ready." },
  ],
  chosen: "payment-claim",
  why:
    "Aaron's ruling aaron.payment-claim (8 November 2026, night; docs/decisions/open-for-aaron.md question 38): 'I " +
    "don't think it should be called collect. Claim, that's fine. Payment claim sounds fine. Payment cancel is fine.' " +
    "It supersedes account-collect, which this record booked first and recommended over the grammar page's spelling " +
    "because in the 215 `claim` takes up a Safe or a seat (`org board claim`, setup's claim) and G3 gives a verb one " +
    "meaning. His words name only the command; this record now reads `claim` as taking up what is held for you, the " +
    "money in its escrow among it, while `collect` stays the payee taking released money (`payroll agreement collect`) and the escrow's function. Only " +
    "the spelling moves: 'whenever they want' still needs a command, not a moment, so the owner chooses when, and an " +
    "approval is opened only when asked and never lapses unasked. This concept keeps the rpc, the same step as setup's " +
    "collection: it reads the person's own setup and the escrows that pay their Safe from indexing " +
    "(dependencies.accounts-payments), writes no row of accounts, and approvals.open answers the live approval of the " +
    "same subject, so asking twice signs once. Each collection's PaymentSent settles its Payment for both sides, as at " +
    "setup. The command's noun is now the money's, so payments books it (payments.claim-command), its flow calling " +
    "this rpc, since payments depends on accounts. It still takes no payment id (G5): before collection a " +
    "claim escrow's Payment has no payee tenant, so the person can neither list nor get it, which rules out " +
    "payment-claim-each. It takes `--json` and `--timeout-seconds` and no `--request-key`: it births no command, and " +
    "asking again answers the live approval, as `payroll agreement collect` takes none. Its refusals are the 215's for the " +
    "same cases: SMART_ACCOUNT_MISSING with no Safe (dev fund), a refused setup's WRONG_STATE or INVALID_INPUT " +
    "(account retry), and payment send's SUPERSEDED, CANCELLED and TRANSACTION_FAILED.",
  source: by(
    "aaron.payment-claim; aaron.escrow-general; payments.claim-command; docs/decisions/open-for-aaron.md (question 38); " +
      "docs/design/new-commands.md (G3, G5, G10, section 6); blueprint/accounts/processes.ts",
  ),
  affects: [rpc_accounts_setup_collect, workflow_accounts_setup_personal_safe, contract_escrow, concept_payments],
});
