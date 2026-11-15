// Every operation's checks, by name: one set each, written once (one file of this folder), gathered from each domain's
// scenarios (../domains.ts). The compiler holds that every operation of the blueprint has its set. The registry gives
// them to every journey it runs (`OperationChecks`, format.ts).
import * as Rec from "effect/Record";
import { gather } from "../domain.ts";
import { domains } from "../domains.ts";
import type { AllChecks } from "./format.ts";

export const operationChecks: AllChecks = gather(Rec.values(domains), "checks");
