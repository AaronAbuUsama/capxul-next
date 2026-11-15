// The envelope's attribute names this lane writes before the blueprint's envelope (#301) reaches master: the lane's one
// home for them (roadmap 4.4). Each is #301's name; when #301 lands, these are imported from the blueprint and this
// file goes.

/** A run's attributes, on the resource of every producer of the run. */
export const RUN_ATTRIBUTES = {
  /** True only for a run in GitHub Actions; a run from an agent's container is never trusted. */
  trusted: "capxul.run.trusted",
  /** The commit the code was built from. */
  revision: "vcs.ref.head.revision",
  /** The branch it ran on. */
  ref: "vcs.ref.head.name",
  /** The GitHub Actions run, in CI. */
  pipelineRun: "cicd.pipeline.run.id",
} as const;
