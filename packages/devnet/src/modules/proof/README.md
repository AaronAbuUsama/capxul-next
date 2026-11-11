# proof

`runProof` shows Capxul Core working from keys alone, on a chain with the v4 contracts deployed: a company's birth under
Companies House, authority installed, a department with a budget and a hat, a payment under the hat through Payments with
a document hash, the refusals, and an agent created through AgentOwner. It returns one `StepResult` per claim; `main.ts`
prints them as PASS or FAIL. Run it with `bin/prove-core.sh` in `packages/contracts`.

The sequence follows `test_Proof_StartupMoneyJourney` and `test_RealBudgetPaysThroughInstalledRoles` in
`packages/contracts/test/fork/Installer.fork.t.sol`. Every signature is a key's: the founder's, the second key's, the agent's
(through `@capxul/sdk`'s `localPrivateKeySigner`), the tier service's.
