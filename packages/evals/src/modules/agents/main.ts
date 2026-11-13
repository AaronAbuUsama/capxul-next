import { runStorage } from "../storage/service.ts";

await runStorage("agents", {
  table: "agents",
  columns: [
    ["owner_id", "text", true], ["owner_kind", "text", true], ["agent_id", "text", true], ["party_id", "text", true],
    ["safe_address", "text", true], ["signer_address", "text", true], ["key_store", "text", true], ["state", "text", true],
    ["created_by", "text", true], ["created_at", "timestamp with time zone", true], ["activated_at", "timestamp with time zone", false],
    ["ended_at", "timestamp with time zone", false], ["updated_at", "timestamp with time zone", true],
  ],
  key: ["owner_id", "agent_id"],
  enums: { owner_kind: ["person", "organization"], key_store: ["file", "env", "host"], state: ["creating", "active", "frozen", "removed", "failed"] },
  indexes: [
    ["agents_by_id", ["agent_id"], true], ["agents_by_owner_created", ["owner_id", "owner_kind", "created_at", "agent_id"], false],
    ["agents_by_party", ["party_id"], true], ["agents_by_safe", ["safe_address"], true], ["agents_by_signer", ["signer_address"], false],
  ],
});
