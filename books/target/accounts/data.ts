// The accounts concept's tables, its state machines and each machine's one event (target).
//
// Four tables, from the old system's eight (old accounts' accounts, smartAccounts,
// welcomeFundingGrants and serviceLanes; old access' betaWaitlist, betaWaitlistWindows,
// referralCodes and referrals, less approvals and agents, which left for their own concepts):
//
// - admissions:       one mailbox's place in the beta (waiting or admitted).
// - referral-codes:   one mailbox's referral code and the invites it may spend.
// - referrals:        who brought each mailbox, and how far it came.
// - personal-safes:   one person's Safe and its setup, the object of the setup process.
//
// Dropped, each by a decision in ./decisions.ts: the logical `accounts` row (the person's Party in
// parties is the money identity), the welcome-grant rows (a step of the setup process), the
// service-key lane (the service-signer integration), the request form's per-IP window (the form
// is not ported) and the chain id column (one chain per deployment).
//
// Admission and referrals key on the mailbox, not on a person id: an invite or an Organization's invitation
// admits an email nobody has signed in with yet (decision `accounts.mailbox-tenancy`).
//
// Paths in `was` are relative to the old repository root (/home/user/factory, integration/factory).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_accounts } from "../shared/foundation.ts";

const OLD = "packages/backend/src";
const ACCESS_TABLES = `${OLD}/access/tables.ts`;
const ACCOUNTS_TABLES = `${OLD}/accounts/tables.ts`;

const S = Schema.String;
/** Epoch milliseconds. */
const At = Schema.Number;
const Count = Schema.Int;

// ── admission: the waitlist ─────────────────────────────────────────────────────────────────

const ENTRY_STATES = ["waiting", "admitted"] as const;
/** How a mailbox got onto the list: it joined, or the admission that put it there. */
const ENTRY_VIA = ["waitlist", "operator", "referral", "invitation", "reward"] as const;

export const table_admissions = defineTable({
  id: "admissions",
  title: "Admissions: one mailbox's place in the beta, waiting or admitted",
  about:
    "One row per normalized mailbox (trimmed and lowercased, the Safe salt's rule) that asked to join the permissioned beta or was " +
    "admitted to it. Born `waiting` by `waitlist join`, or born `admitted` when an operator, a referrer's invite, an " +
    "Organization's invitation (`accounts.admit`) or a referral reward admits a mailbox not on the list. A second join " +
    "keeps `requested_at` and replaces the note only when one is given; an admission is never undone. Where a person " +
    "stands also reads access' `beta-access` gate (`open` admits nobody but lets them through), which is not stored here. " +
    "`person_id` is the signed-in person who joined, so their events reach them; null for a mailbox admitted before it " +
    "signed in. The old per-IP window of the public request form is not ported with the form.",
  concept: concept_accounts,
  tenancy: "person",
  tenantField: "email",
  fields: Schema.Struct({
    email: S,
    person_id: Schema.NullOr(S),
    status: Schema.Literals(ENTRY_STATES),
    note: Schema.NullOr(S),
    joined_via: Schema.Literals(ENTRY_VIA),
    requested_at: Schema.NullOr(At),
    admitted_at: Schema.NullOr(At),
    /** `operator:<label>`, `referral:<referrer email>`, `invitation:<org_id>` or `reward:<referee email>`. */
    admitted_by: Schema.NullOr(S),
    updated_at: At,
  }),
  key: ["email"],
  indexes: [],
  retention: "Kept for the life of the deployment: an admission is never undone, so its record stays.",
  was: [`${ACCESS_TABLES}:177`, `${OLD}/access/waitlist/writes.ts:32`, `${OLD}/access/waitlist/writes.ts:71`, "books/as-is/access/data.ts"],
});

export const event_waitlist_entry_transitioned = defineEvent({
  id: "waitlist_entry_transitioned",
  about:
    "A mailbox joined the waitlist or was admitted. Sent by every transition of `waitlist-entry`, in its transaction, " +
    "through the outbox. Notices sends the beta welcome from `admit` and `admit_unlisted`, except for `invitation`, whose " +
    "invitation email is the welcome. The mailbox itself is not a property: `person_id` names the person when known.",
  props: Schema.Struct({
    from: Schema.NullOr(Schema.Literals(ENTRY_STATES)),
    to: Schema.Literals(ENTRY_STATES),
    transition: Schema.Literals(["join", "admit", "admit_unlisted"]),
    person_id: Schema.NullOr(S),
    via: Schema.Literals(ENTRY_VIA),
    /** Whether a live referral brought the mailbox. */
    referred: Schema.Boolean,
  }),
  was: ["packages/observability/src/events/referrals.ts:15", `${OLD}/access/referrals/events.ts:20`],
});

export const machine_waitlist_entry = defineMachine({
  id: "waitlist-entry",
  title: "Waitlist entry: waiting or admitted",
  about:
    "admissions.status. A mailbox joins (`join`, a birth), and is admitted once (`admit`); a mailbox admitted " +
    "before it ever joined is born admitted (`admit_unlisted`). Every admission, whichever way it comes, also moves the " +
    "mailbox's referral to `admitted` in the same transaction. The old store had no state column (admission was " +
    "`admittedAt` set); the target names the state so every change is a transition with its event.",
  table: table_admissions,
  field: "status",
  initial: "waiting",
  states: [
    { id: "waiting", about: "On the list, not admitted. Signing in works; setting up the Safe, the faucet and `org create` refuse." },
    { id: "admitted", about: "Admitted by an operator, a referrer's invite, an Organization's invitation or a referral reward; never undone.", terminal: true },
  ],
  transitions: {
    join: {
      from: [],
      to: "waiting",
      about: "Birth: `waitlist join` by a signed-in person whose mailbox is not on the list yet.",
      guard: "No entry for the mailbox exists; a second join only updates the note.",
      emits: [event_waitlist_entry_transitioned],
    },
    admit: {
      from: ["waiting"],
      to: "admitted",
      about: "An operator's admission, a referrer's invite, an Organization's invitation, or a waiting referrer's reward.",
      guard: "The entry is waiting; an admitted entry is left as it is and reported as already admitted.",
      emits: [event_waitlist_entry_transitioned],
    },
    admit_unlisted: {
      from: [],
      to: "admitted",
      about: "Birth: the same admissions for a mailbox that never joined; `requested_at` stays null.",
      guard: "No entry for the mailbox exists.",
      emits: [event_waitlist_entry_transitioned],
    },
  },
  was: [`${OLD}/access/waitlist/rules.ts:24`, `${OLD}/access/waitlist/writes.ts:71`, "books/as-is/access/data.ts"],
});

// ── referrals ───────────────────────────────────────────────────────────────────────────────

export const table_referral_codes = defineTable({
  id: "referral-codes",
  title: "Referral codes: one mailbox's code and the invites it may spend",
  about:
    "A mailbox's referral code (8 characters of 23456789ABCDEFGHJKLMNPQRSTUVWXYZ, drawn again on a clash, never changed) " +
    "and its invites: `invites_left` to spend and `invites_granted`, every invite ever given, which the cap of 10 counts. " +
    "Made the first time its person asks (`referral`), or by an operator's grant. An admitted (or beta-open) person gets " +
    "3 starting invites once (`started_at`); a qualified referral adds 1 within the cap; an operator's grant adds any " +
    "count past it. A counter, not a state: changes are writes, not transitions.",
  concept: concept_accounts,
  tenancy: "person",
  tenantField: "email",
  fields: Schema.Struct({
    email: S,
    code: S,
    invites_left: Count,
    invites_granted: Count,
    started_at: Schema.NullOr(At),
    created_at: At,
  }),
  key: ["email"],
  indexes: [
    {
      name: "by-code",
      fields: ["code"],
      unique: true,
      crossTenant: true,
      for: "The mailbox a typed code belongs to, for `waitlist join --ref`, and the clash check when a fresh code is drawn.",
    },
  ],
  retention: "Kept for the life of the deployment: a shared link must keep resolving.",
  was: [`${ACCESS_TABLES}:213`, `${OLD}/access/referrals/rules.ts:6`, `${OLD}/access/referrals/writes.ts:38`],
});

const REFERRAL_STAGES = ["attributed", "admitted", "qualified", "rewarded", "voided"] as const;

export const table_referrals = defineTable({
  id: "referrals",
  title: "Referrals: who brought each mailbox, and how far it came",
  about:
    "One row per referred mailbox, owned by the referrer: the first referral of a mailbox wins and never changes. `via` " +
    "is a link (`waitlist join --ref`) or one of the referrer's invites (`referral invite`). The stage moves attributed, " +
    "admitted (the waitlist admitted the friend), qualified (the friend's Safe was claimed on chain), rewarded (the " +
    "referrer got an invite, or their own admission while still waiting), or voided (an operator, or a throwaway mailbox " +
    "at qualify). Keyed by mailbox, so a referral works before the friend has signed in.",
  concept: concept_accounts,
  tenancy: "person",
  tenantField: "referrer_email",
  fields: Schema.Struct({
    referrer_email: S,
    referee_email: S,
    via: Schema.Literals(["link", "invite"]),
    stage: Schema.Literals(REFERRAL_STAGES),
    attributed_at: At,
    admitted_at: Schema.NullOr(At),
    qualified_at: Schema.NullOr(At),
    rewarded_at: Schema.NullOr(At),
    reward_kind: Schema.NullOr(Schema.Literals(["invites", "admission"])),
    voided_at: Schema.NullOr(At),
    void_reason: Schema.NullOr(Schema.Literals(["disposable_email", "operator"])),
  }),
  key: ["referrer_email", "referee_email"],
  indexes: [
    {
      name: "by-referee",
      fields: ["referee_email"],
      unique: true,
      crossTenant: true,
      for: "The one referral that brought a mailbox: attribution at join and invite, every admission, the qualify, and the referee's `referredBy`.",
    },
    {
      name: "by-referrer-attributed",
      fields: ["referrer_email", "attributed_at"],
      for: "A person's referrals newest first, and their counts by stage: `referral list` and `referral`.",
    },
  ],
  retention: "Kept for the life of the deployment: a voided referral stays, with its reason.",
  was: [`${ACCESS_TABLES}:229`, `${OLD}/access/referrals/views.ts:8`, `${OLD}/access/referrals/writes.ts:96`],
});

export const event_referral_transitioned = defineEvent({
  id: "referral_transitioned",
  about:
    "A referral moved: a friend was tied to a referrer, admitted, went live, earned the referrer a reward, or was voided. " +
    "Sent by every transition of `referral`, through the outbox; notices tells the referrer of a reward. Mailboxes are not " +
    "properties; the runtime's envelope names the actor (the referrer for `attribute`, the system for `qualify`).",
  props: Schema.Struct({
    from: Schema.NullOr(Schema.Literals(REFERRAL_STAGES)),
    to: Schema.Literals(REFERRAL_STAGES),
    transition: Schema.Literals(["attribute", "admit", "qualify", "reward", "void"]),
    via: Schema.Literals(["link", "invite"]),
    reward_kind: Schema.NullOr(Schema.Literals(["invites", "admission"])),
    void_reason: Schema.NullOr(Schema.Literals(["disposable_email", "operator"])),
  }),
  was: ["packages/observability/src/events/referrals.ts:31", `${OLD}/access/referrals/events.ts:41`],
});

export const machine_referral = defineMachine({
  id: "referral",
  title: "Referral stage",
  about:
    "referrals.stage. Born `attributed` (`attribute`) by a link join or an invite; an invite attributes and admits in one " +
    "transaction. Every waitlist admission of the friend moves it to `admitted`. The friend's CapxulSafeClaimed moves it " +
    "to `qualified` and, in the same transaction, `rewarded` when the referrer earns something (an invite within the cap, " +
    "or their own admission while waiting); at the cap it stays qualified. `void` ends it from any stage and earns " +
    "nothing more; an admission or invites it gave stay. The old store derived the stage from four timestamps; the target " +
    "stores it. The old `self_referral` void reason, which no code produced, is gone.",
  table: table_referrals,
  field: "stage",
  initial: "attributed",
  states: [
    { id: "attributed", about: "Tied to the referrer by a link or an invite." },
    { id: "admitted", about: "The waitlist admitted the friend." },
    { id: "qualified", about: "The friend's Safe was claimed on chain; with the referrer at the cap, no reward follows." },
    { id: "rewarded", about: "The referrer got one more invite, or, while still waiting, their own admission." },
    { id: "voided", about: "Taken back by an operator, or a throwaway mailbox at qualify; it earns nothing more.", terminal: true },
  ],
  transitions: {
    attribute: {
      from: [],
      to: "attributed",
      about: "Birth: `waitlist join --ref` by a mailbox not admitted, or `referral invite`.",
      guard: "The mailbox has no referral yet, and the referrer is not the same mailbox once dots and plus tags are taken out.",
      emits: [event_referral_transitioned],
    },
    admit: {
      from: ["attributed"],
      to: "admitted",
      about: "In the transaction of every admission of the friend (operator, invite, invitation, reward).",
      guard: "Not admitted already and not voided.",
      emits: [event_referral_transitioned],
    },
    qualify: {
      from: ["attributed", "admitted"],
      to: "qualified",
      about: "The referral qualify, from the friend's indexed CapxulSafeClaimed.",
      guard: "Not voided, not qualified already, and not a throwaway mailbox.",
      emits: [event_referral_transitioned],
    },
    reward: {
      from: ["qualified"],
      to: "rewarded",
      about: "In the qualify's transaction: one invite to an admitted referrer within the cap, or a waiting referrer's admission.",
      guard: "An admitted referrer is rewarded only while the start and the rewards stay within 10 invites.",
      emits: [event_referral_transitioned],
    },
    void: {
      from: ["attributed", "admitted", "qualified", "rewarded"],
      to: "voided",
      about: "An operator's void (`operator`), or the qualify finding a throwaway mailbox (`disposable_email`).",
      guard: "Not voided already; a voided referral answers voided again unchanged.",
      emits: [event_referral_transitioned],
    },
  },
  was: [`${OLD}/access/referrals/views.ts:8`, `${OLD}/access/referrals/writes.ts:124`, `${OLD}/access/referrals/writes.ts:162`],
});

// ── the personal Safe and its setup ─────────────────────────────────────────────────────────

const SAFE_STATES = ["claiming", "collecting", "ready", "failed"] as const;
/** Why a claim failed: the chain's refusal, or the claim could not be sent within the run's retries. */
const CLAIM_FAILURES = ["WRONG_STATE", "INVALID_INPUT", "TRANSACTION_FAILED", "PROVIDER_ERROR"] as const;

export const table_personal_safes = defineTable({
  id: "personal-safes",
  title: "Personal Safes: one person's own Safe and its setup",
  about:
    "One row per person, born when their setup starts in the web app. `safe_address` is a pure function of the email " +
    "(CompaniesHouseClaimer.safeAddressFor with Companies House as the bootstrap owner and the deployment's namespace), " +
    "so it is known before anything is on chain and never changes. `signer_address` is the signer the setup installs as " +
    "the Safe's only owner. The setup process owns `status`: it claims the Safe through Companies House's claim role, " +
    "then collects the claim escrows that were waiting for the person, then is ready. A refused claim is `failed` with its " +
    "code; a new start retries it (`attempt` counts). `collected` is how many claim escrows the setup collected. One chain " +
    "per deployment, so no chain column; the old logical Account row is not kept (the person's Party is the identity " +
    "money is routed to).",
  concept: concept_accounts,
  tenancy: "person",
  tenantField: "person_id",
  fields: Schema.Struct({
    person_id: S,
    email: S,
    safe_address: S,
    signer_address: S,
    status: Schema.Literals(SAFE_STATES),
    attempt: Count,
    claim_tx_hash: Schema.NullOr(S),
    claimed_at: Schema.NullOr(At),
    claimed_block: Schema.NullOr(Count),
    collect_approval_id: Schema.NullOr(S),
    collected: Count,
    failure_code: Schema.NullOr(Schema.Literals(CLAIM_FAILURES)),
    created_at: At,
    updated_at: At,
  }),
  key: ["person_id"],
  indexes: [
    {
      name: "by-safe",
      fields: ["safe_address"],
      unique: true,
      crossTenant: true,
      for: "The setup of the Safe a CapxulSafeClaimed names, for the referral qualify; also keeps one Safe to one person.",
    },
  ],
  retention: "Kept while the person's principal exists: it is the record of whose Safe this is and how it was set up.",
  was: [`${ACCOUNTS_TABLES}:35`, `${ACCOUNTS_TABLES}:15`, `${OLD}/accounts/safes/writes.ts:24`, `${OLD}/accounts/claims/writes/rows.ts:70`],
});

export const event_personal_safe_transitioned = defineEvent({
  id: "personal_safe_transitioned",
  about:
    "A person's Safe setup moved: started, claimed for their signer, ready, failed or retried. Sent by every transition " +
    "of `personal-safe`, through the outbox. No Seat waits on it: an invitee takes their Seat when they accept " +
    "(organizations). The activation funnel ends at `finish`. Replaces old member_activation_* and provisioning_safe_confirmed.",
  props: Schema.Struct({
    from: Schema.NullOr(Schema.Literals(SAFE_STATES)),
    to: Schema.Literals(SAFE_STATES),
    transition: Schema.Literals(["start", "retry", "claim", "fail", "finish"]),
    person_id: S,
    safe: S,
    attempt: Count,
    failure_code: Schema.NullOr(Schema.Literals(CLAIM_FAILURES)),
  }),
  was: [`${OLD}/accounts/claims/events.ts:28`, `${OLD}/accounts/safes/events.ts:12`],
});

export const machine_personal_safe = defineMachine({
  id: "personal-safe",
  title: "Personal Safe setup",
  about:
    "personal-safes.status, owned by the setup process (`accounts.setup.personal-safe`, one instance per row). `start` " +
    "(a birth) and `retry` come from the web app's setup start; `claim`, `fail` and `finish` from the process. `claim` " +
    "needs chain proof: the claim's CapxulSafeClaimed for this Safe and signer, or the Safe already owned by exactly this " +
    "signer. Only the claim can fail; a collection the person declines or lets lapse still finishes, and the escrows stay " +
    "theirs to collect or the payer's to refund. The old row had no state column (deployedAt, claimLockId and claimedAt " +
    "stood for it) and a ten-minute claim lock; the process's single instance replaces the lock.",
  table: table_personal_safes,
  field: "status",
  initial: "claiming",
  states: [
    { id: "claiming", about: "Companies House's claim role is installing the person's signer; the process waits for the chain." },
    { id: "collecting", about: "Claimed: the signer is the Safe's only owner. The claim escrows waiting for the person are being collected." },
    { id: "ready", about: "Set up: claimed, and every claim escrow collected, declined or left. The person can transact.", terminal: true },
    { id: "failed", about: "The chain refused the claim, or it could not be sent; `failure_code` says which. A new start retries." },
  ],
  transitions: {
    start: {
      from: [],
      to: "claiming",
      about: "Birth: the setup start for an admitted person with no setup yet.",
      guard: "The mailbox is admitted or the beta is open to the person; the signer is an address and not Companies House.",
      emits: [event_personal_safe_transitioned],
    },
    retry: {
      from: ["failed"],
      to: "claiming",
      about: "A new setup start after a refused claim, possibly with another signer; `attempt` goes up by one.",
      guard: "The setup is failed.",
      emits: [event_personal_safe_transitioned],
    },
    claim: {
      from: ["claiming"],
      to: "collecting",
      about: "The process saw the claim on chain, or found the Safe already owned by exactly this signer.",
      guard: "CapxulSafeClaimed names this Safe and signer, or getOwners() is exactly [signer].",
      emits: [event_personal_safe_transitioned],
    },
    fail: {
      from: ["claiming"],
      to: "failed",
      about: "SwapRefused (WRONG_STATE), EmailNotNormalized or InvalidSigner (INVALID_INPUT), another revert, or no send.",
      guard: "Only a definitive refusal, or a send that never left after the run's retries; a lost answer is looked up first.",
      emits: [event_personal_safe_transitioned],
    },
    finish: {
      from: ["collecting"],
      to: "ready",
      about: "No claim escrow waits, or the collection approval ended: collected, declined or expired.",
      guard: "The collection approval, if one was opened, has ended.",
      emits: [event_personal_safe_transitioned],
    },
  },
  was: [`${OLD}/accounts/claims/rules.ts:45`, `${OLD}/accounts/claims/writes/rows.ts:40`, `${OLD}/accounts/claims/writes/rows.ts:70`],
});
