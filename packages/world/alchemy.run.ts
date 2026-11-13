// The stack with the placeholder Core, for the commands that only need the stack's name, providers and state store
// (`alchemy state list`, `alchemy drift`, and this package's own reads of the shared state). A world is never
// deployed with the alchemy command line: use `./run.sh create`.
import PlaceholderCore from "./src/core/Placeholder.ts";
import { worldStack } from "./src/stack/stack.ts";

export default worldStack(PlaceholderCore);
