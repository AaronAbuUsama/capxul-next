import { formatUnits } from "viem";
import type { Sql } from "../platform/db.ts";
import type { TransitionEvent } from "../platform/outbox.ts";
import { directors, payer, person, type Owner, type Sources } from "./sources.ts";
import type { Intent, Template } from "./templates.ts";
import type { Resolve } from "./workflows.ts";

export type Links = { quickstart: string; chat: string; support: string; signup: string; approval: (id: string) => string; explorer: (address: string) => string };

export function createResolver(source: Sources, links: Links): Resolve {
  const owner = (e: TransitionEvent): Owner => {
    if (!e.owner_kind || !e.owner_id) throw new Error("INVALID_INPUT: source event owner required");
    return { kind: e.owner_kind, id: e.owner_id };
  };
  const name = async (sql: Sql, o: Owner) => o.kind === "organization" ? (await source.organization(sql, o.id)).name : await source.partyName(sql, o) ?? (await source.principal(sql, o.id))?.email ?? "";
  const recipients = (sql: Sql, o: Owner) => o.kind === "person" ? person(source, sql, o.id) : directors(source, sql, o.id);
  return async (sql, workflow, e, days) => {
    const intents: Intent[] = [];
    const add = (template: Template, recipient: string, facts: Record<string, unknown>, personId: string | null = null, occasion = e.id) => {
      intents.push({ recipient, notice_id: `${template}:${occasion}`, template,
        subject_kind: e.machine === "waitlist-entry" ? "admission" : e.machine as Intent["subject_kind"],
        subject_id: e.entity_id, cause: workflow === "notices.payments.money-reminders" ? "stop" : `${e.machine}.${e.props.transition}`, person_id: personId,
        org_id: e.owner_kind === "organization" ? e.owner_id : null, trace_id: e.trace_id, facts });
    };
    if (workflow === "notices.accounts.welcome" || workflow === "notices.accounts.welcome-unlisted") {
      const admission = await source.admission(sql, e);
      const via = admission.admitted_by ?? "";
      if (/^(invitation|escrow|fde-guest):/.test(via) || admission.referral_rewarded_with_invite) return { intents };
      let referrer: string | undefined;
      if (via.startsWith("referral:")) {
        const email = admission.referrer_email ?? via.slice("referral:".length), p = await source.principalByEmail(sql, email);
        referrer = p ? await source.partyName(sql, { kind: "person", id: p.personId }) ?? email : email;
      }
      add("beta-welcome", admission.email, { quickstart: links.quickstart, chat: links.chat, support: links.support, ...(referrer ? { referrer } : {}) },
        typeof e.props.person_id === "string" ? e.props.person_id : null);
      return { intents };
    }
    if (workflow === "notices.board.proposal-waiting") {
      const o = owner(e), p = await source.proposal(sql, o.id, e.entity_id);
      for (const recipient of await directors(source, sql, o.id, p.proposer_safe)) add("proposal-waiting", recipient.email!, {
        organization: await name(sql, o), opener: p.opener, subject: typeof p.subject === "string" ? p.subject : JSON.stringify(p.subject),
        note: p.note, approval_url: links.approval(e.entity_id),
      }, recipient.personId);
      return { intents };
    }
    if (workflow === "notices.board.officer-granted") {
      const o = owner(e), c = await source.officerChange(sql, o.id, e.entity_id);
      if (c.change !== "grant") return { intents };
      const p = c.principal_id ? (await person(source, sql, c.principal_id))[0] : undefined;
      if (c.email || p?.email) add("officer-hat-granted", c.email ?? p!.email!, { organization: await name(sql, o), permission: c.permission, note: c.note }, p?.personId ?? null);
      return { intents };
    }
    if (workflow === "notices.requests.paid") {
      const o = owner(e), r = await source.request(sql, o, e.entity_id);
      if (r.kind !== "invoice") return { intents };
      const facts = { number: r.reference, amount: formatUnits(BigInt(r.amount_raw), r.decimals), asset: r.asset_id,
        issuer: await name(sql, o), payer: r.payer_email ?? (r.payer_safe ? (await source.principalBySafe(sql, r.payer_safe))?.email : "") };
      for (const p of await recipients(sql, o)) add("invoice-paid", p.email!, facts, p.personId);
      if (r.payer_kind === "outside" && r.payer_email && r.escrow_address && r.payout_tx_hash) add("invoice-receipt", r.payer_email, facts);
      return { intents };
    }
    const o = owner(e), p = await source.payment(sql, o, e.entity_id);
    const facts = { amount: formatUnits(BigInt(p.amount_raw), p.decimals), asset: p.asset,
      payer: p.owner_kind === "organization" ? await name(sql, o) : p.payer_label, pay_at: p.pay_at,
      shortfall: p.shortfall, reason: p.outcome, signup: links.signup, explorer: p.escrow_address ? links.explorer(p.escrow_address) : null };
    const batch = async (waiting = false) => p.command_id ? (await source.commandPayments(sql, o, p.command_id))
      .filter((v) => waiting ? v.status === "escrowed" : v.pay_at === p.pay_at)
      .map((v) => `${v.payee_mailbox ?? v.payee_id ?? v.id}: ${formatUnits(BigInt(v.amount_raw), v.decimals)} ${v.asset}`).join("\n") : "";
    const toPayer = async (template: Template, occasion: string, extra: Record<string, unknown>) => {
      for (const r of await payer(source, sql, p)) add(template, r.email!, { ...facts, ...extra, side: "payer" }, r.personId, occasion);
    };
    if (workflow === "notices.payments.money-reminders") {
      if (p.route !== "claim_escrow" || p.status !== "escrowed" || !p.payee_mailbox) return { intents, ended: true };
      if (days !== 3 && days !== 10 && days !== 30) throw new Error("INVALID_INPUT: reminder stop required");
      add("money-waiting-reminder", p.payee_mailbox, { ...facts, days }, null, `${p.id}:${days}`);
      if (days !== 3) await toPayer("money-uncollected", `${p.command_id ?? p.id}:${days}`, { days, mailbox: p.payee_mailbox, payments: await batch(true) });
      return { intents };
    }
    if (workflow === "notices.payments.money-waiting") {
      if (p.route === "claim_escrow" && p.payee_mailbox) add("money-waiting", p.payee_mailbox, facts);
      return { intents };
    }
    if (workflow === "notices.payments.money-taken-back") {
      if (p.route === "claim_escrow" && e.props.from === "escrowed" && p.outcome === "refunded" && p.payee_mailbox) add("money-taken-back", p.payee_mailbox, facts);
      return { intents };
    }
    if (p.pay_at === null) return { intents };
    if (workflow === "notices.payments.short") {
      if (p.shortfall) await toPayer("payment-scheduled-short", `${p.command_id ?? p.id}:${p.pay_at}`, { payments: await batch() });
      return { intents };
    }
    const template = { "notices.payments.scheduled": "payment-scheduled", "notices.payments.sent": "payment-scheduled-sent",
      "notices.payments.cancelled": "payment-scheduled-cancelled", "notices.payments.failed": "payment-scheduled-failed" }[workflow] as Template;
    if (p.payee_kind && p.payee_id) for (const r of await recipients(sql, { kind: p.payee_kind, id: p.payee_id })) add(template, r.email!, { ...facts, side: "payee" }, r.personId);
    if (workflow === "notices.payments.failed") await toPayer(template, `${p.command_id ?? p.id}:${p.pay_at}`, { payments: await batch() });
    return { intents };
  };
}
