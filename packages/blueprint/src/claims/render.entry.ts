// Writes claims.md from the declarations. Run with `pnpm claims` after changing a claim, a starting world or an
// operation's declaration.
import { writeFileSync } from "node:fs";
import { renderClaims } from "./render.ts";

writeFileSync(new URL("../../claims.md", import.meta.url), renderClaims());
