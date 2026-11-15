// The shared world's rows as the code of 14 November 2026 wrote them (`./run.sh shared` at 3d31e72, record
// packages/runner/records/shared-09eeaf), read back from its database on 15 November: its contracts name no Budgets,
// which the blueprint's ChainContracts required from that day. Never edited: a later format is a new file.
import type { OldRows } from "./old-rows.ts";

export const shared20261114: OldRows = {
  written: "the shared world, made on 14 November 2026 by 3d31e72",
  applied: [
    "0001_telemetry.sql",
    "0002_site_ops.sql",
    "0003_world.sql",
    "0004_organizations.sql",
    "0005_approvals.sql",
  ],
  world: {
    chain_id: 84532,
    contracts: {
      hats: "0x3bc1A0Ad72417f2d411118085256fC53CBdDd137",
      usdc: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
      payments: "0x468241C0CFaB01eD410D8f9A281Ace9b8D4E30e3",
      entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      companiesHouse: "0x38d9772b87a52Ed4615E2c804414f0cDD4854F2F",
      companyNamespace: "capxul:devnet:company:v1",
      companySafeMinter: "0x27e3faE904527BcA73C39683D2a1239020915c71",
    },
  },
  clock: { mode: "frozen", frozen_at_ms: 1794663554831, offset_ms: -39454 },
  cast: [
    {
      person: "dana",
      email: "dana@cast.test",
      signer: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
      safe: "0x53cf3e053b2c7ae3f4009f318d8ec66eae48669c",
    },
    {
      person: "eli",
      email: "eli@cast.test",
      signer: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
      safe: "0x90c388a1d9bf2218204d6a5de9654b3260369be8",
    },
    {
      person: "sam",
      email: "sam@cast.test",
      signer: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
      safe: "0xf6aeafa0dab7b6d9fc54537ceb1550ce956a11cc",
    },
    {
      person: "pat",
      email: "pat@cast.test",
      signer: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
      safe: null,
    },
    {
      person: "olga",
      email: "olga@cast.test",
      signer: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
      safe: "0x532a1193802e3bbab0597f713c61639f7285f2bb",
    },
  ],
  companies: [
    {
      org: "org_ck4tb63berwj",
      handle: "northwind",
      name: "Northwind Trading",
      site_state: "ready",
      site_url: "https://northwind-shared.worlds.abuusama.dev",
    },
  ],
  born: { grade: "shared", parent: null },
};
