// CLI delivery and the skeleton's smaller findings: judgments beside components.cli.
import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { component_backend, component_cli, component_core_sdk, component_devnet, component_site_service } from "./foundation.ts";

const source = "m1-g5-findings, 11 November 2026; spikes/skeleton/FINDINGS.md, Smaller findings; docs/mission/findings.md, swarmD retro item 8; docs/mission/research-2026-11-11.md, What exit g5 still lacks";

export const decision_components_cli_stdout_drain = defineDecision({
  id: "components.cli-stdout-drain",
  title: "The CLI drains stdout before it exits",
  question: "When may a CLI process exit after printing a response?",
  options: [
    { label: "drain", text: "Finish stdout writes before exiting. Set the exit code and allow normal termination, or await write completion; never call process.exit immediately after console.log." },
    { label: "immediate", text: "Exit as soon as the response has been queued, even when stdout is a pipe." },
  ],
  chosen: "drain",
  why:
    "The spike's doc types response was 65 KB: process.exit straight after console.log truncated piped output at 64 KB. " +
    "Checkable claim: a successful CLI --json response larger than 65,536 UTF-8 bytes reaches a piped consumer completely and parses as one JSON value. " +
    "Run a seeded doc types response of that size through a pipe to a deliberately slow reader; require CLI exit 0, JSON.parse success, " +
    "and deep equality with the expected full response (including its final item), not merely a parseable prefix. This is a design claim, not evidence of a run. " +
    "Smaller findings inventory and landings: (1) pipe writes split and immediate exit truncates at 64 KB -> components.cli-stdout-drain (this decision); " +
    "the earlier docs/mission/findings.md swarmD retro item 8, 'the CLI drains stdout before exiting', lands here too. " +
    "(2) macOS bash 3.2 mis-parses escaped quotes inside nested command substitution -> components.cli-shell-portability. " +
    "(3) bench progress uses carriage returns on the answer's line -> components.cli-bench-output. " +
    "(4) bench execute disguises a function exception as NameError -> components.cli-bench-output. " +
    "(5) default-world initialization overwrote test chain/Core environment endpoints -> components.cli-explicit-endpoints. " +
    "docs/mission/findings.md has no Smaller findings heading; its matching stdout lesson is reconciled above, not treated as a second requirement.",
  source,
  affects: [component_cli],
});

export const decision_components_cli_shell_portability = defineDecision({
  id: "components.cli-shell-portability",
  title: "CLI driving scripts work with macOS bash 3.2",
  question: "May CLI driving scripts assume a newer shell than macOS ships?",
  options: [
    { label: "portable", text: "Support bash 3.2: put values in variables instead of escaped quotes inside nested $(...) within double quotes." },
    { label: "new-shell", text: "Require users and test runners to install a newer bash." },
  ],
  chosen: "portable",
  why:
    "Smaller finding 2: macOS bash 3.2 mis-parsed that nested quoting in run.sh. Keep argument construction simple. " +
    "Check: run a CLI-driving fixture under bash 3.2 with spaces and quoted JSON arguments; the child receives exactly the intended argument values.",
  source,
  affects: [component_cli, component_devnet],
});

export const decision_components_cli_bench_output = defineDecision({
  id: "components.cli-bench-output",
  title: "Bench adapters separate answers from progress and preserve root errors",
  question: "How does the bench adapter interpret progress and misleading exception output?",
  options: [
    { label: "preserve", text: "On success take the answer after the last carriage-return progress segment. On failure preserve the original traceback above bench execute's fallback NameError for diagnosis; do not mistake it for a missing module." },
    { label: "last-line", text: "Treat the last line as the complete answer or root cause in every case." },
  ],
  chosen: "preserve",
  why:
    "Smaller findings 3 and 4: search indexing prints progress with carriage returns on the answer's line; bench execute retries a failed call as an expression, " +
    "masking the original exception with NameError. Check fixtures: progress followed by a JSON answer yields that exact parsed answer; " +
    "an original function exception followed by NameError remains a failure with the original cause available in operator diagnostics. " +
    "Progress and tracebacks must not contaminate CLI JSON, and diagnostics still obey secret redaction.",
  source,
  affects: [component_cli, component_site_service],
});

export const decision_components_cli_explicit_endpoints = defineDecision({
  id: "components.cli-explicit-endpoints",
  title: "Default-world setup preserves explicit test endpoints",
  question: "May default-world initialization replace explicit chain and Core endpoints?",
  options: [
    { label: "preserve", text: "Keep explicitly supplied environment endpoints for the default world. Defaults fill only missing values; initialization must not silently redirect a test to another Core or chain." },
    { label: "overwrite", text: "Always replace endpoints with the default world's stored configuration." },
  ],
  chosen: "preserve",
  why:
    "Smaller finding 5: the scripts supplied their own chain and Core via environment variables, but main.ts overwrote them and sent a test org to the real Core. " +
    "This preserves explicit endpoints within the selected default world; it does not change world selection precedence. " +
    "Check: configure different stored default endpoints and environment test endpoints, run a default-world command, " +
    "and observe calls only at the supplied test chain/Core, with zero requests at the stored endpoints.",
  source,
  affects: [component_cli, component_devnet],
});

export const decision_components_cli_traceparent = defineDecision({
  id: "components.cli-traceparent",
  title: "One W3C trace from a CLI command through the SDK to Core",
  question: "How does a CLI command's trace reach Core, and what is refused when a caller names a bad one?",
  options: [
    { label: "traceparent", text: "The SDK's access, sites and document clients take an optional traceparent option and send it as the W3C traceparent header on every request; the CLI makes one per command, or takes CAPXUL_TRACEPARENT from a harness." },
    { label: "server-only", text: "Send no trace from the caller; Core mints one per request, so a command's calls and a harness's run cannot be joined." },
  ],
  chosen: "traceparent",
  why:
    "spn:<operation> claims need the caller's spans and Core's rpc span in one trace, and the eval harness's cli() gives every call a fresh traceparent " +
    "(docs/spec/30-capxul-evals.md). Shape: a traceparent is W3C version 00, '00-<trace-id>-<parent-id>-<flags>', with a 32 lowercase hex trace id and a " +
    "16 lowercase hex parent id, neither all zeros; its trace id is the one trace format every component keeps. " +
    "SDK: createAccessClient, createSitesClient and createDocumentClient take traceparent?: string; without it no header is sent; " +
    "a malformed value is refused INVALID_INPUT when the client is made, before any request. newTraceparent, isTraceparent and traceIdOf are exported. " +
    "CLI: each command that calls Core (org site provision, doc, report) uses one traceparent for all its requests: CAPXUL_TRACEPARENT when set and " +
    "non-empty, otherwise a new one. An empty CAPXUL_TRACEPARENT is unset. A malformed non-empty value is refused CLI_USAGE (exit 2), only on a path " +
    "about to send, so world, record and --help never read it. " +
    "Check: with a stub Core, each client sends exactly the given header, none without one, and refuses each malformed form (all-zero ids, uppercase, " +
    "version 01) with INVALID_INPUT and zero requests; the CLI with CAPXUL_TRACEPARENT= behaves as unset and with a malformed value exits 2 only on a sending path.",
  source: "Integrator review of PR130, 13 November 2026; docs/spec/30-capxul-evals.md cli(); docs/mission/findings.md, the traceparent finding",
  affects: [component_cli, component_core_sdk, component_backend],
});
