-- The Budgets contract in the world's contracts. The blueprint's ChainContracts named it from 15 November 2026 (the
-- budgets domain); a world made before then, such as the shared world and the templates it holds, kept its contracts
-- without it, though every world's chain has held Budgets since its seed (packages/contracts/deployments/devnet.json,
-- 13 November 2026), at the one address it has on every world's chain (packages/world, src/chain/contracts.ts, whose
-- test checks this file against it). The platform's world.show then failed to read such a world's facts. This moves
-- each such row to the format the platform writes now; a row that names Budgets already is left as it is.

update app.world
set contracts = contracts || jsonb_build_object('budgets', '0x6950Cd8E6195beaaB7eECDcc26b8d68Ede662c79')
where contracts -> 'budgets' is null
