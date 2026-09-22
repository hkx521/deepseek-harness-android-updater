from __future__ import annotations

import json
import re
from pathlib import Path

from .common import UpdaterError, load_lock, require_command, run


def _package_version(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    value = data.get("version")
    if not isinstance(value, str):
        raise UpdaterError(f"package has no version: {path}")
    return value


def verify(workspace: Path) -> None:
    lock = load_lock()
    devhome = workspace / "devhome"
    if not devhome.is_dir():
        raise UpdaterError(f"workspace is not prepared: {workspace}")

    lib = devhome / "dshroot" / "lib"
    node_modules = lib / "node_modules"
    checks = {
        "DSH version": (
            node_modules / "@deepseek-ai" / "dsh" / "package.json",
            lock["dsh"]["version"],
        ),
        "attachment adapter": (
            node_modules / "@deepseek-ai" / "dsh-attachment-local" / "package.json",
            lock["dsh"]["version"],
        ),
        "session adapter": (
            node_modules
            / "@deepseek-ai"
            / "dsh-session-persistence-jsonl"
            / "package.json",
            lock["dsh"]["version"],
        ),
    }
    for label, (package_json, expected) in checks.items():
        actual = _package_version(package_json)
        if actual != expected:
            raise UpdaterError(f"{label}: expected {expected}, got {actual}")

    required_files = [
        node_modules / "node-addon-require-builtin" / "lib" / "index.js",
        node_modules / "@deepseek-ai" / "node-addon-system" / "lib" / "flock.js",
        node_modules / "node-pty" / "lib" / "index.js",
        node_modules / "sharp" / "lib" / "index.js",
        node_modules / "@jiesou" / "dsh-commandcode-go-provider" / "lib" / "index.js",
        # dsh-codearts-auth（裸包名第三方插件）：lib/index.js 为服务端入口，
        # lib/client/jet-hub.js 为 Models 页配置 UI（dsh.client 声明，浏览器端加载）。
        node_modules / "dsh-codearts-auth" / "lib" / "index.js",
        node_modules / "dsh-codearts-auth" / "lib" / "client" / "jet-hub.js",
        # dsh-agy（裸包名第三方插件，本项目已改造主密钥存储）：lib/index.mjs 为 LLM 适配器入口，
        # lib/web/plugin.mjs 为 /agy Web UI 入口；另有三个运行期依赖包。
        node_modules / "dsh-agy" / "lib" / "index.mjs",
        node_modules / "dsh-agy" / "lib" / "web" / "plugin.mjs",
        node_modules / "proper-lockfile" / "lib" / "lockfile.js",
        node_modules / "graceful-fs" / "graceful-fs.js",
        node_modules / "signal-exit" / "index.js",
        # dsh-mnemon（三层记忆控制平面）及客户端 UI
        node_modules / "dsh-mnemon" / "lib" / "index.js",
        node_modules / "dsh-mnemon" / "lib" / "client.js",
        # 双树校验：insert（home patch 语境）从 dshhome/profiles/web/ 解析，
        # dshroot 副本解析不到（dshroot 是 dshhome 的兄弟目录），两树缺一即报错。
        devhome
        / ".dsh"
        / "profiles"
        / "web"
        / "node_modules"
        / "@jiesou"
        / "dsh-commandcode-go-provider"
        / "lib"
        / "index.js",
        devhome
        / ".dsh"
        / "profiles"
        / "web"
        / "node_modules"
        / "dsh-codearts-auth"
        / "lib"
        / "index.js",
        devhome
        / ".dsh"
        / "profiles"
        / "web"
        / "node_modules"
        / "dsh-agy"
        / "lib"
        / "index.mjs",
        devhome
        / ".dsh"
        / "profiles"
        / "web"
        / "node_modules"
        / "proper-lockfile"
        / "lib"
        / "lockfile.js",
        devhome
        / ".dsh"
        / "profiles"
        / "web"
        / "node_modules"
        / "dsh-mnemon"
        / "lib"
        / "index.js",
        devhome
        / ".dsh"
        / "profiles"
        / "web"
        / "node_modules"
        / "dsh-mnemon"
        / "lib"
        / "client.js",
        devhome / ".dsh" / "cordis.patch.yml",
        devhome / ".dsh" / "profiles" / "web" / "node_modules" / "@deepseek-ai" / "dsh-tool-shizuku" / "lib" / "index.js",
        devhome / ".dsh" / "profiles" / "web" / "node_modules" / "@deepseek-ai" / "dsh-tool-android" / "lib" / "index.js",
        devhome / ".dsh" / "profiles" / "web" / "node_modules" / "@deepseek-ai" / "dsh-tool-accessibility" / "lib" / "index.js",
    ]
    missing = [str(path) for path in required_files if not path.is_file()]
    if missing:
        raise UpdaterError("compatibility files are missing:\n" + "\n".join(missing))

    patch_text = (devhome / ".dsh" / "cordis.patch.yml").read_text(encoding="utf-8")
    # 批次26 起：permission 预设服务由「禁用」改为「启用 + 配置预设」，以恢复官方
    # 权限管理模式（danger-full-access / workspace-write）在 Android 侧可用。
    # 校验其确实被配置（存在 id: permission 且带 presets 段），防止回退成 disabled。
    if re.search(r"- id: permission\n  disabled: true", patch_text):
        raise UpdaterError("permission preset service is unexpectedly disabled")
    if not re.search(r"- id: permission\n  config:", patch_text):
        raise UpdaterError("permission preset service is not configured for Android")
    for plugin in ("tool-shizuku", "tool-android", "tool-accessibility", "commandcode-go-provider", "model-router", "codearts-auth", "dsh-agy", "dsh-agy-web", "mnemon-bundle"):
        if plugin not in patch_text:
            raise UpdaterError(f"custom plugin is not inserted: {plugin}")

    mnemon_index = node_modules / "dsh-mnemon" / "lib" / "index.js"
    if mnemon_index.is_file():
        mnemon_src = mnemon_index.read_text(encoding="utf-8")
        for tool_name in ("mnemon_remember", "mnemon_recall"):
            if tool_name not in mnemon_src:
                raise UpdaterError(f"mnemon tool definition missing: {tool_name}")

    node = require_command("node")
    dsh_bin = node_modules / "@deepseek-ai" / "dsh" / "lib" / "bin.js"
    result = run([node, "--expose-internals", dsh_bin, "--version"], capture=True)
    if result.stdout.strip() != lock["dsh"]["version"]:
        raise UpdaterError(
            f"DSH runtime reported {result.stdout.strip()!r}, expected {lock['dsh']['version']!r}"
        )

    forbidden = [
        path
        for path in (devhome / ".dsh").rglob("*")
        if path.is_file() and path.name in {".credentials.yaml", "credentials.yaml"}
    ]
    if forbidden:
        raise UpdaterError("credentials were copied into the build payload")
