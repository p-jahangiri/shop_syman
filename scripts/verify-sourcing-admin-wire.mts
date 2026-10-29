import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  sourcingAdminPageSchema,
  sourcingAdminDetailSchema,
  sourcingAdminEventsSchema,
  sourcingMutationSchema,
} from '../apps/admin/src/sourcing-contract.ts';

const directory = process.argv[2];
if (!directory) throw new Error('Supply the response-only SQL capture directory.');
const read = async (name: string) =>
  JSON.parse(await readFile(path.join(directory, name + '.json'), 'utf8'));
const page = sourcingAdminPageSchema.parse(await read('admin-page'));
const detail = sourcingAdminDetailSchema.parse(await read('admin-detail'));
const events = sourcingAdminEventsSchema.parse(await read('admin-events'));
const receipt = sourcingMutationSchema.parse(await read('admin-receipt'));
assert.ok(page.items.some((item) => item.id === detail.summary.id));
assert.ok(events.items.length > 0);
assert.equal(detail.canCancel, false);
assert.equal(typeof detail.summary.ownerId, 'string');
assert.equal(receipt.replayed, true);
assert.ok(['Reviewing', 'Unavailable'].includes(receipt.state));
// The admin receipt capture belongs to the independent actor/target-binding
// SQL test, rather than the typed-snapshot test. Do not conflate their IDs.
const report = {
  passed: 4,
  actualSqlHttp: true,
  privateAdminShape: true,
  typedAttributes: detail.lines.reduce((count, line) => count + line.model.attributes.length, 0),
  scope: 'Response decoding only; browser and visual acceptance are separate.',
};
await writeFile(path.join(directory, 'admin-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
