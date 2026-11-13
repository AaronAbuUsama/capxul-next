import { runStorage } from "../storage/service.ts";

await runStorage("documents", {
  table: "documents",
  columns: [
    ["owner_id", "text", true], ["owner_kind", "text", true], ["document_id", "text", true], ["document_hash", "text", true],
    ["content_hash", "text", true], ["kind", "text", true], ["format", "text", true], ["media_type", "text", true],
    ["bytes", "bytea", true], ["issued_at", "double precision", false], ["filename", "text", false],
    ["chain_id", "integer", true], ["subject_kind", "text", true], ["subject_id", "text", true],
    ["participants", "jsonb", true], ["participant_safes", "text[]", true], ["created_at", "double precision", true],
  ],
  key: ["owner_id", "owner_kind", "document_id"],
  enums: {
    owner_kind: ["person", "organization"], kind: ["memo", "invoice", "terms", "payslip", "receipt"], format: ["envelope", "artifact"],
    media_type: ["application/json", "application/pdf", "image/png", "image/jpeg"],
    subject_kind: ["payment", "movement", "request", "agreement", "salary-slip", "expense-claim", "employee-advance", "grant", "round", "commitment", "share-transfer"],
  },
  indexes: [
    ["documents_by_document", ["document_id"], true], ["documents_by_pair", ["document_hash", "content_hash"], true],
    ["documents_by_subject", ["subject_kind", "subject_id"], false],
  ],
});
