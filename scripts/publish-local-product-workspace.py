"""Publish the accepted D70 Catalog workspace to canonical Sayman92 ->93.

Imports are inert. Only the selected API is stopped. Verify a private backup,
apply the single reviewed migration, retain all240old tables/keys/media and use
only compatible93 forward recovery after migration invocation. Examples are a
separate explicit operation after both UIs are active; no account or SMS action.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import shutil
import signal
import subprocess
import time
import uuid

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('d70_previous_primitives',ROOT/'scripts/publish-local-sms-workspace.py')
previous=importlib.util.module_from_spec(spec);spec.loader.exec_module(previous)
ops,rma,photo,m,runner=previous.ops,previous.rma,previous.photo,previous.m,previous.runner
CHECKS=ROOT/'artifacts/checks/d70-product-workspace'
NEW={'catalog.'+name for name in ('ProductWorkspaceCommands','ProductFormConfigurations','ProductFormFields','PublicVideos')}
CHANGED={'catalog.Products':{'ArchivedAt'},'catalog.ProductMedia':{'VideoAssetId'}}
MIGRATION=('catalog','20261101224803_ProductWorkspace','10.0.12')
def require(value,message):ops.require(value,message)
def relative(path):return str(path.relative_to(ROOT))
def shape():return previous.shape()
def snapshot():
 value=previous.dbops.snapshot();needle='FROM sys.columns WHERE object_id=@object;'
 projection="FROM sys.columns WHERE object_id=@object AND NOT (@schema=N'catalog' AND ((@table=N'Products' AND name=N'ArchivedAt') OR (@table=N'ProductMedia' AND name=N'VideoAssetId')));"
 require(previous.dbops.FINGERPRINT_SQL.count(needle)==1,'Legacy projection contract changed.')
 value['tables']=ops.payload(previous.dbops.FINGERPRINT_SQL.replace(needle,projection))
 value['metadata']=ops.payload(rma.METADATA_SQL)
 return value

def portable(row):return previous.portable(row)
def stable_json(row):return json.dumps(row,sort_keys=True,separators=(',',':'))
def preserve(before,after,contract):
 old,new=rma.table_map(before['tables']),rma.table_map(after['tables'])
 require(len(old)==240 and len(new)==244 and set(new)-set(old)==NEW and set(old)<=set(new),'Unexpected table delta.')
 require(all(new[name]==row for name,row in old.items()if name!='catalog.__EFMigrationsHistory'),'An old row, value or rowversion changed.')
 a,b=rma.histories(before['histories']),rma.histories(after['histories'])
 require(len(a)==92 and len(b)==93 and a<=b and b-a=={MIGRATION},'Unexpected migration history delta.')
 require(before['configuration']==after['configuration'],'Private configuration/key bytes changed.')
 old_meta,new_meta=rma.table_map(before['metadata']),rma.table_map(after['metadata']);approved=rma.table_map(contract['metadata'])
 for name in NEW:
  require(portable(new_meta[name])==portable(approved[name]),'New SQL metadata differs from acceptance: '+name)
  require(new[name]['count']==0,'A migration unexpectedly inserted application data: '+name)
 for name,row in old_meta.items():
  current=new_meta[name]
  if name not in CHANGED:
   require(portable(row)==portable(current),'Unrelated SQL metadata changed: '+name);continue
  added=CHANGED[name];old_columns={c['name']:c for c in row['columns']};columns={c['name']:c for c in current['columns']};wanted={c['name']:c for c in approved[name]['columns']}
  require(set(columns)-set(old_columns)==added and all(columns.get(k)==v for k,v in old_columns.items()) and all(columns[k]==wanted[k]for k in added),'Only reviewed nullable columns may be added: '+name)
  for key in ('indexes','foreignKeys','checks'):
   prior_rows=portable(row)[key];current_rows=portable(current)[key];old_names={v['name']for v in prior_rows}
   retained=[v for v in current_rows if v['name']in old_names]
   require(retained==prior_rows,'Existing constraints/indexes changed: '+name+'/'+key)
   introduced=[v for v in current_rows if v['name']not in old_names]
   expected=[v for v in portable(approved[name])[key]if v['name']not in old_names]
   require(sorted(map(stable_json,introduced))==sorted(map(stable_json,expected)),'Unreviewed metadata delta: '+name+'/'+key)
 return {'old240TablesPreserved':True,'newTables':sorted(NEW),'onlyCatalogMigrationAdded':True,'oldColumnProjectionVerified':True}

def accepted(path):
 proof=ops.read(path);require(proof.get('passed')is True and proof.get('schemaChanges')==1 and proof.get('schemaBefore')==92 and proof.get('schemaAfter')==93 and proof.get('discoveryCounterAccepted')is True and proof.get('cleanup',{}).get('remainingFixtureDatabases')==0,'Complete source-bound unit/SQL acceptance is required.')
 frozen=runner.freeze('Debug');require(all(proof['frozen'].get(key)==value for key,value in frozen.items()),'Accepted source, test artifacts or14modules changed.')
 for name,digest in proof['frozen']['fixtureInputs'].items():require(ops.sha(ROOT/name)==digest,'Fixture or seed media changed after acceptance.')
 for record in proof['evidence'].values():require(ops.sha(ROOT/record['path'])==record['sha256'],'Accepted evidence changed.')
 contract=ops.read(ROOT/proof['evidence']['schema']['path']);require(contract.get('status')=='disposable-schema93-accepted' and contract.get('tableCount')==244,'Accepted schema93 metadata is required.')
 return proof,contract

def owned_process(state):
 require(ops.read(m.CURRENT)==state,'Selected API descriptor changed before inspection.')
 require(state.get('sourceMigrationCount')==state.get('databaseMigrationCount') and (state['databaseMigrationCount'],state.get('tableCount'))in((92,240),(93,244)),'Unsupported canonical API state.')
 directory,_,_=rma.verify.manifest(state,'api');pid=state.get('apiPid');require(type(pid)is int and pid>1 and rma.listener('api')==pid,'Selected API listener/PID differs.')
 command=subprocess.check_output(['ps','-p',str(pid),'-o','command='],text=True,timeout=10).strip();cwd=subprocess.check_output(['lsof','-a','-p',str(pid),'-d','cwd','-Fn'],text=True,timeout=10).splitlines();started=subprocess.check_output(['ps','-p',str(pid),'-o','lstart='],text=True,timeout=10).strip()
 require(command=='dotnet '+str(directory/'Shop.Api.dll') and 'n'+str(ROOT)in cwd and started,'API command/cwd/start identity differs.')
 return {'pid':pid,'command':command,'started':started}
def stop(state,identity):
 require(owned_process(state)==identity,'API ownership changed before stopping.')
 os.kill(identity['pid'],signal.SIGTERM);deadline=time.monotonic()+45
 while time.monotonic()<deadline:
  if rma.listener('api')is None:
   try:os.kill(identity['pid'],0)
   except ProcessLookupError:return
  time.sleep(.25)
 raise ops.PublishError('Owned API did not stop; no other process was signalled.')
def start(state,log):return previous.start(state,log)

def apply(acceptance):
 proof,contract=accepted(acceptance);state=ops.read(m.CURRENT)
 require(state['sourceMigrationCount']==state['databaseMigrationCount']==92 and shape()=={'migrationCount':92,'tableCount':240},'Only the canonical92 baseline is supported.')
 identity=owned_process(state);private=photo.preserved_files();run=uuid.uuid4().hex;directory=ROOT/('tmp/api-runtime-product-workspace-'+run);files=photo.tree(ops.API_BIN);shutil.copytree(ops.API_BIN,directory);require(photo.tree(directory)==files,'API package bytes differ.')
 manifest=CHECKS/('api-'+run+'-manifest.json');ops.write(manifest,{'algorithm':'SHA-256','files':files});report_path=CHECKS/('api-'+run+'-release.json')
 candidate={**state,'runtimeDirectory':relative(directory),'previousRuntimeDirectory':state['runtimeDirectory'],'artifactManifest':relative(manifest),'artifactManifestSha256':ops.sha(manifest),'moduleSha256':{name:v['api']for name,v in proof['frozen']['module14parity'].items()},'apiPid':None,'sourceMigrationCount':93,'databaseMigrationCount':93,'tableCount':244,'slice':'D70 Material product workspace and video','codeOnly':False,'newMigrations':1,'newTables':4,'mainSeedPerformed':False,'productWorkspaceApiAccepted':True,'productWorkspaceBrowserQaPending':True,'backendAcceptanceEvidence':relative(acceptance),'localReleaseEvidence':relative(report_path),'fullProjectComplete':False}
 report={'passed':False,'startedAtUtc':m.stamp(),'schemaBefore':92,'schemaAfter':93,'candidate':candidate,'mainSeedPerformed':False,'manualAccountChangePerformed':False,'smsTestSent':False,'acceptanceSha256':ops.sha(acceptance),'recoveryPolicy':'Only compatible93 forward recovery after migration invocation.'};ops.write(report_path,report)
 stop(state,identity)
 try:
  before=snapshot();ops.write(CHECKS/('before-'+run+'.json'),before,private=True);require(shape()=={'migrationCount':92,'tableCount':240},'Baseline changed after stop.')
  backup=m.verified_backup(run,private);backup.update(sourceSchema=92,caller='D70 canonical92 verified immediately before backup');ops.write(ROOT/backup['privateDirectory']/'backup-proof.json',backup,private=True);report['backup']=backup;report['migrationInvoked']=True;ops.write(report_path,report)
  env=previous.dbops.api_environment();env.update(Logging__LogLevel__Default='Warning',Logging__LogLevel__Microsoft='Warning')
  result=subprocess.run(['dotnet',str(directory/'Shop.Api.dll'),'--migrate-product-workspace'],cwd=ROOT,env=env,capture_output=True,text=True,timeout=180);(CHECKS/('migration-'+run+'.log')).write_text(result.stdout+result.stderr)
  require(result.returncode==0 and shape()=={'migrationCount':93,'tableCount':244},'Scoped migration failed; preserve forward recovery state.')
  after=snapshot();report['retainedBindings']=preserve(before,after,contract);ops.write(CHECKS/('after-'+run+'.json'),after,private=True);require(photo.preserved_files()==private,'Existing configuration/keys/media changed.')
  active,checks=start(candidate,CHECKS/('api-'+run+'.log'))
  for locale in('fa','en'):
   record,body=ops.request('/api/storefront/'+locale+'?metadataOnly=true',200);auth=json.loads(body)['authSettings'];require(auth['mobileOtp']is True and auth['registration']is True,'Live customer OTP publication changed.');checks.append(record)
  active.update(healthCheckPassed=True,promotedAtUtc=m.stamp());ops.write(m.CURRENT,active);report.update(passed=True,finishedAtUtc=m.stamp(),runtimeDirectory=active['runtimeDirectory'],apiPid=active['apiPid'],httpChecks=checks,privateKeysMediaPreserved=True);ops.write(report_path,report)
  aggregate=ops.read(m.AGGREGATE);aggregate.update(sourceMigrationCount=93,databaseMigrationCount=93,tableCount=244,productWorkspaceApiAccepted=True,productWorkspaceBrowserQaPending=True,updatedAtUtc=m.stamp());aggregate['componentReleaseEvidence']['api']=relative(report_path);aggregate['lastComponentReleaseEvidence']={'path':relative(report_path),'sha256':ops.sha(report_path)};ops.write(m.AGGREGATE,aggregate)
  print(json.dumps({'passed':True,'schema':93,'tables':244,'apiPid':active['apiPid'],'release':relative(report_path)}))
 except Exception:
  report.update(recoveryRequired=True,failedAtUtc=m.stamp());ops.write(report_path,report)
  if rma.listener('api')is None:
   actual=shape();recover=state if not report.get('migrationInvoked')and actual=={'migrationCount':92,'tableCount':240}else candidate if actual=={'migrationCount':93,'tableCount':244}else None
   if recover:
    restored,_=start(recover,CHECKS/('forward-recovery-'+run+'.log'));report['recoveredApiPid']=restored['apiPid'];ops.write(report_path,report)
  raise
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');parser.add_argument('--acceptance',default='artifacts/checks/d70-product-workspace/run1/acceptance.json');args=parser.parse_args()
 if not args.apply:parser.error('No operation performed; explicit --apply is required.')
 apply(ROOT/args.acceptance)
