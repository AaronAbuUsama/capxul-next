## What
Add the bundler (alto behind the mock paymaster, component bundler-paymaster) to packages/devnet for the thin line's world only, with a test sponsor that pays gas. Other worlds are unchanged. Row 6 of evals/thin-line.md (acc:payment.send/c-c9400dfaeba081e7).
## Why
Aaron accepted thin-line.bundler as recommended, 12 November 2026 06:15 UTC (a-20261112T061518-d70798): one canary world has the account-abstraction pipeline; every other test world stays small.
## Done when
- Thin-line step 6 (acc:payment.send/c-c9400dfaeba081e7) passes as written, its held payment signed and sent through the bundler and the EntryPoint, while the other test worlds start without a bundler.
## From the Ponder measurement, 12 November 2026 (docs/mission/world-cost.md, Part 1)
- A world's birth must give the chain two-second blocks and 200 mined blocks, or Ponder cannot start on a world seeded from --load-state.
## Where it stands, 12 November 2026
- PR #29 (903cfe5) sends the payment as a real v4 UserOperation. At 2201e8d (run-20261112083710) 18 of 18 bound evals pass, and all eight checks of acc:payment.send/c-c9400dfaeba081e7 pass, but it stays a near-miss, not bound: thin-line.bundler asks for a real bundler and the op still goes in by a direct handleOps call.
- Left: install alto in the canary world and add a check that the op came through it. That waits on Aaron's answer to the alto card in the thread "Validate the blueprint audit findings".
