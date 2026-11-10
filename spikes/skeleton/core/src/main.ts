// Entry point and composition root: `serve` runs the Core stub (STAND-IN); everything else is the CLI.
//   node --experimental-strip-types core/src/main.ts org create acme "Acme Trading Ltd" --admin hannah@acme.test
import { CliError, eventsRedeliver, featureList, featureOff, featureOn, eventsResend, eventsStatus, hatGrant, hatRevoke, orgCreate, payDirect } from "./cli.ts";

const [cmd, sub, ...rest] = process.argv.slice(2);
const usage = `usage:
  main.ts serve
  main.ts org create <slug> "<company name>" --admin <email> [--budget 10000] [--fund 50000]
  main.ts hat grant|revoke <slug> <hat> <email> [--department <name>] [--as <admin email>]
  main.ts events status|resend <slug>
  main.ts events redeliver <slug> <seq>   (test seam: offer one applied event again)
  main.ts feature list <slug>
  main.ts feature on|off <slug> <feature> --as <admin email>
  main.ts pay direct <slug> <to address|email> <amount> [--as <email>]`;

const commands: Record<string, (a: string[]) => Promise<string[]>> = {
  "org create": orgCreate, "hat grant": hatGrant, "hat revoke": hatRevoke,
  "events status": eventsStatus, "events resend": eventsResend, "events redeliver": eventsRedeliver, "pay direct": payDirect,
  "feature list": featureList, "feature on": featureOn, "feature off": featureOff,
};

if (cmd === "serve") {
  (await import("./server.ts")).serve();
} else {
  const run = commands[`${cmd} ${sub}`];
  if (!run) { console.error(usage); process.exit(2); }
  try {
    for (const line of await run(rest)) console.log(line);
  } catch (e) {
    console.error(`error: ${e instanceof CliError ? e.message : (e as Error).stack}`);
    process.exit(1);
  }
}
