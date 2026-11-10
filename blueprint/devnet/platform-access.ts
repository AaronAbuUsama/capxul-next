// Getting people and agents into a world: invitations and join links, joining with a key, grants and their revocation, and viewer links. A person or agent has one key; joining a world gives
// that key an account in that world and nothing else. See docs/design/worlds-platform.md, "Getting in". People's sign-in and signing belong to Capxul Core and are designed there (aaron.sign-in-is-core): every seat can be played by an agent now; a human seat and a viewer link are specified here and not opened until that design exists.

import { Schema } from "effect";
import { error_CAPABILITY_UNAVAILABLE, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { ok, refused } from "../shared/examples.ts";
import { table_command_records, table_worlds } from "./world-data.ts";
import { GrantRole, table_world_grants, table_world_invitations, table_world_members } from "./platform-data.ts";
import { addressOf, ADDR, B, BASE, GrantView, InvitationView, make, ms, N, Null, S, Site, siteOf } from "./platform-kit.ts";

const ORGANISER = "An organiser of the world (the holder of an organiser grant).";
const W = { run: "run-open", member: "org-with-member", out: "signed-out", empty: "empty-devnet", full: "world-full-four" } as const;
const OUT = { error: error_NOT_AUTHENTICATED, given: W.out, when: "No one is signed in on this machine." } as const;
const NOT_ORG = { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "A player or viewer, not an organiser; nothing changes." } as const;
const NO_WORLD = { error: error_INVALID_INPUT, given: W.empty, when: "No world has that name." } as const;
const notOrg = (cmd: string) => refused("Priya is a player, not an organiser", cmd, error_ROLE_PERMISSION_DENIED);
const inv = (over: Record<string, unknown> = {}) => ({ invitationId: "inv_0001", worldId: "r00042", role: "player", seat: "bc-finance", boundAddress: ADDR.tester1, uses: 0, maxUses: 1, expiresAt: ms("2026-12-02T09:00:00Z"), revoked: false, ...over });
const grant = (over: Record<string, unknown> = {}) => ({ worldId: "r00042", keyAddress: ADDR.tester1, role: "player", seat: "bc-finance", via: "inv_0001", expiresAt: null, revoked: false, ...over });

const inviteCreate = make({
  id: "world.invite.create", command: "world invite create", title: "Make a join link for a world", rpc: "devnet.worlds.invite-create", kind: "mutation", priority: "critical",
  about: "The organiser's one command for a person or agent who already has a key: `world invite create r00042 --role player --seat bc-finance --key 0xabc…` makes a link bound to that key. Without `--key` the link is open and works for its first `--uses` holders of any key. The link is `capxul://join/<world>/<code>`; the code is shown once and stored as a hash. It expires (default 24 hours) and never outlives its run. `--role` is organiser, player or viewer.",
  who: ORGANISER, changes: "One invitation, with the code's hash; nothing is created for the invited key until it joins.",
  input: Schema.Struct({ world: S, role: GrantRole, seat: Null(S), key: Null(S), uses: N, ttlHours: N }), output: Schema.Struct({ invitation: InvitationView, link: S }),
  reads: [table_worlds], writes: [table_world_invitations, table_command_records],
  claims: [{ claim: "An invitation bound to a key works for that key only, once, until it expires.", observes: `cli: \`world invite create r00042 --role player --seat bc-finance --key <A> --json\` prints a link; a key B joining with it is refused INVALID_INPUT; key A joins; A joining again with it is refused INVALID_INPUT (used).` },
    { claim: "No key and no email is stored in an invitation, and the code is shown once.", observes: `cli: \`world invite list r00042 --json\` shows the invitation with no code; a grep of the invitation row for the code finds only its hash.` }],
  refusals: [OUT, NO_WORLD, NOT_ORG, { error: error_WRONG_STATE, given: W.run, when: "The world's run has ended: nothing can be invited into it." }, { error: error_INVALID_INPUT, given: W.run, when: "The seat is not one of the run's seats, or the role is not one of organiser, player or viewer." }],
  examples: [ok("Invite a tester who already has a key to the finance seat", `capxul world invite create r00042 --role player --seat bc-finance --key ${ADDR.tester1} --json`, { invitation: inv(), link: "capxul://join/r00042/Zq3-m8Vd1fT7" }),
    refused("The seat does not exist in this run", "capxul world invite create r00042 --role player --seat cfo --json", error_INVALID_INPUT, { field: "seat", name: "cfo" }), notOrg("capxul world invite create r00042 --role viewer --json")],
});
export const rpc_devnet_worlds_invite_create = inviteCreate.rpc;
export const operation_world_invite_create = inviteCreate.op;

const inviteList = make({
  id: "world.invite.list", command: "world invite list", title: "List a world's invitations", rpc: "devnet.worlds.invite-list", kind: "query", priority: "normal",
  about: "A world's invitations, newest first: the role, the seat, the key it is bound to, uses and expiry, and whether it was revoked. Never the code.", who: ORGANISER, changes: "Nothing: it only reads.",
  input: Schema.Struct({ world: S }), output: Schema.Struct({ invitations: Schema.Array(InvitationView) }), reads: [table_world_invitations],
  claims: [{ claim: "Invitations are listed with their uses and no code.", observes: `cli: after two invitations and one join, \`world invite list r00042 --json\` lists both, one with uses 1.` }],
  refusals: [OUT, NO_WORLD, NOT_ORG], examples: [ok("The run's invitations", "capxul world invite list r00042 --json", { invitations: [inv({ uses: 1, maxUses: 1 }), inv({ invitationId: "inv_0002", seat: "bc-director", boundAddress: ADDR.tester2 })] }), notOrg("capxul world invite list r00042 --json")],
});
export const rpc_devnet_worlds_invite_list = inviteList.rpc;
export const operation_world_invite_list = inviteList.op;

const inviteRevoke = make({
  id: "world.invite.revoke", command: "world invite revoke", title: "Revoke an invitation", rpc: "devnet.worlds.invite-revoke", kind: "mutation", priority: "normal",
  about: "Ends an invitation that has not been used. A key that already joined keeps its grant: `world grant revoke` ends that.", who: ORGANISER, changes: "The invitation is revoked.",
  input: Schema.Struct({ world: S, invitation: S }), output: Schema.Struct({ invitation: InvitationView }), reads: [table_world_invitations], writes: [table_world_invitations, table_command_records],
  claims: [{ claim: "A revoked invitation cannot be used.", observes: `cli: \`world invite revoke r00042 inv_0001\`; joining with its link exits INVALID_INPUT.` }],
  refusals: [OUT, NO_WORLD, NOT_ORG, { error: error_INVALID_INPUT, given: W.run, when: "No such invitation in this world." }],
  examples: [ok("Revoke an unused invitation", "capxul world invite revoke r00042 inv_0001 --json", { invitation: inv({ revoked: true }) }), refused("No such invitation", "capxul world invite revoke r00042 inv_9 --json", error_INVALID_INPUT, { field: "invitation", name: "inv_9" })],
});
export const rpc_devnet_worlds_invite_revoke = inviteRevoke.rpc;
export const operation_world_invite_revoke = inviteRevoke.op;

const join = make({
  id: "world.join", command: "world join", title: "Join a world with your key", rpc: "devnet.worlds.join", kind: "action", priority: "critical", cls: "write", p95Ms: 20_000,
  about: "The participant's one command: `world join <link> --consent run|train`. The CLI signs with the caller's key (`--new-key` makes a test key first for a person who has none: it is held in the CLI's home, holds test money only and is shown once as a recovery phrase). The service checks the invitation, writes the grant, creates the key's account in this world and its Safe at the address that follows from the key and the world, records the consent (the version and the hash of its text) and a `join` entry, grants the seat's hats in its company, and makes this world the current one. Nothing is carried over from any other world. An agent's join is built first. A person's join to play through the screens is specified and waits on Capxul Core's sign-in and signing pop-up (aaron.sign-in-is-core): a person's key and account in a world are the same as an agent's, and the signer stays the one place a transaction is approved.",
  who: "Anyone holding a key, with an unused invitation (or a grant an organiser made for that key).",
  changes: "A grant, a member row (account, Safe, consent, pseudonym), the seat's hats in its company, a `join` entry in the record; the CLI's current world.",
  input: Schema.Struct({ link: S, consent: Schema.Literals(["run", "train"]), newKey: B }),
  output: Schema.Struct({ worldId: S, address: S, role: GrantRole, seat: Null(S), accountId: S, safeAddress: S, sites: Schema.Array(Site), consent: Schema.Struct({ scope: Schema.Literals(["run", "train"]), version: S }), current: B }),
  reads: [table_world_invitations, table_worlds], writes: [table_world_grants, table_world_members, table_world_invitations, table_command_records],
  claims: [{ claim: "Joining creates an account and a Safe for the key in this world, and nothing from another world.", observes: `cli: the same key joins worlds r00042 and r00043; \`world join\` prints two different Safe addresses; the second world holds none of the first's balance, hats or sessions.` },
    { claim: "A join with no consent is refused, and the consent is recorded with its version.", observes: `cli: \`world join <link> --json\` without --consent exits INVALID_INPUT naming consent; with --consent run the member row holds the version and the hash.` },
    { claim: "A person with no key gets a test key held on their machine.", observes: `cli: \`world join <link> --consent run --new-key\` prints a recovery phrase once and joins; no key is in any record or export.` }],
  refusals: [OUT, { error: error_INVALID_INPUT, given: W.run, when: "The link is unknown, expired, revoked, used up or bound to another key; or no consent was given." }, { error: error_WRONG_STATE, given: W.run, when: "The run has ended." }],
  examples: [ok("Join the finance seat", "capxul world join capxul://join/r00042/Zq3-m8Vd1fT7 --consent train --json", { worldId: "r00042", address: addressOf("r00042"), role: "player", seat: "bc-finance", accountId: "acct_00042_tester1", safeAddress: ADDR.safe1, sites: [{ company: "bit-connect", url: siteOf("bit-connect", "r00042") }], consent: { scope: "train", version: "consent-1" }, current: true }),
    refused("No consent given", "capxul world join capxul://join/r00042/Zq3-m8Vd1fT7 --json", error_INVALID_INPUT, { field: "consent" }), refused("The link was bound to another key", "capxul world join capxul://join/r00042/Zq3-m8Vd1fT7 --consent run --json", error_INVALID_INPUT, { field: "link" })],
});
export const rpc_devnet_worlds_join = join.rpc;
export const operation_world_join = join.op;

const grantList = make({
  id: "world.grant.list", command: "world grant list", title: "List who may do what in a world", rpc: "devnet.worlds.grant-list", kind: "query", priority: "normal",
  about: "Every grant in a world: the key's address (never a key), role, seat, how it came and whether it is revoked. A player sees only their own.", who: "An organiser sees all; a player or viewer sees their own.", changes: "Nothing: it only reads.",
  input: Schema.Struct({ world: S }), output: Schema.Struct({ grants: Schema.Array(GrantView) }), reads: [table_world_grants],
  claims: [{ claim: "An organiser sees every grant and a player only their own.", observes: `cli: as the organiser \`world grant list r00042 --json\` lists every key; as a player it lists one.` }],
  refusals: [OUT, NO_WORLD], examples: [ok("The run's grants", "capxul world grant list r00042 --json", { grants: [grant({ keyAddress: ADDR.organiser, role: "organiser", seat: null, via: "direct" }), grant()] }), refused("No world", "capxul world grant list tow --json", error_INVALID_INPUT, { field: "world", name: "tow" })],
});
export const rpc_devnet_worlds_grant_list = grantList.rpc;
export const operation_world_grant_list = grantList.op;

const grantRevoke = make({
  id: "world.grant.revoke", command: "world grant revoke", title: "Revoke a key's grant in a world", rpc: "devnet.worlds.grant-revoke", kind: "mutation", priority: "critical",
  about: "Ends a key's grant at the gateway at once: its next call, and its next page on any company's site address, is refused. In a `full` world its site roles follow (roles follow hats). The seat becomes open (and the run's drop-out policy applies). The key's own record entries stay: the record is never edited. A grant outlives snapshots on purpose: a restore never re-admits it (devnet.shared-world).",
  who: ORGANISER, changes: "The grant is revoked; the seat is dropped.", input: Schema.Struct({ world: S, key: S }), output: Schema.Struct({ grant: GrantView }),
  reads: [table_world_grants], writes: [table_world_grants, table_command_records],
  claims: [{ claim: "A revoked key is refused at once, in the service and on the sites.", observes: `cli: \`world grant revoke r00042 <key>\`; that key's next \`record list\` exits ROLE_PERMISSION_DENIED and its next request to \`bit-connect-r00042.worlds.capxul.com\` is refused.` },
    { claim: "A restore does not re-admit a revoked key.", observes: `cli: after the revoke, \`world snapshot restore r00042 s1\` (saved before the revoke); the key is still refused.` }],
  refusals: [OUT, NO_WORLD, NOT_ORG, { error: error_INVALID_INPUT, given: W.run, when: "The key has no grant in this world." }],
  examples: [ok("Revoke a tester's grant", `capxul world grant revoke r00042 ${ADDR.tester1} --json`, { grant: grant({ revoked: true }) }), notOrg(`capxul world grant revoke r00042 ${ADDR.tester1} --json`)],
});
export const rpc_devnet_worlds_grant_revoke = grantRevoke.rpc;
export const operation_world_grant_revoke = grantRevoke.op;

const viewer = make({
  id: "world.viewer.link", command: "world viewer link", title: "Open a company's screens in a world", rpc: "devnet.worlds.viewer-link", kind: "action", priority: "normal", cls: "write",
  about: "Mints a one-time, read-only link to a company's Frappe site in a `full` world for the caller, who must hold a grant (viewer, player or organiser). The caller's CLI signs with their key; the service asks the site to mint the link (plugs.sessions.link); it expires in five minutes and works once. A viewer cannot save anything. NOT OPENED: the service refuses it (CAPABILITY_UNAVAILABLE) until Capxul Core's sign-in and signing pop-up exists (aaron.sign-in-is-core), because the spike's stand-in sign-in lets anyone become any test person. When it exists the link is the way in for a person with a key; nothing here may make that pop-up harder.",
  who: "A key with a grant in the world.", changes: "One short-lived link at the site; an entry in the record.",
  input: Schema.Struct({ world: S, company: S }), output: Schema.Struct({ url: S, expiresAt: N, readOnly: B }), reads: [table_world_grants, table_worlds], writes: [table_command_records],
  claims: [{ claim: "Once Core's sign-in exists, a viewer's link opens the company's screens read-only, once; until then it is refused CAPABILITY_UNAVAILABLE.", observes: `cli (waits on the Core sign-in design): as a viewer, \`world viewer link r00042 bit-connect\` prints a link; opening it shows the desk; saving a document is refused; opening it a second time is refused.` }],
  refusals: [OUT, NO_WORLD, { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "The key has no grant in the world." }, { error: error_WRONG_STATE, given: W.empty, when: "The world is a `core` world: it has no company sites." }, { error: error_CAPABILITY_UNAVAILABLE, given: W.full, when: "Capxul Core's sign-in does not exist yet (aaron.sign-in-is-core): no screen is opened to a person." }],
  examples: [ok("A one-time link to Bit Connect's screens", "capxul world viewer link r00042 bit-connect --json", { url: `${siteOf("bit-connect", "r00042")}/app?one_time=Hq8zT3`, expiresAt: ms("2026-12-01T09:05:00Z"), readOnly: true }),
    refused("Screens are not opened to people yet", "capxul world viewer link r00042 bit-connect --json", error_CAPABILITY_UNAVAILABLE, {}),
    refused("A core world has no sites", "capxul world viewer link r00041 bit-connect --json", error_WRONG_STATE, { profile: "core" })],
});
export const rpc_devnet_worlds_viewer_link = viewer.rpc;
export const operation_world_viewer_link = viewer.op;

void BASE;
