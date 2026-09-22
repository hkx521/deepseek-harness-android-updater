from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType
from typing import Any

from .common import (
    PROJECT_ROOT,
    UpdaterError,
    copy_tree_contents,
    load_lock,
    remove_tree,
    replace_once,
    write_text,
)


def profile_root(version: str) -> Path:
    root = PROJECT_ROOT / "compatibility" / version
    if not root.is_dir():
        raise UpdaterError(f"compatibility profile does not exist: {root}")
    return root


def _load_profile_module(profile: Path) -> ModuleType:
    script = profile / "apply.py"
    spec = importlib.util.spec_from_file_location(f"dsh_compat_{profile.name}", script)
    if spec is None or spec.loader is None:
        raise UpdaterError(f"cannot load compatibility script: {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def apply_compatibility(devhome: Path, version: str | None = None) -> None:
    lock = load_lock()
    selected = version or lock["compatibility_profile"]
    profile = profile_root(selected)
    manifest_path = profile / "manifest.json"
    with manifest_path.open("r", encoding="utf-8") as handle:
        manifest: dict[str, Any] = json.load(handle)

    dshroot = devhome / "dshroot" / "lib"
    node_modules = dshroot / "node_modules"
    overlay = profile / "overlay" / "node_modules"
    if overlay.is_dir():
        copy_tree_contents(overlay, node_modules)

    home_overlay = profile / "overlay" / ".dsh"
    if home_overlay.is_dir():
        copy_tree_contents(home_overlay, devhome / ".dsh")

    module = _load_profile_module(profile)
    module.apply(devhome, replace_once)

    expected = manifest.get("expected_versions", {})
    for package_name, expected_version in expected.items():
        package_json = node_modules / Path(package_name) / "package.json"
        if not package_json.is_file():
            raise UpdaterError(f"expected package was not installed: {package_name}")
        data = json.loads(package_json.read_text(encoding="utf-8"))
        if data.get("version") != expected_version:
            raise UpdaterError(
                f"{package_name} version mismatch: expected {expected_version}, got {data.get('version')}"
            )

    write_text(
        devhome / "compatibility-profile.txt",
        f"{selected}\n",
    )


def apply_profile_vendor_overlay(devhome: Path) -> None:
    """把第三方 cordis 插件包物化进 profile 树（dshhome/profiles/web/node_modules）。

    真机实证（2026-09-13）：cordis.patch.yml 的 insert 条目在 home patch 语境下
    从 dshhome/profiles/web/ 解析——Node ESM 向上走目录树，而 dshroot 是 dshhome
    的兄弟目录，只落 dshroot/lib/node_modules 的包永远 ERR_MODULE_NOT_FOUND
    （dsh-app-boot Include._apply → cordis-plugin-loader packageResolve）。tool-*
    三插件能被 insert 正是因它们物理存在于 profile 树（install_custom_plugins
    copytree 进去）。本函数把 compatibility overlay 里 @jiesou/ 前缀的第三方包
    同样物化到 profile 树，与 dshroot 副本构成双树。

    只挑 @jiesou/ 前缀（而非整个 overlay）的选型依据：既有 overlay 包
    （sharp/@img/koffi/node-addon-system/dsh-win32-process 等）是 dshroot 内核
    的 require 解析件，profile 树多落一份零收益、纯增 APK 体积，且 profile 树
    由 npm install 管理，extraneous 包语义不受控——最小集对既有包零风险。

    时序契约（workspace.prepare/refresh）：必须且已经安排在 install_custom_plugins
    之后调用——npm ci（install_dsh，只清 dshroot 树）与 npm install --prefix
    profile（install_custom_plugins，会整理 profile 依赖树）都先于本步骤完成，
    本步骤最后一次落位，之后不再有任何清树操作，prepare/refresh 重跑幂等
    （remove_tree + copytree，与 install_custom_plugins 对三插件的同款策略，
    防插件升级后旧版本文件残留）。
    """
    profile = load_lock()["compatibility_profile"]
    overlay_nm = PROJECT_ROOT / "compatibility" / profile / "overlay" / "node_modules"
    vendor = overlay_nm / "@jiesou"
    if not vendor.is_dir():
        raise UpdaterError(f"profile vendor overlay is missing: {vendor}")
    destination = (
        devhome / ".dsh" / "profiles" / "web" / "node_modules" / "@jiesou"
    )
    remove_tree(destination)
    copy_tree_contents(vendor, destination)

    # 裸包名第三方插件（无 scope）：dsh-codearts-auth、dsh-agy 及其依赖，
    # 以及 dsh-mnemon（三层记忆控制平面）与 16 个子包、fflate、schemastery、zod 等运行期依赖。
    for bare in (
        "dsh-codearts-auth",
        "dsh-agy",
        "proper-lockfile",
        "graceful-fs",
        "signal-exit",
        "undici",
        "dsh-mnemon",
        "dsh-mnemon-provider-byterover",
        "dsh-mnemon-provider-hindsight",
        "dsh-mnemon-provider-holographic",
        "dsh-mnemon-provider-honcho",
        "dsh-mnemon-provider-mem0",
        "dsh-mnemon-provider-mnemon-native",
        "dsh-mnemon-provider-openviking",
        "dsh-mnemon-provider-retaindb",
        "dsh-mnemon-provider-supermemory",
        "dsh-mnemon-source-documents",
        "dsh-mnemon-source-memory-spaces",
        "dsh-mnemon-source-runtime",
        "dsh-mnemon-strategy-auto-capture",
        "dsh-mnemon-strategy-default-three-tier",
        "dsh-mnemon-strategy-light-context",
        "dsh-mnemon-strategy-scoped",
        "fflate",
        "schemastery",
        "zod",
        "cosmokit",
        "markdown-to-jsx",
        "js-tokens",
        "loose-envify",
        "scheduler",
    ):
        src = overlay_nm / bare
        if not src.is_dir():
            continue
        dst = devhome / ".dsh" / "profiles" / "web" / "node_modules" / bare
        remove_tree(dst)
        copy_tree_contents(src, dst)

    ui_prim_src = overlay_nm / "@deepseek-ai" / "dsh-client-ui-primitives"
    if ui_prim_src.is_dir():
        dst = (
            devhome
            / ".dsh"
            / "profiles"
            / "web"
            / "node_modules"
            / "@deepseek-ai"
            / "dsh-client-ui-primitives"
        )
        remove_tree(dst)
        copy_tree_contents(ui_prim_src, dst)

    std_schema = overlay_nm / "@standard-schema"
    if std_schema.is_dir():
        dst = devhome / ".dsh" / "profiles" / "web" / "node_modules" / "@standard-schema"
        remove_tree(dst)
        copy_tree_contents(std_schema, dst)

    for sub in ("cosmokit", "schemastery", "dsh-client-connection"):
        sub_src = overlay_nm / "@deepseek-ai" / sub
        if sub_src.is_dir():
            dst = devhome / ".dsh" / "profiles" / "web" / "node_modules" / "@deepseek-ai" / sub
            remove_tree(dst)
            copy_tree_contents(sub_src, dst)


