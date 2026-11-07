---
name: dynamic-shop
description: Implement and maintain the Persian Sayman commerce project and its roadmap in the shop repository. Use for Next.js storefront, React/Vite admin, modular .NET API, SQL Server, and local delivery work.
---

# Dynamic Shop

## Project rules

- Follow the source PDF and [PRD](../../docs/PRD.md), subject to recorded owner decisions. Keep Next.js 16 / React 19 / TypeScript, React / Vite admin, and .NET 10 / EF Core 10 / SQL Server.
- Keep a modular monolith. Modules own their tables; use contracts and events across modules. Keep UI code with its feature and shared code in shared packages.
- Store money as integer rial (C# long / SQL bigint). Send JSON decimal strings and use TypeScript bigint. Convert to toman only for display. Preserve historical price and order snapshots.
- Use typed category attributes to drive forms, specifications, filters and comparison. Keep each variant's SKU, price and stock independent. Preserve SellerId without introducing a marketplace. Reserve stock transactionally and enforce durable checkout and callback idempotency.
- Manage content, navigation, branding, appearance and commercial settings through authorized CMS/admin workflows. Give administrators clear defaults, useful previews and actionable validation. Keep backend authorization, validation, staff MFA, audit and version checks authoritative.
- Support Persian RTL and English LTR, normalize digits, store UTC instants, and display Persian dates where appropriate. Preserve shared OKLCH tokens, legible contrast, keyboard focus and reduced motion. Never cache private or financial responses in the PWA.
- Keep public reads explicitly anonymous. Require actual contracts and sandbox evidence for provider claims. Use authorized data sources; never scrape or copy third-party reviews without permission. Keep Development samples and substitutes explicit, opt-in and unavailable in production.
- Follow the [used-device contract](../../docs/USED-DEVICES.md): one physical unit per SKU, immutable inspection snapshots, explicit unknown facts, and catalog plus inventory authorization.
- Keep SSR, canonical URLs, sitemap, structured data and indexing gates consistent with published content. Distinguish local lab measurements from field Core Web Vitals.
- Reuse existing packages first. Before adding one, check maintenance, license, bundle cost, SSR and RTL; record the rationale. Read the frontend design skill if available before designing a new page.

## Scope and authorization

- Keep one local shop: storefront 3000, API 5080, admin 3173, and SQL database Sayman. D44 supersedes historical local promotion restrictions. Do not create persistent preview services, extra app ports or QA databases.
- Within the requested slice, proceed with code changes, tests, offline builds, guarded local restarts and verified local migrations. Short-lived automated fixtures must clean up.
- Require explicit owner authorization for reading or entering credentials or MFA, unlocking accounts, deleting owner data, creating paid resources, publishing externally, or operating Chrome while the owner is active.
- Verify ownership before stopping any process. Preserve unrelated services, the current runtime, recovery artifacts, keys, media and backups. Never delete tmp wholesale, replay an applied migration, or run Down on Sayman.

## Slice workflow

1. Read [STATE](../../docs/STATE.md), then [PLAN](../../docs/PLAN.md), the relevant [PRD](../../docs/PRD.md) and [decisions](../../docs/DECISIONS-INDEX.md). Retrieve only the relevant changelog slice.
2. Take the next authorized ready item. State its goal and acceptance in one paragraph. If clarification is necessary, group up to five short questions and continue independent authorized work.
3. Implement the smallest complete vertical slice. Keep money, permissions, concurrency and failure handling explicit. Verify user-facing changes in both languages and themes at mobile and desktop sizes.
4. Run the relevant checks. Activate the accepted artifact on the same local shop when the slice requires it; verify the current descriptors and live responses.
5. Update STATE, state.json, PLAN and the slice's changelog. Record new owner decisions with date and impact. Report the evidence reached, what remains unverified, and the next action.

## References

- [Local ops](references/local-ops.md): canonical start, restart and local promotion.
- [Migrations](references/migrations.md): exact history, verified backup and recovery.
- [Testing](references/testing.md): test selection, real SQL, cleanup and build evidence.
- [Browser QA](references/browser-qa.md): ownership, visual and interaction coverage.
- [Escalation](references/escalation.md): permissions and blockers.
- [Acceptance](references/acceptance.md): delivery criteria, evidence ladder and changelog format.
- [Architecture](../../docs/ARCHITECTURE.md), [API](../../docs/API.md), [changelog](../../docs/changelog/README.md), [deployment procedure](../../docs/DEPLOYMENT.md), [deployment account state](../../docs/DEPLOYMENT-STATE.md).

## Check commands

Run from the repository root. Quote paths and arguments; the workspace name contains a space. Run only checks relevant to the slice.

```sh
npm test
npm run test:admin-contract
npm run test:admin-server
npm run typecheck
npm run typecheck:admin
npm run lint
npm run format:check
dotnet test 'backend/tests/Shop.Tests' --disable-build-servers -m:1
python3 'scripts/test-sql-local.py' --filter 'FullyQualifiedName~<TestClass>'
python3 'scripts/verify-sql-test-cleanup.py'
python3 'scripts/local/build-local-frontends.py' --only storefront
```
