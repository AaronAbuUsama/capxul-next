import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as d from "./data.ts";
export const decision_accounts_state_gaps = defineDecision({
  id: "accounts.cut-state-gaps", title: "Individual-feature gaps stand while their operations are parked",
  question: "Why are the referral code table and individual transitions unreached?",
  options: [{ label: "parked", text: "unwritten-table: referral-codes was written by lazy code creation and operator invite grants in the parked referral surface. undriven-transition: referral.attribute belonged to waitlist join --ref and referral invite; referral.qualify to the parked follower of a friend Safe claim; referral.reward to the parked reward process; referral.void to that process and its void reasons. waitlist-entry.join belonged to parked waitlist.join. None is an active promise now. Organization and escrow admission still use the other admission transitions; Core Safe claims do not promise referral rewards." }],
  chosen: "parked", why: "cut.individuals-parked parks these surfaces; cut.principle keeps supporting records intact. Do not invent drivers or reopen the public waitlist to clear graph gaps.",
  source: "Builder, m1-gaps-states; lane findings.json; cut.individuals-parked; accounts/data.ts",
  stands: [
  {
    "record": "table:referral-codes",
    "rule": "unwritten-table",
    "why": "cut.individuals-parked parks these surfaces; cut.principle keeps supporting records intact. Do not invent drivers or reopen the public waitlist to clear graph gaps."
  },
  {
    "record": "transition:referral.attribute",
    "rule": "undriven-transition",
    "why": "cut.individuals-parked parks these surfaces; cut.principle keeps supporting records intact. Do not invent drivers or reopen the public waitlist to clear graph gaps."
  },
  {
    "record": "transition:referral.qualify",
    "rule": "undriven-transition",
    "why": "cut.individuals-parked parks these surfaces; cut.principle keeps supporting records intact. Do not invent drivers or reopen the public waitlist to clear graph gaps."
  },
  {
    "record": "transition:referral.reward",
    "rule": "undriven-transition",
    "why": "cut.individuals-parked parks these surfaces; cut.principle keeps supporting records intact. Do not invent drivers or reopen the public waitlist to clear graph gaps."
  },
  {
    "record": "transition:referral.void",
    "rule": "undriven-transition",
    "why": "cut.individuals-parked parks these surfaces; cut.principle keeps supporting records intact. Do not invent drivers or reopen the public waitlist to clear graph gaps."
  },
  {
    "record": "transition:waitlist-entry.join",
    "rule": "undriven-transition",
    "why": "cut.individuals-parked parks these surfaces; cut.principle keeps supporting records intact. Do not invent drivers or reopen the public waitlist to clear graph gaps."
  }
],
  affects: [d.table_referral_codes, d.machine_referral.t.attribute, d.machine_referral.t.qualify, d.machine_referral.t.reward, d.machine_referral.t.void, d.machine_waitlist_entry.t.join],
});
