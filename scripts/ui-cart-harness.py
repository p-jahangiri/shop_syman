"""Start a loopback-only real SQL/API harness with an isolated temporary customer.

Ctrl+C/SIGTERM removes only its SaymanTest_Ui_* database and generated keys.
No real owner account, MFA, provider or existing browser session is changed.
"""
from pathlib import Path
import argparse,os,re,stat
root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--resume-run',help='Exact owned SaymanTest_Ui_<guid> run; reuses data/keys/identities without seed or migration')
parser.add_argument('--mfa-enrollment-qa',action='store_true',help='Fresh run: add a generated unenrolled CatalogManager for browser MFA setup/QR QA; credentials stay in its private enrollment.json. Resume: require that existing QA identity without changing its enrollment.')
parser.add_argument('--preserve-cart34-on-stop',action='store_true',help='Fresh explicit Cart2 QA only: graceful stop closes the API but preserves its own database and private files for a schema34 restore rehearsal. Default cleanup is unchanged.')
parser.add_argument('--finalize-preserved-cart34-run',help='Recovery only: exact owned stopped Cart2 GUID whose running marker survived a failed shutdown marker write. No API, seed, migration, login or business command; read-only SQL guards then explicit recovery marker.')
args=parser.parse_args()
if os.environ.get('SHOP_UI_ORDER2_QA')=='1' and (
    args.resume_run or args.preserve_cart34_on_stop or args.finalize_preserved_cart34_run
    or any(os.environ.get(flag) is not None for flag in ['SHOP_UI_RESUME_RUN','SHOP_UI_PRESERVE_CART34_ON_STOP','SHOP_UI_FINALIZE_CART34_RUN','SHOP_UI_VERIFY_RESTORE','SHOP_UI_VERIFY_CART34_RESTORE'])
    or any(os.environ.get(flag)!='1' for flag in ['SHOP_UI_CART2_QA','SHOP_UI_ALLOCATION_QA','SHOP_UI_OPERATIONS_QA','SHOP_UI_SUPPLY_QA','SHOP_UI_OFFERS_QA','SHOP_UI_SOURCING_QA'])
):raise SystemExit('Order2 QA requires all six explicit prerequisite flags and a fresh run with default cleanup; resume, Cart34 preservation/finalization and restore modes are forbidden.')
if args.resume_run and not re.fullmatch(r'SaymanTest_Ui_[a-f0-9]{32}',args.resume_run):raise SystemExit('Resume requires an exact disposable UI QA run name.')
if args.preserve_cart34_on_stop and (args.resume_run or any(os.environ.get(flag)!='1' for flag in ['SHOP_UI_CART2_QA','SHOP_UI_ALLOCATION_QA','SHOP_UI_OPERATIONS_QA','SHOP_UI_SUPPLY_QA','SHOP_UI_OFFERS_QA','SHOP_UI_SOURCING_QA'])):raise SystemExit('Preservation requires all six explicit Cart2 QA flags and a fresh run.')
if args.finalize_preserved_cart34_run and (not re.fullmatch(r'SaymanTest_Ui_[a-f0-9]{32}',args.finalize_preserved_cart34_run) or args.resume_run or args.preserve_cart34_on_stop or args.mfa_enrollment_qa):raise SystemExit('Finalize recovery requires only an exact stopped owned Cart2 GUID.')
if args.finalize_preserved_cart34_run:
    # This guard runs before reading SQL configuration. Recovery accepts only
    # the caller-owned exact private tree; no symlink or hardlink traversal.
    for parent in [root/'tmp',root/'tmp/ui-cart']:
        if not parent.is_dir() or parent.is_symlink():raise SystemExit('Finalize recovery rejects a linked or missing QA parent.')
    pending=[root/'tmp/ui-cart'/args.finalize_preserved_cart34_run]
    while pending:
        entry=pending.pop();info=entry.lstat()
        if info.st_uid!=os.getuid() or stat.S_ISLNK(info.st_mode):raise SystemExit('Finalize recovery requires caller-owned unlinked private files.')
        if stat.S_ISDIR(info.st_mode):
            if stat.S_IMODE(info.st_mode)!=0o700:raise SystemExit('Finalize recovery requires exact private directory permissions.')
            pending.extend(entry.iterdir())
        elif not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:raise SystemExit('Finalize recovery requires exact private regular file permissions and no hardlinks.')
config=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if line and not line.startswith('#'))
environment=os.environ.copy()
environment['SHOP_UI_ROOT']=str(root)
if args.finalize_preserved_cart34_run:
    for flag in list(environment):
        if flag.startswith('SHOP_UI_') and flag!='SHOP_UI_ROOT':environment.pop(flag)
    environment['SHOP_UI_FINALIZE_CART34_RUN']=args.finalize_preserved_cart34_run
else:environment.pop('SHOP_UI_FINALIZE_CART34_RUN',None)
if args.resume_run:environment['SHOP_UI_RESUME_RUN']=args.resume_run
else:environment.pop('SHOP_UI_RESUME_RUN',None)
if args.mfa_enrollment_qa:environment['SHOP_UI_MFA_ENROLLMENT_QA']='1'
else:environment.pop('SHOP_UI_MFA_ENROLLMENT_QA',None)
if args.preserve_cart34_on_stop:environment['SHOP_UI_PRESERVE_CART34_ON_STOP']='1'
else:environment.pop('SHOP_UI_PRESERVE_CART34_ON_STOP',None)
environment['SHOP_TEST_SQL_CONNECTION']=f"Server=127.0.0.1,11433;Database=master;User Id=sa;Password={config['SQL_SA_PASSWORD']};TrustServerCertificate=True;Connect Timeout=8"
os.execvpe('dotnet',['dotnet','run','--no-build','--project',str(root/'backend/tests/Shop.UiHarness')],environment)
