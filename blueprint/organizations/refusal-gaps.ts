import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { operation_invite_list, operation_org_invite_list } from "./operations.ts";

export const decision_organizations_defensive_list_refusals = defineDecision({
  id: "organizations.defensive-list-refusals",
  title: "Invitation list corruption guards stand without a normal world",
  question: "What reaches the WRONG_STATE guards on the two invitation lists?",
  options: [
    { label: "stand", text: "Retain each defensive refusal with its own standing reason; do not claim a valid invitation lifecycle corrupts its references." },
    { label: "corrupt-world", text: "Introduce a devnet fault that corrupts invitation references and build a world for each list." },
  ],
  chosen: "stand",
  why: "The list rpcs retain WRONG_STATE when an offer's view cannot be built. Accepting, declining, cancelling or expiring an offer changes its phase, not its Organization or grantee identity. The current world catalog has no invitation-reference corruption fault. Adding an invented fault name would not prove this defensive behavior. These are visible coverage boundaries, not passing refusal evals.",
  source: "m1-gaps-refusal-worlds; organizations/invitations.ts list and list-mine; organizations/data.ts; devnet/worlds.ts",
  affects: [operation_invite_list, operation_org_invite_list],
  stands: [
    {
      record: "operation:invite.list", rule: "refusal-without-world",
      why: "WRONG_STATE protects list-mine against an offer whose Organization or recipient no longer matches its stored reference. Normal invitation transitions preserve those identities; no catalog world corrupts them. Retain the defensive refusal without claiming a reachable valid-state fixture or a passing eval.",
    },
    {
      record: "operation:org.invite.list", rule: "refusal-without-world",
      why: "WRONG_STATE protects the People-hat list when an offer's grantee Party cannot resolve and its view cannot be built. Phase changes and Seat removal do not themselves remove that Party. The catalog has no dangling-grantee fault; retain this corruption guard as an explicit coverage boundary, not an implemented corruption world.",
    },
  ],
});
