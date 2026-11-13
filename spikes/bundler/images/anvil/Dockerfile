# A world's chain: Foundry's anvil alone, with the repository's seeded state as its first block history.
# Built with packages/contracts/state as the context, so core.json is not copied into this spike.
# anvil 1.9.0 is the first tagged release found that reads core.json (1.5.1 and older reject its transactions).
FROM ghcr.io/foundry-rs/foundry:v1.9.0@sha256:3a392c18f9b16e665e932de159fb6fa9ed972c4b4352f2f76a1a8c7ca9b57d39 AS foundry

FROM ubuntu:22.04
COPY --from=foundry /usr/local/bin/anvil /usr/local/bin/anvil
COPY core.json /seed/core.json
EXPOSE 8545
# A first start loads the seed. A later start is given another entrypoint by the Durable Object (no seed), and the
# saved state is then loaded over JSON-RPC, which needs the 2 MB request limit lifted.
ENTRYPOINT ["anvil", "--host", "0.0.0.0", "--port", "8545", "--chain-id", "84532", "--no-request-size-limit", "--load-state", "/seed/core.json"]
