"""Verify or install only the tested D73 API/Catalog bytes on the existing schema 93."""
import argparse
import importlib.util
from pathlib import Path
import re
import shutil
import uuid

ROOT = Path(__file__).resolve().parent.parent
CHECKS = ROOT / 'artifacts/checks'
spec = importlib.util.spec_from_file_location('d73_runtime', ROOT / 'scripts/publish-local-product-workspace.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
ops = p.ops


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('verify', 'apply'))
    action = parser.parse_args().action
    shape = {'migrationCount': 93, 'tableCount': 244}
    old = ops.read(p.m.CURRENT)
    identity = p.owned_process(old)
    previous_evidence = CHECKS / 'd72-api-release.json'
    previous = ops.read(previous_evidence)
    p.require(previous['passed'] is True and previous['runtimeDirectory'] == old['runtimeDirectory']
              and old.get('localReleaseEvidence') == p.relative(previous_evidence),
              'The active API must be the accepted D72 runtime.')
    p.require(p.shape() == shape and old['databaseMigrationCount'] == 93, 'Expected canonical schema 93.')
    logs = {'unit': CHECKS / 'd73-backend-unit-local.log', 'sql': CHECKS / 'd73-sql-final.log'}
    for kind, count in (('unit', 20), ('sql', 8)):
        p.require(re.search(rf'Failed:\s+0, Passed:\s+{count}, Skipped:\s+0\b', logs[kind].read_text()),
                  'Expected the successful D73 targeted test run: ' + kind)
    p.require('SQL cleanup verified: zero SaymanTest_* databases remain.' in (CHECKS / 'd73-cleanup.log').read_text(),
              'Disposable SQL fixture cleanup is required.')
    files = ops.file_manifest(ops.API_BIN)
    old_files = ops.file_manifest(ROOT / old['runtimeDirectory'])
    changes = {name for name in files if files[name] != old_files.get(name)}
    expected = {'Shop.Api.dll', 'Shop.Api.pdb', 'Shop.Modules.Catalog.dll', 'Shop.Modules.Catalog.pdb'}
    p.require(set(files) == set(old_files) and changes == expected, 'Unreviewed API package delta.')
    module_hashes = {name: files[name] for name in old['moduleSha256']}
    for directory in (ops.UNIT_BIN, ops.SQL_BIN):
        p.require(all(ops.sha(directory / name) == digest for name, digest in module_hashes.items()),
                  'API bytes differ from the executed test assemblies.')
    verified = {
        'passed': True, 'previousRuntimeDirectory': old['runtimeDirectory'],
        'schema': shape, 'changedFiles': sorted(changes),
        'testedFiles': files, 'testLogs': {kind: ops.sha(path) for kind, path in logs.items()},
        'sqlCleanup': ops.sha(CHECKS / 'd73-cleanup.log'),
    }
    verification = CHECKS / 'd73-api-verification.json'
    if action == 'verify':
        ops.write(verification, verified)
        print(p.relative(verification))
        return
    p.require(ops.read(verification) == verified, 'Verified API package, baseline or test evidence changed.')

    run = uuid.uuid4().hex
    directory = ROOT / 'tmp' / ('api-runtime-product-multiselect-' + run)
    manifest = CHECKS / ('d73-api-manifest-' + run + '.json')
    evidence = CHECKS / 'd73-api-release.json'
    log = CHECKS / ('d73-api-runtime-' + run + '.log')
    shutil.copytree(ops.API_BIN, directory)
    p.require(ops.file_manifest(directory) == files, 'API candidate copy changed.')
    ops.write(manifest, {'algorithm': 'SHA-256', 'files': files})
    candidate = {
        **old, 'apiPid': None, 'runtimeDirectory': p.relative(directory),
        'previousRuntimeDirectory': old['runtimeDirectory'],
        'artifactManifest': p.relative(manifest), 'artifactManifestSha256': ops.sha(manifest),
        'moduleSha256': module_hashes, 'slice': 'D73 server-side product multi-select filters',
        'codeOnly': True, 'newMigrations': 0, 'newTables': 0, 'mainSeedPerformed': False,
        'localReleaseEvidence': p.relative(evidence),
    }
    report = {'passed': False, 'database': 'Sayman', 'schema': shape, 'changedFiles': sorted(changes),
              'newMigrations': 0, 'verification': p.relative(verification), 'testLogs': {kind: ops.sha(path) for kind, path in logs.items()}}
    p.stop(old, identity)
    try:
        active, checks = p.start(candidate, log)
        p.require(p.shape() == shape, 'Unexpected schema change at API startup.')
        for path, status in (('/api/storefront/fa?metadataOnly=true', 200),
                             ('/api/admin/catalog/workspace/products?statuses=Draft%2Carchived', 401)):
            check, _ = ops.request(path, status, require_no_store=(status == 401))
            checks.append(check)
        report.update(passed=True, runtimeDirectory=active['runtimeDirectory'], pid=active['apiPid'],
                      checks=checks)
        ops.write(evidence, report)
        print(p.relative(evidence))
    except Exception:
        # Schema did not change; only the prior same-schema artifact is eligible.
        current = ops.read(p.m.CURRENT)
        if p.rma.listener('api') is not None:
            p.require(current['runtimeDirectory'] == candidate['runtimeDirectory'],
                      'Unexpected listener; retain the descriptor for inspection.')
            p.stop(current, p.owned_process(current))
        p.require(p.shape() == shape, 'Unexpected schema; do not start the prior API.')
        p.start(old, CHECKS / ('d73-api-recovery-' + run + '.log'))
        ops.write(evidence, report)
        raise


if __name__ == '__main__':
    main()
