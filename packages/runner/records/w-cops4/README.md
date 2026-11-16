# w-cops4

`./run.sh chain --world=cops4` on 13 November 2026, in a world made with `world create` (its cast made by hand, as
world.create does not yet): the real Core on Cloudflare founded northwind (org.create, 3.0 s on the server), dana's
signature was kept and eli's sent the setup as one sponsored UserOperation through the world's bundler (3.5 s), a
grant of manage-books to sam was proposed and sent the same way through the relayer (3.4 s), the chain read back
through the world's door each time, and every call passed the span, outcome and events checks. `passed`.
`inventory-after.json` is `world inventory` after `world destroy cops4`: nothing of the world left.
