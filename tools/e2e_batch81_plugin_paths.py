#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次81-T2-2：插件交付链三方一致性 + 虚拟屏直连工具自愈 真机 e2e。

Phase A（默认，纯只读）—— 交付链三方比对
----------------------------------------
逐文件比对 sha256[:12] + 字节数（三列）：

  repo     `plugins/**`（唯一来源）
  payload  `android-app/DeepSeekHarness.apk` 的 `assets/payload.zip` 里
           `dshhome/profiles/web/node_modules/@deepseek-ai/<pkg>/<rel>`
  device   `/data/local/tmp/dsh/home/profiles/web/node_modules/@deepseek-ai/**`
           （托管引擎 re-stage 后的实际运行副本）

复用 `tools/sync_base_apk_plugins.py` 的 `repo_plugin_files()` / `inspect()`（纯函数模块，
import 无副作用），判定口径与批次80 的交付链 pytest 闸门一致。

设备侧为什么用 `adb shell sha256sum` 而不是 pull：
  1) 与 repo/payload 同一原语（sha256[:12]），三列可直接比对，不用维护两套口径；
  2) 不把 140KB~179KB 的文件落到宿主临时目录，也不用额外清理；
  3) 无设备写、无宿主临时产物，符合 Phase A「纯只读」的定位。
（文件确实不大，pull 后本地算同样可行；选前者是为了少一次往返与少一份宿主临时差量。）

Phase B（`--live`，需要真机面板可见 + 托管引擎在跑）—— 自愈端到端证据
--------------------------------------------------------------------
用面板提交一条 prompt（默认探针带动作词「点击」，**刻意避开 App 的只读任务闸门**：只读词 +
无动作词的指令会被判只读任务，App 按设计拒绝建屏），明确要求模型**不要**调用
`android_vscreen_create`，直接调用虚拟屏直连工具，并按实际结果回三个哨兵之一：
  * 工具返回 ok=true（截图 / 点击成功）→ `B81_SELFHEAL_OK`
  * 被 `NOT_CREATED` 之类结果返回 → `B81_GUARD_STILL`
  * 失败原因是 `READONLY_TASK`（本轮被判只读任务，App 按设计禁建屏）→ `B81_READONLY`
随后轮询面板无障碍树（3181 桥）等哨兵（默认超时 150s，超时判 FAIL）。

判定：`B81_SELFHEAL_OK` = PASS（守卫态丢失时插件静默自愈建屏，不再需要模型手动 create）；
      `B81_READONLY` = WARN/exit 3（自愈已真实发起建屏，只是被 App 的只读闸门按设计拒绝 ——
      该类 prompt 被判只读任务，是测试设计限制，不是产品缺陷）；
      `B81_GUARD_STILL` / 超时 = FAIL（自愈没生效，可能是插件没上机 —— 先看 Phase A）。

Phase B 有两道前置检查（任一不过直接 ABORT/exit 2，不提交 prompt，避免假阴性）：
  1. 托管引擎：`/data/local/tmp/dsh/engine.pid` 存活 + 3080 LISTEN；
  2. **App 本地桥 3081**：`curl 127.0.0.1:3081/status` 返回 200（3081 是 /vscreen/* 唯一后端）。
     真机事实（2026-09-19）：App 进程重启（如 `adb install -r`）后，3081 只在
     `MainActivity.startEngine()` 路径里 bind（日志 `notify server listening on 3081`），
     在此之前所有 3081 能力（vscreen/剪贴板/通知/overlay）都是 BRIDGE_UNREACHABLE ——
     而托管引擎 3080 照常在跑，用户侧表现就是「dsh 里任务还在跑、小鲸鱼助手报执行失败」。

安全红线（Phase B）：不 install / 不 uninstall / 不 pm clear / 不改设备设置 /
不写 `/sdcard` 之外的设备路径 / 不 kill 引擎 / 不清 logcat。为此本脚本**不 push 任何 helper
到设备**：`e2e_assistant_long_task` 里 `A11Y_SH` / `SEND_SH` 的命令体改为内联执行
（`am start` 直发、prompt 走 base64 避免 Windows 侧编码污染、3181 桥 dump 直接 curl 到
stdout 而不是写 /data/local/tmp/e2e_a11y.json）。所有涉设备操作都记在「设备操作审计」里并打印。

run e2e 前先 scrcpy `stop_session`（scrcpy 会话抢前台，会干扰面板聚焦与 dump）。

退出码
------
  Phase A：全部一致 0；发现不一致 1（这就是「插件没真正上机」的可复跑证据）。
  `--live`：A 与 B 都通过 0；任一失败 1；环境不满足（无设备 / base APK 缺失 /
  `--check-only` 与 `--live` 同用 / Phase B 前置未就绪）2。

用法
----
    python tools/e2e_batch81_plugin_paths.py                  # Phase A（只读）
    python tools/e2e_batch81_plugin_paths.py --json            # Phase A，stdout 出机器可读 JSON
    python tools/e2e_batch81_plugin_paths.py --live            # A + B（B 需面板与引擎在跑）
    python tools/e2e_batch81_plugin_paths.py --live --live-timeout 150 --poll 5
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_assistant_long_task as base  # noqa: E402  （Device / pick_serial / find_button / status_line）
import sync_base_apk_plugins as sync  # noqa: E402  （repo_plugin_files / inspect / DEFAULT_APK）

# ---------- 交付链路径口径（与 sync_base_apk_plugins.py 的 PLUGIN_PREFIX 对齐） ----------
REPO_SUFFIX_HEAD = "node_modules/@deepseek-ai/"
PAYLOAD_WEB_HEAD = "dshhome/profiles/web/"
DEV_WEB_HEAD = "/data/local/tmp/dsh/home/profiles/web/"
DEV_PLUGIN_BASE = DEV_WEB_HEAD + "node_modules/@deepseek-ai"

# ---------- 托管引擎事实 ----------
ENGINE_PID_FILE = "/data/local/tmp/dsh/engine.pid"
ENGINE_PORT = 3080  # /proc/net/tcp 里 0100007F:0C08
APP_PORT = 3081     # App 本地桥（MainActivity.startNotifyServer；IPv6 dual-stack，常在 /proc/net/tcp6 里）
# App 本地桥探活：直接 /status（带引擎侧已展开的 X-DSH-Token），比只看 /proc 可靠
APP_STATUS_PROBE = (". /data/local/tmp/dsh/engine.env 2>/dev/null; "
                    "export LD_LIBRARY_PATH=/data/local/tmp/dsh/runtime/lib; "
                    "curl -s -m 5 -o /dev/null -w '%{http_code}' "
                    '-H "X-DSH-Token: $APP_LOCAL_TOKEN" '
                    '"http://127.0.0.1:' + str(APP_PORT) + '/status"')

# ---------- 3181 无障碍桥（只读 dump；token 只在设备侧 shell 展开） ----------
DUMP_PATH = "dump"
DUMP_CMD = (". /data/local/tmp/dsh/engine.env 2>/dev/null; "
            "export LD_LIBRARY_PATH=/data/local/tmp/dsh/runtime/lib; "
            'curl -s -m 10 -H "X-DSH-Token: $APP_LOCAL_TOKEN" '
            '"http://127.0.0.1:3181/%s"' % DUMP_PATH)

# ---------- Phase B 哨兵 ----------
SENTINEL_OK = "B81_SELFHEAL_OK"          # 截图成功 → 自愈建屏真的跑通
SENTINEL_GUARD = "B81_GUARD_STILL"       # 本地守卫拒绝（NOT_CREATED）→ 自愈没生效
SENTINEL_READONLY = "B81_READONLY"       # App 只读闸门拒绝建屏（READONLY_TASK）→ 设计内行为，不算失败
SEND_BTN = "发送"
LIVE_PROMPT = (
    # 刻意带动作词（「点击」）：App 的虚拟屏闸门把「只读词且无动作词」的指令判为只读任务并
    # 拒绝建屏（READONLY_TASK，属设计内行为）。探针要验证的是自愈建屏，所以用可建屏的指令。
    "只做下面这一件事：在虚拟屏上点击一个坐标（这是一次操作，不是只读）。\n"
    "不要调用 android_vscreen_create。直接调用工具 android_vscreen_tap，参数 x=500、y=500。\n"
    "如果它返回 ok=true，就只回复这一行：B81_SELFHEAL_OK\n"
    "如果它被 NOT_CREATED 之类的守卫拒绝，就只回复这一行：B81_GUARD_STILL\n"
    "如果失败原因是 READONLY_TASK（本轮被判只读任务，App 禁止建屏），就只回复这一行：B81_READONLY\n"
    "回复完立即停止，不要做任何别的操作、不要解释。"
)


def use_utf8_stdout() -> None:
    """Windows 控制台/管道默认 cp936，直接 print 中文会有 UnicodeEncodeError 风险。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def sha12(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:12]


def cell(entry) -> str:
    return "%s/%d" % (entry["sha12"], entry["bytes"]) if entry else "-"


class Probe:
    """Device 访问 + 设备操作审计。"""

    def __init__(self, serial_arg: str | None, out: Path):
        self.out = out
        self.out.mkdir(parents=True, exist_ok=True)
        self.ops: list[str] = []
        self.serial = ""
        self.dev: base.Device | None = None
        try:
            self.serial = base.pick_serial(serial_arg)
            self.dev = base.Device(self.serial)
        except SystemExit:
            self.dev = None  # 无设备：Phase A 仍产出 repo<->payload 报告

    # ---- 设备访问（全部经审计记录） ----
    def sh(self, cmd: str, note: str, timeout: int = 60) -> str:
        self.ops.append(note)
        if self.dev is None:
            return ""
        return self.dev.adb("shell", cmd, timeout=timeout).stdout or ""

    def push(self, *_a, **_k):
        raise RuntimeError("本脚本不向设备 push 任何文件（安全红线：不写 /sdcard 之外的设备路径）")

    # ---- 3181 桥只读 dump ----
    def nodes(self, note_phase: str = "A") -> list[dict]:
        self.ops.append("[%s] 3181 /dump（只读；token 仅在设备侧 shell 内展开，不回显、不落盘）"
                        % note_phase)
        if self.dev is None:
            return []
        raw = self.dev.adb("shell", DUMP_CMD, timeout=30).stdout or ""
        try:
            return json.loads(raw).get("nodes", []) or []
        except (ValueError, AttributeError):
            return []

    def engine_state(self) -> dict:
        pid_raw = self.sh("cat %s 2>/dev/null" % ENGINE_PID_FILE, "[B] cat %s（只读）" % ENGINE_PID_FILE)
        pid = pid_raw.strip().splitlines()[0].strip() if pid_raw.strip() else ""
        alive = False
        if pid:
            alive = "yes" in self.sh("[ -d /proc/%s ] && echo yes || echo no" % pid,
                                      "[B] [ -d /proc/<pid> ]（只读存活判定）").lower()
        tcp = self.sh("cat /proc/net/tcp /proc/net/tcp6 2>/dev/null", "[B] cat /proc/net/tcp（只读，查 3080 LISTEN）")
        want = "0100007F:%04X" % ENGINE_PORT
        listening = any(want in ln and ln.split()[3] == "0A" for ln in tcp.splitlines()
                        if len(ln.split()) > 3)
        app_want = "0100007F:%04X" % APP_PORT
        app_listen = any(app_want in ln and ln.split()[3] == "0A" for ln in tcp.splitlines()
                         if len(ln.split()) > 3)
        code = self.sh(APP_STATUS_PROBE,
                       "[B] curl 127.0.0.1:%d/status（只读探活 App 本地桥）" % APP_PORT).strip()
        return {"pid": pid, "alive": alive, "listening": listening,
                "app_listen": app_listen, "app_status_http": code,
                "app_ok": code.endswith("200")}


# ==========================================================================
# Phase A：交付链三方比对
# ==========================================================================
def parse_sha256sum(out: str) -> dict[str, str]:
    table = {}
    for ln in out.splitlines():
        parts = ln.split(None, 1)
        if len(parts) == 2 and len(parts[0]) == 64:
            table[parts[1].strip()] = parts[0][:12]
    return table


def parse_stat(out: str) -> dict[str, int]:
    table = {}
    for ln in out.splitlines():
        parts = ln.split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            table[parts[1].strip()] = int(parts[0])
    return table


def phase_a(probe: Probe) -> dict:
    apk = sync.DEFAULT_APK
    want = sync.repo_plugin_files()                      # {repo suffix: bytes}
    repo_pkgs = sorted({s.split("/", 3)[2] for s in want})
    report: dict = {
        "apk": str(apk), "serial": probe.serial, "plugin_files": len(want),
        "repo_packages": repo_pkgs, "rows": [], "notes": [], "problems": [],
    }
    if not apk.is_file():
        report["fatal"] = "base APK not found: %s" % apk
        return report

    with zipfile.ZipFile(apk) as z:
        payload = z.read(sync.PAYLOAD_NAME)
    report["apk_bytes"] = apk.stat().st_size
    report["apk_mtime"] = datetime.fromtimestamp(apk.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
    report["payload_bytes"] = len(payload)
    report["payload_sha12"] = sha12(payload)
    # 与批次80 交付链闸门同一口径
    s_missing, s_mismatch, s_absent = sync.inspect(payload, want)
    report["sync_inspect"] = {"missing": s_missing, "mismatched": s_mismatch, "absent_pkgs": s_absent}

    # payload 侧：只认 web profile 的 @deepseek-ai（dshroot/lib/node_modules 是引擎自带包，不在交付链上）
    p_head = PAYLOAD_WEB_HEAD + REPO_SUFFIX_HEAD
    payload_files: dict[str, dict] = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as zp:
        for item in zp.infolist():
            if item.is_dir() or not item.filename.startswith(p_head):
                continue
            suffix = item.filename[len(PAYLOAD_WEB_HEAD):]
            payload_files[suffix] = {"sha12": sha12(zp.read(item.filename)),
                                     "bytes": item.file_size}
    payload_pkgs = sorted({s.split("/", 3)[2] for s in payload_files})
    report["payload_web_packages"] = payload_pkgs

    # device 侧
    device_files: dict[str, dict] = {}
    device_pkgs: list[str] = []
    if probe.dev is not None:
        repo_pkgs_set = set(repo_pkgs)
        ls = probe.sh("ls -1 %s" % DEV_PLUGIN_BASE, "[A] ls -1 %s（只读）" % DEV_PLUGIN_BASE)
        device_pkgs = sorted({x.strip().rstrip("/") for x in ls.splitlines() if x.strip()})
        find = probe.sh("find %s -type f" % DEV_PLUGIN_BASE,
                        "[A] find %s -type f（只读）" % DEV_PLUGIN_BASE)
        # 只对「仓库管理的包」取哈希：上游包（dsh-client-*/dsh-tools 等）不在交付链上，
        # 顺带把 adb 命令行长度压住（本机 @deepseek-ai 下有 120+ 个文件）。
        dev_paths = sorted({x.strip() for x in find.splitlines()
                            if x.strip().startswith(DEV_PLUGIN_BASE + "/")
                            and x.strip()[len(DEV_WEB_HEAD):].split("/", 3)[2] in repo_pkgs_set})
        if dev_paths:
            hashes = parse_sha256sum(probe.sh("sha256sum " + " ".join(dev_paths),
                                              "[A] sha256sum %d 个仓库管理的设备侧插件文件（只读，不 pull）"
                                              % len(dev_paths)))
            sizes = parse_stat(probe.sh("stat -c '%s %n' " + " ".join(dev_paths),
                                        "[A] stat -c '%s %n' 同上（只读）"))
            for path in dev_paths:
                suffix = path[len(DEV_WEB_HEAD):]
                device_files[suffix] = {"sha12": hashes.get(path, "?"), "bytes": sizes.get(path, -1)}
    report["device_packages"] = device_pkgs
    report["device_plugin_base"] = DEV_PLUGIN_BASE

    expected_in_payload = set(payload_pkgs)
    dev_pkgs_set = set(device_pkgs)
    for pkg in repo_pkgs:
        if pkg not in expected_in_payload:
            report["notes"].append("repo 包 %s 不在 base APK web profile 的 @deepseek-ai 下"
                                   "（sync_base_apk_plugins.inspect 同样按 absent 跳过：只提示，不计入判定）"
                                   % pkg)
        if pkg in expected_in_payload and probe.dev is not None and pkg not in dev_pkgs_set:
            report["notes"].append("设备侧缺失整个包 %s（payload 里有、staging 没落）" % pkg)
    for pkg in sorted(dev_pkgs_set - set(repo_pkgs)):
        report["notes"].append("设备侧多出非仓库包 %s（上游包，不参与判定）" % pkg)

    # 逐文件行：repo 为基准；payload/device 只在与 repo 同包时纳入判定
    rows: list[dict] = []
    for suffix in sorted(want):
        pkg = suffix.split("/", 3)[2]
        repo_entry = {"sha12": sha12(want[suffix]), "bytes": len(want[suffix])}
        p_entry = payload_files.get(suffix)
        d_entry = device_files.get(suffix)
        flags: list[str] = []
        if pkg not in expected_in_payload:
            # 该包不走 base APK 的 @deepseek-ai 交付链（与 sync 闸门口径一致）：只提示，不计入不一致
            status = "n/a(payload)"
        else:
            if p_entry is None:
                flags.append("MISSING(payload)")
            elif p_entry["sha12"] != repo_entry["sha12"]:
                flags.append("STALE(payload)")
            if probe.dev is not None:      # staging 镜像 payload web profile -> payload 里有就应当在设备侧
                if d_entry is None:
                    flags.append("MISSING(device)")
                elif d_entry["sha12"] != repo_entry["sha12"]:
                    flags.append("STALE(device)")
            status = " ".join(flags) if flags else "OK"
        if flags:
            report["problems"].append("%s -> %s (repo=%s payload=%s device=%s)" % (
                suffix, status, cell(repo_entry), cell(p_entry), cell(d_entry)))
        rows.append({"file": suffix, "pkg": pkg, "repo": repo_entry,
                     "payload": p_entry, "device": d_entry, "status": status})

    # 多出来的文件（staged 副本不是纯粹镜像）也要报出来
    for suffix in sorted(set(payload_files) - set(want)):
        if suffix.split("/", 3)[2] in set(repo_pkgs):
            rows.append({"file": suffix, "pkg": suffix.split("/", 3)[2], "repo": None,
                         "payload": payload_files[suffix], "device": device_files.get(suffix),
                         "status": "EXTRA(payload)"})
            report["problems"].append("%s -> EXTRA(payload)" % suffix)
    for suffix in sorted(set(device_files) - set(want)):
        if suffix.split("/", 3)[2] in set(repo_pkgs):
            rows.append({"file": suffix, "pkg": suffix.split("/", 3)[2], "repo": None,
                         "payload": payload_files.get(suffix), "device": device_files[suffix],
                         "status": "EXTRA(device)"})
            report["problems"].append("%s -> EXTRA(device)（staging 里的残留）" % suffix)

    report["rows"] = rows
    report["verdict"] = "in-sync" if not report["problems"] else "OUT-OF-SYNC"
    return report


def write_phase_a(probe: Probe, rep: dict, want_json: bool) -> int:
    lines = [
        "# 批次81-T2-2 Phase A：插件交付链三方比对（repo <-> base APK payload <-> 设备）",
        "",
        "- 时间：%s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "- 设备：%s" % (rep.get("serial") or "(无设备：仅比对 repo<->payload)"),
        "- base APK：%s（%s B，mtime %s）" % (rep.get("apk"), rep.get("apk_bytes"), rep.get("apk_mtime")),
        "- payload.zip：%s B，sha12=%s" % (rep.get("payload_bytes"), rep.get("payload_sha12")),
        "- 设备侧 staging 根：%s" % rep.get("device_plugin_base"),
        "- repo 插件文件：%d 个；payload web profile @deepseek-ai 包：%s" % (
            rep.get("plugin_files"), ", ".join(rep.get("payload_web_packages") or [])),
        "- 设备侧 @deepseek-ai 包：%s" % ", ".join(rep.get("device_packages") or []),
        "- sync_base_apk_plugins.inspect：missing=%s mismatched=%s absent=%s" % (
            (rep.get("sync_inspect") or {}).get("missing"),
            (rep.get("sync_inspect") or {}).get("mismatched"),
            (rep.get("sync_inspect") or {}).get("absent_pkgs")),
        "",
    ]
    if rep.get("fatal"):
        lines.append("- **FATAL**：%s" % rep["fatal"])
    else:
        lines += [
            "| 文件（node_modules/@deepseek-ai/…） | repo | payload | device | 结论 |",
            "|---|---|---|---|---|",
        ]
        for row in rep["rows"]:
            lines.append("| %s | %s | %s | %s | %s |" % (
                row["file"].replace("node_modules/@deepseek-ai/", ""),
                cell(row["repo"]), cell(row["payload"]), cell(row["device"]), row["status"]))
        lines += ["", "- 结论：**%s**（问题 %d 条）" % (rep["verdict"], len(rep["problems"]))]
        for p in rep["problems"]:
            lines.append("  - %s" % p)
        for n in rep["notes"]:
            lines.append("  - note: %s" % n)
    lines += ["", "## 设备操作审计（Phase A）", ""] + ["- %s" % o for o in probe.ops]
    (probe.out / "report_phaseA.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (probe.out / "phaseA.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2) + "\n",
                                            encoding="utf-8")

    if want_json:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    else:
        print("[A] device=%s  apk=%s  payload_sha12=%s" % (
            rep.get("serial") or "(none)", rep.get("apk"), rep.get("payload_sha12")))
        print("[A] %-52s %-20s %-20s %-20s %s" % ("file", "repo", "payload", "device", "verdict"))
        for row in rep["rows"]:
            print("[A] %-52s %-20s %-20s %-20s %s" % (
                row["file"].replace("node_modules/@deepseek-ai/", "")[:52],
                cell(row["repo"]), cell(row["payload"]), cell(row["device"]), row["status"]))
        for n in rep["notes"]:
            print("[A] note: %s" % n)
        print("[A] verdict=%s problems=%d" % (rep["verdict"], len(rep["problems"])))
        for p in rep["problems"]:
            print("[A]   problem: %s" % p)
        print("[A] report: %s" % (probe.out / "report_phaseA.md"))
    return 2 if rep.get("fatal") else (0 if rep["verdict"] == "in-sync" else 1)


# ==========================================================================
# Phase B：虚拟屏直连工具自愈
# ==========================================================================
def normalize(text: str) -> str:
    return (text or "").strip().strip("`\"'\u3002. ")


ALL_SENTINELS = (SENTINEL_OK, SENTINEL_GUARD, SENTINEL_READONLY)


def classify(nodes: list[dict]) -> dict:
    """哨兵识别：只认「短行 = 哨兵」，绝不把回显的 prompt（含两个哨兵的长句）当答案。"""
    out = {"hit": "", "evidence": [], "echo": []}
    for n in nodes:
        text = (n.get("text") or "") or (n.get("desc") or "")
        if not text or not any(s in text for s in ALL_SENTINELS):
            continue
        norm = normalize(text)
        present = [s for s in ALL_SENTINELS if s in text]
        if len(present) > 1:
            out["echo"].append(text[:120])          # 回显的 prompt：两个哨兵都在，忽略
            continue
        exact = norm in ALL_SENTINELS
        short = len(norm) <= 40
        if not (exact or short):
            out["echo"].append(text[:120])
            continue
        out["evidence"].append({"text": text, "exact": exact, "cls": n.get("cls", "")})
        if not out["hit"]:
            out["hit"] = present[0]
    return out


def phase_b(probe: Probe, timeout: int, poll: int, prompt: str = LIVE_PROMPT) -> dict:
    prompt = prompt or LIVE_PROMPT
    res: dict = {"prompt": prompt, "sentinel_timeout_s": timeout, "poll_s": poll,
                 "timeline": [], "vscreen_nodes": [], "verdict": "", "reason": "",
                 "device_writes": "无（见设备操作审计）", "engine": {},
                 "create_nodes": [], "last_panel_texts": []}
    if probe.dev is None:
        res["verdict"], res["reason"] = "FAIL", "无 adb 设备"
        return res

    engine = probe.engine_state()
    res["engine"] = engine
    if not (engine["pid"] and engine["alive"] and engine["listening"]):
        res["verdict"] = "ABORT"
        res["reason"] = ("托管引擎未就绪（pid=%r alive=%s 3080_LISTEN=%s）：现在提交很可能不起轮，"
                          "会产生假阴性，先等引擎稳定再跑" % (engine["pid"], engine["alive"],
                                                       engine["listening"]))
        return res
    # App 本地桥（3081）是 /vscreen/* 的唯一后端：它不在时自愈必然 BRIDGE_UNREACHABLE → 假阴性
    if not engine.get("app_ok"):
        res["verdict"] = "ABORT"
        res["reason"] = ("App 本地桥（3081 /vscreen/*）不可达（GET /status http=%r，/proc LISTEN=%s）："
                          "此时自愈建屏必然报 BRIDGE_UNREACHABLE，产生假阴性。"
                          "真机事实（2026-09-19）：App 进程重启（如 adb install -r）后 3081 只在 "
                          "MainActivity.startEngine() 路径里启动，先跑 "
                          "am start -n com.deepseek.harness/.MainActivity 再试"
                          % (engine.get("app_status_http"), engine.get("app_listen")))
        return res

    # 1) 面板必须可见（提交后面板会收起，靠 am start AssistActivity 重新展开）
    panel = False
    for _ in range(4):
        if base.find_button(probe.nodes("B"), SEND_BTN):
            panel = True
            break
        probe.sh("am start -n com.deepseek.harness/.AssistActivity",
                 "[B] am start AssistActivity（展开面板，不改任务状态）")
        time.sleep(2.5)
    if not panel:
        res["verdict"], res["reason"] = "ABORT", "面板未展开/无障碍桥无节点：先让小鲸鱼面板可见再跑 --live"
        return res

    # 2) 注入 prompt（base64 传参，避免 Windows 侧中文参数乱码）+ 点「发送」
    b64 = base64.b64encode(prompt.encode("utf-8")).decode("ascii")
    probe.sh('am start -n com.deepseek.harness/.ProcessTextActivity '
             '-a android.intent.action.PROCESS_TEXT -t text/plain '
             '--es android.intent.extra.PROCESS_TEXT "$(echo %s | base64 -d)"' % b64,
             "[B] am start ProcessTextActivity（划词入口注入 prompt，base64 传参，不落盘）")
    time.sleep(1.5)
    btn = base.find_button(probe.nodes("B"), SEND_BTN)
    if not btn:
        res["verdict"], res["reason"] = "ABORT", "注入 prompt 后找不到「发送」按钮"
        return res
    probe.sh("input tap %d %d" % btn, "[B] input tap %d %d（点面板「发送」）" % btn)
    t0 = time.time()
    print("[B] +0s prompt 已提交（%d 字），等待哨兵（超时 %ds）" % (len(prompt), timeout))

    # 3) 轮询面板无障碍树
    hit, samples, statuses = "", [], []
    while time.time() - t0 < timeout:
        time.sleep(poll)
        probe.sh("am start -n com.deepseek.harness/.AssistActivity",
                 "[B] am start AssistActivity（每轮重新展开面板）")
        time.sleep(1.5)
        nodes = probe.nodes("B")
        cls = classify(nodes)
        status = base.status_line(nodes)
        if status:
            statuses.append((round(time.time() - t0, 1), status))
        for n in nodes:
            blob = "%s %s" % (n.get("text") or "", n.get("desc") or "")
            if "vscreen" in blob:
                res["vscreen_nodes"].append({"t": round(time.time() - t0, 1), "text": blob.strip()[:160]})
            # 只记录、不判定：面板若把工具的 create 调用渲染成一行，这里能留下痕迹供人工复核
            if "android_vscreen_create" in blob or "vscreen_create(" in blob:
                res["create_nodes"].append({"t": round(time.time() - t0, 1), "text": blob.strip()[:160]})
        if nodes:
            res["last_panel_texts"] = [(n.get("text") or n.get("desc") or "").strip() for n in nodes
                                       if (n.get("text") or n.get("desc") or "").strip()][:30]
        samples.append({"t": round(time.time() - t0, 1), "status": status,
                        "hit": cls["hit"], "evidence": cls["evidence"], "echo": cls["echo"][:1]})
        print("[B] +%ds status=%s hit=%s" % (int(time.time() - t0), status or "(未取到)",
                                              cls["hit"] or "-"))
        if cls["hit"]:
            hit = cls["hit"]
            break

    res["timeline"] = samples
    res["status_lines"] = statuses
    if hit == SENTINEL_OK:
        res["verdict"] = "PASS"
        res["reason"] = ("虚拟屏直连工具在未建屏守卫态下自愈建屏并完成动作（工具返回 ok=true），"
                          "全程只需要工具自己建屏、不需要模型手动 android_vscreen_create")
    elif hit == SENTINEL_GUARD:
        res["verdict"] = "FAIL"
        res["reason"] = "仍是守卫拒绝（NOT_CREATED）：自愈没生效，可能是插件没上机（先看 Phase A）"
    elif hit == SENTINEL_READONLY:
        res["verdict"] = "WARN"
        res["reason"] = ("自愈已真实发起建屏（工具结果里带「自愈创建虚拟屏失败」），"
                          "但 App 按设计拒绝了只读任务的建屏（READONLY_TASK）——"
                          "该 prompt 被判成只读任务，属测试设计限制而非缺陷；"
                          "要拿到 PASS，用带动作词的指令重跑：--prompt \"...点击…\"")
    else:
        res["verdict"] = "FAIL"
        res["reason"] = ("%ds 内未出现哨兵；最后采样状态行=%r；vscreen 相关节点 %d 条%s" % (
            timeout, statuses[-1][1] if statuses else "(未取到)", len(res["vscreen_nodes"]),
            "（无 vscreen 节点 → 很可能 prompt 没起轮或模型没调工具）" if not res["vscreen_nodes"] else ""))
    return res


def write_phase_b(probe: Probe, rep: dict, want_json: bool) -> int:
    lines = [
        "# 批次81-T2-2 Phase B：虚拟屏直连工具自愈（android_vscreen_see 守卫态自愈）",
        "",
        "- 时间：%s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "- 设备：%s" % probe.serial,
        "- 托管引擎：pid=%s alive=%s 3080_LISTEN=%s" % (rep["engine"].get("pid"),
                                                       rep["engine"].get("alive"),
                                                       rep["engine"].get("listening")),
        "- App 本地桥 3081：/status http=%s（/proc LISTEN=%s）" % (
            rep["engine"].get("app_status_http"), rep["engine"].get("app_listen")),
        "- 哨兵超时：%ss，采样间隔：%ss" % (rep["sentinel_timeout_s"], rep["poll_s"]),
        "- 设备写操作：%s" % rep["device_writes"],
        "",
        "## 提交的 prompt",
        "",
        "```",
        rep["prompt"],
        "```",
        "",
        "## 判定",
        "",
        "- **%s**：%s" % (rep["verdict"], rep["reason"]),
        "",
        "## 采样时间线（面板无障碍树）",
        "",
        "| t(s) | 任务状态行 | 哨兵 | 证据节点 |",
        "|---|---|---|---|",
    ]
    for s in rep["timeline"]:
        ev = "; ".join("%s(exact=%s)" % (e["text"][:40], e["exact"]) for e in s["evidence"]) or "-"
        lines.append("| %s | %s | %s | %s |" % (s["t"], s["status"] or "-", s["hit"] or "-", ev))
    lines += ["", "## vscreen 相关节点样本（判断模型是否真的调了工具）", ""]
    lines += ["- +%ss %s" % (v["t"], v["text"]) for v in rep["vscreen_nodes"][:20]] or ["- (无)"]
    lines += ["", "## android_vscreen_create 痕迹（不参与判定，只作复核线索）", ""]
    lines += ["- +%ss %s" % (v["t"], v["text"]) for v in rep["create_nodes"][:10]] or ["- (无)"]
    lines += ["", "> caveat：哨兵按上表判定（B81_SELFHEAL_OK=PASS / B81_READONLY=WARN / B81_GUARD_STILL 或超时=FAIL）。"
                  "若上面出现 create 调用痕迹，说明模型可能自己建了屏，该 PASS 不能单独作为「自愈」证据；"
                  "更硬的复核是读引擎会话转写（/sdcard/DeepSeekHarness/home/sessions/--data-local-tmp-dsh--/"
                  "session-*/session.v3.jsonl.zstd，zstd 解压后看本轮 tool/call 列表里有没有 android_vscreen_create）。"
                  "另：android_vscreen_see 的工具描述本身含「需先 android_vscreen_create」字样，"
                  "面板若展示工具描述会产生误报，故本项只记录、不判定。", ""]
    lines += ["", "## 最后一次面板节点快照（供人工复核，最多 30 条）", ""]
    lines += ["- %s" % t for t in rep["last_panel_texts"]] or ["- (无)"]
    lines += ["", "## 设备操作审计（Phase A + B 全量）", ""] + ["- %s" % o for o in probe.ops]
    (probe.out / "report_phaseB.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (probe.out / "phaseB.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2) + "\n",
                                            encoding="utf-8")
    if want_json:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    else:
        print("[B] verdict=%s  %s" % (rep["verdict"], rep["reason"]))
        print("[B] report: %s" % (probe.out / "report_phaseB.md"))
    return {"PASS": 0, "FAIL": 1}.get(rep["verdict"], 3 if rep["verdict"] == "WARN" else 2)


def main(argv: list[str]) -> int:
    use_utf8_stdout()
    ap = argparse.ArgumentParser(description="批次81-T2-2 插件交付链 + 虚拟屏自愈 e2e")
    ap.add_argument("--serial", help="adb serial（默认动态选设备，不写死）")
    ap.add_argument("--check-only", action="store_true",
                    help="只跑 Phase A（只读比对）并禁止与 --live 同用；Phase A 本来就是只读")
    ap.add_argument("--out-dir", type=Path, help="报告目录（默认 .local/repro/b81/<stamp>）")
    ap.add_argument("--json", action="store_true", help="stdout 输出机器可读 JSON")
    ap.add_argument("--live", action="store_true", help="附加执行 Phase B（需面板可见 + 托管引擎在跑）")
    ap.add_argument("--live-timeout", type=int, default=150, help="Phase B 哨兵等待秒数（默认 150）")
    ap.add_argument("--poll", type=int, default=5, help="Phase B 面板采样间隔（默认 5s）")
    ap.add_argument("--prompt", help="Phase B 自定义 prompt（默认用内置的自愈探针；"
                                     "只读指令会被 App 的只读闸门拒建屏 → 用带动作词的指令可拿 PASS）")
    ap.add_argument("--prompt-file", type=Path,
                    help="从 UTF-8 文件读 Phase B prompt（多行含中文时避开 shell 传参乱码）")
    args = ap.parse_args(argv[1:])

    if args.check_only and args.live:
        print("[e2e] --check-only 与 --live 互斥（check-only 只做只读 Phase A）")
        return 2

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = args.out_dir or Path(".local/repro/b81") / (stamp + ("-live" if args.live else ""))
    probe = Probe(args.serial, out)
    if probe.dev is None:
        print("[e2e] 未找到 adb 设备：Phase A 将只比对 repo <-> payload，退出码 2")

    rc_a = write_phase_a(probe, phase_a(probe), args.json)
    rc = rc_a
    if args.live:
        if rc_a:
            print("[e2e] 提示：Phase A 未全一致（exit %d）—— 设备侧插件很可能不是当前仓库版本"
                  "，Phase B 若失败先排除这一点" % rc_a)
        prompt = args.prompt
        if not prompt and args.prompt_file:
            prompt = args.prompt_file.read_text(encoding="utf-8")
        rc_b = write_phase_b(probe, phase_b(probe, args.live_timeout, args.poll, prompt), args.json)
        rc = max(rc_a, rc_b)
    if not args.json:
        print("[e2e] out=%s  exit=%d" % (probe.out, rc))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
