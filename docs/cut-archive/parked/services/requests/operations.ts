// Moved out of the built book by the cut, 10 November 2026, from books/target/requests/operations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_USAGE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_account_inbox_decline,
  flow_client_account_inbox_get,
  flow_client_account_inbox_pay,
  flow_client_account_requests_cancel,
  flow_client_account_requests_get,
  flow_client_account_requests_issue,
  flow_client_account_services_create,
  flow_client_account_services_deactivate,
  flow_client_account_services_revise,
  flow_client_banking_deposits_match,
} from "./flows.ts";
import { rpc_requests_inbox_list } from "./inbox.ts";
import { rpc_requests_issuing_list } from "./issuing.ts";
import { rpc_requests_services_get, rpc_requests_services_list } from "./services.ts";
import { RequestPage, RequestView, ServicePage, ServiceView } from "./shapes.ts";

export const operation_service_create = defineOperation({
  ...frozenText("service.create"),
  priority: "normal",
  implementedBy: flow_client_account_services_create,
  acceptance: [
    keep("service.create", 1, "cli: the same key and terms print the same `offerId`; the key with other terms exits INVALID_INPUT. world: one service per key."),
    keep("service.create", 2, "trace: one service_transitioned `create` per new key; a refused key sends none."),
    keep("service.create", 3, "read: `service get` shows the unit amount exactly as given; a quantity range whose totals overflow the token exits INVALID_INPUT."),
    rewrite(
      "service.create",
      4,
      "A scripted write without confirmation is refused before anything is read or written, and a terminal cancel writes nothing.",
      "cli: without `--confirm` in a script it exits CLI_USAGE. trace: no rpc is called. world: unchanged after a terminal cancel.",
    ),
  ],
  returns: ServiceView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-with-services", when: "From a script without `--confirm`, or the JSON is missing a field or has an extra one." },
    { error: error_INVALID_INPUT, given: "person-with-services", when: "The request key was used with other terms, or the quantity is outside its limits." },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-services", when: "With `--org`, your Safe does not wear the Organization's Invoicing hat." },
    NOT_SIGNED_IN,
  ],
  budget: budget("write"),
});

export const operation_service_revise = defineOperation({
  ...frozenText("service.revise"),
  priority: "normal",
  implementedBy: flow_client_account_services_revise,
  acceptance: [
    keep("service.revise", 1, "read: `service get` shows the new revision; a purchase of an earlier revision still names its own terms. world: every earlier revision row is unchanged."),
    keep("service.revise", 2, "trace: one service_transitioned `revise` per revision, with the revisions in order."),
    keep("service.revise", 3, "trace: another person's revise sends no service_transitioned. world: unchanged."),
    rewrite(
      "service.revise",
      4,
      "A revise carries exactly the expected revision given, and a revision conflict is refused once, never retried.",
      "trace: one `requests.services.revise` call with the given `expected_revision`; after a conflict, no second call. cli: INVALID_INPUT.",
    ),
  ],
  returns: ServiceView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-with-services", when: "From a script without `--confirm`." },
    { error: error_INVALID_INPUT, given: "person-with-services", when: "The service changed since `--expected-revision`, or it is deactivated." },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-services", when: "You are not the owner, or with `--org` your Safe does not wear the Invoicing hat." },
    NOT_SIGNED_IN,
  ],
  budget: PREVIEW_WRITE,
});

export const operation_service_deactivate = defineOperation({
  ...frozenText("service.deactivate"),
  priority: "normal",
  implementedBy: flow_client_account_services_deactivate,
  acceptance: [
    keep("service.deactivate", 1, "read: its checkout link reads null and `service revise` exits INVALID_INPUT. cli: a buyer at its link is refused WRONG_STATE."),
    keep("service.deactivate", 2, "cli: `revision` is the one it had; `active` is false."),
    keep("service.deactivate", 3, "trace: another person's deactivate sends no service_transitioned. world: unchanged."),
  ],
  returns: ServiceView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-with-services", when: "From a script without `--confirm`, or the revision is malformed." },
    { error: error_INVALID_INPUT, given: "person-with-services", when: "The service was revised since `--expected-revision`." },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-services", when: "You are not the owner, or with `--org` your Safe does not wear the Invoicing hat." },
    NOT_SIGNED_IN,
  ],
  budget: PREVIEW_WRITE,
});

export const operation_service_get = defineOperation({
  ...frozenText("service.get"),
  priority: "normal",
  implementedBy: rpc_requests_services_get,
  acceptance: [
    keep("service.get", 1, "read: the owner reads its service; another person's `service get` of the id exits INVALID_INPUT."),
    keep("service.get", 2, "cli: human and `--json` output name the devnet checkout path `/buy/<offerId>`. world: unchanged."),
  ],
  returns: ServiceView,
  refusals: [{ ...NOT_A_MEMBER, given: "org-with-services" }, NOT_SIGNED_IN],
  budget: budget("read"),
});

export const operation_service_list = defineOperation({
  ...frozenText("service.list"),
  priority: "normal",
  implementedBy: rpc_requests_services_list,
  acceptance: [
    keep("service.list", 1, "read: the owner's services in creation order, each at its current revision and active flag."),
    keep("service.list", 2, "read: another person's list, and the person's own list under `--org`, show none of them."),
    keep("service.list", 3, "world: the diff around a list is empty. trace: no service_transitioned."),
  ],
  returns: ServicePage,
  refusals: [{ ...NOT_A_MEMBER, given: "org-with-services" }, NOT_SIGNED_IN],
  budget: budget("read"),
});
