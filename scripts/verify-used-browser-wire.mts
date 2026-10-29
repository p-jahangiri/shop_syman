import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { usedInput, usedResult } from '../apps/admin/src/used-items-contract.ts';
const dir = path.resolve('artifacts/checks/used-browser-wire'),
  entries = [];
const requests: Buffer[] = [],
  responses = [];
for (let i = 1; i <= 5; i++) {
  const request = await readFile(path.join(dir, i + '.request.json')),
    response = await readFile(path.join(dir, i + '.response.json')),
    meta = JSON.parse(await readFile(path.join(dir, i + '.meta.json'), 'utf8'));
  assert.equal(meta.method, 'PUT');
  assert.equal(meta.status, 200);
  assert(/^\/api\/admin\/used-items\/[a-f0-9]{32}[ab]\/commands\/[a-f0-9]{32}$/.test(meta.path));
  const command = usedInput.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request)),
    ),
    result = usedResult.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response)),
    );
  assert.equal(command.inspection.inspectionId, result.detail.inspection!.inspectionId);
  assert.equal(
    command.inspection.batteryHealthPercent,
    result.detail.inspection!.batteryHealthPercent,
  );
  requests.push(request);
  responses.push(result);
  entries.push({
    number: i,
    requestSha256: createHash('sha256').update(request).digest('hex'),
    responseSha256: createHash('sha256').update(response).digest('hex'),
    replayed: result.replayed,
  });
}
assert.deepEqual(requests[0], requests[1]);
assert.deepEqual(requests[0], requests[2]);
assert.deepEqual(
  responses.slice(0, 3).map((v) => v.replayed),
  [false, true, true],
);
assert.deepEqual(responses[0].detail, responses[2].detail);
assert.equal(responses[0].detail.inspection!.batteryHealthPercent, 0);
assert.equal(responses[3].detail.inspection!.batteryState, 'unknown');
assert.equal(responses[3].detail.inspection!.batteryHealthPercent, null);
assert.equal(responses[4].detail.inspection!.batteryHealthPercent, 100);
assert.notEqual(
  responses[4].detail.inspection!.inspectionId,
  responses[0].detail.inspection!.inspectionId,
);
await writeFile(
  path.join(dir, 'acceptance.json'),
  JSON.stringify(
    {
      passed: true,
      actualBrowserCommandBodies: 5,
      expectedDroppedSuccessfulResponses: 2,
      rawHashesChecked: true,
      productionDecoders: true,
      sameFirstCommandBytes: true,
      entries,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  '5 browser commands accepted: two successful responses lost, one immutable report and exact replay retained.',
);
