# chain

The one port to a chain. `connect(rpcUrl)` answers a `Chain` (a viem public client and a wallet per key); `send` sends one
transaction and throws, naming its hash, when it reverts. The other modules take a `Chain` and never read the environment.
