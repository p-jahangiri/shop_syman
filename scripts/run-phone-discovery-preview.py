"""Own the D41 review preview processes without tying them to a tool session.

Only localhost QA ports are managed. The main shop ports are never selected.
Stopping the API removes its generated GUID database and test credentials.
"""
from pathlib import Path
import json,os,signal,socket,subprocess,sys,time
root=Path(__file__).resolve().parent.parent
state_path=root/'tmp/phone-discovery-preview-processes.json'
mode=sys.argv[1] if len(sys.argv)==2 else ''
def listening(port):
 try:
  with socket.create_connection(('127.0.0.1',port),timeout=1):return True
 except OSError:return False
if mode=='start':
 raise SystemExit('D44: persistent phone preview launch is retired. Use the single Main local shop at http://127.0.0.1:3000 and admin at http://127.0.0.1:3173. Historical harness/test sources and reports are retained.')
 rows=[]
 for name,port,command in [('api',5183,['python3','scripts/phone-discovery-qa.py']),('storefront',3108,['python3','scripts/serve-phone-discovery-storefront.py']),('admin',3178,['node','tmp/admin-phone-discovery-serve.mjs'])]:
  if listening(port):
   rows.append({'name':name,'port':port,'reused':True});continue
  log_path=root/'artifacts/checks'/('phone-discovery-preview-'+name+'.log')
  with log_path.open('ab',buffering=0) as log:
   child=subprocess.Popen(command,cwd=root,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  rows.append({'name':name,'port':port,'launcherPid':child.pid,'reused':False,'log':str(log_path)})
 state_path.write_text(json.dumps({'syntheticTestOnly':True,'mainChanged':False,'services':rows},indent=2)+'\n')
 print(json.dumps({'started':rows,'mainChanged':False}))
elif mode=='stop':
 state=json.loads(state_path.read_text());assert state['syntheticTestOnly'] and not state['mainChanged']
 for name,port,descriptor in [('storefront',3108,'phone-discovery-storefront-runtime.json'),('api',5183,'phone-discovery-qa-current.json')]:
  if not listening(port):continue
  current=json.loads((root/'tmp'/descriptor).read_text());pid=current['pid'];assert not current['mainChanged']
  listener=subprocess.check_output(['lsof','-nP','-a','-p',str(pid),'-iTCP:'+str(port),'-sTCP:LISTEN','-Fp'],text=True)
  assert ('p'+str(pid)+'\n') in listener;os.kill(pid,signal.SIGTERM)
 # Admin has no business data; its launch record is authoritative when owned.
 row=next(r for r in state['services'] if r['name']=='admin')
 if listening(3178) and row.get('launcherPid'):
  pid=row['launcherPid'];listener=subprocess.check_output(['lsof','-nP','-a','-p',str(pid),'-iTCP:3178','-sTCP:LISTEN','-Fp'],text=True);assert 'p'+str(pid)+'\n' in listener;os.kill(pid,signal.SIGTERM)
 print('Stopped only owned D41 review listeners. API performs its own GUID cleanup.')
elif mode=='status':
 print(json.dumps({'api':listening(5183),'storefront':listening(3108),'admin':listening(3178),'mainChanged':False}))
else:raise SystemExit('Choose start, status or stop explicitly.')
