# The collector (roadmap step 4.4)

Telemetry's one way in for a platform stage (`docs/design/blueprint.md`, the glossary): every producer's OTLP goes
through it to the sink. One Worker, `src/collector/worker.ts`, built on Effect's `OtlpProxy`; its handlers are
`makeCollector` (`src/collector.ts`, the interface the ✍️ author's tests in `test/collector.test.ts` hold it to).

| Call | What |
|---|---|
| `POST /v1/traces`, `/v1/logs`, `/v1/metrics` | OTLP **JSON** (`OtlpSerialization.layerJson`; protobuf answers 415, a body that does not decode 400). Every resource is stamped (below), then the body goes to Axiom's edge `eu-central-1.aws.edge.axiom.co` with the ingest key and the signal's dataset in `x-axiom-dataset` (`capxul-test-traces`, `-logs`, `-metrics`). The caller gets the sink's answer, as `OtlpProxy` returns it |
| `GET /health` | `{collector, stage}` |

**Who may call, and what is stamped.** A caller holds a **claim** signed under the stage's collector key
(`src/collector/claims.ts`): `c1.<operator>.<world or ->.<grade or ->.<expires>.<HMAC-SHA256 in hex>`. The key is an
`Alchemy.Random` of the stage (`CollectorKey-g<n>`, `PLATFORM_COLLECTOR_KEY_GENERATION`), kept in the shared state,
bound to the Worker as a secret and recorded by id as the output `collectorKeyId`, never as a value: whoever holds the
Cloudflare key reads it and signs, as with the site door's key.

- **A world's Core, by service binding.** packages/world signs the world's claim (its owner, world, grade and expiry)
  when it deploys the world and puts it in the **props of Core's binding** to the collector:
  `env: { <name>: yield* collectorBinding(stage, claim) }` (`src/door.ts`). Cloudflare hands a binding's props to the
  collector as `ctx.props`; the deployer sets them and a request on the public route has none, so only the binding
  path can carry a world's claim that way. Core itself sends nothing for it. A binding's claim must name a world
  and a grade (403 `binding-claim-refused` otherwise).
- **Anyone else, on the public route**: the Worker's workers.dev URL over HTTPS (the platform's output
  `collectorUrl`; no route, record or certificate on the zone, so CI's token needs nothing new; a name under
  `worlds.abuusama.dev` can come later): `Authorization: Bearer <claim>`, signed for the caller's
  operator, naming the world it drives when it drives one. None, or one that is not the key's, expired or malformed:
  401 `token-required`, and nothing is forwarded.

The collector then drops whatever the caller sent under the stamped keys on every resource and writes its own
(`src/collector/envelope.ts`, interim until the blueprint's envelope, #301, reaches master): `capxul.world` and the
grade under `deployment.environment.name` (`private`, `shared` or `real`) from the claim when it names them, and
`capxul.stage`, the collector's stage. So no producer can misstate where its records came from.

**Counts.** After each answer, in `waitUntil`, the collector sends what became of the request's items to the sink's
metrics dataset as OTLP metrics of its own, under OpenTelemetry's names for an exporter
(`otel.sdk.exporter.span.exported`, `.log.exported`, `.metric_data_point.exported`; a delta sum, a point for what
was kept and one for what was refused with `error.type`: the sink's status, `partial` for OTLP's partial success, or
502/504 when it was not reached), each point carrying the caller's stamp. It also logs them as one JSON line
(`collector counts`), which Workers Logs keeps and exports to Cloudflare's destination `axiom-capxul-logs`.

**Keys.** The ingest key is a Worker secret, `SINK_KEY`, set by `platform.yml` from the CI secret `AXIOM_INGEST_TEST`.
Neither the repository nor an agent's container holds it: a deploy from a container leaves the collector unable to
forward (Axiom answers 401, and the counts say so). `COLLECTOR_SINK_URL` and `COLLECTOR_DATASETS` change the sink's
base URL and the datasets' prefix, for a rehearsal.

**Cloudflare's own view.** The collector and the hub's door (packages/world) export Workers Logs and traces to the
account's Axiom destinations `axiom-capxul-logs` and `axiom-capxul-traces`: a second view of the platform, never read
by a check. Core's Worker takes the same setting once the other changes to its declaration have landed.

`records/collector/rehearsal.json`: the collector alone on `pr-col1` from an agent's container, each refusal, the
stamping on the public route and by service binding, Axiom's 401 without a key and the counts that said so; then
destroyed.
