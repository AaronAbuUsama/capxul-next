// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/operations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineOperation, type ErrorRecord } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CANCELLED,
  error_CLI_DEADLINE,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_onboarding_begin_organization,
  flow_client_org_members_get,
  flow_client_org_setup_get,
  flow_client_org_setup_resume,
  flow_client_org_setup_subscribe,
  flow_client_orgs_invitations,
  flow_client_orgs_use,
} from "./flows.ts";
import { rpc_organizations_workspaces_list, rpc_organizations_workspaces_me } from "./workspaces.ts";
import { MemberView, rpc_organizations_members_list } from "./members.ts";
import { SetupView } from "./setups.ts";
import { rpc_organizations_apps_add, rpc_organizations_apps_list, rpc_organizations_apps_remove, WHO_DIRECTOR_OR_FDE, WHO_MEMBER } from "./apps.ts";
import { rpc_organizations_heads_show } from "./heads.ts";
import {
  rpc_organizations_fde_guests_add,
  rpc_organizations_fde_guests_list,
  rpc_organizations_fde_guests_remove,
  rpc_organizations_fde_show,
  rpc_organizations_fde_turn,
} from "./fde.ts";
import {
  rpc_organizations_doc_calls_list,
  rpc_organizations_docs_amend,
  rpc_organizations_docs_apply,
  rpc_organizations_docs_cancel,
  rpc_organizations_docs_change,
  rpc_organizations_docs_create,
  rpc_organizations_docs_get,
  rpc_organizations_docs_list,
  rpc_organizations_docs_submit,
  rpc_organizations_doctypes_get,
  rpc_organizations_doctypes_list,
  WHO_HEAD_USER,
} from "./docs.ts";
import { rpc_organizations_seats_show } from "./members.ts";
import { flow_client_org_head_docs_remove, flow_client_org_fde_ask,  } from "./flows.ts";
import { error_PROVIDER_ERROR } from "../shared/vocabulary.ts";
import {
  InvitationView,
  rpc_organizations_invitations_cancel,
  rpc_organizations_invitations_decline,
  rpc_organizations_invitations_list,
  rpc_organizations_invitations_resend,
} from "./invitations.ts";

export const operation_org_fde_show = defineOperation({
  id: "org.fde.show",
  title: "Show the Organization's hosted FDE and what its hosting costs",
  about:
    "Shows the Organization's Forward Deployed Engineer, which Capxul hosts: its handle and Safe, whether it is running, " +
    "due, paused or resuming on the host, the hats its Safe wears (it acts with each asker's, not these), the instant " +
    "its hosting is paid to and the day it falls due, the price of a month (FDE_HOSTING_PRICE), what has been paid, and " +
    "who last asked it something. Null for an Organization started without one.",
  area: AREA,
  command: "org fde show",
  priority: "normal",
  implementedBy: rpc_organizations_fde_show,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "An Organization started with its FDE shows it running on Capxul's host, with no hat, its start-up month paid and the price of a month.",
      "cli: from org-with-fde, `org fde show --json` prints handle acme-fde, `status: running`, `hats: []`, paidThrough one calendar month after the setup was ready, dueAt seven days before that, price 20 USDC and monthsPaid 0.",
    ),
    claim(
      "An Organization started without one shows none.",
      "cli: from org-ready (founded with `--no-fde`), `org fde show --json` prints null.",
    ),
    claim(
      "A settled hosting payment moves the paid-through instant on by whole calendar months, counted once.",
      "cli: from org-with-fde-allowance, after Dana's `org fde pay 2 --from capxul` settles, `org fde show --json` prints monthsPaid 2, lastPaidAt the settlement's time and paidThrough two calendar months after the start-up month's end; after a devnet reorg that takes the settling block away and mines the payment again (`capxul-devnet chain`), it prints the same monthsPaid and paidThrough.",
    ),
    claim(
      "A month left unpaid pauses the FDE on the host, and nothing on chain changes.",
      "cli: from org-with-fde-paused, `status: paused` with pausedAt equal to paidThrough; read: `org member list` still lists the FDE's Seat and `agent show @acme-fde --org acme` still prints it active.",
    ),
  ],
  returns: rpc_organizations_fde_show.output,
  errors: [error_CLI_USAGE],
  refusals: [signedOut, outsider()],
  budget: budget("read"),
});

export const operation_org_fde_ask = defineOperation({
  id: "org.fde.ask",
  title: "Ask the Organization's hosted FDE something",
  about:
    "Sends a message to the Organization's Forward Deployed Engineer on Capxul's host, and prints its reply when its " +
    "turn ends. Any member may ask, and so may a guest the Organization's management named. The FDE then works as the " +
    "asker: it does for them only what their own hats allow, and anything that needs a signature comes to the asker to " +
    "approve. At the deadline (`--timeout-seconds`, 300 by default) the command stops waiting and prints the turn's id " +
    "(`org fde turn get` reads it later), and the FDE carries on. A guest names the Organization with `--org`. A paused " +
    "FDE takes no message until its hosting is paid (`org fde pay`).",
  area: AREA,
  command: "org fde ask",
  priority: "normal",
  implementedBy: flow_client_org_fde_ask,
  who: WHO_ASKER,
  changes:
    "One ask recorded (who asked, when, and until when the FDE may act for them; never the message), and one turn of " +
    "the FDE on the host, whose every call is the asker's.",
  acceptance: [
    claim(
      "Any member's message reaches the hosted FDE, and the command prints its reply when the turn ends.",
      "cli: from org-with-fde-member, Sam's (a member with no hat) `org fde ask \"What do you need from me first?\" --org acme --json` prints `status: ended` and the stand-in FDE's reply; read: `org fde show` prints lastAskedBy Sam's member id.",
    ),
    claim(
      "The FDE does for the asker only what the asker's own hats allow.",
      "cli: from org-with-fde-member with the stand-in host holding turns (`capxul-devnet fault fde-host hold`), Sam's and then Dana's `org fde ask \"Add the helpdesk\" --timeout-seconds 1` each exit CLI_DEADLINE with their askId, their asks open; the FDE's `org head app add helpdesk` under Sam's ask (`capxul-devnet fde run acme --ask <Sam's askId> -- org head app add helpdesk --org acme`) exits ROLE_PERMISSION_DENIED; under Dana's it prints helpdesk wanted with addedBy Dana's member id; trace: each call's span names the FDE as actor and its asker.",
    ),
    claim(
      "What needs a signature, the FDE hands to the asker; it never signs for them.",
      "cli: from org-with-fde-allowance with turns held, under Dana's open ask the FDE's `payment send` of 5 USDC to olga@outside.test `--from capxul --json` answers the hand-over, an approval whose signer is Dana's own Safe (she holds `capxul`); chain: nothing moves until Dana approves it (`dev approve <it> --as dana@acme.test`), then one Payment settles from `capxul`, once.",
    ),
    claim(
      "A guest the management named may ask, and the FDE reads nothing of the Organization's for them.",
      "cli: from org-with-fde-guest, Olga's `org fde ask \"Where is my invoice?\" --org acme --json` prints the reply; with turns held, under the ask she then makes (`--timeout-seconds 1`, open), the FDE's `org member list --org acme` exits ROLE_PERMISSION_DENIED.",
    ),
    claim(
      "An ask stops acting for its asker once its turn has ended.",
      "cli: from org-with-fde-member with turns held, under Sam's open ask the FDE's `org head show --org acme` prints null (Acme has no head); after `capxul-devnet fault fde-host clear` and Sam's `org fde turn get` reads the turn ended, the same exits ROLE_PERMISSION_DENIED; world: no write.",
    ),
    claim(
      "The FDE's turn is a wait: at the deadline the command stops waiting, and the FDE carries on.",
      "cli: from org-with-fde with the stand-in host holding turns (`capxul-devnet fault fde-host hold`), `--timeout-seconds 1` exits CLI_DEADLINE and prints the turn id; trace: the turn's wait span is not counted in the budget.",
    ),
    claim(
      "A paused FDE takes no message.",
      "cli: from org-with-fde-paused, the command exits WRONG_STATE naming the instant its hosting lapsed and `org fde pay`; world: no ask recorded.",
    ),
  ],
  returns: flow_client_org_fde_ask.output,
  errors: [error_CLI_USAGE, error_CLI_DEADLINE],
  refusals: [
    signedOut,
    notAsker(W_FDE_MEMBER),
    { error: error_INVALID_INPUT, given: W_FDE, when: "The message is empty or longer than 8,000 characters: nothing is sent." },
    {
      error: error_WRONG_STATE,
      given: W_FDE_PAUSED,
      when: "The FDE is paused because its hosting lapsed unpaid (or Acme has none, as in org-ready): nothing is sent, and the refusal names `org fde pay`.",
    },
    { error: error_PROVIDER_ERROR, given: W_FDE_HOST_DOWN, when: "The FDE host does not answer: nothing is recorded, and asking again later sends the message." },
  ],
  budget: budget("vendor"),
});

export const operation_org_fde_turn_get = defineOperation({
  id: "org.fde.turn.get",
  title: "Read one of your turns with the hosted FDE, and its reply",
  about:
    "Reads a turn the hosted FDE took for a message you sent: still working, ended with its reply, or failed with the " +
    "host's reason. Use it after `org fde ask` stopped waiting at its deadline. Only the asker reads a turn: the reply " +
    "may hold what only they may see.",
  area: AREA,
  command: "org fde turn get",
  priority: "normal",
  implementedBy: rpc_organizations_fde_turn,
  who: "The turn's own asker: the member or the guest who sent its message.",
  changes: "Nothing but a stamp: once read ended or failed, the ask acts for its asker no longer.",
  acceptance: [
    claim(
      "A turn the ask stopped waiting for is read later: working, then ended with the reply.",
      "cli: from org-with-fde with the stand-in host holding turns, after `org fde ask \"Hi\" --timeout-seconds 1` exits CLI_DEADLINE with a turn id, `org fde turn get <it> --json` prints `status: working`; after `capxul-devnet fault fde-host clear`, it prints `status: ended` and the stand-in's reply.",
    ),
    claim(
      "Only its asker reads a turn.",
      "cli: from org-with-fde-member, after Dana's ask, Sam's `org fde turn get <Dana's turn> --org acme` exits INVALID_INPUT and prints nothing of it.",
    ),
  ],
  returns: rpc_organizations_fde_turn.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notAsker(W_FDE_MEMBER),
    { error: error_INVALID_INPUT, given: W_FDE_MEMBER, when: "The turn is not one the caller asked here (another member's, or a made-up id): nothing is read." },
  ],
  budget: budget("vendor"),
});

export const operation_org_fde_guest_add = defineOperation({
  id: "org.fde.guest.add",
  title: "Let an outside person the Organization works with talk to its FDE",
  about:
    "Names someone outside the Organization whom it works with (a customer, a supplier, an accountant, someone it may " +
    "hire) as a guest who may talk to its hosted FDE, by email or a person's @handle, with an optional note of who they " +
    "are. A guest holds no Seat and no hat, so the FDE does for them only what they may do themselves: see their own " +
    "dealings with the Organization, never its members' records. Someone not yet on Capxul is admitted so they can " +
    "sign in, and is told how to ask. Naming someone twice changes nothing.",
  area: AREA,
  command: "org fde guest add",
  priority: "normal",
  implementedBy: rpc_organizations_fde_guests_add,
  who: WHO_MANAGEMENT,
  changes: "One guest row, active, with who named them; a mailbox new to Capxul is named a provisional Party and admitted to the beta.",
  acceptance: [
    claim(
      "A Director names an outside person a guest; naming them twice is one guest.",
      "cli: from org-with-fde-member, Dana's `org fde guest add olga@outside.test --note \"Our accountant\" --org acme --json` prints Olga `status: active`, namedBy Dana's member id and the note; the same command again prints the same; read: `org fde guest list` lists Olga once.",
    ),
    claim(
      "Someone not yet on Capxul is named by email, and can then sign in and ask.",
      "cli: from org-with-fde-member, `org fde guest add newcomer@outside.test --org acme` prints an active guest; then newcomer@outside.test signs in (`auth login`, `auth verify`) and `org fde ask \"Hello\" --org acme` prints the FDE's reply.",
    ),
  ],
  returns: rpc_organizations_fde_guests_add.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notManagement("names a guest"),
    {
      error: error_INVALID_INPUT,
      given: W_FDE_MEMBER,
      when: "The person is a member here (sam@acme.test), an agent's or an Organization's @handle, a malformed email, or the note is longer than 200 characters: the refusal names it and nothing is written.",
    },
  ],
  budget: budget("write"),
});

export const operation_org_fde_guest_remove = defineOperation({
  id: "org.fde.guest.remove",
  title: "Stop an outside person talking to the Organization's FDE",
  about:
    "Removes a guest: from then on they may not ask the FDE, and the FDE no longer acts for them on anything they asked " +
    "before. Their past asks stay recorded. Naming them again lets them ask again.",
  area: AREA,
  command: "org fde guest remove",
  priority: "normal",
  implementedBy: rpc_organizations_fde_guests_remove,
  who: WHO_MANAGEMENT,
  changes: "The guest row moves to removed, with who removed them.",
  acceptance: [
    claim(
      "A removed guest can no longer ask, and naming them again lets them ask again.",
      "cli: from org-with-fde-guest, Dana's `org fde guest remove olga@outside.test --org acme --json` prints `status: removed`; Olga's `org fde ask \"Hi\" --org acme` then exits ROLE_PERMISSION_DENIED; after `org fde guest add olga@outside.test`, her ask prints the reply.",
    ),
    claim(
      "An ask a guest made before removal acts for them no more.",
      "cli: from org-with-fde-guest with turns held, Olga asks (`--timeout-seconds 1`: CLI_DEADLINE, her ask open); under that ask the FDE's `payment list --json` prints Olga's own payments (a guest's own records, which her ask allows); after Dana removes her, the same exits ROLE_PERMISSION_DENIED. (`org fde show` would be refused before the removal too: a guest has no Seat.)",
    ),
  ],
  returns: rpc_organizations_fde_guests_remove.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notManagement("removes a guest"),
    { error: error_INVALID_INPUT, given: W_FDE_MEMBER, when: "The email, @handle or id names no guest of Acme: nothing is written." },
  ],
  budget: budget("write"),
});

export const operation_org_fde_guest_list = defineOperation({
  id: "org.fde.guest.list",
  title: "List the outside people who may talk to the Organization's FDE",
  about:
    "Lists the Organization's guests, the active ones first (newest named first), then the removed ones, or only one " +
    "kind with `--status active|removed`: each with who they are, the note, who named them and when, and when they were " +
    "removed. Paged with `--limit` and `--after`.",
  area: AREA,
  command: "org fde guest list",
  priority: "normal",
  implementedBy: rpc_organizations_fde_guests_list,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "Any member lists the guests, each with the note and who named them.",
      "cli: from org-with-fde-guest, Sam's `org fde guest list --org acme --json` lists Olga `status: active` with the note and namedBy Dana's member id, and `nextCursor: null`.",
    ),
    claim(
      "Removed guests follow the active ones, each with when it was removed, and `--status` keeps one kind.",
      "cli: from org-with-fde-guest, after Dana's `org fde guest add newcomer@outside.test --org acme` and `org fde guest remove olga@outside.test --org acme`, `org fde guest list --org acme --json` lists newcomer@outside.test `status: active` first, then Olga `status: removed` with her `removedAt`; `--status removed` lists only Olga and `--status active` only newcomer@outside.test.",
    ),
    claim(
      "The list pages as every list does, and reading it writes nothing.",
      "cli: from the same, `org fde guest list --org acme --limit 1 --json` prints newcomer@outside.test and a `nextCursor`; `--after <it>` prints Olga and `nextCursor: null`; world: no diff from either read.",
    ),
  ],
  returns: rpc_organizations_fde_guests_list.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W_FDE_GUEST,
      when: "Olga, a guest and no member, lists Acme's guests: a guest only asks; nothing is read.",
    },
    { error: error_INVALID_INPUT, given: W_FDE_GUEST, when: "`--limit` is outside 1 to 100, or `--after` is a cursor this list did not issue: nothing is read." },
  ],
  budget: budget("read"),
});

/** The FDE commands aaron.fde-anyone adds: reading a turn later, and the guests the management names (organizations.fde-guests). */
export const FDE_ANYONE_OPERATIONS = [
  operation_org_fde_turn_get, operation_org_fde_guest_add, operation_org_fde_guest_remove, operation_org_fde_guest_list,
];
