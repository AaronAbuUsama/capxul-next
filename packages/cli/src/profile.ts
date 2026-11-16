// The caller's profile (roadmap item 3.9; the blueprint's `CLI_COMMANDS`): the account's address, the operator's
// token and the current world, kept in one file under `CAPXUL_HOME` (by default `~/.capxul`) that only its owner may
// read. `capxul login` writes the account and the token, `capxul logout` forgets the token, `capxul use` sets the
// world. It is read only when a command needs something the environment's variables do not give, so a call made with
// every variable set (the runner's `--via=cli`) never touches the disk. This is the command line's profile edge
// (.oxlintrc.json, settings.capxul.jsonEdges and schemaEdges): the profile is a JSON file of its own format.
import { Values } from "@capxul/blueprint";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as CliError from "effect/cli/CliError";

/** What the profile keeps. Each part may be missing: a world can be set before signing in, a token forgotten. */
const Profile = Schema.Struct({
  /** The account's address, what `CAPXUL_PLATFORM_URL` names. */
  account: Schema.optional(Schema.String),
  /** The operator's token, read from standard input by `capxul login`. */
  token: Schema.optional(Schema.String),
  /** The current world, set by `capxul use`. */
  world: Schema.optional(Values.WorldName),
});

export type Profile = typeof Profile.Type;

const ProfileText = Schema.fromJsonString(Profile);

/** Only the owner reads or writes the profile and its folder. */
const FILE_MODE = 0o600;
const FOLDER_MODE = 0o700;

const failed = (userMessage: string) => (cause: unknown) => CliError.UserError.make({ cause, userMessage });

/** The profile's folder: `CAPXUL_HOME`, or `.capxul` in the caller's home. */
const home = Effect.gen(function* () {
  const path = yield* Path.Path;
  const given = yield* Config.option(Config.String("CAPXUL_HOME"));
  if (Option.isSome(given)) return given.value;
  const own = yield* Config.String("HOME");
  return path.join(own, ".capxul");
}).pipe(Effect.mapError(failed("set CAPXUL_HOME, the folder the profile is kept in")));

const fileOf = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(yield* home, "profile.json");
});

/** The profile as it is kept; empty when there is none yet. */
export const readProfile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* fileOf;
  const there = yield* Effect.mapError(fs.exists(file), failed(`cannot read the profile at ${file}`));
  if (!there) return {} satisfies Profile;
  const text = yield* Effect.mapError(fs.readFileString(file), failed(`cannot read the profile at ${file}`));
  return yield* Effect.mapError(
    Schema.decodeEffect(ProfileText)(text),
    failed(`the profile at ${file} is not one capxul wrote; sign in again with capxul login`),
  );
});

/** Keeps `profile`, readable by its owner alone. */
export const writeProfile = (profile: Profile) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const folder = yield* home;
    const file = yield* fileOf;
    const text = yield* Effect.orDie(Schema.encodeEffect(ProfileText)(profile));
    yield* Effect.mapError(
      Effect.andThen(
        fs.makeDirectory(folder, { recursive: true, mode: FOLDER_MODE }),
        Effect.andThen(fs.writeFileString(file, text, { mode: FILE_MODE }), fs.chmod(file, FILE_MODE)),
      ),
      failed(`cannot write the profile at ${file}`),
    );
  });

/** Changes the profile with `change` and keeps it. */
export const updateProfile = (change: (profile: Profile) => Profile) =>
  Effect.flatMap(readProfile, (profile) => writeProfile(change(profile)));
