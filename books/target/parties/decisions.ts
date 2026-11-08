// Parties' own judgments: the shape of the directory and the profile, the Party's states, the
// door's procedures and what of old parties and old profiles is not ported. The architecture's
// judgments about parties (what it owns, the scope, registration at birth) are in
// shared/decisions.ts; these refine them.

import { defineDecision } from "../../../packages/book/src/index.ts";
import {
  concept_access,
  concept_accounts,
  concept_agents,
  concept_banking,
  concept_contacts,
  concept_indexing,
  concept_organizations,
  concept_parties,
  concept_payments,
  concept_payroll,
  concept_books,
  concept_projects,
  component_frappe_app,
  system_capxul,
} from "../shared/foundation.ts";
import { contract_companies_house_claimer, contract_escrow, integration_frappe_head } from "../shared/external.ts";
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
const CRM_LANE = "Claude, parties Frappe redesign (crm lane), 8 November 2026";
const crmBy = (evidence: string) => `${CRM_LANE}; evidence: ${evidence}`;
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
    "prefills it. The photo's admission is read from media's `files` at the person's own key (purpose `image`, state " +
    "`kept`), as organizations reads a logo.",
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

// ── the directory in Frappe's shapes (the crm lane, 8 November 2026) ──────────────────────────

export const decision_parties_frappe_identity = defineDecision({
  id: "parties.frappe-identity",
  title: "The directory is the identity half of Frappe CRM's Contact and Organization",
  question:
    "The directory of people and companies is to be a global CRM in Frappe CRM's shape. Frappe CRM keeps a person as a " +
    "Contact and a company as a CRM Organization, one site per business, each holding that business's own knowledge " +
    "(mailboxes, phones, titles, territories, revenue, deals). What does the global directory hold, and how does a " +
    "Frappe record meet it?",
  options: [
    {
      label: "identity-half",
      text:
        "Each Party is the global identity a Frappe Contact (kind person, agent or address) or CRM Organization (kind " +
        "organization) stands for: its name (`display_name`, which Contact's `full_name` or CRM Organization's " +
        "`organization_name` shows when the owner's book gives no label of its own), its picture (`photo_file_id`: " +
        "`image`, `organization_logo`) and the key Frappe itself " +
        "dedupes a person by, the mailbox (`mailbox_digest`). Everything else those doctypes hold is the owner's, in its " +
        "book (contacts), in the same doctypes' fields. A connected head carries `party_id` as one Custom Field on " +
        "Contact, CRM Organization, Customer, Supplier and Employee, and a Frappe User for each person or agent with a " +
        "Seat.",
    },
    {
      label: "global-doctypes",
      text: "The directory itself holds Contact and CRM Organization rows with all their fields, shared by every tenant.",
    },
    { label: "own-shape", text: "Keep Capxul's own shape and map it only when a head is connected." },
  ],
  chosen: "identity-half",
  why:
    "The directory is global and holds nothing private (parties.directory-tenancy). Frappe's Contact and CRM " +
    "Organization are per-site records whose fields are what one business knows: a mailbox it was given, a phone, a " +
    "title, a territory, a revenue estimate. Global rows of them would show one tenant's knowledge to every tenant. " +
    "Split in two, the shape holds: the directory is what any counterparty may see and what makes a person or company " +
    "one across tenants, and each book holds the rest under Frappe's field names, so a head syncs by mapping. Frappe CRM " +
    "matches a person by mailbox only ('Match only on email which uniquely identifies a person', `contact_exists`), " +
    "which is the directory's key for a person, so a head's Contacts and every book's entries meet on the same Party. " +
    "Capxul's own shape, mapped only at a head, would leave an Organization without a head outside Frappe's shapes. The " +
    "Party's columns keep their names: a display name is a full name or an organization name by kind, and a Frappe " +
    "Contact without a last name is complete. A Party's name is identity, Capxul's alone (organizations.head-ownership): " +
    "what a head writes into a Contact's or CRM Organization's name is the owner's label, never the Party's " +
    "(contacts.head-mapping). This also settles core check C14: the directory leaks nothing a CRM keeps private.",
  source: crmBy("frappe/crm@2cecd300 crm/fcrm/doctype/crm_lead/crm_lead.py:335; frappe/frappe@1a7ea577 contacts/doctype/contact/contact.json; docs/vision/erp.md section 2, C14"),
  affects: [table_parties, procedure_parties_resolve_recipient, decision_parties_directory_tenancy, concept_parties, concept_contacts],
});

export const decision_parties_outside_companies = defineDecision({
  id: "parties.outside-companies",
  title: "People not on Capxul are in the directory; companies join it with Capxul",
  question:
    "Core check C13: can the global directory hold people and companies who are not on Capxul? A person is named by " +
    "their mailbox before they join: a provisional Party at the Safe their mailbox derives, where money can wait for them " +
    "and which they claim by signing in. A company not on Capxul (a prospect, a supplier paid only by bank) has no Safe " +
    "and nothing Capxul can verify. Should the directory name it?",
  options: [
    {
      label: "payable-only",
      text:
        "The directory holds every identity Capxul can name and pay: people by mailbox whether or not they have joined, " +
        "agents, Capxul Organizations and outside wallets. A company not on Capxul is not in it: each Organization keeps " +
        "it in its CRM as a private CRM Organization entry with no Party (contacts), linked to the company's Party once " +
        "the company is on Capxul (its handle) or is paid at a wallet (its address).",
    },
    {
      label: "by-domain",
      text:
        "Name a company not on Capxul by its web domain: a nameless `organization` Party with no Safe, keyed by a digest " +
        "of the domain, which the company proves when it joins (a DNS record, a new integration), so every tenant's entry " +
        "for it links up at once.",
    },
    {
      label: "shared-cards",
      text: "Global company cards with a name, website and logo that any tenant may write, as a public CRM.",
    },
  ],
  chosen: "payable-only",
  why:
    "This is for Aaron: it reads 'one directory of people and companies across every tenant' as people at all times and " +
    "companies once they are on Capxul. A Party is something money can be routed to and whose owner can be proved: a " +
    "mailbox proves itself at sign-in, a handle at its Organization's birth, an address on chain. A company not on " +
    "Capxul has neither, so a global row for it would hold one tenant's words about it. Shared cards would show those " +
    "words to every tenant and let anyone deface them. A company Party that the first person with a mailbox at its " +
    "domain could claim would redirect, in every tenant's CRM, money meant for the real company to whoever claimed it, " +
    "so domain-keyed Parties need a proof Capxul does not have yet (a DNS check is a new integration and a new trust " +
    "root), and until then they give nothing a private entry lacks but cross-tenant dedupe. Frappe CRM keeps a company " +
    "per site, by name. So prospects and bank-paid suppliers stay private in each Organization's CRM, and people need " +
    "nothing new. If companies are to be named before they join, by-domain is the path, with the domain proof designed " +
    "first and the Party machine given an unclaimed company state.",
  source: crmBy("docs/vision/erp.md (C13, question 1); books/target/parties/data.ts (every Party has a safe_address); frappe/crm crm_organization.json (autoname by organization_name)"),
  affects: [table_parties, machine_party, procedure_parties_resolve_recipient, procedure_parties_register, concept_parties, concept_contacts],
});

export const decision_parties_mailbox_for_life = defineDecision({
  id: "parties.mailbox-for-life",
  title: "A person keeps one mailbox for life; moving it is a later capability",
  question:
    "Core check C27: a person's Safe address derives from their mailbox (CompaniesHouseClaimer's `safeAddressFor`), they " +
    "sign in with a code sent to it, a claim escrow waits at the Safe it derives, and the directory finds them by its " +
    "digest. Nothing moves a person to another mailbox, so an employee paid at a work address loses it with the job. Is " +
    "a person's mailbox theirs for life, or can they move their account to a new one?",
  options: [
    {
      label: "for-life",
      text:
        "One mailbox per person for good: the Party's `mailbox_digest` never changes and nothing moves it. Whoever pays " +
        "people (payroll, an ERP) pays at a mailbox the person keeps, never a work address: Frappe HR's Employee " +
        "`personal_email`, not `company_email`. A person who wants another mailbox opens another account and moves their " +
        "money themselves.",
    },
    {
      label: "move",
      text:
        "A person may move their account to a new mailbox: the new one resolves to the same Party and Safe (the Safe's " +
        "address is fixed once claimed; only its derivation used the first mailbox), sign-in moves to it, and the old " +
        "one stops signing in but still resolves, so earlier namings and escrows reach the person. Needs access (a " +
        "verified change of sign-in), parties (a second digest), accounts (the new mailbox's derived Safe must never be " +
        "handed to anyone) and a guard against a work address later given to someone else.",
    },
    { label: "aliases", text: "Several mailboxes per Party, as Frappe Contact's `email_ids`, any of which signs in." },
  ],
  chosen: "for-life",
  why:
    "This is for Aaron: whether a person will ever be able to move their account to a new mailbox. The book already " +
    "assumes one: access knows a person by their email, accounts derives their Safe from it, Companies House hands the " +
    "Safe to whoever proves it (accepted as the beta's trust root), a claim escrow binds money to it, and resolution keys " +
    "a person on its digest. Moving is possible off chain, because a claimed Safe keeps its address and its signer is " +
    "the person's key, but each of those pieces must change together, and a work mailbox reassigned to a new employee " +
    "would sign the newcomer in as the person who left: a security design, not a column. Aliases would make that risk " +
    "permanent. Frappe Contact's several mailboxes stay what they are there, an owner's private notes in its book, never " +
    "an identity. So the directory keeps one digest per person now, and the rule for anyone paying people is to pay at " +
    "a mailbox the person keeps. If moving is wanted, it is a capability designed book first across access, parties " +
    "and accounts, with the reassigned-mailbox guard first.",
  source: crmBy("docs/vision/erp.md (C27, question 5); shared/external.ts companies-house-claimer, escrow; erpnext setup/doctype/employee/employee.json (personal_email, company_email)"),
  affects: [
    table_parties, procedure_parties_resolve_recipient, rpc_parties_profiles_save, contract_companies_house_claimer, contract_escrow,
    concept_access, concept_accounts, concept_payroll, system_capxul,
  ],
});

// ── the assembly after the Frappe lanes (8 November 2026) ────────────────────────────────────

const ASSEMBLY = "Claude, identity assembly after the Frappe lanes, 8 November 2026";
const asmBy = (evidence: string) => `${ASSEMBLY}; evidence: ${evidence}`;

export const decision_parties_fde_handles = defineDecision({
  id: "parties.fde-handles",
  title: "Handles ending `-fde` or starting `fde-` are kept for Organizations' FDEs",
  question:
    "organizations.fde-handle derives an Organization's FDE handle as `<handle>-fde`, or `fde-` and ten characters of the " +
    "Organization's id when that is taken. Anyone can take `acme-fde` first today. Should the directory keep those forms " +
    "for FDEs?",
  options: [
    {
      label: "reserve-forms",
      text:
        "`parties.register` accepts a handle ending in `-fde` or starting with `fde-` only for an agent an Organization " +
        "owns (kind agent, owner_kind organization); any other registration of one is INVALID_INPUT, as a reserved word is. " +
        "A handle registered before this rule is not changed.",
    },
    { label: "first-come", text: "No reservation: the fallback `fde-<id>` keeps `org create` from failing, so a taken `-fde` handle only costs the nicer name." },
    { label: "per-organization", text: "Reserve `<handle>-fde` only for the Organization that holds `<handle>`, by reading organizations' table." },
  ],
  chosen: "reserve-forms",
  why:
    "A person who registers `@acme-fde` for their own agent can pass it off as Acme's engineer: the handle is how people " +
    "and other agents name an agent, and Acme's FDE acts inside Acme's records. Reserving the two forms keeps every " +
    "handle that reads as an FDE an Organization's own agent's. Reserving per Organization would make parties read " +
    "organizations, which sits above it; the coarse rule needs only the kind and owner the invoker already passes. An " +
    "Organization owns one live agent (agents.org-own-agent), its FDE whoever made its key (agents.fde), so an " +
    "Organization's agent made later by `agent create --org` may use the forms too. The rule refuses nothing a frozen " +
    "claim registers: no world's handle has either form.",
  source: asmBy("books/target/organizations/decisions.ts (organizations.fde-handle); books/target/agents/decisions.ts (agents.org-own-agent, agents.fde)"),
  affects: [procedure_parties_register, table_parties, decision_parties_handles, concept_organizations, concept_agents],
});

export const decision_parties_head_parties = defineDecision({
  id: "parties.head-parties",
  title: "A head's Customer, Supplier and Employee meet the directory by `capxul_party`",
  question:
    "A voucher's party is a directory Party id (books), a deal's or contact's is too (contacts), and a project's customer " +
    "is `customer_party_id` (projects). On a connected head these are ERPNext Customers, Suppliers and Employees. How " +
    "does a head document find its Party, what of one with none, and is every CRM customer a Party?",
  options: [
    {
      label: "custom-field",
      text:
        "Each of Contact, CRM Organization, Customer, Supplier and Employee carries the Party id in one Custom Field, " +
        "`capxul_party`, which only Capxul sets. When Capxul pushes a record naming a Party, the head's Capxul app finds " +
        "the document by that field, or creates it with the field set. A head document with no `capxul_party` (a customer " +
        "the head made, a supplier paid only by bank) is accepted with a null Party id: a head GL line against it comes " +
        "in with `party_id` null and the head's party name as its text, and no Party is ever named from a head. A " +
        "customer is a Party only when it is one: a person by mailbox, an agent, an Organization on Capxul or an outside " +
        "wallet; a company not on Capxul is a private CRM entry with no Party (parties.outside-companies).",
    },
    { label: "match-by-name", text: "Match a head's Customer or Supplier to a Party by its name or email when it carries no Party." },
    { label: "name-from-head", text: "Name a new Party for every head Customer and Supplier." },
  ],
  chosen: "custom-field",
  why:
    "A Party is where money goes, so only Capxul binds one (organizations.head-ownership: identity is Capxul's). One " +
    "field name across the CRM, the books and payroll lets the Capxul app look up any document the same way, and it is " +
    "the name the CRM lane chose (payroll's `capxul_party_id` on Employee becomes `capxul_party`, " +
    "organizations.frappe-app-fields). Matching by name would let a head user choose whose Safe a voucher's party is; " +
    "naming Parties from a head would put a tenant's words in the global directory. A null Party keeps a head's own " +
    "bookkeeping whole without inventing identity. For projects this means `customer_party_id` is null for a customer " +
    "that is not on Capxul, so a project for a prospect company needs the CRM entry or the head's Customer name beside " +
    "it; projects sits below contacts and cannot read the entry, so that is the projects designer's to add.",
  source: asmBy("docs/design/frappe/accounting.md (capxul_party); docs/design/frappe/crm.md (Custom Fields); books/target/projects/data.ts (customer_party_id)"),
  affects: [table_parties, component_frappe_app, integration_frappe_head, concept_books, concept_contacts, concept_payroll, concept_projects],
});
