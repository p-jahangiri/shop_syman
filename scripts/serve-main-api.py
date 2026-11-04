"""Start the selected, hash-verified canonical local API. Never migrates or seeds."""
from pathlib import Path
import hashlib
import json
import os

root = Path(__file__).resolve().parent.parent
descriptor = root / 'tmp/api-runtime-current.json'
state = json.loads(descriptor.read_text())
if state.get('api') != 'http://127.0.0.1:5080' or state.get('databaseMigrationCount') != state.get('sourceMigrationCount'):
    raise SystemExit('Expected the canonical local API with a matching schema descriptor.')
runtime = (root / state['runtimeDirectory']).resolve()
if not runtime.is_relative_to(root / 'tmp'):
    raise SystemExit('Runtime must be inside the shop workspace tmp directory.')
for name, expected in state['moduleSha256'].items():
    if Path(name).name != name or hashlib.sha256((runtime / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Selected API module differs from its accepted build.')
if state.get('artifactManifest'):
    manifest_path = (root / state['artifactManifest']).resolve()
    if not manifest_path.is_relative_to(root / 'artifacts/checks') or hashlib.sha256(manifest_path.read_bytes()).hexdigest() != state.get('artifactManifestSha256'):
        raise SystemExit('Selected API artifact manifest changed.')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('algorithm') != 'SHA-256' or not manifest.get('files'):
        raise SystemExit('Expected a complete API artifact manifest.')
    actual = {str(file.relative_to(runtime)) for file in runtime.rglob('*') if file.is_file()}
    if actual != set(manifest['files']):
        raise SystemExit('Selected API runtime file set changed.')
    for name, expected in manifest['files'].items():
        file = (runtime / name).resolve()
        if not file.is_relative_to(runtime) or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise SystemExit('Selected API runtime artifact changed.')
settings = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines() if line and not line.startswith('#'))
keys = root / 'tmp/identity-keys'
if not keys.is_dir() or not any(keys.glob('*.xml')):
    raise SystemExit('Existing local Data Protection keys are required.')
environment = os.environ.copy()
environment.update(
    ASPNETCORE_ENVIRONMENT='Development', ASPNETCORE_URLS='http://127.0.0.1:5080',
    ASPNETCORE_CONTENTROOT=str(root / 'backend/src/Shop.Api'), DataProtection__KeyDirectory=str(keys),
    ConnectionStrings__Shop=f"Server=127.0.0.1,11433;Database=Sayman;User Id=sa;Password={settings['SQL_SA_PASSWORD']};TrustServerCertificate=True;Connect Timeout=8",
    Auth__SigningKey=settings['AUTH_SIGNING_KEY'], Bootstrap__AdminPassword=settings['BOOTSTRAP_ADMIN_PASSWORD'],
    Files__Storage='Disabled', PhoneDiscovery__AutomaticNotificationsEnabled='true',
    Cors__AdminOrigins__0='http://127.0.0.1:3173')
for index, origin in enumerate(['http://127.0.0.1:3173', 'http://127.0.0.1:3000']):
    environment[f'Cors__Origins__{index}'] = origin
media_file = root / 'tmp/public-media-local.json'
if media_file.exists():
    media = json.loads(media_file.read_text())
    if media != {'storage': 'Filesystem', 'scannerHost': '127.0.0.1', 'scannerPort': 13310}:
        raise SystemExit('Invalid local public image configuration.')
    environment.update(Media__Storage='Filesystem', Media__Directory=str(root / 'tmp/public-media-objects'),
                       Media__ClamAvHost=media['scannerHost'], Media__ClamAvPort=str(media['scannerPort']))
    # Attachments are encrypted by the private vault. Never share the public object directory.
    private_files = root / 'tmp/private-file-objects'
    private_files.mkdir(mode=0o700, exist_ok=True)
    if private_files.is_symlink() or not private_files.is_dir() or private_files.stat().st_mode & 0o077:
        raise SystemExit('Private attachment storage must be a real directory restricted to its owner.')
    environment.update(Files__Storage='Filesystem', Files__Directory=str(private_files),
                       Files__ClamAvHost=media['scannerHost'], Files__ClamAvPort=str(media['scannerPort']))
# Video processing uses trusted installed tools; absence keeps upload unavailable.
ffmpeg = Path('/opt/homebrew/bin/ffmpeg' if os.uname().sysname == 'Darwin' else '/usr/bin/ffmpeg')
ffprobe = ffmpeg.with_name('ffprobe')
if ffmpeg.is_file() and ffprobe.is_file():
    environment.update(Media__Video__FfmpegPath=str(ffmpeg), Media__Video__FfprobePath=str(ffprobe))
state['apiPid'] = os.getpid()
temporary = descriptor.with_suffix('.next.json')
temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
os.replace(temporary, descriptor)
os.execvpe('dotnet', ['dotnet', str(runtime / 'Shop.Api.dll')], environment)
