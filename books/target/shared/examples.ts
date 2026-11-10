// The cast and the helpers every operation's examples share, so the 201 examples read as one story.
// Not a record and not a module in index.ts: operation records import it to build their `examples`.
//
// The story: Northwind Trading (org slug `northwind`), in a world named `town`. Hannah Okafor is its admin,
// Marcus Lindqvist the Finance budget holder, Priya Raman a member, Tomas Varga the payroll approver, Brightside
// Cleaning a supplier, and ledger-agent an agent. Early 2026, USDC. Addresses are the well-known test set;
// hashes repeat one byte. Nothing here names a country.

import type { ErrorRecord } from "../../../packages/book/src/index.ts";

/** One example of an operation: the command as typed, what `--json` prints, the exit code. */
export interface ExampleRow {
  readonly title: string;
  readonly input: string;
  readonly output: unknown;
  readonly exit: number;
}

/** A success: exit 0, `output` is the operation's `returns` shape. */
export const ok = (title: string, input: string, output: unknown): ExampleRow => ({ title, input, output, exit: 0 });

/** A refusal: the failure shape the book uses, `{ error: { code, message, details } }`. The code, the exit code and
 * the message come from the error record itself; `details` fills the message's `{placeholders}` and is printed too. */
export const refused = (
  title: string,
  input: string,
  error: ErrorRecord,
  details: Readonly<Record<string, unknown>> = {},
): ExampleRow => ({
  title,
  input,
  exit: error.exit,
  output: {
    error: {
      code: error.id,
      message: error.message.replace(/\{(\w+)\}/g, (whole, k: string) => (k in details ? String(details[k]) : whole)),
      details,
    },
  },
});

/** A 20-byte test address: the well-known set every devnet funds. */
export const ADDRESS = {
  hannah: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  marcus: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  priya: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  tomas: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  brightside: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  agent: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  /** Northwind's company Safe. */
  northwind: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  /** A well-formed address nobody in the cast owns, for a stranger. */
  stranger: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
} as const;

/** A 32-byte hash of one repeating byte: obviously fake, well formed. */
export const hash = (byte: string): string => `0x${byte.repeat(32)}`;

/** The chain every example runs on: the devnet's own. */
export const CHAIN_ID = 31337;

/** An id of the form `00000000-0000-4000-8000-0000000000NN`: the same n always names the same thing. */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const PEOPLE = {
  hannah: { name: "Hannah Okafor", email: "hannah.okafor@northwind.test", role: "admin" },
  marcus: { name: "Marcus Lindqvist", email: "marcus.lindqvist@northwind.test", role: "budget holder, Finance" },
  priya: { name: "Priya Raman", email: "priya.raman@northwind.test", role: "member" },
  tomas: { name: "Tomas Varga", email: "tomas.varga@northwind.test", role: "payroll approver" },
  brightside: { name: "Brightside Cleaning", email: "accounts@brightside.test", role: "supplier" },
  agent: { name: "ledger-agent", email: null, role: "agent" },
} as const;

/** Northwind, its slug, its world and the ids the whole book agrees on. */
export const NORTHWIND = {
  name: "Northwind Trading",
  slug: "northwind",
  world: "town",
  orgId: uuid(1),
  /** The first dates of the story are in early 2026. */
  today: "2026-02-10",
  now: "2026-02-10T09:30:00Z",
} as const;

/** Ids of the story's recurring things: the same payment, approval and budget wherever they appear. */
export const ID = {
  hannah: uuid(11),
  marcus: uuid(12),
  priya: uuid(13),
  tomas: uuid(14),
  brightside: uuid(15),
  agent: uuid(16),
  financeBudget: uuid(21),
  paymentToBrightside: uuid(31),
  approval: uuid(41),
  proposal: uuid(51),
} as const;
