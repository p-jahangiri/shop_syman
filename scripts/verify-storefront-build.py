"""Run the HTTP preview smoke against an owned standalone process, then stop it."""
from pathlib import Path
import http.client, os, socket, subprocess, sys, time

root=Path(__file__).resolve().parent.parent
environment=os.environ.copy(); environment['SHOP_PUBLIC_URL']='http://127.0.0.1:3000'
with socket.socket() as listener:
    listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    try: listener.bind(('127.0.0.1',3000))
    except OSError: raise SystemExit('Port 3000 is already in use; stop the owned storefront process first.')
process=subprocess.Popen([sys.executable,str(root/'scripts/serve-storefront-preview.py')],cwd=root,env=environment)
try:
    for attempt in range(50):
        if process.poll() is not None: raise SystemExit('Standalone process exited before readiness.')
        try:
            connection=http.client.HTTPConnection('127.0.0.1',3000,timeout=1); connection.request('GET','/fa'); response=connection.getresponse(); response.read(); connection.close()
            if response.status==200: break
        except (OSError,http.client.HTTPException): pass
        time.sleep(.2)
    else: raise SystemExit('Standalone server did not become ready.')
    for script,arguments in [('smoke-storefront-public.py',['--report',str(root/'artifacts/checks/pwa-seo-smoke.json')]),('smoke-catalog-gateway.py',[])]:
        subprocess.run([sys.executable,str(root/'scripts'/script),*arguments],cwd=root,env=environment,check=True)
finally:
    process.terminate()
    try: process.wait(timeout=10)
    except subprocess.TimeoutExpired: process.kill(); process.wait()

subprocess.run([sys.executable,str(root/'scripts/verify-catalog-failure.py')],cwd=root,env=environment,check=True)
