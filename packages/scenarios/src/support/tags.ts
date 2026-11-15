// A declared refusal's or outcome's tag, taken from its class, so a journey names it by import and never writes it as
// a string (capxul/declared-names). The class's `identifier` is its tag at run time; Effect types it as any string,
// so it is typed here as the tag its instances carry.

/** The tag of a declared refusal or outcome, by its class: `tag(Errors.InvitationClosed)` is `"InvitationClosed"`. */
export const tag = <const T extends string>(declared: {
  readonly identifier: string;
  new (...args: never): { readonly _tag: T };
}): T =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged class's `identifier` is the `_tag` of its instances (Effect's TaggedClass and TaggedError), which the compiler types only as string.
  declared.identifier as T;
