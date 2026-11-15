// capxul/decoded-rows: a row read from the database is decoded with the blueprint's schemas, never cast to a type
// written by hand (docs/roadmap.md, "Facts typed twice": stored rows). A `sql<Row>` query only tells the compiler
// what the row is hoped to be; decoding with a schema checks it. The blueprint and generated files are exempt.
import type { Context, ESTree } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import { isGenerated, ratcheted, type Unmigrated } from "./ratchet.ts";
import { matches, pathOf } from "./where.ts";

/** What the rule finds, as AGENTS.md and packages/lint/README.md list it (written there by `pnpm generate`). */
export const description = "no `sql<Row>` cast outside the blueprint; rows are decoded with the blueprint's schemas.";

/** The blueprint, and its toolkit (packages/blueprint-tools), which writes and checks it. */
const OWNERS = ["packages/blueprint/**", "packages/blueprint-tools/**"];

const MESSAGE =
  "a sql<...> query casts its rows to a type written by hand: query without the type argument and decode the rows with the blueprint's schema (Schema.decodeUnknown)";

/** True when the tag is `sql` or ends in `.sql`. */
const isSql = (tag: ESTree.Node): boolean =>
  (tag.type === "Identifier" && tag.name === "sql") ||
  (tag.type === "MemberExpression" &&
    !tag.computed &&
    tag.property.type === "Identifier" &&
    tag.property.name === "sql");

export const decodedRows = (listed: Unmigrated) =>
  ratcheted("decoded-rows", description, listed, (context: Context, found) => {
    if (Arr.some(OWNERS, (owner) => matches(owner, pathOf(context))) || isGenerated(context)) return null;
    return {
      TaggedTemplateExpression: (node: ESTree.TaggedTemplateExpression) => {
        if (isSql(node.tag) && node.typeArguments !== null && node.typeArguments !== undefined)
          found({ node, message: MESSAGE });
      },
    };
  });
