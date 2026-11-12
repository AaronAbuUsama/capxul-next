// Required by Ponder. Facts are exposed only by scoped Postgres views, never SQL/GraphQL HTTP.
import { Hono } from "hono";
export default new Hono();
