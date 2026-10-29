import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { readStaffCreation } from '../apps/admin/src/staff-onboarding-contract.ts';
import {
  staffFiltersSchema,
  readStaffPage,
  readStaffDetail,
  staffHistorySchema,
  staffRoleCatalogSchema,
} from '../apps/admin/src/staff-contract.ts';
import {
  customerFiltersSchema,
  readCustomerPage,
  readCustomerDetail,
  customerOrderPageSchema,
  customerTicketPageSchema,
  customerMessagesSchema,
} from '../apps/admin/src/customers-contract.ts';
import { orderDetailV2Schema } from '../apps/admin/src/orders-contract.ts';

const directory = path.resolve(process.argv[2] ?? '');
const root = process.cwd();
assert.equal(path.basename(directory), 'admin-business85-sql-wire');
assert.ok(directory.startsWith(path.join(root, 'tmp') + path.sep));
const kindSchema = z.enum([
  'staff-created',
  'staff-page',
  'staff-detail',
  'staff-history',
  'staff-roles',
  'customer-profile',
  'customer-page',
  'customer-orders',
  'customer-order-detail',
  'customer-tickets',
  'customer-messages',
]);
const metadataSchema = z
  .object({ kind: kindSchema, binding: z.record(z.string(), z.unknown()) })
  .strict();
const idBinding = z.object({ id: z.string() }).strict();
const entries: { file: string; kind: string; sha256: string }[] = [];
for (const name of (await fs.readdir(directory))
  .filter((value) => value.endsWith('.meta.json'))
  .sort()) {
  assert.match(name, /^[a-z0-9-]+\.meta\.json$/);
  const metadata = metadataSchema.parse(
    JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')),
  );
  const file = name.replace('.meta.json', '.json');
  const bytes = await fs.readFile(path.join(directory, file));
  const raw: unknown = JSON.parse(bytes.toString('utf8'));
  switch (metadata.kind) {
    case 'staff-created':
      readStaffCreation(
        raw,
        z.object({ requestId: z.uuid() }).strict().parse(metadata.binding).requestId,
      );
      break;
    case 'staff-page':
      readStaffPage(raw, staffFiltersSchema.parse(metadata.binding));
      break;
    case 'staff-detail':
      readStaffDetail(raw, idBinding.parse(metadata.binding).id);
      break;
    case 'staff-history':
      staffHistorySchema.parse(raw);
      idBinding.parse(metadata.binding);
      break;
    case 'staff-roles':
      staffRoleCatalogSchema.parse(raw);
      break;
    case 'customer-profile':
      readCustomerDetail(raw, idBinding.parse(metadata.binding).id);
      break;
    case 'customer-page':
      readCustomerPage(raw, customerFiltersSchema.parse(metadata.binding));
      break;
    case 'customer-orders':
      assert.equal(
        customerOrderPageSchema.parse(raw).customerId,
        idBinding.parse(metadata.binding).id,
      );
      break;
    case 'customer-tickets':
      assert.equal(
        customerTicketPageSchema.parse(raw).customerId,
        idBinding.parse(metadata.binding).id,
      );
      break;
    case 'customer-messages': {
      const binding = z
        .object({ id: z.string(), ticketId: z.string() })
        .strict()
        .parse(metadata.binding);
      const parsed = customerMessagesSchema.parse(raw);
      assert.equal(parsed.customerId, binding.id);
      assert.equal(parsed.ticketId, binding.ticketId);
      break;
    }
    case 'customer-order-detail': {
      const binding = z
        .object({ id: z.string(), orderId: z.string() })
        .strict()
        .parse(metadata.binding);
      assert.equal(orderDetailV2Schema.parse(raw).summary.id, binding.orderId);
      break;
    }
  }
  entries.push({
    file,
    kind: metadata.kind,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
assert.equal(entries.length, 16);
const report = {
  actualSqlHttpResponses: true,
  syntheticTestOnly: true,
  passed: entries.length,
  failures: 0,
  entries,
};
const output = path.join(directory, 'client-decoder-report.json');
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(
  JSON.stringify({ passed: entries.length, report: path.relative(root, output) }) + '\n',
);
