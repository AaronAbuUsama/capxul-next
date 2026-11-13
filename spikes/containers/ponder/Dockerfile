# The world's indexer: this directory as it is, with node_modules installed beforehand on the build machine
# (linux x64, the platform Cloudflare runs), so the image build needs no network.
FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production
EXPOSE 42069
ENTRYPOINT ["node_modules/.bin/ponder", "start", "--schema", "ponder", "--port", "42069", "--hostname", "0.0.0.0"]
