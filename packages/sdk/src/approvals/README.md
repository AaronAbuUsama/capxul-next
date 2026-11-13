# Approvals transport

`door.ts` exports `createApprovalsClient({coreUrl,bearer})`, the four signer RPCs and an abortable SSE `observe` async iterable. Mutations require caller-stable `{traceId,callId}`; retry an uncertain call with the same identity and input. No private service credential, body principal or signer key enters this transport.

This is not `client.approvals.sign`: it never asks a wallet to sign a server-provided digest. The independent SafeOp/calls/window check and authoritative sponsorship adapter must exist before the browser signing flow or an acceptance runner can sign. The backend owns sponsorship, one send and indexed finality. `sign` only submits a signature already obtained through that verified path.
