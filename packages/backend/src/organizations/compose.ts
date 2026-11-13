// Organizations' composition for Core's main: the setups' bearer routes and the setup runner, with the other concepts'
// doors bound here (organizations.setup-composition). Everything comes from Core's env and the world's deployment file.
import { readFileSync } from "node:fs";
import { readPrincipal, type GateCatalogue } from "../access/door.ts";
import { eligibility } from "../accounts/door.ts";
import { open } from "../approvals/door.ts";
import { worldNow } from "../devnet/door.ts";
import { requireImage } from "../media/door.ts";
import { required } from "../platform/config.ts";
import type { Database, Sql } from "../platform/db.ts";
import { organizationsRoutes } from "./mount.ts";
import type { SetupProcessServices } from "./process.ts";
import { setupRunner, setupServicesFromEnv } from "./runner.ts";
import type { Board, SetupServices } from "./setups.ts";

/** The gate begin's eligibility reads: deployment code's catalogue, never a request's. */
const CATALOGUE: GateCatalogue = { "beta-access": { target: "person", money: false } };
/** How long the founder has to sign the install before it expires and `org retry` reopens it. */
const INSTALL_WINDOW_MS = 7 * 86_400_000;

/** The ready Organization's Board: the company Safe's indexed owners, threshold and nonce, and its waiting proposals. */
async function board(sql: Sql, chainId: number, safe: string): Promise<Board | null> {
  const s = (await sql.query("select owners,threshold,nonce from app.safe_owners where chain_id=$1 and safe_address=$2", [chainId, safe.toLowerCase()])).rows[0];
  if (!s) return null;
  // Board's proposals, when Board is migrated in this world; without its table there are none to wait for.
  const boardMigrated = (await sql.query("select to_regclass('app.board_proposals') is not null as ok")).rows[0].ok;
  const waiting = boardMigrated ? (await sql.query(`select count(*)::int as n from app.board_proposals where chain_id=$1
    and safe_address=$2 and status='awaiting_approvals'`, [chainId, safe.toLowerCase()])).rows[0].n : 0;
  return { directors: s.owners.length, threshold: Number(s.threshold), nonce: Number(s.nonce), waitingProposals: waiting };
}

/** Capxul's FDE host (integration fde-host): `POST {url}/agents/provision {orgId}` with the host token answers the agent
 * id and the key's address; the host keeps the key. Without a host in this world's env, provisioning fails closed, so a
 * setup with its FDE stalls (provider_unavailable) after the retries instead of inventing a key. */
function fdeHost(url: string | undefined, token: string | undefined): SetupProcessServices["fdeHost"] {
  return {
    async provision({ orgId }) {
      if (!url || !token) throw new Error("PROVIDER_ERROR: no FDE host is composed in this world");
      let response: Response;
      try {
        response = await fetch(`${new URL(url).origin}/agents/provision`, { method: "POST", redirect: "error",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ orgId }), signal: AbortSignal.timeout(10_000) });
      } catch { throw new Error("PROVIDER_ERROR: FDE host unreachable"); }
      if (!response.ok) throw new Error(`PROVIDER_ERROR: FDE host answered ${response.status}`);
      const body = await response.json().catch(() => null) as { agentId?: unknown; signer?: unknown } | null;
      if (body?.agentId !== `fde:${orgId}` || typeof body.signer !== "string") throw new Error("PROVIDER_RESPONSE_INVALID: FDE host answer");
      return { agentId: body.agentId, signer: body.signer };
    },
  };
}

export function composeOrganizations(db: Database, chainId: number) {
  const deployment = JSON.parse(readFileSync(required("DEPLOYMENT_FILE"), "utf8")) as Record<string, string>;
  const companySafe = { companiesHouse: deployment.companiesHouse as `0x${string}`, namespace: required("COMPANY_SAFE_NAMESPACE") };
  const siteUrl = required("SITE_URL");
  const setupServices = (now: number): SetupServices => ({
    chainId, companySafe, pricedCurrencies: [], board, requireImage,
    async eligibility(sql) {
      const principal = await readPrincipal(sql, (await sql.query("select current_setting('app.person_id',true) as id")).rows[0].id);
      if (!principal) throw new Error("NOT_AUTHENTICATED: person session required");
      return eligibility(sql, principal, CATALOGUE, now);
    },
  });
  const processServices: SetupProcessServices = setupServicesFromEnv(db, {
    installWindowMs: INSTALL_WINDOW_MS,
    // Approvals.open with the founder as person and the founder's Safe as sender, at the world's instant.
    open: async (sql, founder, terms, trace) => open(sql, { person_id: founder.personId, sender: founder.safe, site_url: siteUrl,
      now: new Date(await worldNow(sql)) }, terms, trace),
    fdeHost: fdeHost(process.env.FDE_HOST_URL, process.env.FDE_HOST_TOKEN),
  });
  const runner = setupRunner(db, processServices, { now: () => db.transaction("", worldNow, true),
    log: (orgId, error) => console.error(`Organizations setup ${orgId}: ${(error as Error)?.message ?? error}`) });
  return { routes: organizationsRoutes(setupServices), work: { name: "organizations setups", tick: () => runner.tick() } };
}
