"""Read-only canonical D60/88 verifier; importing performs no I/O.

Only main() can perform bounded anonymous GETs, read-only SQL SELECTs and
process/artifact inspection. It never authenticates, changes settings, starts
listeners, migrates, seeds, restores, or operates a browser. The sole write is
an explicitly requested new proof below artifacts/checks. The historical86
verifier and its default gates are unchanged.
"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import argparse
import hashlib
import importlib.util
import json
import os
import re
import shlex
import subprocess
import xml.etree.ElementTree as ET


_spec = importlib.util.spec_from_file_location('commerce_rma_readonly_primitives', Path(__file__).with_name('verify-local-business-release.py'))
legacy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(legacy)
legacy.HEADERS = (*legacy.HEADERS, 'X-Sayman-Returns-Contract', 'Set-Cookie', 'Content-Encoding', 'Location')
ROOT, CHECKS, DESCRIPTORS, AGGREGATE, PORTS, URLS = legacy.ROOT, legacy.CHECKS, legacy.DESCRIPTORS, legacy.AGGREGATE, legacy.PORTS, legacy.URLS
VerificationError, require, sha, read, stamp, workspace_path = legacy.VerificationError, legacy.require, legacy.sha, legacy.read, legacy.stamp, legacy.workspace_path
DEFAULT_BACKEND = 'artifacts/checks/commerce-rma-backend/acceptance.json'
DEFAULT_FRONTEND = 'artifacts/checks/commerce-rma-frontend-final/acceptance.json'
DEFAULT_BUILD = 'tmp/commerce-rma-frontend-build-71627051784f495ab04aac487b0ddd67.json'
ID, COMMAND = '00000000000000000000000000000001', '00000000000000000000000000000002'
MARKER, RESPONSE_LIMIT = 'rma-v1', 2097152
CUSTOMER_RMA_READS = ('/api/returns', '/api/returns/' + ID, '/api/returns/commands/' + COMMAND, '/api/orders/' + ID + '/returns/context')
ADMIN_RMA_READS = ('/api/admin/returns', '/api/admin/returns/policy', '/api/admin/returns/policy/history',
                   '/api/admin/returns/policy/commands/' + COMMAND, '/api/admin/returns/' + ID + '/' + ID,
                   '/api/admin/returns/commands/' + COMMAND)
POLICY_FIELDS = {'schemaVersion', 'configured', 'enabled', 'physicalReturns', 'digitalComplaints', 'conditionsFa', 'conditionsEn', 'windowMode', 'windowDays', 'canRefund', 'refundAvailability'}
_raw_get = legacy.get


def anonymous_get(component, path, expected, timeout, private=False, expected_hash=None, records=None):
    # The historical primitive appends before validating status. Keep its raw
    # records private until cookie values have been removed, including when it
    # raises. The same wrapper is used by its Ready-image smoke helper.
    captured = []
    try:
        result = _raw_get(component, path, expected, timeout, private, expected_hash, captured)
    finally:
        for record in captured:
            cookie_present = bool(record.get('setCookiePresent'))
            for key in tuple(record.get('headers', {})):
                if key.lower() == 'set-cookie':
                    cookie_present = bool(record['headers'].pop(key)) or cookie_present
            record['setCookiePresent'] = cookie_present
        if records is not None:
            records.extend(captured)
    require(not any(record['setCookiePresent'] for record in captured), 'An anonymous canonical GET attempts to set a cookie.')
    return result


legacy.get = anonymous_get


def current_backend_sources():
    # Import-safe inventory only: do not call the SQL runner or freeze/test APIs.
    spec = importlib.util.spec_from_file_location('commerce_rma_source_inventory', Path(__file__).with_name('test-sql-batches.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.source_inventory()


def backend_evidence(state, runtime, acceptance_path, publication_path):
    """Validate D60's real immutable shape without legacy photo count fields."""
    captured = {}
    def bind(reference):
        require(type(reference) is dict and set(reference) == {'path', 'sha256'}
                and type(reference['sha256']) is str and re.fullmatch(r'[a-f0-9]{64}', reference['sha256']), 'Malformed D60 artifact reference.')
        path = workspace_path(reference['path'], CHECKS)
        require(sha(path) == reference['sha256'], 'A referenced D60 backend evidence artifact changed.')
        captured[reference['path']] = reference['sha256']; return path
    acceptance_sha = sha(acceptance_path); publication = read(publication_path)
    require(publication.get('passed') is True and publication.get('databaseMigrationCount') == 88 and publication.get('tableCount') == 229
            and state.get('localReleaseEvidence') == str(publication_path.relative_to(ROOT))
            and publication.get('services', {}).get('api', {}).get('runtimeDirectory') == state.get('runtimeDirectory')
            and publication.get('acceptedEvidence', {}).get(str(acceptance_path.relative_to(ROOT))) == acceptance_sha,
            'The current passed publication does not bind this immutable backend acceptance.')
    accepted = read(acceptance_path); frozen_path = bind(accepted['frozen']); frozen = read(frozen_path)
    require(accepted.get('status') == 'backend-frozen-targeted-accepted'
            and all(accepted.get(key) is True for key in ('commerceChargePolicyAccepted', 'privateReturnRequestsAccepted', 'privateAdminHeadersAccepted', 'physicalFulfillmentCapacityAccepted', 'customerLoginContinuityAccepted')),
            'Explicit accepted D60 backend features are required.')
    sources, parity, tests = (frozen.get(key) for key in ('sourceSha256', 'module14parity', 'testAssemblySha256'))
    require(type(sources) is dict and sources and current_backend_sources() == sources, 'Current backend source inventory differs from the exact D60 freeze.')
    require(type(parity) is dict and len(parity) == 14 and 'Shop.Api.dll' in parity and accepted.get('module14parity') == parity,
            'D60 fourteen-module acceptance differs from its freeze.')
    expected = {}
    for name, row in parity.items():
        require(re.fullmatch(r'Shop\.[A-Za-z.]+\.dll', name) and type(row) is dict and set(row) == {'api', 'unit', 'sql'}
                and all(type(digest) is str and re.fullmatch(r'[a-f0-9]{64}', digest) for digest in row.values())
                and len(set(row.values())) == 1, 'D60 API/unit/SQL product module parity is incomplete.')
        expected[name] = row['api']
    require(state.get('moduleSha256') == expected, 'Current API descriptor differs from the exact D60 product modules.')
    locations = {'api': ROOT / 'backend/src/Shop.Api/bin/Debug/net10.0', 'unit': ROOT / 'backend/tests/Shop.Tests/bin/Debug/net10.0',
                 'sql': ROOT / 'backend/tests/Shop.SqlTests/bin/Debug/net10.0', 'runtime': runtime}
    for label, directory in locations.items():
        extra = {'Shop.Tests.dll'} if label == 'unit' else {'Shop.SqlTests.dll'} if label == 'sql' else set()
        require({path.name for path in directory.glob('Shop.*.dll')} == set(expected) | extra, 'D60 compiled module inventory differs from its accepted set.')
        require(all(sha(directory / name) == digest for name, digest in expected.items()), 'D60 API/unit/SQL/runtime module bytes differ.')
    test_paths = {f'backend/tests/{assembly}/bin/Debug/net10.0/{assembly}.{suffix}' for assembly in ('Shop.Tests', 'Shop.SqlTests') for suffix in ('dll', 'deps.json', 'runtimeconfig.json')}
    require(type(tests) is dict and set(tests) == test_paths and tests == accepted.get('testAssemblySha256'), 'All six exact D60 test artifacts are required.')
    for relative, digest in tests.items():
        require(type(digest) is str and re.fullmatch(r'[a-f0-9]{64}', digest)
                and sha(workspace_path(relative, ROOT / 'backend/tests')) == digest, 'Current D60 unit/SQL artifact bytes differ.')
    unit = accepted['unit']; total = unit.get('total')
    require(type(total) is int and total >= 1486 and unit.get('failed') == unit.get('skipped') == 0 and publication.get('unitPassed') == total,
            'D60 complete unit evidence differs from its published total.')
    trx_path = bind(unit['trx']); trx = ET.parse(trx_path); counters = trx.find('.//{*}Counters')
    require(counters is not None and all(counters.get(key) == str(total) for key in ('total', 'executed', 'passed'))
            and all(counters.get(key) == '0' for key in ('failed', 'error', 'timeout', 'aborted', 'inconclusive', 'passedButRunAborted', 'notRunnable', 'notExecuted', 'disconnected', 'warning', 'inProgress', 'pending')),
            'D60 unit TRX counters are incomplete, excluded or non-passing.')
    results = trx.findall('.//{*}UnitTestResult')
    require(len(results) == total and all(row.get('outcome') == 'Passed' for row in results)
            and len({row.get('executionId') for row in results}) == total, 'D60 unit TRX execution identities or outcomes differ.')
    command_path = bind(unit['command']); command = read(command_path); argv = command.get('argv', [])
    require(command.get('status') == 'completed' and command.get('returnCode') == 0 and command.get('cwd') == str(ROOT)
            and argv[:3] == ['dotnet', 'test', 'backend/tests/Shop.Tests'] and '--no-build' in argv
            and not any(arg == '--filter' or arg.startswith('--filter=') for arg in argv), 'Original D60 unit command was not a complete passing no-build run.')
    require(command.get('termination', {}).get('processGroupEmpty') is True and sha(command_path.parent / 'output.log') == command.get('logSha256'),
            'Original D60 unit command output or closed process evidence changed.')
    captured[str((command_path.parent / 'output.log').relative_to(ROOT))] = command['logSha256']
    reused = unit.get('reusedFromRound3', False)
    require(type(reused) is bool, 'Unit reuse must be explicit.')
    if reused:
        proof = read(bind(unit['reuseProof'])); unit_artifacts = {name: digest for name, digest in tests.items() if name.startswith('backend/tests/Shop.Tests/')}
        require(proof.get('accepted') is True and proof.get('unitPassed') == total and proof.get('module14parity') == parity
                and proof.get('unitArtifacts') == unit_artifacts and proof.get('unitTrx') == unit['trx']['path']
                and proof.get('unitTrxSha256') == unit['trx']['sha256'] and proof.get('currentFrozen') == accepted['frozen']
                and proof.get('previousFrozen') != accepted['frozen'], 'D60 unit reuse is not bound to its original units and current modules/freeze.')
        require(read(bind(proof['currentFrozen'])) == frozen, 'Unit reuse current frozen contents changed.')
        previous = read(bind(proof['previousFrozen'])); prior = read(bind(proof['previousAcceptedBackend']))
        require(prior.get('status') == 'backend-frozen-targeted-accepted' and prior.get('frozen') == proof['previousFrozen']
                and prior.get('module14parity') == previous.get('module14parity') == parity
                and prior.get('testAssemblySha256') == previous.get('testAssemblySha256')
                and all(prior.get('unit', {}).get(key) == unit.get(key) for key in ('trx', 'command', 'total', 'failed', 'skipped')),
                'D60 unit reuse does not reference the original accepted unit command/TRX.')
        old_unit_artifacts = {name: digest for name, digest in previous['testAssemblySha256'].items() if name.startswith('backend/tests/Shop.Tests/')}
        delta = sorted(name for name in set(previous['sourceSha256']) | set(sources) if previous['sourceSha256'].get(name) != sources.get(name))
        require(old_unit_artifacts == unit_artifacts and delta and proof.get('sourceDelta') == delta
                and all(name.startswith('backend/tests/Shop.SqlTests/') and '..' not in Path(name).parts for name in delta),
                'D60 reused units permit only the exact proven SQL-test source delta.')
    else:
        require('reuseProof' not in unit, 'A reused unit proof cannot be represented as a new unit run.')
    return {'frozenEvidence': str(frozen_path.relative_to(ROOT)), 'frozenEvidenceSha256': sha(frozen_path), 'moduleCount': 14,
            'moduleSha256': expected, 'apiUnitSqlRuntimeByteExact': True, 'backendAcceptance': {'path': str(acceptance_path.relative_to(ROOT)),
            'sha256': acceptance_sha, 'unitPassed': total, 'unitTrxSha256': unit['trx']['sha256'], 'unitReusedFromOriginalRun': reused,
            'sourceEntriesVerified': len(sources), 'testArtifactsVerified': len(tests), 'referencedEvidence': captured}}


def strict_json(body):
    def unique(pairs):
        result, seen = {}, set()
        for key, value in pairs:
            require(key.lower() not in seen, 'An observed JSON object contains ambiguous keys.')
            seen.add(key.lower()); result[key] = value
        return result
    try:
        return json.loads(body.decode('utf-8', errors='strict'), object_pairs_hook=unique,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    except (UnicodeError, ValueError, RecursionError):
        raise VerificationError('An observed response is not strict UTF-8 JSON.') from None


def public_policy(record, body):
    h = record['headers']
    require(record['status'] == 200 and len(body) <= RESPONSE_LIMIT
            and h.get('x-sayman-returns-contract') == MARKER
            and re.match(r'^application/json(?:\s*;|$)', h.get('content-type', ''), re.I)
            and not record.get('setCookiePresent') and not h.get('set-cookie') and not h.get('location')
            and h.get('x-content-type-options', '').lower() == 'nosniff'
            and 'no-store' in h.get('cache-control', '').lower()
            and 'noindex' in h.get('x-robots-tag', '').lower(), 'Public RMA policy lacks its installed anonymous JSON protection.')
    p = strict_json(body)
    require(type(p) is dict and set(p) == POLICY_FIELDS and type(p['schemaVersion']) is int and p['schemaVersion'] == 1,
            'Public RMA policy shape includes missing, unknown or private fields.')
    require(all(type(p[key]) is bool for key in ('configured', 'enabled', 'physicalReturns', 'digitalComplaints', 'canRefund'))
            and p['canRefund'] is False and p['refundAvailability'] == 'provider_unconfigured', 'A public RMA policy falsely enables refunds.')
    if not p['configured']:
        require(not any(p[key] for key in ('enabled', 'physicalReturns', 'digitalComplaints'))
                and all(p[key] is None for key in ('conditionsFa', 'conditionsEn', 'windowMode', 'windowDays')),
                'An unconfigured public policy fabricates terms or a deadline.')
    else:
        for key in ('conditionsFa', 'conditionsEn'):
            text = p[key]
            try:
                valid = type(text) is str and text.strip() and len(text.encode('utf-16-le')) <= 8000 and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]', text)
            except UnicodeError:
                valid = False
            require(valid, 'Configured public policy terms are unavailable or unbounded.')
        require((p['windowMode'] == 'manualReview' and p['windowDays'] is None)
                or (p['windowMode'] == 'deliveryDays' and type(p['windowDays']) is int and 1 <= p['windowDays'] <= 3650),
                'Public RMA delivery window is invalid.')
        require(not p['enabled'] or p['physicalReturns'] or p['digitalComplaints'], 'Enabled RMA policy has no supported request kind.')
    return p


def private_response(record, body):
    h = record['headers']; cache = {x.strip().lower() for x in h.get('cache-control', '').split(',')}
    vary = {x.strip().lower() for x in h.get('vary', '').split(',')}
    # This exact GET BFF validates only the RAM access-token Bearer and ignores
    # cookies. Its established address-proxy contract varies on Authorization.
    # Item paths have no GET operation; do not extend the exception to aliases,
    # queries, adjacent prefixes, raw API routes or any RMA/private route.
    bearer_only_addresses = record.get('component') == 'storefront' and record.get('path') == '/api/addresses' and record.get('method', 'GET') == 'GET'
    required_vary = {'authorization'} if bearer_only_addresses else {'cookie', 'authorization'}
    require(record['status'] == 401 and {'private', 'no-store'} <= cache
            and 'noindex' in h.get('x-robots-tag', '').lower()
            and h.get('x-content-type-options', '').lower() == 'nosniff'
            and required_vary <= vary and not record.get('setCookiePresent') and not h.get('set-cookie') and not h.get('location'),
            'An anonymous private route is accessible or lacks private/no-store/noindex/nosniff/Vary.')
    if record.get('component') == 'api' and record.get('path') in (*CUSTOMER_RMA_READS, *ADMIN_RMA_READS):
        require(h.get('x-sayman-returns-contract') == MARKER, 'A raw API RMA bearer challenge lacks the installed rma-v1 contract.')
    require(len(body) <= 32768, 'An anonymous bearer challenge has an unexpected body size.')
    if body:
        value = strict_json(body)
        require(type(value) is dict and set(value) <= {'title', 'detail', 'status', 'type', 'instance', 'traceId'}
                and not any(type(x) in (dict, list) for x in value.values()), 'An anonymous private error exposes unexpected private data.')


def release_states(states, aggregate):
    require(set(states) == set(PORTS) and aggregate.get('canonicalUrls') == URLS and aggregate.get('database') == 'Sayman'
            and aggregate.get('sourceMigrationCount') == aggregate.get('databaseMigrationCount') == 88
            and aggregate.get('tableCount') == 229 and aggregate.get('commerceRmaAccepted') is True
            and aggregate.get('commerceRmaRecoveryRequired') is False, 'Current aggregate is not the fully promoted canonical D60/88 shop.')
    for name, state in states.items():
        require(aggregate.get(name + 'Descriptor') == str(DESCRIPTORS[name].relative_to(ROOT))
                and state.get('localReleaseEvidence') and aggregate.get('componentReleaseEvidence', {}).get(name) == state['localReleaseEvidence'],
                'Aggregate selects a different current component release.')
        require(state.get('mainPromoted') is True and state.get('api') == URLS['api']
                and state.get('sourceMigrationCount') == state.get('databaseMigrationCount') == 88 and state.get('tableCount') == 229
                and state.get('commerceRmaAccepted') is True and state.get('commerceRmaRecoveryRequired') is False,
                'A current service still selects an old, incomplete or incompatible release.')
        if name != 'api':
            require(state.get('apiMinimumMigrationCount') == 88 and re.fullmatch(r'[a-f0-9]{32}', state.get('frontendBuildRun', ''))
                    and state['frontendBuildRun'] == states['storefront'].get('frontendBuildRun'),
                    'A current frontend differs from the accepted min88 D60 build.')


def frontend_evidence(states, aggregate, frontend_path, build_path):
    ref = aggregate.get('schemaReleaseEvidence', {})
    require(type(ref) is dict and set(ref) == {'path', 'sha256'} and ref['path'] == states['api']['localReleaseEvidence']
            and all(state['localReleaseEvidence'] == ref['path'] for state in states.values()),
            'All current components must reference the same accepted D60 publication.')
    report_path = workspace_path(ref['path'], CHECKS)
    require(sha(report_path) == ref['sha256'], 'The accepted current publication report changed.')
    report, frontend, build = read(report_path), read(frontend_path), read(build_path)
    require(report.get('passed') is True and report.get('databaseMigrationCount') == 88 and report.get('tableCount') == 229
            and report.get('bothCompatibleFrontendsPromoted') is True, 'The selected publication is not a completed three-service D60 cutover.')
    files = report.get('acceptedEvidence', {})
    require(files.get(str(frontend_path.relative_to(ROOT))) == sha(frontend_path)
            and files.get(str(build_path.relative_to(ROOT))) == sha(build_path),
            'The selected frontend acceptance/build were not used by this current publication.')
    sources = frontend.get('sourceSha256')
    require(frontend.get('sourceFrozen') is True and type(sources) is dict and sources and sources == build.get('source')
            and build.get('passed') is True and build.get('sourceStableDuringBuild') is True
            and build.get('apiMinimumMigrationCount') == 88 and set(build.get('targets', [])) == {'storefront', 'admin'},
            'Current frontend build does not match its frozen passing min88 acceptance.')
    run = build.get('run')
    require(type(run) is str and re.fullmatch(r'[a-f0-9]{32}', run)
            and all(states[name].get('frontendBuildRun') == run for name in ('storefront', 'admin'))
            and report.get('frontendBuildRun', run) == run,
            'Current frontend build run differs from the hash-bound published build.')
    checks = frontend.get('checks', {})
    require(set(checks) == {'fullStorefront', 'fullAdmin', 'storefrontTypeScript', 'adminTypeScript', 'globalEslint', 'globalPrettier'}
            and all(row.get('exitCode') == 0 for row in checks.values())
            and frontend.get('adminProxy', {}).get('exitCode') == 0, 'Selected frontend acceptance contains an incomplete or failed check.')
    for relative, digest in sources.items():
        require(type(digest) is str and re.fullmatch(r'[a-f0-9]{64}', digest)
                and sha(workspace_path(relative, ROOT)) == digest, 'Current frontend source differs from its selected acceptance/build.')
    for name, state in states.items():
        require(report.get('services', {}).get(name, {}).get('runtimeDirectory') == state['runtimeDirectory'],
                'The publication report references another current service runtime.')
    return report_path, {'acceptance': str(frontend_path.relative_to(ROOT)), 'acceptanceSha256': sha(frontend_path),
                         'build': str(build_path.relative_to(ROOT)), 'buildSha256': sha(build_path), 'run': run,
                         'sourceEntriesVerified': len(sources), 'publication': ref, 'bothFrontendsMatchPublishedBuild': True}


def process_identity(name, state):
    pid = state.get('apiPid' if name == 'api' else 'pid' if name == 'storefront' else 'adminPid')
    require(type(pid) is int and pid > 1, 'The selected component has no valid owned PID.')
    observed = subprocess.run(['lsof', '-nP', '-tiTCP:' + str(PORTS[name]), '-sTCP:LISTEN'], capture_output=True, text=True, timeout=10)
    require(observed.returncode == 0 and set(observed.stdout.split()) == {str(pid)}, 'A canonical listener differs from its selected PID.')
    command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True, timeout=10).strip()
    cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True, timeout=10).splitlines()
    started = subprocess.check_output(['ps', '-p', str(pid), '-o', 'lstart='], text=True, timeout=10).strip()
    runtime = workspace_path(state['runtimeDirectory'], ROOT / 'tmp')
    wanted = runtime / 'apps/storefront' if name == 'storefront' else ROOT
    tokens = shlex.split(command)
    # ps renders argv without shell quoting, including this workspace's space.
    # Compare the owned API command byte-for-byte instead of splitting its path.
    valid = command == 'dotnet ' + str(runtime / 'Shop.Api.dll') if name == 'api' else bool(re.fullmatch(r'next-server(?: \(v[0-9.]+\))?', command)) if name == 'storefront' else len(tokens) == 2 and Path(tokens[0]).name == 'node' and tokens[1] == 'scripts/serve-main-admin.mjs'
    require(valid and started and 'n' + str(wanted) in cwd, 'Canonical process command/cwd/start identity differs from its artifact.')
    return {'pid': pid, 'command': command, 'started': started}


class Assets(HTMLParser):
    def __init__(self, component):
        super().__init__(); self.component, self.paths = component, set()
    def handle_starttag(self, tag, attrs):
        a = dict(attrs); value = a.get('src') if tag == 'script' else a.get('href') if tag == 'link' else None
        prefix = '/_next/static/' if self.component == 'storefront' else '/assets/'
        if value and value.startswith(prefix):
            parsed = urlsplit(value)
            require(not parsed.query and not parsed.fragment and re.fullmatch(r'[A-Za-z0-9_./-]+', parsed.path)
                    and '..' not in Path(parsed.path).parts, 'Public entry references an unexpected immutable asset URL.')
            self.paths.add(parsed.path)


def asset_entry(name, state, url):
    prefix = '/_next/static/' if name == 'storefront' else '/assets/'
    require(url.startswith(prefix) and '..' not in Path(url).parts, 'Asset path escaped its component scope.')
    return 'apps/storefront/' + state['distDirectory'] + '/static/' + url[len(prefix):] if name == 'storefront' else url.lstrip('/')


def retained_assets(name, state, artifacts):
    path = workspace_path(state['artifactManifest'], CHECKS); document = read(path)
    retained = document.get('retainedPriorAssets')
    require(type(retained) is dict and retained and retained == state.get('retainedPriorAssets'), 'Retained frontend asset inventory is missing or differs.')
    prefix = '/_next/static/' if name == 'storefront' else '/assets/'
    for relative, digest in retained.items():
        require(type(relative) is str and relative and not Path(relative).is_absolute() and '..' not in Path(relative).parts
                and re.fullmatch(r'[A-Za-z0-9_./-]+', relative) and re.fullmatch(r'[a-f0-9]{64}', digest)
                and artifacts.get(asset_entry(name, state, prefix + relative)) == digest,
                'A retained asset escaped scope or differs from the complete current manifest.')
    names = sorted(retained)
    return {prefix + relative: retained[relative] for relative in dict.fromkeys((names[0], names[-1]))}, len(retained)


def configured_policy(policy, selection):
    require(type(selection) is dict and set(selection) == {'settings', 'charges', 'returns'}, 'Scoped configuration SELECT has an unexpected shape.')
    settings, charges, returns = (selection[name] for name in ('settings', 'charges', 'returns'))
    require(type(settings) is dict and settings == {'reservationMinutes': 60, 'maxOpenOrdersPerCustomer': 2}, 'Owner reservation60/open-order2 configuration differs.')
    require(type(charges) is dict and charges == {'shippingMode': 'postpaid', 'shippingFeeRial': None, 'shippingFreeFromRial': None, 'taxMode': 'included_unitemized', 'taxRateBasisPoints': None},
            'Owner postpaid or unknown included-tax policy differs; no unknown component may be zero or exempt.')
    require(policy['configured'] is True and policy['enabled'] is True and policy['physicalReturns'] is True
            and policy['windowMode'] == 'deliveryDays' and policy['windowDays'] == 3,
            'Owner three-day physical return policy is unconfigured or differs.')
    expected = {key: policy[key] for key in ('enabled', 'physicalReturns', 'digitalComplaints', 'windowMode', 'windowDays')}
    expected.update({key + 'Hash': hashlib.sha256(policy[key].encode('utf-16-le')).hexdigest().upper() for key in ('conditionsFa', 'conditionsEn')})
    require(returns == expected, 'Public RMA policy differs from its current SQL terms/window configuration.')
    return {'readOnly': True, 'reservationMinutes': 60, 'maxOpenOrdersPerCustomer': 2, 'shippingMode': 'postpaid',
            'carrierFeeKnown': False, 'taxMode': 'included_unitemized', 'taxRateKnown': False, 'taxBreakdownKnown': False,
            'returnWindowMode': 'deliveryDays', 'returnWindowDays': 3, 'refundEnabled': False, 'publicTermsMatchSql': True}


def configuration_select():
    from local_shop_ops import sql
    query = """SELECT
 JSON_QUERY((SELECT ReservationMinutes reservationMinutes,MaxOpenOrdersPerCustomer maxOpenOrdersPerCustomer FROM sales.CheckoutOrderSettings WHERE Id=1 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) settings,
 JSON_QUERY((SELECT ShippingMode shippingMode,ShippingFeeRial shippingFeeRial,ShippingFreeFromRial shippingFreeFromRial,TaxMode taxMode,TaxRateBasisPoints taxRateBasisPoints FROM sales.CheckoutChargePolicies WHERE Id=1 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) charges,
 JSON_QUERY((SELECT TOP(1) Enabled enabled,PhysicalReturns physicalReturns,DigitalComplaints digitalComplaints,WindowMode windowMode,WindowDays windowDays,CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),ConditionsFa)),2) conditionsFaHash,CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),ConditionsEn)),2) conditionsEnHash FROM sales.RmaPolicyRevisions ORDER BY Revision DESC FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) [returns]
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES;"""
    return strict_json(''.join(sql(query, timeout=20).splitlines()).strip().encode('utf-8'))


def verify(proof, timeout, backend_path, configured=False, frontend_path=None, build_path=None):
    frontend_path = frontend_path or workspace_path(DEFAULT_FRONTEND, CHECKS)
    build_path = build_path or workspace_path(DEFAULT_BUILD, ROOT / 'tmp')
    backend_path, accepted, frozen_path = legacy.backend_acceptance(backend_path)
    require(accepted.get('status') == 'backend-frozen-targeted-accepted'
            and all(accepted.get(key) is True for key in ('commerceChargePolicyAccepted', 'privateReturnRequestsAccepted', 'privateAdminHeadersAccepted', 'physicalFulfillmentCapacityAccepted', 'customerLoginContinuityAccepted'))
            and accepted.get('unit', {}).get('total', 0) >= 1486, 'Explicit accepted D60 backend evidence is required.')
    tracked = [*DESCRIPTORS.values(), AGGREGATE, backend_path, frozen_path, frontend_path, build_path, Path(__file__).resolve(), Path(legacy.__file__), ROOT / 'scripts/local_shop_ops.py']
    before = {str(path.relative_to(ROOT)): sha(path) for path in tracked}
    states = {name: read(path) for name, path in DESCRIPTORS.items()}; aggregate = read(AGGREGATE)
    release_states(states, aggregate)
    publication_path, frontend_proof = frontend_evidence(states, aggregate, frontend_path, build_path)
    tracked.append(publication_path); before[str(publication_path.relative_to(ROOT))] = sha(publication_path)
    proof['frontendAcceptance'] = frontend_proof
    artifacts = {name: legacy.manifest(state, name) for name, state in states.items()}
    identities = {name: process_identity(name, state) for name, state in states.items()}
    proof['backendParity'] = backend_evidence(states['api'], artifacts['api'][0], backend_path, publication_path)
    proof['descriptors'] = {name: {'path': str(DESCRIPTORS[name].relative_to(ROOT)), 'sha256': before[str(DESCRIPTORS[name].relative_to(ROOT))], **artifacts[name][2]} for name in PORTS}
    proof['processes'] = identities
    records = proof['httpChecks']
    def request(name, path, status=200, private=False, digest=None):
        record, body = legacy.get(name, path, status, timeout, private, digest, records)
        require(not record.get('setCookiePresent') and not record['headers'].get('set-cookie'), 'An anonymous canonical GET attempts to set a cookie.')
        if private: private_response(record, body)
        return record, body
    request('api', '/health/live')
    require(strict_json(request('api', '/health/ready')[1]).get('status') == 'ready', 'Canonical readiness is not ready.')
    asset_urls = {'storefront': set(), 'admin': set()}
    for locale in ('fa', 'en'):
        strict_json(request('api', '/api/storefront/' + locale + '?metadataOnly=true')[1])
        for path in ('/' + locale, '/' + locale + '/support', '/' + locale + '/account', '/' + locale + '/addresses'):
            parser = Assets('storefront'); parser.feed(request('storefront', path)[1].decode('utf-8', errors='strict')); asset_urls['storefront'].update(parser.paths)
    _, index = request('admin', '/', digest=artifacts['admin'][1]['index.html'])
    parser = Assets('admin'); parser.feed(index.decode('utf-8', errors='strict')); asset_urls['admin'].update(parser.paths)
    policies = [public_policy(*request(name, '/api/returns/policy')) for name in ('api', 'storefront')]
    require(policies[0] == policies[1], 'API and storefront public RMA policy differ.')
    proof['publicRmaPolicy'] = {key: policies[0][key] for key in ('configured', 'enabled', 'physicalReturns', 'digitalComplaints', 'windowMode', 'windowDays', 'canRefund', 'refundAvailability')}
    for name in ('api', 'storefront'):
        for path in CUSTOMER_RMA_READS: request(name, path, 401, True)
    for name in ('api', 'admin'):
        for path in ADMIN_RMA_READS: request(name, path, 401, True)
    retained = {'api': ('/api/account/profile', '/api/orders/' + ID + '/fulfillment/digital', '/api/orders/v2/' + ID + '/fulfillment/digital', '/api/admin/orders/' + ID + '/' + ID + '/fulfillment/digital', '/api/admin/used-items/variants', '/api/admin/used-items/' + ID),
                'storefront': ('/api/account/profile', '/api/addresses', '/api/orders/v2/' + ID + '/fulfillment/digital'),
                'admin': ('/api/auth/me', '/api/admin/orders/' + ID + '/' + ID + '/fulfillment/digital', '/api/admin/used-items/variants', '/api/admin/used-items/' + ID)}
    for name, paths in retained.items():
        for path in paths: request(name, path, 401, True)
    proof['assets'] = {}
    for name in asset_urls:
        require(asset_urls[name], 'A canonical public entry references no immutable frontend assets.')
        retained_urls, retained_count = retained_assets(name, states[name], artifacts[name][1])
        urls = {url: artifacts[name][1].get(asset_entry(name, states[name], url)) for url in asset_urls[name]}
        require(all(urls.values()), 'A public entry references assets outside its current complete manifest.')
        for url, digest in {**urls, **retained_urls}.items(): request(name, url, digest=digest)
        proof['assets'][name] = {'entryAssetUrlsVerified': len(urls), 'retainedPathsManifestExact': retained_count, 'retainedAssetHttpSamples': sorted(retained_urls), 'allRetainedUrlsHttpRequested': False}
    proof['sqlShape'] = legacy.sql_shape(88, 229)
    proof['readyPublicImages'] = legacy.ready_public_image_smoke(timeout, records)
    require(all(not record.get('setCookiePresent') and not record['headers'].get('set-cookie') for record in records), 'An anonymous canonical resource attempted to set a cookie.')
    if configured: proof['configuredOwnerPolicy'] = configured_policy(policies[0], configuration_select())
    else: proof['configuredOwnerPolicy'] = {'asserted': False, 'status': 'not-asserted; public configured flag above is the observed state'}
    after = {str(path.relative_to(ROOT)): sha(path) for path in tracked}
    require(before == after, 'Descriptors, aggregate, accepted backend or verifier helpers changed during the read-only run.')
    for name, state in states.items():
        legacy.manifest(state, name)
        require(process_identity(name, state) == identities[name], 'A canonical process identity changed during verification.')
    require(backend_evidence(states['api'], artifacts['api'][0], backend_path, publication_path) == proof['backendParity'],
            'Current D60 backend evidence changed during verification.')
    require(frontend_evidence(states, aggregate, frontend_path, build_path)[1] == frontend_proof,
            'Frontend acceptance, source or its published build changed during verification.')
    require(legacy.sql_shape(88, 229) == proof['sqlShape'], 'Canonical SQL shape changed during verification.')
    require(all(public_policy(*request(name, '/api/returns/policy')) == policies[0] for name in ('api', 'storefront')),
            'Public RMA policy changed during verification.')
    if configured:
        require(configured_policy(policies[0], configuration_select()) == proof['configuredOwnerPolicy'],
                'Owner-approved configuration changed during verification.')
    proof.update(passed=True, status='passed', completedAtUtc=stamp(), httpCheckCount=len(records), currentDescriptorsUnchanged=True,
                 runtimeArtifactsUnchanged=True, processIdentitiesUnchanged=True, sqlShapeUnchanged=True,
                 helperSourceSha256={key: value for key, value in before.items() if key.startswith('scripts/')})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='A new JSON proof below artifacts/checks; never overwritten.')
    parser.add_argument('--timeout-seconds', type=int, default=15)
    parser.add_argument('--backend-acceptance', default=DEFAULT_BACKEND)
    parser.add_argument('--frontend-acceptance', default=DEFAULT_FRONTEND)
    parser.add_argument('--frontend-build', default=DEFAULT_BUILD)
    parser.add_argument('--configured-policy', action='store_true', help='Also assert the owner-approved2/60/postpaid/unitemized/3day settings using only scoped SELECTs.')
    args = parser.parse_args(); require(1 <= args.timeout_seconds <= 20, 'Timeout must be between1and20seconds.')
    output = workspace_path(args.output, CHECKS); backend = workspace_path(args.backend_acceptance, CHECKS)
    frontend = workspace_path(args.frontend_acceptance, CHECKS); build = workspace_path(args.frontend_build, ROOT / 'tmp')
    require(output.suffix == '.json' and output.parent.is_dir() and not output.exists(), 'Proof requires a new JSON file in an existing artifacts/checks directory.')
    proof = {'schemaVersion': 1, 'release': 'D60-commerce-rma88', 'passed': False, 'status': 'running', 'startedAtUtc': stamp(),
             'httpChecks': [], 'readOnly': True, 'requestMethods': ['GET'], 'cookiesOrTokensSent': False, 'authenticationPerformed': False,
             'businessWritesPerformed': False, 'providersActivated': False, 'listenersStarted': False, 'browserOperated': False,
             'configuredPolicyRequested': args.configured_policy, 'authenticatedRmaBrowserAccepted': False, 'fullProjectComplete': False}
    code = 0
    try: verify(proof, args.timeout_seconds, backend, args.configured_policy, frontend, build)
    except Exception as error:
        proof.update(status='failed', failedAtUtc=stamp(), failureType=type(error).__name__,
                     failure=str(error) if isinstance(error, VerificationError) else 'A bounded local read-only check failed; private/configuration details are omitted.'); code = 1
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(proof, stream, ensure_ascii=False, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    print(json.dumps({'passed': proof['passed'], 'httpChecks': len(proof['httpChecks']), 'proof': str(output.relative_to(ROOT))}))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
