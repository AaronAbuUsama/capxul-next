# Access runtime

`door.ts` owns the only bearer-to-principal lookup and feature evaluator. Every time argument is mandatory authoritative world milliseconds supplied by the runtime (from `worldNow(sql)`); there is no host-clock fallback. All SQL uses the caller's transaction. The tenant role can read its own principal and sessions only; identity, code and flag mutations require the restricted worker. `authenticate(sql,bearer,now)` clears organization and previous identity even on failure, then installs verified `app.person_id`, `app.email`, `app.safe_address` and personal owner settings. Organization routes subsequently check the actual Seat before changing owner scope.

## Public mount contract

The integrator mounts `routeAccess(sql,path,input,bearer,services,now)` as POST JSON before diagnostic HMAC ingress, inside a drained worker transaction. Authorization supplies the raw token after `Bearer `; identity never comes from input. `null` means this router does not own the path. A returned error response **commits**, because a wrong code spends a try. A thrown error rolls back; only after rollback does the mount render `accessError(error)`. Never expose exception messages, provider responses or stacks.

- `/access/sign-in/send-code`: `{email}` → `{email,expiresAt,resendAfter}`.
- `/access/sign-in/verify-code`: `{email,code,client}` → `{token,personId,safe,expiresAt,email}`.
- `/access/sign-in/challenge`: `{safe}` → `{challenge,expiresAt}`.
- `/access/sign-in/with-key`: `{safe,challenge,signature,client}` → `{token,personId,safe,expiresAt,signer,owner}`. Sign the exact challenge string using EIP-191. Actual AgentOwner and Safe ownership reads must agree with the recovered key; a challenge signs in only once.
- `/access/sessions/current`: `{}` → `{personId,kind,email,safe,expiresAt,setupState}`. Person setup reads actual Safe code/owners; agents are ready by their sign-in proof.
- `/access/sessions/revoke`: `{}` → `{sessionId,endedAt}`.

All response times above are ISO timestamps. Success is HTTP 200. Error bodies are `{error:code,retryAfterMs?}`: INVALID_INPUT/OTP_EXPIRED 400, NOT_AUTHENTICATED 401, RATE_LIMITED 429, PROVIDER_ERROR/PROVIDER_RESPONSE_INVALID 502, otherwise INTERNAL_ERROR 500. Wrong OTP adds `triesLeft`; resend cooldown adds `retryAfterMs`.

`AccessServices` requires Mail, the deployment's `{companiesHouse,namespace}`, and agent `{secret,domain,rpc,agentOwner}`. Mail inspection belongs to the devnet sink, not Access. Seat/hat/agent bootstrap belongs to those concepts, not session fixtures. Actor files are private runtime state, never evidence or an authority substitute.

The SDK's `createAccessClient` implements these exact public shapes and exports `PersonSignIn`, `AgentSignIn` and `AccessSession`. Receipt-first actor preparation must persist only actual successful sign-in/current results; after native restore it repeats sign-in/current and rechecks current Seat/hat authority before replacing the private epoch-bound actor file. A stopped world clock can give Mail messages identical `sentAt` values: correlate actual new sink message IDs rather than assuming the first timestamp-sorted row is the new OTP. No live Mail inspection route or actor-file writer is provided by Access.

## Principal authority contract for consumers

`Principal` is the exported shape `{personId,kind,email,safeAddress,signerAddress}`. The schema enforces `person` → nonnull email and **null signerAddress**, `agent` → null email and nonnull signerAddress. A person bearer proves mailbox identity, not possession of an arbitrary EOA from a directory. For an organization, the composition authenticates with the canonical `now` on the checked-out Sql, then on that same Sql calls `requireSeat(sql,orgId,{principalId:principal.personId,kind:principal.kind==='person'?'human':'agent',safe:principal.safeAddress})` before setting organization scope. Organizations owns that guard; Access does not duplicate it.

Sites' injected authenticated-caller callback must return the real Principal after the active Seat check. Human offchain document/report calls use the opaque bearer, not an extra EIP-191 proof that a person with a null signer cannot supply. Only after actual admitted site/hat membership checks may the returned person's email identify the native site user; directory, request or Safe-owner lookup cannot substitute. Agent sign-in supplies an agent signer but no human Frappe mailbox/delegation: a native-person-only site call must refuse it unless an actual documented agent capability is supplied. Money approval signing remains separate Safe/Approvals authority. Consumers must not silently mutate these principal semantics to make a fixture work.

## Gates and integration limits

`requireFeature(sql,key,{personId,orgId?},catalogue,now)` takes a trusted deployment catalogue, never a request-selected gate or target. Missing/inactive/unsupported definitions refuse; unknown catalogue keys are INVALID_INPUT. Money gates older than ten minutes refuse. `syncFlags` is the transaction-local writer for decoded provider definitions; it is not a running PostHog scheduler. The deployment must supply actual catalogue keys, targets and money classification. No guessed default enables Books or Board.

Apply `access/schema.sql` after base roles/schema and before accounts or organizations authority SQL. Common outbox must exist before sign-in writes. Public HTTP mounting, actual Mail inspection, scheduled provider sync and selected-stack proof are separate integration dependencies; native component tests do not establish those.
