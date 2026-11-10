/**
 * The shape of the hand-written content in `direction.ts`: the words and the picture the book does not hold yet.
 * The site module reads it as part of its input and re-exports these types beside its own.
 */

/** A titled line: one step of a short list. */
export interface Step { readonly title: string; readonly text: string }


/** The re-cut verdict of one concept. `none` until the re-cut gives it one. */
export type Verdict = "none" | "core" | "frappe" | "dropped";
export interface DiagramNode {
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly tone: "plain" | "core" | "frappe" | "rule"; readonly title: string;
  /** A remark beside the title, or "". */
  readonly note: string; readonly text: string; readonly chips: readonly string[];
}
export interface DiagramEdge {
  readonly x: number; readonly y: number; readonly length: number;
  readonly direction: "down" | "right" | "left"; readonly tone: "grey" | "blue";
  /** Words beside the arrow, or "". */
  readonly label: string; readonly labelX: number; readonly labelY: number;
}
export interface Diagram {
  readonly width: number; readonly height: number;
  readonly nodes: readonly DiagramNode[]; readonly edges: readonly DiagramEdge[];
}
export interface Direction {
  /** The GitHub repository an answer is filed against, who answers, and the label the issue takes. */
  readonly settings: { readonly repo: string; readonly reviewer: string; readonly issueLabel: string };
  readonly hero: { readonly eyebrow: string; readonly title: string; readonly lead: string; readonly sub: string };
  readonly needsYou: string;
  /** The status lines of the climb's cards that the book cannot compute. */
  readonly climb: { readonly specify: string; readonly build: string; readonly prove: string };
  readonly banner: { readonly title: string; readonly text: string };
  /** One verdict per concept id. A concept not named here has none. */
  readonly verdicts: Readonly<Record<string, Verdict>>;
  readonly verdictNote: string;
  readonly questions: { readonly lead: string; readonly answerSteps: readonly Step[] };
  readonly architecture: {
    readonly title: string; readonly lead: string; readonly diagram: Diagram;
    /** Decision ids whose titles say how this portal is deployed. */
    readonly portalDecisions: readonly string[];
    /** The operation the page traces end to end. */
    readonly traceOperation: string;
    /** Where the Frappe boundary is found: the component id, the outside system an integration names, and the word. */
    readonly boundary: { readonly component: string; readonly system: string; readonly word: string };
    readonly changeSteps: readonly Step[];
  };
}
