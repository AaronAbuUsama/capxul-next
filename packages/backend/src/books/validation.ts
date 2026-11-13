import { Effect, Schema } from "effect";
import type { FrappeSite } from "../plugs/door.ts";
import type { AnnotationFields } from "./annotations.ts";

const Text = Schema.String.check(Schema.isMinLength(1));
const Input = Schema.Struct({
  actor: Schema.Union([Schema.Struct({ kind: Schema.Literal("person") }),
    Schema.Struct({ kind: Schema.Literal("organization"), orgId: Text })]),
  reference: Schema.Struct({ kind: Schema.Literals(["payment", "movement"]), id: Text }),
  account: Schema.optionalKey(Text), suggest: Schema.optionalKey(Schema.String),
  newAccount: Schema.optionalKey(Schema.Struct({ name: Text, under: Text })),
  party: Schema.optionalKey(Schema.NullOr(Schema.Struct({
    type: Schema.Literals(["Customer", "Supplier", "Employee", "Shareholder"]), id: Text,
  }))),
  costCenter: Schema.optionalKey(Schema.NullOr(Text)), project: Schema.optionalKey(Schema.NullOr(Text)),
  memo: Schema.optionalKey(Schema.NullOr(Schema.String)),
  references: Schema.optionalKey(Schema.Array(Schema.Struct({
    reference_doctype: Schema.Literals(["Sales Invoice", "Purchase Invoice", "Journal Entry", "Expense Claim",
      "Employee Advance", "Payroll Entry", "Sales Order", "Purchase Order"]),
    reference_name: Text, allocated_amount: Schema.NullOr(Text),
  }))),
});
export type SaveInput = typeof Input.Type;

export function invalid(field: string): never {
  throw Object.assign(new Error(`INVALID_INPUT: ${field}`), { code: "INVALID_INPUT" });
}

export function parseInput(value: unknown): SaveInput {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) if (!(key in Input.fields)) invalid(key);
  }
  let input: SaveInput;
  try { input = Schema.decodeUnknownSync(Input)(value, { onExcessProperty: "error" }); }
  catch { return invalid("annotation fields"); }
  if (input.account && input.newAccount) invalid("account and newAccount are mutually exclusive");
  return input;
}

// The fixed personal categories are not a copy of an Organization's ERPNext chart.
const personal: Readonly<Record<string, string>> = {
  "4000": "Salary", "4100": "Freelance income", "4900": "Other income", "6000": "Rent and housing",
  "6100": "Food and groceries", "6200": "Transport", "6300": "Utilities and phone", "6400": "Health",
  "6500": "Shopping", "6600": "Travel", "6800": "Family and gifts", "1900": "Transfers between my accounts",
  "4999": "Uncategorized income", "6999": "Uncategorized expense",
};

export function personalFields(input: SaveInput): AnnotationFields {
  for (const field of ["newAccount", "party", "costCenter", "project", "references"] as const)
    if (input[field] !== undefined) invalid(`${field} is only for Organization rows`);
  if (input.account && !Object.hasOwn(personal, input.account)) invalid(`account ${input.account}`);
  return { account: input.account ? `personal_${input.account}` : null, account_number: input.account ?? null,
    party_type: null, party_id: null, cost_center: null, project: null, references: [],
    suggestion: input.suggest ?? null, memo: input.memo ?? null };
}

export function accountLabel(account: string | null, number: string | null) {
  return account ? { account, number, name: account.startsWith("personal_") ? personal[number!]! : account } : null;
}

/** The caller has authenticated a Seat. Every chart read uses that person's native assertion. */
export const organizationFields = Effect.fnUntraced(function*(input: SaveInput, provider: FrappeSite["Service"],
  identity: { orgId: string; site: string; user: string; traceId: string }, callId: string) {
  // No published directory Party -> native name binding exists. Never infer id equality.
  if (input.party || input.references?.length)
    return yield* Effect.fail(new Error("FEATURE_NOT_AVAILABLE: authoritative native Party binding is unavailable"));
  if (!input.account && !input.newAccount && (input.costCenter || input.project))
    return yield* Effect.fail(new Error("INVALID_INPUT: account required for costCenter or project"));
  const get = Effect.fnUntraced(function*(doctype: string, name: string) {
    const doc = yield* provider.doorCall({ ...identity, verb: "get", doctype, name });
    if (!("fields" in doc) || doc.doctype !== doctype || doc.name !== name)
      return yield* Effect.fail(new Error("PROVIDER_RESPONSE_INVALID: native document identity"));
    return doc;
  });
  const site = input.account || input.newAccount ? yield* provider.readSite(identity) : null;
  let account = input.account ? yield* provider.resolveAccount({ ...identity, reference: input.account }) : null;
  if (account && (account.doctype !== "Account" || !account.name || typeof account.fields.account_name !== "string" ||
      account.fields.company !== site!.company || Number(account.fields.disabled) !== 0 || Number(account.fields.is_group) !== 0))
    return yield* Effect.fail(new Error("PROVIDER_RESPONSE_INVALID: enabled ledger Account of the Company required"));
  if (["Receivable", "Payable"].includes(String(account?.fields.account_type)))
    return yield* Effect.fail(new Error("FEATURE_NOT_AVAILABLE: authoritative native Party binding is unavailable"));
  // Validate dimensions before an inline create: a bad dimension must not leave an orphan Account.
  for (const [doctype, name] of [["Cost Center", input.costCenter], ["Project", input.project]] as const) {
    if (!name) continue;
    const doc = yield* get(doctype, name);
    if (doc.fields.company !== site!.company || Number(doc.fields.disabled ?? 0) !== 0 ||
        doctype === "Cost Center" && Number(doc.fields.is_group) !== 0)
      return yield* Effect.fail(new Error(`INVALID_INPUT: ${doctype} ${name}`));
  }
  if (input.newAccount) {
    const parent = yield* get("Account", input.newAccount.under);
    if (parent.fields.company !== site!.company || Number(parent.fields.disabled) !== 0 || Number(parent.fields.is_group) !== 1)
      return yield* Effect.fail(new Error(`INVALID_INPUT: newAccount.under ${input.newAccount.under}`));
    const created = yield* provider.doorCall({ ...identity, verb: "create", doctype: "Account", callId,
      fields: { account_name: input.newAccount.name, parent_account: parent.name, company: site!.company, is_group: 0 } });
    if (!("fields" in created) || created.doctype !== "Account")
      return yield* Effect.fail(new Error("PROVIDER_RESPONSE_INVALID: created Account"));
    account = yield* provider.resolveAccount({ ...identity, reference: created.name });
    if (account.doctype !== "Account" || account.name !== created.name || typeof account.fields.account_name !== "string" ||
        account.fields.company !== site!.company || Number(account.fields.disabled) !== 0 || Number(account.fields.is_group) !== 0)
      return yield* Effect.fail(new Error("PROVIDER_RESPONSE_INVALID: created ledger Account of the Company required"));
    if (["Receivable", "Payable"].includes(String(account.fields.account_type)))
      return yield* Effect.fail(new Error("FEATURE_NOT_AVAILABLE: authoritative native Party binding is unavailable"));
  }
  return { accountName: account?.fields.account_name ?? null, fields: {
    account: account?.name ?? null, account_number: account?.fields.account_number == null ? null : String(account.fields.account_number),
    party_type: null, party_id: null, cost_center: input.costCenter ?? null, project: input.project ?? null,
    references: [], suggestion: input.suggest ?? null, memo: input.memo ?? null } satisfies AnnotationFields };
});
