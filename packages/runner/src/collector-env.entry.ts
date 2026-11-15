// Entry, for a CI job's step (roadmap 4.7): finds the staging collector and mints the run's token from the shared
// state, as the runner does for itself (src/telemetry/export.ts, `collectorFound`), and hands them to the job's later
// steps through GitHub's `GITHUB_ENV` file, as OpenTelemetry's standard settings (OTEL_EXPORTER_OTLP_ENDPOINT, and
// OTEL_EXPORTER_OTLP_HEADERS with the token). The token is masked in the job's log first and never printed. With no
// collector, or a state it cannot read, it writes nothing and exits 0: the later steps then export nothing.
// Usage: node --experimental-strip-types src/collector-env.entry.ts, with GITHUB_ACTIONS and GITHUB_ENV set by GitHub,
// WORLD_OWNER naming the token's operator, and the Cloudflare key in the step's environment.
import { appendFileSync } from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Alchemist from "alchemy/Alchemist";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { collectorFound } from "./telemetry/export.ts";

const envFile = process.env["GITHUB_ENV"];

Effect.runPromise(
  collectorFound.pipe(Effect.provide(Layer.mergeAll(Alchemist.layer(), NodeServices.layer, FetchHttpClient.layer))),
).then(
  (found) => {
    if (Option.isNone(found) || envFile === undefined) {
      console.log("telemetry: no collector for this job, so its steps export nothing");
      return;
    }
    const token = Redacted.value(found.value.token);
    console.log(`::add-mask::${token}`);
    appendFileSync(
      envFile,
      `OTEL_EXPORTER_OTLP_ENDPOINT=${found.value.url}\nOTEL_EXPORTER_OTLP_HEADERS=authorization=${encodeURIComponent(`Bearer ${token}`)}\n`,
    );
    console.log(`telemetry: this job's steps export to ${found.value.url}`);
  },
  // A fixed line: what failed may hold the state store's answer, which is not for a public log.
  () => {
    console.log("telemetry: the collector could not be found, so this job's steps export nothing");
  },
);
