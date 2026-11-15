// Writes claims.md and each domain's src/<domain>/claims.md from the declarations. Run with `pnpm claims` after
// changing a claim, a starting world or an operation's declaration.
import { writeFileSync } from "node:fs";
import { renderClaims } from "./render.ts";

for (const { path, text } of renderClaims()) writeFileSync(new URL(`../../${path}`, import.meta.url), text);
