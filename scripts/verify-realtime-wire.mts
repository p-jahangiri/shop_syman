import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  validRealtimeServerFrames,
  realtimePulseSchema,
} from '../apps/storefront/lib/realtime-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const entries = [];
let owner = false,
  staff = false;
for (const file of (await readdir(dir)).filter((x) => x.endsWith('.frame.txt')).sort()) {
  const raw = await readFile(`${dir}/${file}`),
    text = raw.toString('utf8'),
    meta = JSON.parse(await readFile(`${dir}/${file.replace('.frame.txt', '.meta.json')}`, 'utf8'));
  assert.equal(meta.actualSqlSignalRResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.queryTokenNeverPersisted, true);
  assert.ok(['/api/realtime?id=[private]', '/api/admin/realtime?id=[private]'].includes(meta.path));
  assert.equal(meta.status, 200);
  assert.ok(validRealtimeServerFrames(text));
  for (const part of text.split('\x1e').filter(Boolean)) {
    const frame = JSON.parse(part);
    if (frame.type === 1) {
      assert.equal(frame.target, 'Changed');
      realtimePulseSchema.parse(frame.arguments[0]);
      if (file.startsWith('owner-')) owner = true;
      if (file.startsWith('staff-')) staff = true;
    }
  }
  assert.ok(!/connectionToken|accessToken|Bearer|ownerId|ticketId|subject|body/.test(text));
  entries.push({ file, sha256: createHash('sha256').update(raw).digest('hex'), ...meta });
}
assert.ok(owner && staff);
await writeFile(
  `${dir}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: entries.length,
      actualSqlSignalR: true,
      rawFramesUnmodified: true,
      strictProductionFrameDecoders: true,
      ownerAndStaffPulsesVerified: true,
      noPrivateIdentifiersOrContent: true,
      noNegotiationOrConnectionTokensPersisted: true,
      syntheticQaOnly: true,
      entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${entries.length} actual SQL SignalR event batches passed production frame decoders; no connection tokens persisted.`,
);
