// The package's door: how a scenario is declared, the client it is handed, and every registered scenario. The
// runner imports this; a scenario imports only the blueprint and this package's own files.
export { Capxul, type CallOptions, type CapxulClient, type Failure } from "./client.ts";
export { scenarios } from "./registry.ts";
export {
  claimOf,
  example,
  ExpectationFailed,
  expect,
  scenario,
  type Proves,
  type Run,
  type Scenario,
} from "./scenario.ts";
