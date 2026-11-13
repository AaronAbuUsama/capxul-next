import assert from "node:assert/strict";
import test from "node:test";
import { createResolver, type Links } from "../src/notices/resolve.ts";
import type { Sources, Payment, Principal } from "../src/notices/sources.ts";
import type { Sql } from "../src/platform/db.ts";
import type { TransitionEvent } from "../src/platform/outbox.ts";

// These tests cover recipient/content decisions, not real-stack source integration or delivery claims.
const sql: Sql = { async query(): Promise<never> { throw new Error("source fixture must not issue SQL"); } };
const links: Links = { quickstart: "https://capxul.test/start", chat: "https://capxul.test/chat", support: "support@capxul.test",
  signup: "https://capxul.test/signup", approval: (id) => `https://capxul.test/approve/${id}`, explorer: (id) => `https://chain.test/address/${id}` };
const principal = (id: string, kind: Principal["kind"] = "person"): Principal => ({ personId: id, kind, email: `${id}@capxul.test`, safeAddress: `safe-${id}` });
const payment: Payment = { id: "payment-A", owner_kind: "organization", owner_id: "company", command_id: "command-A", chain_id: 84532,
  route: "budget", status: "lapsed", outcome: "balance_too_low", pay_at: 1_800_000_000_000, budget_id: "budget-A",
  payer_label: "unused", payee_kind: "person", payee_id: "recipient", payee_mailbox: null,
  amount_raw: "1234500", decimals: 6, asset: "USDC", escrow_address: null, shortfall: "balance_too_low" };
function sources(overrides: Partial<Sources> = {}): Sources {
  return {
    admission: async () => ({ email: "admitted@capxul.test", admitted_by: "operator:Alex", referrer_email: null, referral_rewarded_with_invite: false }),
    principal: async (_sql, id) => principal(id), principalBySafe: async (_sql, safe) => principal(safe),
    principalByEmail: async () => null, partyName: async () => "Display name",
    organization: async () => ({ name: "Current company", safe: "company-safe" }),
    proposal: async () => ({ proposer_safe: "safe-proposer", safe_address: "company-safe", note: "Director note", opener: "reject", subject: "invoice", proposer_principal_id: "proposer" }),
    officerChange: async () => ({ change: "grant", permission: "manage-books", email: "future-member@capxul.test", principal_id: null, note: "Director note" }),
    payment: async () => payment, commandPayments: async () => [payment], hatWearers: async () => ["current-wearer"],
    request: async () => ({ kind: "invoice", owner_kind: "organization", owner_id: "company", reference: "INV-42", payer_kind: "outside",
      payer_email: "outside@capxul.test", payer_safe: null, escrow_address: "escrow", payout_tx_hash: "payout", amount_raw: "42750000", decimals: 6, asset_id: "USDC" }),
    safeOwners: async () => ["safe-proposer", "safe-current", "safe-agent"], ...overrides,
  };
}
const event = (machine: string, transition: string): TransitionEvent => ({ id: "source-A", name: `${machine.replaceAll("-","_")}_transitioned`,
  machine, entity_id: `${machine}-A`, owner_kind: "organization", owner_id: "company", actor: null,
  trace_id: "trace-A", at: 1_800_000_000_000, props: { transition } });

test("welcomes suppress invitation/escrow/guest and invite rewards; only referral welcomes name a referrer", async () => {
  for (const via of ["invitation:company", "escrow:payment", "fde-guest:company", "operator:Alex", "referral:friend@capxul.test", "reward:referee@capxul.test"]) {
    const source = sources({ admission: async () => ({ email: "admitted@capxul.test", admitted_by: via, referrer_email: "friend@capxul.test", referral_rewarded_with_invite: false }),
      principalByEmail: async () => principal("friend") });
    const resolve = createResolver(source, links);
    for (const workflow of ["notices.accounts.welcome", "notices.accounts.welcome-unlisted"] as const) {
      const plan = await resolve(sql, workflow, event("waitlist-entry", "admit"), null);
      assert.equal(plan.intents.length, /^(invitation|escrow|fde-guest):/.test(via) ? 0 : 1);
      if (plan.intents[0]) {
        assert.equal(plan.intents[0].facts.referrer, via.startsWith("referral:") ? "Display name" : undefined);
        assert.equal(plan.intents[0].notice_id, "beta-welcome:source-A");
      }
    }
  }
  const resolve = createResolver(sources({ admission: async () => ({ email: "reward@capxul.test", admitted_by: "reward:friend", referrer_email: null, referral_rewarded_with_invite: true }) }), links);
  assert.deepEqual((await resolve(sql, "notices.accounts.welcome", event("waitlist-entry","admit"), null)).intents, []);
});

test("proposal notices follow current Safe owners, excluding proposer and agents; pre-sign-in grants retain their mailbox", async () => {
  const source = sources({ safeOwners: async () => ["SAFE-PROPOSER","safe-current","safe-agent"],
    principalBySafe: async (_sql, safe) => principal(safe, safe === "safe-agent" ? "agent" : "person") });
  const resolve = createResolver(source, links);
  const proposal = await resolve(sql, "notices.board.proposal-waiting", event("proposal","propose"), null);
  assert.deepEqual(proposal.intents.map((i) => i.recipient), ["safe-current@capxul.test"]);
  assert.equal(proposal.intents[0]!.facts.opener, "reject");
  assert.equal(proposal.intents[0]!.facts.note, "Director note");
  const grant = await resolve(sql, "notices.board.officer-granted", event("officer-change","apply"), null);
  assert.deepEqual(grant.intents.map((i) => [i.recipient,i.person_id]), [["future-member@capxul.test",null]]);
  source.officerChange = async () => ({ change: "revoke", permission: "manage-books", email: "future-member@capxul.test", principal_id: null, note: "revoked" });
  assert.deepEqual((await resolve(sql, "notices.board.officer-granted", event("officer-change","apply"), null)).intents, []);
});

test("dated failure tells both sides, batches payer keys by command/day, and follows current budget wearers", async () => {
  let p = { ...payment };
  const source = sources({ payment: async () => p, hatWearers: async (_sql, owner) => {
    assert.deepEqual(owner, { orgId: "company", chainId: 84532, budgetId: "budget-A" });
    return ["new-wearer","agent"];
  },
    principalBySafe: async (_sql, safe) => principal(safe, safe === "agent" ? "agent" : "person"),
    commandPayments: async () => [payment, { ...payment, id: "payment-B", amount_raw: "2900000", pay_at: payment.pay_at! + 86_400_000 }] });
  const resolve = createResolver(source, links), e = event("payment","lapse");
  const first = await resolve(sql, "notices.payments.failed", e, null);
  assert.deepEqual(first.intents.map((i) => [i.recipient,i.notice_id]), [
    ["recipient@capxul.test","payment-scheduled-failed:source-A"],
    ["new-wearer@capxul.test", "payment-scheduled-failed:command-A:1800000000000"],
  ]);
  assert.equal(first.intents[0]!.facts.amount, "1.2345");
  assert.equal(first.intents[1]!.facts.payments, "recipient: 1.2345 USDC");
  p = { ...p, id: "payment-C" };
  const next = await resolve(sql, "notices.payments.failed", { ...e, id: "source-C", entity_id: "payment-C" }, null);
  assert.equal(next.intents[1]!.notice_id, first.intents[1]!.notice_id);
  assert.notEqual(next.intents[0]!.notice_id, first.intents[0]!.notice_id);
  p = { ...p, pay_at: null };
  assert.deepEqual((await resolve(sql, "notices.payments.failed", e, null)).intents, []);
  p = { ...p, pay_at: payment.pay_at, shortfall: null };
  assert.deepEqual((await resolve(sql, "notices.payments.short", event("payment","come_due"), null)).intents, []);
  p = { ...p, shortfall: "budget_exhausted" };
  assert.deepEqual((await resolve(sql, "notices.payments.short", event("payment","come_due"), null)).intents.map((i) => i.recipient), ["new-wearer@capxul.test"]);
});

test("escrow reminders use each stop and current payer membership; moved or undated unrelated routes send nothing", async () => {
  let p = { ...payment, route: "claim_escrow", status: "escrowed", pay_at: null, payee_mailbox: "waiting@outside.test", escrow_address: "escrow-A" };
  let wearer = "";
  const source = sources({ payment: async () => p, hatWearers: async () => [wearer],
    commandPayments: async () => [p, { ...p, id: "collected", status: "settled", amount_raw: "99000000" }] });
  const resolve = createResolver(source, links), e = event("payment","escrow");
  for (const days of [3,10,30]) {
    wearer = `wearer-at-${days}`;
    const plan = await resolve(sql, "notices.payments.money-reminders", e, days);
    assert.deepEqual(plan.intents.map((i) => i.notice_id), days === 3 ? ["money-waiting-reminder:payment-A:3"] :
      [`money-waiting-reminder:payment-A:${days}`,`money-uncollected:command-A:${days}`]);
    assert(plan.intents.every((i) => i.cause === "stop"));
    if (days !== 3) {
      assert.equal(plan.intents[1]!.facts.payments, "waiting@outside.test: 1.2345 USDC");
      assert.equal(plan.intents[1]!.recipient, `wearer-at-${days}@capxul.test`);
    }
  }
  p = { ...p, status: "settled" };
  assert.deepEqual(await resolve(sql, "notices.payments.money-reminders", e, 10), { intents: [], ended: true });
  p = { ...p, status: "escrowed", route: "budget" };
  assert.deepEqual(await resolve(sql, "notices.payments.money-reminders", e, 10), { intents: [], ended: true });
});

test("invoice settlement sends receipt only for outside escrow payout, never a non-invoice or bank settlement", async () => {
  const source = sources(), original = await source.request(sql, { kind: "organization", id: "company" }, "request-A");
  const resolve = createResolver(source, links), e = event("request","settle");
  source.safeOwners = async () => ["director"];
  assert.deepEqual((await resolve(sql, "notices.requests.paid", e, null)).intents.map((i) => i.template), ["invoice-paid","invoice-receipt"]);
  for (const variation of [{ payer_kind: "capxul" }, { payout_tx_hash: null }, { escrow_address: null }]) {
    source.request = async () => ({ ...original, ...variation });
    assert.deepEqual((await resolve(sql, "notices.requests.paid", e, null)).intents.map((i) => i.template), ["invoice-paid"]);
  }
  source.request = async () => ({ ...original, kind: "request" });
  assert.deepEqual((await resolve(sql, "notices.requests.paid", e, null)).intents, []);
});
