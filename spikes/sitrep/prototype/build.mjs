// Builds sitrep.html from src/: the page shell, the stylesheet, the snapshot the blueprint's projection wrote
// (snapshot.json, embedded as data), and the app's scripts in order.
//   node spikes/sitrep/prototype/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const ORDER = ["core", "store", "ui", "charts", "now", "plan", "lanes", "sitreps", "app"];

// The snapshot is embedded as JavaScript data; "</" is escaped so no string in it can close the script.
const snapshot = JSON.stringify(JSON.parse(read("snapshot.json"))).replace(/<\//g, "<\\/");
const app = "(function () {\n\"use strict\";\n" + ORDER.map((f) => `// ---- ${f}.js\n` + read(`src/app/${f}.js`)).join("\n") + "\n})();";
const page = read("src/page.html")
  .replace("/*STYLES*/", () => read("src/styles.css"))
  .replace("/*SNAPSHOT*/", () => snapshot)
  .replace("/*APP*/", () => app);
writeFileSync(join(here, "sitrep.html"), page);
console.log(`sitrep.html: ${(page.length / 1024).toFixed(0)} KB`);
