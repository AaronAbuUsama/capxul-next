// New ids for what Core's operations make: a prefix the blueprint's value names (`org_`, `apr_`, `chg_`, `prp_`,
// `req_`) and twelve random letters and digits, from Effect's Random.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const newId = (prefix: "org" | "apr" | "chg" | "prp" | "req") =>
  Effect.map(
    Effect.forEach(Arr.range(1, 12), () => Random.nextIntBetween(0, ALPHABET.length)),
    (picks) => `${prefix}_${Arr.join(Arr.map(picks, (pick) => ALPHABET.charAt(pick)), "")}`,
  );
