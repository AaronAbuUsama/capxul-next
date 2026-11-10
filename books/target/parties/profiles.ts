// Parties' one area of rpcs: a person's own profile, from the web app's setup page. Parties owns
// no frozen operation (OPERATION_OWNERS), so these two rpcs are reached by the Core SDK flows in
// ./flows.ts that serve that page. Every other concept reaches parties through ./procedures.ts or
// by reading its tables.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_parties } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import { machine_party, table_parties, table_profiles } from "./data.ts";
import { table_files } from "../media/data.ts";

const OLD = "packages/backend/src/profiles";

/** A person's profile as they see it: the public half from their Party, the private half from their profile. */
const Profile = Schema.Struct({
  party_id: Schema.String,
  display_name: Schema.String,
  photo_file_id: Schema.NullOr(Schema.String),
  country: Schema.String,
  safe_address: Schema.String,
  created_at: Schema.Number,
  updated_at: Schema.Number,
});

export const rpc_parties_profiles_save = defineRpc({
  id: "parties.profiles.save",
  title: "Complete or change your profile",
  about:
    "The person completes their profile on the setup page, or changes it later, in one transaction. Every input is " +
    "checked before the first write: a display name of 1 to 80 characters once trimmed, a country that is an ISO 3166-1 " +
    "alpha-2 code (uppercased), and a photo that is a media file the person uploaded, read at their own key with purpose " +
    "`image` and state `kept`, else INVALID_INPUT on `photo_file_id` (or none, which keeps the stored one; null clears it). The first save makes their Party theirs: the Party at their " +
    "mailbox's digest is claimed (`claim`), or the outside Party at their mailbox's derived Safe, keeping the id that " +
    "payments, contacts and invitations already point at; with neither, a new active Party is born (`onboard`). Its " +
    "owner becomes the person, its Safe the one their mailbox derives, its kind `person`. The profile row is written in the " +
    "same transaction. A later save changes the display name, photo and country only: no transition. A repeat with the " +
    "same values changes nothing. It sends no email and holds no one at the beta gate: the account-ready notice and the " +
    "waitlist hold belong to the Safe's setup (accounts).",
  concept: concept_parties,
  kind: "mutation",
  who: "A signed-in person, for their own profile only: the session names the person and their mailbox. An agent has no profile; its Party is registered by agents.",
  input: Schema.Struct({
    display_name: Schema.String,
    country: Schema.String,
    photo_file_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  output: Profile,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_parties, table_profiles, table_files],
  writes: [table_parties, table_profiles],
  drives: [machine_party.t.onboard, machine_party.t.claim],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.parties.profiles.save"],
  budget: budget("write"),
  was: [
    `${OLD}/onboardings/operations/complete.ts:23`,
    `${OLD}/details/operations/create.ts:12`,
    `${OLD}/details/operations/update.ts:12`,
    `${OLD}/rules.ts:14`,
    "packages/backend/src/parties/writes/parties.ts:159",
  ],
});

export const rpc_parties_profiles_get = defineRpc({
  id: "parties.profiles.get",
  title: "Read your profile",
  about:
    "The signed-in person's own profile: their Party's display name, photo and Safe with their profile's country, or " +
    "null when they have not completed it yet, so the setup page knows what to ask. It reads only the caller's own rows " +
    "(the profile by `person_id`, the Party it points at) and never another person's.",
  concept: concept_parties,
  kind: "query",
  who: "A signed-in person, for their own profile only.",
  input: Schema.Struct({}),
  output: Schema.NullOr(Profile),
  errors: [error_NOT_AUTHENTICATED],
  reads: [table_parties, table_profiles],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.parties.profiles.get"],
  budget: budget("read"),
  was: [`${OLD}/details/operations/get.ts:11`],
});
