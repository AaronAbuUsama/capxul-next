/** CLI composition: the same repository loader and engine manifest as the portal board. */
import { load, ROOT } from "./load.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const at = args.indexOf("--journey");
const journey = at < 0 ? undefined : args[at + 1];
if (args.some((a, i) => a !== "--json" && a !== "--journey" && !(at >= 0 && i === at + 1)) || (at >= 0 && (!journey || journey.startsWith("--")))) {
  console.error("usage: pnpm blueprint:slices [--journey <id>] [--json]");
  process.exitCode = 2;
} else {
  const loaded = await load(ROOT);
  if (!loaded.ok) { console.error(loaded.error); process.exitCode = 1; }
  else {
    const manifest = loaded.value.slices!;
    if (journey && !manifest.journeys.some((j) => j.id === journey)) {
      console.error(`unknown journey: ${journey}`); process.exitCode = 2;
    } else {
      const slices = manifest.slices.filter((s) => !journey || s.journey === journey);
      const output = journey ? { ...manifest, slices, journeys: manifest.journeys.filter((j) => j.id === journey),
        waves: manifest.waves.filter((w) => slices.some((s) => s.wave === w.id)).map((w) => ({ ...w, slices: slices.filter((s) => s.wave === w.id).map((s) => s.id) })) } : manifest;
      console.log(json ? JSON.stringify(output, null, 2) : [
        "Provisional blueprint coverage; one writer per concept + one shared lane. Wave 1 cap: 13 concepts + shared.",
        "Wave 0: supplier payment, reconciled and recoverable, on postgres-ponder-erpnext-v4.",
        ...output.waves.flatMap((w) => [`\nWave ${w.id}: ${w.slices.length} slices; at most ${w.maxWriters} writers`,
          ...slices.filter((s) => s.wave === w.id).map((s) => `  ${s.id}  ${s.concept}  ${s.remaining.length}/${s.records.length} records remaining / ${s.evals.length} evals  ${s.evidence.state} (${s.evidence.passing}/${s.evidence.required})${s.evidence.landed ? " · merged" : ""}`)]),
        `\nOutside journeys: ${manifest.outside.operations.length} operations / ${manifest.outside.evals.length} evals. --json lists all records, prerequisites and opaque eval IDs.`,
      ].join("\n"));
    }
  }
}
