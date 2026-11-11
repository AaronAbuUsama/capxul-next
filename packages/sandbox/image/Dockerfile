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
# The Solidity compilers the contracts pin (packages/contracts 0.8.28, the spike's 0.8.24), where Foundry looks for them,
# checked against soliditylang.org's list: a box has no internet to fetch them.
RUN for v in "0.8.28 7893614a 9a0fb7e0db2c0641dbae1c5cc645dc686820c83af516226abb1c0a2f76636f25" "0.8.24 e11b9ed9 fb03a29a517452b9f12bcf459ef37d0a543765bb3bbc911e70a87d6a37c30d5f"; do \
      set -- $v; mkdir -p "/root/.svm/$1"; \
      curl --fail --location --retry 5 --retry-all-errors "https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v$1+commit.$2" -o "/root/.svm/$1/solc-$1"; \
      echo "$3  /root/.svm/$1/solc-$1" | sha256sum --check && chmod +x "/root/.svm/$1/solc-$1" || exit 1; done
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
