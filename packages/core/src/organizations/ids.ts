// New ids for what Core's operations make: a prefix the blueprint's value names (`org_`, `apr_`, `chg_`, `prp_`,
// `req_`, `inv_`, `bch_`, `bcr_`) and twelve random letters and digits, from Effect's Random.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Str from "effect/String";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const newId = (prefix: "org" | "apr" | "chg" | "prp" | "req" | "inv" | "bch" | "bcr") =>
  Effect.map(
    Effect.forEach(Arr.range(1, 12), () => Random.nextIntBetween(0, ALPHABET.length - 1)),
    (picks) =>
      `${prefix}_${Arr.join(
        Arr.map(picks, (pick) => Option.getOrElse(Str.charAt(pick)(ALPHABET), () => "a")),
        "",
      )}`,
  );
