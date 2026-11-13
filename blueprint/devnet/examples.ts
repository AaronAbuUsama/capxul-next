// The examples of the devnet's frozen operations (`dev ...`), written as a terminal shows them: the command as typed, the
// JSON `--json` prints, the exit code. The story runs in the world named `town`, early 2026. Each refusal takes its code,
// message and exit code from its own error record (`refused`), so the build checks it against the operation.

import { DateTime } from "effect";
import {
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WORK_DIED,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { ADDRESS, CHAIN_ID, hash, ID, NORTHWIND, ok, PEOPLE, refused, uuid } from "../shared/examples.ts";

/** The schemas declare Instant as a DateTime.Utc, so an example holds one; it prints as an ISO string. */
const t = (iso: string) => DateTime.makeUnsafe(iso);
const NOW = t("2026-02-10T09:00:00Z");

/** The devnet's one clock, as the time authority answers it. */
const clock = (now: DateTime.Utc, over: Record<string, unknown> = {}) => ({
  protocol: "capxul.devnet/1.0",
  now,
  realAt: t("2026-02-10T09:00:00Z"),
  mode: "frozen",
  rate: 1,
  stopAt: null,
  realNow: t("2026-02-10T09:00:04Z"),
  version: 7,
  world: "town-1",
  moved: true,
  season: null,
  ...over,
});

const JOBS = [
  { name: "bridge-catch-up", outcome: "succeeded" },
  { name: "price-sync", outcome: "succeeded" },
  { name: "flag-sync", outcome: "succeeded" },
];

const SNAPSHOT_AFTER_S3 = {
  name: "after-s3",
  at: t("2026-02-10T09:00:00Z"),
  mode: "frozen",
  rate: 1,
  savedAt: t("2026-02-10T09:02:11Z"),
  code: "a3f9c1e",
  followers: [],
  season: null,
};

/** The approval Marcus signs: Northwind pays Brightside Cleaning 1,200 USDC. */
const approval = (state: string, signed: boolean) => ({
  approvalId: `approval_${ID.approval}`,
  url: `http://localhost:3000/approvals/approval_${ID.approval}`,
  state,
  opener: "payments",
  subjectKind: "payment",
  subjectId: ID.paymentToBrightside,
  orgId: NORTHWIND.orgId,
  summary: {
    title: "Pay Brightside Cleaning",
    from: { label: "Northwind Trading", address: ADDRESS.northwind },
    to: { label: "Brightside Cleaning" },
    amount: { asset: "USDC", value: "1200.00" },
    recipients: [{ label: "Brightside Cleaning", amount: { asset: "USDC", value: "1200.00" }, requestedOutput: null, exact: true, rail: "wallet", warning: null }],
    warnings: [],
  },
  network: { chainId: CHAIN_ID, name: "Capxul devnet", explorerUrl: "http://localhost:3000/explorer" },
  sender: ADDRESS.northwind,
  calls: [{ to: ADDRESS.brightside, value: "0", data: `0xa9059cbb${"00".repeat(36)}` }],
  nonceKey: "1",
  deadline: t("2026-02-11T09:00:00Z"),
  replacement: null,
  signer: { address: ADDRESS.marcus },
  operation: {
    userOperation: {
      sender: ADDRESS.northwind,
      nonce: "18446744073709551623",
      callData: `0x34fcd5be${"ab".repeat(32)}`,
      callGasLimit: "120000",
      verificationGasLimit: "150000",
      preVerificationGas: "60000",
      maxFeePerGas: "1500000000",
      maxPriorityFeePerGas: "1000000000",
      paymaster: ADDRESS.stranger,
      paymasterVerificationGasLimit: "40000",
      paymasterPostOpGasLimit: "30000",
      paymasterData: `0x${"cd".repeat(20)}`,
    },
    digest: hash("d1"),
    userOpHash: hash("e2"),
    validAfter: null,
    validUntil: t("2026-02-11T09:00:00Z"),
  },
  sendAfter: null,
  expiresAt: t("2026-02-11T09:00:00Z"),
  refusal: null,
  sendError: null,
  transactionHash: null,
  displacedBy: null,
  createdAt: t("2026-02-10T08:55:00Z"),
  reviewedAt: t("2026-02-10T08:58:00Z"),
  signedAt: signed ? NOW : null,
  sentAt: null,
  endedAt: null,
});

export const examples_dev_time = [
  ok("Read both clocks before a warp", "capxul dev time --json", {
    clock: clock(t("2026-02-10T09:00:00Z")),
    chain: { block: 412, at: t("2026-02-10T09:00:00Z") },
    backend: { now: t("2026-02-10T09:00:00Z") },
    indexer: { block: 412, caughtUp: true },
    followers: [{ name: "backend", version: 7, idle: true, nextDue: t("2026-02-11T00:00:00Z"), stateful: false }],
    agree: true,
  }),
  refused("On staging, which has no local devnet", "capxul dev time --env staging --json", error_WRONG_ENVIRONMENT),
];

export const examples_dev_time_warp = [
  ok("Warp six hours to the next payroll cut-off", "capxul dev time warp 6h --json", {
    from: t("2026-02-10T09:00:00Z"),
    to: t("2026-02-10T15:00:00Z"),
    moved: "6h",
    stops: 1,
    chain: { block: 419, at: t("2026-02-10T15:00:00Z") },
    backend: { now: t("2026-02-10T15:00:00Z"), jobs: JOBS, timersFired: 2 },
    indexer: { block: 419, caughtUp: true },
    clock: clock(t("2026-02-10T15:00:00Z"), { version: 8 }),
  }),
  refused("A date that is not later than the chain's time", "capxul dev time warp --to 2026-02-01 --json", error_INVALID_INPUT, {
    field: "to",
    now: t("2026-02-10T09:00:00Z"),
  }),
];

export const examples_dev_time_start_at = [
  ok("Start the story on the first of January", "capxul dev time start-at 2026-01-05 --json", {
    from: t("2026-02-10T09:00:00Z"),
    to: t("2026-01-05T09:00:00Z"),
    chain: { block: 3, at: t("2026-01-05T09:00:00Z") },
    backend: { now: t("2026-01-05T09:00:00Z") },
    clock: clock(t("2026-01-05T09:00:00Z"), { moved: true, version: 2 }),
  }),
  refused("After a warp has already moved the clocks", "capxul dev time start-at 2026-01-05 --json", error_WRONG_STATE, {
    reason: "the clocks already moved",
  }),
];

export const examples_dev_time_set = [
  ok("Run the clock at four world seconds per real second", "capxul dev time set --rate 4 --json", clock(t("2026-02-10T09:00:00Z"), { mode: "running", rate: 4, stopAt: t("2026-02-10T12:00:00Z"), version: 9 })),
  refused("A rate outside 1 to 60", "capxul dev time set --rate 90 --json", error_INVALID_INPUT, { field: "rate", range: "1 to 60" }),
  refused("A joiner of a shared world asks to set the rate", "capxul dev time set --rate 4 --json", error_ROLE_PERMISSION_DENIED),
];

export const examples_dev_snapshot_save = [
  ok("Save the world after the third step of the story", "capxul dev snapshot save after-s3 --json", SNAPSHOT_AFTER_S3),
  refused("The name is already taken", "capxul dev snapshot save after-s3 --json", error_WRONG_STATE, { name: "after-s3" }),
  refused("A name with a capital letter", "capxul dev snapshot save After_S3 --json", error_INVALID_INPUT, { field: "name" }),
];

export const examples_dev_snapshot_list = [
  ok("The snapshots on this machine, by world time", "capxul dev snapshot list --json", {
    snapshots: [
      { ...SNAPSHOT_AFTER_S3, name: "start", at: t("2026-01-05T09:00:00Z"), savedAt: t("2026-02-10T08:40:00Z") },
      SNAPSHOT_AFTER_S3,
    ],
  }),
  refused("On staging, which has no local devnet", "capxul dev snapshot list --env staging --json", error_WRONG_ENVIRONMENT),
];

export const examples_dev_snapshot_restore = [
  ok("Go back to the start of the story", "capxul dev snapshot restore start --json", {
    name: "start",
    at: t("2026-01-05T09:00:00Z"),
    chain: { at: t("2026-01-05T09:00:00Z"), block: 3 },
    backend: { now: t("2026-01-05T09:00:00Z") },
    clock: clock(t("2026-01-05T09:00:00Z"), { version: 11, world: "town-2", moved: false }),
    tookMs: 4280,
  }),
  refused("No snapshot has that name", "capxul dev snapshot restore after-s9 --json", error_INVALID_INPUT, { field: "name", known: "start, after-s3" }),
  refused("The snapshot was saved with other backend code", "capxul dev snapshot restore start --json", error_WRONG_STATE, { saved: "a3f9c1e", running: "b81d20f" }),
];

export const examples_dev_prices_set = [
  ok("Script the euro coin at 1.085 dollars from the start of February", "capxul dev prices set EURC/USD 1.085 --from 2026-02-01 --json", {
    pair: "EURC/USD",
    rate: "1.085",
    from: Date.parse("2026-02-01T00:00:00Z"),
    source: "dev prices set by hannah.okafor@northwind.test",
  }),
  refused("A pair that is not ASSET/USD", "capxul dev prices set EURC 1.085 --json", error_CLI_USAGE),
  refused("An asset Capxul does not price", "capxul dev prices set DOGE/USD 0.2 --json", error_INVALID_INPUT, { field: "pair", priced: "USDC, USDT, EURC, WETH, WBTC" }),
];

export const examples_dev_gates_set = [
  ok("Turn payment agreements on for Northwind", `capxul dev gates set payment-agreements on --org ${NORTHWIND.slug} --json`, {
    key: "payment-agreements",
    org: { handle: NORTHWIND.slug, orgId: NORTHWIND.orgId },
    on: true,
    ceiling: "on",
    effective: true,
  }),
  refused("Turn on a gate whose devnet ceiling is off", `capxul dev gates set equity on --org ${NORTHWIND.slug} --json`, error_FEATURE_NOT_AVAILABLE, { key: "equity" }),
  refused("Not signed in", `capxul dev gates set payment-agreements on --org ${NORTHWIND.slug} --json`, error_NOT_AUTHENTICATED),
];

export const examples_dev_approve = [
  ok(`Marcus signs the 1,200 USDC payment to Brightside`, `capxul dev approve approval_${ID.approval} --as ${PEOPLE.marcus.email} --json`, {
    approvalId: `approval_${ID.approval}`,
    signer: PEOPLE.marcus.email,
    status: "signed",
    approval: approval("signed", true),
  }),
  refused("The approval is no longer pending", `capxul dev approve approval_${ID.approval} --as ${PEOPLE.marcus.email} --json`, error_WRONG_STATE, { approvalId: `approval_${ID.approval}`, state: "landed" }),
  refused("The devnet was started without a browser handoff", `capxul dev approve approval_${ID.approval} --as ${PEOPLE.tomas.email} --json`, error_WRONG_ENVIRONMENT),
];

export const examples_dev_jobs_run = [
  ok("Run every backend job once, now", "capxul dev jobs run --json", { at: t("2026-02-10T09:00:00Z"), jobs: JOBS, timersFired: 3 }),
  refused("Bridge's catch-up fails, and the other jobs still ran", "capxul dev jobs run --json", error_WORK_DIED, {
    job: "bridge-catch-up",
    jobs: [
      { name: "bridge-catch-up", outcome: "failed", detail: "the stand-in failed the call" },
      { name: "price-sync", outcome: "succeeded" },
    ],
  }),
];

export const examples_dev_mail_list = [
  ok("Mail Capxul sent to Priya, newest first", `capxul dev mail list --to ${PEOPLE.priya.email} --json`, {
    to: PEOPLE.priya.email,
    mail: [
      {
        mailId: uuid(1001),
        to: PEOPLE.priya.email,
        from: "no-reply@capxul.test",
        subject: "Hannah Okafor invited you to Northwind Trading",
        template: "org-invite",
        text: "Hannah Okafor invited you to join Northwind Trading on Capxul.",
        links: ["http://localhost:3000/invites/inv_1002"],
        sentAt: t("2026-02-10T08:20:00Z"),
      },
    ],
  }),
  refused("On staging, which has no mail sink", "capxul dev mail list --env staging --json", error_WRONG_ENVIRONMENT),
];

export const examples_dev_mail_fail = [
  ok("Make the next mail to Priya fail once", `capxul dev mail fail --next 1 --to ${PEOPLE.priya.email} --json`, {
    cleared: false,
    faults: [{ to: PEOPLE.priya.email, remaining: 1 }],
  }),
  ok("Disarm every fault", "capxul dev mail fail --clear --json", { cleared: true, faults: [] }),
  refused("Arming without --next", "capxul dev mail fail --json", error_INVALID_INPUT, { field: "next", range: "1 to 100" }),
  refused("--clear with --next", "capxul dev mail fail --clear --next 2 --json", error_CLI_USAGE),
];

export const examples_dev_mail_notices = [
  ok("Watch Priya's invite notice retry", `capxul dev mail notices --to ${PEOPLE.priya.email} --template org-invite --json`, {
    to: PEOPLE.priya.email,
    template: "org-invite",
    notices: [
      {
        noticeId: uuid(1003),
        template: "org-invite",
        to: PEOPLE.priya.email,
        state: "retrying",
        attempts: 1,
        lastError: { code: "PROVIDER_ERROR", message: "The mail sink refused the write." },
        updatedAt: t("2026-02-10T08:21:00Z"),
      },
    ],
  }),
  refused("On staging, which has no mail sink", "capxul dev mail notices --env staging --json", error_WRONG_ENVIRONMENT),
];
