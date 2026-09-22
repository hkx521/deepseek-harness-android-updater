#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次79（T4）：助手状态与引擎同源的真机定向验证。

两种模式：
  --mode live  会话探测修复（Cookie + 路径口径）：任务运行期面板详情必须显示「AI：回复中…」，
               且任务正常收尾、全程无 agent task failed。
  --mode fail  只读续跟入口：用 SIGSTOP 引擎制造一次真实失败（session.prompt 超时）→ 终态露出
               「🔄 续跟引擎」→ 点击后只读跟踪引擎会话 → 中性收尾「引擎侧状态已同步」。

设备事实（真机标定，勿随意改）：
* 提交后面板会收起；要读面板状态必须先 `am start -n com.deepseek.harness/.AssistActivity` 重新展开；
* 详情（含「AI：回复中…/空闲」行）要展开需点标题栏的「ⓘ」；
* 无障碍桥 `tap?text=` 可点 0 宽节点，但坐标点击不行。

安全：不 install / 不 pm clear / 不改设备设置；SIGSTOP/CONT 只作用于托管引擎（shell 拥有），
且脚本保证一定会 CONT（含异常路径）。

用法：
    python tools/e2e_batch79_track.py --mode live
    python tools/e2e_batch79_track.py --mode fail
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_assistant_long_task as base  # noqa: E402

TRACK_CHIP = "\U0001f504 \u7eed\u8ddf\u5f15\u64ce"          # 🔄 续跟引擎
SEND = "\u53d1\u9001"                                        # 发送
AI_RUNNING = "AI\uff1a\u56de\u590d\u4e2d\u2026"              # AI：回复中…
AI_IDLE = "AI\uff1a\u7a7a\u95f2"                             # AI：空闲
DETAIL_TITLE = "\u5c0f\u9cb8\u9c7c \u00b7 \u8be6\u60c5"     # 小鲸鱼 · 详情
INFO_BTN = "\u24d8"                                           # ⓘ
TASK_PREFIX = "\u4efb\u52a1"                                  # 任务

LIVE_PROMPT = ("Please call the bash tool exactly 6 times: each call runs `sleep 12` with "
               "timeoutMs 30000 and prints the counter. Then reply with exactly: E2E79_LIVE")
FAIL_PROMPT = "Reply with exactly one short line: E2E79_FAILPATH"

PAUSE_SH = """#! /system/bin/sh
# 暂停/恢复托管引擎（可逆）：STOP -> sleep N -> CONT
PID=$(cat /data/local/tmp/dsh/engine.pid 2>/dev/null)
echo "stopped ts=$(date +%s)" > /data/local/tmp/e2e_b79_pause.log
kill -STOP "$PID" 2>>/data/local/tmp/e2e_b79_pause.log
sleep "$1"
kill -CONT "$PID" 2>>/data/local/tmp/e2e_b79_pause.log
echo "resumed ts=$(date +%s)" >> /data/local/tmp/e2e_b79_pause.log
"""


class Runner:
    def __init__(self, serial: str | None, out: Path, mode: str):
        self.dev = base.Device(base.pick_serial(serial))
        self.out = out
        self.mode = mode
        self.out.mkdir(parents=True, exist_ok=True)
        self.log_path = out / "logcat.txt"
        self.results: list[tuple[str, str, str]] = []

    # ---------- 基础设施 ----------
    def setup_helpers(self) -> None:
        tmp = Path(".local/e2e_b79_helpers")
        tmp.mkdir(parents=True, exist_ok=True)
        for name, body in (("e2e_a11y.sh", base.A11Y_SH), ("e2e_send.sh", base.SEND_SH),
                           ("e2e_pause.sh", PAUSE_SH)):
            (tmp / name).write_text(body, encoding="utf-8", newline="\n")
            self.dev.push(tmp / name, "/data/local/tmp/" + name)
        self.dev.shell("chmod 755 /data/local/tmp/e2e_a11y.sh /data/local/tmp/e2e_send.sh "
                       "/data/local/tmp/e2e_pause.sh")

    def logcat(self) -> str:
        return self.dev.shell("logcat -d -v time -s dsh-overlay dsh-overlay-agent dsh-overlay-mux")

    def nodes(self):
        return base.nodes(self.dev, self.out)

    def texts(self, ns=None) -> list[str]:
        return [(n.get("text") or n.get("desc") or "") for n in (ns if ns is not None else self.nodes())]

    def status(self) -> str:
        return base.status_line(self.nodes())

    def a11y_tap(self, text: str) -> dict:
        self.dev.shell("sh /data/local/tmp/e2e_a11y.sh 'tap?text=%s'" % quote(text, safe=""))
        tmp = self.out / "tap.json"
        self.dev.adb("pull", "/data/local/tmp/e2e_a11y.json", str(tmp))
        try:
            return json.loads(tmp.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            return {}

    def raise_panel(self) -> None:
        """提交后面板会收起；重新展开（不影响正在跑的任务）。"""
        self.dev.shell("am start -n com.deepseek.harness/.AssistActivity")
        time.sleep(2.5)

    def ensure_panel(self) -> bool:
        for _ in range(4):
            if base.find_button(self.nodes(), SEND):
                return True
            self.raise_panel()
        return False

    def open_details_if_needed(self, ns, ts) -> None:
        if DETAIL_TITLE in ts:
            return
        self.a11y_tap(INFO_BTN)
        time.sleep(1.0)

    def submit(self, prompt: str) -> None:
        self.dev.shell("sh /data/local/tmp/e2e_send.sh "
                       + base64.b64encode(prompt.encode("utf-8")).decode())
        time.sleep(1.5)
        btn = base.find_button(self.nodes(), SEND)
        if not btn:
            raise SystemExit("找不到「发送」按钮：请先让悬浮面板可见")
        self.dev.shell("input tap %d %d" % btn)

    def add(self, name: str, ok: bool, detail: str) -> None:
        self.results.append((name, "PASS" if ok else "FAIL", detail))
        print("[%s] %s - %s" % ("PASS" if ok else "FAIL", name, detail), flush=True)

    # ---------- 场景 A：会话探测（Cookie 修复） ----------
    def scn_live(self) -> None:
        self.dev.shell("logcat -c")
        self.submit(LIVE_PROMPT)
        ai_running = []
        statuses = []
        t0 = time.time()
        while time.time() - t0 < 240:
            time.sleep(5)
            self.raise_panel()
            ns = self.nodes()
            ts = self.texts(ns)
            self.open_details_if_needed(ns, ts)
            ts = self.texts()
            status = next((t for t in ts if t.startswith(TASK_PREFIX)), "")
            ai = next((t for t in ts if t.startswith("AI\uff1a")), "")
            if status:
                statuses.append(status)
            if ai == AI_RUNNING:
                ai_running.append((int(time.time() - t0), status, ai))
            print("+%ds status=%s ai=%s" % (int(time.time() - t0), status, ai), flush=True)
            if status.startswith(TASK_PREFIX) and not any(
                    k in status for k in ("\u6267\u884c\u4e2d", "\u63d0\u4ea4\u4e2d")):
                break
        final = statuses[-1] if statuses else ""
        log = self.logcat()
        self.add("A1 \u4efb\u52a1\u8fdb\u5165\u6267\u884c\u4e2d",
                 any("\u6267\u884c\u4e2d" in s for s in statuses),
                 "\u91c7\u6837 %d \u6761\uff0c\u6700\u540e %s" % (len(statuses), final))
        self.add("A2 \u8fd0\u884c\u671f\u95f4\u9762\u677f AI \u884c=\u300c\u56de\u590d\u4e2d\u2026\u300d",
                 bool(ai_running),
                 "\u547d\u4e2d %d \u6b21\uff1a%s" % (len(ai_running), ai_running[:2]))
        self.add("A3 \u4efb\u52a1\u6b63\u5e38\u6536\u5c3e",
                 final.startswith(TASK_PREFIX) and "\u6210\u529f" in final,
                 final or "(\u672a\u53d6\u5230)")
        self.add("A4 \u5168\u7a0b\u65e0 agent task failed",
                 "agent task failed" not in log, "\u6247 %d \u884c\u65e5\u5fd7" % len(log.splitlines()))
        self.dev.shell("logcat -d -v time -s dsh-overlay > /data/local/tmp/e2e_b79_overlay.log")

    # ---------- 场景 B：失败 → 续跟 ----------
    def scn_fail(self) -> None:
        self.dev.shell("logcat -c")
        pid = self.dev.shell("cat /data/local/tmp/dsh/engine.pid").strip()
        self.dev.shell("setsid sh /data/local/tmp/e2e_pause.sh 60 >/dev/null 2>&1 &")
        time.sleep(2)
        stopped = "stopped" in self.dev.shell("cat /data/local/tmp/e2e_b79_pause.log 2>/dev/null")
        self.add("B0 \u5f15\u64ce\u5df2 SIGSTOP\uff08\u5236\u9020 RPC \u8d85\u65f6\uff09", stopped,
                 "engine pid=%s log=%s" % (pid, self.dev.shell(
                     "cat /data/local/tmp/e2e_b79_pause.log 2>/dev/null").replace("\n", " | ")))
        try:
            self.ensure_panel()
            self.submit(FAIL_PROMPT)
            final = ""
            t0 = time.time()
            while time.time() - t0 < 90:
                time.sleep(5)
                self.raise_panel()
                final = self.status()
                print("B +%ds status=%s" % (int(time.time() - t0), final), flush=True)
                if final.startswith(TASK_PREFIX) and "\u5931\u8d25" in final:
                    break
            self.add("B1 \u5931\u8d25\u7ec8\u6001\uff08\u771f\u5b9e\u8d85\u65f6\uff09",
                     "\u5931\u8d25" in final, final or "(\u672a\u53d6\u5230)")
            ts = self.texts()
            self.add("B2 \u7ec8\u6001\u9732\u51fa\u300c\u7eed\u8ddf\u5f15\u64ce\u300d",
                     TRACK_CHIP in ts, "chip=%s" % (TRACK_CHIP in ts))
            if TRACK_CHIP in ts:
                tap = self.a11y_tap(TRACK_CHIP)
                time.sleep(2.0)
                cur = self.status()
                self.add("B3 \u70b9\u51fb\u540e\u8fdb\u5165\u53ea\u8bfb\u7eed\u8ddf", "\u7eed\u8ddf" in cur,
                         "tap=%s status=%s" % (tap.get("found"), cur or "(\u672a\u53d6\u5230)"))
                t1 = time.time()
                while time.time() - t1 < 90:
                    time.sleep(3)
                    cur = self.status()
                    if "\u5df2\u540c\u6b65" in cur:
                        break
                self.add("B4 \u7eed\u8ddf\u4e2d\u6027\u6536\u5c3e\uff08\u4e0d\u8c0e\u62a5\u6210\u529f/\u5931\u8d25\uff09",
                         "\u5df2\u540c\u6b65" in cur, cur or "(\u672a\u53d6\u5230)")
        finally:
            # 保证引擎一定被恢复（无论前面哪个断言失败）
            self.dev.shell("kill -CONT %s" % (pid or "$(cat /data/local/tmp/dsh/engine.pid)"))
            time.sleep(1)
            self.add("B5 \u5f15\u64ce\u5df2 SIGCONT\uff08\u6536\u5c3e\u4fdd\u5e95\uff09",
                     "stopped" in self.dev.shell("cat /data/local/tmp/e2e_b79_pause.log 2>/dev/null"),
                     "engine pid=%s" % pid)
        log = self.logcat()
        self.add("B6 \u7eed\u8ddf\u671f\u95f4\u65e0\u4efb\u52a1\u8bef\u5224", "agent track failed" not in log,
                 "\u6247 %d \u884c\u65e5\u5fd7" % len(log.splitlines()))

    def report(self) -> Path:
        path = self.out / ("report_%s.md" % self.mode)
        fails = [r for r in self.results if r[1] == "FAIL"]
        path.write_text("\n".join([
            "# \u6279\u6b2179 \u52a9\u624b\u72b6\u6001\u540c\u6e90\u9a8c\u8bc1\uff08mode=%s\uff09" % self.mode,
            "- \u8bbe\u5907\uff1a%s" % self.dev.serial,
            "- \u65f6\u95f4\uff1a%s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "- \u7ed3\u8bba\uff1a**%s**\uff08%d \u9879\uff0c\u5931\u8d25 %d\uff09" % (
                "\u5168\u901a\u8fc7" if not fails else "\u6709\u5931\u8d25", len(self.results), len(fails)),
            "",
        ] + ["- [%s] %s - %s" % (v, n, d) for n, v, d in self.results]), encoding="utf-8")
        return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial")
    ap.add_argument("--mode", choices=("live", "fail"), default="live")
    ap.add_argument("--out-dir", type=Path)
    args = ap.parse_args()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = args.out_dir or Path(".local/repro/b79") / ("%s-%s" % (args.mode, stamp))
    r = Runner(args.serial, out, args.mode)
    r.setup_helpers()
    if not r.nodes():
        raise SystemExit("\u65e0\u969c\u788d\u6865\u6ca1\u6709\u8fd4\u56de\u8282\u70b9")
    if not r.ensure_panel():
        raise SystemExit("\u9762\u677f\u672a\u5c55\u5f00\uff1a\u5148\u8ba9\u5c0f\u9cb8\u9c7c\u9762\u677f\u53ef\u89c1")
    (r.scn_live if args.mode == "live" else r.scn_fail)()
    path = r.report()
    fails = [x for x in r.results if x[1] == "FAIL"]
    print("[e2e] report: %s" % path)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
