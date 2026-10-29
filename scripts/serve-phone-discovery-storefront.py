"""Serve only the uniquely built D41 artifact against its isolated SQL API."""
raise SystemExit('D44: persistent phone preview launch is retired. Use the single Main local shop at http://127.0.0.1:3000 and admin at http://127.0.0.1:3173. Historical harness/test sources and reports are retained.')

from pathlib import Path
import json,os,shutil
root=Path(__file__).resolve().parent.parent
report=json.loads((root/'tmp/phone-discovery-next-build.json').read_text())
directory=report['directory']
if report['exitCode']!=0 or not directory.startswith('.next-qa-phones-') or '/' in directory:raise SystemExit('A successful D41 build is required.')
app=root/'apps/storefront'
runtime=app/directory/'standalone/apps/storefront'
if not (runtime/'server.js').is_file():raise SystemExit('Standalone entry is missing.')
shutil.copytree(app/directory/'static',runtime/directory/'static',dirs_exist_ok=True)
shutil.copytree(app/'public',runtime/'public',dirs_exist_ok=True)
environment=os.environ.copy()
environment.update(HOSTNAME='127.0.0.1',PORT='3108',SHOP_ISOLATED_BUILD='1',SHOP_QA_DIRECTORY=directory,SHOP_DATA_MODE='api',SHOP_API_URL='http://127.0.0.1:5183',SHOP_PUBLIC_URL='http://sayman-phone-ui.localhost:3108',NEXT_TELEMETRY_DISABLED='1')
environment.pop('SHOP_ENABLE_PREVIEW',None)
(root/'tmp/phone-discovery-storefront-runtime.json').write_text(json.dumps({'directory':directory,'runtime':str(runtime),'pid':os.getpid(),'port':3108,'apiPort':5183,'mainChanged':False},indent=2)+'\n')
os.execvpe('node',['node',str(runtime/'server.js')],environment)
