export interface MailMessage {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  idempotencyKey: string;
}

export interface Mail {
  send(message: MailMessage): Promise<{ id: string }>;
}

export class MailError extends Error {
  readonly code: "PROVIDER_ERROR" | "RATE_LIMITED" | "INVALID_INPUT";
  constructor(code: MailError["code"]) {
    super({ PROVIDER_ERROR: "Mail provider unavailable or invalid response", RATE_LIMITED: "Mail provider rate limited", INVALID_INPUT: "Mail recipient or request refused" }[code]);
    this.code = code;
    this.name = "MailError";
  }
}

type ResendConfig = {
  apiKey: string;
  from: string;
  transport?: typeof fetch;
} & ({ environment: "staging"; allowedRecipients: readonly string[] } | { environment: "production" });

/** No retry here: a lost answer is retried by the durable caller with exactly the same key. */
export function resendMail(config: ResendConfig): Mail {
  if (!["staging", "production"].includes(config.environment)) throw new MailError("INVALID_INPUT");
  const allowed = config.environment === "staging" ? new Set(config.allowedRecipients.map((s) => s.trim().toLowerCase())) : undefined;
  const transport = config.transport ?? fetch;
  return {
    async send(message) {
      const to = message.to.trim().toLowerCase();
      // This door accepts one plain mailbox, not a display-name list that could bypass the allowlist.
      if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to) || (allowed && !allowed.has(to)) ||
          !message.idempotencyKey || message.idempotencyKey.length > 256 || (!message.html && !message.text)) {
        throw new MailError("INVALID_INPUT");
      }
      let response: Response;
      try {
        response = await transport("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", "Idempotency-Key": message.idempotencyKey },
          body: JSON.stringify({ from: config.from, to: [to], subject: message.subject, html: message.html, text: message.text }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch { throw new MailError("PROVIDER_ERROR"); }
      if (response.status === 429) throw new MailError("RATE_LIMITED");
      if ([400, 422].includes(response.status)) throw new MailError("INVALID_INPUT");
      let body: unknown;
      try { body = await response.json(); } catch { throw new MailError("PROVIDER_ERROR"); }
      if (response.status === 403 && typeof body === "object" && body !== null && "name" in body && body.name === "validation_error") {
        throw new MailError("INVALID_INPUT");
      }
      if (!response.ok || typeof body !== "object" || body === null || !("id" in body) || typeof body.id !== "string" || !body.id.trim()) {
        throw new MailError("PROVIDER_ERROR");
      }
      return { id: body.id };
    },
  };
}
