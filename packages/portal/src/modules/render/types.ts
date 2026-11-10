/**
 * The render module: a built site in, HTML files out. It draws what the page models say and nothing else:
 * no page reads the book, and no file is read or written here.
 */

/** The stylesheet and the script every page shares, read from `assets/` by the composition root. */
export interface Assets { readonly css: string; readonly js: string }

/** Where the two shared files are written. */
export const STYLE_FILE = "assets/style.css";
export const SCRIPT_FILE = "assets/site.js";
