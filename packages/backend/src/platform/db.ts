import pg from "pg";
export type Sql = Pick<pg.PoolClient, "query">;

export class Database {
  readonly tenant: pg.Pool;
  readonly worker: pg.Pool;
  constructor(database: string, workerDatabase: string) {
    this.tenant = new pg.Pool({ connectionString: database, max: 8 });
    this.worker = new pg.Pool({ connectionString: workerDatabase, max: 4 });
  }
  async transaction<T>(org: string, run: (sql: Sql) => Promise<T>, system = false): Promise<T> {
    const client = await (system ? this.worker : this.tenant).connect();
    try {
      await client.query("BEGIN");
      await client.query("select set_config('app.org_id', $1, true)", [org]);
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  async close() { await Promise.all([this.tenant.end(), this.worker.end()]); }
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
