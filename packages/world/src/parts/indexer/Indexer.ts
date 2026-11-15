// One world's index. The Durable Object starts the Ponder container with the chain's address, answers for it, and
// stops it with SIGTERM, so Ponder lets go of its schema lock. Nothing is saved on stop: everything Ponder knows is in the world's database, and a start with the same
// schema carries on from there.
//
// A start Cloudflare refuses is tried again within INDEX_START (src/parts/containers/patience.ts), and every try is
// remembered. When the chain wakes, it asks for the index again (`resume`) without waiting on it: the start is a
// durable callback of this object, so a refused index never fails or holds up a call to the chain.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { gaveUpMessage, INDEX_START, type StartReport, startPatiently } from "../containers/patience.ts";
import { remembered, stamp } from "../containers/record.ts";
import { stopGently } from "../containers/stop.ts";
import { IndexerFailed } from "../../common/failures.ts";
import { describeFailure } from "../../common/describe.ts";
import { PONDER_PORT, Ponder } from "./Ponder.ts";
import { type Timeline, timelineOf } from "./timeline.ts";

/** Cloudflare's own stop of an idle container, put far enough out that the world's own idle stop always comes first. */
const PONDER_INACTIVITY_MS = 3600 * 1000;
/** The durable callback that starts the index again after the chain woke, and its one job. */
const RESUME = "resume";
/** Where the world's connection string is kept, apart from the record that `status` gives out. */
const DATABASE = "database";

interface Start extends StartReport {
  readonly at: string;
  /** When the start that held was asked for. */
  readonly atMs: number;
  /** How long after `atMs` Ponder's server first answered `/health` (which the start waits for), and `/ready` (as the
   * world's status is asked for). */
  readonly healthyMs: number | null;
  readonly readyMs: number | null;
  /** Where the time to ready went, from Ponder's own metrics; read once, at the first ready. */
  readonly timeline: Timeline | null;
}

export interface IndexerRecord {
  /** Where the chain is, as the index was last told; kept for the next resume. */
  readonly rpcUrl: string | null;
  /** Whether the index should be running: set by a start or a resume, cleared by a stop, so a resume that comes due
   * after a stop starts nothing. */
  readonly wanted?: boolean;
  readonly starts: ReadonlyArray<Start>;
  /** Starts that were never accepted within the index's patience, with every try. */
  readonly gaveUp?: ReadonlyArray<StartReport & { readonly at: string }>;
  /** Each stop, and whether Ponder exited on SIGTERM or had to be killed (older records do not say). */
  readonly stops: ReadonlyArray<{ readonly at: string; readonly ms: number; readonly ended?: "exited" | "killed" }>;
}

const empty: IndexerRecord = { rpcUrl: null, wanted: false, starts: [], gaveUp: [], stops: [] };

const failed =
  (step: IndexerFailed["step"]) =>
  (cause: unknown): IndexerFailed =>
    IndexerFailed.make({ step, message: describeFailure(cause) });

/** When the start that held was asked for: the last try that started the container and was not refused. */
const acceptedAt = (report: StartReport): number | undefined =>
  pipe(
    Arr.findLast(report.attempts, (attempt) => attempt.started && attempt.outcome !== "refused"),
    Option.map((attempt) => DateTime.toEpochMillis(DateTime.makeUnsafe(attempt.at))),
    Option.getOrUndefined,
  );

/** Whether one of Ponder's endpoints answered 200. */
const answered = (probed: Option.Option<{ readonly status: number; readonly body: string }>): boolean =>
  Option.isSome(probed) && probed.value.status === 200;

export default class Indexer extends Cloudflare.DurableObject<Indexer>()(
  "Indexer",
  Effect.gen(function* () {
    const ponder = yield* Ponder;
    const state = yield* Cloudflare.DurableObjectState;

    // Alchemy builds a Durable Object in two phases: this Effect binds, and the Effect it returns runs once for
    // each instance.
    // @effect-diagnostics-next-line returnEffectInGen:off
    return Effect.gen(function* () {
      const port = yield* ponder.getTcpPort(PONDER_PORT);
      const lock = yield* Semaphore.make(1);
      const record = state.storage.get<IndexerRecord>("record").pipe(Effect.map((found) => found ?? empty));
      const remember = (change: (old: IndexerRecord) => IndexerRecord) =>
        record.pipe(Effect.flatMap((old) => state.storage.put("record", change(old))));
      const running = ponder.running.pipe(Effect.mapError(failed("status")));

      /** One of Ponder's own endpoints; none while its server is not answering yet. */
      const probe = (path: string) =>
        port.fetch(HttpClientRequest.get(`http://container${path}`)).pipe(
          Effect.flatMap((response) => Effect.map(response.text, (body) => ({ status: response.status, body }))),
          Effect.option,
        );

      const begin = (rpcUrl: string) =>
        Effect.gen(function* () {
          yield* remember((old) => ({ ...old, rpcUrl, wanted: true }));
          if (yield* running) return { started: false as const };
          const database = yield* state.storage.get<string>(DATABASE);
          if (database === undefined)
            return yield* IndexerFailed.make({ step: "start", message: "the index was never told its database" });
          const began = yield* Clock.currentTimeMillis;
          // Cloudflare can accept a start and then fail the first call to the container ("no container instance")
          // or let it go within seconds, so a start holds only once Ponder's own server answers.
          const report = yield* startPatiently({
            running: ponder.running,
            start: ponder
              .start({ enableInternet: true, env: { RPC_URL: rpcUrl, DATABASE_URL: database } })
              .pipe(Effect.andThen(ponder.setInactivityTimeout(PONDER_INACTIVITY_MS))),
            ready: port.fetch(HttpClientRequest.get("http://container/health")).pipe(
              Effect.filterOrFail(
                (response) => response.status === 200,
                (response) => `Ponder's /health answered ${response.status}`,
              ),
            ),
            patience: INDEX_START,
            gaveUp: (tried) => tried,
          }).pipe(
            Effect.catch((tried) =>
              remember((old) => ({
                ...old,
                gaveUp: remembered(old.gaveUp ?? [], { at: stamp(began), ...tried }, 5),
              })).pipe(
                Effect.ignore,
                Effect.andThen(
                  Effect.fail(
                    IndexerFailed.make({ step: "start", message: gaveUpMessage("the index", INDEX_START, tried) }),
                  ),
                ),
              ),
            ),
          );
          const now = yield* Clock.currentTimeMillis;
          const atMs = acceptedAt(report) ?? now;
          const start: Start = {
            at: stamp(atMs),
            atMs,
            healthyMs: now - atMs,
            readyMs: null,
            timeline: null,
            ...report,
          };
          yield* remember((old) => ({ ...old, starts: remembered(old.starts, start) }));
          return {
            started: true as const,
            at: start.at,
            tries: Arr.length(report.attempts),
            refusals: report.refusals,
          };
        }).pipe(lock.withPermits(1));

      const onResume = yield* Alchemy.makeCallback(
        RESUME,
        () =>
          Effect.gen(function* () {
            const { rpcUrl, wanted } = yield* record;
            if (rpcUrl === null || wanted !== true) return;
            yield* begin(rpcUrl);
          }),
        { retry: { delay: "30 seconds", maxAttempts: 3 } },
      );

      /** Writes down, once each, how long after the last start Ponder first answered and was first ready. Called
       * only once Ponder answers `/health`. */
      const note = (ready: boolean) =>
        Effect.gen(function* () {
          const old = yield* record;
          const last = Arr.last(old.starts);
          if (Option.isNone(last)) return;
          const now = yield* Clock.currentTimeMillis;
          const since = now - last.value.atMs;
          const firstReady = ready && last.value.readyMs === null;
          const metrics = firstReady ? yield* probe("/metrics") : Option.none();
          const seen: Start = {
            ...last.value,
            healthyMs: last.value.healthyMs ?? since,
            readyMs: last.value.readyMs ?? (ready ? since : null),
            timeline: Option.match(metrics, {
              onNone: () => last.value.timeline,
              onSome: (got) => timelineOf(got.body, last.value.atMs, now),
            }),
          };
          if (seen.healthyMs === last.value.healthyMs && seen.readyMs === last.value.readyMs) return;
          yield* state.storage.put("record", { ...old, starts: Arr.append(Arr.dropRight(old.starts, 1), seen) });
        });

      return {
        /**
         * Starts Ponder against a chain address and the world's database (once told, kept for every later start), and
         * remembers the address for the next resume.
         */
        start: (rpcUrl: string, database?: string) =>
          (database === undefined ? Effect.void : state.storage.put(DATABASE, database)).pipe(
            Effect.andThen(begin(rpcUrl)),
          ),
        /** Asks for Ponder to be started again with what it was last started with; never waits for it. */
        resume: () =>
          Effect.gen(function* () {
            const { rpcUrl } = yield* record;
            if (rpcUrl === null) return { resuming: false as const };
            yield* remember((old) => ({ ...old, wanted: true }));
            yield* onResume.schedule(RESUME, { after: 0, payload: null });
            return { resuming: true as const };
          }).pipe(Effect.mapError(failed("start"))),
        /** Stops Ponder, after a start under way, if any, has ended; a resume asked for before it starts nothing. */
        stop: () =>
          Effect.gen(function* () {
            yield* remember((old) => ({ ...old, wanted: false }));
            yield* onResume.cancel(RESUME).pipe(Effect.mapError(failed("stop")));
            return yield* Effect.gen(function* () {
              if (!(yield* running)) return { stopped: false as const };
              const began = yield* Clock.currentTimeMillis;
              // SIGTERM, so Ponder releases its schema lock and the next start resumes at once (src/parts/containers/stop.ts).
              const { ended } = yield* stopGently({
                running: ponder.running,
                signal: (signo) => ponder.signal(signo),
                destroy: ponder.destroy(),
              }).pipe(Effect.mapError(failed("stop")));
              const stop = { at: stamp(began), ms: (yield* Clock.currentTimeMillis) - began, ended };
              yield* remember((old) => ({ ...old, stops: remembered(old.stops, stop) }));
              return { stopped: true as const, ...stop };
            }).pipe(lock.withPermits(1));
          }),
        /** Removes the container and everything this object keeps: the world is being forgotten (src/things/cluster). */
        forget: () =>
          Effect.gen(function* () {
            yield* onResume.cancel(RESUME).pipe(Effect.ignore);
            if (yield* running) yield* ponder.destroy().pipe(Effect.mapError(failed("forget")));
            yield* state.storage.deleteAlarm();
            yield* state.storage.deleteAll();
            return { forgot: true as const };
          }).pipe(lock.withPermits(1)),
        /** Whether the container is up, what Ponder says about itself, and its starts and stops. */
        status: () =>
          Effect.gen(function* () {
            const up = yield* running;
            const health = up ? yield* probe("/health") : Option.none();
            const ready = answered(health) ? yield* probe("/ready") : Option.none();
            const indexed = answered(ready) ? yield* probe("/status") : Option.none();
            if (answered(health)) yield* note(ready.pipe(answered));
            const { starts, stops, gaveUp } = yield* record;
            return {
              running: up,
              health: Option.getOrNull(Option.map(health, (probed) => probed.status)),
              ready: Option.getOrNull(Option.map(ready, (probed) => probed.status)),
              indexed: Option.getOrNull(Option.map(indexed, (probed) => probed.body)),
              starts,
              gaveUp: gaveUp ?? [],
              stops,
            };
          }),
      };
    });
  }),
) {}
