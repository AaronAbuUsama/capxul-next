// Ponder requires an API file. The real package serves the backend through Postgres views, not this; it stays empty.
import { Hono } from "hono";

export default new Hono();
