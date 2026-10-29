"""Serve the local production build in explicit API mode, bound to localhost."""
from pathlib import Path
from urllib.parse import urlsplit
import os,shutil
root=Path(__file__).resolve().parent.parent
app=root/'apps/storefront';runtime=app/'.next/standalone/apps/storefront'
if not (runtime/'server.js').exists():raise SystemExit('Run npm run build first.')
api=os.environ.get('SHOP_API_URL','http://127.0.0.1:5080');url=urlsplit(api)
if url.scheme not in ['http','https'] or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ['','/']:raise SystemExit('SHOP_API_URL must be an HTTP(S) API origin without credentials or query.')
shutil.copytree(app/'.next/static',runtime/'.next/static',dirs_exist_ok=True)
shutil.copytree(app/'public',runtime/'public',dirs_exist_ok=True)
environment=os.environ.copy();environment.update({'HOSTNAME':'127.0.0.1','PORT':'3000','SHOP_DATA_MODE':'api','SHOP_PUBLIC_URL':os.environ.get('SHOP_PUBLIC_URL','http://127.0.0.1:3000'),'SHOP_API_URL':api.rstrip('/'),'NEXT_TELEMETRY_DISABLED':'1'})
environment.pop('SHOP_ENABLE_PREVIEW',None)
os.execvpe('node',['node',str(runtime/'server.js')],environment)
