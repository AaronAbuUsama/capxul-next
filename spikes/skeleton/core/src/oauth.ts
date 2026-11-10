// STAND-IN for Capxul's own sign-in: a minimal OAuth2 / OpenID provider. The person picker replaces the passkey.
import { randomBytes } from "node:crypto";
import { config } from "./config.ts";
import { esc, html, page, parseForm, send, type Ctx } from "./http.ts";
import { byEmail, people, type Person } from "./people.ts";

const codes = new Map<string, { email: string; redirectUri: string; exp: number }>();
const tokens = new Map<string, { email: string; exp: number }>();
const rand = (n = 24) => randomBytes(n).toString("hex");
const log = (m: string) => console.log(`${new Date().toISOString()} [oauth] ${m}`);

function clientOk(c: Ctx, form: Record<string, string>): boolean {
  let id = form.client_id, secret = form.client_secret;
  const basic = /^Basic (.+)$/.exec(String(c.req.headers.authorization ?? ""));
  if (basic) [id, secret] = Buffer.from(basic[1]!, "base64").toString().split(":").map(decodeURIComponent) as [string, string];
  return id === config.clientId && secret === config.secret;
}

function pickerPage(q: Record<string, string>): string {
  const hidden = ["client_id", "redirect_uri", "response_type", "state", "scope"]
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k])}">`).join("");
  const buttons = people.map((p) =>
    `<button class="person" name="email" value="${esc(p.email)}">${esc(p.name)} <small>${esc(p.email)}</small></button>`).join("");
  return page("Sign in to Capxul (stand-in)", `<h1>Sign in</h1>
<p class="standin">Stand-in for Capxul's sign-in. The real one is a passkey; here you pick a test person.</p>
<form method="post" action="/oauth/authorize">${hidden}${buttons}</form>`);
}

const userinfo = (p: Person) => {
  const [given, ...rest] = p.name.split(" ");
  return { sub: p.address.toLowerCase(), email: p.email, email_verified: true, name: p.name, given_name: given, family_name: rest.join(" ") };
};

export async function handleOauth(c: Ctx): Promise<boolean> {
  const { req, res, url } = c;
  const path = url.pathname;

  if (path === "/.well-known/openid-configuration") {
    const base = `http://${req.headers.host}`;
    send(res, 200, { issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`,
      userinfo_endpoint: `${base}/oauth/userinfo`, response_types_supported: ["code"], scopes_supported: ["openid", "profile", "email"] });
    return true;
  }
  if (path === "/oauth/authorize") {
    const q = req.method === "POST" ? parseForm(c.body) : Object.fromEntries(url.searchParams);
    if (q.client_id !== config.clientId) return send(res, 400, { error: "invalid_client" }), true;
    if (q.response_type !== "code" || !q.redirect_uri) return send(res, 400, { error: "invalid_request" }), true;
    if (req.method !== "POST") return html(res, 200, pickerPage(q)), true;
    const person = byEmail(q.email ?? "");
    if (!person) return send(res, 400, { error: "unknown person" }), true;
    const code = rand();
    codes.set(code, { email: person.email, redirectUri: q.redirect_uri, exp: Date.now() + 5 * 60_000 });
    const back = new URL(q.redirect_uri);
    back.searchParams.set("code", code);
    if (q.state) back.searchParams.set("state", q.state);
    log(`${person.email} signed in, code issued`);
    res.writeHead(302, { location: back.toString() }); res.end();
    return true;
  }
  if (path === "/oauth/token" && req.method === "POST") {
    const form = (req.headers["content-type"] ?? "").includes("json") ? JSON.parse(c.body || "{}") : parseForm(c.body);
    if (!clientOk(c, form)) return send(res, 401, { error: "invalid_client" }), true;
    const grant = codes.get(form.code ?? "");
    codes.delete(form.code ?? ""); // single use
    if (form.grant_type !== "authorization_code" || !grant || grant.exp < Date.now() || grant.redirectUri !== form.redirect_uri) {
      return send(res, 400, { error: "invalid_grant" }), true;
    }
    const access_token = rand();
    tokens.set(access_token, { email: grant.email, exp: Date.now() + 3600_000 });
    send(res, 200, { access_token, token_type: "Bearer", expires_in: 3600, scope: "openid profile email" });
    return true;
  }
  if (path === "/oauth/userinfo") {
    const t = tokens.get((/^Bearer (.+)$/.exec(String(req.headers.authorization ?? "")) ?? [])[1] ?? url.searchParams.get("access_token") ?? "");
    const person = t && t.exp > Date.now() ? byEmail(t.email) : undefined;
    if (!person) return send(res, 401, { error: "invalid_token" }), true;
    send(res, 200, userinfo(person));
    return true;
  }
  return false;
}
