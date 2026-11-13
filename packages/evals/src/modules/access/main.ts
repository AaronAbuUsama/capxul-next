import { runSchemaChecks, type SchemaSpec } from "./service.ts";

export const checks: Record<string, { table: string; spec: SchemaSpec }> = {
  "ACCESS.flags-shape": { table: "feature_flags", spec: {
    fields: { key: ["text", false], active: ["boolean", false], target: ["text", false], rules: ["jsonb", false], unsupported: ["text", true], checked_at: ["timestamp with time zone", false] },
    indexes: [{ columns: ["key"], unique: true, primary: true }],
  } },
  "ACCESS.principals-shape": { table: "principals", spec: {
    fields: { person_id: ["text", false], kind: ["text", false], email: ["text", true], safe_address: ["text", false], signer_address: ["text", true], created_at: ["timestamp with time zone", false] },
    indexes: [{ columns: ["person_id"], unique: true, primary: true }, { columns: ["email"], unique: true }, { columns: ["safe_address"], unique: true }],
  } },
};
await runSchemaChecks(checks);
