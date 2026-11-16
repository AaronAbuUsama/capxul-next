// Each journey's own cast (roadmap step 4.11, "a cast per journey"; docs/roadmap.md, "One shared world, every journey
// side by side"). Journeys run side by side in one world, each with its own people and its own company, so no two
// share a person's Safe, its nonce or a company. A journey's story names people by their role (dana founds, sam keeps
// the books); who plays each role in a journey is declared here once, and the world that makes the people, the
// runner that founds each journey's company and the scenarios that act as them all import it.
//
// A journey is known by its key. Its people are `<role>-j<n>`, `n` its place in `JOURNEY_KEYS` from 1; each signs in
// with `<person>@cast.test` and signs with the test mnemonic's account `CAST_KEY_BASE + 8n + r`, `r` the role's place
// in `CAST_ROLES` (Values.CAST_KEYS has the mnemonic). Its company's handle is `<company>-j<n>`.
import * as Arr from "effect/Array";
import * as Option from "effect/Option";

/** The roles a story names, in order, and whether the person playing it has a claimed personal Safe. */
export const CAST_ROLES = [
  { role: "dana", claimed: true },
  { role: "eli", claimed: true },
  { role: "sam", claimed: true },
  { role: "pat", claimed: false },
  { role: "olga", claimed: true },
] as const;

export type CastRole = (typeof CAST_ROLES)[number]["role"];

/**
 * Every journey's key, in the order their numbers are given: a journey's people and company are numbered by its place
 * here, from 1. A new journey appends its key; a key is never reused or moved, so a number always means one journey.
 */
export const JOURNEY_KEYS = ["twoop", "invent", "branch", "found", "pay", "invite", "seat", "budget", "nogo"] as const;

export type JourneyKey = (typeof JOURNEY_KEYS)[number];

/** The company a story founds, by the handle the starting points name it with: a journey's own is `castCompany`'s. */
export const CAST_COMPANY = "northwind";

/**
 * The first test account a journey's cast signs with: clear of the world's own cast's and services' (0 to 10). Every
 * private and shared world is born with its own cast (a real world has none), test accounts 4 to 8 (dana, eli, sam,
 * pat, olga): clear of the faucet's operator (0), Companies House's Directors (0 to 2), its claim service (3) and the
 * bundler's keys (9, 10). Each Safe but pat's is claimed through Companies House's devnet claim role and minted 10,000
 * test USDC from the token's open mint function, the world's faucet (Aaron, 13 November 2026).
 */
export const CAST_KEY_BASE = 20;

/** The accounts of the test mnemonic that cover every journey's cast. */
export const CAST_KEY_ACCOUNTS = CAST_KEY_BASE + 8 * (JOURNEY_KEYS.length + 1);

/** The domain every person of a cast signs in at. */
export const CAST_DOMAIN = "cast.test";

/** A journey's number: its place in `JOURNEY_KEYS`, from 1. */
export const journeyNumber = (key: JourneyKey): number => JOURNEY_KEYS.indexOf(key) + 1;

/** The person who plays `role` in journey `key`. */
export const castPerson = (key: JourneyKey, role: CastRole): string => `${role}-j${journeyNumber(key)}`;

/** The email a person of a cast signs in with. */
export const castEmail = (person: string): string => `${person}@${CAST_DOMAIN}`;

/** The handle of journey `key`'s company, whose story calls it `company`. */
export const castCompany = (key: JourneyKey, company: string): string => `${company}-j${journeyNumber(key)}`;

/** The test mnemonic's account the person playing `role` in journey `key` signs with. */
export const castKeyIndex = (key: JourneyKey, role: CastRole): number =>
  CAST_KEY_BASE +
  8 * journeyNumber(key) +
  Option.getOrElse(
    Arr.findFirstIndex(CAST_ROLES, (each) => each.role === role),
    () => 0,
  );

/** One person of a journey's cast. */
export interface CastPerson {
  readonly role: CastRole;
  readonly person: string;
  readonly email: string;
  readonly claimed: boolean;
  readonly keyIndex: number;
}

/** Journey `key`'s whole cast, in the order of the roles, and its company `company`'s handle. */
export const journeyCast = (key: JourneyKey, company: string) => ({
  key,
  company: castCompany(key, company),
  people: Arr.map(CAST_ROLES, ({ role, claimed }): CastPerson => ({
    role,
    person: castPerson(key, role),
    email: castEmail(castPerson(key, role)),
    claimed,
    keyIndex: castKeyIndex(key, role),
  })),
});
