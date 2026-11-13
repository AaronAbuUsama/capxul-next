import { runStorage } from "../storage/service.ts";
import { mediaSessions } from "./sessions.ts";

await runStorage("media", {
  table: "files",
  columns: [
    ["person_id", "text", true], ["file_id", "text", true], ["purpose", "text", true], ["state", "text", true],
    ["content_type", "text", true], ["size", "double precision", true], ["bytes", "bytea", false],
    ["created_at", "double precision", true], ["expires_at", "double precision", false],
  ],
  key: ["person_id", "file_id"],
  enums: {
    purpose: ["image", "id-image", "document"], state: ["kept", "held", "expired"],
    content_type: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  },
  indexes: [["files_by_id", ["file_id"], true]],
}, mediaSessions);
