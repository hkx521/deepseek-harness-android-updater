#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次76：小鲸鱼助手 <-> dsh 引擎「任务状态是否同源」真机取证脚本（只取证 + 判定，不改设备状态）。

背景（用户反馈）
----------------
「执行长复杂任务时，dsh 里还在持续执行，但小鲸鱼助手显示执行失败」。
根因候选（见 docs/批次76-*.md）：助手不订阅会话事件流，只靠 1s 轮询 session.list/session.page
的快照 + 本地启发式判定；任何一次本地判定失败都不会取消引擎里的 turn，也没有重挂路径。

本脚本做的事
------------
1. 通过 App 自己的「划词处理」入口（ProcessTextActivity，等价于用户选中文字 -> 小鲸鱼处理）
   把提示词写进悬浮面板输入框，再点「发送」（坐标从 App 无障碍桥 /dump 自动定位）；
2. 全程流式抓 logcat：dsh-overlay 的 diag: 行给出引擎侧会话快照
   （session / running / records / 轮询#），dsh-overlay-agent 的 agent task failed: 行给出
   助手侧最终判定（[stage/code]）；
3. 每 --poll 秒用无障碍桥读一次面板状态行（任务：...），落盘为时间线；
4. 输出判定 ASSISTANT_OK / ASSISTANT_FAILED([code])；若助手判失败后引擎仍在产出新事件
   （records 增长或 running=true）则标记 DIVERGENCE；
5. 报告 + 原始 logcat 落到 --out-dir（默认 .local/e2e_assistant/<ts>/）。

安全红线
--------
* 不打印引擎 token（a11y 桥的 X-DSH-Token 只在设备侧脚本里读取使用）；
* 设备写操作仅：logcat -G/-c（取证缓冲）、am start（App 自己的入口）、input tap（点「发送」）。

用法
----
    python tools/e2e_assistant_long_task.py --prompt-file .local/long_prompt.txt --timeout 1800
    python tools/e2e_assistant_long_task.py --prompt "打开设置里的 WLAN 并读取当前连接" --timeout 300
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

RE_FAIL = re.compile(r"agent task failed:\s*(?P<detail>.+)$")
# 批次77：引擎侧本轮已结束、助手未取到文本 —— 中性终态（不是失败，也不是成功）
RE_NEUTRAL = re.compile("引擎侧本轮已结束")
NEUTRAL_TEXT = "（引擎侧本轮已结束，但未取到文本结果；可在 dsh 会话里查看本轮详情）"
RE_DIAG = re.compile(
    r"diag:\s*session=(?P<session>\S+)\s+running=(?P<running>true|false)"
    r"\s+已等待(?P<waited>\d+)s\s+轮询#(?P<round>\d+)\s+records=(?P<records>\d+)"
)

A11Y_SH = '''#! /system/bin/sh
. /data/local/tmp/dsh/engine.env 2>/dev/null
export LD_LIBRARY_PATH=/data/local/tmp/dsh/runtime/lib
curl -s -m 10 -H "X-DSH-Token: $APP_LOCAL_TOKEN" "http://127.0.0.1:3181/$1" > /data/local/tmp/e2e_a11y.json
'''

SEND_SH = '''#! /system/bin/sh
PROMPT=$(echo "$1" | base64 -d)
am start -n com.deepseek.harness/.ProcessTextActivity -a android.intent.action.PROCESS_TEXT \\
  -t text/plain --es android.intent.extra.PROCESS_TEXT "$PROMPT" >/dev/null
'''


class Device:
    def __init__(self, serial: str):
        self.serial = serial

    def adb(self, *args: str, timeout: int = 30) -> subprocess.CompletedProcess:
        return subprocess.run(["adb", "-s", self.serial, *args], capture_output=True,
                              text=True, encoding="utf-8", errors="replace", timeout=timeout)

    def shell(self, cmd: str, timeout: int = 30) -> str:
        return self.adb("shell", cmd, timeout=timeout).stdout

    def push(self, local: Path, remote: str) -> None:
        self.adb("push", str(local), remote, timeout=60)


def pick_serial(arg):
    if arg:
        return arg
    out = subprocess.run(["adb", "devices"], capture_output=True, text=True).stdout
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            return parts[0]
    raise SystemExit("未找到 adb 设备")


def nodes(dev: Device, workdir: Path):
    dev.shell("sh /data/local/tmp/e2e_a11y.sh dump")
    tmp = workdir / "a11y.json"
    dev.adb("pull", "/data/local/tmp/e2e_a11y.json", str(tmp))
    try:
        return json.loads(tmp.read_text(encoding="utf-8", errors="replace")).get("nodes", [])
    except (OSError, json.JSONDecodeError):
        return []


def find_button(ns, text):
    for n in ns:
        if n.get("text") == text or n.get("desc") == text:
            return n["x"] + n["w"] // 2, n["y"] + n["h"] // 2
    return None


def status_line(ns):
    for n in ns:
        t = n.get("text") or ""
        if t.startswith("任务：") or t.startswith("任务:"):
            return t
    return ""


def parse_log(lines):
    diags, fails = [], []
    for ln in lines:
        m = RE_DIAG.search(ln)
        if m:
            diags.append({"ts": ln[:18], "records": int(m["records"]),
                          "running": m["running"] == "true", "round": int(m["round"])})
        f = RE_FAIL.search(ln)
        if f:
            fails.append({"ts": ln[:18], "detail": f["detail"].strip()})
    return diags, fails


def judge(diags, fails, final_status):
    # 批次77：判定顺序 = 真失败 > 中性终态 > 成功
    if (final_status and "已结束" in final_status) or any(RE_NEUTRAL.search(d["detail"]) for d in fails):
        verdict = "ASSISTANT_ENDED_NO_TEXT（中性终态：引擎侧已结束、未取到文本）"
    else:
        verdict = "ASSISTANT_OK"
    if fails and not RE_NEUTRAL.search(fails[-1]["detail"]):
        verdict = "ASSISTANT_FAILED " + fails[-1]["detail"]
    elif "失败" in final_status:
        verdict = "ASSISTANT_FAILED " + final_status
    divergence = False
    if fails and diags:
        idx = 0
        for i, d in enumerate(diags):
            if d["ts"] <= fails[-1]["ts"]:
                idx = i
        base = diags[idx]["records"]
        divergence = any(a["running"] or a["records"] > base for a in diags[idx + 1:])
        if divergence:
            verdict += "  [DIVERGENCE：助手判失败后引擎仍有活动]"
    return verdict, divergence


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial")
    ap.add_argument("--prompt")
    ap.add_argument("--prompt-file", type=Path)
    ap.add_argument("--timeout", type=int, default=1800, help="最长等待秒数（默认 1800）")
    ap.add_argument("--poll", type=int, default=15, help="面板状态采样间隔（秒）")
    ap.add_argument("--out-dir", type=Path)
    args = ap.parse_args()

    if args.prompt_file:
        prompt = args.prompt_file.read_text(encoding="utf-8")
    elif args.prompt:
        prompt = args.prompt
    else:
        raise SystemExit("需要 --prompt 或 --prompt-file")

    dev = Device(pick_serial(args.serial))
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = args.out_dir or Path(".local/e2e_assistant") / stamp
    out.mkdir(parents=True, exist_ok=True)

    tmp = Path(".local/e2e_helpers")
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / "e2e_a11y.sh").write_text(A11Y_SH, encoding="utf-8", newline="\n")
    (tmp / "e2e_send.sh").write_text(SEND_SH, encoding="utf-8", newline="\n")
    dev.push(tmp / "e2e_a11y.sh", "/data/local/tmp/e2e_a11y.sh")
    dev.push(tmp / "e2e_send.sh", "/data/local/tmp/e2e_send.sh")
    dev.shell("chmod 755 /data/local/tmp/e2e_a11y.sh /data/local/tmp/e2e_send.sh")

    ns = nodes(dev, out)
    if not ns:
        raise SystemExit("无障碍桥没有返回节点（App/引擎/无障碍是否在线？）")
    send_btn = find_button(ns, "发送")
    if not send_btn:
        raise SystemExit("面板未展开或找不到「发送」按钮：请先让悬浮面板可见")

    dev.shell("logcat -G 8M; logcat -c")
    log_path = out / "logcat.txt"
    log_fh = open(log_path, "w", encoding="utf-8", errors="replace")
    logcat = subprocess.Popen(["adb", "-s", dev.serial, "logcat", "-v", "time"],
                              stdout=log_fh, stderr=subprocess.DEVNULL, text=True,
                              encoding="utf-8", errors="replace")

    b64 = base64.b64encode(prompt.encode("utf-8")).decode()
    dev.shell("sh /data/local/tmp/e2e_send.sh " + b64)
    time.sleep(1.2)
    dev.shell("input tap %d %d" % send_btn)
    print("[e2e] prompt 已提交（%d 字），out=%s" % (len(prompt), out))

    timeline = []
    t0 = time.time()
    final_status = ""
    while time.time() - t0 < args.timeout:
        time.sleep(args.poll)
        line = status_line(nodes(dev, out))
        timeline.append((round(time.time() - t0, 1), line))
        print("[e2e] +%ds %s" % (int(time.time() - t0), line))
        if line.startswith("任务：") and "执行中" not in line and "提交中" not in line:
            final_status = line
            break

    time.sleep(3)
    logcat.terminate()
    log_fh.close()
    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    diags, fails = parse_log(lines)
    verdict, _ = judge(diags, fails, final_status)

    report = out / "report.md"
    report.write_text("\n".join([
        "# 小鲸鱼助手 <-> dsh 任务状态取证报告",
        "- 时间：%s  设备：%s" % (stamp, dev.serial),
        "- 提示词长度：%d 字" % len(prompt),
        "- 助手最终状态行：%s" % (final_status or "(未取到)"),
        "- 助手侧失败记录：%s" % (fails if fails else "无"),
        "- 轮询采样：%d 条（最后一条：%s）" % (len(diags), diags[-1] if diags else "无"),
        "- 面板时间线：%s" % timeline,
        "- **判定：%s**" % verdict,
        "",
        "原始 logcat：logcat.txt（含每秒一条 diag: 行，可直接比对引擎 running/records）。",
    ]), encoding="utf-8")
    print("[e2e] " + verdict)
    print("[e2e] 报告：%s" % report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
