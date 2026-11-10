# Assembly items from the concept designers

Each designer listed what its concept needs from others, or what others need from it. The assembly step resolves each one in the owning concept, or records a decision not to.

Also: the architecture review moved org.member.invite to budgets and dev.mail.notices to devnet after some designs were written (`target-architecture-review.json`). Full reports: `concept-reports.json`.

## access

Old 51 rpcs and workflows; target 27 rpcs, flows, procedures and workflows. 10 frozen operations, 21 decisions.

- Shared foundation text is out of date: concept_access's about still says access owns 'the CLI's native client grants (device flow)'. Decision access.no-device-flow drops them under P2: no client starts a device request, and the CLI keeps v1 grant records only to delete them (apps/cli/src/auth/native-grant-cleanup.ts:5). The shared foundation needs this update; I did not edit it.
- Two shared settings are no longer needed: the MCP_EXCHANGE_SECRET entry in the devnet and staging environment secrets, and the JWKS route named in component_backend's about. The runtime now resolves assistant access tokens and opaque session tokens directly (decisions access.assistants and access.sessions).
- shared decision rules.durable-processes should add 'an assistant grant' to its list of long-lived objects. Access adds it under decision access.assistant-grant-process, with workflow access.assistants.grant.
- Inbound expectation, not a link: accounts' auth.login and auth.verify flows should step through rpc_access_sign_in_send_code, rpc_access_sign_in_verify_code, rpc_access_sign_in_challenge and rpc_access_sign_in_with_key in blueprint/access/sign-in.ts. Other concepts already import table_feature_flags and table_principals, and both resolve.
- The worlds empty-devnet, person-signed-in and two-people-signed-in assume the eval harness snapshots the eval machine's CLI home together with the devnet world. The harness must also be able to make the state file unreadable or read-only after a restore (decision access.worlds).
- Three expected gaps remain, all unused-flow: client.auth.browser.sign-in, client.auth.key-session and client.auth.assistants.consent. Each serves a non-CLI surface (web app and approval page, an agent's SDK host, the consent page), and its about names that surface.
- The full target build currently has 7 problems, all from contacts: dangling reads of table:org-members, because organizations is not designed yet. None come from access.

## accounts

Old 42 rpcs and workflows; target 18 rpcs, flows, procedures and workflows. 11 frozen operations, 17 decisions.

- One build problem is mine and it is allowed: the setup process accounts.setup.personal-safe reads indexing's `escrows` table, and indexing is not designed yet, so the link is reported as dangling. It goes through blueprint/accounts/links.ts and resolves on its own once blueprint/indexing/data.ts exports `table_escrows` (other concepts use that name too).
- Shared change needed in shared/external.ts: the test token's open `mint(address,uint256)` (old packages/contracts/src/TestMoneyToken.sol:22) is missing. Until it is added, the `chain` list of accounts.grants.fund and of the setup's welcome-grant step is empty (see decision accounts.faucet).
- Gap: no devnet world can reach dev.fund's WRONG_ENVIRONMENT refusal (refused off a devnet), so its `given` is `?`. Only the staging live:* evals reach it.
- Gaps by design: flow client.account.setup (the web app's setup page) and flow client.operator.waitlist.admit (the operator's tool) implement no frozen operation. P2 allows this because they are the surfaces that reach accounts.setup.start and accounts.admission.admit.
- Gaps: waitlist.invites.grant and dev.fund have no frozen acceptance lines.
- Tooling note: a birth is booked as a transition with `from: []` (join, admit_unlisted, attribute, start). The generated state diagrams leave these out, though the build rules accept them.
- For Aaron: accounts.admit is the one procedure that is an authority fact, not a money fact. It is booked as the shared decision procedures.accounts-admit rules, and Aaron may rule against it under P4.
- link: indexing: table_escrows (id `escrows`) from blueprint/indexing/data.ts, read by workflow accounts.setup.personal-safe to find the open claim escrows that pay the person's Safe; it is taken by its export name in blueprint/accounts/links.ts once indexing lands

## activity

Old 13 rpcs and workflows; target 19 rpcs, flows, procedures and workflows. 6 frozen operations, 18 decisions.

- The official build (node --experimental-strip-types packages/blueprint-engine/src/main.ts blueprint/index.ts ...) stops before checking anything, with ERR_MODULE_NOT_FOUND for blueprint/media/data.ts. banking/verification.ts imports it, so the fault is in banking's or media's lane, not activity's. I checked activity instead with a scratch index of the shared records, access, parties, indexing, approvals, accounts, organizations, budgets, books, documents, payments and activity, kept at /tmp/claude-0/-home-user/c92cd756-b1a0-5414-9fe4-a7834db8d32a/scratchpad/activity-check.index.ts. Result: 1148 records, 0 activity problems. The 14 problems that build reports belong to other concepts: rpc:organizations.setups.begin reads table:files, and budgets' and payments' rpcs invoke procedure:board.propose, neither of which is in the book yet.
- Two known gaps, both recorded in decision activity.unreachable-refusals: operation:address and operation:balance each keep their frozen INVALID_INPUT refusal with world '?'. The malformed Safe salt namespace setting, a non-positive chain id and a mismatched stored Safe cannot happen at read time in the target.
- link: documents: table_documents (id 'documents') through blueprint/activity/links.ts, by its conventional name. It resolves now that blueprint/documents/data.ts exports it, and the get rpc uses that table's by_subject index to find a Movement's Memo by `<chain id>:<tx hash>:<log index>`.
- link: payments: imports the PaymentView schema from blueprint/payments/ledger.ts (activity get shows a Payment exactly as payment get does), and the change-log workflows depend on the payment and movement machines' transitions in blueprint/payments/data.ts.
- link: books: imports the Annotation schema from blueprint/books/annotations.ts, and table_book_annotations, table_book_accounts and table_book_prices from blueprint/books/data.ts. books is not yet in blueprint/index.ts.

## agents

Old 25 rpcs and workflows; target 16 rpcs, flows, procedures and workflows. 8 frozen operations, 24 decisions.

- The full target build (blueprint/index.ts) cannot run yet, and the cause is outside agents: banking/verification.ts imports blueprint/media/data.ts, which does not exist. Agents was checked instead with two check indexes in the scratchpad. The narrow one (shared, access, parties, indexing, approvals, accounts, organizations, board data and procedures, agents) and the wide one (that set plus all board files, budgets, books and contacts) both report 0 agents problems and 0 agents gaps.
- Problems from other concepts in the wide check: organizations.setups.begin has a dangling link to media's files table, and board.directors.safe, board.directors.show and board.proposals.list are unreached rpcs. These are the other designers' to fix.
- Board has no index.ts yet and is not listed in blueprint/index.ts. Agents' links to procedure_board_propose (board/procedures.ts) and table_board_proposals (board/data.ts) will dangle in the full build until the board designer adds board's modules before agents.
- sys:tx-width open question: an Organization-owned create or sweep calls 2 procedures from 2 concepts directly (parties, board), but board.propose itself calls approvals.open, which makes 3 concepts if nested calls count. Recorded in decision agents.transaction-width for the reviewer of that rule.
- Removed the `agent create --org` FEATURE_NOT_AVAILABLE refusal in favour of the designed v4 `--org` (P10 rung 1). FEATURE_NOT_AVAILABLE is still reachable through board.propose's owner-safe-proposals gate. Decision agents.org-owned; Aaron may want to review this surface choice.
- link: procedure_board_propose (../board/procedures.ts): the file exists, but board is not yet in blueprint/index.ts
- link: table_board_proposals (../board/data.ts): the file exists, but board is not yet in blueprint/index.ts

## applications

Old 28 rpcs and workflows; target 13 rpcs, flows, procedures and workflows. 6 frozen operations, 23 decisions.

- The full target book still does not load, and not because of applications: blueprint/banking/verification.ts imports blueprint/media/data.ts, which does not exist yet (ERR_MODULE_NOT_FOUND). So I proved applications on a scratch slice instead: shared + access + parties + indexing + approvals + accounts + organizations + applications, built from /tmp/claude-0/-home-user/c92cd756-b1a0-5414-9fe4-a7834db8d32a/scratchpad/apps-book.ts into /tmp/target-applications. It reports 0 problems in applications' records.
- The slice build's only problem belongs to organizations: rpc organizations.setups.begin reads table:files, which is dangling because media is not designed yet.
- The shared records still say applications owns consent: concept_applications.about in blueprint/shared/foundation.ts and decision concepts.applications. My decision applications.no-consent drops the consent table. Its only old writer was the native device-flow accept, which access dropped, and its only old reader was the operator probes. The owner of the shared records should change that wording.
- Decision applications.origin-token lists component_backend in affects. It sets a contract for the backend's HTTP layer that no runtime record holds: a browser origin is admitted when the request carries a valid origin token from the bootstrap, or when the origin is in TRUSTED_ORIGINS. Whoever builds the backend runtime needs to implement it.
- One gap remains, and it is expected: flow create-capxul-client is unused-flow. It is the browser bootstrap for the web surfaces (React SDK), and no frozen operation uses it.

## approvals

Old 37 rpcs and workflows; target 8 rpcs, flows, procedures and workflows. 0 frozen operations, 18 decisions.

- Gap `unused-flow` on client.approvals.sign: the schema's FlowSpec has no `for: surface` field yet (P2's sketch), so the approval-page flow stays listed as unused. Decision approvals.no-operations says this is expected.
- Gaps `uninvoked-procedure` on approvals.open and approvals.withdraw: they close as openers are registered in blueprint/index.ts. payments and organizations already import procedure_approvals_open. No opener invokes approvals.withdraw yet; payments, board and organizations should, when an intent ends before anyone signs.
- Question for the A2 workflow-engine spike: the process waits for Ponder's UserOperationEvent at its (chain, sender, nonce), found through index by-sender-nonce. It is also resumed by the `withdraw` transition's event, which a procedure writes in the opener's transaction. The engine needs a way to route both to the waiting instance.
- Openers must map approval endings onto their frozen codes: expired becomes WRONG_STATE, declined becomes CANCELLED, refused takes its stored refusal code, and board answers WRONG_STATE `execution_reverts`. Operations that print the old five states (pending, approved, consumed, rejected, expired) must use the mapping in decision approvals.machine.
- Chain-submit operations now include a workflow start and the paymaster's sponsorship before the SDK can sign. This needs measuring against the 2000/4000 ms chain-submit budget once built.
- The real target book build reports 7 problems, all in contacts (pending link to organizations' org-members), none in approvals.

## banking

Old 75 rpcs and workflows; target 23 rpcs, flows, procedures and workflows. 11 frozen operations, 23 decisions.

- The real build of blueprint/index.ts crashes for everyone right now: organizations, budgets, payments and requests already import modules that do not exist yet (indexing, board, documents, media). I added banking in foundation order (after payroll, before requests); its own missing links are listed under pendingLinks.
- payments.prepare-command's PreparedItem requires a stored document_id and document_hash, but banking's dependsOn does not include documents. A bank payout's item therefore carries no document (the zero hash). Fix one of two ways: add documents to banking's dependsOn, or let prepare-command accept an item with no document.
- prepare-command has no expiry. A payout's Payment must not be able to land after the quote's deadline: the approval's validity should be capped at quote.expires_at, and `payment retry` should be refused once a payout has expired. Banking also has no way to withdraw an unsigned payout Payment when its bank account changes before approval: approvals.withdraw exists, but banking does not depend on approvals. Until payments adds a withdraw procedure, a changed account ends the payout `expired`, and only if the person signs anyway does Bridge refund the send. In that case bank.pay's 'nothing is sent' for a changed account is not guaranteed.
- shared/external.ts Bridge has no read of a single virtual account and no cancel for an unfunded transfer. bank.settle therefore no longer reads before it writes: acceptance lines #1-#4 are rewritten in decision banking.acceptance-rewrites. Unfunded transfers are left to lapse at Bridge (decision banking.processes). Add getBankDetails or cancelPayout calls to Bridge if reviewers want the old behaviour back. Bridge's removeBankAccount call stays unused, which shows as a gap.
- The generated row-level security policy needs one cross-tenant clause: an invited person must be able to read and submit their own verification-people row, which belongs to the Organization, by invitation id plus their signed-in email.
- The Bridge fake's description in shared/external.ts should say that the devnet stand-in, and the staging sandbox harness, send the test tokens for a sandbox deposit. Decision banking.sandbox-deposits drops the old staging mint, so without this no sandbox deposit can ever be credited.
- Product judgment for Aaron's data-model review: 'current authority to manage' an Organization's banking is taken to mean a Director or the Books officer, and verifying the business takes a Director (decision banking.manage-authority). A second one: a new payee in `bank pay --input` is saved only as a bank account, not as a contact (decision banking.new-payee).
- link: ../indexing/data.ts: table_hat_wearers (read by verification.start, details.show, details.settle, accounts.add, accounts.remove; organizations imports the same name)
- link: ../media/data.ts: table_files (read by banking.verification.start; organizations imports the same name)
- link: ../media/files.ts: rpc_media_files_upload (the upload step of flow client.verification.start; name guessed by convention)
- link: ../books/procedures.ts: procedure_books_record_money_fact (exists, but books is not in blueprint/index.ts yet; invoked by banking.deposits.credit and banking.payouts.follow)

## board

Old 53 rpcs and workflows; target 34 rpcs, flows, procedures and workflows. 19 frozen operations, 20 decisions.

- None in board's records: tsc -p blueprint reports no errors in blueprint/board, and a partial target book of shared + access, parties, indexing, approvals, accounts, organizations, board (+ agents, budgets) builds with 0 board problems and no board gaps.
- The full target build (blueprint/index.ts) cannot run yet: another designer's banking/verification.ts imports blueprint/media/data.ts, which does not exist. Even in the partial book there is one problem that is not board's: organizations.setups.begin reads media's table `files`.
- Organizations still has old wording (its folder, so I left it alone): procedures.ts (organizations.bind-invitation-grants) and data.ts (table org-invitations) say board's `org member invite` flow invokes the binding. Budgets owns that flow now (operations.member-invite-in-budgets).
- One status was added to the frozen surface: a proposal whose Safe execution reports ExecutionFailure reads `failed` (decision board.failed-proposal). Budgets, payments, payroll, agents and equity follow proposal_transitioned, so they should treat `fail` as 'ran without effect'.

## books

Old 46 rpcs and workflows; target 23 rpcs, flows, procedures and workflows. 17 frozen operations, 21 decisions.

- Books is NOT registered in blueprint/index.ts yet. Its files import table_hat_wearers and table_escrows from ../indexing/data.ts, and nobody has written that file. Registering books now would crash the shared build for every designer. Add `...books.modules` after budgets once indexing/data.ts exists and organizations is registered. Verified instead in a scratch harness: the real shared files plus access, parties, approvals, contacts, organizations/data.ts, an indexing stub and books. Result: 777 records, 0 problems, written to /tmp/target-books.
- Harness gaps for books, expected: books.record-money-fact and books.reverse-money-fact show as uninvoked only because payments and banking are not in the harness. Their processes.ts files already invoke both by these names. org.books.assets.list's INVALID_INPUT keeps given '?': an empty id is refused by the CLI's --org scope with CLI_USAGE before it reaches the rpc.
- For Aaron's data-model review (W1), books.facts-without-chart: money facts are kept from an Organization's first money, chart or not, and there is no backfill. This contradicts two frozen sentences, which stay verbatim as frozen text: the import's `changes` ('schedules a backfill') and the import note 'An Organization without a chart keeps no money facts'. On the target, `facts list` shows money facts before the import. Every acceptance line still holds.
- For review, books.annotate-known-rows: books sits below payments, so it cannot check that a person takes part in a Payment. A person's annotation is accepted on any row, but lives only in that person's own books and posts nothing. An Organization row must have a money fact in the books, so an unsettled Payment is refused INVALID_INPUT until it settles. Its account travels with `payment send --account` instead.
- books.export-files-by-cli has the SDK return the two CSV texts and the CLI write them, because the shared vocabulary says the SDK never returns CLI_STORAGE. shared/landings.ts says 'books/exports: two files written by the SDK'. The architecture thread should align that note.
- Reclassify acceptance line 3 (a commitment whose claims fall on both sides of the period) needs a row with money facts in two periods. On v4 each agreement collection is its own Payment, so the world org-with-chart can only hold such a row if payments references collections by the agreement.
- Indexing must provide two Safe-scoped views: `escrows` (the Organization's open escrows, by owner Safe and held amount, for the reconcile's `held` column) and `hat-wearers` (who wears the Books hat).
- The books feature gate (FEATURE_NOT_AVAILABLE) is in every books rpc's errors except annotate's, but in no operation's refusals, because the frozen pages list none. Import acceptance line 4 still checks it.
- link: ../indexing/data.ts: table_hat_wearers (not yet written). Read by books.accounts.import/add/rename/archive/accept/reclassify, books.annotations.save, books.assets.add/remove for the Books hat. The same name organizations already imports.
- link: ../indexing/data.ts: table_escrows (not yet written). Read by books.reports.reconcile.
- link: ../organizations/data.ts: table_organizations, table_org_deployments (books_hat), table_org_members. These exist, but organizations is not yet registered in blueprint/index.ts.
- link: ../access/data.ts: table_feature_flags. Exists and is registered.
- link: Inbound links: ../payments/processes.ts and ../banking/processes.ts import procedure_books_record_money_fact and procedure_books_reverse_money_fact from ../books/procedures.ts. The names match, and they use the money_key contract (`transfer:<chain>:<tx>:<log>`, payout_returned and deposit_received keyed by the Transfer).

## budgets

Old 35 rpcs and workflows; target 30 rpcs, flows, procedures and workflows. 18 frozen operations, 24 decisions.

- The real target build cannot load until blueprint/indexing/data.ts and blueprint/board/procedures.ts exist; organizations/workspaces.ts imports indexing too, so it was already blocked. With scratch stand-ins for exactly the pending links, the budgets slice builds with 0 problems and no gaps on budgets' own records.
- Notices' dependsOn does not list budgets, so the frozen claim that the member is emailed once an allowance assign executes (org.allowance.assign #5) has no sender. Adding concept_budgets to notices' dependsOn in shared/foundation.ts, and a notices workflow on budget_change.apply, would give it one (decision budgets.notices-need-budgets).
- contract_hats in shared/external.ts has no getNextId or viewHat. Hat ids are planned from indexing's hats with Ponder at the chain head, and a hat created outside Capxul under the same admin between proposal and execution can still shift the id. Booking Hats.getNextId (or a v4 guard) would remove that risk (decision budgets.hat-planning).
- Organizations' invitation Offer has a 'new-allowance' variant with a pre-v4 'limit' (a per-payment cap) that board cannot honour without budgets; recommended: offer existing allowances only (decision budgets.invitation-allowance-offers).
- Board's org member grant of the People hat should refuse a department office holder (ROLE_CONFLICT, the reverse of the check budgets now makes), reading office hats from indexing's Budgets view (decision budgets.role-conflict-people-hat).
- Three rewritten acceptance lines need a run against the old system's v4 path to confirm they pass: org.department.budget.set #4, org.department.list #4, org.allowance.list #3.
- link: ../indexing/data.ts: table_chain_budgets (company Safe's budgets from BudgetCreated/AmountSet/Closed/Reopened, with parent and hat)
- link: ../indexing/data.ts: table_hat_wearers (who wears each hat now)
- link: ../indexing/data.ts: table_chain_hats (HatCreated under an admin hat, with max supply and supply)
- link: ../indexing/data.ts: table_chain_agreements (offers and running agreements per budget)
- link: ../board/procedures.ts: procedure_board_propose (board.propose, named by rules.procedures)

## contacts

Old 10 rpcs and workflows; target 10 rpcs, flows, procedures and workflows. 6 frozen operations, 17 decisions.

- contact.get's frozen returns include `bankAccounts`, which banking owns. Contacts sits below banking, so its flow cannot read them without depending on banking. Decision contacts.get-bank-accounts recommends moving contact.get to banking in OPERATION_OWNERS, as contact.bank.add already is: banking's flow would call contacts.book.get, then its own masked account list. Until the map changes, the operation keeps its frozen returns but its flow returns only the entry. This needs the concept-map owner (shared/foundation.ts), not a contacts edit.
- The real target build shows 7 contacts problems, all one cause: `dangling: reads → table:org-members`. Organizations has no index.ts yet, so it is not in blueprint/index.ts. A scratch build that includes blueprint/organizations/data.ts gives 0 problems and 0 contacts gaps. These clear when organizations adds itself to the index.
- Needs a ruling (product/authority): decision contacts.members-write lets any member (an active Seat) write an Organization's address book, as the frozen `who` says. The old code required manager authority (requireWriter/requireManager). I judged that an entry is neither money nor authority, so P10 rung 3 does not apply, and contacts cannot read hat wearers anyway because it does not depend on indexing.
- Behaviour narrowed: relationship values are now only `manual` and `member`. The old paid, paidBy, invoiced, invoicedBy and employed values, and last activity taken from payments, are gone. Under the concept map contacts cannot read or follow payments, requests or payroll; following requests would also make a cycle through banking. No frozen acceptance line depends on the dropped values (decision contacts.relationships).
- A declined terminal preview now ends with CANCELLED (exit 130) instead of the old CLI_USAGE (exit 2). This is decision contacts.decline-is-cancelled. Other concepts' terminal previews should follow it so the CLI stays consistent; it may belong in shared/decisions.ts.
- The world `person-with-contacts` (decision contacts.worlds) still has to be built as a devnet snapshot.
- link: table_org_members from ../organizations/data.ts: the file and export exist, but the organizations concept is not in blueprint/index.ts yet, so the link dangles in the real build
- link: procedure_parties_resolve_recipient from ../parties/procedures.ts: resolves (exists, in the book)
- link: table_parties from ../parties/data.ts: resolves (exists, in the book)

## devnet

Old 10 rpcs and workflows; target 16 rpcs, flows, procedures and workflows. 13 frozen operations, 21 decisions.

- Equity has no operations.ts yet, so its refusal worlds are not in the catalog. When equity lands, run worldGaps(records) from devnet/worlds.ts and add each world it names.
- accounts' waitlist.status acceptance line 1 uses `dev gates set` to open the person gate `beta-access`. The frozen command refuses a missing `--org` with CLI_USAGE, and devnet.scripted-gates only scripts Organization gates, so accounts needs another way to reach that state.
- setup-refused-non-ascii-email (accounts) signs in with a non-ASCII mailbox. access.sign-in.send-code says it normalises email to ASCII, which may refuse that sign-in before the claim can fail with EmailNotNormalized. Accounts and access should check this between them.
- Name collision resolved in devnet.world-collisions: budgets and payroll both used `org-with-frozen-ceiling`. The catalog builds it once, on payroll's org-with-agreements, which now sits on budgets' org-with-budget-tree. payroll's org-with-department, payments' org-with-budgets and requests' org-with-requests are also built on that tree. Budgets' doc comment on W_FROZEN (budgets/operations.ts:68) still says it is built on org-with-budget-tree and should be updated.
- Expected gap: table:mail-messages shows unwritten-table. The `mail` integration's devnet fake writes it, and the schema has no link from a fake to a table (decision devnet.mail-sink).
- I edited shared/external.ts, under decisions devnet.control-refusals and devnet.scripted-prices. devnet-control now carries the refusals the frozen pages give: snapshotSave WRONG_STATE (name exists) and INVALID_INPUT (bad name), snapshotRestore WRONG_STATE (other backend code), clockStartAt INVALID_INPUT (date not earlier) and WRONG_STATE (clocks already moved; was INVALID_INPUT). The chainlink fake now answers the frozen default rates instead of the forked feed. The text of docs/decisions/target-architecture.md was not updated for these.
- The world builder and supervisor controls the catalog relies on are designed but are not records: `capxul-devnet world build`, `fault <switch> <mode>`, `clock hold/release`, `chain safe-exec|transfer|deploy-token|hats-status` and `bridge deposits`. packages/devnet must build them, and the schema has no record kind for supervisor commands.
- Six refusals in other concepts still name `?` because no devnet world can reach them: dev.fund WRONG_ENVIRONMENT, invite.list WRONG_STATE, org.invite.list WRONG_STATE, org.books.assets.list INVALID_INPUT, address INVALID_INPUT, balance INVALID_INPUT.
- The target build reports 3 problems, none in devnet. All three are notices.equity.round-invitation pointing at equity's fundraise tables, which are not in blueprint/index.ts yet.

## documents

Old 6 rpcs and workflows; target 6 rpcs, flows, procedures and workflows. 4 frozen operations, 16 decisions.

- Payments has to change: payments.movements.record (blueprint/payments/processes.ts) does not invoke documents.store yet. Until it stores each Movement's Memo (basis movement, issued at the Transfer's block time, the Movement's sides as participants) in its record transaction, the frozen line document.verify #1 ('A standalone Movement participant can verify its exact Memo') has no Memo to verify. Activity's feed already assumes the Memo exists. Decision: documents.movement-memos.
- Payments' SendInput.document is {content_hash, file_id} and points at a media file. documents.store takes the receipt's bytes (at most 128 KB) because documents does not depend on media, so payments' flow or rpc must pass the bytes. This is for payments' designer to settle.
- document.render acceptance #1 is rewritten: 'A document that names an employer and an employee (a payslip, or an agreement's terms) renders their names, not their Party IDs.' P1 allows a rewrite only when a line names a mechanism, and a payslip is not one, so this goes further than P1 and Aaron should review it (W1). Decision: documents.acceptance-rewrites.
- Two new devnet worlds need building: org-with-documents and org-with-tampered-note. The shared world signed-out is reused. Decision: documents.worlds.
- The full target build (blueprint/index.ts) fails before reaching documents, for reasons outside documents: banking/verification.ts imports blueprint/media/data.ts, which does not exist yet; organizations.setups.begin reads table:files (media); budgets, payments and payroll invoke board.propose (board is not designed). Scratch builds of documents with access, parties, indexing, approvals, accounts and organizations, then with budgets, books, contacts, payments, payroll and activity added, report no documents problems and no documents gaps.
- The links.ts files in payments, payroll, requests and activity still load documents dynamically. procedure_documents_store and table_documents now resolve to real records, so their designers can switch to static imports.

## equity

Old 54 rpcs and workflows; target 71 rpcs, flows, procedures and workflows. 38 frozen operations, 20 decisions.

- The concept map gives equity 38 frozen operations, not 36: 30 from the equity area plus 8 shareholder-vote operations from governance. All 38 have target records.
- 23 of the 38 operations have no frozen acceptance lines, because equity was never built on the old devnet. They keep none (decision equity.acceptance), so the build reports a no-acceptance gap for each until Aaron accepts new lines under spec 30.
- Three vote matters (board-settings, elect, remove) answer NOT_IMPLEMENTED. They need a Hats Elections contract record in shared/external.ts and board's seat design (decision equity.vote-matters).
- `org cap-table --at` answers NOT_IMPLEMENTED until the class tokens' checkpoint reads are recorded in shared/external.ts.
- Each Board-matter prepare rpc calls documents.store and board.propose, and board.propose in turn calls approvals.open. That is procedures of three other concepts in one transaction, which the review-only sys:tx-width rule (at most 2) may flag. payments and payroll have the same shape, so this needs a reviewer ruling.
- Processes follow the equity contracts' chain events through their waits (described in words) and indexer.factsOf, not through workflow triggers. The build therefore reports unconsumed-chain-event gaps for captable, options, rounds, exits, governor, vesting and share-class events. Several events named in the prose (OptionsAccepted, SafeRoundCreated, SafeInvited, SafeSigned, Invited, Allocated, RoundCancelled, TransferOffered, TransferApproved, SaleApproved, Granted, Revoked) are not in shared/external.ts.
- I edited the shared file blueprint/shared/external.ts, inside the equity contracts only, adding 14 view and call functions (decision equity.contract-functions). Captable: setTransferRule, freeze, convertibleReserved, closedForExit. Options: vestedOf. Rounds: pricedRound, position, consent. Exits: transfer, sale. Governor: getVotes, proposalThreshold, hasVoted, isAllowedTarget. Other designers should know about this change.
- The shared decision rules.durable-processes still lists only a round for equity. Decision equity.processes adds an install, a grant, a sale and a vote; the shared record is unchanged.
- Nothing is committed.

## indexing

Old 12 rpcs and workflows; target 0 rpcs, flows, procedures and workflows. 0 frozen operations, 18 decisions.

- The official build (blueprint/index.ts) cannot load yet: budgets/*.ts import ../board/procedures.ts and banking/verification.ts and banking/flows.ts import ../media/*.ts, and neither concept has been designed. These are other designers' folders, so I did not touch them. A scratch index of shared plus every concept that loads (in the scratchpad) builds with 29 problems, all dangling refs to table:budgets, procedure:documents.store, procedure:board.propose, table:bank-deposits, procedure:banking.match-deposit, transition:bank-deposit.credit and table:files. None names an indexing record. Indexing's load cut the count from 65 to 29.
- Every chain table shows the derived gap unwritten-table. That is expected: only Ponder writes these tables, and the book has no writer record for Ponder. The gap will never close unless deriveGaps in packages/blueprint-engine/src/build.ts skips tenancy 'chain' tables. That change is outside indexing's files.
- The agents folder has only data.ts and no index.ts, so I left it out of blueprint/index.ts. Payments and banking were already registered; I added indexing and books.
- IEscrow's InvoicePaymentCompleted event (surplus) is not in shared/external.ts. Ponder still writes it to chain-logs under the escrow contract, but no reader needs it.

## media

Old 9 rpcs and workflows; target 5 rpcs, flows, procedures and workflows. 0 frozen operations, 10 decisions.

- Not in media's folder: parties.profiles.save (blueprint/parties/profiles.ts) says it checks the photo is a kept image the person uploaded, but its reads do not list media's table_files. Parties' decision said this link was waiting for media's tables, and they now exist.
- Not in media's folder: blueprint/organizations/links.ts loads table_files with a dynamic import and keeps it in PENDING. media/data.ts now exports table_files, so organizations can change this to a static import.
- Not in media's folder: banking.verification.start reads table_files, but its about does not say it checks each file's purpose and state. It should require id-image for id_front and id_back, id-image or document for the other fields, and state held.
- For Aaron's data-model review: a replaced photo or logo is now kept for good. The old system deleted it when the new one was bound. Media cannot see a replacement because owners point at its files (concepts.media), and an owner's procedure would not be a money fact (decision media.retention).
- Media adds an identity document to the list of long-lived objects with one durable process each (media.files.expire-document, a 30-minute timer). rules.durable-processes allows a designer to add an object; this one is recorded in decision media.document-process.
- Target build: 0 problems in media. The 3 problems reported come from another concept: workflow notices.equity.round-invitation links to equity's fundraise transition and tables, which are not in the book yet. Media's only gaps are two expected unused-flow gaps: client.media.upload and client.media.fetch-image serve the web app, not a CLI operation.

## notices

Old 30 rpcs and workflows; target 32 rpcs, flows, procedures and workflows. 0 frozen operations, 22 decisions.

- Equity is not in blueprint/index.ts yet (equity/index.ts does not exist), so notices.equity.round-invitation has 3 dangling links: transition fundraise-investment.invite and tables fundraise-investments and fundraise-rounds. They are imported statically from blueprint/equity/data.ts by their conventional names. A scratch build that adds equity/data.ts gives notices 0 problems.
- The full target build reports 6 problems. The 3 that are not notices' belong to organizations and banking, which link media's table files and the rpc media.files.upload; media has not landed.
- Product question for Aaron, not decided: when an email with no account is paid into a claim escrow (payment.escrow), no notice is sent. The old system sent none either, so the payee may never learn the money is waiting.
- Product question, kept as the old system had it: an undated Payment sends no email when it settles or lapses. Only dated Payments notify (notices.dated-payments).
- Product question, kept as the old system had it: Invoices are the only requests that send email, and a payer who is a person on Capxul is not emailed when one is issued (notices.invoices).
- Ten templates are new or renamed and need renderers in protocol's email templates: account-ready, allowance-assigned, director-seated, director-removed, threshold-changed, proposal-waiting, officer-hat-granted, bank-payout-returned, invoice-declined and round-invitation.
- The old payout-ceiling alert to Directors is dropped because a failed agreement write does not keep its revert reason. If payroll later records the revert code, the alert can come back on notices.payroll.collection-refused.
- Recipient rule: an Organization is told through its Directors, read from the company Safe's owners via chain-rpc Safe.getOwners. This is wider than what chain-rpc's about describes (reads before a write is built). Recorded in notices.chain-reads and notices.recipients for review.
- Cosmetic: the generated state diagram for notice shows only its initial birth (send). The hold and refuse births exist in the records, but the view generator draws only the initial state.
- link: equity: machine_fundraise_investment.t.invite (transition fundraise-investment.invite), from blueprint/equity/data.ts
- link: equity: table_fundraise_investments (fundraise-investments), from blueprint/equity/data.ts
- link: equity: table_fundraise_rounds (fundraise-rounds), from blueprint/equity/data.ts

## organizations

Old 50 rpcs and workflows; target 24 rpcs, flows, procedures and workflows. 14 frozen operations, 22 decisions.

- 16 dangling links, all from my records to 6 tables of concepts that are not designed yet (allowed by the conventions): indexing's hat-wearers, safe-owners, safe-approvals, safe-executions and chain-budgets, and media's files. They load through organizations/links.ts, so the shared build keeps running until those concepts land. The whole book now has 57 problems, none of them from my records except these 16.
- Gap: nothing invokes procedure organizations.bind-invitation-grants yet. It is waiting for board: its `org member invite` flow is meant to invoke it in the same transaction that opens the proposal of an invitation's grants.
- Gap: WRONG_STATE has no world for invite.list and org.invite.list (given `?`). It is a defect guard that no operation can reach.
- Cross-concept expectation, accounts: personal_safe_transitioned's about says 'Organizations follows `claim` to advance the person's waiting Seats'. This design has no waiting Seats: an invitee takes the Seat when they accept, and the grants are minted before the offer opens. The accounts prose should drop that sentence. I left their file untouched.
- Cross-concept expectation, board (not designed yet): when org_invite_transitioned has transition begin_cleanup, board should open a workflow that proposes removing the granted hats. The invitation process waits until indexing shows the grantee's Safe no longer wears any of them.
- Cross-concept expectation, notices (not designed yet): send the invitation email from org_invite_transitioned on transitions send, open and resend, and keep its delivery record. Organizations reports delivery as `none` for an @handle offer and `not_confirmed` otherwise.
- link: indexing: table_hat_wearers (id hat-wearers)
- link: indexing: table_safe_owners (id safe-owners)
- link: indexing: table_safe_approvals (id safe-approvals)
- link: indexing: table_safe_executions (id safe-executions)
- link: indexing: table_chain_budgets (id chain-budgets)
- link: media: table_files (id files)
- link: board (inbound): its org.member.invite flow should call rpc_organizations_invitations_invite, then invoke procedure_organizations_bind_invitation_grants inside board.propose's transaction
- link: board (inbound): a workflow triggered by machine_org_invite.t.begin_cleanup that proposes taking the granted hats back
- link: notices (inbound): workflows triggered by machine_org_invite.t.send, .send_with_grants→open and .resend

## parties

Old 12 rpcs and workflows; target 8 rpcs, flows, procedures and workflows. 0 frozen operations, 13 decisions.

- Photo check: rpc parties.profiles.save should read media's stored-file table to confirm the photo is an admitted image. The link is left out because blueprint/media does not exist yet and importing it would crash the shared build.
- organizations.invitations.invite invokes parties.register to name an invitee by email, but parties.register only takes Organization and agent births. It should invoke parties.resolve-recipient with a mailbox locator. This is in organizations' folder, so I did not edit it.
- payments' prepare rpcs (payments/commands.ts) invoke procedures from three other concepts (parties.resolve-recipient, documents.store, approvals.open), over the sys:tx-width review limit of two. Decision parties.resolve-recipient suggests payments read the parties table instead.
- The directory table parties is tenancy global, which does not fit the conventions' wording 'global: written only by the system'. The reasoning is in decision parties.directory-tenancy, flagged for Aaron's data-model review.
- Expected gaps: procedures parties.register, parties.activate, parties.release and parties.resolve-recipient show as uninvoked until organizations, agents, contacts and payments are in the index. Flows client.me.profile.save and client.me.profile.get show as unused-flow because they serve the web app's setup page, not a frozen operation.
- link: table_files from ../media/data.ts (media's stored files): add to rpc_parties_profiles_save.reads once media lands. organizations/setups.ts already imports this name.

## payments

Old 82 rpcs and workflows; target 18 rpcs, flows, procedures and workflows. 8 frozen operations, 22 decisions.

- The shared target build fails at module load for a reason outside payments: blueprint/budgets/departments.ts imports ../indexing/data.ts, which does not exist yet. Payments builds with 0 problems except the four pending links when checked in a scratch copy of the current tree with budgets cut down to its data module.
- approvals.signing.sign answers ROLE_PERMISSION_DENIED for an unknown approval id, but payment send's frozen refusal says INVALID_INPUT for 'the execution is unknown' (P10 rung 1: the frozen surface wins). The approvals designer should change it.
- payments.commands.prepare and payments.commands.propose call procedures of three other concepts in one transaction (parties.resolve-recipient, documents.store, and approvals.open or board.propose); sys:tx-width allows two. Kept on purpose and recorded in decision payments.birth-width; needs a reviewer's sign-off.
- The Payment process's carrier wait needs the runtime (Effect Workflow, behind the A2 spike) to deliver approval_transitioned and proposal_transitioned to the waiting process by opener and subject. That delivery is not booked anywhere.
- Notices must trigger the dated-payment day-ahead warning on payment.come_due and the failed-payment notice on payment.lapse (outcome window_closed). Notices is not designed yet.
- Seven new worlds have to be built as devnet snapshots: signed-out, person-with-funded-safe, person-with-empty-safe, person-without-account, person-with-payment-history, org-with-budgets, org-with-dated-payments.
- payment send is marked critical as the payments pilot because the spine's pilots are not named anywhere (decision payments.priority); revisit when they are.
- link: board: procedure_board_propose (board.propose), loaded through payments/links.ts; used by payments.commands.propose, payments.changes.retry and payments.changes.cancel. Board is not written yet.
- link: documents: procedure_documents_store (documents.store), loaded through payments/links.ts; used by payments.commands.prepare and payments.commands.propose. Documents is not written yet.
- link: books: procedure_books_record_money_fact and procedure_books_reverse_money_fact (books/procedures.ts exists, but books is not listed in blueprint/index.ts yet); used by payments.lifecycle.payment and payments.movements.record.
- link: budgets: table_budgets (budgets/data.ts); read by the prepare, propose and change rpcs. Budgets' module list cannot load until indexing lands.
- link: board: the proposal_transitioned event (machine_proposal), which the Payment process follows in its carrier wait; described in words until board is designed.

## payroll

Old 39 rpcs and workflows; target 21 rpcs, flows, procedures and workflows. 11 frozen operations, 22 decisions.

- The real target build cannot run at the moment, and the cause is not in payroll. blueprint/budgets/departments.ts statically imports ../indexing/data.ts, which does not exist yet, so node stops with ERR_MODULE_NOT_FOUND. That is the budgets designer's file and I did not edit it. A scratch build of payroll together with its dependencies (stubs for only board.propose and documents.store) reports 0 payroll problems and 0 payroll gaps. Before budgets was added, the real build gave payroll only dangling-link problems.
- The brief asked for payroll runs (one durable workflow per run), saved groups, departments and a settle-run procedure from payments. The concept map (concepts.payroll, dependencies.payments-payroll, landings) assigns only agreements, and the brief says 'as the concept map assigns', so I designed agreements only and recorded the reasons in decision payroll.scope. If Aaron wants runs back, they need a frozen operation that names them and a changed map.
- Each payee and Organization-payee write follows a Board proposal. The process needs the executed proposal's transaction from board's proposal record. Board has not landed, so the table is described in the workflow's text and not linked.
- notices has to provide the agreement emails: one email when a resume lands, none for a withdrawal, plus offered, changed and ending. It also owns P3's daily agreement-notices cron (pay ready, a fixed term's last week, ended, low balance), which reads payroll's agreements table and its two events (decision payroll.notices-elsewhere).
- payments has two dependencies on payroll's design: (1) `capxul payment wait <approvalId>` must follow an approval payroll opened, because that is the `next` a holder write gives with --no-wait (frozen note); (2) payments must create a collection's Payment from its PaymentSent (kind 4) and let `payment get` find it by that PaymentSent id (decision payroll.collection-payment).
- The book schema cannot state two things my tables need. The payee policy on agreements.payee_safe (the payee reads its agreements, and opens its own accept and collect, under the payer's org_id) is recorded only in `scope` and decision payroll.payee-reads. The partial unique index one_awaiting_per_signer (status = awaiting) is described only in its `for` text.
- The seven worlds named in decision payroll.worlds still have to be built as devnet snapshots: org-with-department, org-with-agreements, org-with-agreements-off, org-with-closed-department, org-with-short-safe, org-with-frozen-ceiling, org-with-writes-awaiting.
- link: procedure_board_propose (../board/procedures.ts, id board.propose): reached through payroll/links.ts. Until board lands it is a bare reference that the build reports as dangling. Used by payroll.payees.accept and payroll.payees.collect.
- link: procedure_documents_store (../documents/procedures.ts, id documents.store): reached through payroll/links.ts. Until documents lands it is a bare reference that the build reports as dangling. Used by payroll.holders.offer.
- link: table_budgets (../budgets/data.ts, id budgets): the import is static and the file exists. The link resolves now that budgets is listed in blueprint/index.ts.
- link: Board's proposal table (name not yet known): payroll.agreements.lifecycle needs it for an executed proposal's transaction. It is described in text, not linked.

## requests

Old 54 rpcs and workflows; target 33 rpcs, flows, procedures and workflows. 14 frozen operations, 20 decisions.

- inbox pay --from <budget>: the designed text takes the budget by its Capxul key (`--from operations`), but the key-to-chain-id mapping is in budgets' org-budgets, and requests does not depend on budgets. Until the concept map adds budgets to requests' dependsOn (no cycle: budgets sits below requests), or payments.prepare-command resolves the key itself, `--from` takes the budget's chain id. Decision requests.inbox-pay-funding.
- inbox pay for an agent payer: A4 gives the flow every signature, but submitting an agent's immediate signature needs approvals' signature rpc, and requests does not depend on approvals. The flow only waits for the approval page. This needs a concept-map change or a payments rpc that takes the signature. Decision requests.inbox-pay-approval.
- payments.prepare-command takes no date, so dated `inbox pay --on/--at` cannot pass `pay_at` through yet. The requests.inbox.pay rpc validates the date (at least an hour ahead) and carries `pay_at`; the payments designer needs to add a `pay_at` input.
- payments.prepare-command returns no approval expiry, so `inbox pay`'s `expiresAt` is null until the approval is sponsored. The payments or approvals designer could add it to the answer.
- inbox pay --resume on a lapsed Payment (needs_retry) assumes that payments.prepare-command, called with the same request key, opens a new approval for the same Payment (the retry). The payments designer needs to confirm this replay behaviour.
- The real shared build shows 30 `dangling` problems on requests' records, and every one is a link to a sibling that is not in the book yet: payments (table payments, procedure prepare-command, transitions payment.settle, unsettle and cancel) and banking (table bank-deposits, procedure match-deposit, transition bank-deposit.credit) are designed but not yet listed in blueprint/index.ts, and documents and indexing are not written yet. The scratch build with those modules included (stubs only for documents.store, hat-wearers and chain-budgets) gives 0 problems.
- link: documents: procedure_documents_store (documents.store), from ../documents/procedures.ts, through requests/links.ts
- link: indexing: table_hat_wearers (hat-wearers), from ../indexing/data.ts, through requests/links.ts
- link: indexing: table_chain_budgets (chain-budgets), from ../indexing/data.ts, through requests/links.ts
- link: payments (designed, not yet in blueprint/index.ts): table_payments, machine_payment.t.settle, machine_payment.t.unsettle, machine_payment.t.cancel, procedure_payments_prepare_command
- link: banking (designed, not yet in blueprint/index.ts): table_bank_deposits, machine_bank_deposit.t.credit, procedure_banking_match_deposit
