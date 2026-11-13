// The SDK's door: a typed client of every blueprint operation, derived from the blueprint, and how it reaches the
// platform and a world's door. `TestDoor` serves the blueprint's groups in this process, for tests.
export { callByName, layer, make, platformClient, spanName, traceparent, worldClient } from "./client.ts";
export {
  isOperationName,
  isPlatformName,
  isWorldName,
  names,
  platformNames,
  worldNames,
  type Call,
  type CallOptions,
  type Client,
  type Full,
  type Payload,
  type PlatformName,
  type Refusal,
  type Success,
  type WorldName,
} from "./operations.ts";
export {
  PlatformDoor,
  platformDoor,
  reach,
  ReachDoors,
  reachFromConfig,
  platformDoorFromConfig,
  platformTarget,
  WorldDoor,
  worldDoor,
  worldDoorFromConfig,
  worldTarget,
  type Door,
  type JsonRpc,
  type Operator,
  type Reach,
  type ReachSpec,
  type Target,
} from "./transport.ts";
export * as TestDoor from "./test-door.ts";
