// Requests' services area: fixed-price services an owner offers, with immutable revisions. A buyer
// at a service's link buys its current revision (checkout.ts), which births a purchase request. A
// service is a short-lived row that changes only inside these rpcs, so it has no process.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_requests } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { machine_service, table_service_revisions, table_services } from "./data.ts";
import { Org, PageInput, ServicePage, ServiceTerms, ServiceView } from "./shapes.ts";
import { GUARD_WAS, READER, WRITER } from "./guards.ts";

const R = "packages/backend/src/requests/offers";
const ASIS = "books/as-is/requests/offers.ts";

const S = Schema.String;
const N = Schema.Number;

const WRITE_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED];
const READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT];

export const rpc_requests_services_create = defineRpc({
  id: "requests.services.create",
  title: "Create a fixed-price service",
  about:
    "Creates a service at revision 1 from its terms: a title, an optional description, a unit label, a unit price in an " +
    "admitted asset and the quantity range a buyer may take. The request key (1 to 128 characters, no control characters) " +
    "makes it idempotent: the same owner, key and terms (`terms_digest`) return the same service and change nothing; the " +
    "key with other terms is INVALID_INPUT. The unit amount is exact in the token's decimals and every total in the " +
    "quantity range fits (INVALID_INPUT otherwise); the minimum is at least 1 and not above the maximum. The service pays " +
    "the owner's Safe (the person's, or the company Safe). It births the service through `create` with its first revision " +
    "row in one transaction. It moves no money.",
  was: [`${R}/operations/create.ts:10`, `${R}/writes.ts:86`, `${R}/writes.ts:100`, `${ASIS}:94`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "mutation",
  who: "A signed-in person for themselves; with `org`, a member whose Safe wears the Organization's Invoicing hat.",
  input: Schema.Struct({ org: Org, request_key: S, terms: ServiceTerms }),
  output: ServiceView,
  errors: WRITE_ERRORS,
  reads: [table_services, ...WRITER],
  writes: [table_services, table_service_revisions],
  drives: [machine_service.t.create],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_requests_services_get = defineRpc({
  id: "requests.services.get",
  title: "One service you, or the Organization, offer",
  about:
    "The service at its current revision with its checkout link, whether it is active, the Safe it pays and its terms; " +
    "INVALID_INPUT `service is unavailable` for another owner's service or none. It writes nothing.",
  was: [`${R}/operations/get.ts:10`, "packages/backend/src/requests/reads/offers.ts:67", `${ASIS}:133`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person who owns the service; with `org`, a current member of the Organization.",
  input: Schema.Struct({ org: Org, offer_id: S }),
  output: ServiceView,
  errors: READ_ERRORS,
  reads: [table_services, table_service_revisions, ...READER],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_requests_services_list = defineRpc({
  id: "requests.services.list",
  title: "The services you, or the Organization, offer",
  about:
    "One page of the owner's services in creation order, active or not, each at its current revision with its checkout " +
    "link. 25 by default, 1 to 100; an `after` this list did not give is INVALID_INPUT. Another owner's services are " +
    "never listed. It writes nothing.",
  was: [`${R}/operations/list.ts:10`, `${ASIS}:157`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for themselves; with `org`, a current member of the Organization.",
  input: Schema.Struct(PageInput),
  output: ServicePage,
  errors: READ_ERRORS,
  reads: [table_services, table_service_revisions, ...READER],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_requests_services_revise = defineRpc({
  id: "requests.services.revise",
  title: "Revise a service: freeze its next revision",
  about:
    "The owner's service (INVALID_INPUT `service is unavailable` otherwise), still at `expected_revision` (INVALID_INPUT " +
    "`service revision changed`: it is never overwritten, and the caller reads it again) and active (INVALID_INPUT " +
    "`service is inactive`), gets its next revision row with the new terms and the owner's Safe, and its `revision` moves " +
    "on, through `revise`. Every earlier revision row is kept unchanged. It moves no money.",
  was: [`${R}/operations/revise.ts:10`, `${R}/writes.ts:146`, `${ASIS}:180`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "mutation",
  who: "The service's owner; with `org`, a member whose Safe wears the Organization's Invoicing hat.",
  input: Schema.Struct({ org: Org, offer_id: S, expected_revision: N, terms: ServiceTerms }),
  output: ServiceView,
  errors: WRITE_ERRORS,
  reads: [table_services, table_service_revisions, ...WRITER],
  writes: [table_services, table_service_revisions],
  drives: [machine_service.t.revise],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_requests_services_deactivate = defineRpc({
  id: "requests.services.deactivate",
  title: "Deactivate a service: stop selling it",
  about:
    "The owner's service at `expected_revision` (INVALID_INPUT when it was revised since) stops selling through " +
    "`deactivate`; its revision does not change, and it reports the revision it stopped at. One already inactive is " +
    "returned as it is, and nothing is written or sent. It moves no money.",
  was: [`${R}/operations/deactivate.ts:10`, `${R}/writes.ts:160`, `${ASIS}:216`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "mutation",
  who: "The service's owner; with `org`, a member whose Safe wears the Organization's Invoicing hat.",
  input: Schema.Struct({ org: Org, offer_id: S, expected_revision: N }),
  output: ServiceView,
  errors: WRITE_ERRORS,
  reads: [table_services, table_service_revisions, ...WRITER],
  writes: [table_services],
  drives: [machine_service.t.deactivate],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
