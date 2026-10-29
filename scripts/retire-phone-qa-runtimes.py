"""D44: audit, then explicitly retire only the known local phone QA listeners.

Default mode is read-only. --apply requires --main-ready and a pinned audit plan.
No SQL write or file deletion is issued here. The two owned API harnesses do
dispose their own generated GUID databases/keys/credentials on normal SIGTERM.
Reports, source, restart helpers, frozen runtimes and Main data are preserved.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, os, re, signal, subprocess, sys, tempfile, time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
QA_PORTS = (3105, 3107, 3108, 3109, 3110, 3175, 3178, 3179, 3180, 5181, 5182, 5183, 5184, 5185, 5186)
MAIN_PORTS = (3000, 3173, 5080)
CONTAINER = 'sayman-local-storefront-1'

def read(relative):
    path = ROOT / relative
    if path.is_symlink(): raise RuntimeError('A bound metadata file became a symlink.')
    return json.loads(path.read_text())

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=20)
    if result.returncode not in (0, 1): raise RuntimeError('Read-only process inventory failed.')
    return result.stdout

def listeners():
    found = {}
    current = None
    for line in run(['/usr/sbin/lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']).splitlines():
        if line.startswith('p'): current = int(line[1:])
        elif line.startswith('n'):
            try: port = int(line[1:].rsplit(':', 1)[1])
            except ValueError: continue
            found.setdefault(port, set()).add(current)
    return {port: sorted(pids) for port, pids in found.items()}

def process(pid):
    raw = run(['/bin/ps', '-p', str(pid), '-o', 'pid=,ppid=,lstart=,state=,command=']).strip()
    if not raw: return None
    parts = raw.split(None, 8)
    if len(parts) != 9: raise RuntimeError('The process identity could not be parsed.')
    cwd = next((line[1:] for line in run(['/usr/sbin/lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn']).splitlines() if line.startswith('n')), None)
    return {'pid': int(parts[0]), 'ppid': int(parts[1]), 'startedLocal': ' '.join(parts[2:7]),
        'state': parts[7], 'command': parts[8], 'cwd': cwd}

def same_identity(actual, expected):
    return actual is not None and all(actual[key] == expected[key] for key in ('pid', 'ppid', 'startedLocal', 'command', 'cwd'))

def evidence_path(raw, *, existing=False):
    path = Path(raw)
    if not path.is_absolute(): path = ROOT / path
    if path.is_symlink() or not path.resolve().is_relative_to((ROOT / 'artifacts/checks').resolve()):
        raise RuntimeError('Use only a non-symlink evidence path under artifacts/checks.')
    if existing and not path.is_file(): raise RuntimeError('The pinned evidence file is missing.')
    return path

def fixture(relative):
    value = read(relative)
    if value.get('syntheticTestOnly') is not True or value.get('mainChanged') is not False or not re.fullmatch(r'SaymanTest_[a-f0-9]{32}', value.get('connectionDatabase', '')):
        raise RuntimeError('The fixture descriptor is not an owned generated GUID database.')
    directory = Path(value['directory'])
    if directory.is_symlink() or not directory.resolve().is_relative_to((ROOT / 'tmp').resolve()): raise RuntimeError('The fixture private directory is outside workspace tmp.')
    credentials = directory / 'credentials.json'
    private = {'directory': str(directory), 'exists': directory.exists(), 'credentialFileExists': credentials.is_file()}
    if credentials.is_file():
        if credentials.is_symlink() or credentials.stat().st_mode & 0o077: raise RuntimeError('Fixture credentials must remain owner-only.')
        data = json.loads(credentials.read_text())
        if data.get('runId') != value['runId'] or data.get('syntheticTestOnly') is not True: raise RuntimeError('Credential ownership differs from its fixture.')
        private.update(credentialMode=oct(credentials.stat().st_mode & 0o777), credentialSha256=digest(credentials))
    keys = Path(tempfile.gettempdir()) / value['connectionDatabase']
    private['keyDirectory'] = str(keys)
    private['keyDirectoryExists'] = keys.is_dir()
    return {'descriptor': relative, 'runId': value['runId'], 'pid': value['pid'], 'database': value['connectionDatabase'],
        'privateFiles': private, 'gracefulStopDisposesOwnGuidAndPrivateFiles': True}

def sql_databases():
    # Existing repository SQL reader, with a literal SELECT-only query.
    sys.path.insert(0, str(ROOT / 'tmp'))
    from order38_release_common import payload
    value = payload("SELECT (SELECT (SELECT COUNT(*) FROM sys.databases WHERE name LIKE N'SaymanTest[_]%') total,JSON_QUERY((SELECT name,CONVERT(varchar(40),create_date,127) createdAtLocal,state_desc FROM sys.databases WHERE name LIKE N'SaymanTest[_]%' ORDER BY name FOR JSON PATH)) databases FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) Payload", 'master')
    return value.get('databases', [])

def preview_container():
    template = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"status":{{json .State.Status}},"startedAt":{{json .State.StartedAt}},"ports":{{json .HostConfig.PortBindings}}}'
    result = subprocess.run(['docker', 'inspect', '--format', template, CONTAINER], capture_output=True, text=True, timeout=20)
    if result.returncode:
        if 'No such' in result.stderr: return None
        raise RuntimeError('The specific SHOP preview container could not be inspected.')
    value = json.loads(result.stdout)
    labels = value.get('labels') or {}
    if (value['name'] != '/' + CONTAINER or labels.get('com.docker.compose.project') != 'sayman-local'
        or labels.get('com.docker.compose.service') != 'storefront'
        or not re.fullmatch('[a-f0-9]{64}', value['id'])):
        raise RuntimeError('The preview container identity does not match the known SHOP service.')
    bindings = [binding for rows in (value.get('ports') or {}).values() for binding in rows or []]
    if any(binding.get('HostPort') != '3100' for binding in bindings) or value['running'] and not bindings:
        raise RuntimeError('The inspected container has unexpected bindings; the canonical3000 service must not be stopped.')
    return value

def audit():
    d41 = read('tmp/phone-d41-qa-current.json')
    ui = read('tmp/phone-d41-review-storefront.json')
    admin = read('tmp/phone-d41-admin-process.json')
    shared_ui = read('tmp/phone-discovery-storefront-runtime.json')
    shared = read('tmp/phone-discovery-preview-processes.json')
    exclusive = read('tmp/integrated2-phone-qa-current.json')
    exclusive_runtime = read('tmp/parcel82-exclusive-phone-runtime.json')
    candidate = read('tmp/parcel-shipping82-runtime-set.json')
    if d41.get('ownerTag') != 'phone-d41-root' or d41['apiPort'] != 5184 or ui['port'] != 3110 or admin['port'] != 3180:
        raise RuntimeError('D41 ownership metadata changed.')
    if exclusive['apiPort'] != 5185 or exclusive['storefrontPort'] != 3109 or exclusive['adminPort'] != 3179:
        raise RuntimeError('D42 exclusive ownership metadata changed.')
    shared_admin = next(row for row in shared['services'] if row['name'] == 'admin' and row['port'] == 3178)
    definitions = [
        ('d41-storefront', 3110, ui['pid'], ui['runtime'], 'next-server (v16.4.2)'),
        ('d41-admin', 3180, admin['pid'], str(ROOT), 'node scripts/serve-phone-d41-admin.mjs'),
        ('d42-shared-storefront', 3108, shared_ui['pid'], shared_ui['runtime'], 'next-server (v16.4.2)'),
        ('d42-shared-admin', 3178, shared_admin['launcherPid'], str(ROOT), 'node tmp/admin-phone-discovery-serve.mjs'),
        ('d42-exclusive-storefront', 3109, None, str(ROOT / candidate['storefrontRuntime'] / 'apps/storefront'), 'next-server (v16.4.2)'),
        ('d42-exclusive-admin', 3179, None, str(ROOT), 'node tmp/serve-exclusive-phone82-admin.mjs'),
        ('d42-exclusive-transport', 5186, None, str(ROOT), 'node tmp/phone82-exclusive-gateway.mts'),
        ('d41-api', 5184, d41['pid'], str(ROOT), 'dotnet ' + str(ROOT / 'backend/.qa-runners/phone-d41-root-28efc5696c5b4af2b962f3e0335e1a1b/bin/Debug/net10.0/Shop.PhoneD41RootQa.28efc5696c5b.dll')),
        ('d42-exclusive-api', 5185, exclusive['pid'], str(ROOT), 'dotnet ' + str(ROOT / exclusive_runtime['apiRuntime'] / exclusive_runtime['executable']))]
    active = listeners()
    rows = []
    for role, port, expected_pid, cwd, command in definitions:
        pids = active.get(port, [])
        if not pids:
            rows.append({'role': role, 'port': port, 'alreadyClosed': True})
            continue
        if len(pids) != 1 or expected_pid is not None and pids != [expected_pid]: raise RuntimeError('A QA port has an unexpected listener: ' + str(port))
        value = process(pids[0])
        if value is None or value['cwd'] != cwd or value['command'] != command: raise RuntimeError('A QA listener has an unexpected command/cwd: ' + str(port))
        rows.append({'role': role, 'port': port, 'identity': value})
    known_ports = {row['port'] for row in rows}
    if any(active.get(port) for port in set(QA_PORTS) - known_ports): raise RuntimeError('A previously closed SHOP QA port was reused; inspect its owner before retirement.')
    closed_ports = sorted(port for port in QA_PORTS if not active.get(port))
    sources = ['tmp/phone-d41-qa-current.json', 'tmp/phone-d41-review-storefront.json', 'tmp/phone-d41-admin-process.json',
        'tmp/phone-discovery-storefront-runtime.json', 'tmp/phone-discovery-preview-processes.json', 'tmp/phone-discovery-qa-current.json',
        'tmp/integrated2-phone-qa-current.json', 'tmp/parcel82-exclusive-phone-runtime.json',
        'scripts/serve-phone-d41-admin.mjs', 'tmp/admin-phone-discovery-serve.mjs', 'tmp/serve-exclusive-phone82-admin.mjs', 'tmp/phone82-exclusive-gateway.mts']
    databases = sql_databases()
    fixtures = [fixture('tmp/phone-d41-qa-current.json'), fixture('tmp/integrated2-phone-qa-current.json'), fixture('tmp/phone-discovery-qa-current.json')]
    known = {row['database'] for row in fixtures}
    project_listeners = []
    for pid in sorted({pid for pids in active.values() for pid in pids}):
        value = process(pid)
        if value and value['cwd'] and Path(value['cwd']).is_relative_to(ROOT):
            project_listeners.append({'ports': sorted(port for port, pids in active.items() if pid in pids), 'identity': value})
    return {'schemaVersion': 1, 'preparedAtUtc': datetime.now(timezone.utc).isoformat(), 'decision': 'D44', 'preparedOnly': True,
        'mainMutated': False, 'processes': rows, 'alreadyClosedPorts': closed_ports, 'fixtures': fixtures,
        'shopPreviewContainer': preview_container(), 'containerStopOnlyNoDeleteOrVolumeChange': True,
        'allProjectListeners': project_listeners,
        'unclassifiedProjectListenerPorts': sorted({port for row in project_listeners for port in row['ports'] if port not in (*QA_PORTS, *MAIN_PORTS)}),
        'databaseInventory': databases, 'unknownGuidDatabases': [row['name'] for row in databases if row['name'] not in known],
        'sourceSha256': {name: digest(ROOT / name) for name in sources},
        'preserve': ['artifacts/checks', 'restart helpers and frozen runtime files', 'tmp/local-backups', 'Main Sayman and identity-keys', 'Parseh/Redis/SQL/Docker daemon/volumes and other containers'],
        'historicalFixtureEvidence': ['artifacts/checks/phone-discovery-prior-qa-owned-stop.json', 'artifacts/checks/phone-discovery-first-qa-cleanup.json', 'artifacts/checks/phone-discovery-second-qa-cleanup.json']}

def main_ready():
    active = listeners()
    descriptors = [read('tmp/api-runtime-current.json'), read('tmp/storefront-runtime-current.json'), read('tmp/admin-runtime-current.json')]
    expected = [descriptors[1].get('pid'), descriptors[2].get('adminPid'), descriptors[0].get('apiPid')]
    if any(active.get(port) != [pid] for port, pid in zip(MAIN_PORTS, expected)): raise RuntimeError('Main listener ownership does not match its live descriptors.')
    if descriptors[0].get('databaseMigrationCount') != 83 or descriptors[0].get('mainPromoted') is not True:
        raise RuntimeError('The D44 schema83 Main promotion is not recorded yet.')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    checks = []
    for url in ['http://127.0.0.1:5080/health/ready', 'http://127.0.0.1:3000/fa/market', 'http://127.0.0.1:3173/']:
        with opener.open(url, timeout=15) as response:
            if response.status != 200: raise RuntimeError('Main readiness HTTP check failed.')
            checks.append({'url': url, 'status': response.status})
    request = urllib.request.Request('http://127.0.0.1:5080/api/phones/fa/search', data=b'{"page":1,"pageSize":24}', method='POST', headers={'Content-Type': 'application/json'})
    with opener.open(request, timeout=15) as response: phones = json.load(response)
    if phones.get('schemaVersion') != 1 or phones.get('total') != 8 or sum(len(row['configurations']) for row in phones['items']) != 67:
        raise RuntimeError('Main does not serve the accepted eight models and 67 configurations.')
    return {'listeners': dict(zip(MAIN_PORTS, expected)), 'http': checks, 'phoneModels': 8, 'phoneConfigurations': 67}

def retire(plan, progress):
    if plan.get('decision') != 'D44' or plan.get('preparedOnly') is not True: raise RuntimeError('Use the explicit D44 audit plan.')
    for relative, expected in plan['sourceSha256'].items():
        path = ROOT / relative
        if path.is_symlink() or digest(path) != expected: raise RuntimeError('A pinned QA ownership source changed: ' + relative)
    ready = main_ready()
    before = listeners()
    for row in plan['processes']:
        if row['port'] not in QA_PORTS or row['port'] in MAIN_PORTS: raise RuntimeError('The plan includes an out-of-scope port.')
        if row.get('alreadyClosed'):
            if before.get(row['port']): raise RuntimeError('An already-closed QA port was reused.')
            continue
        wanted = row['identity']
        actual = process(wanted['pid'])
        if before.get(row['port']) != [wanted['pid']] or not same_identity(actual, wanted): raise RuntimeError('A QA process changed since audit: ' + row['role'])
        if wanted['pid'] in ready['listeners'].values(): raise RuntimeError('A Main PID must never be retired.')
    if any(before.get(port) for port in plan['alreadyClosedPorts']): raise RuntimeError('A previously closed SHOP QA port was reused.')
    container = preview_container()
    if container != plan.get('shopPreviewContainer'): raise RuntimeError('The exact preview container changed since audit.')
    results = []
    progress({'completed': False, 'inProgress': True, 'mainReadiness': ready, 'stopped': results})
    for row in plan['processes']:
        if row.get('alreadyClosed'): continue
        wanted = row['identity']
        if not same_identity(process(wanted['pid']), wanted) or listeners().get(row['port']) != [wanted['pid']]: raise RuntimeError('The exact retirement target changed immediately before SIGTERM.')
        results.append({'role': row['role'], 'port': row['port'], 'pid': wanted['pid'], 'signal': 'SIGTERM', 'closed': False, 'signalRequested': True})
        progress({'stopped': results})
        os.kill(wanted['pid'], signal.SIGTERM)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            actual = process(wanted['pid'])
            if not listeners().get(row['port']) and (actual is None or actual['state'].startswith('Z')): break
            time.sleep(0.5)
        else: raise RuntimeError('The known QA process did not exit after SIGTERM; no force kill or SQL fallback was attempted.')
        results[-1]['closed'] = True
        progress({'stopped': results})
        print(json.dumps(results[-1]), flush=True)
    container_stopped = False
    if container is not None and container['running']:
        if preview_container() != container: raise RuntimeError('The preview container changed immediately before its stop.')
        progress({'containerStopRequested': container['id']})
        stopped = subprocess.run(['docker', 'stop', '--time', '30', container['id']], capture_output=True, text=True, timeout=45)
        if stopped.returncode: raise RuntimeError('Stopping only the known SHOP preview container failed.')
        after_container = preview_container()
        if after_container is None or after_container['id'] != container['id'] or after_container['running']:
            raise RuntimeError('The existing preview container was not retained in a stopped state.')
        container_stopped = True
        progress({'containerStopped': True})
    remaining = {port: pids for port, pids in listeners().items() if port in QA_PORTS}
    if listeners().get(3100): remaining[3100] = listeners()[3100]
    databases = sql_databases()
    owned = {row['database'] for row in plan['fixtures']}
    residual = [row for row in databases if row['name'] in owned]
    private = [{'database': row['database'], 'credentialDirectoryExists': Path(row['privateFiles']['directory']).exists(),
        'keyDirectoryExists': Path(row['privateFiles']['keyDirectory']).exists()} for row in plan['fixtures']]
    return {'completed': not remaining and not residual, 'inProgress': False, 'decision': 'D44', 'mainMutated': False, 'mainReadiness': ready,
        'stopped': results, 'remainingQaListeners': remaining, 'remainingOwnedDatabases': residual,
        'unknownDatabasesUntouched': [row for row in databases if row['name'] not in owned],
        'fixturePrivateFilesAfterDisposal': private, 'sqlWriteIssuedByHelper': False,
        'shopPreviewContainerStopped': container_stopped, 'containerRemoved': False, 'volumesChanged': False,
        'fileDeletionIssuedByHelper': False, 'fixtureGeneratedDataDisposedByHarness': True,
        'reportsRestartRuntimesBackupsPreserved': True}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', required=True)
    parser.add_argument('--plan')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--main-ready', action='store_true')
    args = parser.parse_args()
    output = evidence_path(args.report)
    if output.exists(): raise RuntimeError('Preserve existing evidence; choose a new report file.')
    if args.apply:
        if not args.main_ready or not args.plan: raise RuntimeError('Retirement requires explicit Main-ready authorization and an audit plan.')
        source = evidence_path(args.plan, existing=True)
        state = {'decision': 'D44', 'mainMutated': False, 'plan': str(source.relative_to(ROOT)), 'planSha256': digest(source)}
        def progress(value):
            state.update(value)
            output.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
        try:
            result = retire(json.loads(source.read_text()), progress)
            result['plan'] = state['plan']; result['planSha256'] = state['planSha256']
        except Exception as error:
            progress({'completed': False, 'inProgress': False, 'error': str(error)})
            raise
    else:
        if args.plan or args.main_ready: raise RuntimeError('Audit mode does not accept apply-only flags.')
        result = audit()
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(output.relative_to(ROOT)), 'applied': args.apply, 'completed': result.get('completed'), 'preparedOnly': result.get('preparedOnly')}))

if __name__ == '__main__': main()
