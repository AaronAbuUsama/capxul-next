// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/flows.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_INVALID_INPUT, error_PROVIDER_ERROR, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { HeadView, rpc_organizations_heads_show } from "./heads.ts";
import { rpc_organizations_fde_ask, rpc_organizations_fde_turn, TurnView } from "./fde.ts";
import { rpc_organizations_docs_get, rpc_organizations_docs_remove } from "./docs.ts";
import { rpc_organizations_apps_list } from "./apps.ts";
import { rpc_organizations_setups_begin, rpc_organizations_setups_get, rpc_organizations_setups_resume, SetupView } from "./setups.ts";
import { rpc_organizations_workspaces_list } from "./workspaces.ts";
import { rpc_approvals_signing_get } from "../approvals/signing.ts";
import { MemberView, rpc_organizations_members_list, rpc_organizations_seats_raise, SeatsView } from "./members.ts";
import {
  InvitationView,
  Phase,
  rpc_organizations_invitations_list,
  rpc_organizations_invitations_list_mine,
} from "./invitations.ts";

export const flow_client_org_fde_ask = defineFlow({
  id: "client.org.fde.ask",
  title: "Ask the hosted FDE something, and print its reply when its turn ends",
  about:
    "`org fde ask` (organizations.fde-commands, aaron.fde-hosted, aaron.fde-anyone), for any member or a guest the " +
    "management named. It sends the message to the Organization's hosted FDE through Capxul (one call, which records " +
    "who asked and gives the FDE an act-for token for that turn: whatever the FDE does, it does as the asker), then " +
    "waits for the FDE's turn, reading it from the host every few seconds, until it ends with the FDE's reply, fails " +
    "with the host's reason, or the deadline passes (300 seconds by default, 1 to 3,600). A turn the host answers " +
    "failed ends PROVIDER_ERROR with the host's reason; the ask stays recorded. At the deadline it stops waiting " +
    "(CLI_DEADLINE) and prints the ask's id and the turn's, which `org fde turn get` reads later; the FDE carries on, " +
    "and the ask stays open for it until a read finds the turn ended (or FDE_ASK_HOURS pass). A turn read ended here " +
    "closes the ask at once, so on a devnet, whose stand-in host ends a turn as it is posted, an eval that runs the " +
    "FDE's commands under an ask holds the turn first (`capxul-devnet fault fde-host hold`). When the FDE " +
    "needs the asker's signature it hands the approval to the asker, who signs it on the approval page. The FDE's turn " +
    "is a wait, never system time.",
  component: component_core_sdk,
  sdk: "client.org(orgId).fde.ask",
  input: Schema.Struct({ orgId: S, message: S, ...AskDeadline }),
  output: TurnView,
  steps: [
    { name: "send", rpc: rpc_organizations_fde_ask, about: "Post the message to the FDE's conversation, with its act-for token, and record the ask." },
    { name: "await-turn", local: "wait", about: "Until the FDE's turn ends or fails, or the deadline." },
    { name: "turn", rpc: rpc_organizations_fde_turn, about: "Read the turn from the host, every few seconds while it works, and its reply once it ends." },
  ],
  errors: [error_PROVIDER_ERROR],
  calls: [],
  spans: [],
  budget: { ...budget("vendor"), excludes: ["wait.await-turn"] },
});
