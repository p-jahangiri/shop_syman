#!/usr/bin/python3 -I
"""Deploy a GitHub-built test release. This root-owned entry point reads JSON on stdin."""
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path("/opt/sayman")
SHARED = ROOT / "shared"
CONFIG = SHARED / "deploy"
RELEASES = ROOT / "ci-releases"
REPOSITORY = "p-jahangiri/shop_syman"
SERVICES = ("api", "storefront", "admin")
TAG = re.compile(r"test-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


def validate(payload):
    if not isinstance(payload, dict) or set(payload) != {"tag", "sha", "images", "registryUser", "registryToken"}:
        raise ValueError("Invalid release input.")
    tag, sha = payload["tag"], payload["sha"]
    if not isinstance(tag, str) or len(tag) > 40 or not TAG.fullmatch(tag):
        raise ValueError("Expected an immutable test-vMAJOR.MINOR.PATCH tag.")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Expected the full release commit.")
    images = payload["images"]
    if not isinstance(images, dict) or set(images) != set(SERVICES):
        raise ValueError("Expected exactly three application images.")
    for name, image in images.items():
        prefix = re.escape(f"ghcr.io/{REPOSITORY}-arvan-test-{name}@sha256:")
        if not isinstance(image, str) or not re.fullmatch(prefix + r"[0-9a-f]{64}", image):
            raise ValueError("An image is outside the approved registry path or lacks a digest.")
    user, token = payload["registryUser"], payload["registryToken"]
    if not isinstance(user, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?", user):
        raise ValueError("Invalid registry login name.")
    # GitHub issues both opaque and JWT-shaped installation tokens. Pass the value to Docker over stdin.
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{16,8192}", token):
        raise ValueError("Invalid registry login token.")
    return tag, sha, images, user, token


def value(path, name):
    for line in path.read_text().splitlines():
        key, sep, text = line.partition("=")
        if sep and key == name:
            return text.removeprefix("'").removesuffix("'")
    raise ValueError(f"Missing required setting {name}.")


def run(args, *, env=None, text=None, capture=False):
    return subprocess.run(
        args, env=env, input=text, text=True, check=True,
        stdin=subprocess.DEVNULL if text is None else None,
        stdout=subprocess.PIPE if capture else None, timeout=1500,
    ).stdout


def version(tag):
    return tuple(int(part) for part in TAG.fullmatch(tag).groups())


def deploy(tag, sha, images, registry_user, token):
    if shutil.disk_usage("/var/lib/docker").free < 3 * 1024**3:
        raise ValueError("At least 3 GiB of free Docker storage is required.")
    RELEASES.mkdir(exist_ok=True)
    current = RELEASES / "current"
    record = {"tag": tag, "sha": sha, "images": images}
    if current.is_symlink():
        previous = json.loads((current / "release.json").read_text())
        if previous == record:
            print(f"{tag} already deployed.")
            return
        if version(tag) <= version(previous["tag"]):
            raise ValueError("Deploy a new version tag. Existing tags are immutable.")
    target = RELEASES / tag
    target.mkdir(exist_ok=True)
    release_json = target / "release.json"
    if release_json.exists() and json.loads(release_json.read_text()) != record:
        raise ValueError("This tag already points to a different artifact.")
    release_json.write_text(json.dumps(record, indent=2) + "\n")
    images_env = target / "images.env"
    images_env.write_text("".join(f"{name.upper()}_IMAGE={images[name]}\n" for name in SERVICES))

    edge = value(CONFIG / "deploy.env", "SHOP_ORIGIN").startswith("https://")
    compose = [
        "docker", "compose", "--env-file", str(CONFIG / "deploy.env"),
        "--env-file", str(images_env), "--file", str(CONFIG / "compose.yaml"),
        *(["--profile", "edge"] if edge else []),
    ]
    public = ["nginx"] if edge else []
    apps = [*SERVICES, *public]

    with tempfile.TemporaryDirectory(prefix="sayman-registry-") as docker_config:
        env = {**os.environ, "DOCKER_CONFIG": docker_config}
        run(["docker", "login", "ghcr.io", "--username", registry_user, "--password-stdin"], env=env, text=token + "\n")
        run([*compose, "config", "--quiet"], env=env)
        run([*compose, "pull", *SERVICES], env=env)
        for image in images.values():
            revision = run(["docker", "image", "inspect", image, "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}'], env=env, capture=True)
            if revision.strip() != sha:
                raise ValueError("Image revision does not match the release commit.")
        if edge:
            run([*compose, "run", "--rm", "--no-deps", "-T", "nginx", "nginx", "-t"], env=env)
        run([*compose, "stop", "--timeout", "30", *apps], env=env)
        try:
            backup = SHARED / "backup"
            backup.mkdir(exist_ok=True)
            stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            name = f"sayman-{tag}-{stamp}.bak"
            path = "/var/opt/mssql/data/" + name
            sqlcmd = 'export SQLCMDPASSWORD="$MSSQL_SA_PASSWORD"; exec /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -r1 "$@"'
            query = f"BACKUP DATABASE [Sayman] TO DISK=N'{path}' WITH COPY_ONLY, CHECKSUM; RESTORE VERIFYONLY FROM DISK=N'{path}' WITH CHECKSUM;"
            run([*compose, "exec", "-T", "sql", "bash", "-c", sqlcmd, "sqlcmd", "-Q", query], env=env)
            run([*compose, "cp", f"sql:{path}", str(backup / name)], env=env)
            (backup / name).chmod(0o600)
            with tarfile.open(backup / f"identity-{tag}-{stamp}.tar.gz", "w:gz") as archive:
                for item in ("identity-keys", "identity.pfx", "runtime.env"):
                    archive.add(SHARED / item, arcname=item)

            password = value(SHARED / "sql.env", "MSSQL_SA_PASSWORD")
            migration = f"Server=sql,1433;Database=Sayman;User ID=sa;Password={password};Encrypt=True;TrustServerCertificate=True;Connect Timeout=10"
            run([*compose, "run", "--rm", "--no-deps", "-T", "-e", "ConnectionStrings__Shop", "api", "--migrate"], env={**env, "ConnectionStrings__Shop": migration})
            run([*compose, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "240", *apps], env=env)
            for url in ("http://127.0.0.1:13000/fa", "http://127.0.0.1:13000/en", "http://127.0.0.1:13173/"):
                run(["curl", "--fail", "--silent", "--show-error", "--max-time", "25", "--output", "/dev/null", url])
        except (subprocess.SubprocessError, OSError, ValueError):
            subprocess.run([*compose, "stop", "--timeout", "30", *apps], env=env, check=False, stdin=subprocess.DEVNULL)
            (target / "failed").write_text("Release did not pass readiness. Retain the backup and migrate forward.\n")
            raise

        (target / "healthy").touch()
        next_link = RELEASES / ".current-next"
        next_link.unlink(missing_ok=True)
        next_link.symlink_to(target.name)
        next_link.replace(current)
        print(f"Healthy: {tag} ({sha}).")

    retained = sorted(
        (folder for folder in RELEASES.iterdir() if TAG.fullmatch(folder.name) and (folder / "healthy").is_file()),
        key=lambda folder: version(folder.name), reverse=True,
    )
    kept_images = {image for folder in retained[:2] for image in json.loads((folder / "release.json").read_text())["images"].values()}
    for folder in retained[2:]:
        for image in json.loads((folder / "release.json").read_text())["images"].values():
            if image not in kept_images:
                subprocess.run(["docker", "image", "rm", image], check=False, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    os.umask(0o077)
    data = sys.stdin.buffer.read(32769)
    if len(data) > 32768:
        raise ValueError("Release input is too large.")
    release = validate(json.loads(data))
    with (SHARED / ".ci-deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        deploy(*release)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(f"Deployment failed ({type(exc).__name__}). Inspect the stage output on the server.", file=sys.stderr)
        sys.exit(1)
