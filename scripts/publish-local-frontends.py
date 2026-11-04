"""Prepare/apply checked offline frontend builds to the D44 canonical services.

Only the selected shop processes on 3000/3173 are restarted. The API descriptor,
SQL, Docker and unrelated applications remain outside this operation.
"""
from pathlib import Path
from datetime import datetime, timezone
from html.parser import HTMLParser
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit
from urllib.request import urlopen
from urllib.error import HTTPError

root = Path(__file__).resolve().parent.parent
package_path = root / 'tmp/frontend-quality-prepared.json'
evidence_path = None


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def write(file, value):
    temporary = file.with_name(file.name + '.next')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(file)


def verify_sources(source):
    if any(sha(root / name) != expected for name, expected in source.items()):
        raise SystemExit('Source changed after the accepted build; build again.')


def retain(previous, target):
    count = 0
    for file in previous.rglob('*'):
        if not file.is_file():
            continue
        destination = target / file.relative_to(previous)
        if destination.exists() and sha(destination) != sha(file):
            raise SystemExit('Retained asset collision: ' + str(destination))
        if not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, destination)
        count += 1
    return count


def manifest(runtime, name):
    file = root / ('artifacts/checks/' + runtime.name + '-artifacts.json')
    artifacts = {str(p.relative_to(runtime)): sha(p) for p in runtime.rglob('*') if p.is_file()}
    write(file, {'runtimeDirectory': str(runtime.relative_to(root)), 'artifacts': artifacts})
    return {'artifactManifest': str(file.relative_to(root)), 'artifactManifestSha256': sha(file),
            'artifactFiles': len(artifacts)}


def check_artifacts(state):
    runtime = root / state['runtimeDirectory']
    file = root / state['artifactManifest']
    if sha(file) != state['artifactManifestSha256']:
        raise SystemExit('Prepared artifact manifest changed.')
    for relative, expected in json.loads(file.read_text())['artifacts'].items():
        target = (runtime / relative).resolve()
        if not target.is_relative_to(runtime) or sha(target) != expected:
            raise SystemExit('Prepared runtime changed: ' + relative)


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ['src', 'href'] and value and value.startswith(('/assets/', '/_next/static/')):
                self.urls.add(value)


def http_check(name, state):
    port = 3000 if name == 'storefront' else 3173
    base = 'http://127.0.0.1:' + str(port)
    paths = ['/fa', '/en/catalog', '/fa/account', '/fa/moments', '/en/blog'] if port == 3000 else ['/']
    checks = []
    for path in paths:
        with urlopen(base + path, timeout=15) as response:
            assert response.status == 200
            html = response.read().decode('utf-8')
            checks.append({'path': path, 'status': 200})
        if path != paths[0]:
            continue
        parser = Assets()
        parser.feed(html)
        assert parser.urls, 'No referenced frontend assets.'
        for url in sorted(parser.urls):
            asset = urlsplit(url).path
            runtime = root / state['runtimeDirectory']
            local = (runtime / 'apps/storefront' / state['distDirectory'] / 'static' /
                     asset.removeprefix('/_next/static/')) if port == 3000 else runtime / asset.lstrip('/')
            with urlopen(base + url, timeout=10) as response:
                assert response.status == 200
                assert hashlib.sha256(response.read()).hexdigest() == sha(local)
            checks.append({'path': asset, 'status': 200, 'artifactExact': True})
    retired_paths = (['/fa/market', '/en/sourcing', '/fa/phone-interests', '/api/market/fa/items']
                     if port == 3000 else ['/api/admin/market', '/api/admin/sourcing/requests'])
    for path in retired_paths:
        try:
            urlopen(base + path, timeout=10)
        except HTTPError as error:
            assert error.code == 410 and 'no-store' in error.headers.get('Cache-Control', '')
            checks.append({'path': path, 'status': 410})
        else:
            raise AssertionError('Retired route unexpectedly available: ' + path)
    private_paths = ['/api/auth/me', '/api/admin/orders'] if port == 3173 else ['/api/auth/me']
    for path in private_paths:
        try:
            urlopen(base + path, timeout=10)
        except HTTPError as error:
            assert error.code == 401
            checks.append({'path': path, 'status': 401})
        else:
            raise AssertionError('Private route unexpectedly public: ' + path)
    return checks


def output(command):
    return subprocess.check_output(command, text=True).strip()


def listener(port):
    process = subprocess.run(['/usr/sbin/lsof', '-tiTCP:' + str(port), '-sTCP:LISTEN'],
                             text=True, capture_output=True)
    return process.stdout.strip()


def start(name):
    command = ['python3', 'scripts/serve-main-storefront.py'] if name == 'storefront' else ['node', 'scripts/serve-main-admin.mjs']
    with (root / ('artifacts/checks/frontend-quality-' + name + '-main.log')).open('ab') as log:
        return subprocess.Popen(command, cwd=root, stdout=log, stderr=log, start_new_session=True)


if len(sys.argv) != 2 or sys.argv[1] not in ['prepare', 'apply']:
    raise SystemExit('Use prepare or apply.')
if sys.argv[1] == 'prepare':
    build = json.loads((root / 'tmp/frontend-quality-build.json').read_text())
    assert build['passed'] and build['sourceStableDuringBuild']
    verify_sources(build['source'])
    run = build['run']
    evidence_path = root / ('artifacts/checks/frontend-quality-' + run + '-main-release.json')
    api_state = json.loads((root / 'tmp/api-runtime-current.json').read_text())
    assert api_state['sourceMigrationCount'] == api_state['databaseMigrationCount']
    minimum = build.get('apiMinimumMigrationCount')
    assert minimum is None or api_state['databaseMigrationCount'] >= minimum, 'Required backend schema is not active; frontend preparation stopped before copying or restarting.'
    prepared = {'build': build, 'apiDescriptorSha256': sha(root / 'tmp/api-runtime-current.json'),
                'services': {}, 'preparedAtUtc': datetime.now(timezone.utc).isoformat()}
    for name in build.get('targets', ['storefront', 'admin']):
        current = root / ('tmp/' + name + '-runtime-current.json')
        previous = json.loads(current.read_text())
        old = root / previous['runtimeDirectory']
        target = root / ('tmp/' + name + '-runtime-quality-' + run)
        if name == 'storefront':
            next_build = root / build['nextDirectory']
            dist = next_build.name
            shutil.copytree(next_build / 'standalone', target, symlinks=True)
            app = target / 'apps/storefront'
            shutil.copytree(next_build / 'static', app / dist / 'static', dirs_exist_ok=True)
            shutil.copytree(root / 'apps/storefront/public', app / 'public', dirs_exist_ok=True)
            retained = retain(old / 'apps/storefront' / previous['distDirectory'] / 'static', app / dist / 'static')
            updates = {'distDirectory': dist, 'buildId': (next_build / 'BUILD_ID').read_text().strip(),
                       'serverSha256': sha(app / 'server.js'), 'pid': None}
        else:
            shutil.copytree(root / build['adminDirectory'], target)
            shutil.copy2(root / 'apps/admin/server.mjs', target / 'server.mjs')
            shutil.copy2(root / 'apps/admin/public-video-proxy.mjs', target / 'public-video-proxy.mjs')
            retained = retain(old / 'assets', target / 'assets')
            updates = {'proxyModuleSha256': sha(target / 'server.mjs'), 'adminPid': None}
        candidate = {**previous, **updates, **manifest(target, name),
                     'sourceMigrationCount': api_state['sourceMigrationCount'],
                     'databaseMigrationCount': api_state['databaseMigrationCount'],
                     'tableCount': api_state['tableCount'],
                     'runtimeDirectory': str(target.relative_to(root)),
                     'previousRuntimeDirectory': previous['runtimeDirectory'],
                     'slice': build.get('slice', 'D47 admin guides and list design'),
                     'localReleaseEvidence': str(evidence_path.relative_to(root)),
                     'retainedPriorAssetUrls': retained, 'fullProjectComplete': False}
        for stale in ['sessionId', 'promotedAtUtc', 'uiAcceptedAtUtc']:
            candidate.pop(stale, None)
        if name == 'storefront':
            candidate['browserAcceptancePending'] = True
        prepared['services'][name] = {'previous': previous, 'previousDescriptorSha256': sha(current),
                                      'candidate': candidate}
    write(root / ('artifacts/checks/frontend-prepared-' + run + '.json'), prepared)
    write(package_path, prepared)
    print(json.dumps({name: {'directory': value['candidate']['runtimeDirectory'],
                            'retainedAssets': value['candidate']['retainedPriorAssetUrls']}
                      for name, value in prepared['services'].items()}))
else:
    prepared = json.loads(package_path.read_text())
    evidence_path = root / ('artifacts/checks/frontend-quality-' + prepared['build']['run'] + '-main-release.json')
    verify_sources(prepared['build']['source'])
    assert sha(root / 'tmp/api-runtime-current.json') == prepared['apiDescriptorSha256']
    # Verify both processes and artifacts before stopping either one.
    for name, service in prepared['services'].items():
        current = root / ('tmp/' + name + '-runtime-current.json')
        assert sha(current) == service['previousDescriptorSha256']
        check_artifacts(service['candidate'])
        previous = service['previous']
        pid = previous['pid' if name == 'storefront' else 'adminPid']
        assert listener(3000 if name == 'storefront' else 3173) == str(pid)
        process = output(['ps', '-p', str(pid), '-o', 'command='])
        cwd = output(['/usr/sbin/lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'])
        if name == 'storefront':
            assert 'next-server' in process
            assert str(root / previous['runtimeDirectory'] / 'apps/storefront') in cwd
        else:
            assert 'scripts/serve-main-admin.mjs' in process
            assert str(root) in cwd
    report = {'passed': False, 'codeOnly': True, 'databaseMigrations': 0, 'dockerRestarts': 0,
              'apiDescriptorUnchanged': True, 'services': {}, 'fullProjectComplete': False}
    for name, service in prepared['services'].items():
        current = root / ('tmp/' + name + '-runtime-current.json')
        old = service['previous']
        pid = old['pid' if name == 'storefront' else 'adminPid']
        os.kill(pid, signal.SIGTERM)
        for _ in range(100):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(.1)
        else:
            raise SystemExit('Previous process did not stop gracefully: ' + name)
        candidate = {**service['candidate'], 'promotedAtUtc': datetime.now(timezone.utc).isoformat()}
        write(current, candidate)
        process = None
        checks = None
        try:
            process = start(name)
            for attempt in range(40):
                try:
                    checks = http_check(name, candidate)
                    break
                except Exception:
                    if process.poll() is not None or attempt == 39:
                        raise
                    time.sleep(.25)
        except Exception as failure:
            if prepared['build'].get('apiMinimumMigrationCount', 0) >= 86:
                # Photo-bearing snapshots are incompatible with the old strict
                # UI contracts. Retain/restart this candidate, even when its
                # first health check failed; root must recover forward.
                from publish_local_used_photos import recover_compatible_frontend
                report['services'][name] = {'passed': False, 'compatibleCandidateRetained': True,
                                             'recoveryAttempted': True, 'recoveryHealthy': False,
                                             'initialFailureType': type(failure).__name__}
                try:
                    recovered = recover_compatible_frontend(
                        name, current, candidate, process, start, http_check, write)
                    report['services'][name].update(recovered)
                finally:
                    write(evidence_path, report)
                continue
            if process is None:
                raise
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=15)
            write(current, old)
            restored = start(name)
            report['services'][name] = {'passed': False, 'rollbackPid': restored.pid}
            write(evidence_path, report)
            raise
        report['services'][name] = {'passed': True, 'pid': process.pid, 'httpChecks': checks,
                                     'runtimeDirectory': candidate['runtimeDirectory']}
        write(evidence_path, report)
    assert sha(root / 'tmp/api-runtime-current.json') == prepared['apiDescriptorSha256']
    with urlopen('http://127.0.0.1:5080/health/ready', timeout=10) as response:
        assert response.status == 200
    report['passed'] = True
    report['finishedAtUtc'] = datetime.now(timezone.utc).isoformat()
    write(evidence_path, report)
    aggregate_file = root / 'tmp/local-runtime-current.json'
    if aggregate_file.is_file():
        aggregate = json.loads(aggregate_file.read_text())
        components = aggregate.setdefault('componentReleaseEvidence', {})
        for component in ['storefront', 'api', 'admin']:
            descriptor = json.loads((root / ('tmp/' + component + '-runtime-current.json')).read_text())
            if descriptor.get('localReleaseEvidence'):
                components[component] = descriptor['localReleaseEvidence']
            if component == 'api':
                aggregate['databaseMigrationCount'] = descriptor['databaseMigrationCount']
        aggregate['updatedAtUtc'] = report['finishedAtUtc']
        aggregate['lastComponentReleaseEvidence'] = {'path': str(evidence_path.relative_to(root)), 'sha256': sha(evidence_path)}
        write(aggregate_file, aggregate)
    print(json.dumps({'passed': True, 'services': {name: value['pid'] for name, value in report['services'].items()}}))
