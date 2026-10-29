"""Rehearse source38 restore from this task's quiescent disposable Order2 QA.

Only generated source identities are used. No main restore, migration, seed,
business command, role change or source cleanup. The fresh restore copy, its
loopback API, backup and copied credentials/keys are removed in finally.
The older schema34 preservation/restore guards remain unchanged.
"""
from pathlib import Path
from datetime import datetime, timezone
import ast,collections,hashlib,json,os,re,shutil,socket,stat,subprocess,time,urllib.request,urllib.error,uuid

ROOT=Path(__file__).resolve().parent.parent
CONTAINER='sayman-local-sqlserver-1'
SCHEMAS={'identity':3,'payments':1,'credit':2,'cms':1,'catalog':8,'inventory':7,'sales':10,'market':6}
def check(value,stage):
    if not value:raise RuntimeError(stage)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def closed(port):
    with socket.socket() as s:return s.connect_ex(('127.0.0.1',port))!=0
def private_write(p,data):
    with p.open('xb') as f:os.chmod(p,0o600);f.write(data)
def main():
    run=read(ROOT/'tmp/order38-browser-run.json');name=run['database']
    check(re.fullmatch('SaymanTest_Ui_[a-f0-9]{32}',name) and run['qaOnly'] and not run['qaCleanup'] and not run['mainPromoted'] and not run['preserveOnStop'] and run['sourceMigrations']==38 and run['mainMigrations']==35,'fresh_owned_order38_source_required')
    source=ROOT/run['privateDirectory'];check(source==ROOT/'tmp/ui-cart'/name and source.resolve()==source and source.stat().st_uid==os.getuid() and stat.S_IMODE(source.stat().st_mode)==0o700,'private_source_binding')
    for p in source.rglob('*'):
        s=p.lstat();check(s.st_uid==os.getuid() and not stat.S_ISLNK(s.st_mode) and (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)) and (p.is_dir() or s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600),'owned_unlinked_source_tree')
    meta=read(source/'cart2.json');fixture=read(source/'order2.json')
    check(meta['Database']==fixture['Database']==name and fixture['GeneratedSyntheticQa'] and fixture['Order2Qa'] and not fixture['MainPromoted'],'order2_fixture_binding')
    for p in [3105,3175,5182,5183]:check(closed(p),'ui_and_restore_ports_must_be_closed')
    check(not closed(5181),'owned_source_api_required');check(shutil.disk_usage(ROOT).free>=10*1024**3,'ten_gib_free_required')
    effects=read(ROOT/'artifacts/checks/order38-browser2-cancelled-projected-sql.json');check(effects['passed'] and effects['database']==name and len(effects['facts']['Orders'])==1,'actual_order2_history_required')
    order=effects['facts']['Orders'][0];check(order['State']=='Cancelled' and order['SnapshotVersion']==2,'cancelled_order2_snapshot_required')
    pair=read(ROOT/run['runtimeSet']);api=read(ROOT/pair['apiCandidate']);runtime=ROOT/api['runtimeDirectory']
    check(not pair['mainPromoted'] and pair['sourceMigrationCount']==38 and api['apiSha256']==pair['apiSha256'],'tested_runtime38_required')
    for f,h in pair['moduleSha256'].items():check(sha(runtime/f)==h,'exact_tested_product_dlls')
    config=dict(l.split('=',1) for l in (ROOT/'.env').read_text().splitlines() if l and not l.startswith('#'));sql_env=os.environ.copy();sql_env['SQLCMDPASSWORD']=config['SQL_SA_PASSWORD']
    def command(args,stage,timeout=90):
        p=subprocess.run(args,env=sql_env,capture_output=True,text=True,timeout=timeout);check(p.returncode==0,stage);return p.stdout
    def sql(q,db='master'):
        return command(['docker','exec','-e','SQLCMDPASSWORD',CONTAINER,'/opt/mssql-tools18/bin/sqlcmd','-S','localhost','-U','sa','-C','-b','-d',db,'-w','65535','-y','0','-Q','SET NOCOUNT ON; '+q],'sql_operation_failed')
    def payload(q,db):return json.loads(''.join(sql(q,db).splitlines()).strip())
    tree=ast.parse((ROOT/'scripts/rehearse-cart34-restore.py').read_text());fingerprint=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FINGERPRINT_SQL' for t in n.targets))
    def snapshot(db):return payload(fingerprint,db)
    union=' UNION ALL '.join("SELECT N'"+s+"' [schema],MigrationId,ProductVersion FROM ["+s+"].__EFMigrationsHistory" for s in SCHEMAS)
    def history(db):return payload('SELECT (SELECT * FROM ('+union+') h ORDER BY [schema],MigrationId FOR JSON PATH) Payload',db)
    def http(origin,path,token=None,body=None,expect=200,admin=False):
        headers={'Origin':'http://sayman-orders-admin-ui.localhost:3175','Content-Type':'application/json'}
        if admin:headers.update({'X-Sayman-Admin':'1','X-Sayman-Client':'admin'})
        if token:headers['Authorization']='Bearer '+token
        request=urllib.request.Request(origin+path,headers=headers,data=None if body is None else json.dumps(body,separators=(',',':')).encode(),method='GET' if body is None else 'POST')
        try:
            with urllib.request.urlopen(request,timeout=25) as response:status=response.status;raw=response.read(1048577)
        except urllib.error.HTTPError as e:status=e.code;raw=e.read(1048577)
        check(status==expect,'http_'+str(status)+'_expected_'+str(expect)+'_'+path);check(len(raw)<=1048576,'http_body_bound')
        return json.loads(raw) if raw else None
    def customer_login(origin):
        c=read(source/'customer.json');check(re.fullmatch('cartui[a-f0-9]{32}',c['Username']) and len(c['Password'])>=32,'generated_customer_required')
        signed=http(origin,'/api/auth/password',body={'identifier':c['Username'],'password':c['Password']});check(not signed['requiresMfa'] and signed['user']['id']==meta['CustomerId'],'customer_password_identity_match');return signed['accessToken']
    origin='http://127.0.0.1:5181';token=customer_login(origin)
    paths=['/api/orders/v2/'+order['Id'],'/api/orders/v2','/api/cart/fa/v2','/api/cart/en/v2','/api/sourcing/requests/'+meta['RequestId'],'/api/sourcing/requests/'+meta['RequestId']+'/supply/v2/'+meta['TaskId'],'/api/sourcing/requests/'+meta['RequestId']+'/orders']
    expected={p:http(origin,p,token) for p in paths};token=None
    check(expected[paths[0]]['summary']['state']=='Cancelled' and expected[paths[0]]['payableTotalRial']=='18014398509494454' and len(expected[paths[0]]['lines'])==2,'source_real_order_snapshot_http')
    check(len(expected[paths[-1]]['items'])==1,'source_projected_order_link_http')
    before=snapshot(name);source_history=history(name);main_before=snapshot('Sayman');main_history=history('Sayman')
    check(len(before)==111 and len(source_history)==38 and dict(collections.Counter(x['schema'] for x in source_history))==SCHEMAS and len(main_history)==35,'exact_schema38_main35_boundary')
    key_hashes={p.name:sha(p) for p in (source/'keys').glob('*.xml')};check(bool(key_hashes),'original_key_ring_required')
    run_id=uuid.uuid4().hex;restored='SaymanTest_Restore_'+run_id;check(re.fullmatch('SaymanTest_Restore_[a-f0-9]{32}',restored),'new_copy_name_guard')
    directory=ROOT/'tmp/restore'/restored;directory.parent.mkdir(mode=0o700,exist_ok=True);check(not directory.parent.is_symlink() and not directory.exists(),'fresh_restore_directory');directory.mkdir(mode=0o700)
    files={k:'/var/opt/mssql/data/'+restored+v for k,v in [('backup','.bak'),('data','.mdf'),('log','_log.ldf')]}
    report={'passed':False,'qaOnly':True,'sourceDatabase':name,'restoredDatabase':restored,'sourceSchema':38,'mainSchema':35,'startedAtUtc':datetime.now(timezone.utc).isoformat(),'sourceTableFingerprints':before,'migrationHistory':source_history,'checks':[],'cleanup':{},'apiSha256':api['apiSha256'],'scope':'Same-host Development source38 SQL restore and generated-account HTTP/copied-key verification only; no native Linux, production, offsite or RTO acceptance.'}
    target=ROOT/f'artifacts/checks/order38-restore-{run_id}.json';proc=None;restoring=False;backup_attempted=False;log_handle=None
    try:
        check(payload(f"SELECT (SELECT DB_ID(N'{restored}') id FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) Payload",'master')['id'] is None,'restore_target_must_not_exist')
        for p in files.values():command(['docker','exec',CONTAINER,'test','!','-e',p],'restore_paths_must_not_exist')
        shutil.copytree(source/'keys',directory/'keys')
        for p in (directory/'keys').rglob('*'):p.chmod(0o700 if p.is_dir() else 0o600)
        (directory/'keys').chmod(0o700)
        for f in ['customer.json','finance.json','inventory.json','cart2.json','order2.json']:private_write(directory/f,(source/f).read_bytes())
        private_write(directory/'expected-http.json',json.dumps(expected).encode())
        dbfiles=payload('SELECT (SELECT name,type_desc FROM sys.database_files ORDER BY file_id FOR JSON PATH) Payload',name);check(len(dbfiles)==2 and [f['type_desc'] for f in dbfiles]==['ROWS','LOG'],'exact_source_files_required')
        backup_attempted=True;sql(f"BACKUP DATABASE [{name}] TO DISK=N'{files['backup']}' WITH COPY_ONLY,CHECKSUM;");report['checks'].append('copy_only_checksum_backup')
        sql(f"RESTORE VERIFYONLY FROM DISK=N'{files['backup']}' WITH CHECKSUM;");report['checks'].append('verifyonly_checksum')
        report['backupSha256']=command(['docker','exec',CONTAINER,'sha256sum',files['backup']],'backup_hash').split()[0]
        report['backupBytes']=int(command(['docker','exec',CONTAINER,'stat','-c','%s',files['backup']],'backup_size').strip())
        check(all("'" not in f['name'] for f in dbfiles),'logical_names_safe')
        restoring=True;sql(f"RESTORE DATABASE [{restored}] FROM DISK=N'{files['backup']}' WITH MOVE N'{dbfiles[0]['name']}' TO N'{files['data']}',MOVE N'{dbfiles[1]['name']}' TO N'{files['log']}',CHECKSUM,RECOVERY;")
        report['checks'].append('restore_new_guid_without_replace')
        sql(f'DBCC CHECKDB ([{restored}]) WITH NO_INFOMSGS;');report['checks'].append('full_checkdb_without_repair')
        check(snapshot(restored)==before and history(restored)==source_history,'exact_all111_tables_and38_history_restored');report['checks'].append('all111_table_counts_hashes_rowversions_and38_migrations_exact')
        check({p.name:sha(p) for p in (directory/'keys').glob('*.xml')}==key_hashes,'copied_key_bytes_exact')
        env=os.environ.copy();env.update(ASPNETCORE_ENVIRONMENT='Development',ASPNETCORE_CONTENTROOT=str(ROOT/'backend/src/Shop.Api'),ASPNETCORE_URLS='http://127.0.0.1:5183',ConnectionStrings__Shop=f"Server=127.0.0.1,11433;Database={restored};User Id=sa;Password={config['SQL_SA_PASSWORD']};TrustServerCertificate=True;Connect Timeout=8",Auth__SigningKey='q'*80,Bootstrap__AdminPassword='UnusedRestore!'+uuid.uuid4().hex,DataProtection__KeyDirectory=str(directory/'keys'),Sales__ExpiryEnabled='false',Inventory__ExpiryEnabled='false',Inventory__AllocationExpiryEnabled='false',Market__OrderProjectionEnabled='false',Media__Storage='Disabled',Media__CleanupEnabled='false',Cors__Origins__0='http://sayman-orders-admin-ui.localhost:3175',Cors__AdminOrigins__0='http://sayman-orders-admin-ui.localhost:3175')
        log_path=directory/'api.log';log_handle=log_path.open('xb');log_path.chmod(0o600);proc=subprocess.Popen(['dotnet',str(runtime/'Shop.Api.dll')],cwd=ROOT,env=env,stdout=log_handle,stderr=subprocess.STDOUT)
        restored_origin='http://127.0.0.1:5183';ready=False
        for _ in range(60):
            check(proc.poll() is None,'restored_api_stopped_early')
            try:ready=http(restored_origin,'/health/ready') is not None
            except (OSError,RuntimeError):pass
            if ready:break
            time.sleep(.25)
        check(ready,'restored_api_health');report['checks'].append('exact_candidate_api38_ready_on_own_copy_only')
        token=customer_login(restored_origin)
        for path in paths:check(http(restored_origin,path,token)==expected[path],'restored_private_http_exact_'+str(paths.index(path)))
        http(restored_origin,'/api/admin/orders/v2/'+meta['CustomerId']+'/'+order['Id'],token,expect=403);token=None
        report['checks']+=['generated_customer_password_and_exact_order2_page_detail_cart_fa_en_supply_notes_request_links_http','customer_denied_admin_order_read']
        staff=read(source/'finance.json');check(re.fullmatch('financeui[a-f0-9]{32}',staff['Username']) and len(staff['Password'])>=32,'own_generated_staff_required')
        pending=http(restored_origin,'/api/auth/password',body={'identifier':staff['Username'],'password':staff['Password']},admin=True);check(pending['requiresMfa'] and not pending['requiresEnrollment'],'restored_staff_existing_mfa_required')
        staff=read(source/'finance.json');signed=http(restored_origin,'/api/auth/mfa/verify',pending['accessToken'],{'code':staff['Code']},admin=True);check(not signed['requiresMfa'] and 'sales.read' in signed['user']['permissions'],'restored_staff_actual_mfa_and_roles')
        detail=http(restored_origin,'/api/admin/orders/v2/'+meta['CustomerId']+'/'+order['Id'],signed['accessToken']);check(detail==expected[paths[0]],'restored_admin_full_order_snapshot_terms');pending=signed=staff=None
        report['checks'].append('generated_staff_password_existing_mfa_and_full_order_snapshot_terms_http')
        after=snapshot(restored);check([x for x in before if x['schema']!='identity']==[x for x in after if x['schema']!='identity'],'restored_auth_changed_no_business_tables')
        check({p.name:sha(p) for p in (directory/'keys').glob('*.xml')}==key_hashes,'no_new_restore_keys')
        check(snapshot(name)==before and history(name)==source_history,'source_sql_preserved_exactly')
        check({p.name:sha(p) for p in (source/'keys').glob('*.xml')}==key_hashes,'source_keys_preserved_exactly')
        main_after=snapshot('Sayman');check(history('Sayman')==main_history,'main35_history_preserved')
        report['mainDisclosedDifferences']=[{'before':a,'after':b} for a,b in zip(main_before,main_after) if a!=b];check(len(main_after)==len(main_before)==106 and all(d['before']['schema']=='identity' and d['before']['table']=='Sessions' for d in report['mainDisclosedDifferences']),'main_non_session_tables_preserved')
        report['checks']+=['restore_auth_changes_confined_to_identity','source111_tables_and_keys_preserved_exactly','main35_non_session_tables_preserved'];report['restoredReadPaths']=len(paths);report['passed']=True
    except Exception as e:report['failure']=str(e) if isinstance(e,RuntimeError) else type(e).__name__
    finally:
        if proc is not None:
            proc.terminate()
            try:proc.wait(timeout=15)
            except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=5)
        if log_handle:log_handle.close()
        report['cleanup']['restoreApiStopped']=closed(5183)
        if restoring:
            try:sql(f"IF DB_ID(N'{restored}') IS NOT NULL BEGIN ALTER DATABASE [{restored}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{restored}]; END;");report['cleanup']['restoreDatabaseRemoved']=True
            except Exception:report['cleanup']['restoreDatabaseRemoved']=False
        if report['cleanup'].get('restoreDatabaseRemoved',True):
            try:
                if backup_attempted:command(['docker','exec',CONTAINER,'rm','-f','--',*files.values()],'remove_only_this_restore_files')
                check(directory.resolve()==directory and directory.name==restored,'cleanup_private_exact_target');shutil.rmtree(directory);report['cleanup']['privateAndBackupFilesRemoved']=not directory.exists()
            except Exception:report['cleanup']['privateAndBackupFilesRemoved']=False
        report['cleanup']['sourceRetained']=source.exists();report['finishedAtUtc']=datetime.now(timezone.utc).isoformat();report['passed']=report['passed'] and all(report['cleanup'].values());target.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':report['passed'],'report':str(target.relative_to(ROOT)),'checks':len(report['checks']),'cleanup':report['cleanup'],'failure':report.get('failure')}));return 0 if report['passed'] else 1
if __name__=='__main__':
    try:raise SystemExit(main())
    except RuntimeError as e:print('Order38 restore preflight failed: '+str(e));raise SystemExit(1)
