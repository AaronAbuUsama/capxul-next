## What
In blueprint/devnet/decisions.ts, give decision devnet.surface-gap-disposition a stands entry (rule no-acceptance) for each of operation:dev.fund, dev.approve, dev.gates.set, dev.jobs.run, dev.mail.list and dev.prices.set, each with a why of its own taken from what that command does (see the decision's why and the record of blueprint/shared/error-gaps.ts for the shape). Add no acceptance lines; do not touch the baseline, the engine or the frozen checker; do not touch invite.list, org.invite.list, org.books.assets.list, address or balance (another run has them)
## Why
Exit g2: decision devnet.surface-gap-disposition keeps the six dev commands' acceptance lists empty (the freeze requires equal lengths), but it records no stands, so they still count as 6 open gaps
## Done when
- pnpm blueprint: 0 problems and 0 no-acceptance gaps
- pnpm frozen: 0 breaches
