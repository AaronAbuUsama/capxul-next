// The checks of every doc.create (claims.md, doc.create 1 to 3): a document is created as a draft of the doctype
// asked, with the fields asked, and the record gains its doc_created; a caller with no user on the site and a
// document the site refuses are refused, naming why, and nothing is made.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import { expect } from "../expectation.ts";
import { same } from "../support/expect.ts";
import { entriesAfter } from "../support/world.ts";
import { namesCaller, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks } from "./format.ts";

/** The fields asked whose values are text: a site keeps each as it was given. */
const textFields = (fields: Readonly<Record<string, unknown>>) =>
  Arr.filter(Rec.toEntries(fields), (entry): entry is [string, string] => typeof entry[1] === "string");

export const docCreate = checks<"doc.create", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, made, before) => [
    check(
      "it is a named draft of the doctype asked",
      Effect.gen(function* () {
        yield* same("the document's doctype and docstatus", [made.doctype, made.docstatus], [asked.payload.doctype, 0]);
        yield* expect(made.name !== "", "the document has no name");
      }),
    ),
    check(
      "it keeps the text fields asked as they were given",
      same(
        "the text fields",
        Arr.map(textFields(asked.payload.fields), ([field]) => [field, made.fields[field]]),
        textFields(asked.payload.fields),
      ),
    ),
    check(
      "the record gains its doc_created",
      Effect.flatMap(entriesAfter(before.head, before.where), (added) =>
        same(
          "the entries the document added",
          Arr.map(added, (entry) => [entry.event, entry.carried]),
          [["doc_created", { org: asked.payload.org, doctype: made.doctype, name: made.name }]],
        ),
      ),
    ),
  ],
  refusals: {
    NoSiteUser: (asked, refused, before) => [
      check("NoSiteUser names the company asked", same("its org", refused.org, asked.payload.org)),
      namesCaller("NoSiteUser", refused.person, asked.options),
      nothingRecorded("the refused document", before),
    ],
    SiteRefused: (asked, refused, before) => [
      check(
        "SiteRefused names the company and the doctype asked",
        same("SiteRefused", [refused.org, refused.target], [asked.payload.org, asked.payload.doctype]),
      ),
      nothingRecorded("the refused document", before),
    ],
    OrgNotFound: (asked, refused, before) => [
      check("OrgNotFound names the company asked", same("its org", refused.org, asked.payload.org)),
      nothingRecorded("the refused document", before),
    ],
  },
});
