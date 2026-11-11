import assert from "node:assert/strict";
import { test } from "node:test";

import { testKey } from "./service.ts";

test("the roles are Anvil's published accounts, in order", () => {
  const expected = [
    ["deployer", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
    ["directorOne", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
    ["directorTwo", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"],
    ["tierService", "0x90F79bf6EB2c4f870365E785982E1f101E93b906"],
    ["founder", "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"],
    ["second", "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"],
    ["payee", "0x976EA74026E726554dB657fA54763abd0C3a0aa9"],
    ["stranger", "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"],
    ["agent", "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f"],
  ] as const;
  for (const [role, address] of expected) assert.equal(testKey(role).address, address);
});
