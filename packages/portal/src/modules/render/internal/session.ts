/** An example as a terminal shows it: the command line after a prompt, what it printed, and its exit code. */
import type { ExampleView } from "#src/modules/site/types.ts";

import { highlight } from "./highlight.ts";
import { esc } from "./html.ts";

export const sessionView = (e: ExampleView): string =>
  `<figure class="code session"><figcaption class="code-label">Example · ${esc(e.title)}${e.exit === 0 ? "" : " · refusal"}</figcaption>` +
  `<pre class="code-body"><code><span class="tk-prompt">$ </span>${highlight(e.input, "bash")}\n${highlight(e.output, "json")}\n` +
  `<span class="tk-com"># exit ${e.exit}</span></code></pre></figure>`;
