import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { siteRequestAnswer } from "../src/approvals/site-answer.ts";

const url = process.env.APPROVALS_TEST_DATABASE;
if (!url || process.env.CAPXUL_DISPOSABLE !== "true" || new URL(url).pathname !== "/approvals_requests_test" ||
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("APPROVALS_TEST_DATABASE must name the dedicated loopback approvals_requests_test database");

test("site answers become held only after commit, bind the signer and preserve refusal", async () => {
  const writer = new pg.Client({ connectionString: url }), reader = new pg.Client({ connectionString: url });
  await writer.connect(); await reader.connect();
  try {
    await writer.query(readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8"));
    await writer.query("insert into app.organizations (org_id,name,safe,site,admin_email,token) values ('answer-org','Answer test','answer-safe','answer.test','signer@test','token')");
    const awaiting = `0x${"31".repeat(20)}`;
    await writer.query("insert into app.people (org_id,address,email,name) values ('answer-org',$1,'signer@test','Signer')", [awaiting]);
    const input = { org: "answer-org", request_id: "site-request", requested_by: "signer@test" };
    await writer.query("BEGIN");
    await writer.query("insert into app.site_request_answers (org_id,request_id,request,answer) values ($1,$2,$3,$4)",
      [input.org, input.request_id, { requested_by: input.requested_by }, { approval_id: "apr_committed", approval_url: "https://core.test/approve/apr_committed", requested_by: input.requested_by }]);
    assert.deepEqual(await siteRequestAnswer(reader, input), { status: "collecting" });
    await writer.query("COMMIT");
    assert.deepEqual(await siteRequestAnswer(reader, input), { status: "answered", approval_id: "apr_committed", approval_url: "https://core.test/approve/apr_committed", requested_by: input.requested_by, awaiting });
    await assert.rejects(siteRequestAnswer(reader, { ...input, requested_by: "other@test" }), /INVALID_INPUT/);
    assert.deepEqual(await siteRequestAnswer(reader, { ...input, org: "different-org" }), { status: "collecting" });
    await writer.query("insert into app.site_request_answers (org_id,request_id,request,answer) values ($1,'refused',$2,$3)",
      [input.org, { requested_by: input.requested_by }, { error: { code: "INVALID_INPUT", message: "unsupported asset" } }]);
    assert.deepEqual(await siteRequestAnswer(reader, { ...input, request_id: "refused" }), { status: "refused", error: { code: "INVALID_INPUT", message: "unsupported asset" } });
    await writer.query("BEGIN");
    await writer.query("insert into app.site_request_answers (org_id,request_id,request,answer) values ($1,'rolled-back',$2,$3)",
      [input.org, { requested_by: input.requested_by }, { approval_id: "not-real" }]);
    await writer.query("ROLLBACK");
    assert.deepEqual(await siteRequestAnswer(reader, { ...input, request_id: "rolled-back" }), { status: "collecting" });
    await writer.query("delete from app.people where org_id=$1", [input.org]);
    await assert.rejects(siteRequestAnswer(reader, input), /signer is no longer/);
  } finally {
    await writer.query("ROLLBACK");
    await writer.query("delete from app.site_request_answers where org_id='answer-org'");
    await writer.query("delete from app.people where org_id='answer-org'");
    await writer.query("delete from app.organizations where org_id='answer-org'");
    await writer.end(); await reader.end();
  }
});
