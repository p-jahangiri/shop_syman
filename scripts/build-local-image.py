"""Build one project image with a host-disk guard; never prune shared Docker state."""
from pathlib import Path
import argparse,json,os,shutil,signal,subprocess,time

root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('target',choices=['api','admin','storefront','backend-test'])
builders=parser.add_mutually_exclusive_group()
builders.add_argument('--builder',help='Existing builder to use without changing the global default')
builders.add_argument('--isolated',action='store_true',help='Use an isolated Sayman builder and anonymous config for public base images')
parser.add_argument('--check-only',action='store_true')
parser.add_argument('--platform',choices=['linux/amd64','linux/arm64'],help='Explicit target architecture; does not change the builder default')
args=parser.parse_args()
minimum=10*1024**3;reserve=3*1024**3
def available():return shutil.disk_usage(root).free
if available()<minimum:raise SystemExit('Build not started: at least 10 GiB of host disk space must be free. No Docker data was changed.')
if args.check_only:
    print(f'Capacity guard passed: {available()/1024**3:.1f} GiB free. No build started.');raise SystemExit(0)
targets={'api':('backend/Dockerfile','sayman-api:local',None),'backend-test':('backend/Dockerfile','sayman-api-tests:local','test'),'admin':('apps/admin/Dockerfile','sayman-admin:local',None),'storefront':('apps/storefront/Dockerfile','sayman-storefront:local',None)}
filename,tag,stage=targets[args.target]
environment=os.environ.copy()
if args.isolated:
    endpoint=subprocess.check_output(['docker','context','inspect','--format','{{.Endpoints.docker.Host}}'],text=True,timeout=10).strip()
    if not endpoint.startswith('unix://'):raise SystemExit('The local capacity guard requires a local Unix-socket Docker endpoint.')
    config=root/'tmp/docker-public';config.mkdir(parents=True,exist_ok=True)
    public={'auths':{}}
    plugins=Path('/Applications/Docker.app/Contents/Resources/cli-plugins')
    if plugins.is_dir():public['cliPluginsExtraDirs']=[str(plugins)]
    (config/'config.json').write_text(json.dumps(public));os.chmod(config/'config.json',0o600)
    environment.update({'DOCKER_CONFIG':str(config),'DOCKER_HOST':endpoint});environment.pop('DOCKER_CONTEXT',None)
    args.builder='sayman-build'
    inspect=subprocess.run(['docker','buildx','inspect',args.builder],env=environment,capture_output=True,text=True,timeout=15)
    if inspect.returncode:
        subprocess.run(['docker','buildx','create','--name',args.builder,'--driver','docker-container','--driver-opt','image=moby/buildkit:v0.23.2@sha256:ddd1ca44b21eda906e81ab14a3d467fa6c39cd73b9a39df1196210edcb8db59e','--driver-opt','memory=2147483648'],env=environment,check=True,timeout=30)
command=['docker','buildx','build','--progress','plain','-f',filename,'-t',tag]
if args.platform:command+=['--platform',args.platform]
command+=['--output','type=cacheonly'] if args.target=='backend-test' else ['--load']
if args.builder:command+=['--builder',args.builder]
if stage:command+=['--target',stage]
command+=['.']
print(f'Building {args.target}; host free space {available()/1024**3:.1f} GiB.',flush=True)
process=subprocess.Popen(command,cwd=root,env=environment,start_new_session=True)
cancelled=False
def stop_build():
    for sig,timeout in [(signal.SIGINT,20),(signal.SIGTERM,10),(signal.SIGKILL,5)]:
        if process.poll() is not None:return
        try:os.killpg(process.pid,sig)
        except ProcessLookupError:process.wait();return
        try:process.wait(timeout=timeout);return
        except subprocess.TimeoutExpired:pass
try:
    while process.poll() is None:
        if available()<reserve:
            cancelled=True;print('Cancelling this build: host free space fell below 3 GiB. No prune or volume removal was attempted.',flush=True)
            stop_build()
            break
        time.sleep(2)
except KeyboardInterrupt:
    stop_build();raise SystemExit(130)
raise SystemExit(2 if cancelled else process.returncode)
