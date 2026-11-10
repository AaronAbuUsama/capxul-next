// Media's Core SDK flows. Media owns no frozen operation, so these serve surfaces other than the
// CLI: the web app's pages that upload a profile photo or an Organization's logo, and every page
// that shows one (the web app, the approval page, the checkout page). Banking's `verify start`
// flow composes `media.files.upload` itself, as one of its steps. Decision: media.flows.

import { Schema } from "effect";
import { budget, defineFlow } from "../../packages/blueprint-engine/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { rpc_media_files_get, rpc_media_files_upload } from "./files.ts";

const SDK = "packages/sdk/src/media";

export const flow_client_media_upload = defineFlow({
  id: "client.media.upload",
  title: "Upload a photo or a logo (web app)",
  about:
    "Serves the web app's setup page, profile settings and Organization creation (react surface), not the CLI. The page " +
    "hands it the file the person chose; it checks the type and size on the device first, so a file media would refuse " +
    "is never sent, then uploads it in one rpc and returns the file id the page saves with the profile " +
    "(`client.me.profile.save`) or the new Organization (`client.onboarding.beginOrganization`). It never binds the file " +
    "itself: the record that points at it does, in its own write.",
  component: component_core_sdk,
  surfaces: ["react"],
  sdk: "client.media.upload",
  input: Schema.Struct({
    purpose: Schema.Literal("image"),
    content_type: Schema.String,
    bytes: Schema.Uint8Array,
  }),
  output: rpc_media_files_upload.output,
  steps: [
    { name: "check", local: "build", about: "Checks the declared type is JPEG, PNG or WebP and the size at most 5 MiB, before anything is sent." },
    { name: "upload", rpc: rpc_media_files_upload, about: "Stores the image; media checks it again and answers its file id." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: {
    ...budget("write"),
    p50Ms: 1_200,
    p95Ms: 4_000,
    why: "sends the person's image, up to 5 MiB from a browser, before the server's share",
  },
  was: [`${SDK}/images.ts:91`],
});

export const flow_client_media_fetch_image = defineFlow({
  id: "client.media.fetch-image",
  title: "Show a photo or a logo, by its file id (web app)",
  about:
    "Serves every page that shows a Party's photo or an Organization's logo (react surface: the web app, the approval " +
    "page, the checkout page), not the CLI. A file never changes, so it keeps the bytes by file id on the device and asks " +
    "the backend only for an id it has not seen. Null when the id names no image.",
  component: component_core_sdk,
  surfaces: ["react"],
  sdk: "client.media.fetchImage",
  input: Schema.Struct({ file_id: Schema.String }),
  output: rpc_media_files_get.output,
  steps: [
    { name: "cached", local: "cache", about: "Answer from the copy kept by file id, when there is one: it can never be stale." },
    { name: "get", rpc: rpc_media_files_get, about: "Otherwise read the image once, and keep it." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("read"),
  was: [`${SDK}/images.ts:5`],
});
