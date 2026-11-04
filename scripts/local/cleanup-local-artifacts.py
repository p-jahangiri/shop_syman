"""List or remove rebuildable local outputs while preserving releases and data."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TMP = ROOT / "tmp"
CHECKS = ROOT / "artifacts/checks"
SERVICES = ("api", "storefront", "admin")
STORE = ROOT / "apps/storefront"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def project_path(value):
    path = (ROOT / value).resolve()
    if path == ROOT or not path.is_relative_to(ROOT):
        raise SystemExit("Release metadata refers to a path outside the workspace.")
    return path


def release_state():
    protected = set()
    metadata = {}
    current = {}
    for name in SERVICES:
        descriptor = TMP / f"{name}-runtime-current.json"
        if not descriptor.exists():
            continue
        state = current[name] = read_json(descriptor)
        metadata[descriptor] = file_hash(descriptor)
        for key in ("runtimeDirectory", "previousRuntimeDirectory", "servingRoot"):
            if state.get(key):
                protected.add(project_path(state[key]))
        for key in ("artifactManifest", "localReleaseEvidence"):
            if state.get(key):
                record = project_path(state[key])
                if record.is_file():
                    metadata[record] = file_hash(record)
                    if key == "localReleaseEvidence" and (runtime_set := read_json(record).get("runtimeSet")):
                        runtime_set_path = project_path(runtime_set)
                        runtime_manifest = read_json(runtime_set_path)
                        metadata[runtime_set_path] = file_hash(runtime_set_path)
                        for field in ("apiRuntime", "storefrontRuntime", "adminRuntime"):
                            value = runtime_manifest.get(field)
                            if value:
                                protected.add(project_path(value))

    build_file = TMP / "frontend-quality-build.json"
    if build_file.exists():
        build = read_json(build_file)
        metadata[build_file] = file_hash(build_file)
        if build.get("passed"):
            for name, field in (("storefront", "nextDirectory"), ("admin", "adminDirectory")):
                selected = Path(current.get(name, {}).get("runtimeDirectory", "")).name
                if name in build["targets"] and selected != f"{name}-runtime-quality-{build['run']}":
                    protected.add(project_path(build[field]))

    prepared_file = TMP / "frontend-quality-prepared.json"
    if prepared_file.exists():
        metadata[prepared_file] = file_hash(prepared_file)
        for name, service in read_json(prepared_file)["services"].items():
            descriptor = TMP / f"{name}-runtime-current.json"
            if metadata.get(descriptor) == service["previousDescriptorSha256"]:
                protected.add(project_path(service["candidate"]["runtimeDirectory"]))

    # A standalone release can link to dependencies outside its own directory.
    for directory in tuple(protected):
        if directory.is_dir():
            protected.update(path.resolve() for path in directory.rglob("*") if path.is_symlink())
    return protected, metadata


def generated_outputs():
    for path in STORE.glob(".next*"):
        if re.fullmatch(r"\.next(?:-qa(?:-[a-z0-9-]{1,64})?)?", path.name) and (
            (path / "BUILD_ID").is_file() or (path / "types").is_dir() or (path / "cache").is_dir()
        ):
            yield path, "Next.js build and cache"

    for parent in (ROOT / "backend/src", ROOT / "backend/tests", ROOT / "tools/development",
                   ROOT / "tools/legacy/schema-85", ROOT / "backend/.qa-runners",
                   ROOT / "backend/.qa-harness-source"):
        if not parent.is_dir():
            continue
        for project in parent.iterdir():
            if project.is_dir() and any(project.glob("*.csproj")):
                for name in ("bin", "obj", "TestResults"):
                    yield project / name, ".NET build or test output"

    yield ROOT / "apps/admin/dist", "Vite build"
    yield ROOT / "node_modules/.vite", "Vite cache"
    yield STORE / "tsconfig.tsbuildinfo", "TypeScript cache"
    for parent in (ROOT / "scripts", ROOT / "scripts/local", ROOT / "scripts/tests", ROOT / "deploy", TMP):
        yield parent / "__pycache__", "Python cache"
    for parent in (ROOT, ROOT / "apps", STORE, ROOT / "apps/admin", ROOT / "backend",
                   ROOT / "tools", ROOT / "artifacts", TMP):
        yield parent / ".DS_Store", "Finder metadata"

    if TMP.is_dir():
        for path in TMP.iterdir():
            if path.name.startswith("api-runtime-") and (path / "Shop.Api.dll").is_file() and (
                path / "Shop.Api.runtimeconfig.json"
            ).is_file():
                yield path, "superseded .NET runtime"
            elif path.name.startswith("storefront-runtime-") and (
                path / "apps/storefront/server.js"
            ).is_file():
                yield path, "superseded Next.js runtime"
            elif path.name.startswith(("admin-runtime-", "admin-build-quality-")) and (
                (path / "index.html").is_file() and (path / "assets").is_dir()
            ):
                yield path, "superseded Vite build"


def ignored_outputs(protected):
    tracked = set()
    index = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    for entry in index.split(b"\0"):
        if entry:
            path = ROOT / os.fsdecode(entry)
            tracked.update((path, *path.parents))

    candidates = {}
    for path, kind in generated_outputs():
        if not path.exists() or path.resolve() != path or path in tracked:
            continue
        if any(path.is_relative_to(keep) or keep.is_relative_to(path) for keep in protected):
            continue
        candidates[path] = kind
    names = b"".join(os.fsencode(path.relative_to(ROOT)) + b"\0" for path in candidates)
    result = subprocess.run(["git", "check-ignore", "--stdin", "-z"], cwd=ROOT, input=names,
                            capture_output=True, check=False)
    if result.returncode not in (0, 1):
        raise SystemExit("Could not check Git ignore rules.")
    return {ROOT / os.fsdecode(name): candidates[ROOT / os.fsdecode(name)]
            for name in result.stdout.split(b"\0") if name}


def active_outputs(candidates):
    # Keep process arguments and open paths in memory. They may contain secrets.
    try:
        processes = subprocess.check_output(["ps", "-axo", "command="], text=True)
        open_files = subprocess.check_output(["lsof", "-n", "-F", "n"], text=True)
    except (OSError, subprocess.CalledProcessError):
        raise SystemExit("Could not inspect active processes. No artifacts were removed.") from None
    return [path for path in candidates if str(path) in open_files or str(path) in processes
            or str(path.relative_to(ROOT)) in processes]


def size_of(path):
    if path.is_file():
        return path.stat().st_size
    return sum(file.stat().st_size for file in path.rglob("*") if not file.is_symlink() and file.is_file())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Remove the listed outputs.")
    args = parser.parse_args()
    if any(path.resolve() != path for path in (TMP, CHECKS, STORE)):
        raise SystemExit("Expected local runtime, report and source paths without symlinks.")
    protected, metadata = release_state()
    candidates = ignored_outputs(protected)
    active = set(active_outputs(candidates))
    targets = sorted(candidates.keys() - active)
    stats = {path: path.stat() for path in targets}
    report = {
        "applied": args.apply,
        "protected": sorted(str(path.relative_to(ROOT)) for path in protected if path.is_relative_to(ROOT)),
        "preservedMetadataSha256": {str(path.relative_to(ROOT)): digest for path, digest in metadata.items()},
        "skippedInUse": sorted(str(path.relative_to(ROOT)) for path in active),
        "targets": [{"path": str(path.relative_to(ROOT)), "kind": candidates[path], "logicalBytes": size_of(path)}
                    for path in targets],
    }
    free_before = shutil.disk_usage(ROOT).free
    if args.apply:
        if release_state() != (protected, metadata) or active_outputs(targets):
            raise SystemExit("A build or release became active. Run the cleanup again when it finishes.")
        for path in targets:
            current = path.stat(follow_symlinks=False)
            original = stats[path]
            if path.resolve() != path or (current.st_dev, current.st_ino, current.st_mtime_ns) != (
                original.st_dev, original.st_ino, original.st_mtime_ns
            ):
                raise SystemExit("A candidate changed during cleanup.")
        for path in targets:
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
        if any(file_hash(path) != digest for path, digest in metadata.items()):
            raise SystemExit("Release metadata changed during cleanup. Check the current release.")
    report["freeBytesIncrease"] = shutil.disk_usage(ROOT).free - free_before
    CHECKS.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = CHECKS / f"local-artifact-cleanup-{timestamp}.json"
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "applied": args.apply,
        "targets": len(targets),
        "skippedInUse": len(active),
        "logicalGiB": round(sum(item["logicalBytes"] for item in report["targets"]) / 1024**3, 2),
        "freeGiBIncrease": round(report["freeBytesIncrease"] / 1024**3, 2),
        "report": str(output.relative_to(ROOT)),
    }))


if __name__ == "__main__":
    main()
