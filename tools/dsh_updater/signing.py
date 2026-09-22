from __future__ import annotations

import os
import secrets
from pathlib import Path

from .common import UpdaterError, require_command, run, write_text


def signing_env_path(project_root: Path) -> Path:
    return project_root / ".local" / "signing.env"


def load_signing(project_root: Path) -> tuple[str, str]:
    password = os.environ.get("KEYSTORE_PASS")
    alias = os.environ.get("KEYSTORE_ALIAS")
    env_file = signing_env_path(project_root)
    if env_file.is_file():
        values: dict[str, str] = {}
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
        password = password or values.get("KEYSTORE_PASS")
        alias = alias or values.get("KEYSTORE_ALIAS")
    if not password:
        raise UpdaterError(
            "missing signing password; run 'python -m tools.dsh_updater init-signing' "
            "or set KEYSTORE_PASS"
        )
    return password, alias or "dsh"


def create_signing_key(project_root: Path, alias: str = "dsh", force: bool = False) -> Path:
    keytool = require_command("keytool")
    keystore = project_root / "android-app" / "release.jks"
    if keystore.exists() and not force:
        raise UpdaterError(f"signing key already exists: {keystore}; pass --force to replace it")
    if force and keystore.exists():
        keystore.unlink()

    password = secrets.token_urlsafe(24)
    run(
        [
            keytool,
            "-genkeypair",
            "-keystore",
            keystore,
            "-storepass",
            password,
            "-keypass",
            password,
            "-alias",
            alias,
            "-keyalg",
            "RSA",
            "-keysize",
            "2048",
            "-validity",
            "10000",
            "-dname",
            "CN=DeepSeek Harness Android Updater, OU=Local Build, O=Local, L=Shanghai, ST=Shanghai, C=CN",
            "-noprompt",
        ],
        capture=True,
    )
    write_text(
        signing_env_path(project_root),
        f"KEYSTORE_ALIAS={alias}\nKEYSTORE_PASS={password}\n",
    )
    return keystore
