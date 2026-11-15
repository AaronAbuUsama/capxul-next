# A world's index: the real Ponder app of packages/indexer (its ABIs, schema and handlers, copied as they are, with the
# generated ABI module they read), with the world's own ponder.config.ts and with node_modules installed beforehand on
# the build machine (linux x64, the platform Cloudflare runs), so the image build needs no network.
# Built with the repository's packages/ folder as the context; Dockerfile.dockerignore keeps the context to these files.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY world/ponder/package.json ./package.json
COPY world/ponder/node_modules ./node_modules
COPY indexer/abis.ts indexer/ponder.schema.ts indexer/ponder-env.d.ts ./
# The ABI module abis.ts reads, at the path it imports it by (`../contracts/generated/abi.ts`), as in the repository.
COPY contracts/generated/abi.ts /contracts/generated/abi.ts
COPY indexer/src ./src
COPY contracts/deployments/devnet.json ./deployment-record.json
COPY world/ponder/ponder.config.ts ./ponder.config.ts
EXPOSE 42069
ENTRYPOINT ["node_modules/.bin/ponder", "start", "--schema", "ponder", "--port", "42069", "--hostname", "0.0.0.0"]
