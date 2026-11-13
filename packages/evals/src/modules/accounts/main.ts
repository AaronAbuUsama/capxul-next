import { runSchemaChecks, type SchemaSpec } from "../access/service.ts";

export const checks: Record<string, { table: string; spec: SchemaSpec }> = {
  "ACCOUNTS.admissions-shape": { table: "admissions", spec: {
    fields: { email: ["text", false], person_id: ["text", true], status: ["text", false], note: ["text", true], joined_via: ["text", false],
      requested_at: ["double precision", true], admitted_at: ["double precision", true], admitted_by: ["text", true], updated_at: ["double precision", false] },
    indexes: [{ columns: ["email"], unique: true, primary: true }],
  } },
  "ACCOUNTS.safes-shape": { table: "personal_safes", spec: {
    fields: { person_id: ["text", false], email: ["text", false], safe_address: ["text", false], signer_address: ["text", false], status: ["text", false], attempt: ["integer", false],
      claim_tx_hash: ["text", true], claimed_at: ["double precision", true], claimed_block: ["double precision", true], collect_approval_id: ["text", true], collected: ["integer", false],
      failure_code: ["text", true], created_at: ["double precision", false], updated_at: ["double precision", false] },
    indexes: [{ columns: ["person_id"], unique: true, primary: true }, { columns: ["safe_address"], unique: true }],
  } },
  "ACCOUNTS.referrals-shape": { table: "referrals", spec: {
    fields: { referrer_email: ["text", false], referee_email: ["text", false], via: ["text", false], stage: ["text", false], attributed_at: ["double precision", false],
      admitted_at: ["double precision", true], qualified_at: ["double precision", true], rewarded_at: ["double precision", true], reward_kind: ["text", true], voided_at: ["double precision", true], void_reason: ["text", true] },
    indexes: [{ columns: ["referrer_email", "referee_email"], unique: true, primary: true }, { columns: ["referee_email"], unique: true }, { columns: ["referrer_email", "attributed_at"], unique: false }],
  } },
};
await runSchemaChecks(checks);
