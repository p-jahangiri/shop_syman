# Reviewed Development phone extension

This offline command adds the pinned v2 Samsung dataset to the **single local main** database. It does not start a web host, create a database, migrate schema, create accounts, create sellable variants, set prices or adjust stock.

Run from the repository:

```sh
python3 scripts/import-phone-data-extension.py --apply-main-development
```

The wrapper reads the current accepted schema83 API descriptor, checks all14 assembly hashes, compiles this command against those frozen assemblies and uses their existing dependency/runtime files. It deliberately has no ProjectReference to the unfinished backend checkout. The C# command independently requires Development, local11433/Sayman and an explicit apply flag. Dataset identity, SHA256, official image host, immutable configuration identifiers and unknown price/supply are validated before changes.

The adapted seed retains the existing serializable transaction, shared module transaction, application lock, domain validation, CAS/receipts and additive-only semantics of the accepted v1 seed. Existing models are preserved, conflicting slugs/metadata fail, and repeat import is checked. Exact in-memory hashes of123 protected account/payment/order/credit/inventory tables were equal before/after the first accepted run; raw contents are never emitted.

The source snapshot hashes, official SKU mappings, regional colour restrictions and specifications are documented in `docs/SAMSUNG-IRAN-MARKET-DATA.md` and the private v2 provenance JSON. Development data represents real hardware, without claiming a live market feed, Iranian stock, registration or guaranteed supply. Public customer DTOs do not contain source URLs or reference prices.

This command is intentionally pinned to schema83. Review it explicitly before changing its accepted runtime, dataset or target. Preserve the current API service; do not run the unfinished backend with migrations to import these rows.
