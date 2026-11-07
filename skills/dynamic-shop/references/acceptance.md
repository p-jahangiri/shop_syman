# Delivery acceptance

1. Admin creates a category with eight typed attributes; forms, filters and comparison change without deployment.
2. Multiple variants have independent prices and stock.
3. Logo, banner, menu and homepage block change through CMS without deployment.
4. Two concurrent customers cannot buy the last available SKU twice.
5. Duplicate verified callbacks cannot create duplicate orders/payments.
6. Installment provider failure leaves cash checkout usable.
7. Order, payment, shipment, return/refund and inventory movements remain traceable.
8. Mobile RTL flow passes accessibility and performance review (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1).
9. Sensitive data and operations are protected by backend policies and admin MFA.
10. Price/stock updates propagate to storefront and authorized connected channels.
11. Actual gateways pass successful, failed, canceled, timed-out and replayed sandbox flows.
12. Reproducible deployment, versioned artifacts, backup and verified restoration are delivered.

## Evidence ladder

`built → unit-tested → SQL-tested → active on main → browser-verified → owner-verified → production`

Use each label only for the environment and behavior supported by evidence. A later check does not imply an earlier check ran; mark steps not applicable or not verified explicitly. “Main” means the canonical local shop under D44. Production requires actual deployment and operational evidence. A mock, fixture, build, source push or sandbox pass cannot stand in for a live provider flow. Always state what remains open or unverified.

| Label | Evidence to record |
| --- | --- |
| built | Exact artifact and relevant build/check results. |
| unit-tested | Actual suite/filter and pass/fail/skip counts. |
| SQL-tested | Real SQL, suite/filter, assertions and fixture cleanup. |
| active on main | Local artifact and live readback on the canonical ports. |
| browser-verified | Actual observed flow, browser, viewport, language, theme and auth scope. |
| owner-verified | Explicit owner confirmation for the exact flow. |
| production | Identified deployed artifact, environment and operational verification. |

## Changelog format

Use one file per slice under [docs/changelog](../../../docs/changelog/README.md), with these fields:

1. **تغییر** — the behavior delivered.
2. **فعال‌شده روی** — artifact and environment, or no activation claim.
3. **تأیید‌شده** — exact counts, evidence labels and links; state the scope.
4. **تأیید‌نشده یا باز** — missing verification and known limitations.
5. **شواهد** — reports, dependencies and related owner decisions.

For historical entries, preserve the original detail and qualify historical claims. Missing archived files do not become new evidence.
