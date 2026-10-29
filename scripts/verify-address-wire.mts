import { readFile, writeFile } from 'node:fs/promises';
import { addressBook, saveAddressResult } from '../apps/storefront/lib/address-contract.ts';
import assert from 'node:assert/strict';
const directory = process.argv[2];
if (!directory) throw Error('Pass the explicit synthetic HTTP capture directory.');
const book = addressBook.parse(
  JSON.parse(await readFile(directory + '/address-book.json', 'utf8')),
);
const saved = saveAddressResult.parse(
  JSON.parse(await readFile(directory + '/address-save.json', 'utf8')),
);
assert.equal(book.items[0].id, saved.address.id);
assert.equal(saved.address.contactPhone, '09121234567');
await writeFile(
  directory + '/report.json',
  JSON.stringify(
    {
      passed: 2,
      scope:
        'ASP.NET test HTTP synthetic service responses parsed by production TS contracts; no SQL or authentication acceptance',
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('2 address wire contracts passed.\n');
