# Capxul CLI

The public CLI calls the product SDK; it has no bench subprocesses or operator secrets. This first slice implements only the site-provisioning stage, not the complete onboarding command family.

Run `node --experimental-strip-types --no-warnings packages/cli/src/main.ts org site provision --org <slug> --confirm --json` after the company's real v4 birth and trusted Core registration. `CAPXUL_CORE_URL` identifies Core; `CAPXUL_ACCESS_TOKEN` is the person's Access session, sent to Core as `Authorization: Bearer` exactly as for `doc` and `report` commands. No wallet key or signature is used, and the session never reaches the site service.

The SDK verifies response identity and exposes named refusals. JSON success goes to stdout, JSON errors to stderr; exit 0 means provisioned and delivery released, not that all first events have landed. Usage errors exit 2; other refusals exit 1. See `packages/site-service/README.md` for the backend boundary and integrated-run prerequisites.

`world` commands dispatch first to the supervisor-owned `src/devnet.ts` adapter, exported as `runDevnet(args: string[]): Promise<number>`. It receives the complete argument list, including the leading `world`, and its returned exit code is preserved. The adapter is loaded lazily so provisioning does not initialize the world runtime. The supervisor supplies that file alongside its `@capxul/devnet` implementation at integration; this package does not implement a second world CLI.
