import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { operation_org_books_assets_list } from "./operations.ts";

export const decision_books_empty_id_refusal = defineDecision({
  id: "books.empty-id-refusal",
  title: "The empty Organization ID guard is below CLI scope resolution",
  question: "Which CLI world reaches assets list's INVALID_INPUT for an empty Organization ID?",
  options: [
    { label: "stand", text: "Keep the SDK/rpc guard and record why the CLI refusal world cannot reach it." },
    { label: "bypass-scope", text: "Change CLI scope resolution to send an empty ID to the rpc." },
  ],
  chosen: "stand",
  why: "The operation already declares CLI_USAGE and documents that CLI scope resolution refuses an empty Organization ID before the rpc. A valid world cannot change this command boundary. Retain INVALID_INPUT for direct SDK/rpc callers; do not bypass scope resolution solely to manufacture a CLI refusal world.",
  source: "m1-gaps-refusal-worlds; books/operations.ts assets list; books/assets.ts rpc_books_assets_list",
  affects: [operation_org_books_assets_list],
  stands: [{
    record: "operation:org.books.assets.list", rule: "refusal-without-world",
    why: "INVALID_INPUT is the direct SDK/rpc guard for an empty orgId. The CLI rejects that scope with CLI_USAGE before calling books.assets.list in every world. Keep the lower-boundary refusal without claiming a CLI world or a passing SDK guard eval.",
  }],
});
