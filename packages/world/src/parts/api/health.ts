// The api's facts, as the world needs them, from the api's own door (packages/core): the one path that says the api is
// up (src/probe.ts), and the region its data lives in, so a world's database sits beside its Worker (src/stack/region.ts).
// A world is not ready until the health path answers 200.
export { HEALTH_PATH as CORE_HEALTH, DATABASE_REGION } from "@capxul/core";
