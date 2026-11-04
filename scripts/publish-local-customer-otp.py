"""Guarded D67 canonical Sayman API upgrade,88/229 to89/232; imports are inert.

Prepare only packages accepted offline bytes and a private plan. Explicit apply
stops only the proved API5080 owner, verifies COPY_ONLY/CHECKSUM backup bytes,
then invokes the packaged --migrate-customer-otp command. No generic migration,
search repair, seed, CMS/settings write, key activation, SMS or authentication is
performed. Frontends remain selected and running. Once migration is invoked,
only compatible89 forward recovery is allowed; never SQL Down/restore or API88.
"""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import time
import uuid


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


prior = load('customer_otp_d66', 'publish-local-image-library.py')
rma, ops, photo, runner = prior.rma, prior.ops, prior.photo, prior.runner
ROOT, CHECKS, CURRENT, AGGREGATE = prior.ROOT, prior.CHECKS, prior.CURRENT, prior.AGGREGATE
BASELINE = CHECKS / 'image-library-backend/acceptance.json'
ACCEPTANCE = CHECKS / 'customer-otp-backend/acceptance.json'
KIND = 'customer-otp-canonical89-plan'
MIGRATION = '20261031172618_CustomerSmsOtp'
MIGRATION_SOURCE = 'backend/src/Shop.Api/Migrations/Identity/' + MIGRATION + '.cs'
NORMALIZED_TEMP = '#Sayman_CustomerSmsOtp_20261031172618'
NEW_TABLES = {'identity.' + name for name in ('CustomerSmsSettings', 'CustomerSmsSettingsCommands', 'CustomerOtpChallenges')}
CHANGED_TABLE = 'identity.AspNetUsers'
SQL_CLASSES = {'Shop.SqlTests.' + name for name in ('CustomerOtpSqlTests', 'CustomerOtpHttpSqlTests',
    'CustomerLoginContinuitySqlTests', 'AuthSessionSecuritySqlTests', 'MfaRecoverySqlTests', 'CommerceRmaSchemaSqlTests')}
SCHEMA_CLASS = 'Shop.SqlTests.CustomerOtpMigrationSqlTests'
MIN_UNIT = 1700
CLEANUP_ZERO = prior.CLEANUP_ZERO
ALLOWED = {
    'backend/src/Shop.Api/Filters/AdminAuditFilter.cs', 'backend/src/Shop.Api/Mapping/CustomerOtpHttpErrors.cs',
    'backend/src/Shop.Api/Services/CustomerOtpPolicyReader.cs', 'backend/src/Shop.Api/Security/CustomerOtpProtection.cs',
    'backend/src/Shop.Api/Endpoints/CustomerSmsEndpoints.cs', 'backend/src/Shop.Api/Program.cs',
    'backend/src/Shop.Api/Integrations/SmsIrVerifyGateway.cs',
    'backend/src/Shop.Api/Migrations/Identity/20261031172618_CustomerSmsOtp.cs',
    'backend/src/Shop.Api/Migrations/Identity/20261031172618_CustomerSmsOtp.Designer.cs',
    'backend/src/Shop.Api/Migrations/Identity/IdentityDbContextModelSnapshot.cs',
    'backend/src/Shop.Modules.Cms/Persistence/Content.cs', 'backend/src/Shop.Modules.Cms/Domain/CustomerAuthSettingsRules.cs',
    'backend/src/Shop.Modules.Identity/Services/CustomerLoginContinuity.cs', 'backend/src/Shop.Modules.Identity/Persistence/Identity.cs',
    'backend/src/Shop.Modules.Identity/Contracts/CustomerOtpContracts.cs', 'backend/src/Shop.Modules.Identity/Persistence/CustomerOtpModel.cs',
    'backend/src/Shop.Modules.Identity/Services/CustomerOtpService.cs', 'backend/src/Shop.Modules.Identity/Services/CustomerSmsSettingsService.cs',
    'backend/src/Shop.SharedKernel/Contracts/Identity/CustomerOtpSms.cs', 'backend/src/Shop.SharedKernel/Contracts/Identity/CustomerSmsSettings.cs',
    'backend/src/Shop.SharedKernel/Contracts/Identity/ICustomerLoginContinuity.cs',
    'backend/tests/Shop.SqlTests/CustomerOtpSqlTests.cs', 'backend/tests/Shop.SqlTests/CustomerOtpHttpSqlTests.cs',
    'backend/tests/Shop.SqlTests/CommerceRmaSchemaSqlTests.cs',
    'backend/tests/Shop.SqlTests/CustomerLoginContinuitySqlTests.cs',
    'backend/tests/Shop.Tests/CmsReferenceAndAuthTests.cs', 'backend/tests/Shop.Tests/CustomerOtpProtectionTests.cs',
    'backend/tests/Shop.Tests/CustomerOtpRulesTests.cs', 'backend/tests/Shop.Tests/SmsIrVerifyGatewayTests.cs',
    'backend/tests/Shop.Tests/AuthorizationTests.cs',
}
SCHEMA_SOURCE = 'backend/tests/Shop.SqlTests/CustomerOtpMigrationSqlTests.cs'
MIGRATE_FLAG = '--migrate-customer-otp'


def require(value, message): ops.require(value, message)
def stamp(): return datetime.now(timezone.utc).isoformat()
def relative(path): return str(path.relative_to(ROOT))
def table_map(rows): return rma.table_map(rows)
def histories(rows): return rma.histories(rows)


def current_d66(state):
    prior.compatible88(state)
    baseline = ops.read(BASELINE)
    modules = baseline['frozen']['module14parity']
    require(baseline.get('passed') is True and baseline.get('schemaChanges') == 0
        and len(modules) == 14 and all(set(values) == {'api', 'unit', 'sql'} and len(set(values.values())) == 1 for values in modules.values())
        and state.get('imageLibraryApiAccepted') is True
        and state.get('imageLibraryBackendEvidence') == relative(BASELINE)
        and state.get('moduleSha256') == {name: values['api'] for name, values in modules.items()},
        'Only the exact accepted finalized D66 API88 may be the starting runtime.')


def aggregate88(state):
    prior.aggregate88(state)
    require(state.get('imageLibraryApiAccepted') is True, 'The aggregate must include the accepted D66 library.')


def helpers():
    values = rma.helper_hashes()
    for name in ('publish-local-image-library.py', 'test_publish_local_image_library.py',
                 'publish-local-customer-otp.py', 'test_publish_local_customer_otp.py'):
        file = ROOT / 'scripts' / name; values[relative(file)] = ops.sha(file)
    values[relative(BASELINE)] = ops.sha(BASELINE)
    values[MIGRATION_SOURCE] = ops.sha(ROOT / MIGRATION_SOURCE)
    return values


def validate_contract(contract, frozen, names):
    require(contract.get('schemaVersion') == 1 and contract.get('status') == 'disposable-schema89-accepted'
        and contract.get('sourceMigrationCount') == 89 and contract.get('frozen') == frozen
        and set(table_map(contract['newTablesMetadata'])) == NEW_TABLES
        and set(table_map(contract['changedTablesMetadata'])) == {CHANGED_TABLE}
        and contract.get('metadataSqlSource') == {'path': 'scripts/publish-local-commerce-rma.py',
            'sqlStringSha256': hashlib.sha256(rma.METADATA_SQL.encode()).hexdigest()}
        and isinstance(contract.get('testResultName'), str)
        and contract['testResultName'].startswith(SCHEMA_CLASS + '.')
        and Counter(names)[contract['testResultName']] == 1,
        'Exact portable schema89 metadata must come from its passing complete SQL schema class and frozen source.')
    for row in contract['newTablesMetadata'] + contract['changedTablesMetadata']:
        require(all(isinstance(row.get(key), list) for key in ('columns', 'indexes', 'foreignKeys', 'checks'))
            and row['columns'] and row['indexes'], 'Portable metadata arrays must be explicit and complete.')


def acceptance():
    accepted = ops.read(ACCEPTANCE)
    require(accepted.get('passed') is True and accepted.get('schemaChanges') == 1,
        'Fresh schema-changing D67 backend acceptance is required.')
    frozen = runner.freeze('Debug')
    require(frozen == accepted['frozen'], 'Source, test assemblies or14module parity changed after acceptance.')
    baseline = ops.read(BASELINE)
    require(baseline.get('passed') is True and baseline.get('schemaChanges') == 0,
        'The accepted D66 source baseline is required.')
    old, now = baseline['frozen']['sourceSha256'], frozen['sourceSha256']
    delta = {name for name in set(old) | set(now) if old.get(name) != now.get(name)}
    selected = set(accepted['sql']['classes'])
    require(selected == SQL_CLASSES | {SCHEMA_CLASS}
        and set(accepted['sqlClassesExpected']) == selected and accepted['sql'].get('exactDiscoveryCounter') is True,
        'Only the complete pinned OTP/HTTP/continuity/session/MFA SQL classes may be selected.')
    require(SCHEMA_CLASS in selected and delta == ALLOWED | {SCHEMA_SOURCE},
        'The schema fact and exact reviewed D67 source delta are required; no unrelated source changes.')
    modules = frozen['module14parity']
    require(set(modules) == set(baseline['frozen']['module14parity']) and len(modules) == 14
        and all(set(values) == {'api', 'unit', 'sql'} and len(set(values.values())) == 1 for values in modules.values()),
        'All fourteen product modules must have actual API/unit/SQL byte parity.')
    for key in ('build', 'unit', 'sql', 'cleanup'):
        record = accepted[key]; file = rma.owned_path(record['path'])
        require(record['exitCode'] == 0 and ops.sha(file) == record['sha256'], 'Accepted check record changed or failed.')
        if key in ('unit', 'sql'):
            names = ops.accepted_trx(file, record['passed'])
            require(Counter(names) == Counter(record['names']), 'Actual passing TRX differs from accepted names.')
            if key == 'sql':
                require({name.split('(')[0].rsplit('.', 1)[0] for name in names} == selected,
                    'Actual SQL TRX is missing a whole selected class or includes an unexpected class.')
        if key == 'cleanup':
            require(file.read_text().strip() == CLEANUP_ZERO, 'Disposable SQL cleanup must be proved zero.')
    require(accepted['unit']['passed'] >= MIN_UNIT and accepted['sql']['passed'] >= len(selected),
        'Complete unit and all pinned SQL classes are required.')
    record = accepted['sqlDiscovery']; file = rma.owned_path(record['path'])
    require(record['exitCode'] == 0 and ops.sha(file) == record['sha256'], 'SQL discovery changed.')
    discovered = ops.read(file)
    require(set(discovered['selectedClasses']) == selected and type(discovered['allCases']) is int
        and discovered['allCases'] >= len(discovered['selected']) >= len(selected)
        and {name.split('(')[0].rsplit('.', 1)[0] for name in discovered['selected']} == selected
        and Counter(discovered['selected']) == Counter(accepted['sql']['names']),
        'Discovery and TRX must match every actual case in all complete selected SQL classes.')
    contract_record = accepted['schemaContract']; file = rma.owned_path(contract_record['path'])
    require(ops.sha(file) == contract_record['sha256'], 'Schema contract evidence changed.')
    validate_contract(ops.read(file), frozen, accepted['sql']['names'])
    return accepted


def source_migrations():
    values = set()
    for file in (ROOT / 'backend/src/Shop.Api/Migrations').rglob('*.cs'):
        for name in re.findall(r'\[Migration\("([0-9A-Za-z_]+)"\)\]', file.read_text()):
            item = (file.parent.name.lower(), name)
            require(item not in values, 'Duplicate source migration.'); values.add(item)
    require(len(values) == 89 and ('identity', MIGRATION) in values, 'Exactly the frozen89 source migrations are required.')
    return values


def shape():
    value = rma.payload('SELECT (SELECT SUM(n) FROM (' + ' UNION ALL '.join(
        'SELECT COUNT_BIG(*) n FROM [' + name + '].__EFMigrationsHistory' for name in ops.SCHEMAS)
        + ') h) migrationCount,(SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0) tableCount FOR JSON PATH,WITHOUT_ARRAY_WRAPPER')
    require(value in ({'migrationCount': 88, 'tableCount': 229}, {'migrationCount': 89, 'tableCount': 232}),
        'Unexpected canonical schema; preserve state and recover forward only.')
    return value


def canonical_queries():
    """Derive the read-only projection from the exact reviewed migration SQL.

    No customer values leave SQL: only count/hash/collision count are returned.
    The sole change to its normalization fragment is removing the transaction
    table-lock hint. The transaction assertion, collision THROW and UPDATE are
    outside the extracted fragment and are never run by the read-only probe.
    """
    source = (ROOT / MIGRATION_SOURCE).read_bytes()
    blocks = re.findall(r'migrationBuilder\.Sql\("""(.*?)"""\);', source.decode('utf-8-sig'), re.S)
    require(len(blocks) == 1, 'Exactly one reviewed canonical-normalization SQL block is required.')
    raw = blocks[0]
    begin = raw.find('DECLARE @TrimCharacters nvarchar(32)=')
    ends = list(re.finditer(r'(?m)^\s*IF EXISTS\s*$', raw))
    require(begin >= 0 and len(ends) == 1 and begin < ends[0].start(), 'Canonical migration normalization boundaries changed.')
    original = raw[begin:ends[0].start()].rstrip()
    hint = 'WITH (TABLOCKX,HOLDLOCK)'
    require(original.count(hint) == 1 and original.count('INTO ' + NORMALIZED_TEMP) == 1
        and original.count(';WITH Normalized AS') == 1 and original.endswith(');'),
        'The exact migration CTE/temp projection changed.')
    normalized = original.replace(hint, '')
    require(not re.search(r'\b(?:UPDATE|DELETE|INSERT|ALTER|DROP|THROW|TABLOCKX|HOLDLOCK)\b|@@TRANCOUNT', normalized, re.I),
        'The canonical expected-value probe must not contain business writes or migration locks.')
    expected = normalized + '\n' + f"""
SELECT (SELECT COUNT_BIG(*) FROM {NORMALIZED_TEMP}) [count],
 CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),
 COALESCE((SELECT [Id],[Canonical] AS [CanonicalPhone] FROM {NORMALIZED_TEMP}
 ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]'))),2) [sha256],
 (SELECT COUNT_BIG(*) FROM (SELECT [Canonical] FROM {NORMALIZED_TEMP}
 GROUP BY [Canonical] HAVING COUNT_BIG(*)>1) collisions) [collisionCount]
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;"""
    actual = """
DECLARE @projection nvarchar(max)=N'[]',@count bigint=0;
IF COL_LENGTH(N'identity.AspNetUsers',N'CanonicalPhone') IS NOT NULL
 EXEC sys.sp_executesql N'SELECT @n=COUNT_BIG(*) FROM [identity].[AspNetUsers] WHERE [CanonicalPhone] IS NOT NULL;
 SELECT @json=(SELECT [Id],[CanonicalPhone] FROM [identity].[AspNetUsers] WHERE [CanonicalPhone] IS NOT NULL
 ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES);',
 N'@n bigint OUTPUT,@json nvarchar(max) OUTPUT',@n=@count OUTPUT,@json=@projection OUTPUT;
SELECT @count [count],CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),COALESCE(@projection,N'[]'))),2) [sha256]
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;"""
    provenance = {'migrationSource': MIGRATION_SOURCE, 'migrationSourceSha256': hashlib.sha256(source).hexdigest(),
        'normalizerSqlSha256': hashlib.sha256(original.encode()).hexdigest(),
        'expectedSqlSha256': hashlib.sha256(expected.encode()).hexdigest(), 'actualSqlSha256': hashlib.sha256(actual.encode()).hexdigest()}
    return {'provenance': provenance, 'expectedSql': expected, 'actualSql': actual}


def binding_summary(value, expected=False):
    keys = {'count', 'sha256'} | ({'collisionCount'} if expected else set())
    require(isinstance(value, dict) and set(value) == keys and type(value['count']) is int and value['count'] >= 0
        and isinstance(value['sha256'], str) and re.fullmatch('[a-fA-F0-9]{64}', value['sha256'])
        and (not expected or type(value['collisionCount']) is int and 0 <= value['collisionCount'] <= value['count']),
        'Canonical binding evidence must contain only valid count/digest and optional collision count.')
    return value


def validate_bindings(before, after=None):
    queries = canonical_queries()
    require(isinstance(before, dict) and set(before) == {'provenance', 'expected', 'actual'}
        and before['provenance'] == queries['provenance'], 'Canonical binding evidence is not bound to the reviewed migration/query bytes.')
    expected = binding_summary(before['expected'], expected=True)
    binding_summary(before['actual'])
    require(expected['collisionCount'] == 0 and before['actual']['count'] == 0,
        'Canonical mobile collision or unexpected existing binding; review existing account contacts before migration.')
    if after is not None:
        require(isinstance(after, dict) and set(after) == {'provenance', 'expected', 'actual'}
            and after['provenance'] == before['provenance'] and binding_summary(after['expected'], expected=True) == expected
            and binding_summary(after['actual']) == {key: expected[key] for key in ('count', 'sha256')},
            'Canonical bindings differ from the exact expected pre-migration legacy-contact projection.')


def database_snapshot():
    value = rma.snapshot(); value.pop('atUtc', None)
    needle = 'FROM sys.columns WHERE object_id=@object;'
    require(rma.FINGERPRINT_SQL.count(needle) == 1, 'Original whole-table fingerprint contract changed.')
    value['tables'] = rma.payload(rma.FINGERPRINT_SQL.replace(needle,
        "FROM sys.columns WHERE object_id=@object AND NOT (@schema=N'identity' AND @table=N'AspNetUsers' AND name=N'CanonicalPhone');"))
    value['metadata'] = rma.payload(rma.METADATA_SQL)
    queries = canonical_queries()
    value['canonicalBindings'] = {'provenance': queries['provenance'],
        'expected': binding_summary(rma.payload(queries['expectedSql']), expected=True),
        'actual': binding_summary(rma.payload(queries['actualSql']))}
    return value


def pending(before):
    require(before.get('database') == 'Sayman' and len(table_map(before['tables'])) == len(table_map(before['metadata'])) == 229
        and all(column['name'] != 'CanonicalPhone' for column in table_map(before['metadata'])[CHANGED_TABLE]['columns']),
        'The whole original229-table snapshot without the new user column is required.')
    validate_bindings(before['canonicalBindings'])
    applied = {(row['schema'], row['MigrationId']) for row in before['histories']}
    require(len(applied) == 88 and source_migrations() - applied == {('identity', MIGRATION)}
        and applied <= source_migrations(), 'Only the one reviewed Identity migration may be pending.')


def canonical_column(column, ordinal):
    wanted = {'name': 'CanonicalPhone', 'column_id': ordinal, 'system_type_id': 167, 'user_type_id': 167,
        'max_length': 13, 'precision': 0, 'scale': 0, 'is_nullable': True, 'collation_name': 'Latin1_General_100_BIN2',
        'is_identity': False, 'is_computed': False, 'computedDefinition': None, 'defaultDefinition': None}
    require(column == wanted, 'The sole appended user column must be nullable varchar13 BIN2 without default or computation.')


def portable_user_metadata(row):
    # SQL allocates the appended index ID from local free slots. Only that new
    # index's numeric allocation is nonportable; every semantic field and every
    # pre-existing index ID still compare exactly below against the stopped DB.
    return {**row, 'indexes': [{**index, 'index_id': 0}
        if index.get('name') == 'IX_AspNetUsers_CanonicalPhone' else index for index in row['indexes']]}


def preserved_database(before, after, contract):
    require(before.get('database') == after.get('database') == 'Sayman', 'Only canonical Sayman may be compared.')
    old, new = table_map(before['tables']), table_map(after['tables'])
    require(len(old) == 229 and len(new) == 232 and set(new) - set(old) == NEW_TABLES
        and set(old) <= set(new) and all(new[name]['count'] == 0 for name in NEW_TABLES),
        'Only the three new initially-empty Identity OTP tables may be added.')
    require(all(new.get(name) == row for name, row in old.items() if name != 'identity.__EFMigrationsHistory'),
        'An original value, rowversion, JSON or table changed; only CanonicalPhone is excluded from the user projection.')
    a, b = histories(before['histories']), histories(after['histories'])
    require(len(a) == 88 and len(b) == 89 and a <= b and b - a == {('identity', MIGRATION, '10.0.12')},
        'Only the exact one new Identity history row may differ.')
    require(before['configuration'] == after['configuration'], 'Private configuration/key hashes changed.')
    validate_bindings(before['canonicalBindings'], after['canonicalBindings'])
    old_meta, new_meta = table_map(before['metadata']), table_map(after['metadata'])
    require(set(old_meta) == set(old) and set(new_meta) == set(new), 'All original and new metadata tables must be present once.')
    approved = table_map(contract['newTablesMetadata'] + contract['changedTablesMetadata'])
    require(set(approved) == NEW_TABLES | {CHANGED_TABLE}, 'Unexpected accepted metadata table allowlist.')
    for name in NEW_TABLES:
        require(new_meta[name] == approved[name], 'New table metadata differs from accepted disposable89.')
    for name, row in old_meta.items():
        current = new_meta[name]
        if name != CHANGED_TABLE:
            require(current == row, 'Unrelated original metadata changed.'); continue
        require(portable_user_metadata(current) == portable_user_metadata(approved[name])
            and row['foreignKeys'] == current['foreignKeys'] and row['checks'] == current['checks'],
            'User metadata must match accepted89 and preserve all existing FKs and CHECKs.')
        columns = {item['name']: item for item in row['columns']}
        added = {item['name']: item for item in current['columns']}
        require(len(columns) == len(row['columns']) and len(added) == len(current['columns'])
            and 'CanonicalPhone' not in columns and set(added) - set(columns) == {'CanonicalPhone'}
            and all(added.get(key) == value for key, value in columns.items()), 'An old user column changed or an unapproved column was added.')
        canonical_column(added['CanonicalPhone'], max(item['column_id'] for item in columns.values()) + 1)
        indices = [item for item in current['indexes'] if item['name'] == 'IX_AspNetUsers_CanonicalPhone']
        require(len(indices) == 1 and [item for item in current['indexes'] if item['name'] != 'IX_AspNetUsers_CanonicalPhone'] == row['indexes'],
            'Only the canonical phone index may be added; existing indexes must be byte-identical metadata.')
        index = indices[0]; wanted = {'name': 'IX_AspNetUsers_CanonicalPhone', 'index_id': index['index_id'],
            'type': 2, 'is_unique': True, 'is_primary_key': False, 'is_unique_constraint': False,
            'has_filter': True, 'filter_definition': index['filter_definition'], 'is_disabled': False,
            'index_column_id': 1, 'columnName': 'CanonicalPhone', 'key_ordinal': 1,
            'is_descending_key': False, 'is_included_column': False}
        require(index == wanted and type(index['index_id']) is int and index['index_id'] > 0
            and isinstance(index['filter_definition'], str)
            and re.sub(r'[\s()\[\]]', '', index['filter_definition']).lower() == 'canonicalphoneisnotnull'
            and index['index_id'] not in {item['index_id'] for item in row['indexes']},
            'The new user index must be enabled, unique and filtered on the sole canonical-phone key.')


def descriptor_hashes(): return {name: ops.sha(path) for name, path in rma.DESCRIPTORS.items()}


def runtime(state):
    require(state.get('api') == ops.API_URL and state.get('sourceMigrationCount') == state.get('databaseMigrationCount')
        and (state['databaseMigrationCount'], state.get('tableCount')) in ((88, 229), (89, 232)), 'Unexpected canonical API descriptor.')
    directory, _, _ = rma.verify.manifest(state, 'api')
    require(len(state['moduleSha256']) == 14 and all(Path(name).name == name and ops.sha(directory / name) == digest
        for name, digest in state['moduleSha256'].items()), 'Selected API module hashes changed.')
    return directory


def owned_process(state):
    directory = runtime(state); pid = state.get('apiPid')
    require(ops.read(CURRENT) == state, 'The selected API descriptor changed before process inspection.')
    require(type(pid) is int and pid > 1 and rma.listener('api') == pid, 'Selected API PID/listener differs.')
    command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True, timeout=10).strip()
    cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True, timeout=10).splitlines()
    started = subprocess.check_output(['ps', '-p', str(pid), '-o', 'lstart='], text=True, timeout=10).strip()
    require(command == 'dotnet ' + str(directory / 'Shop.Api.dll') and 'n' + str(ROOT) in cwd and started,
        'Exact API command/cwd/start identity differs from the selected artifact.')
    return {'pid': pid, 'command': command, 'started': started}


def stop_owned(state, expected):
    require(owned_process(state) == expected, 'API ownership changed immediately before stop.')
    os.kill(expected['pid'], signal.SIGTERM); deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if rma.listener('api') is None:
            try: os.kill(expected['pid'], 0)
            except ProcessLookupError: return
        time.sleep(.25)
    raise ops.PublishError('Owned API did not stop; no forced termination or migration is allowed.')


class KnownStoppedStartup(ops.PublishError):
    """The publisher's exact selected child exited; its descriptor is proved."""
    def __init__(self, selected, pid):
        super().__init__('The selected API child stopped before readiness; only proved compatible recovery may retry.')
        self.selected = dict(selected)
        self.child_pid = pid


def start_selected(state, log):
    require(rma.listener('api') is None, 'Existing listener prevents a second API startup.')
    runtime(state); ops.write(CURRENT, state)
    with log.open('ab') as stream:
        child = subprocess.Popen(['python3', 'scripts/serve-main-api.py'], cwd=ROOT, stdout=stream, stderr=stream, start_new_session=True)
    try:
        for attempt in range(80):
            try:
                active = ops.read(CURRENT); checks = [ops.request(path, 200, require_no_store=True)[0] for path in ('/health/ready', '/health/live')]
                identity = owned_process(active)
                require(identity['pid'] == child.pid, 'The listener is not the child selected by this publisher.')
                return active, checks, identity
            except Exception:
                if child.poll() is not None or attempt == 79: raise
                time.sleep(.25)
    except Exception:
        if child.poll() is None:
            try: child.terminate(); child.wait(timeout=15)
            except ProcessLookupError: pass
            except Exception: raise rma.OwnedStartupIncomplete('Child termination is unproved; never start a second API.') from None
        # serve-main-api may already have written this child's PID even when
        # readiness failed. Hand off only a descriptor that exactly matches our
        # candidate, and only after the original child has provably terminated.
        selected = ops.read(CURRENT)
        if child.poll() is not None and rma.listener('api') is None and selected in (state, {**state, 'apiPid': child.pid}):
            raise KnownStoppedStartup(selected, child.pid) from None
        raise rma.OwnedStartupIncomplete('Stopped child descriptor or listener changed; preserve the unknown selection.') from None


def package_delta(before, after, modules):
    require(set(before) == set(after), 'API dependencies or file set changed.')
    changed = {name for name in after if after[name] != before[name]}
    allowed = set(modules) | {name[:-4] + '.pdb' for name in modules}
    require(changed and changed <= allowed, 'Only the accepted fourteen product DLL/PDB bytes may change.')
    return changed


def prepare():
    accepted = acceptance(); previous = ops.read(CURRENT); current_d66(previous)
    aggregate88(ops.read(AGGREGATE))
    require(shape() == {'migrationCount': 88, 'tableCount': 229}, 'Prepare requires the canonical88/229 baseline.')
    old = runtime(previous); files = photo.tree(ops.API_BIN)
    changed = package_delta(photo.tree(old), files, accepted['frozen']['module14parity'])
    run = uuid.uuid4().hex; directory = ROOT / ('tmp/api-runtime-customer-otp-' + run)
    require(not directory.exists(), 'Candidate package already exists.')
    photo.measured_space(); shutil.copytree(ops.API_BIN, directory)
    require(photo.tree(directory) == files, 'Offline candidate copy differs from accepted API bytes.')
    manifest = CHECKS / ('customer-otp-api-' + run + '-manifest.json')
    require(not manifest.exists(), 'Candidate manifest already exists.'); ops.write(manifest, {'algorithm': 'SHA-256', 'files': files})
    return {'kind': KIND, 'run': run, 'accepted': accepted, 'helpers': helpers(), 'previous': previous,
        'process': owned_process(previous), 'descriptors': descriptor_hashes(), 'aggregateSha256': ops.sha(AGGREGATE),
        'preservedFiles': photo.preserved_files(), 'runtimeDirectory': relative(directory),
        'artifactManifest': relative(manifest), 'artifactManifestSha256': ops.sha(manifest),
        'apiFiles': files, 'changedFiles': sorted(changed), 'preparedAtUtc': stamp()}


def candidate(plan, report):
    previous = plan['previous']; prior.compatible88(previous)
    accepted = plan['accepted']
    return {**previous, 'runtimeDirectory': plan['runtimeDirectory'], 'previousRuntimeDirectory': previous['runtimeDirectory'],
        'artifactManifest': plan['artifactManifest'], 'artifactManifestSha256': plan['artifactManifestSha256'],
        'moduleSha256': {name: values['api'] for name, values in accepted['frozen']['module14parity'].items()},
        'apiPid': None, 'sourceMigrationCount': 89, 'databaseMigrationCount': 89, 'tableCount': 232,
        'slice': 'D67 customer SMS OTP and private settings', 'codeOnly': False, 'newMigrations': 1, 'newTables': 3,
        'newBackupCreated': True, 'mainSeedPerformed': False, 'healthCheckPassed': False,
        'customerOtpApiAccepted': False, 'customerOtpProviderActivated': False, 'customerOtpBrowserQaPending': True,
        'customerOtpRecoveryRequired': False, 'customerOtpBackendEvidence': relative(ACCEPTANCE),
        'localReleaseEvidence': relative(report), 'healthEvidence': relative(report),
        'unitPassed': accepted['unit']['passed'], 'sqlPassed': accepted['sql']['passed'], 'targetedSqlPassed': accepted['sql']['passed'],
        'fullSqlRunThisRelease': False, 'fullSqlSingleRunPassed': False,
        'sqlAcceptanceMode': 'targeted-complete-customer-otp-classes', 'historicalFullSqlPassed': 1031, 'fullProjectComplete': False}


def verified_backup(run, preserved):
    require(re.fullmatch('[a-f0-9]{32}', run), 'Invalid owned backup identity.')
    capacity = photo.measured_space()
    directory = ROOT / 'tmp/local-backups' / ('customer-otp-' + run); directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    for source, target in ((ROOT / '.env', directory / 'environment.private'), (ROOT / 'tmp/identity-keys', directory / 'identity-keys'),
        (ROOT / 'tmp/public-media-local.json', directory / 'public-media-local.private.json'), (photo.MEDIA, directory / 'public-media-objects')):
        photo.private_copy(source, target)
    require(photo.preserved_files() == preserved, 'Configuration/key/media changed before backup.')
    remote = '/var/opt/mssql/data/customer-otp-' + run + '.bak'
    rma.sql("BACKUP DATABASE [Sayman] TO DISK=N'" + remote + "' WITH COPY_ONLY,CHECKSUM; RESTORE VERIFYONLY FROM DISK=N'" + remote + "' WITH CHECKSUM;", timeout=180)
    result = subprocess.run(['docker', 'compose', '--profile', 'backend', 'exec', '-T', 'sqlserver', 'sha256sum', remote], cwd=ROOT, capture_output=True, text=True, timeout=30)
    digest = result.stdout.split()[0] if result.stdout.split() else ''
    require(result.returncode == 0 and re.fullmatch('[a-f0-9]{64}', digest), 'Remote verified backup SHA256 is unavailable.')
    subprocess.run(['docker', 'compose', '--profile', 'backend', 'cp', 'sqlserver:' + remote, str(directory / 'Sayman.bak')], cwd=ROOT, check=True, capture_output=True, timeout=180)
    backup = directory / 'Sayman.bak'; backup.chmod(0o600)
    require(backup.stat().st_size > 0 and ops.sha(backup) == digest, 'Backup copy checksum differs; retain both copies.')
    subprocess.run(['docker', 'compose', '--profile', 'backend', 'exec', '-T', 'sqlserver', 'rm', '--', remote], cwd=ROOT, check=True, capture_output=True, timeout=20)
    proof = {'passed': True, 'database': 'Sayman', 'sourceSchema': 88, 'privateDirectory': relative(directory),
        'backupSha256': digest, 'backupBytes': backup.stat().st_size, 'copyOnly': True, 'checksumVerifyOnly': True,
        'localRemoteSha256Equal': True, 'privateEnvironmentKeysAndMediaCopied': True,
        'offsiteOrRestoreAccepted': False, 'measuredCapacity': capacity}
    ops.write(directory / 'backup-proof.json', proof, private=True)
    return proof


def private_probe(path):
    if path in ('/api/admin/content', '/api/returns', '/api/admin/products/p1/price-history', '/api/admin/media/images'):
        return prior.private_probe(path)
    require(path in ('/api/admin/sms/settings', '/api/auth/me'), 'Only fixed anonymous read-only probes are permitted.')
    try: response = ops.HTTP.open(ops.API_URL + path, timeout=10)
    except HTTPError as error: response = error
    with response:
        headers = response.headers; body = response.read(32769)
        cache = {item.strip().lower() for item in headers.get('Cache-Control', '').split(',')}
        vary = {item.strip().lower() for item in headers.get('Vary', '').split(',')}
        require(response.status == 401 and {'private', 'no-store'} <= cache and {'cookie', 'authorization'} <= vary
            and 'noindex' in headers.get('X-Robots-Tag', '').lower()
            and headers.get('X-Content-Type-Options', '').lower() == 'nosniff'
            and not headers.get('Set-Cookie') and not headers.get('Location') and len(body) <= 32768,
            'Anonymous private read lacks401/private/no-store/Vary/noindex/nosniff.')
        return {'path': path, 'status': 401, 'privateHeadersAccepted': True, 'bodyBytes': len(body)}


def readonly_smoke():
    checks = []
    for locale in ('fa', 'en'):
        check, raw = ops.request('/api/storefront/' + locale + '?metadataOnly=true', 200)
        auth = json.loads(raw)['authSettings']
        require(auth.get('mobileOtp') is False and auth.get('registration') is False,
            'Unconfigured provider must remain unavailable in both public projections.')
        checks.append(check)
    checks.extend(private_probe(path) for path in ('/api/admin/content', '/api/returns', '/api/admin/products/p1/price-history',
        '/api/admin/media/images', '/api/admin/sms/settings', '/api/auth/me'))
    return checks


def unchanged88(before, after):
    require(before is not None and before == after and len(table_map(before['tables'])) == 229
        and len(histories(before['histories'])) == 88, 'Untouched stopped88 snapshot is required before any pre-migration recovery.')


def apply(plan):
    require(plan.get('kind') == KIND and isinstance(plan.get('run'), str) and re.fullmatch('[a-f0-9]{32}', plan['run']), 'Invalid prepared D67 plan.')
    require(acceptance() == plan['accepted'] and helpers() == plan['helpers'], 'Accepted evidence or publisher changed.')
    require(descriptor_hashes() == plan['descriptors'] and ops.sha(AGGREGATE) == plan['aggregateSha256']
        and photo.preserved_files() == plan['preservedFiles'] and shape() == {'migrationCount': 88, 'tableCount': 229},
        'Canonical selected descriptors, files or schema changed after prepare.')
    previous = plan['previous']; current_d66(previous); aggregate88(ops.read(AGGREGATE))
    require(owned_process(previous) == plan['process'], 'Selected canonical API ownership changed.')
    report_path = CHECKS / ('customer-otp-api-' + plan['run'] + '-main-release.json')
    require(not report_path.exists(), 'Publication report already exists.')
    state = candidate(plan, report_path); directory = runtime(state)
    require(photo.tree(directory) == plan['apiFiles'], 'Candidate package changed.')
    contract = ops.read(rma.owned_path(plan['accepted']['schemaContract']['path']))
    report = {'passed': False, 'startedAtUtc': stamp(), 'newMigrations': 1, 'newTables': 3, 'mainSeedPerformed': False,
        'providerActivated': False, 'smsPerformed': False, 'settingsOrCmsWritten': False, 'migrationCommandStarted': False,
        'recoveryPolicy': 'After any migration invocation only compatible89 forward recovery; never Down/restore or API88.',
        'acceptedEvidence': relative(ACCEPTANCE), 'acceptedSha256': ops.sha(ACCEPTANCE)}
    stopped = False; before = None; active = None; identity = None
    try:
        stop_owned(previous, plan['process']); stopped = True
        require(rma.listener('api') is None, 'The API must be fully stopped before backup or migration.')
        before = database_snapshot(); pending(before)
        before_path = CHECKS / ('customer-otp-api-' + plan['run'] + '-before.json'); ops.write(before_path, before, private=True)
        report['beforeSql'] = {'path': relative(before_path), 'sha256': ops.sha(before_path)}
        report['backup'] = verified_backup(plan['run'], plan['preservedFiles']); ops.write(report_path, report, private=True)
        require(acceptance() == plan['accepted'] and helpers() == plan['helpers'] and photo.preserved_files() == plan['preservedFiles']
            and rma.listener('api') is None and descriptor_hashes() == plan['descriptors']
            and ops.sha(AGGREGATE) == plan['aggregateSha256'], 'Stopped inputs changed during backup.')
        unchanged88(before, database_snapshot())
        report['migrationCommandStarted'] = True; ops.write(report_path, report, private=True)
        with (CHECKS / ('customer-otp-api-' + plan['run'] + '-migration.log')).open('wb') as stream:
            subprocess.run(['dotnet', str(directory / 'Shop.Api.dll'), MIGRATE_FLAG], cwd=ROOT, env=rma.api_environment(),
                stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=180)
        after = database_snapshot(); preserved_database(before, after, contract)
        require(shape() == {'migrationCount': 89, 'tableCount': 232} and photo.preserved_files() == plan['preservedFiles'], 'Target schema or private files changed.')
        active, checks, identity = start_selected(state, CHECKS / ('customer-otp-api-' + plan['run'] + '.log'))
        checks.extend(readonly_smoke())
        preserved_database(before, database_snapshot(), contract)
        require(photo.preserved_files() == plan['preservedFiles']
            and all(ops.sha(rma.DESCRIPTORS[name]) == plan['descriptors'][name] for name in ('storefront', 'admin'))
            and ops.sha(AGGREGATE) == plan['aggregateSha256'] and owned_process(active) == identity,
            'Startup changed configuration, keys, media, frontend descriptors or exact API ownership.')
        active.update(healthCheckPassed=True, customerOtpApiAccepted=True, promotedAtUtc=stamp()); ops.write(CURRENT, active)
        report.update(passed=True, apiPid=identity['pid'], runtimeDirectory=active['runtimeDirectory'], httpChecks=checks,
            sql229OriginalTablesPreserved=True, additiveSchema89Accepted=True, configurationKeysMediaPreserved=True,
            frontendDescriptorsUnchanged=True, finishedAtUtc=stamp())
        ops.write(report_path, report, private=True)
        aggregate = ops.read(AGGREGATE); aggregate['componentReleaseEvidence']['api'] = relative(report_path)
        aggregate.update(sourceMigrationCount=89, databaseMigrationCount=89, tableCount=232, updatedAtUtc=stamp(),
            customerOtpApiAccepted=True, customerOtpBackendEvidence=relative(ACCEPTANCE), customerOtpProviderActivated=False,
            customerOtpBrowserQaPending=True, customerOtpRecoveryRequired=False,
            lastComponentReleaseEvidence={'path': relative(report_path), 'sha256': ops.sha(report_path)})
        ops.write(AGGREGATE, aggregate)
        return report
    except Exception as error:
        report.update(passed=False, errorType=type(error).__name__, finishedAtUtc=stamp())
        if isinstance(error, KnownStoppedStartup):
            active = error.selected
            report['knownStoppedStartupPid'] = error.child_pid
        if stopped:
            try:
                require(not isinstance(error, rma.OwnedStartupIncomplete), 'Child termination unproved; preserve selected state.')
                require(ops.read(CURRENT) == (active if active is not None else previous),
                    'Foreign or unproved API descriptor; preserve it for explicit recovery.')
                if rma.listener('api') is not None:
                    require(active is not None and identity is not None, 'Foreign or unproved API listener; never terminate it.')
                    stop_owned(active, identity)
                require(photo.preserved_files() == plan['preservedFiles']
                    and all(ops.sha(rma.DESCRIPTORS[name]) == plan['descriptors'][name] for name in ('storefront', 'admin')),
                    'Private or frontend state changed; explicit recovery is required.')
                if report['migrationCommandStarted']:
                    require(shape() == {'migrationCount': 89, 'tableCount': 232}, 'Migration incomplete; never select API88.')
                    preserved_database(before, database_snapshot(), contract)
                    recovered, _, _ = start_selected(state, CHECKS / ('customer-otp-api-' + plan['run'] + '-forward-recovery.log'))
                    report.update(recoveredCompatible89=True, recoveryApiPid=recovered['apiPid'])
                    aggregate = ops.read(AGGREGATE)
                    aggregate.update(sourceMigrationCount=89, databaseMigrationCount=89, tableCount=232,
                        customerOtpApiAccepted=False, customerOtpProviderActivated=False, customerOtpRecoveryRequired=True,
                        customerOtpBrowserQaPending=True, updatedAtUtc=stamp())
                    ops.write(AGGREGATE, aggregate)
                else:
                    require(ops.sha(CURRENT) == plan['descriptors']['api'] and ops.sha(AGGREGATE) == plan['aggregateSha256'],
                        'Pre-migration descriptors changed; never overwrite another selection.')
                    require(shape() == {'migrationCount': 88, 'tableCount': 229}, 'Pre-migration recovery requires untouched88.')
                    unchanged88(before, database_snapshot()); current_d66(previous)
                    recovered, _, _ = start_selected(previous, CHECKS / ('customer-otp-api-' + plan['run'] + '-pre-migration-recovery.log'))
                    report.update(recoveredUnchangedPrevious88=True, recoveryApiPid=recovered['apiPid'])
            except Exception as recovery:
                report['recoveryRequired'] = True; report['recoveryErrorType'] = type(recovery).__name__
        ops.write(report_path, report, private=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'apply')); parser.add_argument('--plan', required=True)
    args = parser.parse_args(); path = rma.owned_path(args.plan)
    require(path.suffix == '.json', 'Use a new owned JSON plan.')
    with (ROOT / 'tmp/customer-otp-publication.lock').open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'prepare':
            require(not path.exists(), 'Prepared plan already exists.'); plan = prepare(); ops.write(path, plan, private=True)
            print(json.dumps({'prepared': True, 'run': plan['run'], 'changedFiles': plan['changedFiles']}))
        else:
            result = apply(ops.read(path)); print(json.dumps({'passed': result['passed'], 'apiPid': result['apiPid']}))


if __name__ == '__main__': main()
