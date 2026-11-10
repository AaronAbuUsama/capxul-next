// A small slice used only to test the blueprint's build: an Organization invites a person by email.
// It is shaped like the old organizations/invitations area, but it is not the step-2 booking.

import { Schema } from "effect";
import {
  defineComponent,
  defineConcept,
  defineEnvironment,
  defineError,
  defineEvent,
  defineFlow,
  defineIntegration,
  defineInvariant,
  defineJourney,
  defineMachine,
  defineOperation,
  defineProcedure,
  defineRpc,
  defineSystem,
  defineTable,
  defineWorkflow,
} from "../../src/index.ts";

export const system = defineSystem({
  id: "capxul",
  title: "Capxul",
  about: "Company money and governance on chain.",
  actors: [
    { id: "owner", kind: "person", about: "An Owner of an Organization." },
    { id: "invitee", kind: "person", about: "A person invited by email." },
  ],
  surfaces: ["cli", "sdk", "react"],
});

export const postgres = defineComponent({ id: "postgres", title: "Database", about: "The one Postgres.", runtime: "postgres", exposes: ["sql"], dependsOn: [] });
export const backend = defineComponent({ id: "backend", title: "Backend", about: "Effect RPC server.", runtime: "node", exposes: ["rpc", "http"], dependsOn: [postgres] });

export const access = defineConcept({ id: "access", title: "Access", about: "Sessions and sign-in.", component: backend, dependsOn: [] });
export const organizations = defineConcept({ id: "organizations", title: "Organizations", about: "A workspace and its members.", component: backend, dependsOn: [access], lines: 4000 });

export const NOT_AUTHENTICATED = defineError({ id: "NOT_AUTHENTICATED", title: "Not signed in", class: "auth", actor: "caller", message: "Sign in first.", retryable: false, exit: 2 });
export const ROLE_PERMISSION_DENIED = defineError({ id: "ROLE_PERMISSION_DENIED", title: "Not allowed", class: "permission", actor: "person", message: "Ask an Owner.", retryable: false, exit: 3 });
export const WRONG_STATE = defineError({ id: "WRONG_STATE", title: "Wrong state", class: "state", actor: "caller", message: "The invitation is {state}.", retryable: false, exit: 5 });
export const PROVIDER_UNAVAILABLE = defineError({ id: "PROVIDER_UNAVAILABLE", title: "Provider down", class: "provider-unavailable", actor: "system", message: "Try again soon.", retryable: true, exit: 6 });

export const invitationSent = defineEvent({ id: "invitation_sent", about: "An invitation was created.", props: Schema.Struct({ role: Schema.String }) });
export const invitationAccepted = defineEvent({ id: "invitation_accepted", about: "An invitee joined.", props: Schema.Struct({}) });

export const invitations = defineTable({
  id: "invitations",
  title: "Invitations",
  about: "One row per invitation an Organization sends.",
  concept: organizations,
  tenancy: "organization",
  fields: Schema.Struct({ id: Schema.String, organizationId: Schema.String, email: Schema.String, role: Schema.String, state: Schema.String }),
  key: ["id"],
  indexes: [{ name: "by-org-state", fields: ["organizationId", "state"], for: "an Organization's open invitations" }],
});

export const lifecycle = defineMachine({
  id: "invitation",
  title: "Invitation lifecycle",
  about: "From sent to accepted, declined, cancelled or expired.",
  table: invitations,
  field: "state",
  initial: "pending",
  states: [
    { id: "pending", about: "Sent, not answered." },
    { id: "accepted", about: "The invitee joined.", terminal: true },
    { id: "expired", about: "Not answered in time.", terminal: true },
  ],
  transitions: {
    send: { from: ["pending"], to: "pending", emits: [invitationSent] },
    accept: { from: ["pending"], to: "accepted", emits: [invitationAccepted] },
    expire: { from: ["pending"], to: "expired", emits: [] },
  },
});

export const mail = defineIntegration({
  id: "mail",
  title: "Email",
  about: "Transactional email.",
  component: backend,
  system: "resend",
  service: "Mail",
  calls: {
    send: {
      about: "Send one email.",
      timeoutMs: 5000,
      retries: { max: 3, backoff: "exponential" },
      p95Ms: 800,
      failures: [{ when: "Resend answers 5xx or times out", error: PROVIDER_UNAVAILABLE }],
    },
  },
  fake: "The devnet mail sink stores each email for `dev mail list`.",
  secrets: ["RESEND_API_KEY"],
});

export const grants = defineTable({
  id: "grants",
  title: "Grants",
  about: "What a person may do in an Organization.",
  concept: access,
  tenancy: "organization",
  fields: Schema.Struct({ person: Schema.String, organizationId: Schema.String, role: Schema.String }),
  key: ["person", "organizationId"],
  indexes: [],
});

export const grantSeat = defineProcedure({
  id: "access.grant-seat",
  title: "Grant a seat",
  about: "Gives a person a role in an Organization, inside the caller's transaction.",
  concept: access,
  input: Schema.Struct({ person: Schema.String, organizationId: Schema.String, role: Schema.String }),
  output: Schema.Struct({}),
  errors: [],
  reads: [],
  writes: [grants],
  drives: [],
  invokes: [],
  emits: [],
});

export const inviteRpc = defineRpc({
  id: "organizations.invitations.invite",
  title: "Create an invitation",
  about: "Stores the invitation and emails the invitee.",
  concept: organizations,
  kind: "action",
  who: "An Owner.",
  input: Schema.Struct({ organization: Schema.String, email: Schema.String, role: Schema.String }),
  output: Schema.Struct({ invitation: Schema.String }),
  errors: [NOT_AUTHENTICATED, ROLE_PERMISSION_DENIED, PROVIDER_UNAVAILABLE],
  reads: [],
  writes: [invitations],
  drives: [lifecycle.t.send],
  invokes: [],
  emits: [],
  calls: [mail.c.send],
  chain: [],
  spans: ["authorize", "db.tx", "mail.send"],
  budget: { class: "write", p50Ms: 100, p95Ms: 350 },
});

export const acceptRpc = defineRpc({
  id: "organizations.invitations.accept",
  title: "Accept an invitation",
  about: "Moves the invitation to accepted and grants the seat in one transaction.",
  concept: organizations,
  kind: "mutation",
  who: "The invitee, signed in with the invited email.",
  input: Schema.Struct({ invitation: Schema.String }),
  output: Schema.Struct({ member: Schema.String }),
  errors: [NOT_AUTHENTICATED, WRONG_STATE],
  reads: [grants],
  writes: [invitations],
  drives: [lifecycle.t.accept],
  invokes: [grantSeat],
  emits: [],
  calls: [],
  chain: [],
  spans: ["authorize", "db.tx"],
  budget: { class: "write", p50Ms: 80, p95Ms: 250 },
});

export const listRpc = defineRpc({
  id: "organizations.invitations.list",
  title: "List invitations",
  about: "An Organization's open invitations.",
  concept: organizations,
  kind: "live",
  who: "A member.",
  input: Schema.Struct({ organization: Schema.String }),
  output: Schema.Array(Schema.String),
  errors: [NOT_AUTHENTICATED],
  reads: [invitations],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: { class: "live-read", p50Ms: 30, p95Ms: 120 },
});

export const sdk = defineComponent({ id: "sdk", title: "Core SDK", about: "The client: flows and the generated RPC client.", runtime: "node", exposes: ["none"], dependsOn: [backend] });

export const acceptFlow = defineFlow({
  id: "organizations.accept-invitation",
  title: "Accept an invitation and switch to it",
  about: "Accepts on the server, then makes the Organization the CLI's current one.",
  component: sdk,
  sdk: "client.invitations.accept",
  input: Schema.Struct({ invitation: Schema.String }),
  output: Schema.Struct({ member: Schema.String }),
  steps: [
    { name: "accept", rpc: acceptRpc },
    { name: "switch", local: "cache", about: "Stores the Organization as the current one." },
  ],
  errors: [],
  calls: [],
  spans: ["accept", "switch"],
  budget: { class: "write", p50Ms: 150, p95Ms: 400 },
});

export const invite = defineOperation({
  id: "org.member.invite",
  title: "Invite a member",
  about: "Invites a person by email to join the Organization in a role.",
  area: "governance",
  command: "org member invite",
  priority: "normal",
  implementedBy: inviteRpc,
  who: "An Owner.",
  acceptance: ["An Owner's invitation is pending and the invitee gets one email.", null, "A Seat that is not an Owner is refused."],
  returns: Schema.Struct({ invitation: Schema.String }),
  refusals: [{ error: ROLE_PERMISSION_DENIED, given: "org-with-member", when: "The caller is not an Owner." }],
  budget: { class: "write", p50Ms: 300, p95Ms: 900 },
});

export const accept = defineOperation({
  id: "invite.accept",
  title: "Accept an invitation",
  about: "The invitee joins the Organization.",
  area: "governance",
  command: "invite accept",
  priority: "normal",
  implementedBy: acceptFlow,
  who: "The invitee, signed in with the invited email.",
  acceptance: ["The invitee becomes a member in the invited role."],
  returns: Schema.Struct({ member: Schema.String }),
  refusals: [{ error: WRONG_STATE, given: "org-invitation-expired", when: "The invitation is no longer pending." }],
  budget: { class: "write", p50Ms: 300, p95Ms: 800 },
});

export const expire = defineWorkflow({
  id: "organizations.invitations.expire",
  title: "Expire old invitations",
  about: "Expires invitations not answered in 14 days.",
  concept: organizations,
  priority: "normal",
  trigger: { cron: "0 * * * *" },
  steps: [{ name: "find", about: "Pending invitations older than 14 days." }, { name: "expire", about: "Move each to expired." }],
  reads: [invitations],
  writes: [invitations],
  drives: [lifecycle.t.expire],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "the invitation id: an expired invitation is skipped",
  timeoutMs: 60000,
  retries: { max: 5, backoff: "exponential" },
  budget: { class: "background", p50Ms: 200, p95Ms: 2000 },
});

export const getInvited = defineJourney({
  id: "join_organization",
  title: "Join an Organization",
  about: "From an Owner's invitation to a member.",
  steps: [
    { operation: invite, as: "owner", proves: invitationSent },
    { operation: accept, as: "invitee", proves: invitationAccepted },
  ],
});

export const oneOpen = defineInvariant({
  id: "one-open-invitation",
  title: "One open invitation per email",
  about: "An Organization never holds two pending invitations for the same email.",
  statement: "For each Organization and email, at most one invitation is pending.",
  over: [invitations, lifecycle],
  check: "property",
});

export const devnet = defineEnvironment({
  id: "devnet",
  title: "Devnet",
  about: "A local stack for evals.",
  runs: [
    { component: backend, on: "a local process" },
    { component: postgres, on: "a local process" },
    { component: sdk, on: "the eval harness's CLI" },
  ],
  config: ["DATABASE_URL"],
  secrets: [],
  deploy: "`pnpm devnet up`",
  bootMs: 120000,
});

export const records = [
  system, postgres, backend, access, organizations,
  NOT_AUTHENTICATED, ROLE_PERMISSION_DENIED, WRONG_STATE, PROVIDER_UNAVAILABLE,
  invitationSent, invitationAccepted, invitations, lifecycle, mail, grants, grantSeat,
  inviteRpc, acceptRpc, listRpc, sdk, acceptFlow, invite, accept, expire, getInvited, oneOpen, devnet,
];
