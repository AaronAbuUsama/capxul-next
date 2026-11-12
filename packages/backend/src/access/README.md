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

## Gates and integration limits

`requireFeature(sql,key,{personId,orgId?},catalogue,now)` takes a trusted deployment catalogue, never a request-selected gate or target. Missing/inactive/unsupported definitions refuse; unknown catalogue keys are INVALID_INPUT. Money gates older than ten minutes refuse. `syncFlags` is the transaction-local writer for decoded provider definitions; it is not a running PostHog scheduler. The deployment must supply actual catalogue keys, targets and money classification. No guessed default enables Books or Board.

Apply `access/schema.sql` after base roles/schema and before accounts or organizations authority SQL. Common outbox must exist before sign-in writes. Public HTTP mounting, actual Mail inspection, scheduled provider sync and selected-stack proof are separate integration dependencies; native component tests do not establish those.
