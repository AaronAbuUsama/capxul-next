// Applications' door: the procedures other concepts invoke inside their own transaction. There are none.
//
// A procedure exists only for one money fact (P4, decision rules.procedures), and an application or a
// publishable key is not one: a key lets a web app find the deployment and sign people in, and never
// reads an account or moves money. Nothing below applications reads its tables either: access sits
// under everything, so the browser's origin reaches the runtime in the bootstrap's signed origin token,
// not through a read of these tables (decision applications.origin-token). The old door's functions go:
// the credential hash (access hashes its own secrets), the operator purge's owned-application read and
// the native client metadata (access.no-device-flow), and the observation hint, which nothing called
// (decision applications.no-door).

export {};
