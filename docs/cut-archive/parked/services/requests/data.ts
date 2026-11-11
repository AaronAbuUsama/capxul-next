// Moved out of the built book by the cut, 10 November 2026, from books/target/requests/data.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_requests } from "../shared/foundation.ts";

export const table_services = defineTable({
  id: "services",
  title: "Fixed-price services a person or Organization offers",
  about:
    "One row per fixed-price service (the old code's Offer; the frozen returns still call its id `offerId`). Created once " +
    "per owner and request key (`terms_digest` is the hash of the canonical terms a repeat must match), revised by freezing " +
    "the next revision at the expected one (`revision` is the current), and deactivated once, never reactivated. A buyer " +
    "at its link buys its current revision, which births a purchase request (`requests`). Replaces old fixedOffers.",
  was: [`${T}:130`, `${AS_IS}:345`, `${R}/offers/writes.ts:100`],
  concept: concept_requests,
  tenancy: "owner",
  tenantField: "owner_kind",
  fields: Schema.Struct({
    owner_kind: OwnerKind,
    owner_id: S,
    service_id: S,
    request_key: S,
    terms_digest: S,
    revision: N,
    status: ServiceStatus,
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_kind", "owner_id", "service_id"],
  indexes: [
    {
      name: "by_owner_created",
      fields: ["owner_kind", "owner_id", "created_at", "service_id"],
      for: "`service list`: the owner's services in creation order, paged by the cursor.",
    },
    {
      name: "by_owner_key",
      fields: ["owner_kind", "owner_id", "request_key"],
      unique: true,
      for: "`service create`: one service per owner and request key; the same key and terms return the same service.",
    },
    {
      name: "by_service",
      fields: ["service_id"],
      unique: true,
      crossTenant: true,
      for: "The service's checkout page by its link (`/buy/<service id>`, no session): whether it is still sold.",
    },
  ],
  retention: KEPT,
});

export const table_service_revisions = defineTable({
  id: "service-revisions",
  title: "Service revisions: each revision's frozen terms",
  about:
    "One immutable row per revision of a service: its title, description, unit label, unit price (token and exact raw " +
    "amount), the quantity range a buyer may take and the Safe it pays into, as they were when the revision was frozen. " +
    "Never changed or deleted, so every earlier revision is kept and a purchase points at the one it bought. It carries " +
    "its owner's tenant columns itself (no tenancy by join). Replaces old fixedOfferRevisions.",
  was: [`${T}:144`, `${AS_IS}:378`, `${R}/offers/writes.ts:48`],
  concept: concept_requests,
  tenancy: "owner",
  tenantField: "owner_kind",
  fields: Schema.Struct({
    owner_kind: OwnerKind,
    owner_id: S,
    service_id: S,
    revision: N,
    title: S,
    description: NullOr(S),
    unit_label: S,
    asset_id: S,
    token_address: S,
    decimals: N,
    unit_amount_raw: S,
    quantity_min: N,
    quantity_max: N,
    recipient_safe: S,
    created_at: N,
  }),
  key: ["owner_kind", "owner_id", "service_id", "revision"],
  indexes: [
    {
      name: "by_service_revision",
      fields: ["service_id", "revision"],
      unique: true,
      crossTenant: true,
      for: "The checkout page's terms: a service's current revision read by its link, with no session.",
    },
  ],
  retention: KEPT,
});

export const event_service_transitioned = defineEvent({
  id: "service_transitioned",
  about:
    "A service was created, revised or deactivated. `from` is null at its birth; a revision is active to active with its " +
    "new `revision`, so each revision is reported once, in order. It never carries the price, title, description or unit " +
    "label. Replaces old service_changed.",
  props: Schema.Struct({
    from: NullOr(ServiceStatus),
    to: ServiceStatus,
    transition: Schema.Literals(SERVICE_TRANSITIONS),
    service_id: S,
    revision: N,
    owner_kind: OwnerKind,
    owner_id: S,
  }),
  was: [`${R}/offers/events.ts:53`],
});

export const machine_service = defineMachine({
  id: "service",
  title: "A service: sold until it is deactivated",
  about:
    "`services.status`. Born active at revision 1; each revision freezes new terms and keeps it active; deactivating stops it " +
    "selling for good. A deactivated service refuses revision and new purchases, and its owner still reads it. Replaces " +
    "the old boolean `active`.",
  was: [`${T}:137`, `${AS_IS}:543`],
  table: table_services,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "Sold: a buyer at its link buys its current revision." },
    { id: "inactive", about: "Deactivated: no longer sold, and never revised again.", terminal: true },
  ],
  transitions: {
    create: {
      from: [],
      to: "active",
      about: "Birth at revision 1 with its first revision row (`service create`).",
      guard: "A new request key for this owner; terms within their limits; the owner's Safe is known.",
      emits: [event_service_transitioned],
    },
    revise: {
      from: ["active"],
      to: "active",
      about: "The next revision is frozen at the expected revision (`service revise`); every earlier one is kept.",
      guard: "The caller read the current revision; the service is active.",
      emits: [event_service_transitioned],
    },
    deactivate: {
      from: ["active"],
      to: "inactive",
      about: "It stops selling (`service deactivate`); its revision does not change.",
      guard: "The caller read the current revision. An inactive service is returned as it is and nothing is sent.",
      emits: [event_service_transitioned],
    },
  },
});
