#!/usr/bin/env python3
"""Validate a release and literal production dotenv without executing either."""
import argparse
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import urlsplit

SEMVER = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
DIGEST = r"sha256:[0-9a-f]{64}"
DOMAIN = re.compile(r"(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\Z")


def dotenv(path):
    result = {}
    for number, raw in enumerate(Path(path).read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key):
            raise ValueError(f'invalid literal dotenv key at line {number}')
        value = value.strip()
        if value.startswith("'"):
            if len(value) < 2 or not value.endswith("'") or "'" in value[1:-1]:
                raise ValueError(f'invalid single-quoted value at line {number}')
            value = value[1:-1]
        elif any(char in value for char in ['$', '`', '"', "'", '#']):
            raise ValueError(f'use literal single quotes at line {number}')
        if key in result:
            raise ValueError(f'duplicate dotenv key: {key}')
        result[key] = value
    return result


def manifest(path):
    data = json.loads(Path(path).read_text())
    if data.get('schema') != 1 or not SEMVER.fullmatch(data.get('tag', '')):
        raise ValueError('release must use schema 1 and an exact vMAJOR.MINOR.PATCH tag')
    if not re.fullmatch(r'[0-9a-f]{40}', data.get('revision', '')):
        raise ValueError('release revision must be a full Git commit SHA')
    repository = data.get('repository', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*', repository):
        raise ValueError('invalid lowercase GitHub repository')
    if data.get('platform') != 'linux/amd64':
        raise ValueError('release platform must be linux/amd64')
    images = data.get('images', {})
    if set(images) != {'api', 'storefront', 'admin'}:
        raise ValueError('release requires exactly api, storefront and admin images')
    for name, image in images.items():
        if not re.fullmatch(re.escape(f'ghcr.io/{repository}-{name}@') + DIGEST, image):
            raise ValueError(f'{name} image must use its repository and immutable sha256 digest')
    url = urlsplit(data.get('storefront_url', ''))
    if url.scheme != 'https' or not DOMAIN.fullmatch(url.netloc) or url.path or url.query or url.fragment:
        raise ValueError('storefront_url must be an HTTPS origin without trailing slash')
    return data


def write_private(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with open(temporary, 'w', opener=lambda name, flags: os.open(name, flags, 0o600)) as stream:
        stream.write(value)
    temporary.chmod(0o600)
    temporary.replace(path)


def protected_config(environment):
    if stat.S_IMODE(environment.stat().st_mode) & 0o077:
        raise ValueError(f'{environment.name} must have mode 600 or stricter')
    return dotenv(environment)


def validate_common(config, shared):
    if not re.fullmatch(r'(?:docker\.io/library/)?nginx(?::[a-zA-Z0-9_.-]+)?@' + DIGEST, config.get('NGINX_IMAGE', '')):
        raise ValueError('NGINX_IMAGE must be the official nginx image pinned by sha256 digest')
    for key in ('ConnectionStrings__Shop', 'MIGRATION_CONNECTION_STRING', 'DataProtection__CertificatePassword'):
        if not config.get(key) or 'REPLACE' in config[key]:
            raise ValueError(f'configure a real {key}')
    if len(config.get('Auth__SigningKey', '').encode()) < 64 or 'REPLACE' in config.get('Auth__SigningKey', ''):
        raise ValueError('Auth__SigningKey requires a unique production key of at least 64 UTF-8 bytes')
    for prefix in ('Media', 'Files'):
        mode = config.get(prefix + '__Storage', 'Disabled')
        if mode not in ('Disabled', 'S3'):
            raise ValueError(f'{prefix} production storage must be Disabled or S3')
        if mode == 'S3':
            endpoint = urlsplit(config.get(prefix + '__S3__Endpoint', ''))
            if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.path not in ('', '/') or endpoint.query or endpoint.fragment:
                raise ValueError(f'{prefix} S3 endpoint must be a credential-free HTTPS root URL')
            for field in ('Bucket', 'AccessKey', 'SecretKey'):
                if not config.get(prefix + '__S3__' + field) or 'REPLACE' in config[prefix + '__S3__' + field]:
                    raise ValueError(f'configure {prefix}__S3__{field}')
    if config.get('Media__Storage') == config.get('Files__Storage') == 'S3' and config['Media__S3__Bucket'] == config['Files__S3__Bucket']:
        raise ValueError('public media and private files require separate S3 buckets')
    if any(key.startswith('Bootstrap__') and value for key, value in config.items()):
        raise ValueError('bootstrap credentials belong in a one-off env file, never production.env')
    for key in ('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT'):
        if key in config and config[key] != 'Production':
            raise ValueError(f'{key} must be Production')
    if config.get('SHOP_ENABLE_PREVIEW', 'false') != 'false':
        raise ValueError('production preview is forbidden')
    for path in (shared / 'identity-encryption.pfx', shared / 'tls/fullchain.pem', shared / 'tls/privkey.pem'):
        if not path.is_file() or not path.stat().st_size:
            raise ValueError(f'missing nonempty host certificate file: {path.name}')
    if not (shared / 'identity-keys').is_dir():
        raise ValueError('create persistent shared/identity-keys writable by API UID 1654')
    hook = shared / 'pre-migrate-backup'
    if not hook.is_file() or not os.access(hook, os.X_OK):
        raise ValueError('provide executable shared/pre-migrate-backup with verified backup logic')


def runtime_config(config):
    excluded = {'MIGRATION_CONNECTION_STRING', 'NGINX_IMAGE', 'SHOP_DOMAIN', 'ADMIN_DOMAIN',
                'API_IMAGE', 'API_DOMAIN', 'STOREFRONT_ORIGIN', 'ADMIN_ORIGIN',
                'SHARED_DIRECTORY', 'PRODUCTION_ENV_FILE', 'API_RUNTIME_ENV_FILE'}
    return ''.join(f"{key}='{value}'\n" for key, value in config.items()
                   if key not in excluded and not key.startswith('Bootstrap__'))


def prepare(bundle, root):
    bundle, root = Path(bundle).resolve(), Path(root).resolve()
    shared = root / 'shared'
    config = protected_config(shared / 'production.env')
    release = manifest(bundle / 'release.json')
    for key in ('SHOP_DOMAIN', 'ADMIN_DOMAIN'):
        if not DOMAIN.fullmatch(config.get(key, '')):
            raise ValueError(f'{key} must be a lowercase public DNS name')
    if config['SHOP_DOMAIN'] == config['ADMIN_DOMAIN']:
        raise ValueError('storefront and admin require distinct domains')
    if release['storefront_url'] != 'https://' + config['SHOP_DOMAIN']:
        raise ValueError('release storefront_url differs from production SHOP_DOMAIN; rebuild the admin image')
    validate_common(config, shared)
    write_private(shared / 'runtime.env', runtime_config(config))
    content = ''.join(f'{name.upper()}_IMAGE={image}\n' for name, image in release['images'].items())
    content += f'SHARED_DIRECTORY={shared}\nPRODUCTION_ENV_FILE={shared / "runtime.env"}\n'
    write_private(bundle / 'release.env', content)


def prepare_api(root):
    shared = Path(root).resolve() / 'shared'
    config = protected_config(shared / 'api-production.env')
    if not DOMAIN.fullmatch(config.get('API_DOMAIN', '')):
        raise ValueError('API_DOMAIN must be a lowercase public DNS name')
    for key in ('STOREFRONT_ORIGIN', 'ADMIN_ORIGIN'):
        url = urlsplit(config.get(key, ''))
        if url.scheme != 'https' or not DOMAIN.fullmatch(url.netloc) or url.path or url.query or url.fragment:
            raise ValueError(f'{key} must be an exact HTTPS origin without trailing slash')
    if config['STOREFRONT_ORIGIN'] == config['ADMIN_ORIGIN']:
        raise ValueError('storefront and admin require distinct origins')
    if not re.fullmatch(r'ghcr\.io/[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*-api@' + DIGEST, config.get('API_IMAGE', '')):
        raise ValueError('API_IMAGE must be a GHCR release API image pinned by sha256 digest')
    validate_common(config, shared)
    write_private(shared / 'api-runtime.env', runtime_config(config))
    write_private(shared / 'api-release.env', f'SHARED_DIRECTORY={shared}\nAPI_RUNTIME_ENV_FILE={shared / "api-runtime.env"}\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    check = sub.add_parser('manifest')
    check.add_argument('path')
    setup = sub.add_parser('prepare')
    setup.add_argument('bundle')
    setup.add_argument('root')
    api = sub.add_parser('prepare-api')
    api.add_argument('root')
    value = sub.add_parser('value')
    value.add_argument('path')
    value.add_argument('key')
    args = parser.parse_args()
    try:
        if args.command == 'manifest':
            manifest(args.path)
        elif args.command == 'prepare':
            prepare(args.bundle, args.root)
        elif args.command == 'prepare-api':
            prepare_api(args.root)
        else:
            print(dotenv(args.path)[args.key])
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        parser.exit(1, f'production release validation failed: {error}\n')


if __name__ == '__main__':
    main()
