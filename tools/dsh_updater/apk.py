from __future__ import annotations

import os
import shutil
import stat
import zipfile
from pathlib import Path

from .common import UpdaterError, remove_tree


def _safe_target(root: Path, member: str) -> Path:
    target = (root / member).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError as exc:
        raise UpdaterError(f"unsafe zip path: {member}") from exc
    return target


def extract_zip_safely(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        for info in bundle.infolist():
            target = _safe_target(destination, info.filename)
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise UpdaterError(f"symbolic links are not supported in payload: {info.filename}")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(info) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def extract_apk_payload(apk: Path, devhome: Path) -> Path:
    if not apk.is_file():
        raise UpdaterError(f"base APK not found: {apk}")

    with zipfile.ZipFile(apk) as package:
        try:
            payload_info = package.getinfo("assets/payload.zip")
        except KeyError as exc:
            raise UpdaterError(f"assets/payload.zip is missing from {apk}") from exc

        temp_dir = devhome.parent / ".payload-extract"
        remove_tree(temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)
        payload_zip = temp_dir / "payload.zip"
        with package.open(payload_info) as source, payload_zip.open("wb") as output:
            shutil.copyfileobj(source, output)

    remove_tree(devhome)
    devhome.mkdir(parents=True, exist_ok=True)
    extract_zip_safely(payload_zip, devhome)
    remove_tree(temp_dir)

    dshhome = devhome / "dshhome"
    hidden_home = devhome / ".dsh"
    if dshhome.is_dir() and not hidden_home.exists():
        os.replace(dshhome, hidden_home)

    required = [
        devhome / "runtime" / "bin" / "node",
        devhome / "dshroot" / "lib" / "node_modules" / "@deepseek-ai" / "dsh" / "package.json",
        devhome / ".dsh" / "profiles" / "web" / "package.json",
        devhome / "rish" / "rish_shizuku.dex",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise UpdaterError("payload is incomplete:\n" + "\n".join(missing))
    return payload_zip
