// Public sign-in for actor preparation. Every result is a fresh session read back through `current`;
// nothing here mints bearers, reuses a session that survived a restore, or proves Seat/hat authority.
import { AccessClientError, type AccessSession, type AgentSignIn, type PersonSignIn, type createAccessClient } from "./client.ts";

type Client = ReturnType<typeof createAccessClient>;
/** A sink that lists outbound mail newest first, such as the devnet Mail sink's `list`. */
export type MailInbox = { list(input: { to: string }): Promise<{ mail: readonly Record<string, unknown>[] }> };

const ids = async (inbox: MailInbox, to: string) =>
  new Set((await inbox.list({ to })).mail.map((m) => m.mailId).filter((id): id is string => typeof id === "string"));

/** Code sign-in. The OTP is taken from the one sink message that is new since this call, never the first row by sentAt:
 * a stopped world clock can give several messages the same time. */
export async function signInByCode(client: Client, inbox: MailInbox, input: { email: string; client: string; attempts?: number; waitMs?: number }):
Promise<{ signIn: PersonSignIn; session: AccessSession }> {
  const before = await ids(inbox, input.email);
  await client.sendCode({ email: input.email });
  let code: string | undefined;
  for (let i = 0; i < (input.attempts ?? 50) && !code; i++) {
    const fresh = (await inbox.list({ to: input.email })).mail.filter((m) => typeof m.mailId === "string" && !before.has(m.mailId));
    if (fresh.length > 1) throw new AccessClientError("PROVIDER_RESPONSE_INVALID");
    const match = typeof fresh[0]?.text === "string" ? fresh[0].text.match(/\b\d{6}\b/) : null;
    if (match) code = match[0];
    else await new Promise((resolve) => setTimeout(resolve, input.waitMs ?? 100));
  }
  if (!code) throw new AccessClientError("PROVIDER_ERROR");
  const signIn = await client.verifyCode({ email: input.email, code, client: input.client });
  const session = await client.current(signIn.token);
  if (session.kind !== "person" || session.personId !== signIn.personId || session.email !== signIn.email || session.safe !== signIn.safe)
    throw new AccessClientError("PROVIDER_RESPONSE_INVALID");
  return { signIn, session };
}

/** Agent sign-in: the agent's sole Safe signer signs the exact challenge with EIP-191 (viem `account.signMessage`). */
export async function signInByKey(client: Client, input: { safe: string; client: string; signMessage: (message: string) => Promise<string> }):
Promise<{ signIn: AgentSignIn; session: AccessSession }> {
  const { challenge } = await client.challenge({ safe: input.safe });
  const signIn = await client.withKey({ safe: input.safe, challenge, signature: await input.signMessage(challenge), client: input.client });
  const session = await client.current(signIn.token);
  if (session.kind !== "agent" || session.personId !== signIn.personId || session.safe !== signIn.safe)
    throw new AccessClientError("PROVIDER_RESPONSE_INVALID");
  return { signIn, session };
}
