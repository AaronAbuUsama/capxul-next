// The trace id of this process's command, and what the command touched. One CLI process runs one command, so a module-level value is the
// whole mechanism: every call the command makes (Core, the chain, Frappe) carries `trace`, and the recorder reads `touched` at the end.
import { randomBytes } from "node:crypto";

export const trace = `tr_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;   // time-sortable; matches the site's ^tr_[0-9a-z]{8,40}$

export type DocTouch = { site: string; doctype: string; name: string; action: string };
export const touched: { tx: { hash: string; fn: string }[]; docs: DocTouch[]; actor?: string; org?: string; extra: Record<string, unknown> } =
  { tx: [], docs: [], extra: {} };

export const touchTx = (hash: string, fn: string): void => { touched.tx.push({ hash, fn }); };
export const touchDoc = (d: DocTouch): void => { touched.docs.push(d); };
