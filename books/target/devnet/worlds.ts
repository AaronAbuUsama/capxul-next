// The eval worlds: every named devnet snapshot a designed concept's refusal (`given`) or acceptance
// line starts from, what it holds, and the builder script that makes it (decision devnet.worlds).
//
// A world is one supervisor snapshot of the chain, Postgres (every schema, with the durable
// workflows' state), Ponder's checkpoint, the clock (its now and mode), the armed fault switches and
// the eval machine's CLI home, saved together under its name. The supervisor's world builder
// (`capxul-devnet world build [<name>…]`, in packages/devnet) makes each one the same way: restore
// `from` (or boot a fresh devnet at the eval epoch when `from` is null), run `steps` in order, then
// `dev snapshot save <name> --replace`. It builds on a frozen clock, so a world's every time is a
// function of its steps (decision devnet.deterministic-worlds): before each step it warps one second,
// so each step happens at its own instant, and after each step it settles, so the next starts from a
// world where everything the last caused has run; a warp step is a barrier of its own. Sessions run
// on the one clock (a person's for 30 days), so after a warp step that ends a session the builder
// signs in again, by the sink's code, every person whose session it ended, and the current person
// stays current (decision devnet.sessions-across-warps); the worlds that warp past 30 days say so. A
// step is a black-box action: a `capxul` command, a Core SDK method of a surface with no command
// (the web onboarding, the operator's waitlist tool), or a supervisor control (a fault switch, a
// chain action no Capxul surface makes). Steps never write a table: sign-in codes come from the mail
// sink and every signature from `dev approve` with the person's dev signer. A `sameAs` world is the
// same snapshot saved under a second name. Worlds are rebuilt in dependency order whenever the
// backend code changes, since a world saved with other code refuses to restore (WRONG_STATE).
//
// These are plain exports, not records (recordsOf keeps only records). `worldGaps` checks a book's
// refusals against the catalog; the supervisor reads WORLDS to build.

/** One builder step: who takes it and what it runs. */
export interface WorldStep {
  /** A fixed devnet identity's email; `operator` (the operator's tool and key); `anyone` (any devnet command); `supervisor`. */
  readonly as: string;
  readonly run: string;
}

export interface World {
  readonly name: string;
  /** What the snapshot holds, as its refusals and claims rely on it. */
  readonly holds: string;
  /** The world it is built from; null for a fresh `capxul-devnet up`. */
  readonly from: string | null;
  readonly steps: readonly WorldStep[];
  /** Saved once and listed under both names: the two names hold one state. */
  readonly sameAs?: string;
  /** The concepts whose refusals or acceptance lines name it. */
  readonly namedBy: readonly string[];
  /** Environment variables every command an eval runs in this world gets (devnet.beta-world-by-variable). */
  readonly env?: Readonly<Record<string, string>>;
}

// ── step helpers ────────────────────────────────────────────────────────────────────────────

const step = (as: string, run: string): WorldStep => ({ as, run });
const anyone = (run: string) => step("anyone", run);
const supervisor = (run: string) => step("supervisor", run);

/** Sign in by the emailed code, read back from the mail sink. */
const signIn = (email: string) =>
  step(email, `capxul auth login ${email}; capxul auth verify <the code \`capxul dev mail list --to ${email}\` shows>`);
/** The whole way to a set-up Safe, as person-ready is built: sign in, join, admitted, profile, Safe. */
const ready = (email: string, name: string) =>
  step(
    email,
    `as person-ready: sign in; \`capxul waitlist join\`; the operator admits ${email}; the web onboarding's profile ` +
      `(display name ${name}); \`client.account.setup\` with the dev signer, until CapxulSafeClaimed`,
  );
/** After a warp that ended sessions: everyone whose session it ended signs in again (devnet.sessions-across-warps). */
const signInAgain = () =>
  anyone("the builder signs in again, by the sink's code and in sign-in order, every person whose session that warp ended; the current person stays current");
/** Sign the open approval of `what` as `email`, with their dev signer. */
const approve = (email: string, what: string) => anyone(`capxul dev approve --as ${email} <${what}>`);
/**
 * Found an Organization and finish its setup. Every catalogued Organization but org-with-fde starts with no Forward
 * Deployed Engineer (`--no-fde`), so each world holds what it held before the FDE ruling (organizations.startup-worlds).
 */
const found = (email: string, handle: string, name: string) => [
  step(email, `capxul org create --name "${name}" --handle ${handle} --country GB --no-fde --confirm --json`),
  approve(email, `${handle}'s install approval`),
  step(email, `capxul org wait ${handle}`),
];
const current = (email: string) => step(email, `capxul auth switch ${email}`);
const fault = (switchAndMode: string) => supervisor(`capxul-devnet fault ${switchAndMode}`);
/** A Board change at a threshold of two: proposed, then approved by both Directors. */
const board = (proposer: string, command: string) => [
  step(proposer, `${command} --json`),
  approve("dana@acme.test", "its Board proposal, as Director"),
  approve("eli@acme.test", "its Board proposal, as Director"),
];

// ── the catalog ─────────────────────────────────────────────────────────────────────────────

export const WORLDS: readonly World[] = [
  // ── the machine and one person (access, accounts) ──
  {
    name: "empty-devnet",
    holds: "Protocol v4 deployed by Companies House from packages/contracts, with the general escrow (payments.escrow-contract-build), Ponder at the head, no principal, no mail, a fresh CLI home, the clock frozen at the eval epoch and unmoved.",
    from: null,
    steps: [supervisor("capxul-devnet up --start-at <the eval epoch> --frozen (fresh)")],
    namedBy: ["access", "devnet", "applications"],
  },
  { name: "signed-out", holds: "No session on this machine: the state of empty-devnet.", from: "empty-devnet", steps: [], sameAs: "empty-devnet", namedBy: ["accounts", "organizations", "books", "banking", "payments", "requests", "devnet", "agents", "documents", "activity", "payroll"] },
  { name: "cli-signed-out", holds: "No sign-in: the state of empty-devnet, under budgets' name.", from: "empty-devnet", steps: [], sameAs: "empty-devnet", namedBy: ["budgets", "board"] },
  {
    name: "cli-on-beta-environment",
    holds: "empty-devnet, with every command run under CAPXUL_ENV=beta, a deployment this machine does not have: every command that needs the network is refused CAPABILITY_UNAVAILABLE before a network call.",
    from: "empty-devnet",
    steps: [],
    env: { CAPXUL_ENV: "beta" },
    namedBy: ["budgets", "devnet"],
  },
  {
    name: "person-signed-in",
    holds: "Dana (dana@acme.test) signed in and current; not on the waitlist, not admitted, no Safe.",
    from: "empty-devnet",
    steps: [signIn("dana@acme.test")],
    namedBy: ["access", "accounts", "devnet", "applications"],
  },
  {
    name: "person-without-account",
    holds: "Signed in with no admitted account, Party Safe or payment yet: the state of person-signed-in, under payments' name.",
    from: "person-signed-in",
    steps: [],
    sameAs: "person-signed-in",
    namedBy: ["payments"],
  },
  {
    name: "two-people-signed-in",
    holds: "Dana and Sam (sam@acme.test) signed in on this machine, Dana current.",
    from: "person-signed-in",
    steps: [signIn("sam@acme.test"), current("dana@acme.test")],
    namedBy: ["access", "activity"],
  },
  {
    name: "person-on-waitlist",
    holds: "Dana signed in and on the waitlist, waiting, in the devnet's closed beta.",
    from: "person-signed-in",
    steps: [step("dana@acme.test", 'capxul waitlist join --note "Payroll for Acme"')],
    namedBy: ["accounts", "organizations"],
  },
  {
    name: "person-on-waitlist-open-beta",
    holds: "person-on-waitlist with the deployment's `beta-access` gate on for everyone (rollout 100), never admitted.",
    from: "person-on-waitlist",
    steps: [
      supervisor("capxul-devnet gates seed beta-access on --rollout 100 (the PostHog fake's person gate, which `dev gates set` cannot script)"),
      anyone("capxul dev jobs run (its gates sync brings the seeded gate into access' flags)"),
    ],
    namedBy: ["accounts"],
  },
  {
    name: "person-admitted-no-profile",
    holds: "Dana admitted by the operator, with no profile yet.",
    from: "person-on-waitlist",
    steps: [step("operator", "the operator's waitlist tool admits dana@acme.test (client.operator.waitlist.admit, the devnet's operator key)")],
    namedBy: ["accounts"],
  },
  {
    name: "person-unclaimed",
    holds: "Dana admitted with her profile done and three invites, her Safe not set up.",
    from: "person-admitted-no-profile",
    steps: [step("dana@acme.test", "the web onboarding's profile step through the Core SDK: display name Dana Reyes, country GB")],
    namedBy: ["accounts", "organizations", "agents", "activity"],
  },
  {
    name: "person-admitted-no-invites",
    holds: "person-unclaimed with all three referral invites spent.",
    from: "person-unclaimed",
    steps: ["ana", "bo", "cy"].map((n) => step("dana@acme.test", `capxul referral invite ${n}@friends.test`)),
    namedBy: ["accounts"],
  },
  {
    name: "two-people-admitted",
    holds: "Dana and Sam admitted with profiles, neither Safe set up; Dana signed in and current.",
    from: "person-unclaimed",
    steps: [
      signIn("sam@acme.test"),
      step("sam@acme.test", "capxul waitlist join"),
      step("operator", "the operator's waitlist tool admits sam@acme.test"),
      step("sam@acme.test", "the web onboarding's profile step: display name Sam Okafor"),
      current("dana@acme.test"),
    ],
    namedBy: ["accounts"],
  },
  {
    name: "person-ready",
    holds: "Dana admitted, profile done, her Safe claimed by Companies House with her dev signer; no Organization, no money.",
    from: "person-unclaimed",
    steps: [step("dana@acme.test", "client.account.setup through the Core SDK with her dev signer, until CapxulSafeClaimed is indexed")],
    namedBy: ["accounts", "organizations", "banking", "activity"],
  },
  {
    name: "setup-refused-other-signer",
    holds: "person-ready, then a setup restarted with a second signer, which the claim refuses (SwapRefused).",
    from: "person-ready",
    steps: [step("dana@acme.test", "client.account.setup with a second dev signer for the same email; the claim reverts SwapRefused")],
    namedBy: ["accounts"],
  },
  {
    name: "setup-refused-non-ascii-email",
    holds: "A person whose mailbox's local part is not ASCII, admitted, whose Safe claim the chain refused (EmailNotNormalized).",
    from: "empty-devnet",
    steps: [
      signIn("jöran@acme.test"),
      step("jöran@acme.test", "capxul waitlist join"),
      step("operator", "the operator's waitlist tool admits jöran@acme.test"),
      step("jöran@acme.test", "the web onboarding's profile; client.account.setup, whose claim reverts EmailNotNormalized"),
    ],
    namedBy: ["accounts"],
  },

  // ── one person's money (payments) ──
  {
    name: "person-with-funded-safe",
    holds: "Dana ready with 1,000 USDC in her Safe and current; Sam ready with a live Safe; nobody@outside.test has no account.",
    from: "person-ready",
    steps: [ready("sam@acme.test", "Sam Okafor"), current("dana@acme.test"), step("dana@acme.test", "capxul dev fund 1000 --asset USDC")],
    namedBy: ["payments", "activity"],
  },
  {
    name: "person-with-empty-safe",
    holds: "Dana ready and current with no USDC, and one payment to Sam whose approval expired unsigned.",
    from: "person-ready",
    steps: [
      step("dana@acme.test", "capxul payment send sam@acme.test 5 --json (its approval left unsigned)"),
      anyone("capxul dev time warp 2h (past the sponsorship window)"),
    ],
    namedBy: ["payments", "activity"],
  },
  {
    name: "person-with-payment-history",
    holds:
      "person-with-funded-safe plus: a settled payment Dana sent Sam, a scheduled personal dated payment, a payment whose " +
      "approval expired, one Dana received from Sam, and a payment between Lee and Max that Dana is no party to.",
    from: "person-with-funded-safe",
    steps: [
      step("dana@acme.test", "capxul payment send sam@acme.test 25 --json"),
      approve("dana@acme.test", "that payment's approval"),
      step("dana@acme.test", "capxul payment send sam@acme.test 10 --on <a date 30 days ahead> --json"),
      approve("dana@acme.test", "that dated payment's approval"),
      step("dana@acme.test", "capxul payment send sam@acme.test 5 --json (left unsigned)"),
      step("sam@acme.test", "capxul dev fund 100; capxul payment send dana@acme.test 15 --json"),
      approve("sam@acme.test", "that payment's approval"),
      ready("lee@acme.test", "Lee Park"),
      ready("max@acme.test", "Max Ito"),
      step("lee@acme.test", "capxul dev fund 50; capxul payment send max@acme.test 7 --json"),
      approve("lee@acme.test", "that payment's approval"),
      anyone("capxul dev time warp 2h (the unsigned approval expires)"),
      current("dana@acme.test"),
    ],
    namedBy: ["payments", "devnet"],
  },
  {
    name: "person-with-money-waiting",
    holds:
      "person-with-funded-safe plus 5 USDC Dana sent nobody@outside.test, waiting in a claim escrow her Safe sent and " +
      "the mailbox's derived Safe owns (the Payment `escrowed`, its `money-waiting` email sent); that money admitted the mailbox, which never joined the " +
      "waitlist, to the closed beta (`escrow:<the Payment>`), with no `beta-welcome`; nobody@outside.test signed in " +
      "and current, with no profile and no Safe set up.",
    from: "person-with-funded-safe",
    steps: [
      step("dana@acme.test", "capxul payment send nobody@outside.test 5 --json"),
      approve("dana@acme.test", "that payment's approval (its funding is indexed: `escrowed`, and the mailbox admitted)"),
      signIn("nobody@outside.test"),
    ],
    namedBy: ["accounts"],
  },
  {
    name: "person-ready-money-waiting",
    holds:
      "person-with-money-waiting after nobody@outside.test set up her Safe and declined, at setup, the collection of " +
      "what waited for her: her Safe set up and claimed, the 5 USDC Dana sent still in its claim escrow, which her Safe " +
      "owns (the Payment `escrowed`); Dana may still take it back; nobody@outside.test current " +
      "(accounts.collect-any-time).",
    from: "person-with-money-waiting",
    steps: [
      step(
        "nobody@outside.test",
        "the web onboarding's profile (display name Nob Body); `client.account.setup` with the dev signer, until " +
          "CapxulSafeClaimed, declining the waiting money's collection approval on its page",
      ),
    ],
    namedBy: ["accounts"],
  },

  // ── Organizations' setup, members and invitations (organizations) ──
  {
    name: "org-awaiting-founder",
    holds: "Dana's Organization Acme minted, its install batch waiting for her signature.",
    from: "person-ready",
    steps: [step("dana@acme.test", 'capxul org create --name "Acme Ltd" --handle acme --country GB --no-fde --confirm --json (approval left unsigned)')],
    namedBy: ["organizations"],
  },
  {
    name: "org-two-unfinished-setups",
    holds: "org-awaiting-founder plus a second unfinished setup, Globex, also waiting for Dana.",
    from: "org-awaiting-founder",
    steps: [step("dana@acme.test", 'capxul org create --name "Globex" --handle globex --country GB --no-fde --confirm --json (left unsigned)')],
    namedBy: ["organizations"],
  },
  {
    name: "org-setup-stalled",
    holds: "org-awaiting-founder after the install approval expired unsigned.",
    from: "org-awaiting-founder",
    steps: [anyone("capxul dev time warp 2h")],
    namedBy: ["organizations"],
  },
  {
    name: "org-setup-stalled-unsent",
    holds: "A setup that stopped before Companies House's mint was sent; nothing of it is on chain.",
    from: "person-ready",
    steps: [
      fault("service-signer refuse-send"),
      step("dana@acme.test", 'capxul org create --name "Acme Ltd" --handle acme --country GB --no-fde --confirm --json'),
      fault("service-signer clear"),
    ],
    namedBy: ["organizations"],
  },
  {
    name: "org-setup-failed",
    holds: "A setup that failed for good: one of its steps read an answer that did not decode (PROVIDER_RESPONSE_INVALID).",
    from: "person-ready",
    steps: [
      fault("chain-rpc garbage-answers"),
      step("dana@acme.test", 'capxul org create --name "Acme Ltd" --handle acme --country GB --no-fde --confirm --json'),
      fault("chain-rpc clear"),
    ],
    namedBy: ["organizations"],
  },
  {
    name: "org-ready",
    holds: "Acme ready: Dana its founder, its one Director, wearing the Books, Invoicing and People hats; signed in and current.",
    from: "org-awaiting-founder",
    steps: [approve("dana@acme.test", "acme's install approval"), step("dana@acme.test", "capxul org wait acme")],
    namedBy: ["organizations", "devnet"],
  },
  {
    name: "org-with-fde",
    holds:
      "Acme ready as in org-ready, but started with its hosted Forward Deployed Engineer (aaron.fde-hosted): @acme-fde, " +
      "an agent Acme owns, created by Dana's one install signature (`AgentOwner.create` from the company Safe) with a " +
      "key the stand-in FDE host made and keeps (none on this machine), seated `organization` outside the ten seats, " +
      "its Party active, wearing no hat; its hosting running on the stand-in host in its start-up month, paid through " +
      "one calendar month after the setup was ready, at the deployment's FDE_HOSTING_PRICE of 20 USDC; its `fde-ready` " +
      "email sent to Dana; Dana current.",
    from: "person-ready",
    steps: [
      step("dana@acme.test", 'capxul org create --name "Acme Ltd" --handle acme --country GB --confirm --json (with its FDE: no `--no-fde`)'),
      approve("dana@acme.test", "acme's install approval, whose batch also creates the FDE with the stand-in host's key"),
      step("dana@acme.test", "capxul org wait acme"),
    ],
    namedBy: ["organizations", "agents"],
  },
  {
    name: "org-with-fde-paused",
    holds:
      "org-with-fde 32 days on, one to four days after its start-up month (a calendar month) ran out unpaid: the hosting " +
      "fell due seven days before its end and paused at it on the stand-in host; @acme-fde's Safe, Seat and agent row are as before. Every person whose session " +
      "the warp ended signed in again; Dana current.",
    from: "org-with-fde",
    steps: [anyone("capxul dev time warp 32d"), signInAgain()],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-fde-allowance",
    holds:
      "org-with-fde plus Acme funded with 10,000 USDC, a USDC top budget `running-costs` of 1,000 a month (the Board's, " +
      "no holder), a spending allowance `capxul` of 500 USDC a month under it assigned to Dana, who also wears the People " +
      "hat, and the USDC payout ceiling 12,000 a year: what `org fde pay` and `org seats buy` spend from " +
      "(organizations.buy-seats, organizations.fde-hosting); Dana current.",
    from: "org-with-fde",
    steps: [
      step("dana@acme.test", "capxul dev fund 10000 --asset USDC --org acme"),
      step("dana@acme.test", "capxul org department create running-costs --budget 1000/month --org acme --json"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
      step("dana@acme.test", "capxul org allowance create --input capxul.json --assign-to dana@acme.test --org acme (500 USDC a month under running-costs; no per-payment cap, which has no v4 form)"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
      step("dana@acme.test", "capxul org department ceiling set USDC 12000/year --org acme --json"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
    ],
    namedBy: ["organizations", "payments"],
  },
  {
    name: "org-with-fde-allowance-paused",
    holds:
      "org-with-fde-allowance 32 days on: the start-up month ran out unpaid, so the FDE's hosting fell due and paused on " +
      "the stand-in host, while `capxul` keeps its 500 USDC for the new month; every person whose session the warp " +
      "ended signed in again; Dana current (payments.fde-hosting-purchase).",
    from: "org-with-fde-allowance",
    steps: [anyone("capxul dev time warp 32d"), signInAgain()],
    namedBy: ["payments"],
  },
  {
    name: "org-with-prices-unset",
    holds:
      "org-with-fde-allowance with the backend restarted under the deployment settings SEAT_PRICE and FDE_HOSTING_PRICE " +
      "unset: nothing can be bought from Capxul (FEATURE_NOT_AVAILABLE); Dana current.",
    from: "org-with-fde-allowance",
    steps: [supervisor("capxul-devnet setting SEAT_PRICE --unset; capxul-devnet setting FDE_HOSTING_PRICE --unset (the backend restarts with them)")],
    namedBy: ["payments"],
  },
  {
    name: "org-with-closed-running-costs",
    holds: "org-with-fde-allowance with `running-costs`, the budget above `capxul`, closed by Board proposal; Dana current.",
    from: "org-with-fde-allowance",
    steps: [
      step("dana@acme.test", "capxul org department close running-costs --org acme --json"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
    ],
    namedBy: ["payments"],
  },
  {
    name: "org-with-short-company-safe",
    holds:
      "org-with-fde-allowance after a Board payment of 9,995 USDC out of Acme's company Safe, which leaves it 5 USDC while " +
      "`capxul` keeps its room; Dana current.",
    from: "org-with-fde-allowance",
    steps: [
      step("dana@acme.test", "capxul payment send olga@outside.test 9995 --org acme --as-directors --json"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
    ],
    namedBy: ["payments"],
  },
  {
    name: "org-with-fde-host-down",
    holds: "org-with-fde with the stand-in FDE host's fault switch down: every call to it fails as an unreachable host (PROVIDER_ERROR).",
    from: "org-with-fde",
    steps: [fault("fde-host down")],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-member",
    holds: "org-ready plus Sam's Seat with no hat, and Olga (olga@outside.test) ready and outside Acme; Dana current.",
    from: "org-ready",
    steps: [
      ready("sam@acme.test", "Sam Okafor"),
      ready("olga@outside.test", "Olga Berg"),
      step("dana@acme.test", "capxul org member invite sam@acme.test --org acme --json"),
      step("sam@acme.test", "capxul invite accept <sam's invitation>"),
      current("dana@acme.test"),
    ],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-projects",
    holds:
      "org-with-member plus Acme's projects (projects.worlds), all made by Dana unless said: Execution's rates 40 " +
      "costing and 90 billing, Research disabled; projects Website (External, customer Olga, shared with Sam, open), " +
      "Retainer (on hold), Handover (completed with no tasks, worked out by hand) and Archive (cancelled), in that order; " +
      "Website's tasks Design (working, due in 7 days), Build (open, depending on Design, due in 14), Launch (a group) " +
      "with its open child Announce, and Spec (completed); Old, a task of no project, cancelled; Sam's submitted " +
      "timesheet of 2 billable Execution hours on Design, his cancelled one and his draft with one Execution log on " +
      "Design; Dana's own draft with no log; Dana's timesheet for Sam on Website, 3 billable Execution hours on no " +
      "task, submitted and billed to Olga by `org timesheet bill`. Dana current.",
    from: "org-with-member",
    steps: [
      step("dana@acme.test", "capxul org activity-type change Execution --costing-rate 40 --billing-rate 90 --org acme"),
      step("dana@acme.test", "capxul org activity-type disable Research --org acme"),
      step("dana@acme.test", "capxul org project create Website --type External --customer olga@outside.test --org acme --json; then `org project member add <Website> sam@acme.test`"),
      step("dana@acme.test", "capxul org project create Retainer --org acme; then `org project hold <Retainer>`"),
      step("dana@acme.test", "capxul org project create Handover --org acme; then `org project complete <Handover>`"),
      step("dana@acme.test", "capxul org project create Archive --org acme; then `org project cancel <Archive>`"),
      step(
        "dana@acme.test",
        "capxul org task create Design --project <Website> --end <the eval day + 7>; `org task create Build --project <Website> " +
          "--depends-on <Design> --end <+14>`; `org task create Launch --project <Website> --group`; `org task create Announce " +
          "--parent <Launch>`; `org task create Spec --project <Website>`; `org task complete <Spec>`",
      ),
      step("dana@acme.test", "capxul org task create Old --org acme; then `org task cancel <Old>`"),
      step(
        "sam@acme.test",
        "capxul org timesheet create --project <Website> --org acme; `org timesheet log <it> --activity Execution --start " +
          "<the day before, 09:00> --hours 2 --task <Design> --billable`; `org timesheet submit <it>` (Design becomes working)",
      ),
      step("sam@acme.test", "capxul org timesheet create --project <Website> --org acme; then `org timesheet cancel <it>`"),
      step(
        "sam@acme.test",
        "capxul org timesheet create --project <Website> --org acme; then `org timesheet log <it> --activity Execution " +
          "--start <the eval day, 09:00> --end <the eval day, 11:00> --task <Design>` (left a draft)",
      ),
      step("dana@acme.test", "capxul org timesheet create --org acme (her own draft, no log)"),
      step(
        "dana@acme.test",
        "capxul org timesheet create --for sam@acme.test --project <Website> --org acme; `org timesheet log <it> --activity " +
          "Execution --start <two days before, 09:00> --hours 3 --billable`; `org timesheet submit <it>`; `org timesheet " +
          "bill <it> --to olga@outside.test --org acme`",
      ),
    ],
    namedBy: ["projects", "requests"],
  },
  {
    name: "org-with-projects-chain-unreachable",
    holds: "org-with-projects with chain-rpc's fault switch failing every read, so no hat can be read live (projects.hat-guard).",
    from: "org-with-projects",
    steps: [fault("chain-rpc node-down")],
    namedBy: ["projects"],
  },
  {
    name: "org-with-head-site",
    holds:
      "org-with-member plus a stand-in Frappe site for Acme (devnet.head-stand-in), hosted as on Frappe Cloud, up and " +
      "not connected: its URL, its head user's key file and its team's token file are the ones `capxul-devnet head up` " +
      "printed; Acme has no head; Dana current.",
    from: "org-with-member",
    steps: [supervisor("capxul-devnet head up acme --frappe-cloud --json (its site URL, and the key file and team token file it wrote)")],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-head",
    holds:
      "org-with-head-site with the stand-in site connected as Acme's Frappe Cloud head by Dana: connected, the members " +
      "pushed as Users, every fundamental app's sync running, and its host able to install an app Acme wants; Dana current.",
    from: "org-with-head-site",
    steps: [
      step(
        "dana@acme.test",
        "capxul org head connect <the stand-in site's URL> --org acme --host frappe-cloud --key-file <the key file head up wrote> --team-token-file <the team token file it wrote> --confirm --json",
      ),
    ],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-head-site-down",
    holds: "org-with-head-site with the stand-in site's fault switch down: it answers no call (PROVIDER_ERROR); still not connected.",
    from: "org-with-head-site",
    steps: [fault("frappe-head down")],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-agent-member",
    holds: "org-with-member plus Ledger (@ledger), an agent Dana owns, holding a Seat with its own key.",
    from: "org-with-member",
    steps: [
      step("dana@acme.test", "capxul agent create Ledger --key env --json"),
      approve("dana@acme.test", "the agent's approval"),
      step("dana@acme.test", "capxul org member invite @ledger --agent --org acme"),
      step("@ledger", "capxul invite accept <ledger's invitation> (with CAPXUL_PRIVATE_KEY)"),
    ],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-removed-agent",
    holds: "org-with-agent-member after Dana removed Ledger: AgentRemoved ended its Seat.",
    from: "org-with-agent-member",
    steps: [step("dana@acme.test", "capxul agent remove @ledger --json"), approve("dana@acme.test", "the removal's approval")],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-allowance",
    holds:
      "org-with-member plus Acme funded with 10,000 USDC, a USDC top budget `running-costs` of 1,000 a month (the " +
      "Board's, no holder), a spending allowance `office` of 500 USDC a month under it assigned to Sam, and the USDC " +
      "payout ceiling 12,000 a year (no per-payment cap, which has no v4 form).",
    from: "org-with-member",
    steps: [
      step("dana@acme.test", "capxul dev fund 10000 --asset USDC --org acme"),
      step("dana@acme.test", "capxul org department create running-costs --budget 1000/month --org acme --json"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
      step("dana@acme.test", "capxul org allowance create --input office.json --assign-to sam@acme.test --org acme (500 USDC a month under running-costs)"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
      step("dana@acme.test", "capxul org department ceiling set USDC 12000/year --org acme --json"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
    ],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-uncapped-allowance",
    holds:
      "org-with-allowance under a second name: on v4 no allowance has a per-payment cap, so Sam's `office` is uncapped " +
      "(its 500 a month under `running-costs` is its only limit).",
    from: "org-with-allowance",
    steps: [],
    sameAs: "org-with-allowance",
    namedBy: ["organizations"],
  },
  {
    name: "org-with-pending-invitation",
    holds: "org-ready plus a Seat-only invitation to Lee (lee@acme.test), pending; Lee and Sam ready and signed in, Dana current.",
    from: "org-ready",
    steps: [
      ready("lee@acme.test", "Lee Park"),
      ready("sam@acme.test", "Sam Okafor"),
      step("dana@acme.test", "capxul org member invite lee@acme.test --org acme --json"),
      current("dana@acme.test"),
    ],
    namedBy: ["organizations", "banking", "devnet"],
  },
  {
    name: "org-with-granted-invitation",
    holds: "org-ready plus an invitation to Lee offering the Books hat, whose Board proposal executed: the hat minted, the offer pending.",
    from: "org-ready",
    steps: [
      ready("lee@acme.test", "Lee Park"),
      step("dana@acme.test", "capxul org member invite lee@acme.test --permission manage-books --org acme --json"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
      current("dana@acme.test"),
    ],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-authorizing-invitation",
    holds: "org-ready plus an invitation to Lee offering the Books hat, its Board proposal open and unsigned.",
    from: "org-ready",
    steps: [
      ready("lee@acme.test", "Lee Park"),
      step("dana@acme.test", "capxul org member invite lee@acme.test --permission manage-books --org acme --json (proposal left open)"),
      current("dana@acme.test"),
    ],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-rejected-grant-proposal",
    holds: "org-with-authorizing-invitation after Dana rejected the grant's Board proposal.",
    from: "org-with-authorizing-invitation",
    steps: [step("dana@acme.test", "capxul org proposal reject <the grant's proposal>")],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-accepted-invitation",
    holds: "org-with-pending-invitation after Lee accepted: Lee holds a Seat.",
    from: "org-with-pending-invitation",
    steps: [step("lee@acme.test", "capxul invite accept <lee's invitation>"), current("dana@acme.test")],
    namedBy: ["organizations"],
  },
  {
    name: "org-with-expired-invitation",
    holds: "org-with-pending-invitation after the clocks moved past the invitation's expiry: the invitation expired.",
    from: "org-with-pending-invitation",
    steps: [anyone("capxul dev time warp 8d (past the expiry; the invitation's process ends it)")],
    namedBy: ["organizations", "banking", "devnet"],
  },
  {
    name: "two-founders",
    holds: "org-ready plus Sam's own ready Organization Globex; neither founder is in the other's; Dana current.",
    from: "org-ready",
    steps: [ready("sam@acme.test", "Sam Okafor"), ...found("sam@acme.test", "globex", "Globex"), current("dana@acme.test")],
    namedBy: ["organizations"],
  },

  // ── the budget tree (budgets), and the worlds built on it (payments, payroll, requests) ──
  {
    name: "org-with-budget-tree",
    holds:
      "Acme with Directors Dana and Eli (2 of 2), the People hat on Pat, members Mia, Sam, Lead and Plat, outsider Olga " +
      "signed in and current; USDC top budget `company` 1,200,000 a year (Board) with `engineering` 800,000 (Lead), its " +
      "teams `platform` 300,000 (Plat) and `hiring` 100,000 closed, and `operations` 300,000 with the team chain " +
      "`ops-1`…`ops-7` eight deep; top budget `monthly-spend` 10,000 a month with allowance `office-costs` 2,000 a month " +
      "worn by Mia, 600 spent; the USDC payout ceiling 1,200,000 a year; EURC admitted with no budget; DAI not admitted.",
    from: "empty-devnet",
    steps: [
      ...["dana", "eli", "pat", "mia", "sam", "lead", "plat"].map((n) => ready(`${n}@acme.test`, n)),
      ready("olga@outside.test", "Olga Berg"),
      ...found("dana@acme.test", "acme", "Acme Ltd"),
      step("dana@acme.test", "capxul dev fund 1500000 --asset USDC --org acme"),
      ...["eli", "pat", "mia", "sam", "lead", "plat"].map((n) =>
        step("dana@acme.test", `capxul org member invite ${n}@acme.test --org acme; then ${n} runs \`capxul invite accept\``),
      ),
      step("dana@acme.test", "capxul org board director add eli@acme.test --org acme; capxul org board threshold 2 --org acme"),
      ...board("dana@acme.test", "capxul org member grant pat@acme.test --permission manage-people --org acme"),
      ...board("dana@acme.test", "capxul org department create company --budget 1200000/year --org acme"),
      ...board("dana@acme.test", "capxul org department create engineering --parent company --budget 800000/year --holder lead@acme.test"),
      step("lead@acme.test", "capxul org department create platform --parent engineering --budget 300000/year --holder plat@acme.test; same for hiring 100000/year"),
      approve("lead@acme.test", "each team's approval, as engineering's holder"),
      step("lead@acme.test", "capxul org department close hiring"),
      approve("lead@acme.test", "the close"),
      ...board("dana@acme.test", "capxul org department create operations --parent company --budget 300000/year, then ops-1 … ops-7 each under the last"),
      ...board("dana@acme.test", "capxul org department create monthly-spend --budget 10000/month --org acme"),
      ...board("dana@acme.test", "capxul org allowance create --input office-costs.json --assign-to mia@acme.test (2,000 USDC a month under monthly-spend)"),
      ...board("dana@acme.test", "capxul org department ceiling set USDC 1200000/year --org acme"),
      step("mia@acme.test", "capxul payment send olga@outside.test 600 --org acme --from office-costs --json"),
      approve("mia@acme.test", "that payment's approval"),
      current("olga@outside.test"),
    ],
    namedBy: ["budgets"],
  },
  {
    name: "org-with-waiting-budget-changes",
    holds: "org-with-budget-tree plus Board proposals waiting for Eli: create `design`, freeze USDC, close `operations`, change `office-costs`.",
    from: "org-with-budget-tree",
    steps: [
      step("dana@acme.test", "capxul org department create design --parent company --budget 50000/year --json"),
      step("dana@acme.test", "capxul org department ceiling freeze USDC --json"),
      step("dana@acme.test", "capxul org department close operations --json"),
      step("dana@acme.test", "capxul org allowance change office-costs --amount 2500/month --json"),
      anyone("each proposal signed by Dana only: capxul dev approve --as dana@acme.test <each>"),
      current("olga@outside.test"),
    ],
    namedBy: ["budgets"],
  },
  {
    name: "org-with-ceiling-frozen-outside-capxul",
    holds: "org-with-budget-tree with the USDC payout ceiling frozen by a company Safe transaction Capxul did not propose.",
    from: "org-with-budget-tree",
    steps: [
      supervisor(
        "capxul-devnet chain safe-exec --safe <acme's company Safe> --signers dana@acme.test,eli@acme.test: Roles.setAllowance of the USDC payout allowance to zero, outside Capxul",
      ),
    ],
    namedBy: ["budgets"],
  },
  {
    name: "org-with-budget-tree-chain-unreachable",
    holds: "org-with-budget-tree with the backend's chain node failing every read (chain-rpc's fault switch).",
    from: "org-with-budget-tree",
    steps: [fault("chain-rpc node-down")],
    namedBy: ["budgets"],
  },
  {
    name: "org-with-budgets",
    holds:
      "org-with-budget-tree (two Directors, a funded company Safe, `engineering` held by Lead, `office-costs` worn by Mia, " +
      "`hiring` closed, Sam holding nothing, Olga outside and signed in) plus a proposed department `research`.",
    from: "org-with-budget-tree",
    steps: [step("dana@acme.test", "capxul org department create research --parent company --budget 40000/year --json (left waiting)"), current("olga@outside.test")],
    namedBy: ["payments", "activity"],
  },
  {
    name: "org-with-dated-payments",
    holds:
      "org-with-budgets plus a dated payment from `engineering` reserved in Budgets, a Board-scheduled dated payment, and a " +
      "lapsed `platform` payment larger than `platform` now has left.",
    from: "org-with-budgets",
    steps: [
      step("lead@acme.test", "capxul payment send olga@outside.test 5000 --org acme --from engineering --on <a date 14 days ahead> --json"),
      approve("lead@acme.test", "that payment's approval"),
      ...board("dana@acme.test", "capxul payment send olga@outside.test 20000 --org acme --as-directors --on <a date 21 days ahead>"),
      step("plat@acme.test", "capxul payment send olga@outside.test 250000 --org acme --from platform --json (left unsigned)"),
      step("plat@acme.test", "capxul payment send olga@outside.test 100000 --org acme --from platform --json"),
      approve("plat@acme.test", "the second payment's approval (platform now has less left than the first)"),
      anyone("capxul dev time warp 2h (the first approval lapses)"),
      current("olga@outside.test"),
    ],
    namedBy: ["payments"],
  },
  {
    name: "org-with-department-escrow-swapped",
    holds:
      "org-with-department plus 50 USDC `salaries` paid nobody@outside.test, waiting in a general claim escrow whose " +
      "authority is Budgets and `salaries`' budget id, after the Board swapped `salaries`' office from Lead to Plat: Lead " +
      "no longer wears the hat, Plat does, and the escrow is still open (payments.escrow-department-now); Plat current.",
    from: "org-with-department",
    steps: [
      step("lead@acme.test", "capxul org department pay salaries nobody@outside.test 50 --org acme --json"),
      approve("lead@acme.test", "that payment's approval (its funding is indexed: `escrowed`)"),
      ...board("dana@acme.test", "capxul org department holder remove salaries lead@acme.test --org acme"),
      ...board("dana@acme.test", "capxul org department holder add salaries plat@acme.test --org acme"),
      current("plat@acme.test"),
    ],
    namedBy: ["payments"],
  },
  {
    name: "org-with-department",
    holds:
      "org-with-budget-tree plus a USDC top budget `salaries` of 60,000 a month whose office hat Lead wears, and no " +
      "agreement; Sam is another member; Lead current.",
    from: "org-with-budget-tree",
    steps: [...board("dana@acme.test", "capxul org department create salaries --budget 60000/month --holder lead@acme.test --org acme"), current("lead@acme.test")],
    namedBy: ["payroll"],
  },
  {
    name: "org-with-agreements",
    holds:
      "org-with-department plus agreements from `salaries`: an open offer to Mia and one to @northwind (Olga's " +
      "Organization), an active salary to Sam of 15,000 a month with a month of pay released, a paused, an ending and an " +
      "ended one, a lapsed and a withdrawn offer, and `salaries` nearly used.",
    from: "org-with-department",
    steps: [
      ...found("olga@outside.test", "northwind", "Northwind"),
      step("lead@acme.test", "capxul org agreement offer sam@acme.test --department salaries --salary 15000/month --start <today>"),
      approve("lead@acme.test", "the offer"),
      step("sam@acme.test", "capxul agreement accept <it>"),
      approve("sam@acme.test", "the acceptance"),
      step("lead@acme.test", "three more offers to plat@, pat@ and eli@, each accepted; then pause one, end one with notice, end one now (each approved)"),
      step("lead@acme.test", "an offer to dana@ left to lapse, an offer to mia@ withdrawn, then the open offers to mia@acme.test and @northwind"),
      anyone("capxul dev time warp 31d (a month of pay released, the lapsing offer lapses, the ended agreement ends; every session ends)"),
      signInAgain(),
      step("lead@acme.test", "one more offer to mia@ sized to leave `salaries` nearly used, accepted"),
      current("lead@acme.test"),
    ],
    namedBy: ["payroll"],
  },
  {
    name: "org-with-agreements-off",
    holds: "org-with-agreements with the `payment-agreements` gate off for Acme.",
    from: "org-with-agreements",
    steps: [step("dana@acme.test", "capxul dev gates set payment-agreements off --org acme"), current("lead@acme.test")],
    namedBy: ["payroll"],
  },
  {
    name: "org-with-closed-department",
    holds: "org-with-agreements with `salaries` closed.",
    from: "org-with-agreements",
    steps: [...board("dana@acme.test", "capxul org department close salaries --org acme"), current("lead@acme.test")],
    namedBy: ["payroll"],
  },
  {
    name: "org-with-short-safe",
    holds: "org-with-agreements with the company Safe holding less than Sam's released pay.",
    from: "org-with-agreements",
    steps: [...board("dana@acme.test", "capxul payment send olga@outside.test <all but 1,000 USDC> --org acme --as-directors"), current("sam@acme.test")],
    namedBy: ["payroll"],
  },
  {
    name: "org-with-frozen-ceiling",
    holds:
      "org-with-agreements with the USDC payout ceiling frozen by a Capxul freeze that left 10,000, less than Sam's released " +
      "pay. One world for budgets' and payroll's use of the name (decision devnet.world-collisions).",
    from: "org-with-agreements",
    steps: [...board("dana@acme.test", "capxul org department ceiling freeze USDC --leave 10000 --org acme"), current("sam@acme.test")],
    namedBy: ["budgets", "payroll"],
  },
  {
    name: "org-with-writes-awaiting",
    holds: "org-with-agreements with Sam's collection and Lead's pause of another agreement each opened and unsigned.",
    from: "org-with-agreements",
    steps: [
      step("sam@acme.test", "capxul agreement collect <sam's agreement> --no-wait"),
      step("lead@acme.test", "capxul org agreement pause <plat's agreement> --no-wait"),
      current("sam@acme.test"),
    ],
    namedBy: ["payroll"],
  },

  // ── payroll's Frappe HR records and runs (payroll.command-worlds), on org-with-department ──
  {
    name: "org-with-employees",
    holds:
      "org-with-department (Directors Dana and Eli; Pat with the People hat and no office; Lead wearing `salaries`' " +
      "office hat; Sam a member with no hat; Olga outside) plus Acme's HR records, all Pat's: Employees of `salaries` " +
      "Sam Okafor (sam@acme.test, active), Noor Haddad (noor@acme.test, no account: unclaimed, active), Ana Ruiz " +
      "(ana@acme.test, no account, suspended) and Leo Brandt (leo@acme.test, no account, left on the last day of the " +
      "month he joined), each joined on the first day of the month three months back; components Basic (B, earning, " +
      "formula `base`, by payment days), Pension (PEN, deduction, `base * 0.05`) and Bonus (BON, earning, 250, " +
      "disabled); monthly USDC structures Standard (B; PEN) and Contractors (B), both submitted; Standard assigned " +
      "from each one's joining day to Sam on 4,000, Noor on 3,000 and Ana on 3,500. No run. Pat current.",
    from: "org-with-department",
    steps: [
      current("pat@acme.test"),
      step(
        "pat@acme.test",
        "capxul org employee add sam@acme.test --first-name Sam --last-name Okafor --joined <the first day of the month three months back> --department salaries --designation Engineer --org acme; " +
          "the same for noor@acme.test (Noor Haddad), ana@acme.test (Ana Ruiz) and leo@acme.test (Leo Brandt)",
      ),
      step("pat@acme.test", "capxul org employee suspend <Ana> --org acme; capxul org employee leave <Leo> --on <the last day of that month> --confirm --org acme"),
      step(
        "pat@acme.test",
        'capxul org payroll component add Basic --abbr B --type earning --formula base --payment-days --org acme; ' +
          'capxul org payroll component add Pension --abbr PEN --type deduction --formula "base * 0.05" --org acme; ' +
          "capxul org payroll component add Bonus --abbr BON --type earning --amount 250 --org acme; capxul org payroll component disable BON --org acme",
      ),
      step(
        "pat@acme.test",
        "capxul org payroll structure create Standard --frequency monthly --token USDC --earning B --deduction PEN --org acme; " +
          "capxul org payroll structure create Contractors --frequency monthly --token USDC --earning B --org acme",
      ),
      step(
        "pat@acme.test",
        "capxul org payroll structure assign <Standard> <Sam> --start <his joining day> --base 4000 --org acme; the same for Noor on 3000 and Ana on 3500",
      ),
    ],
    namedBy: ["payroll"],
  },
  {
    name: "org-with-payroll-runs",
    holds:
      "org-with-employees plus three runs of `salaries`, each with Sam's and Noor's slips: the first, for the month two " +
      "months back, submitted by Pat and paid by Lead under one approval (Sam's 3,800 net paid to his Safe; Noor's 2,850 " +
      "in a claim escrow from `salaries`, as she has no account), so it reads `paying`; the second, for last month, " +
      "submitted, with Noor's slip withheld (reason `Awaiting signed contract`); and this month's, a draft. `salaries` " +
      "has 53,350 USDC left this month. Pat current.",
    from: "org-with-employees",
    steps: [
      step("pat@acme.test", "capxul org payroll run create salaries --start <the first day of the month two months back> --end <its last day> --org acme; capxul org payroll run submit <it> --org acme"),
      step("lead@acme.test", "capxul org payroll run pay <the first run> --org acme --no-wait"),
      approve("lead@acme.test", "the first run's approval"),
      step("pat@acme.test", "capxul org payroll run create salaries --start <last month's first day> --end <its last day> --org acme; capxul org payroll run submit <it> --org acme"),
      step("pat@acme.test", 'capxul org payslip withhold <Noor\'s slip of the second run> --reason "Awaiting signed contract" --org acme'),
      step("pat@acme.test", "capxul org payroll run create salaries --start <this month's first day> --end <its last day> --org acme (left a draft)"),
      current("pat@acme.test"),
    ],
    namedBy: ["payroll"],
  },
  {
    name: "org-with-payroll-budget-used",
    holds: "org-with-payroll-runs with `salaries` spent to 1,350 USDC left this month, less than the 3,800 the second run pays; Pat current.",
    from: "org-with-payroll-runs",
    steps: [
      step("lead@acme.test", "capxul payment send olga@outside.test 52000 --org acme --from salaries --json"),
      approve("lead@acme.test", "that payment's approval"),
      current("pat@acme.test"),
    ],
    namedBy: ["payroll"],
  },
  {
    name: "org-with-payroll-short-safe",
    holds: "org-with-payroll-runs with the company Safe holding 1,000 USDC, less than the 3,800 the second run pays, while `salaries` has room; Pat current.",
    from: "org-with-payroll-runs",
    steps: [...board("dana@acme.test", "capxul payment send olga@outside.test <all but 1,000 USDC> --org acme --as-directors"), current("pat@acme.test")],
    namedBy: ["payroll"],
  },
  {
    name: "org-with-payroll-runs-chain-unreachable",
    holds: "org-with-payroll-runs with the backend's chain node failing every read (chain-rpc's fault switch); Lead current.",
    from: "org-with-payroll-runs",
    steps: [fault("chain-rpc node-down"), current("lead@acme.test")],
    namedBy: ["payroll"],
  },
  {
    name: "org-with-requests",
    holds:
      "org-with-budget-tree plus requests Acme issued (Mia wears the Invoicing hat) and received (from Olga, 1,500 USDC, " +
      "more than `office-costs` has left); Sam wears no hat.",
    from: "org-with-budget-tree",
    steps: [
      ...board("dana@acme.test", "capxul org member grant mia@acme.test --permission issue-invoices --org acme"),
      step("mia@acme.test", 'capxul request issue olga@outside.test 400 --reference "ACME-001" --org acme --confirm'),
      step("olga@outside.test", 'capxul request issue @acme 1500 --reference "OLGA-7" --confirm'),
      current("mia@acme.test"),
    ],
    namedBy: ["requests"],
  },

  // ── books ──
  {
    name: "org-without-chart",
    holds: "org-with-member with settled money in and out of Acme's Safe; Dana wears the Books hat, Sam a Seat without it, Olga outside; no chart.",
    from: "org-with-member",
    steps: [
      step("dana@acme.test", "capxul dev fund 5000 --asset USDC --org acme"),
      step("dana@acme.test", "capxul payment send olga@outside.test 250 --org acme --as-directors --json"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
      current("dana@acme.test"),
    ],
    namedBy: ["books"],
  },
  {
    name: "org-with-chart",
    holds:
      "org-without-chart after the chart import, with a row waiting in 6999 with a suggestion, an outside deposit nobody " +
      "annotated, a sub-account and an archived account.",
    from: "org-without-chart",
    steps: [
      step("dana@acme.test", "capxul org books accounts import --org acme --confirm"),
      supervisor("capxul-devnet chain transfer 75 USDC from an Anvil account to acme's company Safe (outside money)"),
      step("dana@acme.test", "capxul org books accounts add 6110 --parent 6100 --name Software --org acme; capxul org books accounts archive 6990 --org acme"),
      step("dana@acme.test", "capxul payment send olga@outside.test 40 --org acme --as-directors --json (settled, left in 6999 with a suggestion)"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
    ],
    namedBy: ["books"],
  },
  {
    name: "org-with-chart-and-added-token",
    holds: "org-with-chart plus an ERC-20 the company Safe holds, added to the books.",
    from: "org-with-chart",
    steps: [
      supervisor("capxul-devnet chain deploy-token TEST and transfer 1,000 TEST to acme's company Safe"),
      step("dana@acme.test", "capxul org books assets add <the TEST token's address> --org acme"),
    ],
    namedBy: ["books"],
  },
  {
    name: "org-with-straddling-payout",
    holds:
      "org-with-chart plus Acme KYB-approved with a registered GBP account and a USDC top budget `payouts` of 5,000 a " +
      "month Dana holds; a 100 USDC bank payout from it settled on the last day of a month and returned by the Bridge " +
      "stand-in after a warp into the next month, so the payout's Payment has a money fact in each month.",
    from: "org-with-chart",
    steps: [
      step("dana@acme.test", "capxul verify start --org acme --input kyb.json; the Bridge stand-in approves"),
      step("dana@acme.test", "capxul bank accounts add --org acme --currency GBP --input gbp-account.json"),
      step("dana@acme.test", "capxul org department create payouts --budget 5000/month --holder dana@acme.test --org acme --json"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
      anyone("capxul dev time warp --to <the last day of the current month, 12:00 UTC>"),
      step("dana@acme.test", "capxul bank pay self 100 USDC --account <the GBP account> --org acme --from payouts --json"),
      approve("dana@acme.test", "the payout's approval"),
      anyone("capxul dev time warp --to <the 2nd of the next month, 12:00 UTC>"),
      supervisor("capxul-devnet bridge return <the payout>: the stand-in posts the return and sends the refund to acme's company Safe"),
      current("dana@acme.test"),
    ],
    namedBy: ["books"],
  },
  {
    name: "org-with-chart-and-node-down",
    holds: "org-with-chart with chain-rpc's fault switch failing every read.",
    from: "org-with-chart",
    steps: [fault("chain-rpc node-down")],
    namedBy: ["books"],
  },

  // ── contacts ──
  {
    name: "person-with-contacts",
    holds:
      "Ada (ada@example.com) signed in with a book holding Bea (by handle, label `Bea`), vendor@example.com (provisional, no " +
      "label), Cy (hidden), two different Parties both labelled `Sam` and Northwind Ltd, a private company entry with no " +
      "Party; Zed in no book of Ada's; Acme, where Ada holds no " +
      "Seat, with Seats for Dan and Rex (an agent Dan owns), its book holding Dan (`manual` and `member`) and Rex (`member`).",
    from: "empty-devnet",
    steps: [
      ...["bea", "cy", "zed", "sam.one", "sam.two"].map((n) => ready(`${n}@example.com`, n)),
      ready("dan@acme.test", "Dan Cole"),
      ...found("dan@acme.test", "acme", "Acme Ltd"),
      step("dan@acme.test", "capxul agent create Rex --key env --json; approve; capxul org member invite @rex --agent --org acme; Rex accepts"),
      step("dan@acme.test", "capxul contact add dan@acme.test --org acme"),
      ready("ada@example.com", "Ada Lovell"),
      step("ada@example.com", "capxul contact add @bea --label Bea; capxul contact add vendor@example.com; capxul contact add cy@example.com; capxul contact hide cy@example.com"),
      step("ada@example.com", "capxul contact add sam.one@example.com --label Sam; capxul contact add sam.two@example.com --label Sam"),
      step("ada@example.com", 'capxul contact create "Northwind Ltd" --type company: a CRM Organization with no Party, a private `contact_` entry (contacts.private-entries)'),
      current("ada@example.com"),
    ],
    namedBy: ["contacts", "banking"],
  },
  {
    name: "org-with-crm",
    holds:
      "person-with-contacts plus Lou, a private person in Ada's book known only by +447700900123; and Acme's CRM, worked " +
      "by Dan (its People hat): in its book Globex Ltd (a private company, globex.test, Manufacturing) and Kim Park " +
      "(kim@globex.test, born from her mailbox's Party, Buyer at Globex); six leads, by last change: Ivy Stone " +
      "(ivy@umbrella.test, Umbrella Corp, owner Dan) converted into the Umbrella deal, with Ivy (from her mailbox) and " +
      "Umbrella Corp (private) as new entries; Kim's own (kim@globex.test, company `globex ltd`) Nurture; Max Doe (Max " +
      "Co) Junk, lost for Poor Fit; Jo Marsh (jo@hooli.test, Hooli) Qualified; Quinn Hale (quinn@hale.test) Contacted; " +
      "Pat Ray (pat@initech.test, Initech) New; and four deals, by last change: the Globex upsell (Lost, Pricing), the " +
      "Globex renewal (Won), the Globex pilot (Qualification, Kim primary, 5000 GBP, close 2027-03-31) and the Umbrella " +
      "deal (Qualification, Ivy primary). Rex holds its Seat with no hat; Ada holds no Seat in Acme; Dan current.",
    from: "person-with-contacts",
    steps: [
      step("ada@example.com", "capxul contact create Lou --type person --phone +447700900123"),
      current("dan@acme.test"),
      step("dan@acme.test", 'capxul contact create "Globex Ltd" --type company --website globex.test --industry Manufacturing --org acme'),
      step("dan@acme.test", 'capxul contact create "Kim Park" --type person --email kim@globex.test --designation Buyer --company <Globex> --org acme'),
      step("dan@acme.test", "capxul org crm lead create --first-name Pat --last-name Ray --email pat@initech.test --company Initech --org acme"),
      step("dan@acme.test", "capxul org crm lead create --first-name Quinn --last-name Hale --email quinn@hale.test --org acme; capxul org crm lead move <it> Contacted --org acme"),
      step("dan@acme.test", "capxul org crm lead create --first-name Jo --last-name Marsh --email jo@hooli.test --company Hooli --org acme; capxul org crm lead move <it> Qualified --org acme"),
      step("dan@acme.test", 'capxul org crm lead create --first-name Max --last-name Doe --company "Max Co" --org acme; capxul org crm lead move <it> Junk --reason "Poor Fit" --org acme'),
      step("dan@acme.test", 'capxul org crm lead create --first-name Kim --last-name Park --email kim@globex.test --company "globex ltd" --org acme; capxul org crm lead move <it> Nurture --org acme'),
      step("dan@acme.test", 'capxul org crm lead create --first-name Ivy --last-name Stone --email ivy@umbrella.test --company "Umbrella Corp" --owner dan@acme.test --org acme; capxul org crm lead convert <it> --org acme'),
      step("dan@acme.test", "capxul org crm deal create --company <Globex> --contact <Kim> --value 5000 --currency GBP --close-by 2027-03-31 --org acme (the pilot)"),
      step("dan@acme.test", "capxul org crm deal create --company <Globex> --contact <Kim> --org acme; capxul org crm deal move <it> Won --org acme (the renewal)"),
      step("dan@acme.test", 'capxul org crm deal create --company <Globex> --contact <Kim> --org acme; capxul org crm deal move <it> Lost --reason Pricing --org acme (the upsell)'),
    ],
    namedBy: ["contacts"],
  },

  // ── banking ──
  {
    name: "person-verified",
    holds: "person-ready with Dana's KYC approved by the Bridge stand-in for USD, EUR and GBP; no bank details or accounts.",
    from: "person-ready",
    steps: [step("dana@acme.test", "capxul verify start --input kyc.json; the Bridge stand-in approves; capxul verify status reads approved")],
    namedBy: ["banking"],
  },
  {
    name: "person-with-bank-details",
    holds: "person-verified plus USD and EUR bank details, EUR settling in EURC.",
    from: "person-verified",
    steps: [step("dana@acme.test", "capxul bank details --currency USD; capxul bank details --currency EUR --token EURC")],
    namedBy: ["banking"],
  },
  {
    name: "person-with-gbp-account",
    holds: "person-verified plus a registered GBP bank account and 1,000 USDC in Dana's Safe.",
    from: "person-verified",
    steps: [step("dana@acme.test", "capxul bank accounts add --currency GBP --input gbp-account.json; capxul dev fund 1000 --asset USDC")],
    namedBy: ["banking"],
  },
  {
    name: "person-with-deposits",
    holds: "person-with-bank-details plus 21 USD deposits: credited, arriving, below the minimum and returned, some matched to requests.",
    from: "person-with-bank-details",
    steps: [
      supervisor("capxul-devnet bridge deposits --to dana@acme.test --currency USD: 21 signed events (credited, arriving, below minimum, returned)"),
      step("dana@acme.test", "capxul request issue payer@outside.test 100 --confirm, twice; capxul bank match <a credited deposit> <each request>"),
    ],
    namedBy: ["banking"],
  },
  {
    name: "org-verified",
    holds:
      "Globex, KYB-approved: Fay its founding Director, Gus wearing the `office-costs` hat with 2,000 USDC left, Hal a member " +
      "with no hat, Ivy outside; a registered GBP account and USD bank details.",
    from: "empty-devnet",
    steps: [
      ...["fay", "gus", "hal", "ivy"].map((n) => ready(`${n}@globex.test`, n)),
      ...found("fay@globex.test", "globex", "Globex"),
      step("fay@globex.test", "capxul dev fund 50000 --asset USDC --org globex"),
      step("fay@globex.test", "capxul org member invite hal@globex.test --org globex; Hal accepts"),
      step("fay@globex.test", "capxul org member invite gus@globex.test --allowance office-costs:2000/month --org globex; approve; Gus accepts"),
      step("fay@globex.test", "capxul verify start --org globex --input kyb.json; the Bridge stand-in approves"),
      step("fay@globex.test", "capxul bank accounts add --org globex --currency GBP --input gbp-account.json; capxul bank details --org globex --currency USD"),
      current("fay@globex.test"),
    ],
    namedBy: ["banking"],
  },
  {
    name: "bridge-unreachable",
    holds: "person-with-bank-details with the Bridge stand-in failing every call.",
    from: "person-with-bank-details",
    steps: [fault("bridge fail-all")],
    namedBy: ["banking", "devnet"],
  },

  // ── requests ──
  {
    name: "person-with-requests",
    holds:
      "Dana issuing: an open request to Sam (on Capxul), an open escrow Invoice to billing@outside.test, a link request, and a " +
      "paid, a declined and a cancelled one; Sam ready, funded and signed in; Dana current.",
    from: "person-with-funded-safe",
    steps: [
      step("dana@acme.test", 'capxul request issue sam@acme.test 50 --reference "R-1" --confirm'),
      step("dana@acme.test", 'capxul request issue billing@outside.test 120 --reference "INV-2" --confirm'),
      step("dana@acme.test", 'capxul request issue --link 30 --reference "LINK-3" --confirm'),
      step("dana@acme.test", "three more to sam@acme.test: R-4, R-5, R-6"),
      step("sam@acme.test", "capxul dev fund 500; capxul inbox pay <R-4> --json"),
      approve("sam@acme.test", "that payment's approval"),
      step("sam@acme.test", "capxul inbox decline <R-5>"),
      step("dana@acme.test", "capxul request cancel <R-6>"),
      current("dana@acme.test"),
    ],
    namedBy: ["requests"],
  },
  {
    name: "requests-indexer-behind",
    holds: "person-with-requests with Ponder held more than the finality depth behind the chain.",
    from: "person-with-requests",
    steps: [fault("indexer hold 20 (Ponder stops 20 blocks behind; the supervisor mines 20 more)")],
    namedBy: ["requests"],
  },
  {
    name: "person-with-underfunded-safe",
    holds: "Sam signed in and current, his Safe holding 10 USDC, with Dana's open request of 50 USDC to him.",
    from: "person-ready",
    steps: [
      ready("sam@acme.test", "Sam Okafor"),
      step("sam@acme.test", "capxul dev fund 10 --asset USDC"),
      step("dana@acme.test", 'capxul request issue sam@acme.test 50 --reference "R-1" --confirm'),
      current("sam@acme.test"),
    ],
    namedBy: ["requests"],
  },
  {
    name: "person-with-services",
    holds: "person-ready plus Dana's active service at revision 2 and a deactivated one.",
    from: "person-ready",
    steps: [
      step("dana@acme.test", 'capxul service create "Logo design" 500 --confirm; capxul service revise <it> --price 600 --confirm'),
      step("dana@acme.test", 'capxul service create "Old offer" 100 --confirm; capxul service deactivate <it>'),
    ],
    namedBy: ["requests"],
  },
  {
    name: "org-with-services",
    holds: "org-with-member plus a service of Acme's (Dana wears the Invoicing hat); Sam a member without it.",
    from: "org-with-member",
    steps: [step("dana@acme.test", 'capxul service create "Bookkeeping" 300 --org acme --confirm')],
    namedBy: ["requests"],
  },
  {
    name: "person-with-credited-deposit",
    holds: "person-with-bank-details plus a credited unmatched USD deposit, an arriving one, one matched, and an open USDC request it can pay.",
    from: "person-with-bank-details",
    steps: [
      step("dana@acme.test", 'capxul request issue payer@outside.test 200 --reference "D-1" --confirm; the same for D-2'),
      supervisor("capxul-devnet bridge deposits --to dana@acme.test: 200 USD credited twice, 50 arriving"),
      step("dana@acme.test", "capxul bank match <the first credited deposit> <D-2>"),
    ],
    namedBy: ["requests", "activity"],
  },
  {
    name: "org-with-credited-deposit",
    holds: "org-verified plus the same deposits for Globex, with Hal a member without the Invoicing hat.",
    from: "org-verified",
    steps: [
      step("fay@globex.test", 'capxul request issue payer@outside.test 200 --reference "G-1" --org globex --confirm; the same for G-2'),
      supervisor("capxul-devnet bridge deposits --to globex: 200 USD credited twice, 50 arriving"),
      step("fay@globex.test", "capxul bank match <the first credited deposit> <G-2> --org globex"),
    ],
    namedBy: ["requests"],
  },

  // ── the Board (board) ──
  {
    name: "org-with-setup-awaiting-install",
    holds: "An Organization with no deployment yet: the state of org-awaiting-founder, under board's name.",
    from: "org-awaiting-founder",
    steps: [],
    sameAs: "org-awaiting-founder",
    namedBy: ["board"],
  },
  {
    name: "org-with-founder-board",
    holds:
      "org-with-member (Acme fresh from setup, Dana the one Director, 1 of 1, wearing the Shareholders' top hat; Sam set up; " +
      "Olga outside and signed in) plus Pat, a member who has not finished signing up; Dana current.",
    from: "org-with-member",
    steps: [
      signIn("pat@acme.test"),
      step("dana@acme.test", "capxul org member invite pat@acme.test --org acme --json"),
      step("pat@acme.test", "capxul invite accept <pat's invitation> (the invitation admits Pat; profile and Safe setup left unfinished)"),
      current("dana@acme.test"),
    ],
    namedBy: ["board"],
  },
  {
    name: "org-with-two-directors",
    holds: "org-with-founder-board with Sam seated as the second Director, threshold 2 of 2.",
    from: "org-with-founder-board",
    steps: [
      step("dana@acme.test", "capxul org board director add sam@acme.test --org acme --json"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
      step("sam@acme.test", "capxul org board claim --org acme"),
      current("dana@acme.test"),
    ],
    namedBy: ["board"],
  },
  {
    name: "org-with-board-change-waiting",
    holds: "org-with-founder-board with Sam's seat as Director proposed and waiting for Dana's approval.",
    from: "org-with-founder-board",
    steps: [step("dana@acme.test", "capxul org board director add sam@acme.test --org acme --json (left unsigned)")],
    namedBy: ["board"],
  },
  {
    name: "org-with-waiting-proposals",
    holds:
      "org-with-two-directors plus two proposals waiting at consecutive nonces, one executed, one rejected, one replaced " +
      "outside Capxul, a waiting rejection, Sam wearing the Books hat and a waiting Invoicing grant.",
    from: "org-with-two-directors",
    steps: [
      step("dana@acme.test", "capxul org member grant sam@acme.test --permission manage-books --org acme --json"),
      approve("dana@acme.test", "its Board proposal, as Director"),
      approve("sam@acme.test", "its Board proposal, as Director"),
      step("dana@acme.test", "capxul payment send olga@outside.test 10 --org acme --as-directors --json; approve as Dana, then reject as Sam"),
      step("dana@acme.test", "capxul payment send olga@outside.test 15 --org acme --as-directors --json (waiting at the next nonce)"),
      supervisor("capxul-devnet chain safe-exec --safe <acme's company Safe> --signers dana@acme.test,sam@acme.test: another transaction at that nonce, outside Capxul, which replaces it"),
      step("dana@acme.test", "capxul org member grant pat@acme.test --permission issue-invoices --org acme --json (waiting)"),
      step("dana@acme.test", "capxul payment send olga@outside.test 20 --org acme --as-directors --json (waiting, the next nonce)"),
      step("sam@acme.test", "capxul org proposal reject <the second waiting proposal> (Sam's rejection waits for Dana)"),
    ],
    namedBy: ["board"],
  },
  {
    name: "org-with-lapsed-director",
    holds: "org-with-two-directors with Sam's Director hat ruled out on chain while he is still an owner of the company Safe.",
    from: "org-with-two-directors",
    steps: [supervisor("capxul-devnet chain hats-status --hat <acme's Director hat> --wearer <sam's Safe> --eligible false, signed with Dana's dev signer, outside Capxul")],
    namedBy: ["board"],
  },
  {
    name: "org-with-board-handed-over",
    holds: "org-with-founder-board with equity installed and the Shareholders' top hat handed to the Governor.",
    from: "org-with-founder-board",
    steps: [
      step("dana@acme.test", "capxul org equity setup --org acme --confirm --json"),
      approve("dana@acme.test", "its Board proposal"),
      step("dana@acme.test", "capxul org board handover --org acme --json"),
      approve("dana@acme.test", "its Board proposal"),
    ],
    namedBy: ["board"],
  },
  {
    name: "org-with-proposals-gate-off",
    holds: "org-with-founder-board with the `owner-safe-proposals` gate off for Acme.",
    from: "org-with-founder-board",
    steps: [step("dana@acme.test", "capxul dev gates set owner-safe-proposals off --org acme")],
    namedBy: ["board"],
  },

  // ── agents ──
  {
    name: "person-with-agents",
    holds:
      "Dana (claimed Safe) owning @ledger (active, 312.50 USDC and 20.00 EURC), @spare (active, empty), @paused (frozen) and " +
      "@gone (removed); Sam (claimed Safe) owning @scribe; Dana current.",
    from: "person-ready",
    steps: [
      ready("sam@acme.test", "Sam Okafor"),
      current("dana@acme.test"),
      ...["Ledger", "Spare", "Paused", "Gone"].map((n) => step("dana@acme.test", `capxul agent create ${n} --key env; approve with \`dev approve --as dana@acme.test\``)),
      step("dana@acme.test", "capxul agent freeze @paused; capxul agent remove @gone (each approved as Dana)"),
      step("dana@acme.test", "capxul dev fund 400 --asset USDC; capxul dev fund 20 --asset EURC; pay @ledger 312.50 USDC and 20.00 EURC (approved)"),
      step("sam@acme.test", "capxul agent create Scribe --key env; approve as Sam"),
      current("dana@acme.test"),
    ],
    namedBy: ["agents"],
  },
  {
    name: "person-with-waiting-agent-change",
    holds: "person-with-agents with a freeze of @ledger and an unfreeze of @paused each waiting for Dana's approval, saved inside their windows.",
    from: "person-with-agents",
    steps: [step("dana@acme.test", "capxul agent freeze @ledger --no-wait; capxul agent unfreeze @paused --no-wait (both left unsigned)")],
    namedBy: ["agents"],
  },
  {
    name: "org-with-agent",
    holds: "Acme with Directors Dana and Lee (threshold 1), the `owner-safe-proposals` gate on, Max a member who is no Director, and @acme-bot, which Acme owns.",
    from: "org-ready",
    steps: [
      ready("lee@acme.test", "Lee Park"),
      ready("max@acme.test", "Max Ito"),
      step("dana@acme.test", "capxul org member invite lee@acme.test and max@acme.test --org acme; each accepts"),
      step("dana@acme.test", "capxul org board director add lee@acme.test --org acme (approved as Dana); Lee claims; threshold stays 1"),
      step("dana@acme.test", "capxul dev gates set owner-safe-proposals on --org acme"),
      step("dana@acme.test", "capxul agent create AcmeBot --handle acme-bot --org acme --key env --json; approve its Board proposal as Dana"),
      current("dana@acme.test"),
    ],
    namedBy: ["agents"],
  },

  // ── documents ──
  {
    name: "org-with-documents",
    holds:
      "Acme with Sam, who stored documents for it and was then removed, and Lee, who joined after; Olga, whom Acme paid with " +
      "a note, and her Invoice to Acme; a salary agreement's terms, offered by Hana, `people`'s holder; a submitted payroll run of the `people` department " +
      "whose salary slip for Kai (kai@acme.test, an Employee with a Safe) has its payslip stored; a receipt file on a " +
      "Payment; a Movement's Memo from an outside Transfer to Olga; Max signed in as a stranger; Nia signed in with no " +
      "Party of her own.",
    from: "org-with-allowance",
    steps: [
      step("sam@acme.test", 'capxul payment send olga@outside.test 40 --org acme --from office --note "Design review" --json; approve as Sam'),
      step("olga@outside.test", 'capxul request issue @acme 120 --reference "OLGA-INV-1" --confirm'),
      ready("hana@acme.test", "Hana Sato"),
      step("dana@acme.test", "capxul org member invite hana@acme.test --org acme; Hana accepts"),
      step("dana@acme.test", "capxul org department create people --budget 20000/month --holder hana@acme.test --org acme --json (Hana, not Dana: Dana wears the People hat, so ROLE_CONFLICT keeps her from an office)"),
      approve("dana@acme.test", "its Board proposal, as the one Director"),
      step("hana@acme.test", "capxul org agreement offer olga@outside.test --department people --salary 3000/month --start <today> --org acme; approve as Hana"),
      ready("kai@acme.test", "Kai Moreau"),
      step(
        "dana@acme.test",
        "capxul org employee add kai@acme.test --first-name Kai --last-name Moreau --joined <this month's first day> --department people --org acme; " +
          "capxul org payroll component add Basic --abbr B --type earning --amount 3000 --org acme; " +
          "capxul org payroll structure create Standard --frequency monthly --token USDC --earning B --org acme; " +
          "capxul org payroll structure assign <Standard> <Kai> --start <this month's first day> --base 3000 --org acme",
      ),
      step(
        "dana@acme.test",
        "capxul org payroll run create people --start <this month's first day> --end <its last day> --org acme; capxul org payroll run submit <it> --org acme: Kai's slip is submitted and its payslip stored (documents.payslip-kind)",
      ),
      step("dana@acme.test", "capxul activity annotate <the payment to Olga> --receipt receipt.pdf --org acme"),
      supervisor('capxul-devnet chain transfer 15 USDC to olga\'s Safe with Memo "Refund 0042" from an Anvil account'),
      step("dana@acme.test", "capxul org member revoke sam@acme.test --org acme (Sam's Seat removed; approved)"),
      ready("lee@acme.test", "Lee Park"),
      step("dana@acme.test", "capxul org member invite lee@acme.test --org acme; Lee accepts"),
      ready("max@acme.test", "Max Ito"),
      signIn("nia@acme.test"),
      current("dana@acme.test"),
    ],
    namedBy: ["documents"],
  },
  {
    name: "org-with-tampered-note",
    holds: "org-with-documents with the stored bytes of Sam's payment note altered after it was stored.",
    from: "org-with-documents",
    steps: [fault("documents tamper <the note's document hash> (rewrites its stored bytes, as corruption would)")],
    namedBy: ["documents"],
  },

  // ── applications ──
  {
    name: "people-with-keys",
    holds:
      "Dana and Sam signed in; Dana holds an active key, a key in its grace window and a revoked key, two of them made in one " +
      "millisecond; Sam one active key; one quickstart key on this machine; Dana current.",
    from: "two-people-signed-in",
    steps: [
      step("dana@acme.test", "capxul key create --name a; capxul key create --name b (one step: the frozen clock gives both one instant)"),
      step("dana@acme.test", "capxul key rotate <a> (a enters its grace window); capxul key create --name c; capxul key revoke <c>"),
      step("sam@acme.test", "capxul key create --name s"),
      anyone("capxul dev key --origin http://localhost:5173"),
      current("dana@acme.test"),
    ],
    namedBy: ["applications"],
  },
  {
    name: "person-at-key-limit",
    holds: "Dana signed in holding 20 active keys.",
    from: "person-signed-in",
    steps: [step("dana@acme.test", "capxul key create --name k1 … k20 (20 runs)")],
    namedBy: ["applications"],
  },
  {
    name: "org-with-keys",
    holds: "Acme with one key; Ivy wears its Invoicing hat, Max is a member without it, Olu is outside it; all signed in here.",
    from: "org-ready",
    steps: [
      ready("ivy@acme.test", "Ivy Moss"),
      ready("max@acme.test", "Max Ito"),
      ready("olu@outside.test", "Olu Ade"),
      step("dana@acme.test", "capxul org member invite ivy@acme.test --permission issue-invoices --org acme; approve; Ivy accepts"),
      step("dana@acme.test", "capxul org member invite max@acme.test --org acme; Max accepts"),
      step("ivy@acme.test", "capxul key create --name acme-site --org acme"),
    ],
    namedBy: ["applications"],
  },
  {
    name: "quickstart-quota-spent",
    holds: "One local origin that minted 15 quickstart keys in the last hour.",
    from: "empty-devnet",
    steps: [anyone("capxul dev key --origin http://localhost:5173 (15 runs, each in a fresh project folder)")],
    namedBy: ["applications"],
  },

  // ── activity ──
  {
    name: "person-with-activity",
    holds:
      "Dana signed in with a live Safe: Payments sent, received, to herself, settled, pending in and cancelled; outside money " +
      "in and out in USDC, USDT and WETH; one annotated row.",
    from: "person-with-funded-safe",
    steps: [
      step("dana@acme.test", "capxul payment send sam@acme.test 20 --json; approve as Dana (settled, sent)"),
      step("sam@acme.test", "capxul dev fund 100; capxul payment send dana@acme.test 30 --json; approve as Sam (received)"),
      step("dana@acme.test", "capxul payment send dana@acme.test 5 --json; approve (to herself)"),
      step("sam@acme.test", "capxul payment send dana@acme.test 12 --json (left unsigned: pending in)"),
      step("dana@acme.test", "capxul payment send sam@acme.test 8 --json; capxul payment cancel <it>"),
      supervisor("capxul-devnet chain transfer 50 USDC, 40 USDT and 0.1 WETH from Anvil accounts to dana's Safe; and 10 USDC out of it, signed with her dev signer, outside Capxul"),
      step("dana@acme.test", "capxul activity annotate <the payment to Sam> --memo \"Lunch\""),
      current("dana@acme.test"),
    ],
    namedBy: ["activity"],
  },
  {
    name: "person-with-long-payment-history",
    holds: "Dana with 151 Payments, the oldest still waiting under 150 newer ones.",
    from: "person-with-funded-safe",
    steps: [
      step("dana@acme.test", "capxul payment send sam@acme.test 1 --json (left unsigned, its window long: the oldest still waits)"),
      step("dana@acme.test", "150 × capxul payment send sam@acme.test 1 --json, each approved as Dana"),
    ],
    namedBy: ["activity"],
  },
  {
    name: "person-with-over-5000-changes",
    holds: "person-with-activity with more than 5,000 changes after a cursor the eval prints first.",
    from: "person-with-activity",
    steps: [
      step("dana@acme.test", "capxul activity events --json (the cursor the eval reads first is the one saved in the world's notes)"),
      supervisor("capxul-devnet chain transfer 5,001 transfers of 0.01 USDC from Anvil accounts to dana's Safe, in batches"),
    ],
    namedBy: ["activity"],
  },

  // ── equity (equity.worlds; devnet.equity-worlds) ──
  {
    name: "org-without-equity",
    holds:
      "Initech, a v4 company with no equity yet: founders Nia and Omar both Directors (2 of 2), Ray a member who is not a " +
      "Director, all with ready Safes; outsider Olga and investors Ivan and Jo signed in with ready, funded Safes; Nia current.",
    from: "empty-devnet",
    steps: [
      ...["nia", "omar", "ray"].map((n) => ready(`${n}@initech.test`, n)),
      ready("olga@outside.test", "Olga Berg"),
      ready("ivan@invest.test", "Ivan Petrov"),
      ready("jo@invest.test", "Jo Lind"),
      ...found("nia@initech.test", "initech", "Initech Ltd"),
      ...["omar", "ray"].map((n) =>
        step("nia@initech.test", `capxul org member invite ${n}@initech.test --org initech; then ${n} runs \`capxul invite accept\``),
      ),
      step("nia@initech.test", "capxul org board director add omar@initech.test --org initech --json"),
      approve("nia@initech.test", "its Board proposal, as the one Director"),
      step("omar@initech.test", "capxul org board claim --org initech"),
      step("nia@initech.test", "capxul org board threshold 2 --org initech --json"),
      approve("nia@initech.test", "its Board proposal, as Director"),
      ...["ivan@invest.test", "jo@invest.test"].map((e) => step(e, "capxul dev fund 50000 --asset USDC")),
      current("nia@initech.test"),
    ],
    namedBy: ["equity"],
  },
  {
    name: "org-with-equity-off",
    holds: "org-without-equity with Initech's `equity` gate turned off.",
    from: "org-without-equity",
    steps: [step("nia@initech.test", "capxul dev gates set equity off --org initech")],
    namedBy: ["equity"],
  },
  {
    name: "org-with-equity-deploy-held",
    holds: "org-without-equity with the co-founders setup begun: deployEquity sent and its receipt held by the service signer's fault switch.",
    from: "org-without-equity",
    steps: [
      fault("service-signer hold-receipt"),
      step(
        "nia@initech.test",
        "capxul org equity setup --template co-founders --authorised 10000000 --founder nia@initech.test:4000000 " +
          "--founder omar@initech.test:4000000 --pool 1000000 --org initech --json (returns while the deployment waits)",
      ),
    ],
    namedBy: ["equity"],
  },
  {
    name: "org-with-equity",
    holds:
      "org-without-equity with the co-founders template installed: Common (10,000,000 authorised), Nia and Omar 4,000,000 " +
      "each vesting 48 months with a 12-month cliff, a 1,000,000 pool, the Governor set up; Nia current.",
    from: "org-without-equity",
    steps: [
      step(
        "nia@initech.test",
        "capxul org equity setup --template co-founders --authorised 10000000 --founder nia@initech.test:4000000 " +
          "--founder omar@initech.test:4000000 --pool 1000000 --org initech --confirm --json",
      ),
      approve("nia@initech.test", "the install batch's Board proposal, as Director"),
      approve("omar@initech.test", "the install batch's Board proposal, as Director"),
      step("nia@initech.test", "capxul org wait initech (until the cap table reads Common, both founders and the pool)"),
      current("nia@initech.test"),
    ],
    namedBy: ["equity"],
  },
  {
    name: "org-with-option-offered",
    holds: "org-with-equity with an option grant of 10,000 shares offered to Ray and not yet accepted.",
    from: "org-with-equity",
    steps: [
      step("nia@initech.test", "capxul org options grant --to ray@initech.test --shares 10000 --strike 0.10 --org initech --json"),
      approve("nia@initech.test", "its Board proposal, as Director"),
      approve("omar@initech.test", "its Board proposal, as Director"),
    ],
    namedBy: ["equity"],
  },
  {
    name: "org-with-option-active",
    holds: "org-with-option-offered with Ray's grant accepted, the clock past its 12-month cliff, and 1,000 shares exercised.",
    from: "org-with-option-offered",
    steps: [
      step("ray@initech.test", "capxul shares accept <ray's grant> --json"),
      approve("ray@initech.test", "the acceptance"),
      anyone("capxul dev time warp 400d (every session ends)"),
      signInAgain(),
      step("ray@initech.test", "capxul dev fund 500 --asset USDC; capxul shares exercise <ray's grant> --shares 1000 --json"),
      approve("ray@initech.test", "the exercise"),
      current("nia@initech.test"),
    ],
    namedBy: ["equity"],
  },
  {
    name: "org-with-round-open",
    holds:
      "org-with-equity with Series Seed preferred created by an executed vote and a priced round open on it: Ivan invited " +
      "and committed, Jo invited and not committed.",
    from: "org-with-equity",
    steps: [
      step("nia@initech.test", "capxul org vote create create-class --name seed-preferred --org initech --json; cast for as Nia and Omar; capxul dev time warp past the vote's close"),
      step("nia@initech.test", "capxul org vote execute <the class vote> --org initech"),
      step("nia@initech.test", "capxul org round create --class seed-preferred --pre-money 4000000 --raise 1000000 --approved-by <the class vote> --org initech --json"),
      approve("nia@initech.test", "its Board proposal, as Director"),
      approve("omar@initech.test", "its Board proposal, as Director"),
      step("nia@initech.test", "capxul org round invite <round> --investor ivan@invest.test --amount 25000; the same for jo@invest.test --amount 15000"),
      step("ivan@invest.test", "capxul invest commit <round> --amount 25000 --json"),
      approve("ivan@invest.test", "the commitment"),
      current("nia@initech.test"),
    ],
    namedBy: ["equity"],
  },
  {
    name: "org-with-round-allocated",
    holds: "org-with-round-open with Jo committed too, the round allocated, Ivan paid and Jo not.",
    from: "org-with-round-open",
    steps: [
      step("jo@invest.test", "capxul invest commit <round> --amount 15000 --json"),
      approve("jo@invest.test", "the commitment"),
      step("nia@initech.test", "capxul org round allocate <round> --org initech --json"),
      approve("nia@initech.test", "its Board proposal, as Director"),
      approve("omar@initech.test", "its Board proposal, as Director"),
      step("ivan@invest.test", "capxul invest pay <round> --json"),
      approve("ivan@invest.test", "the payment"),
      current("nia@initech.test"),
    ],
    namedBy: ["equity"],
  },
  {
    name: "org-with-safe-round",
    holds: "org-with-equity with a post-money SAFE round open and Ivan invited, and a closed SAFE round beside it.",
    from: "org-with-equity",
    steps: [
      step("nia@initech.test", "capxul org safe create --kind post-money --cap 8000000 --raise 500000 --closes <90 days on> --terms safe.md --org initech --json; approve as Nia and Omar"),
      step("nia@initech.test", "capxul org safe close <that round> --org initech; approve as Nia and Omar"),
      step("nia@initech.test", "capxul org safe create --kind post-money --cap 10000000 --raise 750000 --closes <90 days on> --terms safe.md --org initech --json; approve as Nia and Omar"),
      step("nia@initech.test", "capxul org safe invite <the open round> --investor ivan@invest.test --amount 20000 --org initech"),
      current("nia@initech.test"),
    ],
    namedBy: ["equity"],
  },
  {
    name: "org-with-sale-offered",
    holds: "org-with-equity past the founders' cliff with Omar's sale of 100,000 shares to Olga offered and waiting for the Board, and Nia's sale of 50,000 to Ivan already approved.",
    from: "org-with-equity",
    steps: [
      anyone("capxul dev time warp 400d (every session ends)"),
      signInAgain(),
      step("nia@initech.test", "capxul shares sell --org initech --to ivan@invest.test --shares 50000 --price 0.50 --json; approve as Nia"),
      step("nia@initech.test", "capxul org equity transfer approve <nia's transfer> --org initech --json; approve as Nia and Omar"),
      step("omar@initech.test", "capxul shares sell --org initech --to olga@outside.test --shares 100000 --price 0.50 --json; approve as Omar"),
      current("nia@initech.test"),
    ],
    namedBy: ["equity"],
  },
  {
    name: "org-with-votes",
    holds:
      "org-with-equity with shareholder votes in every standing: pending, active, defeated, succeeded, executed, and one " +
      "whose proposer's approval lapsed unsigned.",
    from: "org-with-equity",
    steps: [
      step("nia@initech.test", "capxul org vote create <a matter> --org initech --json for each standing, approved as Nia; cast as Nia and Omar so they end defeated, succeeded and executed (`capxul dev time warp` past each close, then `org vote execute`)"),
      step("nia@initech.test", "capxul org vote create <a matter> --org initech --json (active: cast once, its close ahead)"),
      step("nia@initech.test", "capxul org vote create <a matter> --org initech --json (pending: its voting delay not yet passed)"),
      step("omar@initech.test", "capxul org vote create <a matter> --org initech --json, left unsigned until `capxul dev time warp` lapses its approval"),
      current("nia@initech.test"),
    ],
    namedBy: ["equity"],
  },
  {
    name: "org-with-exit-approved",
    holds: "org-with-sale-offered with an approve-sale vote for Omar's sale executed and Olga, the buyer, not yet paid.",
    from: "org-with-sale-offered",
    steps: [
      step("nia@initech.test", "capxul org vote create approve-sale --transfer <omar's transfer> --org initech --json; cast for as Nia and Omar; capxul dev time warp past its close"),
      step("nia@initech.test", "capxul org vote execute <the sale vote> --org initech"),
    ],
    namedBy: ["equity"],
  },
];

// ── the names devnet's own refusals use ─────────────────────────────────────────────────────

export const W = {
  empty: "empty-devnet",
  signedOut: "signed-out",
  signedIn: "person-signed-in",
  offDevnet: "cli-on-beta-environment",
  orgReady: "org-ready",
  history: "person-with-payment-history",
  bridgeDown: "bridge-unreachable",
  warped: "org-with-expired-invitation",
} as const;

// ── checks ──────────────────────────────────────────────────────────────────────────────────

const byName = new Map(WORLDS.map((w) => [w.name, w]));

/** Problems in the catalog itself: a duplicate name, a `from` or `sameAs` that names no world, a cycle. */
export const catalogProblems = (): string[] => {
  const out: string[] = [];
  if (byName.size !== WORLDS.length) out.push("two worlds share a name");
  for (const w of WORLDS) {
    if (w.from !== null && !byName.has(w.from)) out.push(`${w.name}: from ${w.from} is not a world`);
    if (w.sameAs && !byName.has(w.sameAs)) out.push(`${w.name}: sameAs ${w.sameAs} is not a world`);
    const seen = new Set<string>();
    for (let at: World | undefined = w; at?.from; at = byName.get(at.from)) {
      if (seen.has(at.name)) { out.push(`${w.name}: its from chain loops`); break; }
      seen.add(at.name);
    }
  }
  return out;
};

/** Every refusal's world the catalog does not hold: `given` names a world nobody builds. `?` is a gap, not a world. */
export const worldGaps = (records: readonly unknown[]): string[] =>
  (records as { _kind?: string; id?: string; refusals?: { given: string }[] }[])
    .filter((r) => r._kind === "operation")
    .flatMap((r) => (r.refusals ?? []).filter((f) => f.given !== "?" && !byName.has(f.given)).map((f) => `${r.id}: ${f.given}`));

/** The order the builder makes the worlds in: each after the world it is built from. */
export const buildOrder = (): string[] => {
  const done: string[] = [];
  const visit = (w: World) => {
    if (done.includes(w.name)) return;
    if (w.from) visit(byName.get(w.from)!);
    done.push(w.name);
  };
  WORLDS.forEach(visit);
  return done;
};
