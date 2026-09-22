from __future__ import annotations

import os
import shutil
from pathlib import Path

from .common import UpdaterError, load_lock, sha256_file, write_text
from .environment import require_environment, to_bash_path
from .signing import load_signing


def build_apk(project_root: Path, workspace: Path) -> Path:
    lock = load_lock()
    env = require_environment(lock["dsh"]["minimum_node_major"])
    devhome = workspace / "devhome"
    if not devhome.is_dir():
        raise UpdaterError(f"workspace is not prepared: {workspace}")

    keystore = project_root / "android-app" / "release.jks"
    if not keystore.is_file():
        raise UpdaterError(
            "android-app/release.jks is missing; run "
            "'python -m tools.dsh_updater init-signing' first"
        )
    password, alias = load_signing(project_root)

    process_env = os.environ.copy()
    process_env.update(
        {
            "DSH_DEV_HOME": to_bash_path(devhome),
            "JAVA_BIN": to_bash_path(env["java_bin"]),
            "ANDROID_JAR": to_bash_path(env["android_jar"]),
            "KEYSTORE_PASS": password,
            "KEYSTORE_ALIAS": alias,
        }
    )

    build_script = project_root / "android-app" / "build.sh"
    from .common import run

    run([env["bash"], build_script], cwd=project_root, env=process_env)

    source_apk = project_root / "android-app" / "DeepSeekHarness.apk"
    if not source_apk.is_file():
        raise UpdaterError(f"build completed without producing {source_apk}")

    dist = project_root / "dist"
    dist.mkdir(parents=True, exist_ok=True)
    target = dist / f"DeepSeekHarness-{lock['android_app']['version_name']}.apk"
    shutil.copy2(source_apk, target)
    digest = sha256_file(target)
    write_text(dist / f"{target.name}.sha256", f"{digest}  {target.name}\n")
    print(f"APK: {target}")
    print(f"SHA256: {digest}")
    return target
