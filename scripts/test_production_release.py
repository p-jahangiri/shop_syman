"""Production validation and deploy ordering; uses only short-lived command stubs."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('production_release', Path(__file__).with_name('production_release.py'))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
REPO = Path(__file__).resolve().parents[1]


class ProductionReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sayman-release-', dir='/tmp')
        self.base = Path(self.temporary.name).resolve()
        self.root = self.base / 'host'
        self.bundle = self.base / 'v1.2.3-deadbeef'
        self.shared = self.root / 'shared'
        self.shared.mkdir(parents=True)
        self.bundle.mkdir()
        self.data = {
            'schema': 1, 'tag': 'v1.2.3', 'revision': 'a' * 40,
            'repository': 'p-jahangiri/shop_syman', 'platform': 'linux/amd64',
            'storefront_url': 'https://shop.example.com',
            'images': {name: f'ghcr.io/p-jahangiri/shop_syman-{name}@sha256:{"b" * 64}'
                       for name in ('api', 'storefront', 'admin')},
        }
        self.write_manifest()
        self.environment = self.shared / 'production.env'
        self.environment.write_text(
            "SHOP_DOMAIN=shop.example.com\nADMIN_DOMAIN=admin.example.com\n"
            f"NGINX_IMAGE=nginx:stable-alpine@sha256:{'c' * 64}\n"
            "ConnectionStrings__Shop='Server=sql;User Id=runtime;Password=runtime-only'\n"
            "MIGRATION_CONNECTION_STRING='Server=sql;User Id=migrator;Password=migration-only'\n"
            "DataProtection__CertificatePassword='pfx-test-password'\n"
            f"Auth__SigningKey='{'k' * 64}'\n"
            'Media__Storage=Disabled\nFiles__Storage=Disabled\n'
        )
        self.environment.chmod(0o600)
        (self.shared / 'identity-keys').mkdir()
        (self.shared / 'tls').mkdir()
        for relative in ['identity-encryption.pfx', 'tls/fullchain.pem', 'tls/privkey.pem']:
            (self.shared / relative).write_text('fixture-not-a-real-certificate')
        self.hook = self.shared / 'pre-migrate-backup'
        self.hook.write_text('#!/bin/sh\nexit 0\n')
        self.hook.chmod(0o700)

    def tearDown(self):
        self.temporary.cleanup()

    def write_manifest(self):
        (self.bundle / 'release.json').write_text(json.dumps(self.data))

    def test_immutable_repository_bound_images_required(self):
        for image in ['ghcr.io/p-jahangiri/shop_syman-api:latest',
                      f'ghcr.io/attacker/api@sha256:{"b" * 64}']:
            with self.subTest(image=image):
                self.data['images']['api'] = image
                self.write_manifest()
                with self.assertRaises(ValueError):
                    release.manifest(self.bundle / 'release.json')

    def test_semver_platform_and_https_are_checked(self):
        original = copy.deepcopy(self.data)
        for key, value in [('tag', 'v1.2.03'), ('tag', 'v1.2.3;echo x'),
                           ('platform', 'linux/arm64'), ('storefront_url', 'http://shop.example.com'),
                           ('storefront_url', 'https://shop.example.com/')]:
            with self.subTest(key=key, value=value):
                self.data = copy.deepcopy(original)
                self.data[key] = value
                self.write_manifest()
                with self.assertRaises(ValueError):
                    release.manifest(self.bundle / 'release.json')

    def test_runtime_env_has_no_migration_secret_and_private_permissions(self):
        release.prepare(self.bundle, self.root)
        runtime = (self.shared / 'runtime.env').read_text()
        self.assertIn('runtime-only', runtime)
        self.assertNotIn('migration-only', runtime)
        self.assertNotIn('MIGRATION_CONNECTION_STRING', runtime)
        self.assertEqual((self.shared / 'runtime.env').stat().st_mode & 0o777, 0o600)
        generated = (self.bundle / 'release.env').read_text()
        self.assertIn('API_IMAGE=ghcr.io/', generated)
        self.assertNotIn('Password', generated)

    def test_unprotected_secret_file_and_wrong_baked_domain_rejected(self):
        self.environment.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'mode 600'):
            release.prepare(self.bundle, self.root)
        self.environment.chmod(0o600)
        self.data['storefront_url'] = 'https://other.example.com'
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'differs'):
            release.prepare(self.bundle, self.root)

    def test_dotenv_never_executes_shell_or_interpolates(self):
        marker = self.base / 'should-not-exist'
        self.environment.write_text(f"VALUE=$(touch {marker})\n")
        with self.assertRaises(ValueError):
            release.dotenv(self.environment)
        self.assertFalse(marker.exists())
        self.environment.write_text("VALUE='literal$dollar`text`'\n")
        self.assertEqual(release.dotenv(self.environment)['VALUE'], 'literal$dollar`text`')

    def test_missing_backup_and_development_storage_fail_before_deployment(self):
        self.hook.unlink()
        with self.assertRaisesRegex(ValueError, 'pre-migrate-backup'):
            release.prepare(self.bundle, self.root)
        self.hook.write_text('#!/bin/sh\nexit 0\n')
        self.hook.chmod(0o700)
        self.environment.write_text(self.environment.read_text().replace('Media__Storage=Disabled', 'Media__Storage=Filesystem'))
        with self.assertRaisesRegex(ValueError, 'Disabled or S3'):
            release.prepare(self.bundle, self.root)

    def test_s3_uses_nested_credentials_https_and_separate_buckets(self):
        original = self.environment.read_text()
        public = ("Media__S3__Endpoint=https://objects.example.com\n"
                  "Media__S3__Bucket=public-images\nMedia__S3__AccessKey='public-key'\n"
                  "Media__S3__SecretKey='public-secret'\n")
        self.environment.write_text(original.replace('Media__Storage=Disabled', 'Media__Storage=S3') + public)
        release.prepare(self.bundle, self.root)
        self.environment.write_text(self.environment.read_text().replace('https://objects.example.com', 'http://objects.example.com'))
        with self.assertRaisesRegex(ValueError, 'HTTPS root URL'):
            release.prepare(self.bundle, self.root)
        private = ("Files__S3__Endpoint=https://objects.example.com\n"
                   "Files__S3__Bucket=public-images\nFiles__S3__AccessKey='private-key'\n"
                   "Files__S3__SecretKey='private-secret'\n")
        self.environment.write_text(original.replace('Media__Storage=Disabled', 'Media__Storage=S3').replace('Files__Storage=Disabled', 'Files__Storage=S3') + public + private)
        with self.assertRaisesRegex(ValueError, 'separate S3 buckets'):
            release.prepare(self.bundle, self.root)

    def api_environment(self):
        path = self.shared / 'api-production.env'
        path.write_text(self.environment.read_text() +
                        "API_DOMAIN=api.example.com\nSTOREFRONT_ORIGIN=https://shop.vercel.app\n"
                        "ADMIN_ORIGIN=https://admin.vercel.app\n" +
                        f"API_IMAGE=ghcr.io/p-jahangiri/shop_syman-api@sha256:{'d' * 64}\n")
        path.chmod(0o600)
        return path

    def test_api_only_requires_https_origins_and_strips_migration_secret(self):
        path = self.api_environment()
        release.prepare_api(self.root)
        runtime = (self.shared / 'api-runtime.env').read_text()
        self.assertIn('runtime-only', runtime)
        self.assertNotIn('migration-only', runtime)
        self.assertNotIn('API_IMAGE', runtime)
        self.assertIn('API_RUNTIME_ENV_FILE=', (self.shared / 'api-release.env').read_text())
        path.write_text(path.read_text().replace('https://shop.vercel.app', 'http://shop.vercel.app'))
        with self.assertRaisesRegex(ValueError, 'exact HTTPS origin'):
            release.prepare_api(self.root)

    def test_api_only_rejects_mutable_api_image(self):
        path = self.api_environment()
        path.write_text(path.read_text().replace(f'@sha256:{"d" * 64}', ':latest'))
        with self.assertRaisesRegex(ValueError, 'pinned by sha256'):
            release.prepare_api(self.root)

    def shell_fixture(self, failure=''):
        scripts = self.bundle / 'scripts'
        scripts.mkdir()
        for name in ['deploy-production.sh', 'production_release.py']:
            shutil.copy(REPO / 'scripts' / name, scripts / name)
        (self.bundle / 'compose.production.yaml').write_text('fixture')
        (self.bundle / 'SHA256SUMS').write_text('fixture')
        previous = self.base / 'previous-release'
        previous.mkdir()
        (self.root / 'current').symlink_to(previous)
        binary = self.base / 'bin'
        binary.mkdir()
        commands = {
            'uname': '#!/bin/sh\nif [ "$1" = -s ]; then echo Linux; else echo x86_64; fi\n',
            'flock': '#!/bin/sh\nexit 0\n',
            'sha256sum': '#!/bin/sh\nexit 0\n',
            'timeout': '#!/bin/sh\nshift 3\nexec "$@"\n',
            'curl': '#!/bin/sh\necho "curl $*" >> "$TEST_LOG"\nprintf 200\n',
            'mv': '#!/usr/bin/env python3\nimport os, sys\nos.replace(sys.argv[-2], sys.argv[-1])\n',
            'docker': '''#!/bin/sh
printf 'docker' >> "$TEST_LOG"
for arg in "$@"; do printf ' %s' "$arg" >> "$TEST_LOG"; done
printf '\\n' >> "$TEST_LOG"
case "$*" in
  *--migrate*)
    printf 'migration-principal=%s\\n' "$ConnectionStrings__Shop" >> "$TEST_LOG"
    [ "$TEST_FAILURE" != migrate ] || exit 42 ;;
esac
''',
        }
        for name, content in commands.items():
            path = binary / name
            path.write_text(content)
            path.chmod(0o700)
        self.hook.write_text('#!/bin/sh\necho backup >> "$TEST_LOG"\n[ "$TEST_FAILURE" != backup ]\n')
        self.hook.chmod(0o700)
        env = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ['PATH'],
                   TEST_LOG=str(self.base / 'commands.log'), TEST_FAILURE=failure)
        process = subprocess.run(['bash', str(scripts / 'deploy-production.sh'), str(self.root)],
                                 env=env, text=True, capture_output=True)
        log = self.base / 'commands.log'
        return process, log.read_text() if log.exists() else process.stderr, previous

    def test_order_backup_migration_start_tls_and_current_metadata(self):
        process, log, previous = self.shell_fixture()
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertLess(log.index(' pull'), log.index(' stop'))
        self.assertLess(log.index(' stop'), log.index('backup\n'))
        self.assertLess(log.index('backup\n'), log.index('--migrate'))
        self.assertLess(log.index('--migrate'), log.index(' up --detach --wait'))
        self.assertLess(log.index(' up --detach --wait'), log.index('curl '))
        self.assertIn('--resolve shop.example.com:443:127.0.0.1', log)
        self.assertNotIn(' --insecure ', log)
        self.assertIn('User Id=migrator', log)
        self.assertEqual((self.root / 'current').resolve(), self.bundle)
        self.assertEqual((self.root / 'deployments' / (self.bundle.name + '.previous')).read_text().strip(), str(previous))

    def test_failed_migration_keeps_previous_metadata_and_no_public_restart(self):
        process, log, previous = self.shell_fixture('migrate')
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual((self.root / 'current').resolve(), previous)
        self.assertNotIn(' up --detach --wait', log)
        self.assertEqual(log.count(' stop '), 2)
        self.assertIn('no database downgrade', process.stderr)

    def test_failed_backup_never_migrates_or_starts(self):
        process, log, previous = self.shell_fixture('backup')
        self.assertNotEqual(process.returncode, 0)
        self.assertNotIn('--migrate', log)
        self.assertNotIn(' up --detach --wait', log)
        self.assertEqual((self.root / 'current').resolve(), previous)


if __name__ == '__main__':
    unittest.main()
