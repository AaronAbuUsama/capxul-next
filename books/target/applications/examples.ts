// The examples of the applications operations: `doctor` and the publishable keys (`key ...`, `dev key`). Hannah Okafor
// holds the keys of Northwind Trading's web app, `default`. Times in a key are epoch milliseconds. The raw key shows once.

import {
  error_CLI_CONFIG,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_NETWORK_ERROR,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_INVALID_INPUT,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { NORTHWIND, ok, refused, uuid } from "../shared/examples.ts";

const ms = (iso: string) => Date.parse(iso);
const ORIGIN = "https://app.northwind.test";
const RAW_KEY = "pk_test_9fA3kQ7wLm2XvB8nTz4cYe6D";
const NEW_RAW_KEY = "pk_test_Hs5uRj1oPd0GaE3iNq8bWx7C";

const key = (n: number, over: Record<string, unknown> = {}) => ({
  id: `key_${uuid(n)}`,
  applicationId: `app_${uuid(1150)}`,
  app: "default",
  prefix: "pk_test_9fA3",
  hint: "6D",
  environment: "test",
  origins: [ORIGIN],
  state: "active",
  createdAt: ms("2026-02-03T10:00:00Z"),
  graceEndsAt: null,
  revokedAt: null,
  lastUsedAt: ms("2026-02-10T08:12:00Z"),
  ...over,
});

const KEY = key(1151);

export const examples_doctor = [
  ok("Check the local setup, offline", "capxul doctor --json", {
    runtime: { nodeVersion: "v24.1.0", platform: "darwin" },
    application: { configured: true, target: "devnet", bootstrapOrigin: "http://localhost:3000" },
    network: { status: "not_checked" },
    collection: { enabled: false, reason: "environment" },
  }),
  ok("Check it online, and time the round trip to the backend", "capxul doctor --online --json", {
    runtime: { nodeVersion: "v24.1.0", platform: "darwin" },
    application: { configured: true, target: "devnet", bootstrapOrigin: "http://localhost:3000" },
    network: { status: "ok", deployment: "town", commit: "a3f9c1e", backendAt: ms("2026-02-10T09:30:00Z"), durationMs: 184 },
    collection: { enabled: false, reason: "environment" },
  }),
  refused("--online with no application key configured", "capxul doctor --online --json", error_CLI_CONFIG),
  refused("The online check passes its deadline", "capxul doctor --online --timeout-ms 2000 --json", error_NETWORK_ERROR),
  refused("A flag doctor does not have", "capxul doctor --verbose --json", error_CLI_USAGE),
];

export const examples_key_create = [
  ok("Hannah makes the first key, which makes the default app", `capxul key create --origin ${ORIGIN} --json`, { key: KEY, publishableKey: RAW_KEY }),
  refused("A wildcard origin", "capxul key create --origin https://*.northwind.test --json", error_INVALID_INPUT, { field: "origin" }),
  refused("Twenty keys already work", `capxul key create --app web --origin ${ORIGIN} --json`, error_WRONG_STATE, { limit: 20 }),
  refused("Priya does not hold issue invoices in Northwind", `capxul key create --origin ${ORIGIN} --org ${NORTHWIND.slug} --json`, error_ROLE_PERMISSION_DENIED),
];

export const examples_key_list = [
  ok("Hannah's keys, newest first, revoked ones included", "capxul key list --json", {
    items: [
      key(1152, { prefix: "pk_test_Hs5u", hint: "7C", createdAt: ms("2026-02-10T09:20:00Z"), lastUsedAt: null }),
      key(1151, { state: "grace", graceEndsAt: ms("2026-02-11T09:20:00Z") }),
      key(1153, { prefix: "pk_test_Qw2e", hint: "4A", state: "revoked", createdAt: ms("2026-01-12T10:00:00Z"), revokedAt: ms("2026-01-20T10:00:00Z"), lastUsedAt: ms("2026-01-19T17:00:00Z") }),
    ],
    next: null,
  }),
  refused("Priya is not a member of the organization", `capxul key list --org ${NORTHWIND.slug} --json`, error_ROLE_PERMISSION_DENIED),
  refused("Signed out", "capxul key list --json", error_NOT_AUTHENTICATED),
];

export const examples_key_revoke = [
  ok("Hannah revokes the old key", `capxul key revoke key_${uuid(1153)} --confirm --json`, { id: `key_${uuid(1153)}`, state: "revoked" }),
  refused("A script left out --confirm", `capxul key revoke key_${uuid(1153)} --json`, error_CLI_USAGE),
  refused("The key is someone else's, or missing: it refuses as if signed out", `capxul key revoke key_${uuid(1199)} --confirm --json`, error_NOT_AUTHENTICATED),
];

export const examples_key_rotate = [
  ok("Replace the key, keeping the old one for six hours", `capxul key rotate key_${uuid(1151)} --grace 6h --confirm --json`, {
    active: { key: key(1152, { prefix: "pk_test_Hs5u", hint: "7C", createdAt: ms("2026-02-10T09:20:00Z"), lastUsedAt: null }), publishableKey: NEW_RAW_KEY },
    retired: key(1151, { state: "grace", graceEndsAt: ms("2026-02-10T15:20:00Z") }),
  }),
  refused("A grace period over 30 days", `capxul key rotate key_${uuid(1151)} --grace 45d --confirm --json`, error_CLI_USAGE),
  refused("The key is already in its grace window", `capxul key rotate key_${uuid(1151)} --confirm --json`, error_WRONG_STATE, { state: "grace" }),
  refused("The key is revoked", `capxul key rotate key_${uuid(1153)} --confirm --json`, error_INVALID_INPUT, { field: "id", state: "revoked" }),
];

export const examples_dev_key = [
  ok("Mint a test key for the local app and write it to .env.local", "capxul dev key --json", {
    publishableKey: RAW_KEY,
    convexSiteUrl: "http://localhost:3211",
    authBaseUrl: "http://localhost:3211/auth",
    allowedOrigins: ["http://localhost:3000"],
    origin: "http://localhost:3000",
    envFile: ".env.local",
  }),
  ok("Print the key instead of writing it", "capxul dev key --print --json", {
    publishableKey: RAW_KEY,
    convexSiteUrl: "http://localhost:3211",
    authBaseUrl: "http://localhost:3211/auth",
    allowedOrigins: ["http://localhost:3000"],
    origin: "http://localhost:3000",
    envFile: null,
  }),
  refused("The origin is not local", "capxul dev key --origin https://app.northwind.test --json", error_CLI_USAGE),
  refused("The folder is not writable", "capxul dev key --json", error_CLI_STORAGE),
  refused("The deployment's test-key quota is used", "capxul dev key --json", error_RATE_LIMITED, { minutes: 12 }),
  refused("On production", "capxul dev key --env production --json", error_WRONG_ENVIRONMENT),
];
