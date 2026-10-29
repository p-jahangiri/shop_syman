---
name: dynamic-shop
description: Implement and maintain this Persian dynamic commerce project from its approved requirements, ASP.NET Core modules, Next.js storefront, and Vite admin. Use for work in the shop workspace and its implementation roadmap.
---

# Dynamic Shop

Workspace: `/Users/jahangiri/ shop`. Resolve this path from the repository if it moves.

Read `docs/PRD.md`, `docs/DECISIONS.md`, and `docs/PLAN.md` before implementation. The source PDF is authoritative unless the user changes a requirement. Record new user decisions and their implications; distinguish confirmed requirements, temporary development assumptions, and external dependencies. Keep the roadmap and handoff current so future turns resume the next unfinished task.

## Project constraints

- Keep Next.js 16 / React 19 / TypeScript storefront and a separate React / Vite admin. Backend: .NET 10, EF Core 10, SQL Server; modular monolith with each module owning its tables. Cross-module access uses contracts/events, not other modules' DbContexts.
- Persist financial amounts as integer rial (`long` / SQL `bigint`). JSON money values are decimal strings; TypeScript uses `bigint`. Format toman only at the presentation boundary. Preserve price snapshots in orders.
- Category attributes are typed relational values driving forms, filters, specifications and comparison. JSON is only for rare, non-filterable extras. Variants independently own SKU, price and stock. Retain SellerId for future use without implementing a marketplace.
- Menus, banners, public copy, branding and page blocks come from CMS data. Development seed data must be clearly labeled and isolated from production.
- Public reads are explicitly anonymous. Mutations and private data require backend policies. Development adapters must be opt-in, restricted to Development and unavailable in production.
- Inventory reservations require a database transaction and concurrency control. Checkout and verified payment callbacks require persistent idempotency and meaningful concurrency/replay tests.
- Put payment, installment, SMS, shipping and market providers behind integration contracts. Do not invent a provider API or claim an integration works without its actual documentation and sandbox verification. Unconfigured providers stay unavailable.
- Persian RTL, Persian digit normalization, accessible mobile interactions, shared OKLCH design tokens, Gregorian UTC storage and Persian calendar display are requirements. Never cache account, cart, checkout, payment or financial responses in the PWA.
- Market data requires authorized sources; do not copy third-party review text or scrape Torob.

## Execution and evidence

### One local version — owner decision D44

Maintain one running local shop: storefront `http://127.0.0.1:3000`, API `http://127.0.0.1:5080`, and admin `http://127.0.0.1:3173`, using the local `Sayman` database. Apply requested changes to these canonical services, including the necessary local schema migrations, explicit Development data and coordinated restarts. The owner says the local data is not important and explicitly rejects separate test/review versions. Do not create or deliver alternate preview hosts, persistent QA databases, staging servers or extra app ports for routine work. Retire superseded shop preview listeners after moving their accepted changes into the canonical services.

Run appropriate automated checks; short-lived isolated test fixtures are permitted for those checks and must finish and clean up. Offline build artifacts and a small recoverable backup do not constitute another running version. Do not make a staging deployment, clone rehearsal or another confirmation a prerequisite for already-authorized local changes. D44 supersedes older local promotion restrictions in historical documents. Preserve authentication, integer-rial rules and provider boundaries; this decision does not authorize unrelated data deletion, disabling protections, or external production publication.

Current user-directed order: the user explicitly approved the storefront appearance and flow. Finish the requested dynamic purchase options, configurable content, Persian/English localization and mobile OTP plus email/username-password login flows, then proceed autonomously with API, a separate Vite admin and SQL Server. Do not ask for the same UI approval again. All commercial metadata and enabled login methods must be configurable; backend authorization and validation remain authoritative. Initial categories are phones, laptops, game consoles and phone accessories; inventory is managed in this project's admin, and installment sales initially use admin-configurable cheque terms. Target Linux Docker deployment; develop locally. Shipping fees, tax rates, exact warranty/returns terms and provider names remain undecided; do not invent them or silently show free shipping/zero tax as confirmed policy.

Implement reviewable vertical slices and continue independent work while awaiting business answers. Do not call scaffolded modules complete. Record exact build/test evidence, environment limitations and remaining work in `docs/STATUS.md`. Preserve authorized scope through all phases; production service activation depends on actual credentials/contracts and deployment settings. Local development does not require publishing through Sites.

Use `docs/API.md` for the current API boundary and `docs/STATUS.md` for exact local blockers and test evidence. Keep preview credentials out of API mode; do not turn provider placeholders into successful authentication or payment. Real SQL tests live separately in `backend/tests/Shop.SqlTests` and must run on SQL Server before database/concurrency acceptance.

Use `references/acceptance.md` when planning tests and delivery. Run meaningful domain/integration checks for money, attributes, access control, concurrency and payment replay. Record unmet acceptance criteria honestly.


## Used-device reports and local build retention

For used devices, follow `docs/USED-DEVICES.md`: one physical unit per independent SKU, immutable Catalog inspection revisions and an Inventory single-unit SQL constraint. Require both catalog.write and inventory.write for inspection commands. Unknown is an explicit fact; never infer healthy condition or a battery percentage. Quotes retain the exact SKU report, and orders read their immutable historical quote JSON (the internal PascalCase, number-as-string snapshot format), never today's Catalog report. Keep existing new-product contracts backward compatible. Market agreements must not silently turn into used-device consent.

`tmp` also contains live standalone runtimes, rollback versions, restart helper dependencies, private keys and verified backups. Never delete it wholesale. User-authorized cleanup can remove inspected superseded build directories while preserving current/rollback dependencies and recording hashes and measured physical reclaimed space; APFS clone sizes differ from actual free-space gains. See `scripts/cleanup-local-artifacts.py` and the latest STATUS; historical evidence may mention deliberately removed build paths.
