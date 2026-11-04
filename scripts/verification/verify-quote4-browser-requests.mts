import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { quoteInputSchema } from '@sayman/web-shared/lib/checkout/quote-contract.ts';
if (process.argv.length !== 3)
  throw Error('Pass the actual final browser gateway request-capture directory.');
const directory = path.resolve(process.argv[2]),
  names = (await readdir(directory)).filter((name) => name.endsWith('.request.json')).sort();
assert.equal(
  names.length,
  7,
  'The final two retried commands and exact-UUID authentication fault must supply seven native request bodies.',
);
const records = await Promise.all(
  names.map(async (name) => {
    const bytes = await readFile(path.join(directory, name));
    assert.ok(bytes.length > 0 && bytes.length <= 16384);
    const raw = new TextDecoder('utf8', { fatal: true }).decode(bytes);
    const input = quoteInputSchema.parse(JSON.parse(raw));
    assert.equal(
      JSON.stringify(input),
      raw,
      'Do not normalize native request bodies before decoding.',
    );
    assert.equal(input.methodId, 'online');
    assert.equal(input.planId, null);
    assert.ok(input.requestId);
    return {
      name,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      commandId: input.requestId.replaceAll('-', '').toLowerCase(),
      authFault: name.includes('-quote-auth401-'),
    };
  }),
);
const commands = [...new Set(records.map((record) => record.commandId))];
assert.equal(commands.length, 2);
const groups = commands.map((commandId) => {
  const bodies = records.filter((record) => record.commandId === commandId);
  assert.equal(new Set(bodies.map((record) => record.sha256)).size, 1);
  assert.equal(bodies.filter((record) => !record.authFault).length, 3);
  assert.ok([0, 1].includes(bodies.filter((record) => record.authFault).length));
  return {
    commandId,
    sha256: bodies[0].sha256,
    fullyCompletedRequestBodies: 3,
    authFaultRequestBodies: bodies.filter((record) => record.authFault).length,
  };
});
assert.equal(records.filter((record) => record.authFault).length, 1);
const report = {
  accepted: true,
  actualNativeBrowserRequestBodies: true,
  strictProductionQuoteInputDecoder: true,
  normalizationBeforeDecode: false,
  rawBodyCount: 7,
  distinctCommands: 2,
  eachCommandHasOneFrozenBody: true,
  onlyCalculationFieldsAccepted: true,
  groups,
  bodies: records,
  browserRenderingAcceptedByThisScript: false,
  mainPromoted: false,
  scope:
    'Native four-field quote request bytes only. Root owns browser rendering and auth visibility; the separate SQL report proves persisted effects.',
};
await writeFile(
  path.join(directory, 'request-decoder-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(report) + '\n');
