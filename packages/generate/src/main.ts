// `pnpm generate`'s writer: reads each owner (Foundry's out/, the deployment record, the seed, the blueprint) and
// writes every derived file whose text changed, printing each one it wrote; with --check (`pnpm generate:check`) it
// writes nothing and fails when any would change. The root scripts build the contracts first. No generated file is
// formatted after: each is written in its final form. An entry file: it reads the disk, parses JSON, sets the exit code.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { countOldWords, type Disk, layoutOf, renderGlossary, wordFiles } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { getContractAddress } from "viem";
import { renderBlueprint } from "./blueprint.ts";
import {
  renderAbi,
  renderGlossaryPage,
  renderMap,
  renderOldWords,
  renderSeeded,
  renderSite,
  renderSitePackage,
  type Seeded,
} from "./render.ts";
import { ABIS, BLUEPRINT, FIRST_ACCOUNT, MAPS, OUT, OUTPUTS, RECORD, SEED } from "./sources.ts";

const root = join(import.meta.dirname, "../../..");
const literal = (value: unknown): string => JSON.stringify(value, null, 2);

/** The file at `path`, decoded as `schema`; a file that is missing or of another shape stops the run. */
const read = <S extends Schema.Codec<unknown, unknown>>(path: string, schema: S): S["Type"] => {
  if (!existsSync(join(root, path))) throw new Error(`pnpm generate: ${path} is missing (build the contracts first)`);
  // oxlint-disable-next-line effecttsgo/schema-sync -- an entry file run once from the command line: a file of another shape stops the run with its reason.
  return Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(join(root, path), "utf8")));
};

/** A Foundry artifact: only its ABI is read. */
const Artifact = Schema.Struct({ abi: Schema.Array(Schema.Unknown) });

/** The deployment record (`deployments/devnet.json`): what the seed deployed and where. */
const Record = Schema.Struct({
  chainId: Schema.Int,
  companiesHouse: Schema.String,
  companiesHouseRoles: Schema.String,
  createCall: Schema.String,
  tiers: Schema.Array(
    Schema.Struct({
      tier: Schema.String,
      namespace: Schema.String,
      companyNamespace: Schema.String,
      member: Schema.String,
    }),
  ),
  contracts: Schema.Record(
    Schema.String,
    Schema.Struct({
      address: Schema.String,
      constructorArguments: Schema.Struct({ config: Schema.optional(Schema.Record(Schema.String, Schema.String)) }),
    }),
  ),
});

/** The seed (`state/core.json`, an anvil state dump): its head block and each account's nonce. */
const Seed = Schema.Struct({
  block: Schema.Struct({ number: Schema.String, timestamp: Schema.String }),
  accounts: Schema.Record(Schema.String, Schema.Struct({ nonce: Schema.Int })),
});

const abis = Arr.map(Rec.toEntries(ABIS), ([name, artifact]) => ({
  name,
  abi: read(`${OUT}/${artifact}`, Artifact).abi,
}));

const record = read(RECORD, Record);
const seed = read(SEED, Seed);
const nonce = Option.getOrThrowWith(
  Arr.findFirst(
    Rec.toEntries(seed.accounts),
    ([address]) => Str.toLowerCase(address) === Str.toLowerCase(FIRST_ACCOUNT),
  ),
  () => new Error(`pnpm generate: ${SEED} has no account ${FIRST_ACCOUNT}`),
)[1].nonce;

const seeded: Seeded = {
  chainId: record.chainId,
  companiesHouse: record.companiesHouse,
  companiesHouseRoles: record.companiesHouseRoles,
  createCall: record.createCall,
  tiers: record.tiers,
  contracts: Rec.map(record.contracts, (contract) => contract.address),
  installer: record.contracts["Installer"]?.constructorArguments.config ?? {},
  head: { number: Number(BigInt(seed.block.number)), timestamp: Number(BigInt(seed.block.timestamp)) },
  firstAccount: {
    address: FIRST_ACCOUNT,
    nonce,
    nextContract: getContractAddress({ from: FIRST_ACCOUNT, nonce: BigInt(nonce) }),
  },
};

/** With --check, nothing is written: each file that generating again would change is named, and the run fails. */
const check = process.argv.includes("--check");

/** Writes each output whose text changed, or with --check names it; answers how many were stale. */
const settle = (outputs: ReadonlyArray<readonly [string, string]>): number => {
  const stale = Arr.filter(outputs, ([path, body]) => {
    const file = join(root, path);
    return !existsSync(file) || readFileSync(file, "utf8") !== body;
  });
  for (const [path, body] of stale) {
    if (check) {
      console.error(`${path} is not what generating again writes: run \`pnpm generate\` and commit it`);
      continue;
    }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
    console.log(`wrote ${path}`);
  }
  return stale.length;
};

// The blueprint's indexes first, from its thing folders' text alone: what follows imports the blueprint, which
// imports these indexes, so they are made whole before it loads.
const things = join(root, BLUEPRINT.root, "src/things");
const blueprint = renderBlueprint(
  layoutOf(
    Arr.map(
      Arr.filter(readdirSync(things, { recursive: true, encoding: "utf8" }), (path) => Str.endsWith(".ts")(path)),
      (path) => ({ path, text: readFileSync(join(things, path), "utf8") }),
    ),
  ),
);
if (blueprint.problems.length > 0)
  throw new Error(`pnpm generate: the blueprint's things do not fit:\n${Arr.join(blueprint.problems, "\n")}`);
const staleIndexes = settle(Arr.map(blueprint.written, ({ path, text }) => [path, text] as const));

const { Site, glossary } = await import("@capxul/blueprint");

/** The repository's disk, as the count of the glossary's old words reads it. */
const disk: Disk = {
  isFolder: (path) => statSync(join(root, path)).isDirectory(),
  names: (folder) => readdirSync(join(root, folder)),
  text: (file) => readFileSync(join(root, file), "utf8"),
};

const site = {
  WALLET_ADDRESS_FIELD: Site.SUPPLIER_FIELDS.paymentAddress,
  DAILY_JOB: Site.DAILY_JOB.method,
  DAILY_JOB_TYPE: Site.DAILY_JOB.jobType,
  SAFE_ACCOUNT_PREFIX: Site.SAFE_ACCOUNT_PREFIX,
};

/** Every TypeScript file under a package's src/ and page under its docs/, with its text, by its path in the package. */
const mapped = (pkg: string) =>
  Arr.flatMap(["src", "docs"], (folder) => {
    const at = join(root, pkg, folder);
    if (!existsSync(at)) return [];
    const files = Arr.filter(
      readdirSync(at, { recursive: true, withFileTypes: true }),
      (entry) => entry.isFile() && /\.(ts|md)$/.test(entry.name),
    );
    return Arr.map(files, (entry) => {
      const file = join(entry.parentPath, entry.name);
      return { path: Arr.join(Str.split(relative(join(root, pkg), file), sep), "/"), text: readFileSync(file, "utf8") };
    });
  });

const stale =
  staleIndexes +
  settle([
    ...Arr.map(MAPS, (pkg) => [`${pkg}/generated/index.md`, renderMap(pkg, mapped(pkg))] as const),
    [OUTPUTS.abi.path, renderAbi(abis, literal)],
    [OUTPUTS.seeded.path, renderSeeded(seeded, literal)],
    [OUTPUTS.site.path, renderSite(site, literal)],
    [OUTPUTS.sitePackage.path, renderSitePackage()],
    [OUTPUTS.glossary.path, renderGlossaryPage(renderGlossary(glossary))],
    [OUTPUTS.oldWords.path, renderOldWords(countOldWords(glossary, wordFiles(disk)), literal)],
  ]);
if (check && stale > 0) process.exitCode = 1;
