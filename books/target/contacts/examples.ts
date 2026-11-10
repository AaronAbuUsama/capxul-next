// The examples of the contacts operations. Hannah Okafor keeps Northwind Trading's address book: Brightside Cleaning
// (first a private company entry, then linked to its Party), Marcus Lindqvist (a member) and Priya Raman. Times are
// epoch milliseconds, as the entry shape declares them.

import {
  error_CANCELLED,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { ADDRESS, ID, NORTHWIND, ok, PEOPLE, refused, uuid } from "../shared/examples.ts";

const ms = (iso: string) => Date.parse(iso);
const PHONE = "+000 555 0142";

const PARTY_MARCUS = `party_${ID.marcus}`;
const PARTY_PRIYA = `party_${ID.priya}`;
const PARTY_BRIGHTSIDE = `party_${ID.brightside}`;
const ENTRY_BRIGHTSIDE = `contact_${uuid(1110)}`;
const ENTRY_PRIYA = `contact_${uuid(1111)}`;

const noDetails = {
  email_ids: [],
  phone_nos: [],
  designation: null,
  company: null,
  website: null,
  industry: null,
  territory: null,
  no_of_employees: null,
  annual_revenue: null,
  currency: null,
  company_description: null,
};

const brightside = (over: Record<string, unknown> = {}, details: Record<string, unknown> = {}) => ({
  id: ENTRY_BRIGHTSIDE,
  ref: null,
  label: "Brightside Cleaning",
  relationship: ["manual"],
  hidden: false,
  lastActivityAt: ms("2026-02-10T09:15:00Z"),
  doctype: "organization",
  details: { ...noDetails, website: "brightside.test", industry: "Cleaning services", no_of_employees: "11-50", ...details },
  ...over,
});

const priya = {
  id: ENTRY_PRIYA,
  ref: { kind: "party", partyId: PARTY_PRIYA },
  label: "Priya Raman",
  relationship: ["member"],
  hidden: false,
  lastActivityAt: ms("2026-02-09T16:40:00Z"),
  doctype: "contact",
  details: { ...noDetails, email_ids: [{ email_id: PEOPLE.priya.email, is_primary: true }], designation: "Operations" },
};

const signedOut = (input: string) => refused("Signed out", input, error_NOT_AUTHENTICATED);
const outside = (input: string) => refused("Priya has no Seat in Northwind", input, error_ROLE_PERMISSION_DENIED);

export const examples_contact_add = [
  ok("Add Marcus to Hannah's address book by his email", "capxul contact add --input contact.json --confirm --json", {
    id: PARTY_MARCUS,
    ref: { kind: "party", partyId: PARTY_MARCUS },
    label: "Marcus Lindqvist",
    relationship: ["manual", "member"],
    hidden: false,
  }),
  refused("A script that gives neither --input nor --confirm", "capxul contact add --json", error_CLI_USAGE),
  refused("The locator does not resolve", "capxul contact add --input contact.json --confirm --json", error_INVALID_INPUT, { field: "ref", reason: "names nobody" }),
  outside(`capxul contact add --input contact.json --confirm --org ${NORTHWIND.slug} --json`),
  signedOut("capxul contact add --input contact.json --confirm --json"),
];

export const examples_contact_create = [
  ok(
    "Record Brightside Cleaning as a private company entry",
    'capxul contact create "Brightside Cleaning" --type company --website brightside.test --industry "Cleaning services" --employees 11-50 --json',
    brightside(),
  ),
  ok(
    "Record Priya, whose mailbox names her Party",
    `capxul contact create "Priya Raman" --type person --email ${PEOPLE.priya.email} --designation Operations --json`,
    priya,
  ),
  refused("A blank label", 'capxul contact create " " --type person --json', error_INVALID_INPUT, { field: "label" }),
  outside(`capxul contact create "Brightside Cleaning" --type company --org ${NORTHWIND.slug} --json`),
  signedOut('capxul contact create "Brightside Cleaning" --type company --json'),
];

export const examples_contact_change = [
  ok(
    "Add a territory to Brightside's entry",
    `capxul contact change ${ENTRY_BRIGHTSIDE} --website brightside.test --territory Harbourside --org ${NORTHWIND.slug} --json`,
    brightside({}, { territory: "Harbourside" }),
  ),
  ok(
    "Give Priya's entry a number and a title",
    `capxul contact change ${ENTRY_PRIYA} --phone "${PHONE}" --designation "Head of Operations" --json`,
    {
      ...priya,
      details: {
        ...priya.details,
        phone_nos: [{ phone: PHONE, is_primary_phone: true, is_primary_mobile_no: true }],
        designation: "Head of Operations",
      },
    },
  ),
  refused("A person's field on a company entry", `capxul contact change ${ENTRY_BRIGHTSIDE} --designation CEO --org ${NORTHWIND.slug} --json`, error_INVALID_INPUT, { field: "designation" }),
  outside(`capxul contact change ${ENTRY_BRIGHTSIDE} --website brightside.test --org ${NORTHWIND.slug} --json`),
];

export const examples_contact_link = [
  ok(
    "Name Brightside's Party by its address, so it can be paid",
    `capxul contact link ${ENTRY_BRIGHTSIDE} ${ADDRESS.brightside} --confirm --json`,
    brightside({ ref: { kind: "party", partyId: PARTY_BRIGHTSIDE } }),
  ),
  refused("Brightside's entry already has a Party", `capxul contact link ${ENTRY_BRIGHTSIDE} ${ADDRESS.brightside} --confirm --json`, error_INVALID_INPUT, { field: "contact", reason: "already has a Party" }),
  refused("Hannah answers no to the preview", `capxul contact link ${ENTRY_BRIGHTSIDE} accounts@brightside.test --json`, error_CANCELLED),
  refused("A script runs it without --confirm", `capxul contact link ${ENTRY_BRIGHTSIDE} accounts@brightside.test --json`, error_CLI_USAGE),
];

export const examples_contact_list = [
  ok("Hannah's address book, newest activity first", "capxul contact list --json", {
    items: [
      {
        id: PARTY_BRIGHTSIDE,
        ref: { kind: "party", partyId: PARTY_BRIGHTSIDE },
        label: "Brightside Cleaning",
        relationship: ["manual"],
        hidden: false,
        lastActivityAt: ms("2026-02-10T09:15:00Z"),
        doctype: "organization",
      },
      { id: PARTY_PRIYA, ref: { kind: "party", partyId: PARTY_PRIYA }, label: "Priya Raman", relationship: ["member"], hidden: false, lastActivityAt: ms("2026-02-09T16:40:00Z"), doctype: "contact" },
    ],
    nextCursor: null,
  }),
  ok("A first page of one, with hidden entries included", "capxul contact list --include-hidden --limit 1 --json", {
    items: [{ id: PARTY_BRIGHTSIDE, ref: { kind: "party", partyId: PARTY_BRIGHTSIDE }, label: "Brightside Cleaning", relationship: ["manual"], hidden: false, lastActivityAt: ms("2026-02-10T09:15:00Z"), doctype: "organization" }],
    nextCursor: "cursor_0001",
  }),
  outside(`capxul contact list --org ${NORTHWIND.slug} --json`),
];

export const examples_contact_hide = [
  ok("Hide Priya's entry from the list", `capxul contact hide ${PARTY_PRIYA} --confirm --json`, { id: PARTY_PRIYA, hidden: true }),
  refused("A script without --confirm", `capxul contact hide ${PARTY_PRIYA} --json`, error_CLI_USAGE),
  refused("The party is not in the book", `capxul contact hide party_${uuid(1199)} --confirm --json`, error_INVALID_INPUT, { field: "id" }),
];

export const examples_contact_unhide = [
  ok("Show Priya's entry in the list again", `capxul contact unhide ${PARTY_PRIYA} --confirm --json`, { id: PARTY_PRIYA, hidden: false }),
  refused("A script that leaves out the id", "capxul contact unhide --confirm --json", error_CLI_USAGE),
  refused("The party is not in the book", `capxul contact unhide party_${uuid(1199)} --confirm --json`, error_INVALID_INPUT, { field: "id" }),
];

export const examples_contact_label = [
  ok("Rename Brightside's entry", `capxul contact label ${PARTY_BRIGHTSIDE} --label "Brightside Cleaning Co" --confirm --json`, { id: PARTY_BRIGHTSIDE, label: "Brightside Cleaning Co" }),
  refused("An empty label", `capxul contact label ${PARTY_BRIGHTSIDE} --label "" --confirm --json`, error_CLI_USAGE),
  refused("The party is not in the book", `capxul contact label party_${uuid(1199)} --label "Nobody" --confirm --json`, error_INVALID_INPUT, { field: "id" }),
];
