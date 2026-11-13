// The starting worlds the thin line's scenarios begin from, each declared here once and named by its claims by
// import. Every one is made through the door, by the thin line's own operations, from the one before it, and saved
// as a template snapshot in a kept template world (decisions.md, "Starting worlds"). A scenario restores the one it
// needs into a fresh private world.
import type { OperationName } from "./door.ts";

/** One step of making a starting world: an operation through the door, as someone, or a wait for background work. */
export interface Step {
  readonly operation: OperationName | "wait";
  /** "operator" (the world's owner), "other operator", or a person of the cast. */
  readonly as: string;
  readonly does: string;
}

export interface StartingWorld {
  readonly name: string;
  /** The starting world this one is made from; null for one made from nothing. */
  readonly from: StartingWorld | null;
  /** What it holds beyond `from`. */
  readonly holds: string;
  readonly steps: ReadonlyArray<Step>;
}

const step = (operation: Step["operation"], as: string, does: string): Step => ({ operation, as, does });

const nothing: StartingWorld = {
  name: "nothing",
  from: null,
  holds:
    "The platform is deployed. No world has the name the scenario uses. The scenario's operator owns fewer live worlds than the limit, and a second operator exists.",
  steps: [],
};

const quotaFull: StartingWorld = {
  name: "quota-full",
  from: nothing,
  holds: "The scenario's operator owns as many live private worlds as one owner may have.",
  steps: [step("world.create", "operator", "creates private worlds until the limit is reached")],
};

const fresh: StartingWorld = {
  name: "fresh",
  from: nothing,
  holds:
    "A private world owned by the scenario's operator, its clock frozen, its record one entry long. Its cast: dana, eli, sam and olga, each with a claimed personal Safe holding 10,000 USDC, and pat, who has not finished signing up and has no Safe. No company.",
  steps: [step("world.create", "operator", "creates a private world with a frozen clock and a lifetime of 60 minutes")],
};

const founded: StartingWorld = {
  name: "founded",
  from: fresh,
  holds:
    "Northwind (handle `northwind`), founded by dana: Directors dana and eli, 2 of 2; members sam and pat with no permission; 1,000 USDC of dana's capital in the company Safe; its site ready, with users for dana and eli.",
  steps: [
    step(
      "org.create",
      "dana",
      "founds northwind with eli as a Director, threshold 2, members sam and pat, and 1,000 USDC of capital",
    ),
    step("approval.sign", "dana", "signs her setup approval"),
    step("approval.sign", "eli", "signs his setup approval, which sends the setup"),
    step("wait", "operator", "until world.show lists northwind's site as ready"),
  ],
};

const officeHolder: StartingWorld = {
  name: "office-holder",
  from: founded,
  holds: "sam holds Manage books: his Safe wears the Books hat and he has a user on Northwind's site.",
  steps: [
    step("org.member.grant", "dana", "grants sam manage-books"),
    step("approval.sign", "dana", "signs the proposal"),
    step("approval.sign", "eli", "signs the proposal, which executes it"),
    step("wait", "sam", "until doc.create stops refusing with NoSiteUser"),
  ],
};

const paymentDrafted: StartingWorld = {
  name: "payment-drafted",
  from: officeHolder,
  holds:
    "The supplier Brightside Cleaning Ltd with a payment address; a submitted Purchase Invoice of 125.50 USDC from it; and a draft Payment Entry paying that invoice from the Capxul Safe account.",
  steps: [
    step("doc.create", "sam", "creates the Supplier with its payment address"),
    step("doc.create", "sam", "creates the Purchase Invoice of 125.50 USDC"),
    step("doc.submit", "sam", "submits the Purchase Invoice, which posts"),
    step("doc.create", "sam", "creates the Payment Entry from the Capxul Safe account against the invoice"),
  ],
};

const paymentHeld: StartingWorld = {
  name: "payment-held",
  from: paymentDrafted,
  holds: "The Payment Entry is submitted and held for sam's signature; nothing is posted for it yet.",
  steps: [step("doc.submit", "sam", "submits the Payment Entry, which is held")],
};

const paid: StartingWorld = {
  name: "paid",
  from: paymentHeld,
  holds:
    "sam signed: Brightside was paid 125.50 USDC from the company Safe, the Payment Entry posted and the invoice has nothing outstanding.",
  steps: [
    step("approval.sign", "sam", "signs the held payment, which sends it"),
    step("wait", "sam", "until report.run's General Ledger shows the Payment Entry"),
  ],
};

const withSnapshot: StartingWorld = {
  name: "with-snapshot",
  from: paid,
  holds: "Two snapshots of the world: `m3`, saved as a template, and `draft`, which is not.",
  steps: [
    step("world.snapshot.save", "operator", "saves m3 as a template"),
    step("world.snapshot.save", "operator", "saves draft"),
  ],
};

const restored: StartingWorld = {
  name: "restored",
  from: withSnapshot,
  holds:
    "A second private world, made from `m3` by the same operator, which names the first world, `m3` and its record position as its parent.",
  steps: [step("world.snapshot.restore", "operator", "restores m3 into a new world with a lifetime of 60 minutes")],
};

/** Every starting world, by the name its claims and order.md use. */
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
