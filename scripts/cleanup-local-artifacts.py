"""Remove superseded build copies inside tmp; keep current/rollback runtimes and private data.

Default is read-only. This retention set is deliberately conservative for local release40.
SQL, Docker, backups, keys, evidence, source helpers and files outside tmp are never removed.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, os, shutil, subprocess

ROOT=Path(__file__).resolve().parent.parent
TMP=ROOT/'tmp'
parser=argparse.ArgumentParser()
parser.add_argument('--apply',action='store_true')
args=parser.parse_args()
assert TMP.is_dir() and not TMP.is_symlink()
def digest(directory):
    h=hashlib.sha256(); count=0; size=0
    for p in sorted(directory.rglob('*')):
        if p.is_symlink():
            h.update(p.relative_to(directory).as_posix().encode()+b'\0link\0'+os.readlink(p).encode());continue
        if not p.is_file():continue
        size+=p.stat().st_size;count+=1
        h.update(p.relative_to(directory).as_posix().encode()+b'\0')
        with p.open('rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return {'files':count,'logicalBytes':size,'treeSha256':h.hexdigest()}
protected=set()
for kind in ['api','storefront','admin']:
    d=json.loads((TMP/f'{kind}-runtime-current.json').read_text())
    for key in ['runtimeDirectory','previousRuntimeDirectory','servingRoot']:
        if d.get(key):protected.add((ROOT/d[key]).resolve())
    # Current restart guards also validate the frozen candidate, even when a
    # main-serving copy was made to retain older static assets.
    evidence=d.get('localReleaseEvidence')
    report=(ROOT/evidence).resolve() if evidence else None
    if report and report.is_relative_to(ROOT/'artifacts/checks') and report.is_file():
        entry=json.loads(report.read_text());ref=entry.get('runtimeSet')
        pair=(ROOT/ref).resolve() if ref else None
        if pair and pair.is_relative_to(TMP) and pair.is_file():
            frozen=json.loads(pair.read_text())
            for key in ['apiRuntime','storefrontRuntime','adminRuntime']:
                if frozen.get(key):
                    dependency=(ROOT/frozen[key]).resolve()
                    if dependency.is_relative_to(TMP) and dependency.is_dir():protected.add(dependency)
# Restart verification and comparison rollback still use these artifact families.
for p in TMP.iterdir():
    if p.is_dir() and any(s in p.name for s in ['reviews','comparison','cms-menu']):protected.add(p.resolve())
for name in ['identity-keys','local-backups','restore','dotnet-tools','docker-public','pdfs','i18n']:
    p=TMP/name
    if p.is_dir():protected.add(p.resolve())
def build_kind(p):
    if p.is_symlink() or not p.is_dir() or p.parent!=TMP:return None
    if p.name.startswith('api-runtime-') and (p/'Shop.Api.dll').is_file() and (p/'Shop.Api.runtimeconfig.json').is_file():return 'superseded API build'
    if p.name.startswith('storefront-runtime-') and (p/'apps/storefront/server.js').is_file():return 'superseded standalone Next build'
    admin_name=p.name.startswith(('admin-runtime-','admin-before-','admin-')) or p.name.endswith(('-dist','-final')) or '-admin-' in p.name
    if admin_name and (p/'index.html').is_file() and (p/'assets').is_dir():return 'superseded Vite build'
    return None
targets=[(p,build_kind(p)) for p in sorted(TMP.iterdir()) if p.resolve() not in protected and build_kind(p)]
# Refuse deletion if any target is mentioned by a live process or currently open file.
# Commands and unrelated filenames are inspected in memory and never printed or saved.
processes=subprocess.run(['ps','-axo','pid=,command='],capture_output=True,text=True,check=True).stdout
opened=subprocess.run(['lsof','-n','-F','n'],capture_output=True,text=True).stdout
for p,_ in targets:
    if str(p) in processes or str(p) in opened or ('tmp/'+p.name) in processes:
        raise SystemExit('Refused: a candidate build is referenced by a live process.')
free_before=shutil.disk_usage(ROOT).free
report={'scope':'project tmp superseded build directories only','atUtc':datetime.now(timezone.utc).isoformat(),'apply':args.apply,'retained':sorted(str(p.relative_to(ROOT)) for p in protected),'targets':[{'path':str(p.relative_to(ROOT)),'reason':kind,**digest(p)} for p,kind in targets],'freeBytesBefore':free_before}
output=ROOT/'artifacts/checks'/('tmp-cleanup-applied.json' if args.apply else 'tmp-cleanup-plan.json')
if output.exists():raise SystemExit('Evidence file already exists; inspect the previous cleanup before another run.')
if args.apply:
    retained={str(p.relative_to(ROOT)):digest(p) for p in sorted(protected)}
    report['retainedBefore']=retained
    for p,_ in targets:
        assert p.parent==TMP and not p.is_symlink() and p.resolve() not in protected and build_kind(p)
        shutil.rmtree(p)
    after={str(p.relative_to(ROOT)):digest(p) for p in sorted(protected)}
    report['retainedAfter']=after
    report['retainedExact']=after==retained
    report['removedCount']=sum(not p.exists() for p,_ in targets)
    report['freeBytesAfter']=shutil.disk_usage(ROOT).free
    report['freeBytesIncrease']=report['freeBytesAfter']-free_before
    report['passed']=report['retainedExact'] and report['removedCount']==len(targets)
output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'applied':args.apply,'directories':len(targets),'logicalGiB':round(sum(t['logicalBytes'] for t in report['targets'])/1024**3,2),'freeGiB':round(shutil.disk_usage(ROOT).free/1024**3,2),'freeIncreaseGiB':round(report.get('freeBytesIncrease',0)/1024**3,2),'preservedExact':report.get('retainedExact'),'evidence':str(output.relative_to(ROOT))}))
