# A box: a container off Aaron's Mac where agents, gates or a person work (packages/sandbox/README.md).
# It holds the repository at one commit of integration/build with every package installed, so a run's lane needs only
# the commits since (a git bundle) and the box needs no network. linux/amd64: what Cloudflare's containers run.
FROM node:24.21.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git procps unzip xz-utils \
    && rm -rf /var/lib/apt/lists/*
# Foundry 1.8.5 (anvil, forge, cast), with the checksum the swarmd spike verified.
RUN curl --fail --location --retry 5 --retry-all-errors \
      https://github.com/foundry-rs/foundry/releases/download/v1.8.5/foundry_v1.8.5_linux_amd64.tar.gz --output /tmp/foundry.tar.gz \
    && echo "6c66ffcc55fa4249197721baa3098bc208014ea1d8aa04b2ed50ac6bccffb226  /tmp/foundry.tar.gz" | sha256sum --check \
    && tar --extract --gzip --file /tmp/foundry.tar.gz --directory /usr/local/bin anvil forge cast && rm /tmp/foundry.tar.gz
# pnpm as the repository's packageManager names it.
COPY repo/package.json /tmp/package.json
RUN corepack enable && cd /tmp && corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate && pnpm --version
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 BOX_REPO=/opt/capxul BOX_PORT=8080 HOME=/root
COPY repo/ /opt/capxul/
RUN cd /opt/capxul && pnpm install --frozen-lockfile && git config --global --add safe.directory '*' && git -C /opt/capxul rev-parse HEAD
# The box's server, from the checkout that built this image (it may be newer than the commit above; lanes never see
# it). Its two packages resolve from the loop's, which an image cut before packages/sandbox existed still has.
COPY box/ /opt/capxul/packages/sandbox/src/
RUN [ -e /opt/capxul/packages/sandbox/node_modules/@earendil-works ] || ln -sfn ../loop/node_modules /opt/capxul/packages/sandbox/node_modules
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "--no-warnings", "/opt/capxul/packages/sandbox/src/bin/box.ts"]
