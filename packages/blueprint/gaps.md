# Gaps the scenarios found in the claims

The thin line's scenarios (`packages/scenarios`, step 1.5) were written from this blueprint by an agent that never saw
the implementation. These are the claims they could not check in full, grouped by cause. Each scenario checks
everything the operations allow; what is listed here is unchecked until the blueprint or the scenarios' client
changes. Close a gap by changing the blueprint (or the client in `packages/scenarios/src/client.ts`), then have the
scenario author, never a builder, update the scenarios it names.

## 1. Nothing reads the chain

Claims say "through the door's chain RPC", but `Capxul` offers no chain read.

- Unchecked chain parts: world.create 2 and 5; org.create 1 and 3; org.member.grant 1, 5 and 7; approval.sign 1 to
  4; report.run 1; world.clock.warp 1; world.snapshot.save 1; world.snapshot.restore 1 and 2.
- Stand-ins used meanwhile: a worn hat is read as a later `AlreadyHeld` refusal; a payment is read from the General
  Ledger and Accounts Payable; report.run 1's Safe balance is compared with the 874.50 the starting world implies.
- org.member.grant 5 (`mintHat`, `changeHatMaxSupply`) is almost entirely unchecked.

## 2. The client reaches one world only

A scenario cannot call into a world it has just created or restored.

- world.create 1 reads `world.show`'s record head instead of `record.export`.
- world.create 5 cannot check that each person can call the new world's door.
- world.snapshot.restore 1 and 2 cannot call into the restored world or read its record, ledgers, balances or hats.
- record.export 1 cannot compare the new world's entries with the first world's.

## 3. One operator only

- world.snapshot.save 3: the `NotWorldOwner` part is unchecked.
- world.snapshot.restore 3: only "the restorer owns the restored world" is checked.
- The scenario cannot learn its own operator's name, so world.create 4 and 6 check that the owner is the same in
  every answer, not that it is the caller.

## 4. Starting worlds hand the scenario nothing from the steps that made them

- `payment-held` exposes neither the held approval's digest nor its expiry, so approval.sign 1 to 4 create a second
  held Payment Entry against the same invoice and sign that one. doc.create 4 creates its own Payment Entry to get a
  hash.
- doc.submit 1 cannot check Brightside's address; doc.submit 4 cannot check the company Safe's address.
- record.export 2 cannot see the starting world's trace ids. It checks every entry's shape and the steps' events in
  order, then its own calls exactly.
- world.show 3 compares with the world's `world_created` entry, because it never saw `world.create`'s answer.

## 5. Ambiguities

- **Starting worlds and templates.** Decision 27 restores every starting world from a template snapshot. That
  contradicts `fresh` having "parent null, record one entry long" (world.show 2), and the record head counting from
  one (record.export 1, world.show 1). The scenarios check the claims as written, so they fail if starting worlds are
  restored from templates.
- **The site's vocabulary is not here.** `packages/scenarios/src/support/books.ts` holds it meanwhile:
  - document field names, which are ERPNext's own;
  - the Supplier's payment address field `capxul_wallet_address` (from frappe-app);
  - the Safe account, as the account whose name starts "Capxul Safe";
  - the report names Supplier Addresses And Contacts, Scheduled Job Log and Salary Register;
  - the filters, since ERPNext's General Ledger and Trial Balance need a company and dates;
  - the field names in report rows.
- **`office-holder`'s wait step** creates a document of a type no claim names. If it is a Supplier, doc.create 1
  ("the Supplier list shows only Brightside") fails.
- **Signing:** assumed to be raw ECDSA over the digest with no message prefix, by Anvil's accounts 0 to 9. The
  subject ids (change id, payment request id) are taken from the declarations' examples, not from their text.
- **A payload the schema rejects** surfaces in a way no claim defines (org.create 6). The scenario only requires the
  call to fail without a declared refusal.
- **world.clock.warp 1** names no job. The scenario requires that some job in the Scheduled Job Log gained exactly 7
  runs.
- **world.create 2** needs the seeded chain's last block to be more than a day before the host's time.

## 6. Untestable

`SnapshotIncompatible` has no claim (decision 19).
