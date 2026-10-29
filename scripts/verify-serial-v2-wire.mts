import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { emptySerialFilters } from '../apps/admin/src/serial-contract.ts';
import { readSerialPageV2 } from '../apps/admin/src/serial-contract-v2.ts';

const directory = process.argv[2];
if (!directory) throw Error('Pass the real SQL SerialV2 HTTP capture directory.');
const read = async (name: string) =>
  JSON.parse(await readFile(directory + '/' + name + '.json', 'utf8'));
const rawAll = await read('serial-v2-all'),
  variant = rawAll.stock?.variantId;
assert.equal(typeof variant, 'string');
const all = readSerialPageV2(rawAll, variant, emptySerialFilters);
const available = readSerialPageV2(await read('serial-v2-available'), variant, {
  state: 'available',
  query: '',
});
const released = readSerialPageV2(await read('serial-v2-claim-free'), variant, emptySerialFilters);
assert.equal(all.stock.sourcingReserved > 0, true);
assert.equal(
  all.items.some((item) => item.hasActiveClaim),
  true,
);
assert.equal(
  available.items.every((item) => !item.hasActiveClaim && item.unit.state === 'available'),
  true,
);
const claimed = new Set(
  all.items.filter((item) => item.hasActiveClaim).map((item) => item.unit.id),
);
assert.equal(
  available.items.some((item) => claimed.has(item.unit.id)),
  false,
);
assert.equal(released.stock.sourcingReserved, 0);
assert.equal(
  released.items.some((item) => item.hasActiveClaim),
  false,
);
assert.equal(released.stock.onHand, all.stock.onHand);
assert.equal(released.stock.reserved, all.stock.reserved);
assert.equal(released.stock.available, all.stock.available + all.stock.sourcingReserved);
await writeFile(
  directory + '/serial-v2-report.json',
  JSON.stringify(
    {
      passed: 3,
      nativeHttpBodies: 3,
      scope:
        'Actual SQL authenticated SerialV2 HTTP reads supplied by the SQL runner; no browser or production claim',
      strictVersion2: true,
      activeClaimsExplicit: true,
      availableFilterExcludesClaims: true,
      independentHoldCounters: true,
      legacyV1Wire:
        'Not inspected by this three-body V2 verifier; covered separately by SQL regression',
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('3 SerialV2 HTTP wire contracts passed.\n');
