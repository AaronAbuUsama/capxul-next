## What
Take every gap whose rule is uncalled-function or unconsumed-chain-event (pnpm blueprint, then var/blueprint/findings.json). For each: if an operation, procedure or workflow in the blueprint really uses it, link it there. Otherwise let it stand: add an entry to a decision's stands field ({ record, rule, why }, see docs/blueprint.md) whose why is specific to that member: who may call it, when, and why nothing in the blueprint does today (owner-only, set once at install, a parked feature, read by the indexer). Never change or shorten a member's own description. One decision per contract, not one per member. Read the contract source in packages/contracts for what each member does. Do not invent operations.
## Why
Exit line g2. 99 of the open gaps are contract functions nothing calls and chain events nothing consumes. A first run on 10 November was refused by its reviewer: it replaced each member's own description with one boilerplate reason and lost what each function does.
## Done when
- pnpm blueprint lists no open gap with the rule uncalled-function or unconsumed-chain-event; each is linked or standing
- No member's description was removed or replaced, and each standing reason names that member's caller and condition
- 0 problems, pnpm frozen 0 breaches, pnpm contracts:check-blueprint 0 differences
