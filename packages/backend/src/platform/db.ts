import pg from "pg";
export type Sql = Pick<pg.PoolClient, "query">;
export type Owner = { kind: "person" | "organization"; id: string };

export class Database {
  readonly tenant: pg.Pool;
  readonly worker: pg.Pool;
  constructor(database: string, workerDatabase: string) {
    this.tenant = new pg.Pool({ connectionString: database, max: 8 });
    this.worker = new pg.Pool({ connectionString: workerDatabase, max: 4 });
  }
  async transaction<T>(org: string, run: (sql: Sql) => Promise<T>, system = false, owner?: Owner): Promise<T> {
    const client = await (system ? this.worker : this.tenant).connect();
    try { return await transaction(client, org, run, owner); }
    finally { client.release(); }
  }
  async ownerTransaction<T>(owner: Owner, run: (sql: Sql) => Promise<T>, system = false): Promise<T> {
    return this.transaction(owner.kind === "organization" ? owner.id : "", run, system, owner);
  }
  async close() { await Promise.all([this.tenant.end(), this.worker.end()]); }
}

export async function transaction<T>(client: Sql, org: string, run: (sql: Sql) => Promise<T>, owner?: Owner): Promise<T> {
  try {
    await client.query("BEGIN");
    const scope = owner ?? (org ? { kind: "organization", id: org } : undefined);
    if (scope && (!["person", "organization"].includes(scope.kind) || !scope.id)) throw new Error("INVALID_INPUT: owner scope");
    await client.query(`select set_config('app.org_id', $1, true),
      set_config('app.owner_kind', $2, true), set_config('app.owner_id', $3, true),
      set_config('app.person_id', '', true), set_config('app.email', '', true),
      set_config('app.safe_address', '', true)`, [org, scope?.kind ?? "", scope?.id ?? ""]);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function record(sql: Sql, org: string, kind: string, trace: string, data: unknown) {
  // The organization lock makes record order, hash chain and delivery order survive concurrent instances.
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [org]);
  await sql.query(`insert into app.records (org_id, kind, trace, data, previous_hash, hash)
    select $1, $2, $3, $4, coalesce(p.hash, ''),
      encode(sha256(convert_to(coalesce(p.hash, '') || $2 || $3 || $4::jsonb::text, 'UTF8')), 'hex')
    from (select (select hash from app.records where org_id=$1 order by id desc limit 1) as hash) p`,
  [org, kind, trace, JSON.stringify(data)]);
}
