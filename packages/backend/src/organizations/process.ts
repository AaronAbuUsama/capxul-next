// organizations.setups.set-up (blueprint/organizations/processes.ts): one Organization's setup, as one step function the
// composition drives after begin, after `org retry` and whenever a wait it names may have moved. Each call runs the
// next unfinished step: a network send happens outside any transaction and is recorded idempotently in the next one;
// every chain fact is read from indexing at finality, through injected reads, on the worker's Sql.
import type { Database, Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import { activate, register, release } from "../parties/door.ts";
import type { SetupStatus } from "./setups.ts";

export type Call = { to: string; value: string; data: string };
/** Indexing's numeric MoneyDeployed receipt (Core's readMoneyDeployment). */
export type MoneyDeploymentFact = {
  log_id: string; chain_id: number; block_number: string; tx_hash: string; safe: string; founder_safe: string;
  board_top_hat: string; shareholders_top_hat: string; director_hat: string; officer_hats: string[]; roles: string; gate: string;
};
export type SetupProcessServices = {
  chainId: number; finality: number;
  /** service-signer.send with the company-Safe role: CompanySafeMinter.mint for the handle and founder's Safe. */
  mint(input: { key: string; handle: string; founderSafe: string }): Promise<{ hash: string }>;
  /** service-signer.send with the tier key: Installer.deployMoney, founder the one Director, 1 of 1, officers Books,
   * Invoicing and People. It mints new hats every time it runs, so it is sent once per recorded hash. */
  deployMoney(input: { key: string; safe: string; founderSafe: string }): Promise<{ hash: string }>;
  /** The mined receipt's status, or null while it is not mined. */
  receipt(input: { hash: string }): Promise<"success" | "reverted" | null>;
  facts: {
    /** CompanySafeMinted of the transaction at finality, or null until then. */
    safeMinted(sql: Sql, q: { chainId: number; txHash: string; finality: number }): Promise<{ safe: string; owner: string } | null>;
    /** MoneyDeployed of the transaction for the company Safe at finality, or null until then. */
    moneyDeployed(sql: Sql, q: { chainId: number; txHash: string; companySafe: string; finality: number }): Promise<MoneyDeploymentFact | null>;
    /** The install's facts at finality: the Gate the Safe's only module and guard, the founder's Safe wearing the Director
     * and officer hats, and AgentCreated for the FDE's Safe when there is one. Null until final; false when they differ. */
    installed(sql: Sql, q: { chainId: number; finality: number; safe: string; gate: string; founderSafe: string;
      directorHat: string; officerHats: string[]; fdeSafe: string | null }): Promise<boolean | null>;
  };
  /** buildMoney's batch (USDC, top amount 0, then Hats.mintHat of the officer hats to the founder's Safe), plus
   * AgentOwner.create of the FDE's key when one is recorded, as the company Safe's execTransaction calls. */
  installCalls(input: { deployment: MoneyDeploymentFact; founderSafe: string; fdeSigner: string | null }): Promise<Call[]>;
  /** The FDE host makes or finds the Organization's FDE and keeps its key; the Safe is AgentOwner's for that key. */
  fdeHost: { provision(input: { orgId: string }): Promise<{ agentId: string; signer: string; safe: string }> };
  /** Approvals.open bound to the founder as person and the founder's Safe as sender. */
  open(sql: Sql, founder: { personId: string; safe: string }, terms: {
    org_id: string; opener: "organizations"; subject_kind: "setup"; subject_id: string; chain_id: number; calls: Call[];
    summary: { title: string; from: { label: string; address: string }; to: { label: string }; amount: null; recipients: []; warnings: [] };
    deadline: string;
  }, trace: string): Promise<{ approval_id: string }>;
  /** How long the founder has to sign the install approval. */
  installWindowMs: number;
};
type Reason = "provider_unavailable" | "mint_reverted" | "safe_owner_mismatch" | "deploy_reverted" | "install_refused" |
  "approval_expired" | "approval_declined" | "approval_displaced" | "install_reverted" | "provider_answer_invalid";
export type Advanced = { status: SetupStatus; step: string; moved: boolean };

async function setupRow(sql: Sql, orgId: string) {
  return (await sql.query(`select s.*,o.party_id,o.name,o.safe_address,o.founder_safe,o.founder_party_id,o.chain_id,p.handle
    from app.org_setups s join app.organizations o using(org_id) join app.parties p on p.party_id=o.party_id
    where s.org_id=$1 for update of s`, [orgId])).rows[0];
}
async function transitioned(sql: Sql, row: { org_id: string; founder_principal_id: string }, from: SetupStatus, to: SetupStatus,
  transition: string, issue: Reason | null, now: number, trace: string) {
  await emit(sql, { id: `org-setup:${row.org_id}:${transition}:${from}:${issue ?? ""}:${now}`, name: "org_setup_transitioned", machine: "org-setup",
    entity_id: row.org_id, owner_kind: "organization", owner_id: row.org_id, actor: null, trace_id: trace, at: now,
    props: { from, to, transition, org_id: row.org_id, person_id: row.founder_principal_id, issue_reason: issue } });
}
/** needs_attention with a reason and code; a reverted or ended send is forgotten so `org retry` sends it again. */
async function stall(sql: Sql, row: any, reason: Reason, code: string, now: number, trace: string, forget: Record<string, null> = {}) {
  const sets = Object.keys(forget).map((c) => `${c}=null`).join(",");
  await sql.query(`update app.org_setups set status='needs_attention',issue=$2,checked_at=$3,updated_at=$3${sets ? "," + sets : ""}
    where org_id=$1`, [row.org_id, { reason, code, at: now }, now]);
  await transitioned(sql, row, row.status, "needs_attention", "stall", reason, now, trace);
}
/** Definitive: nothing can finish it. The Organization's Party, and the FDE's, are released while still pending. */
async function fail(sql: Sql, row: any, reason: Reason, code: string, now: number, trace: string) {
  await sql.query("update app.org_setups set status='failed',issue=$2,checked_at=$3,updated_at=$3 where org_id=$1", [row.org_id, { reason, code, at: now }, now]);
  for (const party of [row.party_id, row.fde_party_id].filter(Boolean)) {
    const state = (await sql.query("select state from app.parties where party_id=$1", [party])).rows[0]?.state;
    if (state === "pending") await release(sql, party, now, trace);
  }
  if (row.fde_party_id) {
    await sql.query("update app.org_fdes set status='retired',retire_reason='setup_failed',retired_at=$2,updated_at=$2 where org_id=$1 and status<>'retired'", [row.org_id, now]);
    await emitFde(sql, row, "provisioned", "retired", "retire", now, trace);
  }
  await transitioned(sql, row, row.status, "failed", "fail", reason, now, trace);
}
async function emitFde(sql: Sql, row: any, from: string | null, to: string, transition: string, now: number, trace: string, safe = row.fde_safe) {
  await emit(sql, { id: `org-fde:${row.org_id}:${transition}:${now}`, name: "org_fde_transitioned", machine: "org-fde", entity_id: row.org_id,
    owner_kind: "organization", owner_id: row.org_id, actor: null, trace_id: trace, at: now,
    props: { from, to, transition, org_id: row.org_id, safe_address: safe, paid_through: null } });
}
async function seat(sql: Sql, row: any, m: { party: string; principal: string | null; kind: "human" | "agent"; safe: string; use: "seat" | "organization" },
  now: number, trace: string) {
  const memberId = `${row.org_id}:${m.party}`;
  const added = await sql.query(`insert into app.org_members(org_id,member_id,party_id,principal_id,kind,safe_address,seat_use,status,joined_at,updated_at)
    values($1,$2,$3,$4,$5,$6,$7,'active',$8,$8) on conflict (org_id,party_id) do nothing`,
  [row.org_id, memberId, m.party, m.principal, m.kind, m.safe.toLowerCase(), m.use, now]);
  if (!added.rowCount) return;
  await emit(sql, { id: `org-member:${row.org_id}:${memberId}:seat`, name: "org_member_transitioned", machine: "org-member",
    entity_id: memberId, owner_kind: "organization", owner_id: row.org_id, actor: null, trace_id: trace, at: now,
    props: { from: null, to: "active", transition: "seat", org_id: row.org_id, member_id: memberId, party_id: m.party, kind: m.kind } });
}
const providerCode = (error: unknown) => {
  const m = /^(PROVIDER_RESPONSE_INVALID|PROVIDER_ERROR|INDEXER_NOT_READY)\b/.exec(String((error as Error)?.message));
  if (!m) throw error;
  return m[1]!;
};

/** Runs the setup's next unfinished step. Waiting for a fact, the founder or a terminal state moves nothing. */
export async function advance(db: Database, orgId: string, s: SetupProcessServices, now: number, trace: string): Promise<Advanced> {
  if (!trace) throw new Error("INVALID_INPUT: trace_id required");
  const tx = <T>(run: (sql: Sql, row: any) => Promise<T>) => db.transaction(orgId, async (sql) => {
    const row = await setupRow(sql, orgId);
    if (!row) throw new Error("NOT_FOUND: setup");
    return run(sql, row);
  }, true);
  const snapshot = await tx(async (_, row) => row);
  const done = (step: string, moved = false) => tx(async (_, row) => ({ status: row.status as SetupStatus, step, moved }));
  if (snapshot.status !== "processing") return { status: snapshot.status, step: "none", moved: false };
  const steps: string[] = snapshot.steps;
  // A network answer is recorded only if the setup is still where it was when the call was made.
  const send = async (step: string, column: "mint_tx_hash" | "deploy_tx_hash", call: () => Promise<{ hash: string }>) => {
    let hash: string;
    try { ({ hash } = await call()); }
    catch (error) { return onProvider(step, providerCode(error)); }
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return onProvider(step, "PROVIDER_RESPONSE_INVALID");
    return tx(async (sql, row) => {
      if (row.status !== "processing" || row[column]) return { status: row.status, step, moved: false };
      await sql.query(`update app.org_setups set ${column}=$2,checked_at=$3,updated_at=$3 where org_id=$1`, [orgId, hash.toLowerCase(), now]);
      return { status: row.status as SetupStatus, step, moved: true };
    });
  };
  const onProvider = (step: string, code: string) => tx(async (sql, row) => {
    if (row.status !== "processing") return { status: row.status, step, moved: false };
    if (code === "PROVIDER_RESPONSE_INVALID") await fail(sql, row, "provider_answer_invalid", code, now, trace);
    else await stall(sql, row, "provider_unavailable", code, now, trace);
    return { status: (await setupRow(sql, orgId)).status as SetupStatus, step, moved: true };
  });
  const reverted = (step: string, column: "mint_tx_hash" | "deploy_tx_hash", hash: string, reason: Reason) => tx(async (sql, row) => {
    if (row.status !== "processing" || row[column] !== hash) return { status: row.status, step, moved: false };
    await stall(sql, row, reason, "TRANSACTION_FAILED", now, trace, { [column]: null });
    return { status: "needs_attention" as SetupStatus, step, moved: true };
  });
  const confirm = async (step: string, hash: string, reason: Reason, column: "mint_tx_hash" | "deploy_tx_hash",
    read: (sql: Sql, row: any) => Promise<Advanced | null>) => {
    let status: "success" | "reverted" | null;
    try { status = await s.receipt({ hash }); } catch (error) { return onProvider(step, providerCode(error)); }
    if (status === null) return done(step);
    if (status === "reverted") return reverted(step, column, hash, reason);
    try { return await tx(async (sql, row) => (row.status === "processing" && row[column] === hash ? read(sql, row) : null)) ?? done(step); }
    catch (error) { return onProvider(step, providerCode(error)); }
  };

  // mint → confirm-mint
  if (!snapshot.mint_tx_hash && !steps.includes("safe_minted"))
    return send("mint", "mint_tx_hash", () => s.mint({ key: `org-setup:${orgId}:mint`, handle: snapshot.handle, founderSafe: snapshot.founder_safe }));
  if (!steps.includes("safe_minted")) return confirm("confirm-mint", snapshot.mint_tx_hash, "mint_reverted", "mint_tx_hash", async (sql, row) => {
    const fact = await s.facts.safeMinted(sql, { chainId: Number(row.chain_id), txHash: row.mint_tx_hash, finality: s.finality });
    if (!fact) return null;
    if (fact.safe.toLowerCase() !== row.safe_address || fact.owner.toLowerCase() !== row.founder_safe) {
      await fail(sql, row, "safe_owner_mismatch", "WRONG_STATE", now, trace);
      return { status: "failed", step: "confirm-mint", moved: true };
    }
    await sql.query("update app.org_setups set steps=array_append(steps,'safe_minted'),checked_at=$2,updated_at=$2 where org_id=$1", [orgId, now]);
    await activate(sql, row.party_id, now, trace);
    return { status: "processing", step: "confirm-mint", moved: true };
  });
  // host-fde: the host keeps the key; one transaction records it, registers its Party pending and births its hosting.
  if (snapshot.with_fde && !snapshot.fde_party_id) {
    let fde: { agentId: string; signer: string; safe: string };
    try { fde = await s.fdeHost.provision({ orgId }); } catch (error) { return onProvider("host-fde", providerCode(error)); }
    if (![fde.signer, fde.safe].every((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) || !fde.agentId) return onProvider("host-fde", "PROVIDER_RESPONSE_INVALID");
    return tx(async (sql, row) => {
      if (row.status !== "processing" || row.fde_party_id) return { status: row.status, step: "host-fde", moved: false };
      const safe = fde.safe.toLowerCase(), signer = fde.signer.toLowerCase();
      const party = await register(sql, { kind: "agent", handle: `${row.handle.slice(0, 26)}-fde`, display_name: `${row.name} FDE`,
        safe_address: safe, owner_kind: "organization", owner_id: orgId }, now, trace);
      await sql.query(`insert into app.org_fdes(org_id,host_agent_id,party_id,safe_address,signer_address,status,created_at,updated_at)
        values($1,$2,$3,$4,$5,'provisioned',$6,$6)`, [orgId, fde.agentId, party.party_id, safe, signer, now]);
      await sql.query("update app.org_setups set fde_signer=$2,fde_safe=$3,fde_party_id=$4,checked_at=$5,updated_at=$5 where org_id=$1",
        [orgId, signer, safe, party.party_id, now]);
      await emitFde(sql, row, null, "provisioned", "provision", now, trace, safe);
      return { status: "processing", step: "host-fde", moved: true };
    });
  }
  // deploy → confirm-deploy + open-install
  if (!snapshot.deploy_tx_hash && !steps.includes("money_deployed"))
    return send("deploy", "deploy_tx_hash", () => s.deployMoney({ key: `org-setup:${orgId}:deploy`, safe: snapshot.safe_address, founderSafe: snapshot.founder_safe }));
  if (!steps.includes("money_deployed") || !snapshot.install_approval_id) {
    const q = { chainId: Number(snapshot.chain_id), txHash: snapshot.deploy_tx_hash, companySafe: snapshot.safe_address, finality: s.finality };
    // The batch needs buildMoney's answer, a network read, so it is built before the one transaction that writes the
    // deployment and opens the approval. After an ended approval, `org retry` reopens it from the admitted row.
    let fact: MoneyDeploymentFact | null, calls: Call[];
    try {
      if (steps.includes("money_deployed")) fact = await tx(async (sql) => admitted(sql, orgId));
      else {
        const receipt = await s.receipt({ hash: snapshot.deploy_tx_hash });
        if (receipt === null) return done("confirm-deploy");
        if (receipt === "reverted") return reverted("confirm-deploy", "deploy_tx_hash", snapshot.deploy_tx_hash, "deploy_reverted");
        fact = await db.transaction(orgId, (sql) => s.facts.moneyDeployed(sql, q), true);
        if (!fact) return done("confirm-deploy");
      }
      calls = await s.installCalls({ deployment: fact!, founderSafe: snapshot.founder_safe, fdeSigner: snapshot.fde_signer });
    } catch (error) { return onProvider("confirm-deploy", providerCode(error)); }
    if (!calls.length) return onProvider("open-install", "PROVIDER_RESPONSE_INVALID");
    return tx(async (sql, row) => {
      if (row.status !== "processing" || row.install_approval_id) return { status: row.status, step: "open-install", moved: false };
      if (!row.steps.includes("money_deployed")) {
        // Re-read at commit: the batch is only for the occurrence it was built from.
        const d = await s.facts.moneyDeployed(sql, q);
        if (!d || d.log_id !== fact!.log_id) return { status: row.status, step: "confirm-deploy", moved: false };
        await sql.query(`insert into app.org_deployments(org_id,safe_address,board_top_hat,shareholders_top_hat,director_hat,officer_hats,
          roles_address,gate_address,chain_id,log_id,deploy_tx_hash,block_number,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [orgId, row.safe_address, d.board_top_hat, d.shareholders_top_hat, d.director_hat, d.officer_hats, d.roles.toLowerCase(),
          d.gate.toLowerCase(), d.chain_id, d.log_id, row.deploy_tx_hash, d.block_number, now]);
        await sql.query("update app.org_setups set steps=array_append(steps,'money_deployed') where org_id=$1", [orgId]);
      }
      const opened = await s.open(sql, { personId: row.founder_principal_id, safe: row.founder_safe }, {
        org_id: orgId, opener: "organizations", subject_kind: "setup", subject_id: orgId, chain_id: Number(row.chain_id), calls,
        summary: { title: `Install Capxul on ${row.name}`, from: { label: row.name, address: row.safe_address }, to: { label: "Capxul" },
          amount: null, recipients: [], warnings: [] },
        deadline: new Date(now + s.installWindowMs).toISOString() }, trace);
      await sql.query("update app.org_setups set status='awaiting_authorization',install_approval_id=$2,checked_at=$3,updated_at=$3 where org_id=$1",
        [orgId, opened.approval_id, now]);
      await transitioned(sql, row, "processing", "awaiting_authorization", "request_authorization", null, now, trace);
      return { status: "awaiting_authorization", step: "open-install", moved: true };
    });
  }
  // complete: the install's facts at finality, then the Seats.
  try {
    return await tx(async (sql, row) => {
      const d = (await sql.query("select * from app.org_deployments where org_id=$1", [orgId])).rows[0];
      const ok = await s.facts.installed(sql, { chainId: Number(row.chain_id), finality: s.finality, safe: row.safe_address, gate: d.gate_address,
        founderSafe: row.founder_safe, directorHat: d.director_hat, officerHats: d.officer_hats, fdeSafe: row.fde_safe });
      if (ok === null) return { status: row.status, step: "complete", moved: false };
      if (ok === false) {
        await stall(sql, row, "install_reverted", "TRANSACTION_FAILED", now, trace, { install_approval_id: null });
        return { status: "needs_attention", step: "complete", moved: true };
      }
      await sql.query(`update app.org_setups set status='ready',steps=array_append(steps,'installed'),issue=null,ready_at=$2,checked_at=$2,
        updated_at=$2 where org_id=$1`, [orgId, now]);
      await seat(sql, row, { party: row.founder_party_id, principal: row.founder_principal_id, kind: "human", safe: row.founder_safe, use: "seat" }, now, trace);
      if (row.fde_party_id) {
        await seat(sql, row, { party: row.fde_party_id, principal: null, kind: "agent", safe: row.fde_safe, use: "organization" }, now, trace);
        await activate(sql, row.fde_party_id, now, trace);
      }
      await transitioned(sql, row, "processing", "ready", "complete", null, now, trace);
      return { status: "ready", step: "complete", moved: true };
    });
  } catch (error) { return onProvider("complete", providerCode(error)); }
}
/** The admitted row as the fact it was written from (founder_safe is the setup's own). */
async function admitted(sql: Sql, orgId: string): Promise<MoneyDeploymentFact> {
  const r = (await sql.query(`select d.*,o.founder_safe from app.org_deployments d join app.organizations o using(org_id) where org_id=$1`, [orgId])).rows[0];
  return { log_id: r.log_id, chain_id: Number(r.chain_id), block_number: String(r.block_number), tx_hash: r.deploy_tx_hash, safe: r.safe_address,
    founder_safe: r.founder_safe, board_top_hat: r.board_top_hat, shareholders_top_hat: r.shareholders_top_hat, director_hat: r.director_hat,
    officer_hats: r.officer_hats, roles: r.roles_address, gate: r.gate_address };
}

const ENDINGS: Record<string, [Reason, string]> = {
  declined: ["approval_declined", "CANCELLED"], expired: ["approval_expired", "WRONG_STATE"], displaced: ["approval_displaced", "WRONG_STATE"],
  reverted: ["install_reverted", "TRANSACTION_FAILED"], refused: ["install_refused", "PROVIDER_ERROR"],
};
async function installSetup(sql: Sql, e: { opener: string; subject_kind: string; subject_id: string; approval_id: string }) {
  if (e.opener !== "organizations" || e.subject_kind !== "setup") return null;
  const row = await setupRow(sql, e.subject_id);
  return row && row.install_approval_id === e.approval_id ? row : null;
}
/** approval_transitioned consumer: the founder signed and approvals sent it, so the setup is processing again. */
export async function onApprovalTransitioned(sql: Sql, event: { props: any; at: number; trace_id: string }) {
  const row = await installSetup(sql, event.props);
  if (!row || event.props.to !== "signed" || row.status !== "awaiting_authorization") return;
  await sql.query("update app.org_setups set status='processing',checked_at=$2,updated_at=$2 where org_id=$1", [row.org_id, event.at]);
  await transitioned(sql, row, "awaiting_authorization", "processing", "authorize", null, event.at, event.trace_id);
}
/** Approvals' terminal callback for the install approval (organizations.approval-endings). Landed moves nothing here:
 * completion waits for the install's facts at finality. Every other ending stalls it and forgets the approval. */
export async function onApprovalEnded(sql: Sql, e: { opener: string; subject_kind: string; subject_id: string; approval_id: string;
  outcome: string; refusal: { code: string } | null; observedAt: string; trace_id: string }) {
  const row = await installSetup(sql, e);
  const ending = ENDINGS[e.outcome];
  if (!row || !ending || !["processing", "awaiting_authorization"].includes(row.status)) return;
  const code = e.outcome === "refused" ? e.refusal?.code ?? ending[1] : ending[1];
  await stall(sql, row, ending[0], code, Date.parse(e.observedAt), e.trace_id, { install_approval_id: null });
}
