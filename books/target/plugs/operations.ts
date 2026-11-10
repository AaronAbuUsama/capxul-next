// The plugs' operations: seven new capabilities booked under rules.new-operations, each serving aaron.one-door and aaron.frappe-native
// (the decisions in ./decisions.ts name them). The sign-in has no command: a person signs in through the browser. Each operation is
// implemented by one rpc, so its refusals are the rpc's errors. Refusals are reached from the worlds listed in plugs.worlds.

import { budget } from "../../../packages/book/src/index.ts";
import {
  error_CLI_USAGE, error_DOCUMENT_HASH_MISMATCH, error_AUTHORISED_EXCEEDED, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE, error_PROVIDER_ERROR,
} from "../shared/vocabulary.ts";
import { rpc_plugs_payments_awaiting, rpc_plugs_payments_prepare } from "./signer.ts";
import { rpc_plugs_roles_drift } from "./roles.ts";
import { flow_client_org_roles_show } from "./flows.ts";
import { rpc_plugs_sessions_link } from "./sessions.ts";
import { rpc_plugs_events_resend, rpc_plugs_events_retry, rpc_plugs_events_status } from "./events.ts";
import { WORLD, operation } from "./kit.ts";
import * as ex from "./examples.ts";

const out = { error: error_NOT_AUTHENTICATED, given: WORLD.signedOut, when: "No one is signed in on this machine." } as const;
const notAdmin = (what: string) => ({ error: error_ROLE_PERMISSION_DENIED, given: WORLD.member, when: `A member who does not wear the Director hat tries to ${what}; nothing changes.` }) as const;

export const operation_payment_prepare_document = operation({
  id: "payment.prepare-document",
  title: "Prepare the payment for a Frappe document",
  about:
    "The same preparation a Frappe user's Submit asks for, from the CLI or an agent: give the document (`--doctype`, `--name`), its hash, the payee and the amount, and the payment is held " +
    "until the chain confirms it. It checks that the signer's hat may pay from the budget, opens the approval that carries the signature and prints whose signature is awaited. The " +
    "Payment Entry stays a draft in Frappe. The hash is CANON v1 over the document's fields (plugs.document-canon); editing the draft afterwards changes it, and the later payment is then a mismatch.",
  area: "payments",
  command: "payment prepare-document",
  priority: "critical",
  implementedBy: rpc_plugs_payments_prepare,
  who: "A person or an agent whose Frappe user a hat created, in an Organization that has a site; the signer must wear a hat that may pay from the budget.",
  changes: "One payment request, waiting, and the approval that carries the signature; the payment command with the hash, cost centre and account code. No money moves until the signature is made and the chain confirms.",
  acceptance: [
    {
      claim: "A held payment waits for the signer's signature and names whose it is.",
      observes: `cli: in \`${WORLD.hatsOnSite}\`, Hannah (budget holder) runs \`payment prepare-document --doctype "Payment Entry" --name ACC-PAY-2026-00001 --hash <h> --to <supplier> --amount 125.50 --json\`; it prints \`status: waiting\`, an approvalId and \`awaiting\` Hannah's address; world: one payment request and one approval, no transfer.`,
    },
    {
      claim: "A second prepare for the same draft and hash answers the same request.",
      observes: "cli: the same command again prints the same requestId; world: still one request and one approval.",
    },
    {
      claim: "A person with no hat that may pay is refused with the reason, and a draft whose hash changed is a mismatch.",
      observes: `cli: Sam (member) running it exits ROLE_PERMISSION_DENIED naming the hat; a prepare for a draft already prepared under another hash exits DOCUMENT_HASH_MISMATCH; world: no new request either time.`,
    },
  ],
  examples: ex.paymentPrepareDocument,
  returns: rpc_plugs_payments_prepare.output,
  errors: [error_CLI_USAGE],
  refusals: [
    out,
    { error: error_ROLE_PERMISSION_DENIED, given: WORLD.member, when: "The signer wears no hat that may pay from the budget, or the Frappe user is not one a hat created (Administrator included)." },
    { error: error_AUTHORISED_EXCEEDED, given: WORLD.hatsOnSite, when: "The amount is more than the budget has left this period; the chain would refuse it, so Core refuses first." },
    { error: error_DOCUMENT_HASH_MISMATCH, given: WORLD.held, when: "A request for this draft is already waiting under another hash: the draft changed after it was prepared." },
    { error: error_INVALID_INPUT, given: WORLD.hatsOnSite, when: "The hash is the zero hash, or the amount or the payee is malformed." },
  ],
  budget: budget("chain-read"),
});

export const operation_payment_awaiting = operation({
  id: "payment.awaiting",
  title: "List the payments waiting for my signature",
  about:
    "What the caller (or `--for <address>`, for a member) has been asked to sign: each held payment with its document, payee, amount, who asked and the approval to sign. An agent that signs with its " +
    "own key polls this to know what to sign; a person sees it in the CLI as the Frappe screen shows it. Nothing is signed by listing.",
  area: "payments",
  command: "payment awaiting",
  priority: "critical",
  implementedBy: rpc_plugs_payments_awaiting,
  who: "A signed-in person or agent, for their own address; a member of the Organization for another signer's.",
  changes: "Nothing: it only reads.",
  acceptance: [
    {
      claim: "It lists exactly the waiting payments whose signature is the caller's, oldest first.",
      observes: `cli: in \`${WORLD.heldOther}\`, Hannah's \`payment awaiting --json\` lists the payment awaiting her and not the one awaiting Dana; Dana's lists hers; world: no diff.`,
    },
    {
      claim: "A payment that landed, failed or was abandoned leaves the list.",
      observes: "cli: after the signature is made and the chain confirms, the same command no longer lists it; a request failed or abandoned is not listed either.",
    },
  ],
  examples: ex.paymentAwaiting,
  returns: rpc_plugs_payments_awaiting.output,
  errors: [error_CLI_USAGE],
  refusals: [out, { error: error_ROLE_PERMISSION_DENIED, given: WORLD.member, when: "A member asks for another signer's list with `--for` without wearing the Director hat." }],
  budget: budget("read"),
});

export const operation_org_roles_show = operation({
  id: "org.roles.show",
  title: "Show the Frappe roles a person's hats give",
  about:
    "A person's hats, the roles each added on the site, whether each grant is applied, and the roles that result. With `--map` it prints the hat-to-role map the site's Capxul app shipped with, by job. The " +
    "map and the roles follow the chain; neither can be changed here.",
  area: "organizations",
  command: "org roles show",
  priority: "normal",
  implementedBy: flow_client_org_roles_show,
  who: "A member for themselves; the wearer of the Director hat for another member.",
  changes: "Nothing: it only reads.",
  acceptance: [
    {
      claim: "A person's roles are the union of what their hats give, with each role's hats named.",
      observes: `cli: in \`${WORLD.hatsOnSite}\`, Hannah wearing two hats that both give Accounts User prints it once with both hats; revoking one hat leaves it; revoking the second removes it; world: no diff by the command.`,
    },
    {
      claim: "The map names the job that needs each role.",
      observes: "cli: `org roles show --map --json` lists every hat, job and role under one map version.",
    },
  ],
  examples: ex.orgRolesShow,
  returns: flow_client_org_roles_show.output,
  errors: [error_CLI_USAGE],
  refusals: [out, notAdmin("read another member's roles")],
  budget: budget("read"),
});

export const operation_org_roles_drift = operation({
  id: "org.roles.drift",
  title: "Find where a site's roles differ from the chain's hats",
  about:
    "Reads the site and the chain and lists every difference: a role no hat gives, a role a hat should have given, a site user with no hat, a hat with no site user. It changes nothing; the nightly process " +
    "repairs what the chain explains. A site that does not answer is PROVIDER_ERROR.",
  area: "organizations",
  command: "org roles drift",
  priority: "normal",
  implementedBy: rpc_plugs_roles_drift,
  who: "The wearer of the Organization's Director hat.",
  changes: "Nothing: it only reads.",
  acceptance: [
    {
      claim: "It finds a role added behind the chain's back and a user no hat created.",
      observes: `cli: in \`${WORLD.hatsOnSite}\`, after the harness adds a role to Hannah's user with raw SQL, \`org roles drift --json\` lists one extra-role difference for her; with no difference it lists none.`,
    },
  ],
  examples: ex.orgRolesDrift,
  returns: rpc_plugs_roles_drift.output,
  errors: [error_CLI_USAGE],
  refusals: [out, notAdmin("check drift"), { error: error_PROVIDER_ERROR, given: WORLD.siteDown, when: "The site's bench is stopped." }],
  budget: budget("vendor"),
});

export const operation_org_events_status = operation({
  id: "org.events.status",
  title: "Show where an Organization's site has got to in its event stream",
  about:
    "The cursor, the counts by state and the events set aside or posted as unmatched lines with their last error. It is how an operator sees that the books are caught up, and why one event is not. " +
    "Replaces the old `org books facts list`.",
  area: "books",
  command: "org events status",
  priority: "normal",
  implementedBy: rpc_plugs_events_status,
  who: "Any member of the Organization.",
  changes: "Nothing: it only reads.",
  acceptance: [
    {
      claim: "The stream is gap-free and the site's cursor is the last event it applied.",
      observes: `cli: in \`${WORLD.events}\`, \`org events status --json\` prints nextSeq one past lastAppliedSeq, state flowing, and every number from 1 with no gap.`,
    },
    {
      claim: "An event the site cannot apply is listed with its error, and the stream is not blocked.",
      observes: `cli: in \`${WORLD.poison}\`, the status lists the event set aside with its last error and state flowing; a money event in the same state is listed unmatched.`,
    },
  ],
  examples: ex.orgEventsStatus,
  returns: rpc_plugs_events_status.output,
  errors: [error_CLI_USAGE],
  refusals: [out],
  budget: budget("read"),
});

export const operation_org_events_resend = operation({
  id: "org.events.resend",
  title: "Deliver an Organization's events to its site again from a number",
  about:
    "Moves the delivery cursor back and lets the delivery process offer every event again from there, in order. The site answers 'already applied' to what it has. It is how a new site for an old " +
    "Organization, or a site restored from a backup, catches up. It does not re-send an event the site set aside.",
  area: "books",
  command: "org events resend",
  priority: "normal",
  implementedBy: rpc_plugs_events_resend,
  who: "The wearer of the Organization's Director hat.",
  changes: "The delivery cursor, back to the number given.",
  acceptance: [
    {
      claim: "A restored site is brought back to date from the outbox.",
      observes: `cli: in \`${WORLD.events}\`, after the site is restored to an older backup, \`org events resend --from 1 --json\` prints from 1; the site then holds every event once and the status shows no gap; no payment is posted twice.`,
    },
  ],
  examples: ex.orgEventsResend,
  returns: rpc_plugs_events_resend.output,
  errors: [error_CLI_USAGE],
  refusals: [out, notAdmin("resend events"), { error: error_INVALID_INPUT, given: WORLD.events, when: "`--from` is beyond the next number." }],
});

export const operation_org_events_retry = operation({
  id: "org.events.retry",
  title: "Try an event the site set aside again",
  about:
    "Releases a set-aside event so the delivery process tries it again in its place in the stream, after the operator fixed what made it fail. An event in any other state is WRONG_STATE.",
  area: "books",
  command: "org events retry",
  priority: "normal",
  implementedBy: rpc_plugs_events_retry,
  who: "The wearer of the Organization's Director hat.",
  changes: "One event, from set aside back to pending.",
  acceptance: [
    {
      claim: "A set-aside event is applied after the cause is fixed, and applying it is not repeated.",
      observes: `cli: in \`${WORLD.poison}\`, after the harness creates the missing Frappe user, \`org events retry <seq> --json\` prints pending; the event then applies once and the status lists it applied.`,
    },
    {
      claim: "An event that is not set aside is refused.",
      observes: "cli: retrying an applied event exits WRONG_STATE; world: no diff.",
    },
  ],
  examples: ex.orgEventsRetry,
  returns: rpc_plugs_events_retry.output,
  errors: [error_CLI_USAGE],
  refusals: [out, notAdmin("release an event"), { error: error_WRONG_STATE, given: WORLD.events, when: "The event is not set aside." }],
});


export const operation_org_site_link = operation({
  id: "org.site.link",
  title: "Get a one-time, read-only link to watch a company's site",
  about:
    "For a person who only watches (a viewer grant): the service asks the site to mint a one-time sign-in link that expires in minutes and opens the site read-only. The site never calls the service. A member of the Organization with a site user opens it as themselves and does not need this.",
  area: "organizations",
  command: "org site link",
  priority: "normal",
  implementedBy: rpc_plugs_sessions_link,
  who: "A signed-in person with a viewer grant for the Organization's world, or a member of the Organization.",
  changes: "One audit row of the link's minting; the site holds the link.",
  acceptance: [
    {
      claim: "A watcher gets a link that opens the site read-only once.",
      observes: `cli: in \`${WORLD.siteReady}\`, a person with only a viewer grant runs \`org site link --json\`; the url opens the company's Frappe screens with no way to save; the same url a second time, or after it expires, is refused by the site.`,
    },
  ],
  examples: ex.orgSiteLink,
  returns: rpc_plugs_sessions_link.output,
  errors: [error_CLI_USAGE],
  refusals: [out, { error: error_ROLE_PERMISSION_DENIED, given: WORLD.member, when: "The person has neither a viewer grant nor a site user." }, { error: error_PROVIDER_ERROR, given: WORLD.siteDown, when: "The site's bench is stopped." }],
  budget: budget("vendor"),
});
