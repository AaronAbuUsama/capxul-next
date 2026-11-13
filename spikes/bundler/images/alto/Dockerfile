# A world's bundler: Pimlico's alto 0.0.21 (the version the other line pinned), unpatched. node_modules is installed
# beforehand on the build machine (linux x64, the platform Cloudflare runs, `pnpm install` with a hoisted layout), so
# the image build needs no network. Everything alto is told comes from ALTO_* variables the Durable Object sets at start.
FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production DOTENV_CONFIG_PATH=/dev/null
EXPOSE 4337
ENTRYPOINT ["node", "node_modules/@pimlico/alto/esm/cli/alto.js"]
