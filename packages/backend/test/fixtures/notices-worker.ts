import { Database } from "../../src/platform/db.ts";
import { deliverNotices } from "../../src/notices/door.ts";

if (process.env.CAPXUL_DISPOSABLE !== "true" || process.env.CAPXUL_WORLD === "main") throw new Error("disposable fixture required");
const url = new URL(process.env.NOTICE_TEST_MAIL_URL!);
if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("local protocol fixture only");
const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
try {
  await deliverNotices(db, { async send(message) {
    const response = await fetch(url, { method: "POST", body: JSON.stringify(message) });
    if (!response.ok) throw new Error("protocol fixture refused");
    return await response.json() as { id: string };
  } });
} finally { await db.close(); }
