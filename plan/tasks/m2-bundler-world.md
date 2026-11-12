## What
Add the bundler (alto behind the mock paymaster, component bundler-paymaster) to packages/devnet for the thin line's world only, with a test sponsor that pays gas. Other worlds are unchanged. Row 6 of evals/thin-line.md (acc:payment.send/1).
## Why
Aaron accepted thin-line.bundler as recommended, 12 November 2026 06:15 UTC (a-20261112T061518-d70798): one canary world has the account-abstraction pipeline; every other test world stays small.
## Done when
- Thin-line step 6 (acc:payment.send/1) passes as written, its held payment signed and sent through the bundler and the EntryPoint, while the other test worlds start without a bundler.
