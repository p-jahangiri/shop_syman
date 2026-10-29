import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  allocationCandidateSchema,
  allocationCurrentMatches,
  allocationDataSchema,
  allocationEventsSchema,
  allocationMutationSchema,
} from '../src/allocation-contract.ts';
import { createCommandAdapter } from '../src/sourcing-command-protocol.ts';
import { manualAllocationReceiptRecovery } from '../src/sourcing-receipt-recovery.ts';

// Historical HTTP response acceptance only: never send a mutation, invent its
// original body, rewrite a capture, or substitute a later snapshot for an old one.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const checks = path.join(root, 'artifacts/checks');
const expected = path.join(checks, 'allocation-wire');
const directory = path.resolve(process.argv[2] ?? expected);
assert.equal(
  directory,
  expected,
  'Use only this project’s existing allocation-wire capture directory.',
);
assert.equal(
  await fs.realpath(directory),
  expected,
  'Capture directory must not resolve through another location.',
);
assert.ok(
  !(await fs.lstat(directory)).isSymbolicLink(),
  'Capture directory must not be a symlink.',
);
const fingerprints: { file: string; bytes: number; sha256: string }[] = [];
async function read(file: string) {
  const location = path.join(directory, file),
    info = await fs.lstat(location);
  assert.ok(info.isFile() && !info.isSymbolicLink(), file + ' must be an actual capture file.');
  assert.ok(info.size > 0 && info.size <= 524288, file + ' must fit the response byte bound.');
  const bytes = await fs.readFile(location);
  assert.equal(bytes.length, info.size);
  fingerprints.push({
    file,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

const candidate = allocationCandidateSchema.parse(await read('allocation-candidate.json'));
const detail = allocationDataSchema.parse(await read('allocation-detail.json'));
const events = allocationEventsSchema.parse(await read('allocation-events.json'));
const allocate = allocationMutationSchema.parse(await read('allocate.json'));
const replay = allocationMutationSchema.parse(await read('allocate-replay.json'));
const command = allocationMutationSchema.parse(await read('allocation-command.json'));
const release = allocationMutationSchema.parse(await read('release.json'));
const releaseCommand = allocationMutationSchema.parse(await read('release-command.json'));

assert.equal(candidate.canAttemptAllocation, true);
assert.equal(candidate.allocation, null);
assert.equal(candidate.canCheckout, false);
assert.equal(candidate.canPay, false);
// These captures deliberately straddle the successful mutation. Identity and
// accepted quantities match, but the pre-allocation candidate is not fresh
// authority for the later Active detail and must fail the UI freshness guard.
assert.equal(allocationCurrentMatches(detail, candidate), false);
for (const field of ['requestId', 'taskId', 'offerId', 'acceptanceId'] as const)
  assert.equal(detail[field], candidate[field], field);
assert.equal(detail.lines.length, candidate.lines.length);
for (const held of detail.lines) {
  const accepted = candidate.lines.find((row) => row.offerLineId === held.offerLineId);
  assert.ok(accepted);
  assert.equal(held.variantId.toUpperCase(), accepted.variantId.toUpperCase());
  assert.equal(held.quantity, accepted.quantity);
}
assert.equal(detail.id, allocate.allocationId);
assert.equal(detail.version, allocate.version);
assert.equal(detail.state, 'Active');
assert.equal(detail.effectiveState, 'Active');
assert.equal(allocate.operation, 'allocate');
assert.equal(allocate.replayed, false);
assert.equal(detail.expiresAt, allocate.expiresAt);
assert.equal(detail.createdAt, allocate.at);
assert.ok(Date.parse(detail.expiresAt) <= Date.parse(candidate.purchaseUntil));
assert.equal(detail.isDemo, candidate.isDemo);
for (const field of ['requestId', 'taskId', 'offerId', 'acceptanceId'] as const)
  assert.equal(allocate[field], candidate[field], field);
assert.deepEqual(replay, { ...allocate, replayed: true });
assert.deepEqual(command, replay);
assert.equal(events.items.length, 1);
assert.equal(events.items[0].state, allocate.state);
assert.equal(events.items[0].at, allocate.at);
assert.equal(events.nextCursor, null);
assert.equal(release.operation, 'release');
assert.equal(release.state, 'Released');
assert.equal(release.replayed, false);
assert.deepEqual(releaseCommand, { ...release, replayed: true });

const inventory = { sales: false, financial: false, inventory: true };
const noNetwork = async () => {
  throw new Error('This verifier never reads live application state.');
};
function recovery(value: typeof allocate) {
  return manualAllocationReceiptRecovery(
    {
      operation: value.operation,
      requestId: value.requestId,
      taskId: value.taskId,
      resourceId: value.allocationId,
      commandId: value.commandId,
    },
    true,
  );
}
const allocationRecovery = recovery(allocate),
  releaseRecovery = recovery(release);
const allocationAdapter = createCommandAdapter(allocationRecovery, inventory, noNetwork);
const releaseAdapter = createCommandAdapter(releaseRecovery, inventory, noNetwork);
assert.equal(allocationRecovery.kind, 'recovered');
assert.equal(allocationRecovery.phase, 'refresh');
assert.equal(allocationAdapter.permitted, true);
assert.equal(releaseAdapter.permitted, true);
assert.equal(
  allocationAdapter.receiptPath,
  `/admin/inventory/sourcing-allocations/${allocate.allocationId}/commands/allocate/${allocate.commandId}`,
);
assert.equal(
  releaseAdapter.receiptPath,
  `/admin/inventory/sourcing-allocations/${release.allocationId}/commands/release/${release.commandId}`,
);
allocationAdapter.validate(allocate, false);
allocationAdapter.validate(replay, false);
allocationAdapter.validate(command, true);
releaseAdapter.validate(release, false);
releaseAdapter.validate(releaseCommand, true);
assert.throws(
  () => allocationAdapter.validate(allocate, true),
  'A mutation response cannot masquerade as a replayed receipt.',
);
assert.throws(() => releaseAdapter.validate(release, true));
assert.throws(
  () => allocationAdapter.validate(releaseCommand, true),
  'A receipt for the other actual captured target must be rejected.',
);
assert.throws(() => releaseAdapter.validate(command, true));
assert.equal(
  createCommandAdapter(
    allocationRecovery,
    { sales: true, financial: true, inventory: false },
    noNetwork,
  ).permitted,
  false,
);

function privateKeys(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(
      ![
        'ownerid',
        'actorid',
        'serial',
        'imei1',
        'imei2',
        'unitpricerial',
        'totalrial',
        'costrial',
        'sourcekind',
        'sourcekey',
        'sourcenamefa',
        'sourcenameen',
        'supplierreference',
        'internalnote',
        'protectednote',
      ].includes(key.toLowerCase()),
      key,
    );
    privateKeys(item);
  }
}
for (const value of [candidate, detail, events, allocate, replay, command, release, releaseCommand])
  privateKeys(value);

const generatedAt = new Date().toISOString();
const report = {
  passed: true,
  generatedAt,
  responseCount: fingerprints.length,
  captureDirectory: path.relative(root, directory),
  files: fingerprints,
  decoderSources: await Promise.all(
    ['allocation-contract.ts', 'sourcing-command-protocol.ts', 'sourcing-receipt-recovery.ts'].map(
      async (file) => ({
        file: 'apps/admin/src/' + file,
        sha256: createHash('sha256')
          .update(await fs.readFile(path.join(root, 'apps/admin/src', file)))
          .digest('hex'),
      }),
    ),
  ),
  checks: [
    'Eight unchanged actual SQL HTTP bodies pass the strict allocation decoders used by the admin UI',
    'Candidate, immutable allocation detail, exact line quantities, event and allocate receipt share the same captured target',
    'The real pre-allocation candidate and later Active detail correctly fail the UI freshness guard without a fabricated summary',
    'Allocate replay and command receipt retain the exact historical version, timestamp, deadline and command UUID',
    'The separate release scenario and its command receipt agree without being relabeled as the allocation scenario',
    'Real UI recovery adapters accept the corresponding command responses and reject non-replay receipts or the other captured target',
    'Read-only recovery remains inventory-permission gated and the DTOs exclude customer identity, physical serials, source details and money',
  ],
  limitations: [
    'Original allocate/release request bodies were not captured; this verifies actual UI receipt recovery, not an invented original mutation body',
    'The candidate capture precedes allocation while Supply2 captures follow it; no successful fresh-read triplet is claimed',
    'No matching release detail/candidate/events triplet exists in this capture set',
    'This captured allocation uses trackingMode none; exact tracked-unit selection requires separate real SQL/browser evidence',
    'Historical decoder acceptance does not prove current permission, browser interaction, checkout or payment',
  ],
};
const output = path.join(
  checks,
  'allocation-command-wire-acceptance-' + generatedAt.replaceAll(/[:.]/g, '-') + '.json',
);
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...report, reportFile: path.relative(root, output) }, null, 2));
