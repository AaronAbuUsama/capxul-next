// Parties' own judgments: the shape of the directory and the profile, the Party's states, the
// door's procedures and what of old parties and old profiles is not ported. The architecture's
// judgments about parties (what it owns, the scope, registration at birth) are in
// shared/decisions.ts; these refine them.

import { defineDecision } from "../../../packages/book/src/index.ts";
import {
  concept_agents,
  concept_banking,
  concept_contacts,
  concept_indexing,
  concept_organizations,
  concept_parties,
  concept_payments,
  concept_payroll,
} from "../shared/foundation.ts";
import { contract_companies_house_claimer } from "../shared/external.ts";
import {
  decision_concepts_parties,
  decision_concepts_parties_scope,
  decision_dependencies_registration,
  decision_responsibilities_destinations,
  decision_rules_procedures,
} from "../shared/decisions.ts";
import { event_party_transitioned, machine_party, table_parties, table_profiles } from "./data.ts";
import {
  procedure_parties_activate,
  procedure_parties_register,
  procedure_parties_release,
  procedure_parties_resolve_recipient,
} from "./procedures.ts";
import { rpc_parties_profiles_get, rpc_parties_profiles_save } from "./profiles.ts";
import { flow_client_me_profile_get, flow_client_me_profile_save } from "./flows.ts";

const BY = "Claude, parties target design, 8 November 2026";
const by = (evidence: string) => `${BY}; evidence: ${evidence}`;
const OLD = "packages/backend/src";

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_parties_directory_tenancy = defineDecision({
  id: "parties.directory-tenancy",
  title: "The directory is global; a person's private profile is theirs",
  question:
    "P8 gives every table a tenant. Every read of the directory crosses tenants (by handle, mailbox, Safe or id), and a " +
    "provisional person or an outside address has no owner. What is the directory's tenancy?",
  options: [
    {
      label: "global-plus-profile",
      text:
        "`parties` is `global`: written only through parties' own procedures and rpcs, readable by every concept that " +
        "depends on parties; it holds nothing private (no mailbox, no profile). The private half is `profiles`, tenancy " +
        "`person`, `person_id` first.",
    },
    { label: "owner", text: "`parties` is `owner` (`owner_kind`, `owner_id`), with the lookups marked crossTenant." },
    { label: "split-by-owner", text: "Owned Parties in an `owner` table, unowned ones (provisional, outside) in a global one." },
  ],
  chosen: "global-plus-profile",
  why:
    "An `owner` table must lead its key with the owner, but a provisional person or an outside address has none, and a " +
    "Party's owner appears only when it is claimed or registered, so the key would change under a row that payments and " +
    "contacts point at. Row-level security on owner would hide exactly the rows resolution must find. Splitting owned " +
    "from unowned Parties would put one Safe and one mailbox in two uniqueness domains, the reason shared " +
    "dependencies.parties-registration gives against separate handle tables. The directory is a namespace like the " +
    "chain: what it shows (kind, handle, name, photo, Safe) is what any counterparty may see, so a global table loses " +
    "nothing to row-level security, and no tenant writes it directly. Its owner columns are what indexing's views join " +
    "(concepts.parties-scope). The person-only fact, the country, is in `profiles`, behind the person's own policy.",
  source: by("P8; parties/tables.ts:131 (one table, no owner key); profiles/tables.ts:5; reads/recipients.ts:73"),
  affects: [table_parties, table_profiles, concept_indexing, decision_concepts_parties_scope],
});

export const decision_parties_mailbox_digest = defineDecision({
  id: "parties.mailbox-digest",
  title: "The directory keeps a digest of a person's mailbox, never the mailbox",
  question: "A person Party is found by mailbox. Does the global directory store the mailbox?",
  options: [
    { label: "digest", text: "Store the SHA-256 of the trimmed, lowercased mailbox in `mailbox_digest`; never project it." },
    { label: "clear", text: "Store the normalized mailbox, as old parties did, and never project it." },
    { label: "keyed", text: "Store an HMAC of the mailbox under a deployment key." },
  ],
  chosen: "digest",
  why:
    "Old parties stored the mailbox and relied on every view leaving it out; its own invariant was 'an entry never shows " +
    "a mailbox its owner did not type'. In a global table any mistake in a projection leaks every mailbox. A digest still " +
    "finds the Party for a typed or signed-in mailbox (the normalization is the Safe salt's, so the digest and the derived " +
    "Safe always agree) and shows nothing. Whoever must mail a provisional person holds the mailbox they typed (the " +
    "invitation, the escrow's payment). A keyed digest would add a secret whose rotation re-keys every row; revisit it " +
    "if the directory is ever exported.",
  source: by("parties/README.md:198 (lookup never carries a mailbox); protocol evm/safe-email.ts:17 (trim, lowercase)"),
  affects: [table_parties, procedure_parties_resolve_recipient, rpc_parties_profiles_save],
});

export const decision_parties_profile_shape = defineDecision({
  id: "parties.profile-shape",
  title: "A profile is a display name and photo on the Party, and a country",
  question: "Old profiles held a display name, country, KYC tier, photo, onboarded flag, withdrawal address, member kind and the Party link. What does the target keep?",
  options: [
    {
      label: "public-private",
      text:
        "The display name and photo go on the Party, where counterparties read them; the country stays in `profiles`. " +
        "The KYC tier, withdrawal address, member kind and onboarded flag are dropped.",
    },
    { label: "as-is", text: "Port the identities row as it was, beside the Party." },
  ],
  chosen: "public-private",
  why:
    "A display name is what a counterparty sees of a Party, so it belongs on the Party (an Organization's and an agent's " +
    "come from their births). The photo is the same, as a media file id (`dependencies.of-parties`: a photo points at a " +
    "stored file). The KYC tier and withdrawal address were marked transitional in old profiles and grant nothing; on v4 " +
    "money leaves a person's Safe only by an operation they sign, to the address they choose then, and no frozen " +
    "operation reads either field (P2). The member kind is gone: an agent is its own kind of Party. The onboarded flag is " +
    "the Party's own `claim` or `onboard` and the profile row's existence. The country stays: banking's verification " +
    "prefills it. The photo's admission is read from media's stored file: that link waits for media's tables.",
  source: by("profiles/tables.ts:5-37; profiles/README.md:124 (transitional fields); P2"),
  affects: [table_parties, table_profiles, rpc_parties_profiles_save, decision_concepts_parties],
});

export const decision_parties_destinations = defineDecision({
  id: "parties.destinations",
  title: "A Party's receiving destination is its Safe; saved destinations are not ported",
  question:
    "Shared responsibilities.destinations keeps receiving destinations in parties. Old `counterpartyDestinations` saved " +
    "bank, mobile-money and wallet rows per counterparty and per actor. What is a receiving destination on v4?",
  options: [
    {
      label: "safe",
      text:
        "The Party's `safe_address` is its one receiving destination. A saved bank row is banking's saved bank account; a " +
        "saved wallet is an outside-address Party (a contact names it); mobile money has no rail; the actor's own wallets " +
        "are their Safe.",
    },
    { label: "table", text: "Port `counterpartyDestinations` as a parties table, wallets only." },
  ],
  chosen: "safe",
  why:
    "On v4 every payment is a `Payments.send` to one address, and the directory already says which address each Party is " +
    "paid at. A wallet row beside it would be a second answer to 'where does this counterparty get paid' that could " +
    "disagree with the Party's Safe. The bank rows are Bridge external accounts under banking's record key " +
    "(concepts.banking). `client.destinations.*` had no caller outside tests (P2), and the onboarding payout addresses " +
    "it fed are the person's own Safe. The landing stays parties, as the shared decision says: the destination is the " +
    "Party's Safe.",
  source: by("parties/tables.ts:215; parties/destinations/rules.ts:28 (testnet wallets); P2 (client.destinations.* no caller)"),
  affects: [table_parties, decision_responsibilities_destinations, concept_banking, concept_contacts],
});

export const decision_parties_dropped_stores = defineDecision({
  id: "parties.dropped-stores",
  title: "Old parties' edges, terms, purges and ledger seams are not ported",
  question: "Old parties also held contact and employed edges, engagement terms, an operator purge and the money seams' ensure helpers. Where do they go?",
  options: [
    {
      label: "landings",
      text:
        "Contact edges go to contacts; employed edges and engagement terms are dropped for payroll's agreements; the purge " +
        "is dropped; the ledger seams become `parties.resolve-recipient` or a read of `parties`.",
    },
    { label: "keep-edges", text: "Keep `partyEdges` in parties for contacts and payroll to write through procedures." },
  ],
  chosen: "landings",
  why:
    "The address book needs an Organization's membership, so it sits above organizations (concepts.contacts); an edge " +
    "table below would be written from above for a fact that is not money. v4 Agreements replace engagements and their " +
    "rates (concepts.parties). The operator purge wrote other concepts' rows and no frozen operation reaches it " +
    "(responsibilities.operator-proof-tools). `ensureLedgerParty` and `partyKeyFor*` keyed old ledger rows on a Party; a " +
    "Payment now names its recipient's Party through resolution, and activity reads the counterparty by Safe.",
  source: by(`${OLD}/parties/tables.ts:153, :190; parties/README.md:96-110 (the door's seams); parties/reads/purges.ts`),
  affects: [table_parties, concept_contacts, concept_payroll, concept_payments, procedure_parties_resolve_recipient],
});

// ── the Party's life ────────────────────────────────────────────────────────────────────────

export const decision_parties_machine = defineDecision({
  id: "parties.party-machine",
  title: "Five Party states; births are transitions; one event",
  question: "Old parties had a status of provisional or claimed and a kind that included `unresolved`. Which states does a target Party have?",
  options: [
    {
      label: "five",
      text:
        "provisional (a named mailbox), outside (a named address), pending (a registered birth), active (owned and live), " +
        "released (a failed birth); eight transitions, four of them births.",
    },
    { label: "two", text: "Keep provisional and claimed, with agents' reservations as provisional rows." },
  ],
  chosen: "five",
  why:
    "The old two states carried four meanings: a named mailbox, a bare address, an agent reserved before its Safe landed " +
    "(stored as a provisional person) and a claimed identity, and an agent's release only cleared its handle without a " +
    "state. Each of those is a different answer to 'may money be routed here, and whose is it', which every reader of " +
    "the directory asks. `pending` is what lets a payment refuse an agent whose create has not landed, since parties " +
    "cannot read agents. Births are transitions (from no state) so every new Party sends `party_transitioned`, which " +
    "carries the owner as its tenant and never a mailbox, handle or name. The kind `address` replaces `unresolved`; a " +
    "claim changes it to `person`.",
  source: by(`${OLD}/parties/tables.ts:131-150; parties/writes/parties.ts:218-265 (reserve, claim, release an agent)`),
  affects: [machine_party, event_party_transitioned, table_parties],
});

export const decision_parties_claim_at_profile = defineDecision({
  id: "parties.claim-at-profile",
  title: "A person's Party becomes theirs when they complete their profile",
  question: "The concept map says a person's Party is provisional 'until they sign in'. Which write claims it?",
  options: [
    { label: "profile", text: "`parties.profiles.save`, the first parties write a person makes after signing in." },
    { label: "sign-in", text: "Access' sign-in, invoking a parties procedure." },
    { label: "safe-setup", text: "Accounts' Safe setup, invoking a parties procedure when CapxulSafeClaimed lands." },
  ],
  chosen: "profile",
  why:
    "Access is below parties and cannot invoke it (concepts.access), and a sign-in has no display name to give the Party. " +
    "Accounts' Safe setup already needs the profile first (`account show` refuses with PROFILE_NOT_FOUND before it), so " +
    "the profile is the earliest write that knows who the person is and what to call them. The claim keeps the Party's " +
    "id, so what payments, contacts and invitations saved for the mailbox before signup still points at the person. " +
    "Whether money to the person goes straight to their Safe or into a claim escrow is the chain's CapxulSafeClaimed, " +
    "read by payments, not the Party's state.",
  source: by("account.show.yaml (mistakes: PROFILE_NOT_FOUND); profiles/onboardings/operations/complete.ts:23; concepts.access"),
  affects: [machine_party, rpc_parties_profiles_save, concept_parties],
});

export const decision_parties_handles = defineDecision({
  id: "parties.handles",
  title: "Handles for agents and Organizations; only a failed birth frees one",
  question: "Who has a handle, what is a valid one, and when is one free again?",
  options: [
    {
      label: "agents-orgs",
      text:
        "Agents and Organizations, in one namespace; 3 to 30 of a-z, 0-9, `_`, `-`, not reserved; freed only when a " +
        "birth is released.",
    },
    { label: "everyone", text: "People too, as old onboarding gave every person a handle." },
  ],
  chosen: "agents-orgs",
  why:
    "The designed v4 text names people by email and agents and Organizations by `@handle`: 'wherever a command takes a " +
    "person's email, it takes an agent's `@handle`; an agent has no email', `org member invite` refuses a handle no agent " +
    "has, and an agreement's payee is 'a person's email or an Organization's `@handle`'. The old rule and reserved words " +
    "are kept. `agent create` 'fails and frees its handle' when the chain refuses it or its approval lapses, and " +
    "`agent remove` says 'its handle stays taken', so only `release` (from `pending`) clears one.",
  source: by("agent.create.yaml (designed summary, acceptance 4); agent.remove.yaml; org.member.invite.yaml; protocol parties/model.ts:5-34"),
  affects: [table_parties, procedure_parties_register, procedure_parties_release, decision_dependencies_registration],
});

// ── the door ────────────────────────────────────────────────────────────────────────────────

export const decision_parties_resolve_recipient = defineDecision({
  id: "parties.resolve-recipient",
  title: "A procedure names a new counterparty; reading one is a table read",
  question:
    "Many concepts name a counterparty by handle, mailbox, address or Party id. Is resolution a procedure, a read, or " +
    "an rpc, and what does it do with a mailbox or address no Party holds?",
  options: [
    {
      label: "procedure-and-reads",
      text:
        "`parties.resolve-recipient`, a procedure that resolves and names a new mailbox or address in the invoker's " +
        "transaction and answers `resolved: false` instead of refusing; a query or a check reads `parties` directly.",
    },
    { label: "rpc-step", text: "A parties rpc each caller's flow calls first, committing the new Party before the record." },
    { label: "procedure-refuses", text: "The same procedure, refusing an unknown locator with INVALID_INPUT." },
  ],
  chosen: "procedure-and-reads",
  why:
    "The money fact (rules.procedures: 'a name and the Safe it routes money to') holds: the record that names a " +
    "counterparty and the one Party per mailbox and Safe it keys on must commit together, or a contact or a request's " +
    "payer could point at a Party nothing holds. An rpc step would be reached only from other concepts' flows and would " +
    "leave a named Party behind every refused record. The frozen refusals for a locator that names nothing differ by " +
    "command (INVALID_RECIPIENT on `payment send`, INVALID_INPUT on `contact add`, `agent sweep`, `org member invite`, " +
    "`org agreement offer`), so the procedure answers and the invoker refuses in its own words; old E8, where nothing " +
    "raised INVALID_RECIPIENT, is then the payments rpc's own error. A transaction that only shows or checks a " +
    "counterparty (a feed, an inbox, a payment's prepare, which already invokes approvals and documents and must stay " +
    "within sys:tx-width) reads `parties` and invokes nothing.",
  source: by("payment.send.yaml, contact.add.yaml, agent.sweep.yaml, org.member.invite.yaml refusals; docs/as-is/payments.md (E8); P4"),
  affects: [procedure_parties_resolve_recipient, table_parties, decision_rules_procedures, concept_payments, concept_contacts],
});

export const decision_parties_birth_outcomes = defineDecision({
  id: "parties.birth-outcomes",
  title: "Two procedures end a registered birth: activate and release",
  question:
    "An Organization's or agent's Party is registered before its Safe exists. Who says the Safe is live, or that the " +
    "birth failed, given that parties is below organizations and agents?",
  options: [
    { label: "procedures", text: "`parties.activate` and `parties.release`, invoked in the transition that ends the birth." },
    { label: "active-at-birth", text: "Register the Party active and let each reader check the Safe on chain." },
    { label: "outbox", text: "Parties follows agents' and organizations' transitions (it would have to depend on them: a cycle)." },
  ],
  chosen: "procedures",
  why:
    "Each is one money fact under rules.procedures. Activation: a handle must not route money to a Safe that is not live, " +
    "and an agent's predicted Safe can only ever be deployed by AgentOwner with its key, so a payment to a pending agent " +
    "could be stranded; payments cannot read agents, so the directory must carry the answer. Release: a handle whose " +
    "Safe will never exist must stop naming it in the same commit that fails the birth ('fails and frees its handle'). " +
    "The outbox would need parties to depend on agents and organizations, which depend on parties. Old parties had the " +
    "same pair as `claimAgentParty` and `releaseAgentHandle`.",
  source: by(`${OLD}/parties/writes/parties.ts:246, :257; agent.create.yaml (acceptance 3, 4); rules.procedures`),
  affects: [
    procedure_parties_activate, procedure_parties_release, procedure_parties_register, decision_rules_procedures,
    concept_agents, concept_organizations,
  ],
});

export const decision_parties_safe_derivation = defineDecision({
  id: "parties.safe-derivation",
  title: "A person's Safe address is computed in the backend, not read from the chain",
  question: "A person's Party needs the Safe their mailbox derives. Is that a chain read?",
  options: [
    { label: "local", text: "Compute it in the backend with CompaniesHouseClaimer's pure `safeAddressFor` formula and the deployment's namespace." },
    { label: "eth-call", text: "Call `safeAddressFor` on chain each time." },
  ],
  chosen: "local",
  why:
    "`safeAddressFor` is `pure`: its answer depends only on the claimer's address, the namespace and the mailbox, all " +
    "known at boot, so the backend computes the same address the chain would (old `personalSafeAddress` did this). That " +
    "keeps `parties.resolve-recipient` and `parties.register` free of outside calls, as a procedure must be, and " +
    "`parties.profiles.save` in the `write` class. The devnet's eval compares the computed address with the chain's.",
  source: by("shared/external.ts contract companies-house-claimer (safeAddressFor pure); parties/reads/recipients.ts:28"),
  affects: [procedure_parties_resolve_recipient, rpc_parties_profiles_save, contract_companies_house_claimer],
});

// ── behaviour and surface ───────────────────────────────────────────────────────────────────

export const decision_parties_no_operations = defineDecision({
  id: "parties.no-operations",
  title: "Parties owns no frozen operation; its rpcs serve the web app's setup page",
  question: "OPERATION_OWNERS gives parties no operation. Which old parties and profiles methods survive, and as what?",
  options: [
    {
      label: "setup-page",
      text:
        "Two rpcs, `parties.profiles.save` and `.get`, each behind a Core SDK flow for the web app's setup page; old " +
        "`details.create`, `details.update` and `onboardings.complete` fold into `save`; `details.handleAvailable` and " +
        "the public `recipients.resolve` and `recipients.lookup` queries are dropped.",
    },
    { label: "port", text: "Port every old public row as an rpc." },
  ],
  chosen: "setup-page",
  why:
    "P2 keeps a method only with a named caller. The frozen `auth login` and `account retry` send a person whose account " +
    "is not ready to 'the web link where you finish setup', and the profile is what that page asks for first, so the " +
    "page is a named surface. Create, update and complete were three writes of one row; one idempotent save covers them. " +
    "A handle check has nothing to check once people have no handles, and an Organization's or agent's taken handle is " +
    "refused by its birth. Resolution before a write is the procedure, and the commands that name a counterparty resolve " +
    "inside their own rpcs, so a public resolve query has no caller. With no operation, parties introduces no world.",
  source: by("auth.login.yaml (notes: setup-required web link); account.retry.yaml; parties/README.md:76-91; profiles/README.md:43-49; P2"),
  affects: [rpc_parties_profiles_save, rpc_parties_profiles_get, flow_client_me_profile_save, flow_client_me_profile_get, concept_parties],
});

export const decision_parties_no_process = defineDecision({
  id: "parties.no-process",
  title: "Parties has no durable process",
  question: "Does any parties object wait on something outside a request (rules.durable-processes)?",
  options: [
    { label: "none", text: "None: every Party change is inside one transaction; the births' waiting is in organizations' and agents' processes." },
    { label: "registration-process", text: "One process per registered Party, waiting for its Safe." },
  ],
  chosen: "none",
  why:
    "A Party waits only as long as the birth it belongs to, and that birth is already one durable process in its own " +
    "concept (an Organization's setup, an agent change), which invokes `parties.activate` or `parties.release` when it " +
    "ends. A second process per Party would follow the same chain event twice. Old profiles' account-ready email moves " +
    "with the Safe's setup to accounts and notices, and its replaced-photo deletion to media's retention.",
  source: by("rules.durable-processes; profiles/onboardings/external.ts (account-ready mail); profiles/README.md:118"),
  affects: [concept_parties, procedure_parties_activate, procedure_parties_release],
});
