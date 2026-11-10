// Parties' Core SDK flows. Parties owns no frozen operation, so these serve one surface other than
// the CLI: the web app's setup page, the link `auth login` and `account retry` give a person whose
// account is not ready ("the web link where you finish setup"), and its profile settings.

import { Schema } from "effect";
import { budget, defineFlow } from "../../packages/blueprint-engine/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { rpc_parties_profiles_get, rpc_parties_profiles_save } from "./profiles.ts";

const SDK = "packages/sdk/src/profiles";

export const flow_client_me_profile_save = defineFlow({
  id: "client.me.profile.save",
  title: "Complete or change your profile (web app)",
  about:
    "Serves the web app's setup page and profile settings (react surface), not the CLI. One rpc: the page uploads a " +
    "photo first through media's own upload, then saves the profile with the file it got. The old onboarding's handle " +
    "check, payout addresses and account step are not here: a person has no handle, payout wallets are their Safe, and " +
    "the Safe's setup is accounts' flow, which the page runs next.",
  component: component_core_sdk,
  surfaces: ["react"],
  sdk: "client.me.profile.save",
  input: rpc_parties_profiles_save.input,
  output: rpc_parties_profiles_save.output,
  steps: [{ name: "save", rpc: rpc_parties_profiles_save }],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("write"),
  was: [`${SDK}/details.ts:115`, `${SDK}/onboarding-records.ts:51`],
});

export const flow_client_me_profile_get = defineFlow({
  id: "client.me.profile.get",
  title: "Read your profile (web app)",
  about:
    "Serves the web app's setup page and profile settings (react surface), not the CLI: whether the person has " +
    "completed their profile, and what they gave. One rpc.",
  component: component_core_sdk,
  surfaces: ["react"],
  sdk: "client.me.profile.get",
  input: Schema.Struct({}),
  output: rpc_parties_profiles_get.output,
  steps: [{ name: "get", rpc: rpc_parties_profiles_get }],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("read"),
  was: [`${SDK}/details.ts:113`],
});
