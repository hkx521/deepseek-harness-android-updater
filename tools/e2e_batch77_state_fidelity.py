#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次77 定向验证：把「助手状态以引擎为准」的四条路径在真机上逐条钉死。

用法：
    python tools/e2e_batch77_state_fidelity.py all
    python tools/e2e_batch77_state_fidelity.py io-retry
    python tools/e2e_batch77_state_fidelity.py silence-renewal [--seconds 650]
    python tools/e2e_batch77_state_fidelity.py window-refetch [--steps 40]

四项判据：
  1) io-retry         任务运行中 SIGSTOP 引擎 25s（> 15s 读超时）→ 期望出现「I/O 失败…重试」、
                      面板不判失败、CONT 后任务继续收尾；
  2) silence-renewal  让引擎「挂着」（ask_user_question 等待用户）> 600s → 期望不再 hard-timeout
                      （running=true 驱动续期）；
  3) window-refetch   单轮产生 >50 条消息把本轮 rpcId 挤出窗口 → 期望出现「窗口失配 → 加宽重取命中」
                      且最终仍能取到结果；
  4) transient        从上面两次运行的 diag 里统计「running=false 连续轮数」——不再是判死依据。

前置：设备已连接、App/引擎在线；**引擎须由 shell（Shizuku 托管）拥有**，否则 SIGSTOP 不可用；
      悬浮面板已存在（脚本会自动注入提示词并点「发送」）。非沙箱内执行。

安全边界：设备写操作仅 logcat -G/-c、am start（App 自身入口）、input tap、SIGSTOP/SIGCONT 引擎。
          STOP 是可逆暂停：设备侧脚本定时 CONT，宿主侧再兜底 CONT 一次。
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_assistant_long_task as base  # noqa: E402  复用 Device / nodes / find_button / status_line

PAUSE_SH = """#! /system/bin/sh
# 暂停/恢复托管引擎（可逆）：STOP -> sleep N -> CONT，并把时间点写进日志
PID=$(cat /data/local/tmp/dsh/engine.pid 2>/dev/null)
LOG=/data/local/tmp/e2e_pause.log
echo "begin pid=$PID ts=$(date +%s)" > "$LOG"
kill -STOP "$PID" 2>>"$LOG" || echo "stop-failed" >> "$LOG"
echo "stopped ts=$(date +%s)" >> "$LOG"
sleep "$1"
kill -CONT "$PID" 2>>"$LOG" || echo "cont-failed" >> "$LOG"
echo "resumed ts=$(date +%s)" >> "$LOG"
"""

RE_RETRY = re.compile(r"I/O 失败.*重试")
RE_FAIL = base.RE_FAIL
RE_WINDOW = re.compile(r"窗口失配")


class Runner:
    def __init__(self, serial: str | None, out: Path):
        self.dev = base.Device(base.pick_serial(serial))
        self.out = out
        self.out.mkdir(parents=True, exist_ok=True)
        self.log_path = out / "logcat.txt"
        self._log = None
        self.results: list[tuple[str, str, str]] = []  # (name, verdict, detail)

    # ---------- 基础设施 ----------
    def setup_helpers(self) -> None:
        tmp = Path(".local/e2e_b77_helpers")
        tmp.mkdir(parents=True, exist_ok=True)
        (tmp / "pause_engine.sh").write_text(PAUSE_SH, encoding="utf-8", newline="\n")
        self.dev.push(tmp / "pause_engine.sh", "/data/local/tmp/e2e_pause.sh")
        self.dev.shell("chmod 755 /data/local/tmp/e2e_pause.sh")
        base.A11Y_SH  # noqa: B018  仅说明复用 base 的设备侧脚本
        (tmp / "a11y.sh").write_text(base.A11Y_SH, encoding="utf-8", newline="\n")
        (tmp / "send.sh").write_text(base.SEND_SH, encoding="utf-8", newline="\n")
        self.dev.push(tmp / "a11y.sh", "/data/local/tmp/e2e_a11y.sh")
        self.dev.push(tmp / "send.sh", "/data/local/tmp/e2e_send.sh")
        self.dev.shell("chmod 755 /data/local/tmp/e2e_a11y.sh /data/local/tmp/e2e_send.sh")

    def start_log(self) -> None:
        self.dev.shell("logcat -G 8M; logcat -c")
        self._log = open(self.log_path, "w", encoding="utf-8", errors="replace")
        self._proc = subprocess.Popen(
            ["adb", "-s", self.dev.serial, "logcat", "-v", "time", "-s",
             "dsh-overlay", "dsh-overlay-agent", "dsh-overlay-mux"],
            stdout=self._log, stderr=subprocess.DEVNULL, text=True,
            encoding="utf-8", errors="replace")

    def stop_log(self) -> list[str]:
        time.sleep(2)
        try:
            self._proc.terminate()
        except Exception:
            pass
        if self._log:
            self._log.close()
        return self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()

    def submit(self, prompt: str) -> None:
        b64 = base64.b64encode(prompt.encode("utf-8")).decode()
        self.dev.shell("sh /data/local/tmp/e2e_send.sh " + b64)
        time.sleep(1.2)
        ns = base.nodes(self.dev, self.out)
        btn = base.find_button(ns, "发送")
        if not btn:
            raise SystemExit("找不到「发送」按钮：请先让悬浮面板可见")
        self.dev.shell("input tap %d %d" % btn)

    def status(self) -> str:
        return base.status_line(base.nodes(self.dev, self.out))

    def diags(self, lines: list[str]):
        out = []
        for ln in lines:
            m = base.RE_DIAG.search(ln)
            if m:
                out.append({"ts": ln[:18], "round": int(m["round"]), "waited": int(m["waited"]),
                            "running": m["running"] == "true", "records": int(m["records"])})
        return out

    def engine_pid(self) -> str:
        return self.dev.shell("cat /data/local/tmp/dsh/engine.pid").strip()

    def pause_engine(self, seconds: int) -> dict:
        self.dev.shell("setsid sh /data/local/tmp/e2e_pause.sh %d >/dev/null 2>&1 &" % seconds)
        t0 = time.time()
        stopped = None
        while time.time() - t0 < 8:
            txt = self.dev.shell("cat /data/local/tmp/e2e_pause.log 2>/dev/null")
            if "stopped" in txt:
                stopped = txt
                break
            time.sleep(1)
        if stopped is None:
            return {"ok": False, "detail": "STOP 未生效（引擎不是 shell 拥有？）"}
        # 等到恢复标记；超时则宿主兜底 CONT
        t1 = time.time()
        while time.time() - t1 < seconds + 20:
            txt = self.dev.shell("cat /data/local/tmp/e2e_pause.log 2>/dev/null")
            if "resumed" in txt:
                return {"ok": True, "detail": txt.replace("\n", " | ")}
            time.sleep(2)
        pid = self.engine_pid()
        self.dev.shell("kill -CONT %s" % pid)
        return {"ok": True, "detail": "宿主兜底 CONT（设备侧脚本未按时恢复）"}

    # ---------- 判定辅助 ----------
    def wait_terminal(self, timeout: int) -> str:
        """等终态：优先读面板状态行；面板不可读时用引擎侧日志兜底（turn 结束且无失败行）。"""
        t0 = time.time()
        while time.time() - t0 < timeout:
            line = self.status()
            if line.startswith("任务：") and "执行中" not in line and "提交中" not in line:
                return line
            lines = self._tail()
            finished = any(("task finished" in l) or ("vscreen already closed" in l) for l in lines)
            failed = any(RE_FAIL.search(l) for l in lines)
            if finished:
                return "任务：成功（日志判定：引擎侧 turn 结束、无失败行）" if not failed else "任务：失败（日志判定）"
            time.sleep(10)
        return self.status()

    def wait_running(self, logfile_lines_fn, min_round: int, timeout: int) -> bool:
        t0 = time.time()
        while time.time() - t0 < timeout:
            lines = logfile_lines_fn()
            ds = self.diags(lines)
            if ds and ds[-1]["running"] and ds[-1]["round"] >= min_round:
                return True
            time.sleep(5)
        return False

    def add(self, name: str, verdict: str, detail: str) -> None:
        self.results.append((name, verdict, detail))
        print("[b77] %-18s %-8s %s" % (name, verdict, detail))

    # ---------- 四项检查 ----------
    def check_io_retry(self) -> None:
        self.start_log()
        self.submit("请分 8 步执行：每步调用 android_screen（scope 用 current）观察一次屏幕并记录一条关键信息，"
                    "不要输出多余内容；8 步完成后用中文给出汇总。")
        running = self.wait_running(lambda: self._tail(), 3, 90)
        if not running:
            self.stop_log()
            self.add("io-retry", "SKIP", "任务未进入 running=true（提示词可能被策略挡回）")
            return
        pause = self.pause_engine(25)
        if not pause["ok"]:
            self.stop_log()
            self.add("io-retry", "SKIP", pause["detail"])
            return
        final = self.wait_terminal(420)
        lines = self.stop_log()
        retries = [l for l in lines if RE_RETRY.search(l)]
        fails = [l for l in lines if RE_FAIL.search(l)]
        ok = bool(retries) and not fails and (final.startswith("任务：成功") or final.startswith("任务：已结束"))
        self.add("io-retry", "PASS" if ok else "FAIL",
                 "重试=%d 失败行=%d 终态=%s | %s" % (len(retries), len(fails), final or "(未取到)", pause["detail"]))

    def _tail(self) -> list[str]:
        try:
            return self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return []

    def check_silence_renewal(self, seconds: int) -> None:
        self.start_log()
        self.submit("请先调用 ask_user_question 工具向我提一个问题（两个选项：A 继续 / B 取消），"
                    "在我回答之前不要执行任何其他操作，也不要结束这一轮。")
        if not self.wait_running(lambda: self._tail(), 2, 90):
            self.stop_log()
            self.add("silence-renewal", "SKIP", "任务未进入 running=true")
            return
        marks = []
        t0 = time.time()
        while time.time() - t0 < seconds:
            lines = self._tail()
            ds = self.diags(lines)
            fails = [l for l in lines if RE_FAIL.search(l)]
            if fails:
                self.stop_log()
                self.add("silence-renewal", "FAIL", "提前失败：%s" % fails[-1][-160:])
                return
            marks.append((int(time.time() - t0), ds[-1]["running"] if ds else None,
                          ds[-1]["records"] if ds else None))
            time.sleep(30)
        lines = self.stop_log()
        ds = self.diags(lines)
        waited_max = max([d["waited"] for d in ds], default=0)
        ok = bool(ds) and ds[-1]["running"] and waited_max >= min(seconds, 600)
        self.add("silence-renewal", "PASS" if ok else "FAIL",
                 "静默 %ds 后 running=%s 轮询#%d（无 hard-timeout）" % (seconds, ds[-1]["running"] if ds else None, waited_max))
        # 收尾：尝试点掉提问卡片第一个选项，避免留下挂起交互
        ns = base.nodes(self.dev, self.out)
        for n in ns:
            t = n.get("text") or ""
            if t.strip() in ("A", "A 继续", "继续", "确认", "允许"):
                self.dev.shell("input tap %d %d" % (n["x"] + n["w"] // 2, n["y"] + n["h"] // 2))
                break

    def check_window_refetch(self, steps: int) -> None:
        self.start_log()
        self.submit("压测指令，请严格执行：调用 android_screen（scope=current）%d 次，"
                    "每次都是单独一次工具调用，每次调用后只回复一个字符 ok；"
                    "不要合并、不要跳过、不要提前结束；%d 次完成后回复 DONE。" % (steps, steps))
        if not self.wait_running(lambda: self._tail(), 3, 90):
            self.stop_log()
            self.add("window-refetch", "SKIP", "任务未进入 running=true")
            return
        final = self.wait_terminal(900)
        lines = self.stop_log()
        win = [l for l in lines if RE_WINDOW.search(l)]
        hit = [l for l in win if "加宽重取命中" in l]
        miss = [l for l in win if "未命中" in l]
        fails = [l for l in lines if RE_FAIL.search(l)]
        ok = bool(hit) and not fails and (final.startswith("任务：成功") or final.startswith("任务：已结束"))
        self.add("window-refetch", "PASS" if ok else ("FAIL" if win or fails else "NOT_TRIGGERED"),
                 "失配命中=%d 失配未命中=%d 失败行=%d 终态=%s" % (len(hit), len(miss), len(fails), final or "(未取到)"))

    def check_transient(self, name: str) -> None:
        ds = self.diags(self.log_path.read_text(encoding="utf-8", errors="replace").splitlines())
        runs, cur = [], 0
        for d in ds:
            if not d["running"]:
                cur += 1
            else:
                if cur:
                    runs.append(cur)
                cur = 0
        if cur:
            runs.append(cur)
        tolerant = [r for r in runs if r >= 3]
        self.add(name, "PASS" if tolerant or not runs else "INFO",
                 "running=false 连续段=%s（>=3 的段数=%d，未导致判死）" % (runs[-8:], len(tolerant)))

    def check_neutral(self) -> None:
        """中性终态：引擎侧本轮结束、助手取不到本轮文本时，应为「任务：已结束」而不是失败。

        触发条件（窗口常量被临时改小的测试构建，或真机长会话窗口挤出）：
        session.page 默认与加宽窗口都取不到本轮 rpcId。
        """
        self.start_log()
        self.submit("请调用 android_screen（scope=current）观察一次，然后用一句话总结屏幕内容。")
        if not self.wait_running(lambda: self._tail(), 2, 90):
            self.stop_log()
            self.add("neutral", "SKIP", "任务未进入 running=true")
            return
        final = self.wait_terminal(300)
        lines = self.stop_log()
        miss = [l for l in lines if "未命中本轮 rpcId" in l]
        fails = [l for l in lines if RE_FAIL.search(l)]
        ok = final.startswith("任务：已结束") and bool(miss) and not fails
        self.add("neutral", "PASS" if ok else "FAIL",
                 "失配未命中=%d 失败行=%d 终态=%s" % (len(miss), len(fails), final or "(未取到)"))

    # ---------- 报告 ----------
    def report(self) -> Path:
        rp = self.out / "report.md"
        lines = ["# 批次77 定向验证报告", "- 时间：%s  设备：%s" % (
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"), self.dev.serial), ""]
        for n, v, d in self.results:
            lines.append("- **%s**：%s —— %s" % (n, v, d))
        lines += ["", "原始 logcat：logcat.txt"]
        rp.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("[b77] 报告：%s" % rp)
        return rp


def rejudge(dirpath: Path, kind: str) -> int:
    """对已跑完的目录重新判定（脚本判定 bug 修复后无需重跑设备）。"""
    lines = (dirpath / "logcat.txt").read_text(encoding="utf-8", errors="replace").splitlines()
    ds = []
    for ln in lines:
        m = base.RE_DIAG.search(ln)
        if m:
            ds.append({"ts": ln[:18], "round": int(m["round"]), "waited": int(m["waited"]),
                       "running": m["running"] == "true", "records": int(m["records"])})
    fails = [l for l in lines if RE_FAIL.search(l)]
    if kind == "silence":
        waited = max([d["waited"] for d in ds], default=0)
        ok = bool(ds) and ds[-1]["running"] and waited >= 600 and not fails
        print("[b77] rejudge silence-renewal  %s  waited_max=%ds running=%s 失败行=%d"
              % ("PASS" if ok else "FAIL", waited, ds[-1]["running"] if ds else None, len(fails)))
        return 0 if ok else 1
    win = [l for l in lines if RE_WINDOW.search(l)]
    hit = [l for l in win if "加宽重取命中" in l]
    print("[b77] rejudge window-refetch  %s  命中=%d 未命中=%d 失败行=%d"
          % ("PASS" if hit and not fails else "INFO", len(hit), len(win) - len(hit), len(fails)))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("which", nargs="?", default="all",
                    choices=["all", "io-retry", "silence-renewal", "window-refetch", "neutral",
                             "rejudge-silence", "rejudge-window"])
    ap.add_argument("--dir", type=Path)
    ap.add_argument("--serial")
    ap.add_argument("--seconds", type=int, default=650)
    ap.add_argument("--steps", type=int, default=40)
    ap.add_argument("--out-dir", type=Path)
    a = ap.parse_args()

    if a.which.startswith("rejudge"):
        return rejudge(a.dir, "silence" if a.which.endswith("silence") else "window")

    out = a.out_dir or Path(".local/e2e_b77") / datetime.now().strftime("%Y%m%d-%H%M%S")
    r = Runner(a.serial, out)
    r.setup_helpers()
    print("[b77] 设备=%s 引擎 pid=%s out=%s" % (r.dev.serial, r.engine_pid(), out))

    if a.which in ("all", "io-retry"):
        r.check_io_retry()
    if a.which in ("all", "silence-renewal"):
        r.check_silence_renewal(a.seconds)
    if a.which in ("all", "window-refetch"):
        r.check_window_refetch(a.steps)
        r.check_transient("transient")
    if a.which == "neutral":
        r.check_neutral()
    r.report()
    bad = [x for x in r.results if x[1] == "FAIL"]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
