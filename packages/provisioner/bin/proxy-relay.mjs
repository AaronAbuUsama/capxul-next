// Serves this host's loopback proxy on the Docker bridge, so a world box with its own network can use it.
// Only for a Claude cloud container, whose agent proxy listens on 127.0.0.1. Binds the bridge address only.
//   node bin/proxy-relay.mjs [bridge-address] [port]      (defaults: 172.17.0.1, the proxy's own port)
import net from "node:net";

const target = new URL(process.env.HTTPS_PROXY ?? "");
const host = process.argv[2] ?? "172.17.0.1";
const port = Number(process.argv[3] ?? target.port);
if (!target.port) throw new Error("HTTPS_PROXY must name the loopback proxy, e.g. http://127.0.0.1:37033");

net
  .createServer((client) => {
    const upstream = net.connect(Number(target.port), target.hostname);
    client.pipe(upstream).pipe(client);
    const close = () => (client.destroy(), upstream.destroy());
    client.on("error", close);
    upstream.on("error", close);
  })
  .listen(port, host, () => process.stdout.write(`proxy relay ${host}:${port} -> ${target.host}\n`));
