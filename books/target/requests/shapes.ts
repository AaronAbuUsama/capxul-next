// The shapes requests' rpcs and flows share: inputs and the views a reader gets. Not records: the
// rpc and flow records in the area files hold them.

import { Schema } from "effect";
import { OwnerKind, PayerKind, RequestKind, RequestStatus } from "./data.ts";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;
const NullOr = Schema.NullOr;

/** `--org <org>`: act for that Organization; absent, for yourself. */
export const Org = opt(S);

/** A page: `--limit` 1 to 100 (25 by default), `--after` the `nextCursor` of the page before. */
export const PageInput = { org: Org, limit: opt(N), after: opt(S) };

/** A token amount as a reader sees it: the asset, the decimal value and the exact raw units. */
export const Amount = Schema.Struct({ asset: S, value: S, raw: S, decimals: N });

/** A document line: its hash and the `capxul document render` command that renders it. */
export const DocumentRef = Schema.Struct({ hash: S, render: S });

/** The Payment that pays or paid a request, as payments holds it, with the commands to read and follow it. */
export const PaymentRef = Schema.Struct({
  paymentId: S,
  status: S,
  outcome: NullOr(S),
  get: S,
  wait: S,
});

/** A request as its issuer or its addressed payer reads it. */
export const RequestView = Schema.Struct({
  id: S,
  kind: RequestKind,
  status: RequestStatus,
  issuer: Schema.Struct({ kind: OwnerKind, label: S, safe: S }),
  payer: Schema.Struct({ kind: PayerKind, label: NullOr(S), safe: NullOr(S) }),
  amount: Amount,
  reference: S,
  note: NullOr(S),
  documents: Schema.Array(DocumentRef),
  expiresAt: NullOr(N),
  dueAt: NullOr(N),
  /** For a payer not on Capxul: the escrow they pay, and what it held when the request's process last read it. */
  escrow: NullOr(Schema.Struct({ address: S, receivedRaw: S, checkedAt: NullOr(N), payoutTx: NullOr(S) })),
  /** The checkout link, for a payer outside Capxul or a request with no payer yet. */
  checkout: NullOr(Schema.Struct({ url: S })),
  paymentId: NullOr(S),
  payment: NullOr(PaymentRef),
  depositId: NullOr(S),
  createdAt: N,
  updatedAt: N,
});

export const RequestPage = Schema.Struct({ items: Schema.Array(RequestView), nextCursor: NullOr(S) });

/** A service's terms, as `service create` and `service revise` take them. */
export const ServiceTerms = Schema.Struct({
  title: S,
  description: opt(S),
  unitLabel: S,
  /** The unit price: an admitted asset id and a decimal value. */
  unitAmount: Schema.Struct({ asset: S, value: S }),
  quantity: Schema.Struct({ min: N, max: N }),
});

/** A service at its current revision, as its owner reads it. */
export const ServiceView = Schema.Struct({
  offerId: S,
  revision: N,
  active: Schema.Boolean,
  terms: ServiceTerms,
  recipientSafe: S,
  checkout: Schema.Struct({ url: S }),
  createdAt: N,
  updatedAt: N,
});

export const ServicePage = Schema.Struct({ items: Schema.Array(ServiceView), nextCursor: NullOr(S) });
