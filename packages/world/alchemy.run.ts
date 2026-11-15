// The stack with the default Core, for the commands that only need the stack's name, providers and state store
// (`alchemy state list`, `alchemy drift`, and this package's own reads of the shared state). A world is never
// deployed with the alchemy command line: use this package's `world create`.
import { defaultCore } from "./src/parts/api/Api.ts";
import { worldStack } from "./src/things/world/stage.ts";

export default worldStack(defaultCore);
