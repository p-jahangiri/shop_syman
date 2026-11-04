"""Publish accepted D69 on canonical Sayman89 ->92; never seed or send SMS.

Importing is inert. --apply requires exact source/binary/test acceptance, a
verified stopped backup, retained data/metadata and the three scoped migrations.
After invoking a migration, recovery is forward with API92, never API89/Down.
"""
from pathlib import Path
import argparse
import fcntl
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import local_shop_ops as dbops
spec = importlib.util.spec_from_file_location('sms_existing_ops', ROOT / 'scripts/publish-local-customer-otp.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ops, rma, photo, runner = m.ops, m.rma, m.photo, m.runner
CHECKS = ROOT / 'artifacts/checks/d69-sms-backend'
ACCEPTANCE = CHECKS / 'acceptance.json'
MIGRATIONS = {('identity', '20261031205216_SmsOtpPolicySnapshots'),
    ('notifications', '20261031205200_SmsWorkspace'), ('sales', '20261031205223_SalesSmsSignals')}
NEW = {'notifications.' + n for n in ('SmsWorkspace','SmsConnections','SmsTemplates',
    'SmsTemplateParameters','SmsEventRoutes','SmsWorkspaceCommands','SmsMessages')} | {'sales.SmsSignals'}
CHANGED = 'identity.CustomerOtpChallenges'


def require(value, message): ops.require(value, message)
def relative(path): return str(path.relative_to(ROOT))


def shape():
    return ops.payload('SELECT (SELECT SUM(n) FROM (' + ' UNION ALL '.join(
        'SELECT COUNT_BIG(*) n FROM [' + s + '].__EFMigrationsHistory' for s in ops.SCHEMAS)
        + ') h) migrationCount,(SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0) tableCount FOR JSON PATH,WITHOUT_ARRAY_WRAPPER')


def snapshot():
    value = dbops.snapshot()
    needle = 'FROM sys.columns WHERE object_id=@object;'
    require(dbops.FINGERPRINT_SQL.count(needle) == 1, 'Fingerprint projection changed.')
    value['tables'] = ops.payload(dbops.FINGERPRINT_SQL.replace(needle,
        "FROM sys.columns WHERE object_id=@object AND NOT (@schema=N'identity' AND @table=N'CustomerOtpChallenges' AND name IN (N'LifetimeSeconds',N'ResendSeconds',N'MaxAttempts'));"))
    value['metadata'] = ops.payload(rma.METADATA_SQL)
    return value


def portable(row):
    row = json.loads(json.dumps(row))
    for index in row['indexes']: index.pop('index_id', None)
    return row


def preserve(before, after, contract):
    old, new = rma.table_map(before['tables']), rma.table_map(after['tables'])
    require(len(old) == 232 and len(new) == 240 and set(new) - set(old) == NEW and set(old) <= set(new), 'Unexpected table set.')
    histories = {s + '.__EFMigrationsHistory' for s, _ in MIGRATIONS}
    require(all(new.get(name) == row for name, row in old.items() if name not in histories), 'An existing data value, rowversion or record changed.')
    a, b = rma.histories(before['histories']), rma.histories(after['histories'])
    require(len(a) == 89 and len(b) == 92 and a <= b
        and {(s, name) for s, name, _ in b - a} == MIGRATIONS
        and all(version == '10.0.12' for _, _, version in b - a), 'Unexpected migration history delta.')
    require(before['configuration'] == after['configuration'], 'Private configuration/key files changed.')
    old_meta, new_meta = rma.table_map(before['metadata']), rma.table_map(after['metadata'])
    approved = rma.table_map(contract['metadata'])
    require(set(approved) == NEW | {CHANGED}, 'Unexpected schema approval set.')
    for name in NEW: require(portable(new_meta[name]) == portable(approved[name]), 'New metadata differs from accepted SQL fixture: ' + name)
    for name, row in old_meta.items():
        current = new_meta[name]
        if name != CHANGED:
            require(portable(current) == portable(row), 'Unrelated table metadata changed: ' + name)
            continue
        old_cols = {c['name']: c for c in row['columns']}; cols = {c['name']: c for c in current['columns']}
        wanted = {c['name']: c for c in approved[name]['columns']}
        added = {'LifetimeSeconds','ResendSeconds','MaxAttempts'}
        require(set(cols) - set(old_cols) == added and all(cols.get(k) == v for k, v in old_cols.items())
            and all(cols[k] == wanted[k] for k in added), 'Only approved OTP snapshot columns may be added.')
        require(portable(current)['indexes'] == portable(row)['indexes'] and current['foreignKeys'] == row['foreignKeys']
            and current['checks'] == approved[name]['checks'], 'OTP indexes, foreign keys or checks differ.')
    bindings = ops.payload("""
        SELECT (SELECT COUNT(*) FROM [notifications].[SmsConnections] c
          JOIN [identity].[CustomerSmsSettings] old ON old.[KeyRevision]=c.[KeyRevision]
          JOIN [notifications].[SmsWorkspace] w ON w.[OtpGeneration]=old.[KeyRevision]
          WHERE c.[Id]='d6900000000000000000000000000001' AND c.[LegacyKeyProtection]=1
            AND c.[ProtectedApiKey]=old.[ProtectedApiKey] AND c.[Mode]=old.[Mode] AND c.[Enabled]=old.[Enabled]) keyBindings,
          (SELECT COUNT(*) FROM [notifications].[SmsEventRoutes]) routes,
          (SELECT COUNT(*) FROM [notifications].[SmsEventRoutes] WHERE [Event]<>'otp' AND [Enabled]=1) enabledNewRoutes,
          (SELECT COUNT(*) FROM [notifications].[SmsWorkspaceCommands]) commands,
          (SELECT COUNT(*) FROM [notifications].[SmsMessages]) messages,
          (SELECT COUNT(*) FROM [sales].[SmsSignals]) signals
        FOR JSON PATH,WITHOUT_ARRAY_WRAPPER
        """)
    require(bindings == {'keyBindings':1,'routes':8,'enabledNewRoutes':0,'commands':0,'messages':0,'signals':0}, 'Live key/generation retention or empty future-only notification import differs.')
    return bindings


def accepted():
    proof = ops.read(ACCEPTANCE)
    require(proof.get('passed') is True and proof.get('schemaChanges') == 3
        and proof.get('discoveryCounterAccepted') is True and proof.get('cleanup', {}).get('remainingFixtureDatabases') == 0,
        'Complete accepted source-bound SQL/unit evidence is required.')
    require(runner.freeze('Debug') == proof['frozen'], 'Accepted source, binaries or 14-module parity changed.')
    for record in proof['evidence'].values(): require(ops.sha(ROOT / record['path']) == record['sha256'], 'Accepted evidence changed.')
    contract = ops.read(CHECKS / 'schema-contract.json')
    require(any(record['path'] == relative(CHECKS / 'schema-contract.json')
        and record['sha256'] == ops.sha(CHECKS / 'schema-contract.json') for record in proof['evidence'].values()),
        'SQL metadata must be bound to the accepted evidence.')
    require(contract.get('status') == 'disposable-schema92-accepted' and contract.get('tableCount') == 240, 'Accepted SQL92 metadata is required.')
    return proof, contract


def start(state, log):
    require(rma.listener('api') is None, 'Another API listener exists.')
    rma.verify.manifest(state, 'api'); ops.write(m.CURRENT, state)
    with log.open('ab') as stream:
        child = subprocess.Popen(['python3','scripts/serve-main-api.py'], cwd=ROOT, stdout=stream, stderr=stream, start_new_session=True)
    for attempt in range(100):
        if child.poll() is not None: raise ops.PublishError('Accepted API92 exited; preserve forward recovery state.')
        try:
            active = ops.read(m.CURRENT)
            checks = [ops.request(p, 200, require_no_store=True)[0] for p in ('/health/live','/health/ready')]
            require(active['apiPid'] == child.pid == rma.listener('api'), 'Started API identity differs.')
            return active, checks
        except Exception:
            if attempt == 99: raise
            time.sleep(.25)


def apply():
    proof, contract = accepted(); previous = ops.read(m.CURRENT)
    require(previous.get('staffPasswordOwnerReloginVerified') is True
        or ops.read(m.AGGREGATE).get('staffPasswordOwnerReloginVerified') is True,
        'The completed owner password transition must be retained.')
    require(previous['databaseMigrationCount'] == previous['sourceMigrationCount'] == 89
        and shape() == {'migrationCount':89,'tableCount':232}, 'Only the accepted canonical89 baseline is supported.')
    process = m.owned_process(previous); private = photo.preserved_files(); capacity = photo.measured_space()
    run = uuid.uuid4().hex; directory = ROOT / ('tmp/api-runtime-sms-workspace-' + run)
    files = photo.tree(ops.API_BIN); shutil.copytree(ops.API_BIN, directory)
    require(photo.tree(directory) == files, 'Packaged API bytes changed.')
    manifest = CHECKS / ('api-' + run + '-manifest.json'); ops.write(manifest, {'algorithm':'SHA-256','files':files})
    report_path = CHECKS / ('api-' + run + '-release.json')
    candidate = {**previous,'runtimeDirectory':relative(directory),'previousRuntimeDirectory':previous['runtimeDirectory'],
        'artifactManifest':relative(manifest),'artifactManifestSha256':ops.sha(manifest),
        'moduleSha256':{name:values['api'] for name,values in proof['frozen']['module14parity'].items()},
        'apiPid':None,'sourceMigrationCount':92,'databaseMigrationCount':92,'tableCount':240,
        'slice':'D69 SMS workspace, Kavenegar and future-only notifications','codeOnly':False,'newMigrations':3,'newTables':8,
        'mainSeedPerformed':False,'newBackupCreated':True,'smsWorkspaceApiAccepted':True,'smsWorkspaceBrowserQaPending':True,
        'backendAcceptanceEvidence':relative(ACCEPTANCE),'localReleaseEvidence':relative(report_path),'fullProjectComplete':False}
    report = {'passed':False,'startedAtUtc':m.stamp(),'schemaBefore':89,'schemaAfter':92,'mainSeedPerformed':False,
        'manualAccountChangePerformed':False,'smsTestSent':False,'candidate':candidate,'measuredCapacity':capacity,
        'acceptanceSha256':ops.sha(ACCEPTANCE),'recoveryPolicy':'Only accepted API92 forward recovery after migration invocation.'}
    ops.write(report_path, report)
    m.stop_owned(previous, process)
    try:
        before = snapshot(); ops.write(CHECKS / ('before-' + run + '.json'), before, private=True)
        require(shape() == {'migrationCount':89,'tableCount':232}, 'Baseline changed after stopping API.')
        backup = m.verified_backup(run, private)
        backup.update(sourceSchema=89,caller='D69 canonical89 verified immediately before backup')
        ops.write(ROOT / backup['privateDirectory'] / 'backup-proof.json', backup, private=True)
        report['backup'] = backup; report['migrationInvoked'] = True; ops.write(report_path, report)
        env = dbops.api_environment(); env.update(Logging__LogLevel__Default='Warning', Logging__LogLevel__Microsoft='Warning')
        result = subprocess.run(['dotnet',str(directory / 'Shop.Api.dll'),'--migrate-sms-workspace'],cwd=ROOT,env=env,
            capture_output=True,text=True,timeout=180)
        (CHECKS / ('migration-' + run + '.log')).write_text(result.stdout + result.stderr)
        require(result.returncode == 0 and shape() == {'migrationCount':92,'tableCount':240}, 'Scoped migration did not complete; forward recovery required.')
        after = snapshot(); report['retainedBindings'] = preserve(before, after, contract)
        ops.write(CHECKS / ('after-' + run + '.json'), after, private=True)
        require(photo.preserved_files() == private, 'Private keys, configuration or media changed.')
        active, checks = start(candidate, CHECKS / ('api-' + run + '.log'))
        for locale in ('fa','en'):
            item, body = ops.request('/api/storefront/' + locale + '?metadataOnly=true',200)
            auth = json.loads(body)['authSettings']; require(auth['mobileOtp'] is True and auth['registration'] is True, 'Live OTP publication changed.')
            checks.append(item)
        active.update(healthCheckPassed=True,promotedAtUtc=m.stamp()); ops.write(m.CURRENT,active)
        report.update(passed=True,finishedAtUtc=m.stamp(),runtimeDirectory=active['runtimeDirectory'],apiPid=active['apiPid'],httpChecks=checks,
            old232TableDataPreserved=True,privateKeysMediaPreserved=True,customerSmsKeyAndGenerationPreserved=True,newNotificationsDisabled=True)
        ops.write(report_path,report)
        aggregate=ops.read(m.AGGREGATE);aggregate.update(sourceMigrationCount=92,databaseMigrationCount=92,tableCount=240,
            smsWorkspaceApiAccepted=True,smsWorkspaceBrowserQaPending=True,updatedAtUtc=m.stamp())
        aggregate['componentReleaseEvidence']['api']=relative(report_path)
        aggregate['lastComponentReleaseEvidence']={'path':relative(report_path),'sha256':ops.sha(report_path)}
        ops.write(m.AGGREGATE,aggregate)
        print(json.dumps({'passed':True,'apiPid':active['apiPid'],'schema':92,'tables':240,'release':relative(report_path)}))
    except Exception:
        report.update(recoveryRequired=True,failedAtUtc=m.stamp());ops.write(report_path,report)
        if rma.listener('api') is None:
            try:
                actual = shape()
                if not report.get('migrationInvoked') and actual == {'migrationCount':89,'tableCount':232}:
                    recovered, _ = start(previous, CHECKS / ('pre-migration-recovery-' + run + '.log'))
                    report.update(preMigrationRuntimeRecovered=True,apiPid=recovered['apiPid'])
                elif actual == {'migrationCount':92,'tableCount':240}:
                    recovered, _ = start(candidate, CHECKS / ('forward-recovery-' + run + '.log'))
                    report.update(compatibleForwardRuntimeRunning=True,apiPid=recovered['apiPid'])
                ops.write(report_path,report)
            except Exception:
                report['runtimeRecoveryUnproved']=True;ops.write(report_path,report)
        # Never start the old artifact after a schema change or an ambiguous
        # migration. Leave exact candidate/backup evidence for forward recovery.
        raise


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if not args.apply: parser.error('Use --apply only after source-bound acceptance.')
    with (ROOT / 'tmp/sms-workspace-publication.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB);apply()
