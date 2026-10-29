# Private phone discovery inbox

D41 adds a notification family for phone availability and published sourcing offers. It is separate from Support and Credit inboxes and does not create support tickets. The inbox is a durable SQL history; the existing private realtime channel carries only the generic `notifications` change pulse so clients can refresh their own feed.

## Customer HTTP contract

All routes require the existing customer policy and return `Cache-Control: no-store` with the private noindex headers. The actor comes from the authenticated `sub` claim. An owner cannot be supplied in a route, body, or query. GET requests reject a supplied foreign Origin; read acknowledgements require an allowed Origin.

- `GET /api/notifications/phones?unreadOnly=true|false&cursor=...` returns `{schemaVersion:1, unreadOnly, items, nextCursor}`. The default filter includes read and unread rows. Pages contain at most 50 rows in descending sequence order. The opaque seek cursor binds the canonical account, unread filter, and phone inbox family.
- `GET /api/notifications/phones/unread-count` returns `{schemaVersion:1, unreadCount:"0"}`. The count is a decimal string.
- `PUT /api/notifications/phones/{id}/read` accepts `{}` and returns `{schemaVersion:1, notification}`. Repeated or concurrent acknowledgements preserve the first timestamp. Another account receives `not_found`.

Each item contains `id`, `sequence` (decimal string), `kind`, `listingId`, `configurationId`, `requestId`, `offerId`, `storeSlug`, `variantId`, `at`, and `readAt`. Nullable fields remain explicit JSON nulls.

| Kind | Action identifiers | Meaning |
| --- | --- | --- |
| `phone_available` | `storeSlug` and `variantId`; request/offer null | The selected phone configuration has a linked sellable Store variant. The Store and checkout remain authoritative for current availability and price. |
| `sourcing_offer_published` | `requestId` and `offerId`; Store identifiers normally null | The customer has a private sourcing offer to review. This notice is not customer consent, payment, reservation, or fulfillment. |

The public DTO contains no owner identity, source website, reference price, offer amount, contact details, or freeform private text. Unknown or duplicate query parameters and unknown acknowledgement body fields are rejected.

## Persistence and transaction boundary

`IPhoneDiscoveryNotificationWriter.RecordAsync` is a SharedKernel contract. The writer requires the caller's audited Serializable transaction. It canonicalizes the account identity, validates exact event identifiers and action shape, and writes the source event plus notification atomically when enlisted by the API coordinator or audited admin transaction. It does not open an independent transaction.

`notifications.PhoneInbox` stores the immutable event identity, account, family, listing/configuration identifiers, UTC creation time, first read time, SHA-256 payload hash, and protected payload. The protected JSON also contains the action identifiers. Data Protection purposes bind the dedicated phone family, canonical owner, and event ID. Reads verify the payload hash and its binding to the immutable SQL columns before returning a row or acknowledging it. Decryption or integrity failure closes the feed/read operation without acknowledging the damaged row.

Callers supply a deterministic lowercase N32 event ID. Replaying that ID with the same canonical account and exact event is a no-op; changing its payload fails closed. A transaction rollback leaves no inbox record, and a later retry may write the event once. EF guards allow only the initial read acknowledgement and reject deletion, ownership changes, source changes, or resetting an item to unread. SQL constraints enforce the known kinds, bounded encrypted payload, and UTC/monotone timestamps. The downgrade migration must refuse to remove a nonempty phone inbox.

The HTTP private realtime middleware dispatches queued pulses after a successful request. The background phone availability worker must explicitly drain and dispatch its scoped queue after the coordinator commits. A bounded realtime delivery failure is logged without undoing the committed SQL notice; reloading the inbox recovers it. This does not claim email, SMS, push, or guaranteed offline delivery.

## Verification scope

`backend/tests/Shop.Tests/PhoneNotificationTests.cs` covers exact event shapes, canonical account identity, unsafe action identifiers, cursor family/account binding, 64-bit sequence serialization, Data Protection separation/tampering, and public field exclusions.

`backend/tests/Shop.SqlTests/PhoneNotificationSqlTests.cs` uses a disposable GUID test database for both event families, owned HTTP reads, encryption, Serializable/replay/rollback behavior, concurrent read acknowledgement, seek pagination, corrupt-payload failure, immutable history, Origin/query/body rejection, and nonempty downgrade protection. Execution results belong in `docs/STATUS.md`; the existence of these tests alone is not acceptance evidence. No main database migration, seed, or deployment is implied by this document.

Accepted on 2026-10-28 after the final central API/unit/SQL build: 8/8 unit facts (`PhoneNotificationTests` plus `DevelopmentPhoneSeedTests`) and 10/10 real SQL facts (`PhoneNotificationSqlTests` plus `DevelopmentPhoneSeedSqlTests`), zero failures or skips, using `--no-build`. TRX files, exact discovered test names, source hashes and actual owned HTTP wire paths are recorded in `artifacts/checks/phone-inbox-seed-acceptance.json`. This verifies the private inbox and isolated import; it does not claim a live browser realtime session or full fulfillment acceptance.
