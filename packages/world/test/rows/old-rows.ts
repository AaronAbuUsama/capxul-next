// Rows of a world's database as some earlier code wrote them (test/old-rows.test.ts): the migrations that world had
// applied when they were written, and the rows the platform's facts read. One file per format, never edited.
export interface OldRows {
  /** Which world and which code wrote them. */
  readonly written: string;
  /** Core's migrations applied when they were written, in order. */
  readonly applied: ReadonlyArray<string>;
  readonly world: { readonly chain_id: number; readonly contracts: Readonly<Record<string, string>> };
  readonly clock: { readonly mode: string; readonly frozen_at_ms: number | null; readonly offset_ms: number };
  readonly cast: ReadonlyArray<{
    readonly person: string;
    readonly email: string;
    readonly signer: string;
    readonly safe: string | null;
  }>;
  readonly companies: ReadonlyArray<{
    readonly org: string;
    readonly handle: string;
    readonly name: string;
    readonly site_state: string;
    readonly site_url: string | null;
  }>;
  /** What the record's `world_created` carried of how the world was made. */
  readonly born: { readonly grade: string; readonly parent: unknown };
}
