import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as d from "./data.ts";
export const decision_organizations_state_gaps = defineDecision({
  id: "organizations.cut-state-gaps", title: "Old head apps and hosted FDE transitions retain no active driver",
  question: "Why do the old app and hosted runtime gaps stand?",
  options: [{ label: "retain", text: [
    "undriven-transition: org-app.install was the connected-head installed-app acknowledgement; org-app.remove withdrew a wanted head app; org-app.want_again requested a removed app again. Hosted sites install all supported apps. Feature off retains installation and data, and feature on uses site-feature; neither is these transitions.",
    "undriven-transition: org-fde.start was the parked host process starting a provisioned runtime after setup. org-fde.fall_due was its seven-day-before-expiry timer; org-fde.pause its unpaid-expiry timer and host pause call. Provisioned setup data alone does not promise an active hosted agent.",
    "undriven-transition: org-fde.extend and org-fde.wake belonged to the parked hosting-payment door, extending paid time or waking a paused runtime. Ordinary payment settlement must not silently buy hosting. org-fde.resume was the host acknowledgement after wake, not generic world or agent resume.",
    "undriven-transition: org-fde.retire was parked runtime cleanup on setup failure, agent removal or signer swap. Generic agent removal remains Core but is not evidence that a hosted runtime was retired."
  ].join("\n") }],
  chosen: "retain", why: "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions.",
  source: "Builder, m1-gaps-states; lane findings.json; cut.fde-parked; sites.features-reachability",
  stands: [
  {
    "record": "transition:org-app.install",
    "rule": "undriven-transition",
    "why": "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions."
  },
  {
    "record": "transition:org-app.remove",
    "rule": "undriven-transition",
    "why": "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions."
  },
  {
    "record": "transition:org-app.want_again",
    "rule": "undriven-transition",
    "why": "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions."
  },
  {
    "record": "transition:org-fde.start",
    "rule": "undriven-transition",
    "why": "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions."
  },
  {
    "record": "transition:org-fde.fall_due",
    "rule": "undriven-transition",
    "why": "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions."
  },
  {
    "record": "transition:org-fde.extend",
    "rule": "undriven-transition",
    "why": "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions."
  },
  {
    "record": "transition:org-fde.pause",
    "rule": "undriven-transition",
    "why": "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions."
  },
  {
    "record": "transition:org-fde.wake",
    "rule": "undriven-transition",
    "why": "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions."
  },
  {
    "record": "transition:org-fde.resume",
    "rule": "undriven-transition",
    "why": "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions."
  },
  {
    "record": "transition:org-fde.retire",
    "rule": "undriven-transition",
    "why": "cut.fde-parked parks the hosted runtime. sites.features-reachability replaces the optional-head app model. cut.principle keeps supporting records; no public commands or hosting billing are revived by these retained transitions."
  }
],
  affects: [d.machine_org_app.t.install, d.machine_org_app.t.remove, d.machine_org_app.t.want_again, d.machine_org_fde.t.start, d.machine_org_fde.t.fall_due, d.machine_org_fde.t.extend, d.machine_org_fde.t.pause, d.machine_org_fde.t.wake, d.machine_org_fde.t.resume, d.machine_org_fde.t.retire],
});
