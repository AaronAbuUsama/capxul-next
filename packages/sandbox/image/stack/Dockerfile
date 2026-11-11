# The stack box: the box (../Dockerfile) plus Docker, so Capxul's whole stack runs in it: the spike's Frappe sites
# (bench, MariaDB, Redis by docker compose, on the host network, as packages/devnet/cloud runs them) beside the chain.
# Cloudflare supports Docker inside a container when dockerd runs as root with iptables and IP forwarding off
# (developers.cloudflare.com/containers/faq). Docker's state lives in /var/lib/docker: the prepared stack (pulled images,
# the built bench) is kept there by a golden snapshot (prepare.sh), so a box from it needs no internet.
ARG BOX
FROM ${BOX}
RUN curl --fail --location --retry 5 --retry-all-errors https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz -o /tmp/docker.tgz \
    && echo "4f798b3ee1e0140eab5bf30b0edc4e84f4cdb53255a429dc3bbae9524845d640  /tmp/docker.tgz" | sha256sum --check \
    && tar -xzf /tmp/docker.tgz --strip-components=1 -C /usr/local/bin && rm /tmp/docker.tgz \
    && mkdir -p /usr/local/lib/docker/cli-plugins \
    && curl --fail --location --retry 5 --retry-all-errors https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose \
    && echo "ed1917fb54db184192ea9d0717bcd59e3662ea79db48bff36d3475516c480a6b  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum --check \
    && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose && docker --version && docker compose version
RUN apt-get update && apt-get install -y --no-install-recommends iptables kmod jq && rm -rf /var/lib/apt/lists/*
COPY start.sh /usr/local/bin/box-stack-start
RUN chmod +x /usr/local/bin/box-stack-start
CMD ["/usr/local/bin/box-stack-start"]
