# Alerts

`service.ts` is the interface: reconcile a complete snapshot with an injected sender and clock. The atomic journal at `var/alerts.json` contains active episodes, pending intent and successful acknowledgements. Startup catches up without an age cutoff; unchanged active episodes are silent. Question text changes or removal/reappearance start another episode. Failed/dead transitions are separate episodes; coordinator-only states and superseded views are silent. Missing items cancel pending delivery. A single supervised process must own this file.

`inputs.ts` reads authoritative blueprint decisions with `forAaron` and plan needs with `waitsOnOwner`, the portal's predicates. Run views come from the existing structured inspection interface, with all history included.

The composition root injects macOS `osascript display notification`, including the HTTPS portal URL in its body (macOS display notification has no clickable URL API). `pnpm loop alerts --once` previews pending notifications without modifying the journal. Normal operation polls every two seconds and retries failures. Ctrl-C stops it; the operator supervises/restarts the process. No external delivery service is used.

Delivery is acknowledged after sender success. There is an unavoidable crash window between OS acceptance and journal acknowledgement: a restart can repeat that notification. The OS offers neither an idempotency key nor a transactional receipt. This is not a guarantee of exactly-once OS receipt. Episodes wholly appearing and disappearing between snapshots are not observable.

Tests exercise the public interface with a fake sender and clock, including persisted restart catch-up, deduplication, recovery, pending retries and cancellation, supersession and preview.
