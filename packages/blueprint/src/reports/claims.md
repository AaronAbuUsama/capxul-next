# Acceptance claims of the domain `reports`

Rendered from `claims.ts` here and the declarations by `pnpm claims`. Do not edit it by hand: a test fails when
this file and its sources differ. What the runner checks on every call, and the starting worlds a claim is in,
are in [claims.md](../../claims.md).

## Count

| Operation | Claims | Old, word for word | Old, rewritten | New | Old, not kept |
|---|---|---|---|---|---|
| `report.run` | 3 | 1 | 0 | 2 | 0 |

## 1. `report.run`

- Served by: the world group.
- Refusals: `OrgNotFound`, `NoSiteUser`, `SiteRefused`, `SiteUnavailable`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: none.
- Budget: 8,000 ms, provisional, excluding waking a parked world. Basis: no report has been timed; a report reads many rows on the site. The first green run replaces this.

1. A report runs as the caller and the books agree with the chain. *(thin line)*
   - In: `paid`.
   - Observes: report.run as sam of the General Ledger filtered to the Capxul Safe account answers lines whose balance equals the company Safe's USDC balance read through the door's chain RPC at the latest block (chain.balance of `contracts.usdc` for the `founded` fact's Safe); the Trial Balance agrees, and the paid invoice has nothing outstanding in Accounts Payable.
   - Old: `acc:report.run/c-6c39c42c744b8c91`, kept word for word.
2. A report the caller's roles do not open, and a report that does not exist, are each refused by the site.
   - In: `paid`.
   - Observes: report.run as sam of a payroll report is refused with SiteRefused for permission; of `Ledger of Everything`, with SiteRefused for not_found.
   - Refusals: `SiteRefused`.
   - Old: none; this claim is new.
3. A caller with no user on the company's site is refused.
   - In: `paid`.
   - Observes: report.run as pat is refused with NoSiteUser.
   - Refusals: `NoSiteUser`.
   - Old: none; this claim is new.
