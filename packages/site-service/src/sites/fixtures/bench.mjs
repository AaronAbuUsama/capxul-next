// Process-level bench fixture: the service still executes argv and persists a site between calls.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, ...args] = process.argv.slice(2);
const site = args[1];
const directory = join(root, site);
const path = join(directory, "site.json");
const load = () => JSON.parse(readFileSync(path, "utf8"));
const save = (value) => writeFileSync(path, JSON.stringify(value));
if (args[0] === "new-site") {
  if (existsSync(path)) process.exit(1);
  mkdirSync(directory, { recursive: true });
  save({ apps: ["frappe"], settings: {} });
} else if (args[2] === "list-apps") {
  if (!existsSync(path)) process.exit(1);
  // Frappe 16.54 list-apps --format json returns a site-keyed dictionary, not an array.
  console.log(JSON.stringify({ [site]: load().apps }));
} else if (args[2] === "install-app") {
  const data = load(); data.apps.push(args[3]); save(data);
} else if (args[2] === "set-config") {
  const data = load(); data[args[3]] = args[4]; save(data);
} else if (args[2] === "execute") {
  const method = args[3];
  if (method === "capxul.setup.configure_site") {
    if (existsSync(join(root, "fail-configure"))) process.exit(1);
    const data = load(); const input = JSON.parse(args[5]);
    data.settings = { org_slug: input.slug, safe_address: input.safe_address };
    data.company = input.company_name; data.core_url = input.core_url; save(data);
  } else if (method === "capxul.clock.join_world") {
    const data = load(); data.world = JSON.parse(args[5]).world; save(data);
  } else if (method === "frappe.db.get_single_value") {
    console.log(JSON.stringify(load().settings[JSON.parse(args[5])[1]] ?? null));
  } else process.exit(1);
} else if (args[2] !== "clear-cache" && args[2] !== "enable-scheduler") process.exit(1);
