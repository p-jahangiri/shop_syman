"""Serve the exact local standalone build, bound only to localhost."""
from pathlib import Path
import os,shutil
root=Path(__file__).resolve().parent.parent
app=root/'apps/storefront'
runtime=app/'.next/standalone/apps/storefront'
if not (runtime/'server.js').exists():raise SystemExit('Run npm run build first.')
shutil.copytree(app/'.next/static',runtime/'.next/static',dirs_exist_ok=True)
shutil.copytree(app/'public',runtime/'public',dirs_exist_ok=True)
environment=os.environ.copy();environment.update({'HOSTNAME':'127.0.0.1','PORT':'3000','SHOP_DATA_MODE':'preview','SHOP_ENABLE_PREVIEW':'true','NEXT_TELEMETRY_DISABLED':'1'})
os.execvpe('node',['node',str(runtime/'server.js')],environment)
