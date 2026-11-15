// The starting worlds the thin line's journeys begin from, each declared here once and named by the promises whose
// state it is, by import. From `founded` on, each is made for each journey with the journey's own cast and company
// (`parameters`; cast.ts), by its steps, so journeys side by side never share a company (roadmap step 4.11). Every one is made through the door, by the thin line's own operations, from the one before
// it. Most are then saved as a template snapshot in the runner's one world, which is reset in place to it before a
// journey that starts there; the rest are made by their steps for each journey (docs/decisions.md, 27 and 39;
// docs/roadmap.md, "One runner, one world"). Either way the journey is handed the world's facts, which it reads with
// `given` (docs/decisions.md, 38). What a starting point is, is the toolkit's (`@capxul/blueprint-tools`, its
// language); this file holds only the blueprint's own.
import type * as Language from "@capxul/blueprint-tools";
import type * as Schema from "effect/Schema";
import { BRIGHTSIDE, INVOICE_AMOUNT, REPORTS } from "../common/site.ts";
import type { OperationName } from "../index.ts";
import { examples, facts } from "./facts.ts";

/** One step of making one: an operation through the door, as someone, or a wait for background work. */
export type Step = Language.Step<OperationName>;

/** One of the blueprint's, whose steps name its operations. */
export type StartingWorld<Facts extends Schema.Codec<unknown, unknown> = Schema.Codec<unknown, unknown>> =
  Language.StartingWorld<Facts, OperationName>;

/** A promise of the blueprint (today's word: a claim), in a state of one of its starting worlds. */
export type Claim = Language.Claim<OperationName>;

/** An operation's promises (today's word: its claims), each verb's `promises`. */
export type ClaimsOf = Language.ClaimsOf<OperationName>;

const step = (operation: Step["operation"], as: string, does: string, fact: string | null = null): Step => ({
  operation,
  as,
  does,
  fact,
});

const nothing: StartingWorld<typeof facts.nothing> = {
  name: "nothing",
  from: null,
  holds:
    "The platform is deployed. No world has the name the journey uses. The journey's operator owns fewer live worlds than the limit, and a second operator exists. The facts name both operators.",
  steps: [],
  made: "by its steps",
  parameters: [],
  facts: facts.nothing,
  example: examples.nothing,
};

const quotaFull: StartingWorld<typeof facts.quotaFull> = {
  name: "quota-full",
  from: nothing,
  holds: "The journey's operator owns as many live private worlds as one owner may have.",
  steps: [step("world.create", "operator", "creates private worlds until the limit is reached", "filled")],
  made: "by its steps",
  parameters: [],
  facts: facts.quotaFull,
  example: examples.quotaFull,
};

const fresh: StartingWorld<typeof facts.fresh> = {
  name: "fresh",
  from: nothing,
  holds:
    "A private world owned by the journey's operator, its clock frozen. Its cast: dana, eli, sam and olga, each with a claimed personal Safe holding 10,000 USDC, and pat, who has not finished signing up and has no Safe. No company.",
  steps: [
    step(
      "world.create",
      "operator",
      "creates a private world with a frozen clock and a lifetime of 60 minutes",
      "world",
    ),
  ],
  made: "from its template",
  parameters: [],
  facts: facts.fresh,
  example: examples.fresh,
};

const founded: StartingWorld<typeof facts.founded> = {
  name: "founded",
  from: fresh,
  holds:
    "The journey's Northwind (its handle the journey's: `Cast.castCompany(key, \"northwind\")`), founded by the journey's dana: Directors dana and eli, 2 of 2; members sam and pat with no permission; 1,000 USDC of dana's capital in the company Safe; its site ready, with users for dana and eli. Each role is played by the journey's own person (`Cast.castPerson`); so in every one made from it.",
  steps: [
    step(
      "org.create",
      "dana",
      "founds northwind with eli as a Director, threshold 2, members sam and pat, and 1,000 USDC of capital",
      "founded",
    ),
    step("approval.sign", "dana", "signs her setup approval", "setupCollected"),
    step("approval.sign", "eli", "signs his setup approval, which sends the setup", "setupSent"),
    step("wait", "operator", "until world.show lists northwind's site as ready"),
  ],
  made: "by its steps",
  parameters: ["cast", "company"],
  facts: facts.founded,
  example: examples.founded,
};

const officeHolder: StartingWorld<typeof facts.officeHolder> = {
  name: "office-holder",
  from: founded,
  holds:
    "sam holds Manage books: his Safe wears the Books hat and he has a user on Northwind's site. The site holds no document yet.",
  steps: [
    step("org.member.grant", "dana", "grants sam manage-books", "grant"),
    step("approval.sign", "dana", "signs the proposal", "grantCollected"),
    step("approval.sign", "eli", "signs the proposal, which executes it", "grantSent"),
    step(
      "wait",
      "sam",
      `until report.run of the ${REPORTS.generalLedger} stops refusing with NoSiteUser; a report makes nothing`,
    ),
  ],
  made: "by its steps",
  parameters: ["cast", "company"],
  facts: facts.officeHolder,
  example: examples.officeHolder,
};

const paymentDrafted: StartingWorld<typeof facts.paymentDrafted> = {
  name: "payment-drafted",
  from: officeHolder,
  holds: `The supplier ${BRIGHTSIDE} with a payment address; a submitted Purchase Invoice of ${INVOICE_AMOUNT.toFixed(2)} USDC from it; and a draft Payment Entry paying that invoice from the Capxul Safe account. Their fields are the vocabulary's (src/common/site.ts).`,
  steps: [
    step("doc.create", "sam", "creates the Supplier with supplierFields(BRIGHTSIDE)", "supplier"),
    step(
      "doc.create",
      "sam",
      `creates the Purchase Invoice with invoiceFields of ${INVOICE_AMOUNT.toFixed(2)} USDC from the Supplier`,
      "invoice",
    ),
    step("doc.submit", "sam", "submits the Purchase Invoice, which posts", "invoicePosted"),
    step(
      "doc.create",
      "sam",
      "creates the Payment Entry with paymentFields from the Capxul Safe account against the invoice",
      "payment",
    ),
  ],
  made: "by its steps",
  parameters: ["cast", "company"],
  facts: facts.paymentDrafted,
  example: examples.paymentDrafted,
};

const paymentHeld: StartingWorld<typeof facts.paymentHeld> = {
  name: "payment-held",
  from: paymentDrafted,
  holds: "The Payment Entry is submitted and held for sam's signature; nothing is posted for it yet.",
  steps: [step("doc.submit", "sam", "submits the Payment Entry, which is held", "held")],
  made: "by its steps",
  parameters: ["cast", "company"],
  facts: facts.paymentHeld,
  example: examples.paymentHeld,
};

const paid: StartingWorld<typeof facts.paid> = {
  name: "paid",
  from: paymentHeld,
  holds:
    "sam signed: Brightside was paid 125.50 USDC from the company Safe, the Payment Entry posted and the invoice has nothing outstanding.",
  steps: [
    step("approval.sign", "sam", "signs the held payment, which sends it", "paidSent"),
    step("wait", "sam", "until report.run's General Ledger shows the Payment Entry"),
  ],
  made: "by its steps",
  parameters: ["cast", "company"],
  facts: facts.paid,
  example: examples.paid,
};

const withSnapshot: StartingWorld<typeof facts.withSnapshot> = {
  name: "with-snapshot",
  from: paid,
  holds:
    "Two snapshots of the world: `m3`, saved as a template, and `draft`, which is not. A snapshot belongs to the world it was saved in, so this world is made by its steps.",
  steps: [
    step("world.snapshot.save", "operator", "saves m3 as a template", "m3"),
    step("world.snapshot.save", "operator", "saves draft", "draft"),
  ],
  made: "by its steps",
  parameters: ["cast", "company"],
  facts: facts.withSnapshot,
  example: examples.withSnapshot,
};

const restored: StartingWorld<typeof facts.restored> = {
  name: "restored",
  from: withSnapshot,
  holds:
    "A second private world, made from `m3` by the same operator, which names the first world, `m3` and its record position as its parent. A journey from it runs in the second world.",
  steps: [
    step(
      "world.snapshot.restore",
      "operator",
      "restores m3 into a new world with a lifetime of 60 minutes",
      "restored",
    ),
  ],
  made: "by its steps",
  parameters: ["cast", "company"],
  facts: facts.restored,
  example: examples.restored,
};

/** Every starting world, by the name its promises and docs/build-order.md use. */
export const startingWorlds = {
  nothing,
  quotaFull,
  fresh,
  founded,
  officeHolder,
  paymentDrafted,
  paymentHeld,
  paid,
  withSnapshot,
  restored,
} as const;
