from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOCK_PATH = PROJECT_ROOT / "updater.lock.json"


class UpdaterError(RuntimeError):
    """Expected user-facing build failure."""


def load_lock() -> dict[str, Any]:
    with LOCK_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def run(
    command: Iterable[str | os.PathLike[str]],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    args = [str(item) for item in command]
    printable = " ".join(args)
    if not capture:
        print(f"+ {printable}")
    result = subprocess.run(
        args,
        cwd=cwd,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=capture,
        check=False,
    )
    if result.returncode != 0:
        detail = ""
        if capture:
            detail = "\n" + "\n".join(
                part.strip() for part in (result.stdout, result.stderr) if part and part.strip()
            )
        raise UpdaterError(f"command failed ({result.returncode}): {printable}{detail}")
    return result


def command_path(name: str) -> Path | None:
    found = shutil.which(name)
    return Path(found) if found else None


def require_command(name: str) -> Path:
    found = command_path(name)
    if found is None:
        raise UpdaterError(f"required command not found on PATH: {name}")
    return found


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise UpdaterError(
            f"compatibility replacement expected exactly one match in {path}, found {count}"
        )
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def copy_tree_contents(source: Path, destination: Path) -> None:
    if not source.is_dir():
        raise UpdaterError(f"overlay directory does not exist: {source}")
    destination.mkdir(parents=True, exist_ok=True)
    for entry in source.iterdir():
        target = destination / entry.name
        if entry.is_dir():
            shutil.copytree(entry, target, dirs_exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(entry, target)


def remove_tree(path: Path) -> None:
    if not os.path.lexists(path):
        return
    metadata = path.lstat()
    is_reparse = bool(
        getattr(metadata, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    )
    if path.is_symlink() or is_reparse:
        if path.is_dir():
            path.rmdir()
        else:
            path.unlink()
        return
    shutil.rmtree(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def print_status(ok: bool, label: str, detail: str = "") -> None:
    marker = "OK" if ok else "MISSING"
    suffix = f" - {detail}" if detail else ""
    print(f"[{marker:7}] {label}{suffix}")


def ensure_python_version() -> None:
    if sys.version_info < (3, 10):
        raise UpdaterError("Python 3.10 or newer is required")
