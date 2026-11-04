#!/usr/bin/env python3
"""Export a reproducible production source tree without changing the checkout.

The output contains both frontends, their shared imports and the .NET API source.
Tests, local launchers, development datasets, documents and build artifacts stay
in the original checkout. Optional overlay directories supply reviewed hosting
configuration at the same repository-relative paths. No Git command is run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
import xml.etree.ElementTree as ET


SOURCE_ROOTS = (
    "apps/storefront",
    "apps/admin",
    "packages/design-tokens",
    "packages/web-shared",
    "backend/src",
)
COMPONENTS = ("all", "admin", "storefront", "api", "database")
ROOT_FILES = (
    "package.json",
    "package-lock.json",
    "backend/global.json",
    "backend/Directory.Build.props",
    "backend/Directory.Packages.props",
    "backend/Dockerfile",
)
DEPLOYMENT_FILES = (
    "vercel.json",
    "backend/vercel.json",
    "deploy/vercel/Dockerfile",
    "deploy/vercel/entrypoint.sh",
    "deploy/vercel/vercel.json",
)
DEPLOYMENT_ROOTS = ("deploy/vercel", "deploy/railway")
DEPLOYMENT_SUFFIXES = {".json", ".sh", ".py", ".yml", ".yaml", ".toml", ".dockerfile"}
SOURCE_SUFFIXES = {
    ".cs", ".csproj", ".props", ".targets", ".ts", ".tsx", ".js", ".jsx",
    ".mjs", ".cjs", ".json", ".css", ".html", ".svg", ".png", ".webp",
    ".jpg", ".jpeg", ".gif", ".ico", ".avif", ".woff", ".woff2", ".ttf",
    ".otf", ".webmanifest",
}
EXCLUDED_DIRECTORIES = {
    "node_modules", "bin", "obj", "dist", "out", "tmp", "artifacts", "docs",
    "tests", "test", "testing", "__tests__", "__pycache__", "coverage", "TestResults",
    ".vercel", ".cache", ".tools", ".git", ".ssh",
}
SECRET_SUFFIXES = {
    ".pem", ".key", ".pfx", ".p12", ".bak", ".mdf", ".ldf", ".sqlite",
    ".sqlite3", ".dump", ".log",
}
MANIFEST_NAME = "production-source-manifest.json"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def forbidden(relative: str) -> bool:
    path = PurePosixPath(relative)
    name = path.name
    return (
        path.is_absolute()
        or ".." in path.parts
        or any(part in EXCLUDED_DIRECTORIES or part.startswith(".next") for part in path.parts)
        or name.startswith(".env")
        or name in {"AGENTS.md", ".DS_Store", "next-env.d.ts", "appsettings.Local.json", "appsettings.Development.json", "appsettings.Testing.json"}
        or ".test." in name
        or ".test-" in name
        or ".spec." in name
        or path.suffix.lower() in SECRET_SUFFIXES
        or relative == "apps/storefront/public/sw.js"
        or relative.startswith("apps/storefront/public/pwa/fonts/")
        or ("scripts" in path.parts and relative != "apps/storefront/scripts/build-pwa.mjs")
    )


def source_file_allowed(relative: str) -> bool:
    path = PurePosixPath(relative)
    return not forbidden(relative) and (
        path.suffix.lower() in SOURCE_SUFFIXES or path.name == "Dockerfile"
    )


def deployment_file_allowed(relative: str) -> bool:
    path = PurePosixPath(relative)
    return not forbidden(relative) and (
        path.suffix.lower() in DEPLOYMENT_SUFFIXES or path.name == "Dockerfile"
    )


def read_regular(path: Path) -> tuple[bytes, int]:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError(f"Production sources must be regular files: {path}")
    return path.read_bytes(), 0o755 if info.st_mode & 0o111 else 0o644


def files_under(directory: Path):
    if directory.is_symlink():
        raise ValueError(f"Source directories cannot be symlinks: {directory}")
    for base, directories, names in os.walk(directory, followlinks=False):
        kept = []
        for name in sorted(directories):
            if name in EXCLUDED_DIRECTORIES or name.startswith(".next"):
                continue
            child = Path(base) / name
            if child.is_symlink():
                raise ValueError(f"Source directories cannot be symlinks: {child}")
            kept.append(name)
        directories[:] = kept
        for name in sorted(names):
            yield Path(base) / name


def source_snapshot(root: Path) -> dict[str, tuple[bytes, int]]:
    snapshot = {}
    for relative in ROOT_FILES:
        snapshot[relative] = read_regular(root / relative)
    for relative in DEPLOYMENT_FILES:
        path = root / relative
        if path.exists():
            snapshot[relative] = read_regular(path)
    for relative_root in DEPLOYMENT_ROOTS:
        directory = root / relative_root
        if not directory.exists():
            continue
        for path in files_under(directory):
            relative = path.relative_to(root).as_posix()
            if deployment_file_allowed(relative):
                snapshot[relative] = read_regular(path)
    for relative_root in SOURCE_ROOTS:
        directory = root / relative_root
        if not directory.is_dir():
            raise ValueError(f"Required production source directory is missing: {directory}")
        for path in files_under(directory):
            relative = path.relative_to(root).as_posix()
            if source_file_allowed(relative):
                snapshot[relative] = read_regular(path)
    for relative in ("database/compose.sqlserver.yaml", "database/README.md"):
        snapshot[relative] = read_regular(root / relative)
    snapshots = root / "database/sqlserver/snapshots"
    for path in (*sorted(snapshots.glob("*.sql")), snapshots / "README.md"):
        snapshot[path.relative_to(root).as_posix()] = read_regular(path)
    return dict(sorted(snapshot.items()))


def overlay_file_allowed(relative: str) -> bool:
    path = PurePosixPath(relative)
    if forbidden(relative):
        return False
    if relative in ROOT_FILES or relative in DEPLOYMENT_FILES or relative in {".dockerignore", ".gitignore", ".vercelignore"}:
        return True
    if any(relative.startswith(prefix + "/") for prefix in SOURCE_ROOTS):
        return source_file_allowed(relative)
    if any(relative.startswith(prefix + "/") for prefix in DEPLOYMENT_ROOTS):
        return deployment_file_allowed(relative)
    return relative.startswith(".github/workflows/") and path.suffix in {".yml", ".yaml"}


def overlay_snapshot(directory: Path) -> dict[str, tuple[bytes, int]]:
    if not directory.is_dir():
        raise ValueError(f"Overlay directory does not exist: {directory}")
    snapshot = {}
    for path in files_under(directory):
        relative = path.relative_to(directory).as_posix()
        if not overlay_file_allowed(relative):
            raise ValueError(f"Overlay path is outside the production allowlist: {relative}")
        snapshot[relative] = read_regular(path)
    return dict(sorted(snapshot.items()))


def tree_hash(snapshot: dict[str, tuple[bytes, int]]) -> str:
    records = [{"path": name, "sha256": digest(data), "mode": mode} for name, (data, mode) in sorted(snapshot.items())]
    return digest(canonical_json(records))


def production_files(source: dict[str, tuple[bytes, int]]) -> tuple[dict[str, tuple[bytes, int]], list[str]]:
    result = source.copy()
    transforms = []
    allowed_scripts = {
        "package.json": {"build", "start", "build:admin"},
        "apps/storefront/package.json": {"build", "start", "prebuild"},
        "apps/admin/package.json": {"build"},
    }
    for name, allowed in allowed_scripts.items():
        package = json.loads(result[name][0])
        package["scripts"] = {key: value for key, value in package.get("scripts", {}).items() if key in allowed}
        result[name] = canonical_json(package), result[name][1]
        transforms.append(f"{name}: retain production build/start scripts")

    api_project = "backend/src/Shop.Api/Shop.Api.csproj"
    project = ET.fromstring(result[api_project][0])
    removed = 0
    for group in list(project):
        for item in list(group):
            if item.tag == "Content" and item.get("Include", "").startswith("../../data/development/"):
                if item.get("CopyToPublishDirectory") != "Never":
                    raise ValueError("Review the changed development Content reference before exporting.")
                group.remove(item)
                removed += 1
        if not len(group) and not group.attrib and not (group.text or "").strip():
            project.remove(group)
    if removed:
        result[api_project] = ET.tostring(project, encoding="utf-8") + b"\n", result[api_project][1]
        transforms.append(f"{api_project}: omit {removed} unpublished development dataset references")

    dockerfile = "backend/Dockerfile"
    lines = result[dockerfile][0].decode().splitlines(keepends=True)
    clean = []
    in_test_stage = False
    for line in lines:
        text = line.strip()
        if text.upper().startswith("FROM "):
            in_test_stage = text.lower().endswith(" as test")
        if in_test_stage or (text.startswith("COPY ") and "backend/Seed/" in text):
            continue
        clean.append(line)
    result[dockerfile] = "".join(clean).encode(), result[dockerfile][1]
    transforms.append("backend/Dockerfile: omit test stage and development seed copy")

    ignored = "**/node_modules/\n**/.next*/\n**/dist/\n**/bin/\n**/obj/\n.env*\n**/.env*\n**/.vercel/\n*.pfx\n*.pem\n*.key\n"
    result[".gitignore"] = ignored.encode(), 0o644
    result[".dockerignore"] = (ignored + ".git/\n" + MANIFEST_NAME + "\n").encode(), 0o644
    return result, transforms


def export(root: Path, output: Path, overlays: list[Path], component: str = "all") -> dict:
    if component not in COMPONENTS:
        raise ValueError("Unknown production component.")
    if overlays and component != "all":
        raise ValueError("Hosting overlays require the combined export.")
    if output.exists() or output.is_symlink():
        raise ValueError("Output must be a new directory; existing files are never overwritten.")
    if output == root or any(output.is_relative_to(root / prefix) for prefix in (*SOURCE_ROOTS, "database", "deploy", ".git")):
        raise ValueError("Output cannot be the checkout or a source/deployment directory.")
    if any(output == overlay or output.is_relative_to(overlay) for overlay in overlays):
        raise ValueError("Output cannot be inside an overlay directory.")
    source = source_snapshot(root)
    overlay_sources = [overlay_snapshot(directory) for directory in overlays]
    exported, transforms = production_files(source)
    provenance = {name: "source" for name in source}
    for name in exported:
        if name not in source or exported[name] != source[name]:
            provenance[name] = "generated"
    for index, snapshot in enumerate(overlay_sources):
        exported.update(snapshot)
        provenance.update({name: f"overlay:{index + 1}" for name in snapshot})
    if component != "all":
        common = {".gitignore", ".dockerignore"}
        if component in ("admin", "storefront"):
            common.update(("package.json", "package-lock.json"))
            prefixes = (f"apps/{component}/", "packages/")
            package = json.loads(exported["package.json"][0])
            package["workspaces"] = [f"apps/{component}", "packages/*"]
            commands = {"build:admin"} if component == "admin" else {"build", "start"}
            package["scripts"] = {
                key: value for key, value in package["scripts"].items() if key in commands
            }
            exported["package.json"] = canonical_json(package), exported["package.json"][1]
        else:
            prefixes = ("backend/",) if component == "api" else ("database/",)
        exported = {
            name: content for name, content in exported.items()
            if name in common or name.startswith(prefixes)
        }

    # Changes during collection must never produce a mixed source release.
    def assert_stable():
        if source_snapshot(root) != source or any(overlay_snapshot(directory) != snapshot for directory, snapshot in zip(overlays, overlay_sources)):
            raise ValueError("Production source changed during export; coordinate a source freeze and retry.")

    assert_stable()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        entries = []
        for name, (data, mode) in sorted(exported.items()):
            destination = temporary / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            destination.chmod(mode)
            entries.append({"path": name, "sha256": digest(data), "bytes": len(data), "mode": mode, "origin": provenance[name]})
        manifest = {
            "formatVersion": 1,
            "component": component,
            "sourceTreeSha256": tree_hash(source),
            "overlayTreeSha256": [tree_hash(snapshot) for snapshot in overlay_sources],
            "productionTreeSha256": tree_hash(exported),
            "fileCount": len(entries),
            "bytes": sum(entry["bytes"] for entry in entries),
            "transformations": transforms,
            "files": entries,
        }
        (temporary / MANIFEST_NAME).write_bytes(canonical_json(manifest))
        assert_stable()
        temporary.rename(output)
        return manifest
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output", type=Path, required=True, help="New source export directory; never an existing checkout.")
    parser.add_argument("--component", choices=COMPONENTS, default="all")
    parser.add_argument("--overlay", type=Path, action="append", default=[], help="Optional reviewed hosting configuration directory; may be repeated in precedence order.")
    args = parser.parse_args()
    try:
        manifest = export(args.root.resolve(), args.output.resolve(),
                          [directory.resolve() for directory in args.overlay], args.component)
    except (OSError, ValueError, ET.ParseError) as error:
        print(f"Production export failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"output": str(args.output.resolve()), "files": manifest["fileCount"], "bytes": manifest["bytes"], "sha256": manifest["productionTreeSha256"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
