// The command table, and the ONE place every command passes through: it opens the record, runs the command, writes the record.
// (main.ts picks the world and its environment, then loads this file.)
//   node --experimental-strip-types core/src/main.ts org create acme "Acme Trading Ltd" --admin hannah@acme.test
// `--json` anywhere gives {"ok":true,"trace":...,"data":...} or {"ok":false,"trace":...,"error":{code,reason,detail}}; exit code 0, 1 (refused or failed), 2 (usage).
import { parseArgs } from "./args.ts";
import { CliError, refuse } from "./errors.ts";
import { eventsRedeliver, featureList, featureOff, featureOn, eventsResend, eventsStatus, hatGrant, hatRevoke, orgCreate, payDirect } from "./cli.ts";
import { approvalSign, docAmend, docCall, docCancel, docCreate, docDelete, docGet, docList, docNext, docSchema, docSubmit, docTypes, docUpdate, reportList, reportRun, type Out } from "./doc.ts";
import { clockAdvance, clockReset, clockSet, clockShow } from "./clock.ts";
import { recordExport, recordShow, recordTail } from "./recordcmd.ts";
import { snapshotList, snapshotRestore, snapshotSave } from "./snapshot.ts";
import { worldCreate, worldDelete, worldList, worldShow } from "./worldcmd.ts";
import { begin, finish } from "./record.ts";
import { trace } from "./trace.ts";

const usage = `usage:
  main.ts serve
  main.ts org create <slug> "<company name>" --admin <email> [--budget 10000] [--fund 50000]
  main.ts hat grant|revoke <slug> <hat> <email> [--department <name>] [--as <admin email>]
  main.ts events status|resend <slug>          main.ts events redeliver <slug> <seq>
  main.ts feature list <slug>                  main.ts feature on|off <slug> <feature> --as <admin email>
  main.ts pay direct <slug> <to address|email> <amount> [--as <email>]
  main.ts doc types <slug> --as <email> [--feature <name>]      main.ts doc schema <slug> <DocType> --as <email>
  main.ts doc list|get|create|update|delete|submit|cancel|amend <slug> <DocType> [<name>] --as <email> [--filters j --fields a,b --limit n --page n --data j]
  main.ts doc call <slug> <method> --as <email> [--args <json>]     main.ts doc next <slug> <DocType> <name> --as <email>
  main.ts report list <slug> --as <email>      main.ts report run <slug> <name> --as <email> [--filters <json>]
  main.ts approval sign <slug> <approval id> --as <email>
  main.ts world create <name> --as operator | list | show <name> | delete <name> --as operator      main.ts world clock show <world>
  main.ts world clock set <world> <iso> | advance <world> <30d> | reset <world>  --as operator
  main.ts record tail <world> [--org <company>] [--n 20]   main.ts record show <id>   main.ts record export <world> [--org <company>] [--out <file>]
  any command: --world <name> (default main, or CAPXUL_WORLD)
  main.ts world snapshot save <world> --as operator [--name <label>]     main.ts world snapshot list [<world>]
  main.ts world snapshot restore <snapshot id> --as operator --into <new world> | --in-place
  any command: --json`;

const commands: Record<string, { run: (a: string[]) => Promise<Out>; noSlug?: boolean }> = {
  "org create": { run: orgCreate }, "hat grant": { run: hatGrant }, "hat revoke": { run: hatRevoke },
  "events status": { run: eventsStatus }, "events resend": { run: eventsResend }, "events redeliver": { run: eventsRedeliver }, "pay direct": { run: payDirect },
  "feature list": { run: featureList }, "feature on": { run: featureOn }, "feature off": { run: featureOff },
  "doc types": { run: docTypes }, "doc schema": { run: docSchema }, "doc list": { run: docList }, "doc get": { run: docGet }, "doc create": { run: docCreate },
  "doc update": { run: docUpdate }, "doc delete": { run: docDelete }, "doc submit": { run: docSubmit }, "doc cancel": { run: docCancel }, "doc amend": { run: docAmend },
  "doc call": { run: docCall }, "doc next": { run: docNext }, "report list": { run: reportList }, "report run": { run: reportRun },
  "approval sign": { run: approvalSign },
  "world clock show": { noSlug: true, run: clockShow }, "world clock set": { noSlug: true, run: clockSet }, "world clock advance": { noSlug: true, run: clockAdvance }, "world clock reset": { noSlug: true, run: clockReset },
  "record tail": { noSlug: true, run: recordTail }, "record show": { run: recordShow, noSlug: true }, "record export": { noSlug: true, run: recordExport },
  "world create": { noSlug: true, run: worldCreate }, "world list": { noSlug: true, run: worldList }, "world show": { noSlug: true, run: worldShow }, "world delete": { noSlug: true, run: worldDelete },
  "world snapshot save": { noSlug: true, run: snapshotSave }, "world snapshot list": { run: snapshotList, noSlug: true }, "world snapshot restore": { run: snapshotRestore, noSlug: true },
};

const argv = process.argv.slice(2);
const wantJson = argv.includes("--json");
const clean = argv.filter((a) => a !== "--json");   // (--world is read by main.ts; it stays in the arguments and the record)
const [cmd = "", sub = "", sub2 = ""] = clean;
const key3 = `${cmd} ${sub} ${sub2}`, key2 = `${cmd} ${sub}`;
const key = commands[key3] ? key3 : key2;
const rest = clean.slice(key === key3 ? 3 : 2);
const spec = commands[key];
const parsed = parseArgs(rest);
const slugArg = parsed.pos[0];
const slug = spec && !spec.noSlug && slugArg && /^[a-z][a-z0-9-]{1,30}$/.test(slugArg) ? slugArg : undefined;

await begin({ command: cmd === "serve" ? "serve" : spec ? key : `${cmd} ${sub}`.trim() || "(none)", argv: clean, slug, pos: parsed.pos, flags: parsed.flags });

if (cmd === "serve") {
  await finish({ ok: true, result: { listening: true } });   // a daemon never "finishes": it is recorded when it starts
  (await import("./server.ts")).serve();
} else {
  let code = 0, out = "", err = "";
  try {
    if (!spec) throw refuse("USAGE", usage);
    const raw = await spec.run(rest);
    const res = Array.isArray(raw) ? { data: { lines: raw }, lines: raw } : raw;
    await finish({ ok: true, result: res.data });
    out = wantJson ? JSON.stringify({ ok: true, trace, data: res.data }) + "\n" : (res.lines ?? []).map((l) => l + "\n").join("");
  } catch (e) {
    await finish({ ok: false, error: e });
    const er = e instanceof CliError ? { code: e.code, reason: e.message, detail: e.detail ?? null } : { code: "INTERNAL", reason: (e as Error).message, detail: null };
    if (wantJson) out = JSON.stringify({ ok: false, trace, error: er }) + "\n";
    else err = `error: ${er.code === "USAGE" || er.code === "FAILED" ? "" : `[${er.code}] `}${er.reason}\n`;
    code = er.code === "USAGE" && !spec ? 2 : 1;
  }
  // a pipe takes big writes in pieces: leave only when everything has been handed over (process.exit right after console.log cut output at 64 KB)
  process.stderr.write(err, () => process.stdout.write(out, () => process.exit(code)));
}
