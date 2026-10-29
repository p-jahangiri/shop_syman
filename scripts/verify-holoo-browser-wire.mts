import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  accountingImportInputSchema,
  accountingImportSavedSchema,
} from '../apps/admin/src/accounting-import-contract.ts';
const dir = path.resolve('artifacts/checks/holoo-stage-browser-wire');
const gate = JSON.parse(await readFile(path.join(dir, 'gate.json'), 'utf8'));
assert(
  gate.qaOnly &&
    gate.attempts === 2 &&
    gate.completed === 2 &&
    gate.dropped === 2 &&
    gate.captured === 2,
);
const reports = [];
const inputs = [];
const saved = [];
for (let i = 1; i <= 2; i++) {
  const bodies = [];
  for (const kind of ['request', 'response']) {
    const file = `${i}.${kind}.json`,
      b = await readFile(path.join(dir, file));
    assert(b.length < 262144);
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b));
    const parsed =
      kind === 'request'
        ? accountingImportInputSchema.parse(raw)
        : accountingImportSavedSchema.parse(raw);
    (kind === 'request' ? inputs : saved).push(parsed);
    const sha256 = createHash('sha256').update(b).digest('hex');
    assert.equal(sha256, kind === 'request' ? gate.payloadSha256 : gate.responses[i - 1].sha256);
    bodies.push({ file, bytes: b.length, sha256 });
  }
  reports.push({ attempt: i, bodies });
}
assert.deepEqual(inputs[0], inputs[1]);
assert.equal(inputs[0].rows[0].priceRaw, '9007199254740993');
assert.equal(inputs[0].rows[0].externalItemId, '0001-A');
assert.equal(inputs[0].rows[1].externalItemId, '0001-a');
assert.equal(inputs[0].rows[1].quantityRaw, '1.5');
assert.equal(inputs[0].rows[1].priceRaw, null);
assert.equal(saved[0].id, gate.commandId);
assert.equal(saved[1].id, gate.commandId);
assert.equal(saved[0].payloadHash, saved[1].payloadHash);
assert(!saved[0].replayed && saved[1].replayed);
const effects = JSON.parse(
  await readFile('artifacts/checks/holoo-stage-browser-staged-sql.json', 'utf8'),
);
assert(
  effects.passed &&
    effects.database === gate.database &&
    effects.facts.Batches === 1 &&
    effects.facts.Rows === 2,
);
assert.equal(effects.facts.BatchData[0].Id, gate.commandId);
assert.equal(effects.facts.BatchData[0].PayloadHash, saved[0].payloadHash);
const report = {
  passed: true,
  actualBrowserCommands: true,
  strictProductionDecoders: true,
  bodyNormalization: false,
  requests: 2,
  responses: 2,
  completeResponsesDropped: 2,
  sameIdSameBody: true,
  singleBatch: 1,
  rows: 2,
  sqlEvidence: 'artifacts/checks/holoo-stage-browser-staged-sql.json',
  recoveryGetCaptured: false,
  recoveryGetVisuallyVerified: true,
  reports,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
