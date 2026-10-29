"""Serve the exact build on an isolated *.localhost origin for UI QA only."""
from pathlib import Path
import os,shutil,sys
mode=sys.argv[1] if len(sys.argv)==2 else ''
if mode not in ['preview','api']:raise SystemExit('Choose preview or api explicitly.')
root=Path(__file__).resolve().parent.parent
app=root/'apps/storefront';runtime=app/'.next/standalone/apps/storefront'
if not (runtime/'server.js').exists():raise SystemExit('Build the storefront first.')
shutil.copytree(app/'.next/static',runtime/'.next/static',dirs_exist_ok=True)
shutil.copytree(app/'public',runtime/'public',dirs_exist_ok=True)
environment=os.environ.copy();environment.update({'HOSTNAME':'127.0.0.1','PORT':'3105','SHOP_DATA_MODE':mode,'SHOP_PUBLIC_URL':'http://sayman-ui.localhost:3105','SHOP_API_URL':'http://127.0.0.1:5181','NEXT_TELEMETRY_DISABLED':'1'})
if mode=='preview':environment['SHOP_ENABLE_PREVIEW']='true'
else:environment.pop('SHOP_ENABLE_PREVIEW',None)
os.execvpe('node',['node',str(runtime/'server.js')],environment)
