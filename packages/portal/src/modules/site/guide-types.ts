/**
 * The Blueprint page: the guide to the blueprint in plain words (docs/blueprint-guide.md), with tables generated from the
 * real blueprint where the document marks them, so its counts and its worked example cannot go stale.
 */
import type { PageHead, TableSection } from "./types.ts";

/** One binding file, `evals/bindings/<area>.json`: which checks prove which evals, and the near-misses. */
export interface BindingFile {
  readonly file: string; readonly area: string; readonly script: string;
  readonly bindings: readonly { readonly eval: string; readonly checks: readonly string[]; readonly why: string }[];
  readonly near: readonly { readonly eval: string; readonly checks: readonly string[]; readonly missing: string }[];
}

/** What the Blueprint page is made from beyond the blueprint itself. The loader reads it; the site module reads no file. */
export interface GuideInput {
  /** The document's path and its text: `## ` sections, with `<!-- generated: <name> -->` lines where a table goes. */
  readonly document: string; readonly text: string;
  /** The operation the page follows from record to verdict, and which of its acceptance lines (from 1). */
  readonly follow: { readonly operation: string; readonly line: number };
  readonly bindings: readonly BindingFile[];
  /** How many of the old operations the cut classifies, by fate (blueprint/shared/cut.ts). */
  readonly cut: Readonly<Record<string, number>>;
  /** Facts about the repository the document states as true today, read again on every generation. */
  readonly repo: {
    readonly generatedFolders: number; readonly ciWorkflows: number;
    readonly testRunsBlueprint: boolean; readonly testRunsFrozen: boolean;
  };
}

/** A piece of a section: Markdown as the document wrote it, or a table the site made from the blueprint. */
export type GuidePart = { readonly t: "md"; readonly text: string } | { readonly t: "table"; readonly table: TableSection };
export interface GuideSection { readonly heading: string; readonly anchor: string; readonly parts: readonly GuidePart[] }

export interface GuidePage extends PageHead {
  readonly type: "guide"; readonly commit: string; readonly present: boolean;
  readonly intro: readonly GuidePart[]; readonly sections: readonly GuideSection[];
  /** Markers in the document that name no table the site makes: the portal check fails on any. */
  readonly unknownMarkers: readonly string[];
}
