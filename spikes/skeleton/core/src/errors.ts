// Errors are values with a code. `refused` means the system said no by its own rules (permission, hat, feature, validation); otherwise the
// outcome is `failed` (something was unreachable or broke). The message is the reason; `detail` is what the other side said.
export class CliError extends Error {
  code: string; refused: boolean; detail?: unknown;
  constructor(message: string, code = "FAILED", refused = false, detail?: unknown) { super(message); this.code = code; this.refused = refused; this.detail = detail; }
}
export const refuse = (code: string, message: string, detail?: unknown): CliError => new CliError(message, code, true, detail);
