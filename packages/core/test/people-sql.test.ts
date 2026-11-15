// The people operations served in this process against a real Postgres with Core's migrations applied, from Northwind
// founded (the starting world `founded`): the journey "invite olga to Northwind" in packages/scenarios, step by step,
// with what each call answers, refuses and records, and org.member.grant seeing olga once she has accepted. Runs only
// with CAPXUL_TEST_DATABASE (a throwaway Postgres, such as `docker run -e POSTGRES_PASSWORD=pg -p 55432:5432
// postgres:17-alpine`); CI has none, so it skips.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Order from "effect/Order";
import * as Str from "effect/String";
import { migrations } from "../src/door.ts";
import { answer, as, core, eventsOf, fresh, ORG, recordSize, refusal } from "./support/people.ts";

const url = process.env["CAPXUL_TEST_DATABASE"];
const skip = url === undefined;
const runtime = ManagedRuntime.make(core(url ?? ""));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;
const it = <E>(name: string, body: Effect.Effect<void, E, Services>) =>
  test(name, { skip }, () => runtime.runPromise(Effect.orDie(body)));

let n = 0;
const next = () => (n += 1);
const invite = (email: string, by: string | undefined, org = ORG) =>
  as(next(), by, (client, options) => client("invitation.send", { org, email, role: "member" }, options));
const list = (org: string, by: string | undefined) =>
  as(next(), by, (client, options) => client("org.member.list", { org }, options));
const mine = (by: string | undefined) => as(next(), by, (client, options) => client("invitation.list", {}, options));
const accept = (invitation: string, by: string) =>
  as(next(), by, (client, options) => client("invitation.accept", { invitation }, options));
const decline = (invitation: string, by: string) =>
  as(next(), by, (client, options) => client("invitation.decline", { invitation }, options));
const grant = (member: string) =>
  as(next(), "dana", (client, options) =>
    client("org.member.grant", { org: ORG, member, permission: "issue-invoices", note: null }, options),
  );

const FOUNDED = [
  { person: "dana", email: "dana@cast.test", role: "director" },
  { person: "eli", email: "eli@cast.test", role: "director" },
  { person: "sam", email: "sam@cast.test", role: "member" },
  { person: "pat", email: "pat@cast.test", role: "member" },
];
const OLGA = { person: "olga", email: "olga@cast.test", role: "member" };
const tags = (ended: ReadonlyArray<Readonly<Record<string, unknown>>>) => Arr.map(ended, (each) => each["_tag"]);

/** The invitations of the journey, as they were answered. */
const sent = { first: "", second: "" };

const folder = fileURLToPath(migrations.href);
const files = Arr.map(Arr.sort(Arr.filter(readdirSync(folder), Str.endsWith(".sql")), Order.String), (file) =>
  readFileSync(`${folder}${file}`, "utf8"),
);

it("the world: a fresh database, the cast, and northwind founded", fresh(files));

it(
  "org.member.list: Directors in the board's order, then members; the owner sees it, an outsider is refused",
  Effect.gen(function* () {
    assert.deepEqual((yield* answer(yield* list(ORG, "dana"))).members, FOUNDED);
    assert.deepEqual((yield* answer(yield* list(ORG, undefined))).members, FOUNDED);
    assert.deepEqual(yield* refusal(yield* list(ORG, "olga")), { _tag: "NotAMember", org: ORG, person: "olga" });
    assert.deepEqual(yield* refusal(yield* list("org_nowhere1", "dana")), { _tag: "OrgNotFound", org: "org_nowhere1" });
    assert.equal(yield* recordSize, 0);
  }),
);

it(
  "invitation.send: who is not the founder may not invite, and who already belongs is refused, recording nothing",
  Effect.gen(function* () {
    const refused = [
      yield* refusal(yield* invite("olga@cast.test", "sam")),
      yield* refusal(yield* invite("olga@cast.test", "eli")),
      yield* refusal(yield* invite("rex@elsewhere.test", "olga")),
      yield* refusal(yield* invite("olga@cast.test", undefined)),
      yield* refusal(yield* invite("sam@cast.test", "dana")),
      yield* refusal(yield* invite("eli@cast.test", "dana")),
      yield* refusal(yield* invite("olga@cast.test", "dana", "org_nowhere1")),
    ];
    assert.deepEqual(tags(refused), [
      "CannotManagePeople",
      "CannotManagePeople",
      "CannotManagePeople",
      "CannotManagePeople",
      "AlreadyAMember",
      "AlreadyAMember",
      "OrgNotFound",
    ]);
    assert.deepEqual(refused[0], { _tag: "CannotManagePeople", org: ORG, person: "sam" });
    // eli is a Director but not the founder: for now only the founder invites.
    assert.deepEqual(refused[1], { _tag: "CannotManagePeople", org: ORG, person: "eli" });
    assert.deepEqual([refused[4]?.["person"], refused[5]?.["person"]], ["sam", "eli"]);
    assert.equal(yield* recordSize, 0);
  }),
);

it(
  "invitation.send: dana invites olga, pending at once, recording member_invited without the email; not twice",
  Effect.gen(function* () {
    const ended = yield* invite("olga@cast.test", "dana");
    const invited = yield* answer(ended);
    assert.match(invited.id, /^inv_[a-z0-9]{12}$/);
    assert.deepEqual(
      { ...invited, id: "" },
      {
        id: "",
        org: ORG,
        handle: "northwind",
        email: "olga@cast.test",
        role: "member",
        invitedBy: "dana",
        state: "pending",
        invitedAt: "2026-11-13T09:00:00.000Z",
      },
    );
    assert.deepEqual(yield* eventsOf(ended.trace), [
      { event: "member_invited", payload: { invitation: invited.id, org: ORG, role: "member", by: "dana" } },
    ]);
    sent.first = invited.id;
    const twice = yield* refusal(yield* invite("olga@cast.test", "dana"));
    assert.deepEqual(twice, { _tag: "AlreadyInvited", org: ORG, email: "olga@cast.test", invitation: invited.id });
    const rex = yield* answer(yield* invite("rex@elsewhere.test", "dana"));
    assert.equal(rex.state, "pending");
    assert.equal(yield* recordSize, 2);
  }),
);

it(
  "invitation.list: olga lists dana's invitation; sam, the owner and nobody else list rex's",
  Effect.gen(function* () {
    const hers = (yield* answer(yield* mine("olga"))).invitations;
    assert.deepEqual(
      Arr.map(hers, (each) => [each.id, each.state, each.invitedBy]),
      [[sent.first, "pending", "dana"]],
    );
    assert.deepEqual((yield* answer(yield* mine("sam"))).invitations, []);
    assert.deepEqual((yield* answer(yield* mine(undefined))).invitations, []);
  }),
);

it(
  "invitation.decline: sam may not, olga declines once, an id nobody issued is not found; she does not join",
  Effect.gen(function* () {
    const size = yield* recordSize;
    const notHis = yield* refusal(yield* decline(sent.first, "sam"));
    assert.deepEqual(notHis, { _tag: "NotYourInvitation", invitation: sent.first, person: "sam" });
    const ended = yield* decline(sent.first, "olga");
    const declined = yield* answer(ended);
    assert.equal(declined.state, "declined");
    assert.equal(declined.invitedAt, "2026-11-13T09:00:00.000Z");
    assert.deepEqual(yield* eventsOf(ended.trace), [
      { event: "invitation_declined", payload: { invitation: sent.first, org: ORG } },
    ]);
    const closed = yield* refusal(yield* decline(sent.first, "olga"));
    assert.deepEqual(closed, { _tag: "InvitationClosed", invitation: sent.first, state: "declined" });
    assert.equal((yield* refusal(yield* decline("inv_nobody01", "olga")))["_tag"], "InvitationNotFound");
    assert.deepEqual((yield* answer(yield* list(ORG, "dana"))).members, FOUNDED);
    assert.equal(yield* recordSize, size + 1);
  }),
);

it(
  "invitation.accept: eli may not invite olga again, dana does; she accepts and is a member at once, once; grant sees her",
  Effect.gen(function* () {
    assert.equal((yield* refusal(yield* grant("olga")))["_tag"], "NotAMember");
    const notFounder = yield* refusal(yield* invite("olga@cast.test", "eli"));
    assert.deepEqual(notFounder, { _tag: "CannotManagePeople", org: ORG, person: "eli" });
    const again = yield* answer(yield* invite("olga@cast.test", "dana"));
    assert.equal(again.invitedBy, "dana");
    assert.notEqual(again.id, sent.first);
    sent.second = again.id;
    const size = yield* recordSize;
    const refused = [
      yield* refusal(yield* accept(sent.first, "olga")),
      yield* refusal(yield* accept("inv_nobody01", "olga")),
      yield* refusal(yield* accept(sent.second, "sam")),
    ];
    assert.deepEqual(tags(refused), ["InvitationClosed", "InvitationNotFound", "NotYourInvitation"]);
    assert.equal(yield* recordSize, size);
    const ended = yield* accept(sent.second, "olga");
    const accepted = yield* answer(ended);
    assert.equal(accepted._tag, "Accepted");
    assert.deepEqual(accepted.invitation, { ...again, state: "accepted" });
    assert.deepEqual(accepted.member, OLGA);
    assert.deepEqual(yield* eventsOf(ended.trace), [
      {
        event: "invitation_accepted",
        payload: { invitation: sent.second, org: ORG, person: "olga", role: "member" },
      },
    ]);
    const twice = yield* answer(yield* accept(sent.second, "olga"));
    assert.deepEqual([twice._tag, twice.invitation, twice.member], ["AlreadyAccepted", accepted.invitation, OLGA]);
    assert.equal(yield* recordSize, size + 1);
    // org.member.grant now passes its member check and stops at the next: olga has no Safe yet.
    assert.deepEqual(yield* refusal(yield* grant("olga")), { _tag: "MemberHasNoSafe", org: ORG, person: "olga" });
  }),
);

it(
  "after: olga's invitations oldest first, she lists Northwind's people last as a member, and cannot be invited",
  Effect.gen(function* () {
    const hers = (yield* answer(yield* mine("olga"))).invitations;
    assert.deepEqual(
      Arr.map(hers, (each) => [each.id, each.state]),
      [
        [sent.first, "declined"],
        [sent.second, "accepted"],
      ],
    );
    assert.deepEqual((yield* answer(yield* list(ORG, "olga"))).members, [...FOUNDED, OLGA]);
    assert.deepEqual((yield* answer(yield* list(ORG, "dana"))).members, [...FOUNDED, OLGA]);
    assert.deepEqual(yield* refusal(yield* invite("olga@cast.test", "dana")), {
      _tag: "AlreadyAMember",
      org: ORG,
      person: "olga",
    });
  }),
);

after(() => runtime.dispose());
