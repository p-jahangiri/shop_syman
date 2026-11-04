"""Build the canonical frontend sources offline, preserving the running services.

Outputs are private build artifacts, never extra listeners or databases. Record
source hashes before and after both builds so a concurrent edit rejects the set.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import uuid


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--only', choices=['admin', 'storefront'])
parser.add_argument('--label', default='Local frontend quality')
parser.add_argument('--min-api-migrations', type=int, default=None)
arguments = parser.parse_args()
if arguments.min_api_migrations is not None and not 1 <= arguments.min_api_migrations <= 10000:
    parser.error('Minimum API migration count must be between 1 and 10000.')
targets = [arguments.only] if arguments.only else ['storefront', 'admin']

root = Path(__file__).resolve().parents[2]
app = root / "apps/storefront"
run = uuid.uuid4().hex
next_directory = ".next-qa-quality-" + run
admin_directory = root / ("tmp/admin-build-quality-" + run)
report_path = root / "tmp/frontend-quality-build.json"
if shutil.disk_usage(root).free < 2 * 1024**3:
    raise SystemExit("At least 2 GiB free space is required for these offline builds.")


def source_hashes():
    files = set()
    for folder in [
        "apps/storefront/app", "apps/storefront/components", "apps/storefront/lib",
        "apps/storefront/public", "apps/storefront/scripts", "apps/storefront/tests",
        "apps/admin/src", "apps/admin/public", "apps/admin/tests", "packages", "tools/lint",
    ]:
        files.update(
            p for p in (root / folder).rglob("*")
            if p.is_file() and "node_modules" not in p.parts
            and str(p.relative_to(root)) not in ["apps/storefront/public/sw.js",
                "apps/storefront/public/pwa/fonts/vazirmatn-arabic.woff2",
                "apps/storefront/public/pwa/fonts/vazirmatn-latin.woff2",
                "apps/storefront/public/pwa/fonts/LICENSE.txt"]
        )
    for folder in ["apps/admin", "apps/storefront"]:
        files.update(p for p in (root / folder).iterdir() if p.is_file()
                     and p.suffix in [".ts", ".tsx", ".json", ".mjs", ".html"]
                     and p.name not in ["next-env.d.ts", "tsconfig.tsbuildinfo"])
    files.update(root / p for p in ["package.json", "package-lock.json", "eslint.config.mjs"])
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(files)}


generated = {p: p.read_bytes() if p.exists() else None
             for p in [app / "next-env.d.ts", app / "tsconfig.json"]}
before = source_hashes()
environment = os.environ.copy()
environment.update(SHOP_ISOLATED_BUILD="1", SHOP_QA_DIRECTORY=next_directory,
                   SHOP_DATA_MODE="api", SHOP_API_URL="http://127.0.0.1:5080",
                   SHOP_PUBLIC_URL="http://127.0.0.1:3000", NEXT_TELEMETRY_DISABLED="1")
environment.pop("SHOP_ENABLE_PREVIEW", None)
report = {"run": run, "startedAtUtc": datetime.now(timezone.utc).isoformat(),
          "nextDirectory": str((app / next_directory).relative_to(root)),
          "adminDirectory": str(admin_directory.relative_to(root)),
          "slice": arguments.label, "extraListeners": 0, "databaseMigrations": 0, "source": before,
          "passed": False, "targets": targets, "steps": [], "apiMinimumMigrationCount": arguments.min_api_migrations}
try:
    for name, command in [
        ("storefront", ["npm", "run", "build", "--workspace", "@sayman/storefront"]),
        ("admin", ["npm", "run", "build", "--workspace", "@sayman/admin", "--",
                   "--outDir", str(admin_directory)]),
    ]:
        if name not in targets:
            continue
        log = root / ("artifacts/checks/frontend-" + run + "-" + name + "-build.log")
        with log.open("w") as output:
            result = subprocess.run(command, cwd=root, env=environment,
                                    stdout=output, stderr=subprocess.STDOUT)
        report["steps"].append({"name": name, "exitCode": result.returncode,
                                "log": str(log.relative_to(root))})
        if result.returncode:
            raise SystemExit(name + " build failed; see " + str(log))
        print(name + " build passed", flush=True)
finally:
    for path, content in generated.items():
        if content is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(content)
    report["sourceStableDuringBuild"] = before == source_hashes()
    report["passed"] = (len(report["steps"]) == len(targets)
                         and all(step["exitCode"] == 0 for step in report["steps"])
                         and report["sourceStableDuringBuild"])
    report["finishedAtUtc"] = datetime.now(timezone.utc).isoformat()
    encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    (root / ("artifacts/checks/frontend-build-" + run + ".json")).write_text(encoded)
    report_path.write_text(encoded)
if not report["passed"]:
    raise SystemExit("Source changed while building; do not publish this artifact set.")
print(str(report_path.relative_to(root)), flush=True)
