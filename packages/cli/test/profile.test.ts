// Roadmap item 3.9 (docs/design/blueprint.md, part 12, decision 8, item 1): the caller's profile. `capxul login`
// keeps the account's address and the operator's token in a profile only its owner may read, and prints neither
// token; `capxul logout` forgets the token; `capxul use <world>` sets the current world, whose endpoint a world's
// command finds by asking the account (`world.show`) and calls with the operator's token; `--world <name>` stands over
// `use`; and the environment's variables, when set, stand over the profile, so the runner's `--via=cli` (`callVia`)
// is unchanged.
//
// What the builder honours (see test/harness.ts):
// - `CAPXUL_HOME`, read through Config: the directory the profile is kept in. These tests point it at a fresh
//   directory each; left unset, the builder's default (such as `~/.capxul`).
// - `capxul login --account <url>`: `<url>` is the account's address, what `CAPXUL_PLATFORM_URL` names; the
//   operator's token is read from standard input (`Stdio.stdin`), one line, so it never sits in a shell's history.
// - `capxul logout` and `capxul use <world>`: `<world>` is a positional argument, the world's name.
import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { commands } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import {
  codeOf,
  DOC_CREATE,
  envOf,
  EXAMPLE_WORLD_URL,
  exampleFlags,
  sameUrl,
  TOKEN,
  withBench,
  WORLD_LIST,
  WORLD_SHOW,
  type Bench,
  type Ran,
  type Sent,
} from "./harness.ts";

const freshHome = () => mkdtempSync(join(tmpdir(), "capxul-home-"));

/** Every file under `home`, with its text and its mode. */
const filesUnder = (home: string) =>
  Arr.flatMap(readdirSync(home, { recursive: true, encoding: "utf8" }), (entry) => {
    const path = join(home, entry);
    const stat = statSync(path);
    return stat.isFile() ? [{ path, text: readFileSync(path, "utf8"), mode: stat.mode }] : [];
  });

/** The request sent to `url`, if any. */
const sentTo = (sent: ReadonlyArray<Sent>, url: string) =>
  Option.getOrUndefined(Arr.findFirst(sent, (request) => sameUrl(request.url, url)));

/** Everything a command showed or failed with, for checking what it never prints or what its error says. */
const everything = (ran: Ran) =>
  `${ran.stdout}\n${ran.stderr}\n${Exit.isFailure(ran.exit) ? Cause.pretty(ran.exit.cause) : ""}`;

const login = (bench: Bench, home: string, account = bench.served.platform, token = TOKEN) =>
  bench.run(["login", "--account", account], { env: { CAPXUL_HOME: home }, stdin: `${token}\n` });

const DOC = commands[DOC_CREATE];

test("login keeps the account and the token in a profile only its owner may read, and prints no token", () =>
  withBench("examples", async (bench) => {
    const home = freshHome();
    const ran = await login(bench, home);
    assert.ok(Exit.isSuccess(ran.exit), `login failed: ${everything(ran)}`);
    assert.ok(!Str.includes(TOKEN)(everything(ran)), "login printed the token");
    const files = filesUnder(home);
    assert.ok(files.length > 0, "login wrote no profile under CAPXUL_HOME");
    assert.ok(
      Arr.some(files, (file) => Str.includes(TOKEN)(file.text)),
      "no file under CAPXUL_HOME keeps the token",
    );
    assert.ok(
      Arr.some(files, (file) => Str.includes(bench.served.platform)(file.text)),
      "no file under CAPXUL_HOME keeps the account's address",
    );
    for (const file of files) assert.equal(file.mode & 0o077, 0, `${file.path} may be read by others`);
  }));

test("after login, an account call signs with the profile's token, with no variable set", () =>
  withBench("examples", async (bench) => {
    const home = freshHome();
    assert.ok(Exit.isSuccess((await login(bench, home)).exit), "login failed");
    const ran = await bench.run([...commands[WORLD_LIST]], { env: { CAPXUL_HOME: home } });
    assert.ok(Exit.isSuccess(ran.exit), `world list failed: ${everything(ran)}`);
    assert.equal(ran.lines.length, 1);
    assert.ok(!Str.includes(TOKEN)(everything(ran)), "world list printed the token");
    const sent = await bench.sent();
    assert.ok(
      Arr.some(
        sent,
        (request) => sameUrl(request.url, bench.served.platform) && request.credential === `Bearer ${TOKEN}`,
      ),
      "no call reached the account signed with the profile's token",
    );
  }));

test("logout forgets the token: no file keeps it, and an account call no longer signs with it", () =>
  withBench("examples", async (bench) => {
    const home = freshHome();
    assert.ok(Exit.isSuccess((await login(bench, home)).exit), "login failed");
    const out = await bench.run(["logout"], { env: { CAPXUL_HOME: home } });
    assert.ok(Exit.isSuccess(out.exit), `logout failed: ${everything(out)}`);
    for (const file of filesUnder(home))
      assert.ok(!Str.includes(TOKEN)(file.text), `${file.path} still keeps the token`);
    const before = (await bench.sent()).length;
    const ran = await bench.run([...commands[WORLD_LIST]], { env: { CAPXUL_HOME: home } });
    assert.ok(Exit.isFailure(ran.exit), "an account call succeeded after logout");
    const after = Arr.drop(await bench.sent(), before);
    assert.ok(
      Arr.every(after, (request) => request.credential !== `Bearer ${TOKEN}`),
      "a call after logout was signed with the forgotten token",
    );
  }));

test("use <world>: a world's command finds its endpoint with world.show and calls there with the operator's token", () =>
  withBench("examples", async (bench) => {
    const home = freshHome();
    assert.ok(Exit.isSuccess((await login(bench, home)).exit), "login failed");
    const use = await bench.run(["use", "town"], { env: { CAPXUL_HOME: home } });
    assert.ok(Exit.isSuccess(use.exit), `use failed: ${everything(use)}`);
    const ran = await bench.run([...DOC, ...(await exampleFlags(DOC_CREATE))], { env: { CAPXUL_HOME: home } });
    assert.ok(Exit.isSuccess(ran.exit), `document create failed: ${everything(ran)}`);
    assert.equal(ran.lines.length, 1);
    assert.deepEqual(await bench.seen(), [WORLD_SHOW, DOC_CREATE]);
    const sent = await bench.sent();
    const show = sentTo(sent, bench.served.platform);
    assert.ok(show !== undefined, "world.show was not asked of the account");
    assert.ok(Str.includes('"world":"town"')(show.body), `world.show did not ask for town: ${show.body}`);
    assert.equal(show.credential, `Bearer ${TOKEN}`);
    const call = sentTo(sent, EXAMPLE_WORLD_URL);
    assert.ok(
      call !== undefined,
      `document create was not sent to the endpoint world.show answered (${EXAMPLE_WORLD_URL})`,
    );
    assert.equal(call.credential, `Bearer ${TOKEN}`, "the world's call was not signed with the operator's token");
  }));

test("--world <name> stands over the world `use` set", () =>
  withBench("examples", async (bench) => {
    const home = freshHome();
    assert.ok(Exit.isSuccess((await login(bench, home)).exit), "login failed");
    assert.ok(Exit.isSuccess((await bench.run(["use", "elsewhere"], { env: { CAPXUL_HOME: home } })).exit));
    const flags = await exampleFlags(DOC_CREATE);
    const ran = await bench.run([...DOC, ...flags, "--world", "town"], { env: { CAPXUL_HOME: home } });
    assert.ok(Exit.isSuccess(ran.exit), `document create --world town failed: ${everything(ran)}`);
    const show = sentTo(await bench.sent(), bench.served.platform);
    assert.ok(show !== undefined, "world.show was not asked of the account");
    assert.ok(Str.includes('"world":"town"')(show.body), `world.show did not ask for town: ${show.body}`);
    assert.ok(!Str.includes("elsewhere")(show.body), "world.show asked for the world use set, not --world's");
  }));

test("an account command's world field, left out, is the world `use` set", () =>
  withBench("examples", async (bench) => {
    const home = freshHome();
    assert.ok(Exit.isSuccess((await login(bench, home)).exit), "login failed");
    assert.ok(Exit.isSuccess((await bench.run(["use", "town"], { env: { CAPXUL_HOME: home } })).exit), "use failed");
    const ran = await bench.run([...commands[WORLD_SHOW]], { env: { CAPXUL_HOME: home } });
    assert.ok(Exit.isSuccess(ran.exit), `world show with no --world failed: ${everything(ran)}`);
    assert.deepEqual(await bench.seen(), [WORLD_SHOW]);
    const show = sentTo(await bench.sent(), bench.served.platform);
    assert.ok(show !== undefined, "world.show was not asked of the account");
    assert.ok(Str.includes('"world":"town"')(show.body), `world.show did not ask for the world use set: ${show.body}`);
  }));

test("an account command's world field is --world, which stands over `use`", () =>
  withBench("examples", async (bench) => {
    const home = freshHome();
    assert.ok(Exit.isSuccess((await login(bench, home)).exit), "login failed");
    assert.ok(
      Exit.isSuccess((await bench.run(["use", "elsewhere"], { env: { CAPXUL_HOME: home } })).exit),
      "use failed",
    );
    const ran = await bench.run([...commands[WORLD_SHOW], "--world", "town"], { env: { CAPXUL_HOME: home } });
    assert.ok(Exit.isSuccess(ran.exit), `world show --world town failed: ${everything(ran)}`);
    const show = sentTo(await bench.sent(), bench.served.platform);
    assert.ok(show !== undefined, "world.show was not asked of the account");
    assert.ok(Str.includes('"world":"town"')(show.body), `world.show did not ask for --world's world: ${show.body}`);
    assert.ok(!Str.includes("elsewhere")(show.body), "world.show asked for the world use set, not --world's");
  }));

test("a world's command with no --world, no `use` and no CAPXUL_DOOR_URL is a usage error, exit 1, no answer", () =>
  withBench("examples", async (bench) => {
    const home = freshHome();
    assert.ok(Exit.isSuccess((await login(bench, home)).exit), "login failed");
    const ran = await bench.run([...DOC, ...(await exampleFlags(DOC_CREATE))], { env: { CAPXUL_HOME: home } });
    assert.ok(Exit.isFailure(ran.exit), "document create ran with no world");
    assert.equal(codeOf(ran), 1);
    assert.deepEqual(
      Arr.filter(ran.lines, (line) => Str.startsWith("{")(line)),
      [],
      "it printed an answer",
    );
    const said = everything(ran);
    assert.ok(Str.includes("--world")(said), `the error does not name --world: ${said}`);
    assert.ok(Str.includes("capxul use")(said), `the error does not name capxul use: ${said}`);
    assert.deepEqual(await bench.seen(), [], "it called the door");
  }));

test("the environment's variables stand over the profile, so --via=cli is unchanged", () =>
  withBench("examples", async (bench) => {
    const home = freshHome();
    const stale = "a-stale-profile-token";
    assert.ok(Exit.isSuccess((await login(bench, home, "http://127.0.0.1:9/never", stale)).exit), "login failed");
    assert.ok(Exit.isSuccess((await bench.run(["use", "elsewhere"], { env: { CAPXUL_HOME: home } })).exit));
    const env = { ...envOf(bench.served), CAPXUL_HOME: home };
    const account = await bench.run([...commands[WORLD_LIST]], { env });
    assert.ok(Exit.isSuccess(account.exit), `world list failed: ${everything(account)}`);
    const world = await bench.run([...DOC, ...(await exampleFlags(DOC_CREATE))], { env });
    assert.ok(Exit.isSuccess(world.exit), `document create failed: ${everything(world)}`);
    assert.deepEqual(await bench.seen(), [WORLD_LIST, DOC_CREATE], "the world was looked up despite CAPXUL_DOOR_URL");
    for (const request of await bench.sent()) {
      assert.notEqual(request.credential, `Bearer ${stale}`, "a call was signed with the profile's token");
      assert.ok(!Str.startsWith("http://127.0.0.1:9/")(request.url), "a call went to the profile's account");
    }
  }));
