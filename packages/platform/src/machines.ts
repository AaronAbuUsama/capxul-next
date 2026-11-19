// The machines a bench may run on, each declared once with its limits (Aaron, 16 November 2026). Every number names
// where it comes from: a GitHub Actions run (`run <id>`), a file in the repository (a record or the document that
// prices it), or `estimate` until it is measured. The deploy derives the bench host's instance type (aws.ts) and the
// door's pool sizes (bench.ts) from the one machine STAGING_BENCH names, and the door reports that profile on
// `GET /health` and `GET /templates`, so a run can cap the sites it makes at once from it. Changing the staging bench's
// machine is a one-line change to STAGING_BENCH.

/** One limit of a machine, with where it comes from. */
export interface Cap {
  readonly value: number;
  /** `run <GitHub Actions run id>`, a path in the repository, or `estimate`. */
  readonly source: string;
  /** What the source showed, when the number is not read straight from it. */
  readonly note?: string;
}

/** A machine's limits for the bench. */
export interface Machine {
  readonly cpus: Cap;
  readonly memoryGib: Cap;
  /** On demand in London, with its disk. */
  readonly monthlyUsd: Cap;
  /** The company sites the bench makes at once without breaking. */
  readonly sitesAtOnce: Cap;
  /** Ready blank copies kept (the door's DOOR_BLANK_POOL_SIZE, at most 10). */
  readonly blankPool: Cap;
  /** Ready company copies kept (the door's DOOR_COMPANY_POOL_SIZE, at most 10). */
  readonly companyPool: Cap;
}

export const MACHINES = {
  "t3.large": {
    cpus: { value: 2, source: "packages/platform/docs/capacity.md" },
    memoryGib: { value: 8, source: "packages/platform/docs/capacity.md" },
    monthlyUsd: { value: 79, source: "packages/platform/bootstrap/BOOTSTRAP.md" },
    sitesAtOnce: {
      value: 2,
      source: "estimate",
      note: "run 43807337978 broke the bench at 8 at once; runs 43789356026 and 43793700222 stalled at 4",
    },
    blankPool: { value: 8, source: "estimate", note: "one for each company a run founds (roadmap 4.8)" },
    companyPool: { value: 8, source: "estimate", note: "one for each company a run founds (roadmap 4.8)" },
  },
} as const satisfies Record<string, Machine>;

export type MachineType = keyof typeof MACHINES;

/** The staging bench's machine. Rehearsal stages use the same. */
export const STAGING_BENCH: { readonly host: MachineType } = { host: "t3.large" };

/** The most ready copies the door keeps of one template (door/pool.py, BLANK_POOL_MAX). */
export const POOL_MAX = 10;

/** The door's environment derived from the machine: its pool sizes, and the profile it reports. */
export const machineEnvironment = (host: MachineType): Readonly<Record<string, string>> => {
  const machine: Machine = MACHINES[host];
  return {
    BENCH_HOST_TYPE: host,
    BENCH_SITES_AT_ONCE: `${machine.sitesAtOnce.value}`,
    DOOR_BLANK_POOL_SIZE: `${Math.min(machine.blankPool.value, POOL_MAX)}`,
    DOOR_COMPANY_POOL_SIZE: `${Math.min(machine.companyPool.value, POOL_MAX)}`,
  };
};
