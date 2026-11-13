// Telling an answer of Cloudflare's edge (not routed yet) from Core's, which is always JSON.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { answeredByEdge } from "../src/world/warmup.ts";

const answer = (status: number, type: string) =>
  HttpClientResponse.fromWeb(
    HttpClientRequest.post("https://core.example/"),
    new Response("x", { status, headers: { "content-type": type } }),
  );

test("a 404 that is not JSON is the edge's; Core's answers are not", () => {
  assert.ok(answeredByEdge(answer(404, "text/html")));
  assert.ok(answeredByEdge(answer(404, "text/plain")));
  assert.ok(!answeredByEdge(answer(404, "application/json")));
  assert.ok(!answeredByEdge(answer(200, "application/json")));
  assert.ok(!answeredByEdge(answer(500, "text/plain")));
});
