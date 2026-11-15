// Core's OTLP export (roadmap 4.4): the layer Core's Worker provides once, so every span, log and metric it makes is posted
// over OTLP/HTTP JSON to `baseUrl` (the collector), under a resource naming the producer (`service.name`: "core")
// and the code's revision (`service.version`). Effect's `Otlp.layerJson` from `effect/observability`; no OpenTelemetry
// SDK.
//
// STUB. "🔨 Core exports OTLP and writes the tap" (PR #317, item 2) replaces the body; until then it exports nothing, so
// packages/core/test/otlp-export.test.ts fails.
import type * as Headers from "effect/http/Headers";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";

export interface ExportOptions {
  /** The collector's base URL: `/v1/traces`, `/v1/logs` and `/v1/metrics` are below it. */
  readonly baseUrl: string;
  /** The code's revision, the resource's `service.version`. */
  readonly revision: string;
  /** Sent with every export: the operator's platform token, for a caller outside Cloudflare. */
  readonly headers?: Headers.Input | undefined;
}

/** Provides Core's OTLP export. */
export const coreTelemetry = (_options: ExportOptions): Layer.Layer<never, never, HttpClient.HttpClient> => Layer.empty;
