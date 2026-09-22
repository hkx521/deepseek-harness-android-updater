#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把仓库 `plugins/**` 同步进 base APK 的 `assets/payload.zip`（幂等）。

为什么需要它
------------
本地增量构建（`.local/b47_build.py` / `tools/b47_build.py`）只替换
classes.dex / resources.arsc / AndroidManifest / res/*，**assets/（含 payload.zip）沿用 base APK**；
而 payload 里的 `dshhome/profiles/web/node_modules/@deepseek-ai/*` 才是设备侧真正运行的插件来源。
于是「改了 `plugins/` + 只跑增量构建」不会让插件改动进 APK ——
批次74/75 的 `dsh-tool-accessibility` 改动就是这样没进 payload/设备（2026-09-18 实测复现）。

两条正确链路
------------
  A. 全量：`python -m tools.dsh_updater all`（从官方 base APK 重建整包；需要 node / bash / 网络）；
  B. 增量（本脚本）：只把 `plugins/**` 与 payload 不一致的文件写回
     `android-app/DeepSeekHarness.apk` 的 `assets/payload.zip`，随后照常
     `python .local/b47_build.py all` + `adb install -r`，设备 re-stage 后即生效。

用法
----
    python tools/sync_base_apk_plugins.py            # 同步（幂等；无差异时输出 unchanged）
    python tools/sync_base_apk_plugins.py --check    # 只检查：有差异 exit 1（供 pytest 闸门用）
    python tools/sync_base_apk_plugins.py --apk <path>
"""

from __future__ import annotations

import argparse
import hashlib
import io
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APK = ROOT / "android-app" / "DeepSeekHarness.apk"
PAYLOAD_NAME = "assets/payload.zip"
PLUGIN_PREFIX = "node_modules/@deepseek-ai/"


def sha12(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:12]


def repo_plugin_files() -> dict[str, bytes]:
    """{payload 后缀（node_modules/@deepseek-ai/<pkg>/<rel>）: 字节}。"""
    out: dict[str, bytes] = {}
    plugins_dir = ROOT / "plugins"
    for pkg_dir in sorted(p for p in plugins_dir.iterdir() if p.is_dir()):
        for f in sorted(pkg_dir.rglob("*")):
            if not f.is_file():
                continue
            rel = f.relative_to(pkg_dir).as_posix()
            out[PLUGIN_PREFIX + pkg_dir.name + "/" + rel] = f.read_bytes()
    return out


def inspect(payload: bytes, want: dict[str, bytes]):
    """返回 (缺失, 差异明细, 不在 payload 里的包)。

    只有「payload 里已经有该包」的插件才纳入一致性校验：payload 里根本没有的包
    （如 App 侧另行注入的 dsh-model-router）不算不一致，只提示。
    """
    mismatched: list[tuple[str, str, str]] = []
    with zipfile.ZipFile(io.BytesIO(payload)) as zp:
        names = zp.namelist()
        managed = {s.split("/", 3)[2] for s in want
                   if any(n.endswith("/" + s) for n in names)}
        missing, absent_pkgs = set(), set()
        for suffix, repo_bytes in want.items():
            pkg = suffix.split("/", 3)[2]
            hits = [n for n in names if n.endswith("/" + suffix) or n == suffix]
            if not hits:
                (absent_pkgs if pkg not in managed else missing).add(suffix)
                continue
            for n in hits:
                cur = zp.read(n)
                if cur != repo_bytes:
                    mismatched.append((suffix, sha12(cur), sha12(repo_bytes)))
    return sorted(missing), mismatched, sorted(absent_pkgs)


def sync(apk: Path, check_only: bool) -> int:
    if not apk.is_file():
        print("[sync-plugins] base APK not found: %s" % apk)
        return 2
    want = repo_plugin_files()
    with zipfile.ZipFile(apk) as z:
        payload = z.read(PAYLOAD_NAME)
        apk_entries = [(item, z.read(item.filename)) for item in z.infolist()]

    missing, mismatched, absent = inspect(payload, want)
    if absent:
        print("[sync-plugins] note: not part of this payload (skipped): %s"
              % ", ".join(sorted({a.split("/", 3)[2] for a in absent})))
    if not missing and not mismatched:
        print("[sync-plugins] unchanged (%d plugin files in sync)" % len(want))
        return 0
    for suffix, cur, new in mismatched:
        print("[sync-plugins] stale  %s  %s -> %s" % (suffix, cur, new))
    for suffix in missing:
        print("[sync-plugins] absent %s" % suffix)
    if check_only:
        print("[sync-plugins] CHECK FAILED: payload is out of sync with plugins/")
        return 1

    # 重写 payload.zip（保留条目顺序；只替换命中的插件条目）
    new_payload = io.BytesIO()
    replaced = 0
    with zipfile.ZipFile(io.BytesIO(payload)) as zp, zipfile.ZipFile(
            new_payload, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zp.infolist():
            data = zp.read(item.filename)
            match = next((s for s in want
                          if item.filename.endswith("/" + s) or item.filename == s), None)
            if match is not None:
                data = want[match]
                replaced += 1
            zout.writestr(item, data)

    tmp = apk.with_suffix(".apk.tmp-plugins")
    try:
        with zipfile.ZipFile(tmp, "w") as zout:
            for item, data in apk_entries:
                if item.filename == PAYLOAD_NAME:
                    data = new_payload.getvalue()
                zout.writestr(item, data)
        tmp.replace(apk)
    finally:
        if tmp.exists():
            tmp.unlink()

    # 复验
    with zipfile.ZipFile(apk) as z:
        after = z.read(PAYLOAD_NAME)
    missing2, mismatched2, _absent2 = inspect(after, want)
    if missing2 or mismatched2:
        print("[sync-plugins] VERIFY FAILED after rewrite")
        return 1
    print("[sync-plugins] patched %d entry(ies) in %s" % (replaced, PAYLOAD_NAME))
    mirror_staging(want)
    return 0


def mirror_staging(want: dict[str, bytes]) -> None:
    """把同一批插件文件同步到 `android-app/staging/.../node_modules/@deepseek-ai/`。

    该目录是 git-ignored 的**派生副本**（AGENTS.md 旧描述误称它是打包来源）：设备侧插件来自
    base APK 的 `assets/payload.zip`，本地增量构建不读这里。同步它只是避免「两个副本看起来
    不一样」误导排查。目录不存在时跳过。
    """
    base = ROOT / "android-app" / "staging" / "dshhome" / "profiles" / "web"
    if not (base / "node_modules" / "@deepseek-ai").is_dir():
        print("[sync-plugins] staging mirror skipped (tree not present)")
        return
    copied = []
    for suffix, data in sorted(want.items()):
        target = base / suffix
        if target.is_file() and target.read_bytes() == data:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        copied.append(suffix)
    print("[sync-plugins] staging mirror: %s"
          % (("updated " + ", ".join(copied)) if copied else "already in sync"))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apk", type=Path, default=DEFAULT_APK)
    ap.add_argument("--check", action="store_true", help="只检查，不写入")
    args = ap.parse_args(argv[1:])
    return sync(args.apk, args.check)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
