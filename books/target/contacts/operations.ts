// The five frozen operations contacts owns (OPERATION_OWNERS): `contact add`, `hide`, `label`,
// `list` and `unhide`. `contact get` and `contact bank add` are banking's, because both carry the
// contact's bank accounts (shared operations.contact-get-in-banking; decision contacts.get-moved).
// Text comes from the frozen book through frozenText, never retyped; acceptance claims are the
// frozen ones word for word except `contact list` #1, rewritten as an outcome (decision
// contacts.acceptance-rewrites).
//
// Every refusal is reached from the world `person-with-contacts` (decision contacts.worlds):
// NOT_AUTHENTICATED by calling there with no session.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CANCELLED,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import {
  Entry,
  rpc_contacts_book_add,
  rpc_contacts_book_list,
} from "./book.ts";
import {
  flow_client_account_address_book_hide,
  flow_client_account_address_book_label,
  flow_client_account_address_book_unhide,
} from "./flows.ts";

const CLI = "apps/cli/src/commands/contact";
const AS_IS = "docs/as-is/archive/operations/payments.ts";
const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;

/** The world every refusal here is reached from. */
export const WORLD = "person-with-contacts";

const ERRORS = {
  CLI_USAGE: error_CLI_USAGE,
  INVALID_INPUT: error_INVALID_INPUT,
  NOT_AUTHENTICATED: error_NOT_AUTHENTICATED,
  ROLE_PERMISSION_DENIED: error_ROLE_PERMISSION_DENIED,
} as const;

/** The page's refusals, in its order and words. */
const refusals = (id: FrozenId) =>
  frozenRefusals(id).map(({ code, when }) => {
    const error = (ERRORS as Record<string, (typeof ERRORS)[keyof typeof ERRORS] | undefined>)[code];
    if (error === undefined) throw new Error(`${id}: the refusal code ${code} has no error record here`);
    return { error, given: WORLD, when };
  });

type FrozenLine = { readonly claim: string; readonly was: readonly string[] };
const frozenLine = (id: FrozenId, n: number) => (frozen[id].acceptance as readonly FrozenLine[])[n - 1]!;

/** Acceptance line n (from 1), its claim kept word for word, its test citation in `was`. */
const kept = (id: FrozenId, n: number, observes: string) => {
  const a = frozenLine(id, n);
  return { claim: a.claim, observes, was: [...a.was] };
};

/** Acceptance line n rewritten as an outcome: the old claim and its citation move to `was`. */
const rewritten = (id: FrozenId, n: number, claim: string, observes: string) => {
  const a = frozenLine(id, n);
  return { claim, observes, was: [a.claim, ...a.was] };
};

const PartyRef = Entry.fields.ref;

/** At a terminal, a guided command makes a second call before its one write or read. */
const guidedWrite = {
  ...budget("write"),
  p50Ms: 900,
  p95Ms: 1_900,
  excludes: ["wait.person"],
  why: "at a terminal it reads the entry for its preview before its one write: two calls in sequence",
};

// ── contact add ─────────────────────────────────────────────────────────────────────────────

// The CLI reads `--input` (64 KB, strict keys) or asks for each field at a terminal, shows the
// preview from what was typed and asks (a decline is CANCELLED and calls nothing), then calls the
// one SDK method `client.account.addressBook.add`, which is one rpc.
export const operation_contact_add = defineOperation({
  ...frozenText("contact.add"),
  was: [page("contact.add"), `${AS_IS}:916`, `${CLI}/subcommands/add/execute.ts:23`, `${CLI}/internal/parse.ts:48`],
  priority: "normal",
  implementedBy: rpc_contacts_book_add,
  acceptance: [
    kept(
      "contact.add",
      1,
      "cli: adding one person by email, then by handle, then by PartyId prints the same `id` (a `party_` id) with `ref` " +
        "{kind: party} each time; read: `contact list` shows one entry for them; cli: no output carries a Safe address, a " +
        "chain id or a transaction hash.",
    ),
    kept(
      "contact.add",
      2,
      "cli: adding yourself (by your own email or handle) and adding with a 121-character label are each INVALID_INPUT; " +
        "world: the diff across each refusal is empty, no new Party included.",
    ),
    kept(
      "contact.add",
      3,
      "cli and read: an entry added by handle, address or PartyId shows no mailbox in `add`, `get` or `list` output, even " +
        "for a person whose mailbox another book typed; one added by email with no label shows the mailbox typed.",
    ),
    kept(
      "contact.add",
      4,
      "cli: the terminal wizard and `--input` with the same fields show the same preview and print the same entry; trace: " +
        "each run makes one `contacts.book.add` call, after the preview; world: a declined preview leaves the diff empty.",
    ),
  ],
  returns: Schema.Struct({
    id: Entry.fields.id, // The contact's stable PartyId.
    ref: PartyRef, // How you named them: the party locator the money path takes.
    label: Entry.fields.label, // Its label.
    relationship: Entry.fields.relationship, // How you know them.
    hidden: Entry.fields.hidden, // false.
  }),
  errors: [error_CLI_USAGE, error_CANCELLED],
  refusals: refusals("contact.add"),
  budget: budget("write"),
});

// ── contact hide ────────────────────────────────────────────────────────────────────────────

export const operation_contact_hide = defineOperation({
  ...frozenText("contact.hide"),
  was: [page("contact.hide"), `${AS_IS}:979`, `${CLI}/internal/visibility.ts:20`, `${CLI}/internal/write.ts:26`],
  priority: "normal",
  implementedBy: flow_client_account_address_book_hide,
  acceptance: [
    kept(
      "contact.hide",
      1,
      "read: after the hide, `contact list` leaves the entry out and `contact get` still returns it, with `hidden: true`.",
    ),
    kept(
      "contact.hide",
      2,
      "read: the hidden entry keeps its id, ref, label and relationship, and `contact list --include-hidden` lists it.",
    ),
    kept(
      "contact.hide",
      3,
      "cli: the output carries the entry's fields and the `capxul contact unhide` command for the same book (with its " +
        "`--org`); world: a declined preview leaves the diff empty.",
    ),
  ],
  returns: Schema.Struct({
    id: Entry.fields.id, // The contact's PartyId.
    hidden: Entry.fields.hidden, // true.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.hide"),
  budget: guidedWrite,
});

// ── contact label ───────────────────────────────────────────────────────────────────────────

export const operation_contact_label = defineOperation({
  ...frozenText("contact.label"),
  was: [page("contact.label"), `${AS_IS}:949`, `${CLI}/subcommands/label/execute.ts:24`, `${CLI}/internal/write.ts:40`],
  priority: "normal",
  implementedBy: flow_client_account_address_book_label,
  acceptance: [
    kept(
      "contact.label",
      1,
      "cli: a label of spaces only and a 121-character label are each INVALID_INPUT; read: `contact get` shows the old " +
        "label; world: the diff across each refusal is empty.",
    ),
    kept(
      "contact.label",
      2,
      "read: of two entries with the same label, labelling one by its PartyId changes that entry's label and not the other's.",
    ),
    kept(
      "contact.label",
      3,
      "cli: at a terminal the preview shows the new label before the question; trace: one `contacts.book.label` call, after " +
        "the `wait.person` of the question.",
    ),
  ],
  returns: Schema.Struct({
    id: Entry.fields.id, // The contact's PartyId.
    label: Entry.fields.label, // The new label.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.label"),
  budget: guidedWrite,
});

// ── contact list ────────────────────────────────────────────────────────────────────────────

// The CLI checks `--limit` (1 to 100, default 25) and the shape of `--after` (CLI_USAGE), then
// calls the one SDK method `client.account.addressBook.list`, which is one rpc: the server pages.
export const operation_contact_list = defineOperation({
  ...frozenText("contact.list"),
  was: [page("contact.list"), `${AS_IS}:840`, `${CLI}/subcommands/list/execute.ts:23`, "apps/cli/src/runtime/paging.ts:82"],
  priority: "normal",
  implementedBy: rpc_contacts_book_list,
  acceptance: [
    rewritten(
      "contact.list",
      1,
      "A book lists only its own entries, and reading it takes no longer however many Parties and other books exist outside it.",
      "world: the same book read in this world and in one where other tenants hold thousands of Parties and entries " +
        "returns the same page; trace: the `contacts.book.list` span stays within the read budget in both.",
    ),
    kept(
      "contact.list",
      2,
      "read: in the Organization's book an entry added by hand that is also a member shows `manual` and `member`; once its " +
        "Seat ends (the agent removed on chain) it shows only `manual`, and an entry that was only a member leaves the list.",
    ),
    kept(
      "contact.list",
      3,
      "read: a hidden entry is absent from `contact list` and present in `contact list --include-hidden`.",
    ),
    kept(
      "contact.list",
      4,
      "read: the person's own book and the Organization's list different entries, and neither shows the other's; cli: " +
        "`--org` naming an Organization the caller holds no Seat in is ROLE_PERMISSION_DENIED.",
    ),
  ],
  returns: Schema.Struct({
    items: Schema.Array(Entry), // Each contact with its PartyId, ref, label, relationships, whether hidden, and its last activity.
    nextCursor: Schema.NullOr(Schema.String), // The `--after` value for the next page, or null on the last.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.list"),
  budget: budget("read"),
});

// ── contact unhide ──────────────────────────────────────────────────────────────────────────

export const operation_contact_unhide = defineOperation({
  ...frozenText("contact.unhide"),
  was: [page("contact.unhide"), `${AS_IS}:1007`, `${CLI}/internal/visibility.ts:20`, `${CLI}/internal/write.ts:40`],
  priority: "normal",
  implementedBy: flow_client_account_address_book_unhide,
  acceptance: [
    kept(
      "contact.unhide",
      1,
      "cli: hide, unhide and label of a PartyId outside the book are each INVALID_INPUT, from a script and at a terminal " +
        "alike; world: the diff across each refusal is empty.",
    ),
    kept(
      "contact.unhide",
      2,
      "read: after unhide the entry has the id, ref, label and relationship it had before the hide; cli: unhiding a listed " +
        "entry prints it unchanged, with `hidden: false`.",
    ),
  ],
  returns: Schema.Struct({
    id: Entry.fields.id, // The contact's PartyId.
    hidden: Entry.fields.hidden, // false.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.unhide"),
  budget: guidedWrite,
});
