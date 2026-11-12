## What
Redraw the books tables and their sync to the accepted option: book-companies and book-accounts (blueprint/books/data.ts), the head feed and sync (blueprint/books/frappe.ts) and the decisions that still model Capxul's own copy (books.sync, books.vouchers, books.chart-tree, books.head-setup). The Capxul app inside the site turns each money fact into the ERPNext entry.
## Why
Aaron accepted books.chart-owner as recommended, 12 November 2026 06:07 UTC (a-20261112T060739-819d79): ERPNext alone holds the chart; Capxul's service keeps only the on-chain money facts, their annotations and the tokens it watches.
## Done when
- No table, rpc or decision in blueprint/books/ describes Capxul's service holding or pushing its own copy of the chart of accounts, cost centres or company accounting settings, and pnpm test and pnpm portal:check pass.
