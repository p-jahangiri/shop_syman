import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {
  emptySerialFilters,
  readSerialPage,
  readSerialHistory,
  receiptAttempt,
  readSerialCommand,
} from '../apps/admin/src/serial-contract.ts';
const directory = process.argv[2];
if (!directory) throw Error('Pass synthetic native capture directory.');
const read = async (name: string) =>
  JSON.parse(await readFile(directory + '/' + name + '.json', 'utf8'));
const page = readSerialPage(await read('serial-page'), 'wire-variant', emptySerialFilters);
assert.equal(page.items[0].warrantyUntil, null);
assert.equal(page.nextCursor, null);
const history = readSerialHistory(
  await read('serial-history'),
  '11111111111141118111111111111111',
  null,
);
assert.equal(history.items[0].id, '9007199254740993');
const attempt = receiptAttempt(
  { variantId: 'wire-variant', mode: 'imei', onHand: 0, reserved: 0, version: 'AAAAAAAAAAA=' },
  '490154203237518',
  'wire reason',
  '11111111-1111-4111-8111-111111111111',
);
assert.equal(readSerialCommand(await read('serial-command'), attempt).stock.onHand, 1);
await writeFile(
  directory + '/report.json',
  JSON.stringify(
    {
      passed: 3,
      nativeHttpReadBodies: 2,
      configuredNativeSerializerCommand: 1,
      scope: 'synthetic readers and command DTO; no SQL, actual command or MFA acceptance',
      nullableFieldsPreserved: true,
      historyLongStringsPreserved: true,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write(
  '3 serial wire contracts passed (2 native HTTP reads; 1 configured serializer DTO).\n',
);
