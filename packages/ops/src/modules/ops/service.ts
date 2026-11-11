import type { Ports, Process, Result, Service } from "./types.ts";

export const services: Service[] = [
  { name: "portal", port: 4391, prepare: "pnpm portal", command: "PORTAL_ALLOW_HOSTS=macbook.tail4b9a40.ts.net:8443 exec pnpm portal:serve --port 4391", match: /portal.*(?:serve|main\.ts)/ },
  { name: "host", port: 4392, command: "LOOP_HOST_ORIGINS=https://macbook.tail4b9a40.ts.net:8443 exec pnpm loop serve --port 4392", match: /loop.*(?:serve|main\.ts)/ },
  { name: "alerts", command: "exec pnpm loop alerts", match: /loop.*alerts/ },
  { name: "chain", port: 8545, command: "exec anvil --port 8545 --state spikes/skeleton/core/state/anvil-state.json", match: /\banvil\b/ },
  { name: "core", port: 8787, cwd: "spikes/skeleton/core", prepare: "bin/chain-up.sh", command: "exec node --experimental-strip-types --no-warnings src/main.ts serve", match: /(?:core.*main\.ts|src\/main\.ts serve)/ },
];
const good: Result = { ok: true };
const bad = (error: string): Result => ({ ok: false, error });
const identity = (p: Process, s: ReturnType<Ports["read"]>): boolean => !!s && p.pid === s.pid && Math.abs(p.started - s.started) < 2000;

export const supervisor = (io: Ports) => {
  const terminate = async (p: Process, group: boolean): Promise<void> => {
    // Detached spawns lead their own group. A pnpm leader exiting is not
    // evidence that its server children exited too.
    const survives = (v: Process): boolean =>
      (group && v.pgid === p.pid) || (v.pid === p.pid && v.started === p.started);
    io.signal(p.pid, "SIGTERM", group);
    for (let elapsed = 0; elapsed < 10_000; elapsed += 200) {
      if (!(await io.table()).some(survives)) return;
      await io.sleep(200);
    }
    if ((await io.table()).some(survives)) io.signal(p.pid, "SIGKILL", group);
  };
  const stop = async (s: Service): Promise<Result> => {
    const saved = io.read(s.name);
    for (const p of await io.table()) {
      const recorded = identity(p, saved);
      if (recorded || (s.port !== undefined && p.ports.includes(s.port) && s.match.test(p.command))) {
        io.say(`stop ${s.name}: ${p.pid} ${p.cwd} ${p.command}`);
        await terminate(p, recorded);
      }
    }
    io.remove(s.name);
    return good;
  };
  const start = async (s: Service): Promise<Result> => {
    if (io.worktree) return bad("Start refused inside a worktree (.git is a file); use the main checkout");
    const table = await io.table(), saved = io.read(s.name);
    const holder = table.find((p) => s.port !== undefined && p.ports.includes(s.port));
    if (holder && holder.cwd !== io.root && !holder.cwd.startsWith(io.root + "/spikes/skeleton/core")) return bad(`Port ${s.port} held by ${holder.pid} from ${holder.cwd}: ${holder.command}; run pnpm ops reap`);
    if (table.some((p) => identity(p, saved))) return good;
    if (holder) return bad(`Port ${s.port} already held by ${holder.pid}: ${holder.command}; run pnpm ops stop ${s.name}`);
    if (s.name === "core") { const r = await start(services.find((v) => v.name === "chain")!); if (!r.ok) return r; }
    if (s.prepare) await io.prepare(s.prepare, s.cwd ?? "");
    const pid = await io.spawn(s);
    const p = (await io.table()).find((v) => v.pid === pid);
    if (!p) return bad(`${s.name} exited during start; see var/ops/${s.name}.log`);
    io.save(s.name, { pid, command: s.command, checkout: io.root, started: p.started });
    if (s.port) {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await io.answering(s.port)) { ready = true; break; }
        await io.sleep(200);
      }
      if (!ready) return bad(`${s.name} did not answer on ${s.port}; see var/ops/${s.name}.log`);
    }
    io.say(`started ${s.name}: ${pid}`);
    return good;
  };
  return {
    start, stop,
    status: async (s: Service): Promise<Result> => {
      const saved = io.read(s.name), table = await io.table();
      const p = table.find((p) => identity(p, saved)) ?? table.find((p) => s.port !== undefined && p.ports.includes(s.port) && s.match.test(p.command));
      io.say(`${s.name}: ${p ? "running" : "not running"}; pid=${p?.pid ?? "-"}; uptime=${p ? Math.max(0, Math.floor((io.now() - p.started) / 1000)) + "s" : "-"}; port answering=${s.port ? await io.answering(s.port) : "n/a"}; checkout=${p?.cwd ?? saved?.checkout ?? "-"}`);
      return good;
    },
    reap: async (dry = false): Promise<Result> => {
      const worktrees = io.root + "/.claude/worktrees/", runs = io.root + "/var/runs/";
      for (const p of await io.table()) {
        const text = p.cwd + " " + p.command;
        const lane = text.includes(worktrees) || text.split(runs).slice(1).some((v) => /^[^/\s]+\/lane(?:\/|\s|$)/.test(v));
        const oldWatch = /loop(?:\/src\/main\.ts)?\s+watch\b/.test(p.command) && io.now() - p.started > 12 * 3600_000 && (p.cwd === io.root || text.includes(io.root + "/"));
        // Only this project's service-shaped processes: never a Claude session, a shell or anything else a person runs there.
        const service = /(^|\/)(anvil|node|pnpm|npm|npx)$/.test(p.command.split(" ")[0] ?? "") || /^sh -c .*\bnode\b/.test(p.command);
        const person = /claude|\b(zsh|bash|fish|login|tmux|vim|nvim|code)\b(?! -c)/i.test(p.command.split(" ")[0] ?? "") || /(^|\/)(claude|disclaimer)$/i.test(p.command.split(" ")[0] ?? "");
        if ((lane || oldWatch) && service && !person) { io.say(`${dry ? "would stop" : "reap"} ${p.pid} ${p.cwd} ${p.command}`); if (!dry) await terminate(p, false); }
      }
      return good;
    },
  };
};
