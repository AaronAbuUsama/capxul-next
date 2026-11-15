// What an approval of the domain "board" authorises (`Subject` in ../values.ts): a change to a company's Board, its
// Directors or its threshold, by its change id (`org.director.add`, `org.threshold.set`).
import * as Schema from "effect/Schema";
import { BoardChangeId } from "../ids.ts";

export const subjects = [Schema.Struct({ kind: Schema.Literal("board_change"), id: BoardChangeId })] as const;
