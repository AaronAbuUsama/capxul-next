// `GET /companies`: the world's companies and each one's site, as world.show answers them (packages/world,
// src/platform/view.ts). Not a blueprint operation: it is how the platform, which runs where the keys are, has the
// world's Core read its companies with `companiesOf` (organizations/site.ts), which also moves each company's site on
// towards ready, since nothing runs in the background of a Worker. Signed in as the world's door is (the door token,
// or the owner operator's), and it reads only.
import { CREDENTIAL_HEADER } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { companiesOf } from "../organizations/site.ts";

export const COMPANIES_PATH = "/companies";

/** Answers one request at `COMPANIES_PATH`. `tokens` are the credentials that act as the world's owner. */
export const companiesRead = (tokens: ReadonlyArray<Redacted.Redacted>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const credential = request.headers[CREDENTIAL_HEADER];
    if (!Arr.some(tokens, (token) => credential === `Bearer ${Redacted.value(token)}`))
      return HttpServerResponse.jsonUnsafe({ error: "not signed in at this world's door" }, { status: 401 });
    return HttpServerResponse.jsonUnsafe({ companies: yield* companiesOf() });
  });
