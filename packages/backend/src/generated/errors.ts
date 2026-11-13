// Generated from blueprint by packages/generate. Do not edit. sha256:15a09b7f8c92f94d1220b4d2210fae85f23e916f1ca6c223420b0302888ab729
import { Schema } from "effect";

export class AmountBelowUse extends Schema.TaggedError<AmountBelowUse>()("AmountBelowUse", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "AMOUNT_BELOW_USE";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The new budget is below what it already uses this period. Nothing was proposed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class AuthorisedExceeded extends Schema.TaggedError<AuthorisedExceeded>()("AuthorisedExceeded", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "AUTHORISED_EXCEEDED";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "The shares asked for are more than the class authorises. Nothing was proposed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class BelowThreshold extends Schema.TaggedError<BelowThreshold>()("BelowThreshold", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "BELOW_THRESHOLD";
  static readonly class = "permission";
  static readonly actor = "person";
  static readonly message = "You hold fewer votes than the company Governor needs to propose a vote. Nothing was signed.";
  static readonly retryable = false;
  static readonly exit = 4;
}

export class Cancelled extends Schema.TaggedError<Cancelled>()("Cancelled", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "CANCELLED";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "The command stopped before it finished, or the approval was declined. Nothing was sent.";
  static readonly retryable = true;
  static readonly exit = 130;
}

export class CapabilityUnavailable extends Schema.TaggedError<CapabilityUnavailable>()("CapabilityUnavailable", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "CAPABILITY_UNAVAILABLE";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "This deployment cannot do what the request asks.";
  static readonly retryable = false;
  static readonly exit = 6;
}

export class CapacityReached extends Schema.TaggedError<CapacityReached>()("CapacityReached", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "CAPACITY_REACHED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The worlds machine has no room for another world of this profile now. Nothing was made. Park or close a world, choose the `core` profile, or wait for a run to finish.";
  static readonly retryable = true;
  static readonly exit = 6;
}

export class ChildrenExceedParent extends Schema.TaggedError<ChildrenExceedParent>()("ChildrenExceedParent", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "CHILDREN_EXCEED_PARENT";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The budget asks its parent for more than the parent has left to give. Nothing was proposed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class CliConfig extends Schema.TaggedError<CliConfig>()("CliConfig", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "CLI_CONFIG";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "The CLI configuration is not valid.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class CliDeadline extends Schema.TaggedError<CliDeadline>()("CliDeadline", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "CLI_DEADLINE";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The command stopped waiting before the work finished. The work carries on: read it again later.";
  static readonly retryable = false;
  static readonly exit = 5;
}

export class CliDefect extends Schema.TaggedError<CliDefect>()("CliDefect", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "CLI_DEFECT";
  static readonly class = "defect";
  static readonly actor = "operator";
  static readonly message = "The CLI failed unexpectedly.";
  static readonly retryable = false;
  static readonly exit = 1;
}

export class CliStorage extends Schema.TaggedError<CliStorage>()("CliStorage", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "CLI_STORAGE";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "The CLI could not read or write its local files.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class CliUsage extends Schema.TaggedError<CliUsage>()("CliUsage", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "CLI_USAGE";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "The command line is not valid.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class ConsentMissing extends Schema.TaggedError<ConsentMissing>()("ConsentMissing", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "CONSENT_MISSING";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "A share class this round affects has not consented. Nothing was signed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class DocumentHashMismatch extends Schema.TaggedError<DocumentHashMismatch>()("DocumentHashMismatch", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "DOCUMENT_HASH_MISMATCH";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The document's hash is not the one the payment was prepared for. Prepare the payment again.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class EnvironmentNotChosen extends Schema.TaggedError<EnvironmentNotChosen>()("EnvironmentNotChosen", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "ENVIRONMENT_NOT_CHOSEN";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "No environment is chosen, and this command needs one. Run `capxul use env devnet` or `capxul use env staging`.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class EventUnappliable extends Schema.TaggedError<EventUnappliable>()("EventUnappliable", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "EVENT_UNAPPLIABLE";
  static readonly class = "state";
  static readonly actor = "operator";
  static readonly message = "The site refused event {seq} for {org} after its retries, and it is set aside.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class ExperimentalNotAccepted extends Schema.TaggedError<ExperimentalNotAccepted>()("ExperimentalNotAccepted", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "EXPERIMENTAL_NOT_ACCEPTED";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "Production was chosen without accepting that it is experimental.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class FeatureNotAvailable extends Schema.TaggedError<FeatureNotAvailable>()("FeatureNotAvailable", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "FEATURE_NOT_AVAILABLE";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "This feature is not switched on for you or your Organization.";
  static readonly retryable = false;
  static readonly exit = 6;
}

export class InsufficientBalance extends Schema.TaggedError<InsufficientBalance>()("InsufficientBalance", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "INSUFFICIENT_BALANCE";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The paying Safe or budget does not hold enough money for this payment.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class InsufficientFunds extends Schema.TaggedError<InsufficientFunds>()("InsufficientFunds", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "INSUFFICIENT_FUNDS";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "Your Safe holds less of the strike token than the exercise costs. Nothing was signed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class InvalidInput extends Schema.TaggedError<InvalidInput>()("InvalidInput", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "INVALID_INPUT";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "A value in the request is not valid, or names nothing you can see.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class InvalidRecipient extends Schema.TaggedError<InvalidRecipient>()("InvalidRecipient", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "INVALID_RECIPIENT";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "The payment cannot go to this recipient: the address is zero, Payments itself or nothing at all, or a mailbox with no account that this payment cannot hold in a claim escrow for.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class NetworkError extends Schema.TaggedError<NetworkError>()("NetworkError", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "NETWORK_ERROR";
  static readonly class = "provider-unavailable";
  static readonly actor = "system";
  static readonly message = "The request did not reach Capxul, or the answer did not come back. Check your connection and try again.";
  static readonly retryable = true;
  static readonly exit = 5;
}

export class NotAuthenticated extends Schema.TaggedError<NotAuthenticated>()("NotAuthenticated", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "NOT_AUTHENTICATED";
  static readonly class = "auth";
  static readonly actor = "caller";
  static readonly message = "The request has no valid sign-in.";
  static readonly retryable = false;
  static readonly exit = 3;
}

export class NotImplemented extends Schema.TaggedError<NotImplemented>()("NotImplemented", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "NOT_IMPLEMENTED";
  static readonly class = "defect";
  static readonly actor = "operator";
  static readonly message = "This operation is not built yet in this deployment.";
  static readonly retryable = false;
  static readonly exit = 5;
}

export class NotVested extends Schema.TaggedError<NotVested>()("NotVested", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "NOT_VESTED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "You asked for more than has vested. Nothing was signed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class OtpExpired extends Schema.TaggedError<OtpExpired>()("OtpExpired", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "OTP_EXPIRED";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "The sign-in code expired.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class PayerBalanceTooLow extends Schema.TaggedError<PayerBalanceTooLow>()("PayerBalanceTooLow", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "PAYER_BALANCE_TOO_LOW";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The Organization's account holds less than this collection pays.";
  static readonly retryable = false;
  static readonly exit = 6;
}

export class PayrollBudgetExceeded extends Schema.TaggedError<PayrollBudgetExceeded>()("PayrollBudgetExceeded", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "PAYROLL_BUDGET_EXCEEDED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The payment, offer or raise needs more than the budget has left this period, or more than its payout ceiling. Nothing was signed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class PoolExceeded extends Schema.TaggedError<PoolExceeded>()("PoolExceeded", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "POOL_EXCEEDED";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "The option grant is more than the pool has left. Nothing was proposed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class ProfileNotFound extends Schema.TaggedError<ProfileNotFound>()("ProfileNotFound", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "PROFILE_NOT_FOUND";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The person has no Capxul profile yet. Run `capxul account retry` to finish setup.";
  static readonly retryable = false;
  static readonly exit = 5;
}

export class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "PROVIDER_ERROR";
  static readonly class = "provider-unavailable";
  static readonly actor = "system";
  static readonly message = "A service that Capxul uses did not complete the request. Nothing was made up.";
  static readonly retryable = true;
  static readonly exit = 5;
}

export class ProviderResponseInvalid extends Schema.TaggedError<ProviderResponseInvalid>()("ProviderResponseInvalid", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "PROVIDER_RESPONSE_INVALID";
  static readonly class = "provider-answer";
  static readonly actor = "operator";
  static readonly message = "A service answered, but Capxul could not use the answer. Do not retry: the same answer will come back.";
  static readonly retryable = false;
  static readonly exit = 5;
}

export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "RATE_LIMITED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "Too many requests arrived in a short time. Wait, then try again.";
  static readonly retryable = true;
  static readonly exit = 6;
}

export class ReservedMatter extends Schema.TaggedError<ReservedMatter>()("ReservedMatter", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "RESERVED_MATTER";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "This matter belongs to the shareholders or the Board, not to you here. Put it to a vote.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class RoleConflict extends Schema.TaggedError<RoleConflict>()("RoleConflict", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "ROLE_CONFLICT";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "One person cannot hold these two roles together.";
  static readonly retryable = false;
  static readonly exit = 6;
}

export class RolePermissionDenied extends Schema.TaggedError<RolePermissionDenied>()("RolePermissionDenied", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "ROLE_PERMISSION_DENIED";
  static readonly class = "permission";
  static readonly actor = "person";
  static readonly message = "You are not allowed to do this, so nothing was signed.";
  static readonly retryable = false;
  static readonly exit = 4;
}

export class RoundClosed extends Schema.TaggedError<RoundClosed>()("RoundClosed", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "ROUND_CLOSED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The round has closed, or its pay-by date has passed. Nothing was signed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class SeatLimitReached extends Schema.TaggedError<SeatLimitReached>()("SeatLimitReached", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "SEAT_LIMIT_REACHED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The Organization has no seat free, or already has its own agent. Nothing was written. Free a seat (cancel an offer not yet accepted, or remove an agent that takes one), buy more seats from a budget, or ask Capxul to raise the seat limit; an Organization keeps one agent of its own.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class SharesLocked extends Schema.TaggedError<SharesLocked>()("SharesLocked", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "SHARES_LOCKED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "Some of the shares you offered are still vesting. Nothing was signed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class SmartAccountMissing extends Schema.TaggedError<SmartAccountMissing>()("SmartAccountMissing", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "SMART_ACCOUNT_MISSING";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The person's own Safe is not claimed yet. Run `capxul account retry` to finish setup.";
  static readonly retryable = false;
  static readonly exit = 6;
}

export class Superseded extends Schema.TaggedError<Superseded>()("Superseded", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "SUPERSEDED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "A newer request replaced this one. Do not retry the older request.";
  static readonly retryable = false;
  static readonly exit = 6;
}

export class TokenNotBudgeted extends Schema.TaggedError<TokenNotBudgeted>()("TokenNotBudgeted", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "TOKEN_NOT_BUDGETED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "There is no budget in the token the request names. Nothing was signed.";
  static readonly retryable = false;
  static readonly exit = 6;
}

export class TokenNotSupported extends Schema.TaggedError<TokenNotSupported>()("TokenNotSupported", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "TOKEN_NOT_SUPPORTED";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "The token is not one Capxul pays in on this network. Nothing was proposed.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class TokenRequired extends Schema.TaggedError<TokenRequired>()("TokenRequired", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "TOKEN_REQUIRED";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "The budget is in more than one token, so the request must name the one it pays in. Nothing was signed.";
  static readonly retryable = false;
  static readonly exit = 6;
}

export class TransactionFailed extends Schema.TaggedError<TransactionFailed>()("TransactionFailed", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "TRANSACTION_FAILED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The chain refused the transaction, so nothing it carried happened. Read the item again before you retry.";
  static readonly retryable = false;
  static readonly exit = 5;
}

export class Unknown extends Schema.TaggedError<Unknown>()("Unknown", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "UNKNOWN";
  static readonly class = "defect";
  static readonly actor = "operator";
  static readonly message = "Something failed that Capxul did not expect. The trace id names it for support.";
  static readonly retryable = false;
  static readonly exit = 5;
}

export class VerificationRequired extends Schema.TaggedError<VerificationRequired>()("VerificationRequired", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "VERIFICATION_REQUIRED";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The person or business must be verified first. Run `capxul verify start`.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class WorkDied extends Schema.TaggedError<WorkDied>()("WorkDied", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "WORK_DIED";
  static readonly class = "defect";
  static readonly actor = "operator";
  static readonly message = "Background work for this request stopped unexpectedly. The command names the work.";
  static readonly retryable = false;
  static readonly exit = 5;
}

export class WrongEnvironment extends Schema.TaggedError<WrongEnvironment>()("WrongEnvironment", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "WRONG_ENVIRONMENT";
  static readonly class = "input";
  static readonly actor = "caller";
  static readonly message = "This command does not run in the current environment.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export class WrongState extends Schema.TaggedError<WrongState>()("WrongState", { cause: Schema.optional(Schema.Defect()) }) {
  static readonly code = "WRONG_STATE";
  static readonly class = "state";
  static readonly actor = "person";
  static readonly message = "The request is valid, but the current state does not allow it.";
  static readonly retryable = false;
  static readonly exit = 2;
}

export const Errors = { AMOUNT_BELOW_USE: AmountBelowUse, AUTHORISED_EXCEEDED: AuthorisedExceeded, BELOW_THRESHOLD: BelowThreshold, CANCELLED: Cancelled, CAPABILITY_UNAVAILABLE: CapabilityUnavailable, CAPACITY_REACHED: CapacityReached, CHILDREN_EXCEED_PARENT: ChildrenExceedParent, CLI_CONFIG: CliConfig, CLI_DEADLINE: CliDeadline, CLI_DEFECT: CliDefect, CLI_STORAGE: CliStorage, CLI_USAGE: CliUsage, CONSENT_MISSING: ConsentMissing, DOCUMENT_HASH_MISMATCH: DocumentHashMismatch, ENVIRONMENT_NOT_CHOSEN: EnvironmentNotChosen, EVENT_UNAPPLIABLE: EventUnappliable, EXPERIMENTAL_NOT_ACCEPTED: ExperimentalNotAccepted, FEATURE_NOT_AVAILABLE: FeatureNotAvailable, INSUFFICIENT_BALANCE: InsufficientBalance, INSUFFICIENT_FUNDS: InsufficientFunds, INVALID_INPUT: InvalidInput, INVALID_RECIPIENT: InvalidRecipient, NETWORK_ERROR: NetworkError, NOT_AUTHENTICATED: NotAuthenticated, NOT_IMPLEMENTED: NotImplemented, NOT_VESTED: NotVested, OTP_EXPIRED: OtpExpired, PAYER_BALANCE_TOO_LOW: PayerBalanceTooLow, PAYROLL_BUDGET_EXCEEDED: PayrollBudgetExceeded, POOL_EXCEEDED: PoolExceeded, PROFILE_NOT_FOUND: ProfileNotFound, PROVIDER_ERROR: ProviderError, PROVIDER_RESPONSE_INVALID: ProviderResponseInvalid, RATE_LIMITED: RateLimited, RESERVED_MATTER: ReservedMatter, ROLE_CONFLICT: RoleConflict, ROLE_PERMISSION_DENIED: RolePermissionDenied, ROUND_CLOSED: RoundClosed, SEAT_LIMIT_REACHED: SeatLimitReached, SHARES_LOCKED: SharesLocked, SMART_ACCOUNT_MISSING: SmartAccountMissing, SUPERSEDED: Superseded, TOKEN_NOT_BUDGETED: TokenNotBudgeted, TOKEN_NOT_SUPPORTED: TokenNotSupported, TOKEN_REQUIRED: TokenRequired, TRANSACTION_FAILED: TransactionFailed, UNKNOWN: Unknown, VERIFICATION_REQUIRED: VerificationRequired, WORK_DIED: WorkDied, WRONG_ENVIRONMENT: WrongEnvironment, WRONG_STATE: WrongState } as const;
