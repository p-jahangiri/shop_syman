import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readChequeReport,
  chequeReportFilterSchema,
} from '../apps/storefront/lib/cheque-report-contract.ts';
const dir = process.argv[2];
assert.ok(dir && path.isAbsolute(dir));
const files = (await readdir(dir)).filter(
  (f) => /^[a-f0-9]{32}\.json$/.test(f) || /^[0-9]+\.response\.json$/.test(f),
);
const records = [];
const parsed = [];
for (const file of files) {
  const raw = await readFile(path.join(dir, file)),
    metaFile = file.endsWith('.response.json')
      ? file.replace('.response.json', '.meta.json')
      : file.replace('.json', '.meta.json'),
    meta = JSON.parse(await readFile(path.join(dir, metaFile), 'utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.method, 'GET');
  if (meta.status !== undefined) assert.equal(meta.status, 200);
  const u = new URL(meta.path, 'http://qa.invalid');
  assert.equal(u.pathname, '/api/admin/credit/cheque-report');
  assert.equal(u.searchParams.size, new Set([...u.searchParams.keys()]).size);
  assert.ok(
    [...u.searchParams.keys()].every((k) => ['from', 'through', 'state', 'cursor'].includes(k)),
  );
  const filter = chequeReportFilterSchema.parse({
    from: u.searchParams.get('from'),
    through: u.searchParams.get('through'),
    state: u.searchParams.get('state'),
  });
  const page = readChequeReport(JSON.parse(raw.toString()), filter);
  assert.ok(
    !/instrumentReference|receiptNote|SYNTHETIC-PRIVATE|contactPhone|protectedRegistration|actorId/.test(
      raw.toString(),
    ),
  );
  parsed.push({ page, cursor: u.searchParams.get('cursor') });
  records.push({
    file,
    sha256: createHash('sha256').update(raw).digest('hex'),
    rows: page.items.length,
    state: page.filter.state,
    continuation: !!u.searchParams.get('cursor'),
  });
}
assert.ok(records.length > 0);
let continuations = 0;
for (const { page, cursor } of parsed) {
  if (!cursor) continue;
  const preceding = parsed.find((p) => p.page.nextCursor === cursor);
  if (!preceding) continue;
  continuations++;
  assert.equal(page.registrationCutoff, preceding.page.registrationCutoff);
  assert.equal(page.today, preceding.page.today);
  assert.equal(page.cursorExpiresAt, preceding.page.cursorExpiresAt);
  const last = preceding.page.items.at(-1)!.cheque;
  for (const row of page.items)
    assert.ok(
      row.cheque.dueDate > last.dueDate ||
        (row.cheque.dueDate === last.dueDate && row.cheque.id > last.id),
    );
}
const result = {
  passed: true,
  actualSqlHttpOnly: true,
  syntheticQaOnly: true,
  responses: records.length,
  rowsDecoded: records.reduce((n, r) => n + r.rows, 0),
  continuationsBoundToPrecedingPage: continuations,
  records,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, records: undefined }));
