export const templates = [
  "beta-welcome", "proposal-waiting", "officer-hat-granted", "payment-scheduled", "payment-scheduled-short",
  "payment-scheduled-sent", "payment-scheduled-cancelled", "payment-scheduled-failed", "money-waiting",
  "money-waiting-reminder", "money-uncollected", "money-taken-back", "invoice-paid", "invoice-receipt",
] as const;
export type Template = typeof templates[number];
export interface Intent {
  recipient: string;
  notice_id: string;
  template: Template;
  subject_kind: "admission" | "proposal" | "officer-change" | "payment" | "request";
  subject_id: string;
  cause: string;
  person_id: string | null;
  org_id: string | null;
  trace_id: string;
  facts: Record<string, unknown>;
}

/** Persist these inputs, never the body: replay renders exactly the same message. */
export function render(intent: Intent): { subject: string; text: string } {
  const f = intent.facts;
  const money = `${f.amount ?? ""} ${f.asset ?? ""}`.trim();
  switch (intent.template) {
    case "beta-welcome": return {
      subject: "Welcome to Capxul",
      text: `${f.referrer ? `${f.referrer} invited you to Capxul. ` : ""}Your email is admitted to the beta.\nQuickstart: ${f.quickstart}\nChat: ${f.chat}\nSupport: ${f.support}`,
    };
    case "proposal-waiting": return {
      subject: `${f.organization}: a proposal needs your approval`,
      text: `${f.opener} proposed ${f.subject}.\n${f.note ?? ""}\nReview and approve: ${f.approval_url}`,
    };
    case "officer-hat-granted": return {
      subject: `${f.organization}: you were given ${f.permission}`,
      text: `You now have the ${f.permission} permission.\n${f.note ?? ""}`,
    };
    case "payment-scheduled": return {
      subject: "A payment to you is scheduled", text: `${f.payer} scheduled ${money} to you for ${f.pay_at}.`,
    };
    case "payment-scheduled-short": return {
      subject: "Your scheduled payment needs funding",
      text: `Your payment on ${f.pay_at} is short by ${f.shortfall}. Fund it before it is due.\n${f.payments ?? ""}`,
    };
    case "payment-scheduled-sent": return {
      subject: "Your scheduled payment arrived", text: `${f.payer} paid you ${money}.`,
    };
    case "payment-scheduled-cancelled": return {
      subject: "Your scheduled payment was cancelled", text: `${f.payer} cancelled the ${money} payment scheduled for ${f.pay_at}.`,
    };
    case "payment-scheduled-failed": return {
      subject: "A scheduled payment did not go",
      text: `The ${money} payment scheduled for ${f.pay_at} did not go: ${f.reason}. Nothing moved.${f.side === "payer" ? " Use capxul payment retry or capxul payment reschedule." : ""}\n${f.payments ?? ""}`,
    };
    case "money-waiting": return {
      subject: "Money is waiting for you",
      text: `${f.payer} sent you ${money}. It waits in escrow: ${f.explorer}. Sign up with this email at ${f.signup}, set up your account and sign the collection. Already set up? Run capxul payment claim. Until you collect, the sender may take it back.`,
    };
    case "money-waiting-reminder": return {
      subject: "Your money is still waiting",
      text: `${money} from ${f.payer} has waited ${f.days} days. Collect it at ${f.signup} with this email, or run capxul payment claim. The sender may take it back until you collect.${f.days === 30 ? " This is the last reminder." : ""}`,
    };
    case "money-uncollected": return {
      subject: "Your sent money is still uncollected",
      text: `${f.mailbox} has not collected ${money} after ${f.days} days. You can take it back with capxul payment cancel.\n${f.payments ?? ""}`,
    };
    case "money-taken-back": return {
      subject: "The waiting money was taken back",
      text: `${f.payer} took back ${money}. Nothing waits for you now. Your beta admission still stands; you can sign up with this email at ${f.signup}.`,
    };
    case "invoice-paid": return { subject: `Invoice ${f.number} was paid`, text: `${f.payer} paid invoice ${f.number}: ${money}.` };
    case "invoice-receipt": return { subject: `Receipt for invoice ${f.number}`, text: `Your payment of ${money} to ${f.issuer} for invoice ${f.number} was received.` };
    default: throw new Error("INVALID_INPUT: unsupported notice template");
  }
}
