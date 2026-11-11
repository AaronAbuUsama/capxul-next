/**
 * The twins module: a built site in, the files a machine reads out. Every page has two twins beside its HTML:
 * `<page>.md`, the same content as Markdown, and `data/<page>.json`, the page model itself with sorted keys.
 * `llms.txt` at the root is the map of them all.
 */

/** Where the map of the site for a language model is written. */
export const LLMS_FILE = "llms.txt";
