"""Run the compiled SQL suite sequentially in complete-class batches.

No build, migration helper, service restart or database deletion is performed by
this runner. The tests own their short-lived fixtures. Each batch is followed by
the existing read-only cleanup check; unknown databases are never repaired here.

Example: python3 scripts/test-sql-batches.py --output artifacts/checks/sql-final
Resume:  python3 scripts/test-sql-batches.py --output artifacts/checks/sql-final --resume

Resume revalidates every earlier accepted TRX and artifact against the original
discovery and frozen inputs. Failed/interrupted attempts remain in their unique
directories and the previous proof is archived. No case is silently skipped.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import argparse
import fcntl
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
ENVIRONMENT = {'DOTNET_TieredPGO': '0', 'DOTNET_CLI_UI_LANGUAGE': 'en', 'VSLANG': '1033'}
SOURCE_SUFFIXES = {'.cs', '.csproj', '.props', '.targets', '.sln', '.slnx', '.json', '.config', '.runsettings'}
METHOD = re.compile(r'Shop\.SqlTests\.(?:[A-Za-z_]\w*[.+])+[A-Za-z_]\w*\Z')
MARKER = 'The following Tests are available:'
ZERO_COUNTERS = ('failed', 'error', 'timeout', 'aborted', 'inconclusive', 'passedButRunAborted',
                 'notRunnable', 'notExecuted', 'disconnected', 'warning', 'inProgress', 'pending')


class EvidenceError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise EvidenceError(message)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    require(path.is_file() and not path.is_symlink(), 'Expected a regular evidence/source file: ' + str(path))
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def relative(path):
    return str(path.relative_to(ROOT))


def owned(value):
    path = Path(value)
    require(not path.is_absolute() and '..' not in path.parts, 'Evidence paths must be workspace-relative.')
    path = ROOT / path
    require(path.resolve().is_relative_to(ROOT) and not path.is_symlink(), 'Evidence path escaped the workspace.')
    return path


def write(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.next')
    with temporary.open('x') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def read(path):
    sha(path)
    return json.loads(path.read_text())


def test_method(display_name):
    # Parameter values can themselves contain periods, parentheses, commas and
    # escaped quotes. Only the prefix before the FIRST '(' identifies a method.
    method = display_name.partition('(')[0]
    require(bool(METHOD.fullmatch(method)), 'Unrecognized SQL test identity: ' + display_name)
    require('(' not in display_name or display_name.endswith(')'), 'Incomplete theory display name.')
    return method


def parse_discovery(output):
    require(output.count(MARKER) == 1, 'SQL discovery did not contain exactly one complete test-list marker.')
    names = []
    for line in output.split(MARKER, 1)[1].splitlines():
        value = line.strip()
        if not value:
            continue
        if value.startswith('Shop.SqlTests.'):
            require(line.startswith('    '), 'Unexpected unindented SQL discovery row.')
            test_method(value)
            names.append(value)
        else:
            # Do not silently accept another test namespace or a wrapped case.
            require(not line.startswith('    ') or value.startswith(('[', 'Warning:', 'Information:')),
                    'Unrecognized or wrapped SQL discovery row: ' + value)
    require(bool(names), 'SQL discovery returned no cases.')
    return names


def plan_batches(names, target):
    require(1 <= target <= 200, 'Target batch size must be between 1 and 200 cases.')
    classes = defaultdict(list)
    for name in names:
        classes[test_method(name).rsplit('.', 1)[0]].append(name)
    batches, selected, selected_names = [], [], []

    def finish():
        if not selected:
            return
        methods = sorted({test_method(name) for name in selected_names})
        batches.append({'index': len(batches) + 1, 'classes': list(selected), 'methods': methods,
                        'expectedCount': len(selected_names), 'names': list(selected_names),
                        # Exact method equality admits all theory rows, with no
                        # substring collision between similarly named classes.
                        'filter': '|'.join('FullyQualifiedName=' + method for method in methods),
                        'oversizedWholeClass': len(selected_names) > target})
        selected.clear()
        selected_names.clear()

    for name, cases in sorted(classes.items()):
        if selected and len(selected_names) + len(cases) > target:
            finish()
        selected.append(name)
        selected_names.extend(cases)
        if len(selected_names) >= target:
            finish()
    finish()
    require(Counter(name for batch in batches for name in batch['names']) == Counter(names),
            'Batch planning lost or duplicated discovered cases.')
    require(len(classes) == sum(len(batch['classes']) for batch in batches), 'A class was split across batches.')
    return batches


def parse_trx(path):
    sha(path)
    document = ET.parse(path).getroot()
    counters = document.find('{*}ResultSummary/{*}Counters')
    require(counters is not None, 'TRX has no result counters.')
    counts = {key: int(value) for key, value in counters.attrib.items()}
    rows = document.findall('{*}Results/{*}UnitTestResult')
    definitions = {}
    for definition in document.findall('{*}TestDefinitions/{*}UnitTest'):
        method = definition.find('{*}TestMethod')
        require(method is not None and definition.attrib['id'] not in definitions, 'TRX test definitions are incomplete or duplicated.')
        definitions[definition.attrib['id']] = method.attrib['className'] + '.' + method.attrib['name']
    return {'counters': counts, 'names': [row.attrib['testName'] for row in rows],
            'testIds': [row.attrib['testId'] for row in rows],
            'executionIds': [row.attrib['executionId'] for row in rows],
            'outcomes': [row.attrib.get('outcome') for row in rows], 'methods': definitions}


def validate_trx(value, expected):
    counts, size = value['counters'], len(expected)
    require(all(counts.get(key) == size for key in ('total', 'executed', 'passed')), 'TRX did not pass every expected case.')
    require(all(counts.get(key, 0) == 0 for key in ZERO_COUNTERS), 'TRX contains failures, skips, warnings or incomplete executions.')
    require(len(value['names']) == len(set(value['testIds'])) == len(set(value['executionIds'])) == size,
            'TRX result count or distinct execution identities differ from discovery.')
    require(Counter(value['outcomes']) == Counter({'Passed': size}), 'TRX has a non-passing outcome.')
    require(Counter(value['names']) == Counter(expected), 'TRX and discovery case Counters differ.')
    for test_id, name in zip(value['testIds'], value['names']):
        require(value['methods'].get(test_id) == test_method(name), 'TRX method identity does not match its discovered display name.')


def source_inventory():
    values = {}
    for directory, children, files in os.walk(ROOT / 'backend'):
        children[:] = sorted(name for name in children if name not in {'bin', 'obj', 'TestResults', '.qa-runners', '__pycache__'})
        require(not any((Path(directory) / name).is_symlink() for name in children), 'Backend source directory is a symbolic link.')
        for name in sorted(files):
            path = Path(directory) / name
            if path.suffix in SOURCE_SUFFIXES or name == '.editorconfig':
                values[relative(path)] = sha(path)
    for name in ('global.json', 'Directory.Build.props', 'Directory.Packages.props', 'NuGet.Config',
                 'scripts/test-sql-batches.py', 'scripts/test_sql_batches.py', 'scripts/test-sql-local.py', 'scripts/verify-sql-test-cleanup.py'):
        if (ROOT / name).exists():
            values[name] = sha(ROOT / name)
    return values


def freeze(configuration):
    directories = {
        'api': ROOT / f'backend/src/Shop.Api/bin/{configuration}/net10.0',
        'unit': ROOT / f'backend/tests/Shop.Tests/bin/{configuration}/net10.0',
        'sql': ROOT / f'backend/tests/Shop.SqlTests/bin/{configuration}/net10.0',
    }
    modules = sorted(path.name for path in directories['api'].glob('Shop.*.dll'))
    require(len(modules) == 14 and 'Shop.Api.dll' in modules, 'Exactly 14 compiled API Shop modules are required; this runner never builds them.')
    parity = {name: {kind: sha(directory / name) for kind, directory in directories.items()} for name in modules}
    require(all(len(set(hashes.values())) == 1 for hashes in parity.values()), 'API, unit and SQL product assemblies differ.')
    tests = {}
    for kind, assembly in (('unit', 'Shop.Tests'), ('sql', 'Shop.SqlTests')):
        require({path.name for path in directories[kind].glob('Shop.*.dll')} == set(modules) | {assembly + '.dll'},
                'Unexpected compiled Shop test module set.')
        for suffix in ('.dll', '.deps.json', '.runtimeconfig.json'):
            path = directories[kind] / (assembly + suffix)
            tests[relative(path)] = sha(path)
    return {'sourceSha256': source_inventory(), 'module14parity': parity, 'testAssemblySha256': tests}


def assert_frozen(plan):
    require(freeze(plan['configuration']) == plan['frozen'], 'Frozen backend source, runner, test artifacts or 14-module parity changed. Start a fresh complete run.')


def process_group_alive(pgid):
    require(isinstance(pgid, int) and pgid > 1, 'Invalid owned process-group identity.')
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False


def stop_owned(process, grace_seconds=10, kill_grace_seconds=10):
    # command() always uses start_new_session=True, so this original child PID
    # identifies its owned session/process group. A wrapper can exit before its
    # dotnet/testhost descendants: never use parent.poll() as the group boundary.
    pgid = process.pid
    result = {'processGroupId': pgid, 'parentAlreadyExited': process.poll() is not None,
              'signals': [], 'processGroupEmpty': False}

    def wait_empty(seconds):
        deadline = time.monotonic() + seconds
        while True:
            process.poll()  # Reap the direct child, even when descendants remain.
            if not process_group_alive(pgid):
                return True
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            time.sleep(min(0.1, remaining))

    try:
        # Give an already-exited wrapper's normally finishing descendants a
        # short reap window before classifying them as orphaned live work.
        empty = wait_empty(0.2 if result['parentAlreadyExited'] else 0)
        if not empty:
            for sig, grace in ((signal.SIGINT, grace_seconds), (signal.SIGKILL, kill_grace_seconds)):
                try:
                    os.killpg(pgid, sig)
                    result['signals'].append(signal.Signals(sig).name)
                except ProcessLookupError:
                    break
                if wait_empty(grace):
                    break
        result['processGroupEmpty'] = wait_empty(0)
    except PermissionError:
        # Loss of permission is uncertainty, never evidence of termination.
        result['inspectionUnavailable'] = True
    result.update({'parentReturnCode': process.poll(), 'verifiedAt': stamp()})
    return result


def command(argv, directory, timeout):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    log, record_path = directory / 'output.log', directory / 'command.json'
    record = {'argv': argv, 'cwd': str(ROOT), 'environmentOverrides': ENVIRONMENT,
              'startedAt': stamp(), 'status': 'starting'}
    write(record_path, record)
    process = None
    started = time.monotonic()
    try:
        with log.open('xb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            process = subprocess.Popen(argv, cwd=ROOT, env={**os.environ, **ENVIRONMENT},
                                       stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            record.update({'pid': process.pid, 'processGroupId': process.pid, 'newSession': True, 'status': 'running'})
            write(record_path, record)
            try:
                process.wait(timeout=timeout)
                record.update({'returnCode': process.returncode, 'status': 'completed'})
            except subprocess.TimeoutExpired:
                record['status'] = 'timeout'
            except KeyboardInterrupt:
                record['status'] = 'interrupted'
                raise
    except OSError:
        record['status'] = 'launch-failed'
        raise EvidenceError('A recorded subprocess could not be started.')
    finally:
        if process is not None:
            record['termination'] = stop_owned(process)
            record['returnCode'] = process.poll()
            if record['termination']['signals'] and record['status'] == 'completed':
                record['status'] = 'orphaned-descendants-stopped'
        record.update({'endedAt': stamp(), 'elapsedSeconds': round(time.monotonic() - started, 3)})
        if log.exists():
            record['logSha256'] = sha(log)
        write(record_path, record)
        if process is not None:
            require(record['termination']['processGroupEmpty'],
                    'The owned process group is not proven empty; no SQL cleanup guarantee can be made.')
    return {'path': relative(log), 'sha256': sha(log), 'command': relative(record_path),
            'commandSha256': sha(record_path), 'status': record['status'], 'returnCode': record.get('returnCode')}


def cleanup(directory):
    result = command([sys.executable, str(ROOT / 'scripts/verify-sql-test-cleanup.py')], directory, 40)
    require(result['status'] == 'completed' and result['returnCode'] == 0
            and 'SQL cleanup verified: zero SaymanTest_* databases remain. No data was deleted.' in owned(result['path']).read_text(),
            'Disposable SQL cleanup was not verified as zero. Unknown databases were preserved.')
    return {**result, 'disposableDatabasesRemaining': 0}


def discover(directory, configuration):
    result = command([sys.executable, str(ROOT / 'scripts/test-sql-local.py'), '--no-build',
                      '--configuration', configuration, '--list-tests', '--', 'xUnit.MaxParallelThreads=1'], directory, 180)
    require(result['status'] == 'completed' and result['returnCode'] == 0, 'Compiled SQL discovery failed; inspect its preserved command/log.')
    return {**result, 'names': parse_discovery(owned(result['path']).read_text()), 'fullSuite': True, 'filterApplied': False}


def verify_artifact(record, path_key='path', sha_key='sha256'):
    require(sha(owned(record[path_key])) == record[sha_key], 'Recorded SQL artifact changed.')


def verify_command_completion(record):
    verify_artifact(record, 'command', 'commandSha256')
    value = read(owned(record['command']))
    termination = value.get('termination', {})
    require(value.get('status') == 'completed' and value.get('returnCode') == 0
            and value.get('newSession') is True and isinstance(value.get('pid'), int)
            and value['pid'] > 1 and value.get('processGroupId') == value['pid']
            and termination.get('processGroupId') == value['pid']
            and termination.get('processGroupEmpty') is True and termination.get('signals') == [],
            'Recorded command does not prove clean completion of its entire owned process group.')


def verified_prefix(plan, proof, plan_path):
    require(proof.get('planSha256') == sha(plan_path) and proof.get('runId') == plan['runId'], 'Resume proof does not belong to the unchanged plan.')
    accepted = proof.get('batches', [])
    require(len(accepted) <= len(plan['batches']), 'Resume has more accepted batches than planned.')
    for index, entry in enumerate(accepted):
        batch = plan['batches'][index]
        require(entry['index'] == batch['index'] and entry['classes'] == batch['classes']
                and entry['filter'] == batch['filter'] and entry['sourceUnchanged'] is True
                and entry['module14Unchanged'] is True, 'Resume batches must be an unchanged contiguous verified prefix.')
        verify_artifact(entry, 'trx', 'trxSha256')
        verify_artifact(entry, 'log', 'logSha256')
        verify_command_completion(entry)
        verify_artifact(entry['cleanup'])
        verify_command_completion(entry['cleanup'])
        require(entry['cleanup']['disposableDatabasesRemaining'] == 0
                and entry['cleanup']['returnCode'] == 0 and entry['cleanup']['status'] == 'completed'
                and 'SQL cleanup verified: zero SaymanTest_* databases remain. No data was deleted.'
                in owned(entry['cleanup']['path']).read_text(), 'Earlier batch cleanup was not zero.')
        parsed = parse_trx(owned(entry['trx']))
        validate_trx(parsed, batch['names'])
        require(Counter(entry['names']) == Counter(parsed['names']) and entry['passed'] == len(batch['names'])
                and entry['failed'] == entry['skipped'] == 0, 'Resume result summary differs from its original TRX.')
    return accepted


def summarize(proof, plan):
    names = [name for batch in proof['batches'] for name in batch['names']]
    proof.update({'executedCount': len(names), 'passed': len(names), 'failed': 0, 'skipped': 0,
                  'caseCounter': dict(sorted(Counter(names).items())),
                  'fullCoverage': Counter(names) == Counter(plan['discovery']['names']),
                  'exactDiscoveryExecutionMatch': Counter(names) == Counter(plan['discovery']['names']),
                  'allSelectedClassCasesIncluded': True, 'updatedAt': stamp()})
    if proof.get('failedBatch'):
        failed = proof['failedBatch']
        proof['failed'] = failed.get('failed', 0)
        proof['skipped'] = failed.get('skipped', 0)


def run(args):
    requested = Path(args.output) if args.output else Path('artifacts/checks') / ('sql-batches-' + uuid.uuid4().hex)
    directory = owned(str(requested))
    require(directory.resolve().is_relative_to((ROOT / 'artifacts/checks').resolve())
            and directory.resolve() != (ROOT / 'artifacts/checks').resolve(), 'Output must be a dedicated artifacts/checks subdirectory.')
    if not args.resume:
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    require(directory.is_dir() and not directory.is_symlink(), 'The owned batch directory is unavailable.')
    plan_path, proof_path = directory / 'plan.json', directory / 'proof.json'
    replace_proof = not args.resume
    invocation = directory / ('invocation-' + uuid.uuid4().hex)
    invocation.mkdir(mode=0o700)
    proof = {'schemaVersion': 1, 'acceptanceMode': 'complete-class-batches', 'status': 'running',
             'fullSuite': True, 'batches': [], 'resumeHistory': [], 'startedAt': stamp()}
    plan = None
    try:
        if args.resume:
            plan, previous = read(plan_path), read(proof_path)
            archive = invocation / 'previous-proof.json'
            write(archive, previous)
            proof.update({**previous, 'status': 'running',
                          'resumeHistory': [*previous.get('resumeHistory', []), {'path': relative(archive), 'sha256': sha(archive)}]})
            require(plan['schemaVersion'] == 1 and args.configuration == plan['configuration']
                    and args.target_cases == plan['targetCases'], 'Resume configuration must match the original plan.')
            assert_frozen(plan)
            verify_artifact(plan['discovery'])
            verify_artifact(plan['discovery'], 'command', 'commandSha256')
            require(Counter(parse_discovery(owned(plan['discovery']['path']).read_text())) == Counter(plan['discovery']['names']),
                    'Original SQL discovery evidence changed.')
            accepted = verified_prefix(plan, previous, plan_path)
            proof['batches'] = accepted
            proof.pop('failedBatch', None)
            proof.pop('failure', None)
        else:
            frozen = freeze(args.configuration)
            before = cleanup(invocation / 'cleanup-before')
            discovery = discover(invocation / 'discovery', args.configuration)
            plan = {'schemaVersion': 1, 'runId': uuid.uuid4().hex, 'createdAt': stamp(),
                    'configuration': args.configuration, 'targetCases': args.target_cases,
                    'environmentOverrides': ENVIRONMENT, 'xUnitMaxParallelThreads': 1,
                    'frozen': frozen, 'discovery': discovery,
                    'batches': plan_batches(discovery['names'], args.target_cases)}
            assert_frozen(plan)
            write(plan_path, plan)
            proof['initialCleanup'] = before
        proof.update({'runId': plan['runId'], 'plan': relative(plan_path), 'planSha256': sha(plan_path),
                      'total': len(plan['discovery']['names']), 'expectedCount': len(plan['discovery']['names']),
                      **plan['frozen'], 'discovery': plan['discovery'], 'sourceUnchanged': True, 'module14Unchanged': True})
        if args.resume:
            proof['resumeCleanup'] = cleanup(invocation / 'cleanup-before')
            fresh = discover(invocation / 'discovery', args.configuration)
            require(Counter(fresh['names']) == Counter(plan['discovery']['names']), 'Fresh resume discovery differs from the complete original suite.')
            proof['resumeDiscovery'] = fresh
            assert_frozen(plan)
        replace_proof = True
        summarize(proof, plan)
        write(proof_path, proof)
        for batch in plan['batches'][len(proof['batches']):]:
            assert_frozen(plan)
            index = batch['index']
            attempt = invocation / f'batch-{index:03d}'
            print(f"SQL batch {index}/{len(plan['batches'])}: {batch['expectedCount']} cases, {len(batch['classes'])} complete classes", flush=True)
            trx = attempt / 'results/batch.trx'
            argv = [sys.executable, str(ROOT / 'scripts/test-sql-local.py'), '--no-build',
                    '--configuration', args.configuration, '--filter', batch['filter'],
                    '--logger', 'trx;LogFileName=batch.trx', '--results-directory', str(trx.parent),
                    '--', 'xUnit.MaxParallelThreads=1']
            entry = {'index': index, 'classes': batch['classes'], 'filter': batch['filter'],
                     'expectedCount': batch['expectedCount'], 'names': [], 'passed': 0, 'failed': 0, 'skipped': 0}
            proof['activeBatch'] = index
            write(proof_path, proof)
            try:
                result = command(argv, attempt, args.timeout_seconds)
                entry.update({'log': result['path'], 'logSha256': result['sha256'],
                              'command': result['command'], 'commandSha256': result['commandSha256'],
                              'processStatus': result['status'], 'returnCode': result['returnCode']})
                if trx.is_file():
                    parsed = parse_trx(trx)
                    entry.update({'trx': relative(trx), 'trxSha256': sha(trx), 'names': parsed['names'],
                                  'passed': parsed['counters'].get('passed', 0), 'failed': parsed['counters'].get('failed', 0),
                                  'skipped': sum(outcome not in {'Passed', 'Failed'} for outcome in parsed['outcomes'])})
                else:
                    raise EvidenceError('Batch produced no TRX; no cases are accepted from its console summary.')
                require(result['status'] == 'completed' and result['returnCode'] == 0, 'SQL batch process failed, timed out or was interrupted.')
                validate_trx(parsed, batch['names'])
                assert_frozen(plan)
                entry.update({'sourceUnchanged': True, 'module14Unchanged': True})
            except (EvidenceError, KeyboardInterrupt, OSError, ET.ParseError, ValueError) as error:
                proof['failedBatch'] = entry
                raise error
            finally:
                # Always inspect cleanup, even if the process failed or no TRX
                # exists. This helper only counts; it never drops unknown DBs.
                try:
                    entry['cleanup'] = cleanup(invocation / f'cleanup-after-{index:03d}')
                except (EvidenceError, KeyboardInterrupt, OSError):
                    proof['failedBatch'] = entry
                    raise
            proof['batches'].append(entry)
            proof.pop('activeBatch', None)
            summarize(proof, plan)
            write(proof_path, proof)
        assert_frozen(plan)
        proof['finalCleanup'] = cleanup(invocation / 'cleanup-final')
        summarize(proof, plan)
        require(proof['fullCoverage'] and len(proof['batches']) == len(plan['batches']), 'The complete discovered SQL suite was not covered exactly once.')
        proof.update({'status': 'passed', 'disposableDatabasesRemaining': 0, 'completedAt': stamp()})
        write(proof_path, proof)
        print(f"Passed all {proof['passed']} discovered cases in {len(proof['batches'])} complete-class batches. Proof: {relative(proof_path)}", flush=True)
        return 0
    except (EvidenceError, KeyboardInterrupt, OSError, ET.ParseError, ValueError, KeyError) as error:
        proof.update({'status': 'interrupted' if isinstance(error, KeyboardInterrupt) else 'failed',
                      'failure': 'Interrupted by operator.' if isinstance(error, KeyboardInterrupt) else str(error),
                      'failedAt': stamp()})
        if plan is not None:
            summarize(proof, plan)
            try:
                current = freeze(plan['configuration'])
                proof['sourceUnchanged'] = current['sourceSha256'] == plan['frozen']['sourceSha256']
                proof['module14Unchanged'] = current['module14parity'] == plan['frozen']['module14parity']
            except (EvidenceError, OSError):
                proof['sourceUnchanged'] = proof['module14Unchanged'] = False
        # A refused resume must not overwrite the prior accepted-prefix proof.
        failure_path = proof_path if replace_proof else invocation / 'failure-proof.json'
        write(failure_path, proof)
        print('SQL acceptance stopped: ' + proof['failure'] + '\nProof: ' + relative(failure_path), file=sys.stderr, flush=True)
        return 130 if isinstance(error, KeyboardInterrupt) else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', help='Dedicated workspace-relative directory below artifacts/checks; new unless --resume.')
    parser.add_argument('--target-cases', type=int, default=50, help='Approximate cases per batch; a class is never split (default: 50).')
    parser.add_argument('--timeout-seconds', type=int, default=900, help='Bound each test process; owned process group is stopped on timeout (default: 900).')
    parser.add_argument('--configuration', choices=('Debug', 'Release'), default='Debug')
    parser.add_argument('--resume', action='store_true', help='Revalidate earlier accepted batches and continue the same frozen suite.')
    args = parser.parse_args()
    require(not args.resume or args.output, '--resume requires the exact original --output directory.')
    require(1 <= args.target_cases <= 200 and 30 <= args.timeout_seconds <= 7200, 'Invalid batch size or process timeout.')
    (ROOT / 'tmp').mkdir(exist_ok=True)
    with (ROOT / 'tmp/sql-batches.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise EvidenceError('Another batch runner owns the SQL suite lock. No process or database was changed.')
        signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        return run(args)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (EvidenceError, OSError) as error:
        print('SQL batches did not start: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
