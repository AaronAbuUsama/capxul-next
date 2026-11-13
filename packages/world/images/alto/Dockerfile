# A world's bundler: Pimlico's alto 0.0.21 (the version the other line pinned), unpatched. node_modules is installed
# beforehand on the build machine (linux x64, the platform Cloudflare runs; `pnpm install --ignore-workspace` here,
# with the hoisted layout .npmrc asks for), so the image build needs no network. Everything alto is told comes from
# ALTO_* variables that the bundler's Durable Object (src/bundler/Bundler.ts) sets when it starts the container.
FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production DOTENV_CONFIG_PATH=/dev/null
EXPOSE 4337
ENTRYPOINT ["node", "node_modules/@pimlico/alto/esm/cli/alto.js"]
