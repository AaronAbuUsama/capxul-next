// The resource attribute keys the collector stamps, as the blueprint's envelope (#301) declares them. Kept here, in one
// place, until the interim constants file the collector builder adds in `packages/platform` exists; then the tests
// import them from there and this file goes.
export const KEYS = {
  world: "capxul.world",
  stage: "capxul.stage",
  /** The grade: `private`, `shared` or `real`. */
  grade: "deployment.environment.name",
} as const;
