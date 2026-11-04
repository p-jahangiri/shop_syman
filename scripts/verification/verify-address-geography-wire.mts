import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {
  addressBook,
  saveAddressResult,
} from '../../apps/storefront/lib/address/address-contract.ts';
const directory = process.argv[2];
if (!directory) throw Error('Pass the explicit synthetic SQL HTTP capture directory.');
const read = async (name: string) =>
  JSON.parse(await readFile(`${directory}/${name}.json`, 'utf8'));
const withMap = addressBook.parse(await read('address-book-map'));
assert.equal(withMap.items[0].details?.latitude, 35.6892);
const withoutMap = saveAddressResult.parse(await read('address-save-no-map'));
assert.equal(withoutMap.address.details?.latitude, null);
assert.equal(withoutMap.address.details?.longitude, null);
const manual = saveAddressResult.parse(await read('address-save-manual'));
assert.equal(manual.address.details?.localityKind, 'other');
assert.equal(manual.address.details?.cityId, null);
const legacy = addressBook.parse(await read('address-book-legacy'));
assert.equal(legacy.items[0].details, undefined);
await writeFile(
  `${directory}/report.json`,
  JSON.stringify(
    {
      passed: 4,
      scope:
        'Real ASP.NET HTTP responses backed by disposable SQL, decoded by production storefront contracts: map, no-map, manual locality, legacy ciphertext.',
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('4 address geography SQL HTTP wire contracts passed.\n');
