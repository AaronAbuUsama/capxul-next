import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";

export function sign(body: string): string {
  return createHmac("sha256", config.secret).update(body).digest("hex");
}

export function verify(body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(signature.trim().toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
}
