/**
 * Nominal type helper. `Brand<T, B>` is structurally a `T` at runtime but
 * distinct at compile time, preventing accidental swaps between primitives.
 *
 * @internal
 */
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };
