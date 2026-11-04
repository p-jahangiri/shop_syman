import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { quoteSnapshotV5Schema } from '@sayman/web-shared/lib/checkout/quote-v5-contract.ts';
import {
  createOrderResultV2Schema,
  orderDetailV2Schema,
  orderPageV2Schema,
} from '@sayman/web-shared/lib/orders/order-v2-contract.ts';
import { sourcingOrderLinksSchema } from '../../apps/storefront/lib/market/sourcing-order-links.ts';

if (process.argv.length > 3)
  throw Error('Pass only the actual SQL HTTP capture directory, or set SHOP_ORDER2_WIRE_DIR.');
const supplied = process.argv[2] ?? process.env.SHOP_ORDER2_WIRE_DIR;
if (!supplied)
  throw Error('Set SHOP_ORDER2_WIRE_DIR to the actual OrderV2HttpSqlTests response directory.');
const directory = path.resolve(supplied);
const kind = z.enum([
  'quote5',
  'order2-create',
  'order2-detail',
  'order2-page',
  'sourcing-order-links',
]);
const filename = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,160}\.json$/)
  .refine(
    (v) =>
      !v.includes('..') && v !== 'order2-wire-manifest.json' && v !== 'order2-wire-report.json',
  );
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.string().min(1).max(200),
    actualSqlHttpResponseBodies: z.literal(true),
    entries: z
      .array(
        z
          .object({
            kind,
            file: filename,
            sha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(512),
  })
  .strict()
  .refine((v) => new Set(v.entries.map((e) => e.file)).size === v.entries.length);
const rawManifest = await readFile(path.join(directory, 'order2-wire-manifest.json'));
assert.ok(
  rawManifest.byteLength > 0 && rawManifest.byteLength <= 131072,
  'The capture manifest exceeds its supported byte bound.',
);
const manifest = manifestSchema.parse(
  JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(rawManifest)),
);
const counts: Record<z.infer<typeof kind>, number> = {
  quote5: 0,
  'order2-create': 0,
  'order2-detail': 0,
  'order2-page': 0,
  'sourcing-order-links': 0,
};
const results = [];
for (const entry of manifest.entries) {
  const bytes = await readFile(path.join(directory, entry.file));
  const limit =
    entry.kind === 'quote5' ? 524288 : entry.kind === 'sourcing-order-links' ? 65536 : 1048576;
  assert.ok(
    bytes.byteLength > 0 && bytes.byteLength <= limit,
    `${entry.file}: original HTTP body exceeds its supported UTF-8 byte bound.`,
  );
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (entry.sha256 !== undefined)
    assert.equal(
      sha256,
      entry.sha256,
      `${entry.file}: captured HTTP body differs from the manifest hash.`,
    );
  const raw = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)) as unknown;
  // The exact original body goes directly to the production decoder. No
  // null/date/amount/id/field normalization or fixture substitution is allowed.
  let summary: Record<string, string | number | boolean>;
  if (entry.kind === 'quote5') {
    const value = quoteSnapshotV5Schema.parse(raw);
    summary = {
      schemaVersion: value.schemaVersion,
      locale: value.locale,
      saved: value.quoteId !== null,
      lineCount: value.lines.length,
      ordinaryLines: value.lines.filter((l) => l.lineKind === 'ordinary').length,
      acceptedLines: value.lines.filter((l) => l.lineKind === 'acceptedOffer').length,
      canCreateTemporaryOrder: value.temporaryOrder.canCreate,
      canPlaceOrder: value.canPlaceOrder,
      canPay: value.canPay,
    };
  } else if (entry.kind === 'order2-create' || entry.kind === 'order2-detail') {
    const value =
      entry.kind === 'order2-create'
        ? createOrderResultV2Schema.parse(raw).order
        : orderDetailV2Schema.parse(raw);
    summary = {
      schemaVersion: value.schemaVersion,
      originalSnapshotVersion: value.originalSnapshotVersion,
      locale: value.summary.locale,
      state: value.summary.state,
      lineCount: value.lines.length,
      ordinaryLines: value.lines.filter((l) => l.lineKind === 'ordinary').length,
      acceptedLines: value.lines.filter((l) => l.lineKind === 'acceptedOffer').length,
      canCancel: value.canCancel,
      canPay: value.canPay,
    };
  } else if (entry.kind === 'order2-page') {
    const value = orderPageV2Schema.parse(raw);
    summary = {
      schemaVersion: value.schemaVersion,
      itemCount: value.items.length,
      legacyOrders: value.items.filter((i) => i.originalSnapshotVersion === 1).length,
      newOrders: value.items.filter((i) => i.originalSnapshotVersion === 2).length,
      hasNextPage: value.nextCursor !== null,
    };
  } else {
    const value = sourcingOrderLinksSchema.parse(raw);
    summary = {
      schemaVersion: value.schemaVersion,
      itemCount: value.items.length,
      hasNextPage: value.nextCursor !== null,
    };
  }
  counts[entry.kind]++;
  results.push({
    kind: entry.kind,
    file: entry.file,
    bytes: bytes.byteLength,
    sha256,
    manifestHashPresent: entry.sha256 !== undefined,
    ...summary,
  });
}
const report = {
  status: 'accepted-captured-sql-http-wire-only',
  source: manifest.source,
  passed: results.length,
  kindCounts: counts,
  strictProductionDecoders: true,
  originalBodyHashes: true,
  noBodyNormalization: true,
  manifestDeclaredActualSqlHttpResponseBodies: true,
  requestBodiesCaptured: false,
  browserAccepted: false,
  stockEffectsVerified: false,
  mainPromoted: false,
  bodies: results,
  scope:
    'Parses the original synthetic-account SQL HTTP response captures declared by the test manifest. The verifier does not execute SQL, prove stock effects or concurrency, capture request bodies, render a browser, promote a runtime or print contact details, addresses, accepted terms, identifiers or amounts.',
};
await writeFile(
  path.join(directory, 'order2-wire-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(report) + '\n');
