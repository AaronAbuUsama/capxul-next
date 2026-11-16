// The OpenTelemetry semantic conventions every producer follows, pinned (decision T8 of `telemetry-in-the-blueprint`:
// the newest version Axiom supports when the work starts, in one constant, moved only on purpose as a reviewed
// change). Every producer's resource carries `SCHEMA_URL`, so Axiom shapes what it receives by this version and not
// by its own default, which moves.
//
// 1.37.0 is the newest Axiom lists as supported (axiom.co/docs/reference/system-requirements, read 15 November 2026;
// its default is 1.33.0). OpenTelemetry has released up to 1.45.0, which Axiom does not yet support: data sent as a
// version Axiom does not support changes shape when it adds that version. Every convention the envelope uses
// (`session.id`, `deployment.environment.name`, `vcs.ref.head.revision`, `vcs.ref.head.name`,
// `cicd.pipeline.run.id`, `service.name`, and `rpc.system` and `rpc.method` on a chain read's span) is in 1.37.0.

/** The pinned version. */
export const VERSION = "1.37.0";

/** The schema URL a producer's resource carries for it. */
export const SCHEMA_URL = `https://opentelemetry.io/schemas/${VERSION}`;
