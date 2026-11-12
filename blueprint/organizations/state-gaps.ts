import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as d from "./data.ts";
export const decision_organizations_state_gaps = defineDecision({
  id: "organizations.cut-state-gaps", title: "Old head-app transitions retain no active driver",
  question: "Why do the old app gaps stand after the hosted-FDE closure?",
  options: [{ label: "retain", text: "org-app.install was the connected-head installed-app acknowledgement; remove withdrew a wanted head app; want_again requested a removed app again. Hosted sites install all supported apps. Feature off retains installation and data, and feature on uses site-feature; neither is these transitions. Hosted org-fde transitions are now archived by organizations.hosted-fde-closure, not standing gaps or passed checks." }],
  chosen: "retain", why: "sites.features-reachability replaces the optional-head app model. The existing three app gaps remain unchanged. cut.fde-parked removes hosted-runtime declarations, not ordinary Core agent changes.",
  source: "Builder m1-gaps-states; sites.features-reachability; cut.fde-parked; organizations.hosted-fde-closure, 12 November 2026",
  stands: ["install", "remove", "want_again"].map((transition) => ({
    record: `transition:org-app.${transition}`, rule: "undriven-transition",
    why: "sites.features-reachability replaces the optional-head app model. No hosted-FDE behavior is restored.",
  })),
  affects: [d.machine_org_app.t.install, d.machine_org_app.t.remove, d.machine_org_app.t.want_again],
});
