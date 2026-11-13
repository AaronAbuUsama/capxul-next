// organizations.setups.set-up (blueprint/organizations/processes.ts) as one step function the composition drives. Sends
// run outside transactions and are recorded in the next; chain facts come from injected indexing reads at finality.
import type { Database, Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import { activate, register, release } from "../parties/door.ts";
import { transitionId, type SetupStatus } from "./setups.ts";

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
  /** service-signer.send with the tier key: Installer.deployMoney (founder the one Director, 1 of 1, three officers). */
  deployMoney(input: { key: string; safe: string; founderSafe: string }): Promise<{ hash: string }>;
  /** The receipt's status once it is final at `finality` blocks, or null until then. */
  receipt(input: { hash: string; finality: number }): Promise<"success" | "reverted" | null>;
  facts: {
    /** CompanySafeMinted of the transaction at finality, or null until then. */
    safeMinted(sql: Sql, q: { chainId: number; txHash: string; finality: number }): Promise<{ safe: string; owner: string } | null>;
    /** MoneyDeployed of the transaction for the company Safe at finality, or null until then. */
    moneyDeployed(sql: Sql, q: { chainId: number; txHash: string; companySafe: string; finality: number }): Promise<MoneyDeploymentFact | null>;
    /** The landed install's facts at its block (Gate as module and guard, the founder's Safe wearing the hats, the FDE's
     * AgentCreated): null until that block is final, false only after, when they differ. */
    installed(sql: Sql, q: { chainId: number; finality: number; txHash: string; blockNumber: number; safe: string; gate: string;
      founderSafe: string; directorHat: string; officerHats: string[]; fdeSafe: string | null }): Promise<boolean | null>;
  };
  /** buildMoney's batch plus AgentOwner.create of the FDE's key, as the company Safe's execTransaction calls. */
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
type SetupRow = {
  org_id: string; founder_principal_id: string; with_fde: boolean; status: SetupStatus; steps: string[];
  mint_tx_hash: string | null; mint_attempt: number; deploy_tx_hash: string | null; deploy_attempt: number;
  install_approval_id: string | null; install_tx_hash: string | null; install_block: string | null;
  fde_signer: string | null; fde_safe: string | null; fde_party_id: string | null;
  party_id: string; name: string; safe_address: string; founder_safe: string; founder_party_id: string; chain_id: string; handle: string;
};
const TRANSIENT = new Set(["PROVIDER_ERROR", "INDEXER_NOT_READY"]);

async function setupRow(sql: Sql, orgId: string): Promise<SetupRow | undefined> {
  return (await sql.query<SetupRow>(`select s.*,o.party_id,o.name,o.safe_address,o.founder_safe,o.founder_party_id,o.chain_id,p.handle
    from app.org_setups s join app.organizations o using(org_id) join app.parties p on p.party_id=o.party_id
    where s.org_id=$1 for update of s`, [orgId])).rows[0];
}
async function transitioned(sql: Sql, row: { org_id: string; founder_principal_id: string }, from: SetupStatus, to: SetupStatus,
  transition: string, issue: Reason | null, now: number, trace: string) {
  await emit(sql, { id: await transitionId(sql, `org-setup:${row.org_id}:${transition}`), name: "org_setup_transitioned", machine: "org-setup",
    entity_id: row.org_id, owner_kind: "organization", owner_id: row.org_id, actor: null, trace_id: trace, at: now,
    props: { from, to, transition, org_id: row.org_id, person_id: row.founder_principal_id, issue_reason: issue } });
}
/** needs_attention with a reason and code; `forget` (fixed SQL) drops what `org retry` must redo. */
async function stall(sql: Sql, row: SetupRow, reason: Reason, code: string, now: number, trace: string, forget = "") {
  await sql.query(`update app.org_setups set status='needs_attention',issue=$2,checked_at=$3,updated_at=$3${forget} where org_id=$1`,
    [row.org_id, { reason, code, at: now }, now]);
  await transitioned(sql, row, row.status, "needs_attention", "stall", reason, now, trace);
}
/** Definitive: nothing can finish it. The Organization's Party, and the FDE's, are released while still pending; the
 * FDE's hosting is left as it is (cut.fde-parked parks its retirement). */
async function fail(sql: Sql, row: SetupRow, reason: Reason, code: string, now: number, trace: string) {
  await sql.query("update app.org_setups set status='failed',issue=$2,checked_at=$3,updated_at=$3 where org_id=$1", [row.org_id, { reason, code, at: now }, now]);
  for (const party of [row.party_id, row.fde_party_id].filter((p): p is string => !!p)) {
    const state = (await sql.query("select state from app.parties where party_id=$1", [party])).rows[0]?.state;
    if (state === "pending") await release(sql, party, now, trace);
  }
  await transitioned(sql, row, row.status, "failed", "fail", reason, now, trace);
}
async function seat(sql: Sql, row: SetupRow, m: { party: string; principal: string | null; kind: "human" | "agent"; safe: string; use: "seat" | "organization" },
  now: number, trace: string) {
  const memberId = `${row.org_id}:${m.party}`;
  const added = await sql.query(`insert into app.org_members(org_id,member_id,party_id,principal_id,kind,safe_address,seat_use,status,joined_at,updated_at)
    values($1,$2,$3,$4,$5,$6,$7,'active',$8,$8) on conflict (org_id,party_id) do nothing`,
  [row.org_id, memberId, m.party, m.principal, m.kind, m.safe.toLowerCase(), m.use, now]);
  if (!added.rowCount) return;
  await emit(sql, { id: await transitionId(sql, `org-member:${memberId}:seat`), name: "org_member_transitioned", machine: "org-member",
    entity_id: memberId, owner_kind: "organization", owner_id: row.org_id, actor: null, trace_id: trace, at: now,
    props: { from: null, to: "active", transition: "seat", org_id: row.org_id, member_id: memberId, party_id: m.party, kind: m.kind } });
}
const invalid = (what: string) => new Error(`PROVIDER_RESPONSE_INVALID: ${what}`);
const sameDeployment = (d: MoneyDeploymentFact, row: SetupRow) => d.chain_id === Number(row.chain_id) &&
  d.safe.toLowerCase() === row.safe_address && d.founder_safe.toLowerCase() === row.founder_safe;

/** Runs the setup's next unfinished step. Waiting for a fact, the founder or a terminal state moves nothing. A provider
 * outage is thrown back for the workflow's retries (max 5, exponential); the runner passes `lastTry` on the last, which
 * stalls it instead (organizations.setup-send-attempts). */
export async function advance(db: Database, orgId: string, s: SetupProcessServices, now: number, trace: string,
  opts: { lastTry?: boolean } = {}): Promise<Advanced> {
  if (!trace) throw new Error("INVALID_INPUT: trace_id required");
  const tx = <T>(run: (sql: Sql, row: SetupRow) => Promise<T>) => db.transaction(orgId, async (sql) => {
    const row = await setupRow(sql, orgId);
    if (!row) throw new Error("NOT_FOUND: setup");
    return run(sql, row);
  }, true);
  const snapshot = await tx(async (_, row) => row);
  const done = (step: string, moved = false) => tx(async (_, row) => ({ status: row.status as SetupStatus, step, moved }));
  if (snapshot.status !== "processing") return { status: snapshot.status, step: "none", moved: false };
  const steps: string[] = snapshot.steps;
  // A send is keyed by its attempt, so a crash before recording resends the same transaction and gets its hash back; its
  // answer is recorded only if the setup is still at that attempt.
  const send = async (step: "mint" | "deploy", call: (key: string) => Promise<{ hash: string }>) => {
    const column = `${step}_tx_hash` as const, attempt = snapshot[`${step}_attempt`];
    let hash: string;
    try { ({ hash } = await call(`org-setup:${orgId}:${step}:${attempt}`)); }
    catch (error) { return onProvider(step, error); }
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return onProvider(step, invalid(`${step} hash`));
    return tx(async (sql, row) => {
      if (row.status !== "processing" || row[column] || row[`${step}_attempt`] !== attempt) return { status: row.status, step, moved: false };
      await sql.query(`update app.org_setups set ${column}=$2,checked_at=$3,updated_at=$3 where org_id=$1`, [orgId, hash.toLowerCase(), now]);
      return { status: row.status as SetupStatus, step, moved: true };
    });
  };
  const onProvider = (step: string, error: unknown) => {
    const code = /^(PROVIDER_RESPONSE_INVALID|PROVIDER_ERROR|INDEXER_NOT_READY)\b/.exec(String((error as Error)?.message))?.[1];
    if (!code || (TRANSIENT.has(code) && !opts.lastTry)) throw error;
    return tx(async (sql, row): Promise<Advanced> => {
    if (row.status !== "processing") return { status: row.status, step, moved: false };
    if (code === "PROVIDER_RESPONSE_INVALID") await fail(sql, row, "provider_answer_invalid", code, now, trace);
    else await stall(sql, row, "provider_unavailable", code, now, trace);
    return { status: (await setupRow(sql, orgId))!.status, step, moved: true };
    });
  };
  // Only a final reverted receipt moves the send to its next attempt, in the transaction that records the revert.
  const reverted = (step: string, send: "mint" | "deploy", hash: string, reason: Reason) => tx(async (sql, row): Promise<Advanced> => {
    if (row.status !== "processing" || row[`${send}_tx_hash`] !== hash) return { status: row.status, step, moved: false };
    await stall(sql, row, reason, "TRANSACTION_FAILED", now, trace, `,${send}_tx_hash=null,${send}_attempt=${send}_attempt+1`);
    return { status: "needs_attention", step, moved: true };
  });
  const receipt = async (hash: string) => s.receipt({ hash, finality: s.finality });

  // mint → confirm-mint
  if (!snapshot.mint_tx_hash && !steps.includes("safe_minted"))
    return send("mint", (key) => s.mint({ key, handle: snapshot.handle, founderSafe: snapshot.founder_safe }));
  if (!steps.includes("safe_minted")) try {
    const hash = snapshot.mint_tx_hash!, status = await receipt(hash);
    if (status === null) return done("confirm-mint");
    if (status === "reverted") return reverted("confirm-mint", "mint", hash, "mint_reverted");
    return await tx(async (sql, row): Promise<Advanced> => {
    const waiting = { status: row.status, step: "confirm-mint", moved: false };
    if (row.status !== "processing" || row.mint_tx_hash !== hash || row.steps.includes("safe_minted")) return waiting;
    const fact = await s.facts.safeMinted(sql, { chainId: Number(row.chain_id), txHash: hash, finality: s.finality });
    if (!fact) return waiting;
    if (fact.safe.toLowerCase() !== row.safe_address || fact.owner.toLowerCase() !== row.founder_safe) {
      await fail(sql, row, "safe_owner_mismatch", "WRONG_STATE", now, trace);
      return { status: "failed", step: "confirm-mint", moved: true };
    }
    await sql.query("update app.org_setups set steps=array_append(steps,'safe_minted'),checked_at=$2,updated_at=$2 where org_id=$1", [orgId, now]);
    await activate(sql, row.party_id, now, trace);
    return { status: "processing", step: "confirm-mint", moved: true };
    });
  } catch (error) { return onProvider("confirm-mint", error); }
  // host-fde: the host keeps the key; one transaction records it, registers its Party pending and births its hosting.
  if (snapshot.with_fde && !snapshot.fde_party_id) {
    let fde: { agentId: string; signer: string; safe: string };
    try { fde = await s.fdeHost.provision({ orgId }); } catch (error) { return onProvider("host-fde", error); }
    if (![fde.signer, fde.safe].every((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) || !fde.agentId) return onProvider("host-fde", invalid("FDE host answer"));
    return tx(async (sql, row) => {
      if (row.status !== "processing" || row.fde_party_id) return { status: row.status, step: "host-fde", moved: false };
      const safe = fde.safe.toLowerCase(), signer = fde.signer.toLowerCase();
      const party = await register(sql, { kind: "agent", handle: `${row.handle.slice(0, 26)}-fde`, display_name: `${row.name} FDE`,
        safe_address: safe, owner_kind: "organization", owner_id: orgId }, now, trace);
      await sql.query(`insert into app.org_fdes(org_id,host_agent_id,party_id,safe_address,signer_address,status,created_at,updated_at)
        values($1,$2,$3,$4,$5,'provisioned',$6,$6)`, [orgId, fde.agentId, party.party_id, safe, signer, now]);
      await sql.query("update app.org_setups set fde_signer=$2,fde_safe=$3,fde_party_id=$4,checked_at=$5,updated_at=$5 where org_id=$1",
        [orgId, signer, safe, party.party_id, now]);
      await emit(sql, { id: await transitionId(sql, `org-fde:${orgId}:provision`), name: "org_fde_transitioned", machine: "org-fde", entity_id: orgId,
        owner_kind: "organization", owner_id: orgId, actor: null, trace_id: trace, at: now,
        props: { from: null, to: "provisioned", transition: "provision", org_id: orgId, safe_address: safe, paid_through: null } });
      return { status: "processing", step: "host-fde", moved: true };
    });
  }
  // deploy → confirm-deploy + open-install
  if (!snapshot.deploy_tx_hash && !steps.includes("money_deployed"))
    return send("deploy", (key) => s.deployMoney({ key, safe: snapshot.safe_address, founderSafe: snapshot.founder_safe }));
  if (!steps.includes("money_deployed") || !snapshot.install_approval_id) {
    const q = { chainId: Number(snapshot.chain_id), txHash: snapshot.deploy_tx_hash!, companySafe: snapshot.safe_address, finality: s.finality };
    // The batch needs buildMoney's answer, a network read, so it is built before the one transaction that writes the
    // deployment and opens the approval. After an ended approval, `org retry` reopens it from the admitted row.
    let fact: MoneyDeploymentFact | null, calls: Call[];
    try {
      if (steps.includes("money_deployed")) fact = await tx(async (sql) => admitted(sql, orgId));
      else {
        const status = await receipt(q.txHash);
        if (status === null) return done("confirm-deploy");
        if (status === "reverted") return reverted("confirm-deploy", "deploy", q.txHash, "deploy_reverted");
        fact = await db.transaction(orgId, (sql) => s.facts.moneyDeployed(sql, q), true);
        if (!fact) return done("confirm-deploy");
        if (!sameDeployment(fact, snapshot)) return onProvider("confirm-deploy", invalid("MoneyDeployed names another Safe, founder or chain"));
      }
      calls = await s.installCalls({ deployment: fact!, founderSafe: snapshot.founder_safe, fdeSigner: snapshot.fde_signer });
    } catch (error) { return onProvider("confirm-deploy", error); }
    if (!calls.length) return onProvider("open-install", invalid("empty install batch"));
    return tx(async (sql, row) => {
      if (row.status !== "processing" || row.install_approval_id) return { status: row.status, step: "open-install", moved: false };
      if (!row.steps.includes("money_deployed")) {
        // Re-read at commit: the batch is only for the occurrence it was built from.
        const d = await s.facts.moneyDeployed(sql, q);
        if (!d || d.log_id !== fact!.log_id || !sameDeployment(d, row)) return { status: row.status, step: "confirm-deploy", moved: false };
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
  // complete: the landed install's facts at finality, anchored to its block, then the Seats.
  try {
    return await tx(async (sql, row): Promise<Advanced> => {
      const waiting = { status: row.status, step: "complete", moved: false };
      if (row.status !== "processing" || row.steps.includes("installed") || !row.install_tx_hash || row.install_block === null) return waiting;
      const d = (await sql.query("select * from app.org_deployments where org_id=$1", [orgId])).rows[0];
      const ok = await s.facts.installed(sql, { chainId: Number(row.chain_id), finality: s.finality, txHash: row.install_tx_hash,
        blockNumber: Number(row.install_block), safe: row.safe_address, gate: d.gate_address, founderSafe: row.founder_safe,
        directorHat: d.director_hat, officerHats: d.officer_hats, fdeSafe: row.fde_safe });
      if (ok === null) return waiting;
      if (ok === false) {
        await stall(sql, row, "install_reverted", "TRANSACTION_FAILED", now, trace, FORGET_INSTALL);
        return { status: "needs_attention", step: "complete", moved: true };
      }
      await sql.query(`update app.org_setups set status='ready',steps=array_append(steps,'installed'),issue=null,ready_at=$2,checked_at=$2,
        updated_at=$2 where org_id=$1`, [orgId, now]);
      await seat(sql, row, { party: row.founder_party_id, principal: row.founder_principal_id, kind: "human", safe: row.founder_safe, use: "seat" }, now, trace);
      if (row.fde_party_id && row.fde_safe) {
        await seat(sql, row, { party: row.fde_party_id, principal: null, kind: "agent", safe: row.fde_safe, use: "organization" }, now, trace);
        await activate(sql, row.fde_party_id, now, trace);
      }
      await transitioned(sql, row, "processing", "ready", "complete", null, now, trace);
      return { status: "ready", step: "complete", moved: true };
    });
  } catch (error) { return onProvider("complete", error); }
}
/** The admitted row as the fact it was written from (founder_safe is the setup's own). */
async function admitted(sql: Sql, orgId: string): Promise<MoneyDeploymentFact> {
  const r = (await sql.query(`select d.*,o.founder_safe from app.org_deployments d join app.organizations o using(org_id) where org_id=$1`, [orgId])).rows[0];
  return { ...r, chain_id: Number(r.chain_id), block_number: String(r.block_number), tx_hash: r.deploy_tx_hash, safe: r.safe_address,
    roles: r.roles_address, gate: r.gate_address };
}

const FORGET_INSTALL = ",install_approval_id=null,install_tx_hash=null,install_block=null";
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
/** Approvals' terminal callback for the install approval (organizations.approval-endings). Landed records the install's
 * transaction and block, which completion judges at finality (authorizing first if `signed` was not seen); every other
 * ending stalls the setup and forgets the approval, so `org retry` opens a new one. */
export async function onApprovalEnded(sql: Sql, e: { opener: string; subject_kind: string; subject_id: string; approval_id: string;
  outcome: string; refusal: { code: string } | null; transaction_hash: string | null; block_number: number | null;
  observedAt: string; trace_id: string }) {
  const row = await installSetup(sql, e), at = Date.parse(e.observedAt);
  if (!row || !["processing", "awaiting_authorization"].includes(row.status)) return;
  if (e.outcome === "landed") {
    if (!/^0x[0-9a-fA-F]{64}$/.test(e.transaction_hash ?? "") || !Number.isSafeInteger(e.block_number)) throw new Error("INVALID_INPUT: landed install needs its transaction");
    await sql.query("update app.org_setups set status='processing',install_tx_hash=$2,install_block=$3,checked_at=$4,updated_at=$4 where org_id=$1",
      [row.org_id, e.transaction_hash!.toLowerCase(), e.block_number, at]);
    if (row.status === "awaiting_authorization") await transitioned(sql, row, "awaiting_authorization", "processing", "authorize", null, at, e.trace_id);
    return;
  }
  const ending = ENDINGS[e.outcome];
  if (!ending) return;
  const code = e.outcome === "refused" ? e.refusal?.code ?? ending[1] : ending[1];
  await stall(sql, row, ending[0], code, at, e.trace_id, FORGET_INSTALL);
}
