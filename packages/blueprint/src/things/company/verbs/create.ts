// `capxul company create` (today `org.create`): founding a company.
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, outcome, claim, kept, rewritten, dropped } from "@capxul/blueprint-tools";
import { InsufficientBalance, NotImplemented } from "../../../common/refusals.ts";
import { Approval, Money, OrgHandle, OrgId, PersonId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { OrgFounded } from "../events.ts";
import { approval, northwindFounded } from "../examples.ts";
import { FounderNotReady, FoundingChanged, HandleTaken, PersonNotFound, SetupUnfinished } from "../refusals.ts";
import { Founded, Profile } from "../values.ts";

const Founding = Schema.Struct({
  handle: OrgHandle,
  profile: Profile,
  /** Founding Directors besides the founder, who is always one. */
  directors: Schema.Array(PersonId),
  threshold: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  /** Founding members: people seated in the company with no permission yet. */
  members: Schema.Array(PersonId),
  /** The founder's opening capital, moved from the founder's Safe to the company Safe when the setup is signed. */
  capital: Schema.NullOr(Money),
}).check(
  Schema.makeFilter(
    (founding) => founding.threshold <= founding.directors.length + 1 || "the threshold is more than the Directors",
  ),
);

/** The founder asked again with the same founding: the same company, as it stands. Nothing changed. */
export class Resumed extends Schema.TaggedClass<Resumed, { readonly brand: unique symbol }>()("Resumed", {
  org: OrgId,
  handle: OrgHandle,
  setup: Schema.Literals(["awaiting_signatures", "ready"]),
  /** The approvals not yet signed. */
  approvals: Schema.Array(Approval),
}) {}

const createRpc = Rpc.make("org.create", {
  payload: Founding,
  success: Schema.Union([Founded, Resumed]),
  error: Schema.Union([
    FounderNotReady,
    HandleTaken,
    FoundingChanged,
    SetupUnfinished,
    PersonNotFound,
    InsufficientBalance,
    NotImplemented,
  ]),
});

export const create = verb({
  rpc: createRpc,
  outcomes: {
    Founded: outcome(createRpc, "Founded", [
      {
        event: OrgFounded,
        carries: ({ success }) => ({
          org: success.org,
          handle: success.handle,
          safe: success.safe,
          founder: success.founder,
          approvals: Arr.map(success.approvals, (each) => each.id),
        }),
      },
    ]),
    Resumed: outcome(createRpc, "Resumed", []),
  },
  budget: {
    ms: 8_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "two service-key transactions (the company Safe's mint and its deploy) on the world's own chain, then opening the approvals",
  },
  examples: [
    {
      payload: {
        handle: "northwind",
        profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
        directors: ["eli"],
        threshold: 2,
        members: ["sam", "pat"],
        capital: { asset: "USDC", amount: "1000" },
      },
      success: northwindFounded,
    },
    {
      payload: {
        handle: "northwind",
        profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
        directors: ["eli"],
        threshold: 2,
        members: ["sam", "pat"],
        capital: { asset: "USDC", amount: "1000" },
      },
      success: Resumed.make({
        org: "org_northwind1",
        handle: "northwind",
        setup: "awaiting_signatures",
        approvals: [approval("apr_setup2", "eli", 2)],
      }),
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `org.create` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: create,
  claims: [
    claim(
      "The Organization's Safe is Companies House's company Safe for this founder.",
      w.fresh,
      "org.create as dana answers a Safe. Through the door's chain RPC, chain.logs holds one CompanySafeMinted emitted by Companies House (`contracts.companiesHouse`, which runs the world's minter, `contracts.companySafeMinter`, by delegatecall, so the log is its own) naming that Safe, dana's personal Safe as founderSafe and the org id as company, and chain.companySafeFor of the world's Companies House owner and namespace (`contracts`), the org id and dana's Safe is the same address.",
      { origin: kept("org.create/c-37a24168b5b82483"), thinLine: true },
    ),
    claim(
      "It answers with the Organization's id and the approvals its founding Directors must sign, before anyone has signed.",
      w.fresh,
      "org.create as dana with eli as a Director and threshold 2 answers Founded with the org id and one approval each for dana and eli, each naming its signer's address and a digest.",
      {
        origin: rewritten(
          "org.create/c-f76d985ce2889eda",
          "It prints and saves the exact ID before authorization, then stops at a truthful deadline.",
          "The operation never waits for a signature, so it has no deadline; the command line's waiting is not part of the contract.",
        ),
      },
    ),
    claim(
      "Once enough founding Directors have signed, the setup completes: the board and the capital are on the chain and the company's site becomes ready.",
      w.fresh,
      "After org.create, approval.sign by dana answers Collected and by eli answers Sent for the org setup, whose subject is the org id. Through the door's chain RPC the company Safe's owners are dana's and eli's Safes with threshold 2 (chain.safe) and it holds 1,000 USDC (chain.balance), and dana's Safe holds 9,000; world.show then lists the company's site as ready.",
    ),
    claim(
      "The same intent resumes the same Organization; a changed intent or another founder refuses.",
      w.fresh,
      "The same org.create twice answers Founded, then Resumed with the same org id and no event. The same handle with another name is refused with FoundingChanged; the same handle founded by eli is refused with HandleTaken. world.show lists one company.",
      { refusals: [FoundingChanged, HandleTaken], origin: kept("org.create/c-f18049cd600668af") },
    ),
    claim(
      "It needs the founder's claimed personal Safe before the first write.",
      w.fresh,
      "org.create as pat is refused with FounderNotReady; world.show lists no company and record.export no new entry.",
      {
        refusals: [FounderNotReady],
        origin: rewritten(
          "org.create/c-313abdcaa41f9df9",
          "It needs the founder's deployed, claimed account before the first write.",
          'What the founder needs is a claimed personal Safe; "account" named an old accounts concept.',
        ),
      },
    ),
    claim(
      "Bio and size are stored trimmed, and an over-long bio is refused.",
      w.fresh,
      "A founding typed with its bio and size padded with spaces, decoded by org.create's payload schema as the command line decodes what a person types, is answered Founded with them trimmed, and the same founding resumes it. The spaces never reach a typed payload, because the schema's typed side is trimmed text: a payload that still holds them, and a bio of 281 characters, are rejected by the payload's schema before they are sent. Each call fails with PayloadRejected naming org.create, no company is made and the record gains no entry.",
      { origin: kept("org.create/c-38c97cf2c6a5056c") },
    ),
    claim(
      "A founding Director or member who is not a person of the world, capital beyond the founder's balance, and a second founding while the first is unfinished are each refused, and nothing is made.",
      w.fresh,
      "org.create naming a Director nobody in the cast is refused with PersonNotFound; with capital of 20,000 USDC, with InsufficientBalance; a second handle by dana while northwind awaits signatures, with SetupUnfinished. record.export shows no entry for any of them.",
      { refusals: [PersonNotFound, InsufficientBalance, SetupUnfinished] },
    ),
  ],
  dropped: [
    dropped(
      "org.create/c-fae49b69ef6deed4",
      "A founder on the beta waitlist is refused until an operator admits them.",
      "Admission is not part of a world: everyone in a world's cast is admitted. The waitlist belongs to real sign-in (roadmap phase 4).",
    ),
    dropped(
      "org.create/c-e74f131ab3816a02",
      "An invalid logo is refused and leaves no Organization and no setup, and its handle stays free.",
      "A logo is a stored file, and no operation of the thin line stores files.",
    ),
  ],
};
