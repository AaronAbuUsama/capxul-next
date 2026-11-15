# The build order of the domain `board`

Where each operation of this domain comes in the order to build the blueprint in, and what it needs: the parts of a
world, listed in [order.md](../../order.md), and the starting worlds, listed in [claims.md](../../claims.md). "#" is
the operation's step in that order; operations may share a step when they can be built at the same time.

## Who changes a Board, and how it reaches the chain

A Director is a signer of the company Safe. `deployMoney` (packages/contracts, `InstallerMoney._shareholdersTree`)
creates the Director hat under the Shareholders' top hat, with the founder's personal Safe as its eligibility and
toggle, mints it to every founding Director's Safe with one seat each, and hands the Shareholders' top hat to the
founder's Safe. The Signer Gate (`_gateInit`) takes the Director hat as its signer hat and the Shareholders' top hat
as its owner hat, with `ABSOLUTE` threshold `min = target =` the founding threshold (Core's `org.create`), and is the
company Safe's module and guard.

So the Board cannot change itself. The Gate refuses every company Safe transaction that calls the Safe
(`CannotCallSafe`), so `addOwnerWithThreshold` and `changeThreshold` are out; `Hats.mintHat` of the Director hat is
its admin's, the Shareholders' top hat; `setThresholdConfig` is the Gate's owner hat's, the same hat. Every change
to the Board is one UserOperation of the founder's own Safe, which `org.director.add` and `org.threshold.set`
prepare with one approval, the founder's, as `org.create` prepares the setup (decisions.md 48): its digest is the
Safe4337Module's operation hash and `approval.sign` sends it through the world's bundler at the first signature.

- **Seat a Director** (`org.director.add`): `Hats.changeHatMaxSupply(directorHat, supply + 1)` when every seat is
  worn, `Hats.mintHat(directorHat, memberSafe)`, then `HatsSignerGate.claimSignerFor(directorHat, memberSafe)`, which
  makes the Safe an owner of the company Safe. The threshold stays what the Gate computes for the new number of
  owners: with `min = target = t`, still `t`.
- **Set the threshold** (`org.threshold.set`): `HatsSignerGate.setThresholdConfig({ ABSOLUTE, n, n })`, which
  rewrites the company Safe's threshold. A threshold of 0 or more than the Directors would make the Gate refuse every
  transaction (`ThresholdTooLow`), so both are refused before anything is proposed.

The same design is main's, frozen and designed (main's `blueprint/board/operations.ts`, `org.board.director.add`
and `org.board.threshold`: "It is never a Board proposal: the Signer Gate refuses every owner change the Safe
makes"). Old Acme s1.15 added an Owner by a company Safe proposal (`addOwnerWithThreshold`), which a company under a
Signer Gate refuses. Once shares are issued the Shareholders' top hat goes to the Governor and a change to the Board
becomes a shareholders' vote; that comes with equity.

**What the site is told.** A Director has a user on the company's site with the Director's hat, `admin`
(Core's `SITE_HATS.director`): the setup's landing queues a `grant` of it for each founding Director, which is why
`founded` has users for dana and eli. A seat that lands queues the same `grant` for the new Director, so the new
Director's user reaches the site.

**What the Board is in Core.** `org.member.grant` asks one approval per Director at the Board's threshold, from
Core's `app.organizations` (`directors`, `threshold`), and `org.member.list` lists the Directors from it. A seat or a
threshold that lands updates them, so a later proposal asks the new Director and needs the new threshold.

**Not here yet.** Removing a Director (`Hats.setHatWearerStatus(directorHat, safe, false, false)`, then
`HatsSignerGate.removeSigner(safe)`, refused when the threshold would exceed the Directors left) and replacing one;
on the site, a `revoke` the Capxul app does not take yet (`capxul/hats.py` has `apply_hat_revoked`).

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 15 | `org.director.list` | database, chain | `founded` | Reads the company Safe's owners and threshold and the world's cast; every other operation here is checked through it. |
| 15 | `org.director.add` | database, chain, index, signing, site | `founded` | Needs a founded company, `approval.sign` to send the founder's UserOperation, and the site to take the new Director's user. |
| 16 | `org.threshold.set` | database, chain, index, signing | `founded` | Its journey raises the threshold of a Board `org.director.add` grew, then has `org.member.grant` and `approval.sign` honour it. |
