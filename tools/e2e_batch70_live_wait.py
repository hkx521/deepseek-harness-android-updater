#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次70 · 全域实况互联 —— 脚本化真机 e2e（tools/e2e_batch70_live_wait.py）。

对应 docs/批次70-全域实况互联方案.md §3.2「真机验证矩阵」；产物落 .local/repro/b70/<ts>/。
骨架沿用 tools/e2e_batch77_state_fidelity.py（复用 e2e_assistant_long_task 的 Device / 无障碍桥）。

子项（位置参数可单选，默认 all）：
  wait       ① 等待态实况窗：ask_user_question 后实况窗短文案=「请作答」、琥珀段色、
                PROMOTED_ONGOING、正文等待秒数随时间增长（1s ticker 在刷）
  open       ② 等待态 contentIntent 是 startService（不是 startActivity）且指向本应用；
                再用等价入口（AssistActivity，与 OverlayService.openAssistantFromKey 同一条
                Context 级路径）打开面板 → 提问卡片在场
  approval   ③ 需审批态（短文案=「需审批」）：有界尝试；未命中记 MANUAL（原因见报告）
  scheduled  ④ 定时任务实况互通：3081 /schedule → 闹钟 → EngineService → ScheduleExecutor
                实况窗「定时任务执行中 · 已 Ns」→ 终态「✓ 定时任务已完成」
  toggle     ⑤ 设置页「实况窗」开关：关掉后不再发布实况窗；**跑完自动恢复为「开」**
  dns        ⑥ c-ares dns-preload 注入现状（INFO：引擎 env 是否注入 + dns.resolve4 实测）
  privsetting⑦ privSetting 回读：MANUAL（需虚拟屏会话 + 灭屏，见 tools/e2e_batch66_lock_screen.py）

退出码：0 = 无 FAIL；1 = 有 FAIL（MANUAL / INFO / NOT_TRIGGERED 不算失败）。
前置：设备已连接、App 与引擎在线；**必须在沙箱外执行**。
安全边界：设备写操作仅 logcat -c/-G、am start（本 App 自身导出入口）、input tap/swipe、
         向 App 本地桥 3081 投递**一条一次性**定时任务；不 adb install/uninstall/pm clear、
         不杀引擎、不改任何系统设置。App 本地桥 token 只在设备侧读取使用，不回传宿主。
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_assistant_long_task as base  # noqa: E402

def use_utf8_stdout() -> None:
    """Windows 控制台/管道默认 cp936：直接 print 中文或 ✓/✕ 会 UnicodeEncodeError。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def safe_print(text: str) -> None:
    """即使 stdout 未能切到 UTF-8，也不让打印把流程打断（结论已取到就必须落盘）。"""
    try:
        print(text)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        print(text.encode(enc, "replace").decode(enc, "replace"))


PKG = "com.deepseek.harness"
LIVE_ID = 21921                 # PromotedProgressNotifier.NOTIF_ID = 0x55A1
LIVE_CHANNEL = "dsh_live_update"
AMBER = "0xffff9800"            # PromotedProgressNotifier.AMBER
SHORT_QUESTION = "请作答"
SHORT_APPROVAL = "需审批"
TITLE_QUESTION = "等待您的回答"
TITLE_APPROVAL = "等待授权确认"
SHORT_DONE = "完成 ✓"
QUESTION_CARD_TITLE = "引擎正在等待你的回答"
TAGS = ["DSH-LiveUpdate", "dsh-overlay", "ScheduleExecutor"]

SCHED_LOG = "/sdcard/DeepSeekHarness/scheduled-log.txt"
SCHED_AFTER_SEC = 75            # 闹钟在 N 秒后触发（setAlarmClock）
SCHED_TERMINAL = {
    "done": "✓ 定时任务已完成",
    "timeout": "⚠ 定时任务超时未确认",
    "fail": "✕ 定时任务未完成",
}

ASK_PROMPT = ("请先调用 ask_user_question 工具向我提一个问题（两个选项：A 继续 / B 取消），"
              "在我回答之前不要执行任何其他操作，也不要结束这一轮。")
APPROVAL_PROMPT = ("请立刻调用 android_shell 工具执行一条特权命令：强制停止系统设置应用"
                   "（app action=force_stop，包名 com.android.settings）。"
                   "如果引擎要求我授权，请停下等待我的确认，不要跳过、不要改走其它路径。")
SCHED_TASK = ("请分 5 步执行：每步调用 android_screen（scope 用 current）观察一次屏幕并记下一条关键信息，"
              "5 步完成后用中文汇总（每步至少 40 字）。")
SHORT_TASK = "请用一句话回复：真机回归 B70 OK。"

SCHED_POST_SH = '''#! /system/bin/sh
# 用法：sh e2e_b70_sched.sh <base64(JSON body)>
# 向 App 本地桥（3081）投递一条定时任务；token 只在设备侧读取，不回传宿主。
. /data/local/tmp/dsh/engine.env 2>/dev/null
BODY=$(echo "$1" | base64 -d)
CURL=/data/local/tmp/dsh/runtime/bin/curl
"$CURL" -s -m 10 -X POST \\
  -H "X-DSH-Token: $APP_LOCAL_TOKEN" \\
  -H "Content-Type: application/json" \\
  --data-binary "$BODY" \\
  "http://127.0.0.1:3081/schedule"
'''

DNS_PROBE_SH = '''#! /system/bin/sh
# 复现方案 §3.2 ⑧：托管环境里 node 的 c-ares 能否解析域名（需 nameserver 注入）。
. /data/local/tmp/dsh/engine.env 2>/dev/null
export LD_LIBRARY_PATH=/data/local/tmp/dsh/runtime/lib
echo "env.NODE_OPTIONS=$NODE_OPTIONS"
echo "env.DSH_RESOLV_CONF=$DSH_RESOLV_CONF"
"$NODE_BIN" -e 'require("node:dns").resolve4("api.deepseek.com",function(e,a){console.log(e?("DNS_ERR "+(e.code||e.message)):("DNS_OK "+a.join(",")));process.exit(0)})' 2>&1 | head -5
'''

# 复现 ScheduleExecutor.engineReady()（ScheduleExecutor.java:178）的判据：
# GET http://127.0.0.1:3080/ 的响应体是否含 <title>DeepSeek Harness</title>。
# dsh 0.1.5 起首页被 process token 门禁挡住（401），该判据恒 false。
ENGINE_READY_SH = '''#! /system/bin/sh
. /data/local/tmp/dsh/engine.env 2>/dev/null
C=/data/local/tmp/dsh/runtime/bin/curl
printf 'code='; "$C" -s -o /tmp/b70_root.html -w '%{http_code}' http://127.0.0.1:3080/
printf ' title_hits='; grep -c 'DeepSeek Harness</title>' /tmp/b70_root.html
printf ' body='; head -c 80 /tmp/b70_root.html | tr '\\n' ' '
echo
'''

RE_NOTIF_HEAD = re.compile(r"^\s*NotificationRecord\(0x[0-9a-f]+: pkg=(\S+) user=\S+ id=(\d+) ")
RE_FLAGS = re.compile(r"flags=([A-Z_|]+)")
RE_COLOR = re.compile(r"color=(0x[0-9a-fA-F]+)")
RE_CONTENT_INTENT = re.compile(r"contentIntent=PendingIntent\{.*?(startService|startForegroundService|startActivity)\b")
RE_ELAPSED = re.compile(r"已\s*(\d+)s")


class Runner:
    def __init__(self, serial: str | None, out: Path):
        self.dev = base.Device(base.pick_serial(serial))
        self.out = out
        self.out.mkdir(parents=True, exist_ok=True)
        self.log_path = out / "logcat.txt"
        self._log = None
        self._proc = None
        self._lines: list[str] = []
        self.results: list[tuple[str, str, str, float]] = []   # (name, verdict, detail, seconds)
        self.mark = 0

    # ---------------- 基础设施 ----------------
    def setup_helpers(self) -> None:
        tmp = Path(".local/e2e_b70_helpers")
        tmp.mkdir(parents=True, exist_ok=True)
        (tmp / "a11y.sh").write_text(base.A11Y_SH, encoding="utf-8", newline="\n")
        (tmp / "send.sh").write_text(base.SEND_SH, encoding="utf-8", newline="\n")
        (tmp / "sched_post.sh").write_text(SCHED_POST_SH, encoding="utf-8", newline="\n")
        (tmp / "dns_probe.sh").write_text(DNS_PROBE_SH, encoding="utf-8", newline="\n")
        (tmp / "engine_ready.sh").write_text(ENGINE_READY_SH, encoding="utf-8", newline="\n")
        for name, remote in (("a11y.sh", "/data/local/tmp/e2e_a11y.sh"),
                             ("send.sh", "/data/local/tmp/e2e_send.sh"),
                             ("sched_post.sh", "/data/local/tmp/e2e_b70_sched.sh"),
                             ("dns_probe.sh", "/data/local/tmp/e2e_b70_dns.sh"),
                             ("engine_ready.sh", "/data/local/tmp/e2e_b70_ready.sh")):
            self.dev.push(tmp / name, remote)
        self.dev.shell("chmod 755 /data/local/tmp/e2e_a11y.sh /data/local/tmp/e2e_send.sh "
                       "/data/local/tmp/e2e_b70_sched.sh /data/local/tmp/e2e_b70_dns.sh")
        self.dev.shell("chmod 755 /data/local/tmp/e2e_b70_ready.sh")

    def start_log(self) -> None:
        self.dev.shell("logcat -G 8M; logcat -c")
        self._log = open(self.log_path, "w", encoding="utf-8", errors="replace")
        cmd = ["adb", "-s", self.dev.serial, "logcat", "-v", "time", "-s"] + TAGS
        self._proc = subprocess.Popen(cmd, stdout=self._log, stderr=subprocess.DEVNULL,
                                     text=True, encoding="utf-8", errors="replace")

    def stop_log(self) -> None:
        time.sleep(1.5)
        if self._proc:
            try:
                self._proc.terminate()
            except Exception:
                pass
        if self._log:
            self._log.close()
        self._lines = self._tail()

    def _tail(self) -> list[str]:
        try:
            return self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return []

    def since(self) -> list[str]:
        return self._tail()[self.mark:]

    def rewind(self) -> None:
        self.mark = len(self._tail())

    # ---------------- 设备动作 ----------------
    def nodes(self):
        return base.nodes(self.dev, self.out)

    def submit(self, prompt: str) -> None:
        b64 = base64.b64encode(prompt.encode("utf-8")).decode()
        self.dev.shell("sh /data/local/tmp/e2e_send.sh " + b64)
        time.sleep(1.2)
        ns = self.nodes()
        btn = base.find_button(ns, "发送") or base.find_button(ns, "发送消息")
        if not btn:
            raise SystemExit("找不到「发送」按钮：悬浮面板不在前台（先跑 ensure_panel()）")
        self.dev.shell("input tap %d %d" % btn)

    def ensure_panel(self, timeout: float = 12.0) -> bool:
        """确保悬浮面板可见（用系统助手入口 AssistActivity，冷启动也有效）。"""
        t0 = time.time()
        while time.time() - t0 < timeout:
            ns = self.nodes()
            if base.find_button(ns, "发送") or base.find_button(ns, "发送消息"):
                return True
            self.dev.shell("input keyevent 3")
            self.dev.shell("am start -n %s/.AssistActivity" % PKG)
            time.sleep(2.5)
        return False

    def tap_text(self, *texts) -> bool:
        ns = self.nodes()
        for want in texts:
            for n in ns:
                if (n.get("text") or "").strip() == want or (n.get("desc") or "").strip() == want:
                    self.dev.shell("input tap %d %d" % (n["x"] + n["w"] // 2, n["y"] + n["h"] // 2))
                    time.sleep(1.0)
                    return True
        return False

    def screencap(self, name: str) -> Path:
        p = self.out / name
        with open(p, "wb") as f:
            subprocess.run(["adb", "-s", self.dev.serial, "exec-out", "screencap", "-p"],
                           stdout=f, stderr=subprocess.DEVNULL, timeout=60)
        return p

    def status_line(self) -> str:
        return base.status_line(self.nodes())

    def a11y(self, path: str) -> dict:
        """调 App 无障碍桥任意路由，返回解析后的 JSON（失败返回 {}）。"""
        self.dev.shell("sh /data/local/tmp/e2e_a11y.sh '%s'" % path)
        tmp = self.out / "a11y-last.json"
        self.dev.adb("pull", "/data/local/tmp/e2e_a11y.json", str(tmp))
        try:
            return json.loads(tmp.read_text(encoding="utf-8", errors="replace"))
        except (OSError, json.JSONDecodeError, ValueError):
            return {}

    def tap_node_text(self, text: str) -> dict:
        """按文本 ACTION_CLICK（0 宽节点也可点：不依赖可见性/坐标）。"""
        return self.a11y("tap?text=" + urllib.parse.quote(text))

    # ---------------- 通知解析 ----------------
    def notif_dump(self, tag: str) -> str:
        raw = self.dev.shell("dumpsys notification --noredact", timeout=60)
        (self.out / ("notif-%s.txt" % tag)).write_text(raw, encoding="utf-8", errors="replace")
        return raw

    @staticmethod
    def block(dump: str, notif_id: int = LIVE_ID, pkg: str = PKG) -> str | None:
        cur, hit = None, None
        for ln in dump.splitlines():
            m = RE_NOTIF_HEAD.match(ln)
            if m:
                cur = [] if (m.group(1) == pkg and int(m.group(2)) == notif_id) else None
                if cur is not None:
                    cur.append(ln)
                    hit = cur
                continue
            if cur is not None:
                if ln[:1] not in (" ", "\t"):
                    cur = None
                else:
                    cur.append(ln)
        return "\n".join(hit) if hit else None

    @staticmethod
    def extra(blob: str, key: str) -> str:
        m = re.search(r"^\s*android\.%s=(?:String|SpannableString|CharSequence)\s*\((.*)\)\s*$"
                      % re.escape(key), blob, re.M)
        if m:
            return m.group(1).strip()
        m = re.search(r"^\s*android\.%s=(.*)$" % re.escape(key), blob, re.M)
        return m.group(1).strip() if m else ""

    def live(self, tag: str = "probe") -> dict | None:
        """返回实况窗（id=21921）的解析结果；不存在返回 None。"""
        blob = self.block(self.notif_dump(tag))
        if not blob:
            return None
        ci = RE_CONTENT_INTENT.search(blob)
        flags = RE_FLAGS.search(blob)
        color = RE_COLOR.search(blob)
        return {
            "blob": blob,
            "flags": flags.group(1) if flags else "",
            "color": (color.group(1).lower() if color else ""),
            "title": self.extra(blob, "title"),
            "text": self.extra(blob, "text"),
            "short": self.extra(blob, "shortCriticalText"),
            "contentIntent": ci.group(1) if ci else "",
            "promoted": "PROMOTED_ONGOING" in (flags.group(1) if flags else ""),
            "elapsed": int(RE_ELAPSED.search(self.extra(blob, "text") or "").group(1))
            if RE_ELAPSED.search(self.extra(blob, "text") or "") else -1,
        }

    # ---------------- 判定辅助 ----------------
    def add(self, name: str, verdict: str, detail: str, secs: float) -> None:
        self.results.append((name, verdict, detail, secs))
        # 批次81-T3：Windows 控制台默认 cp936，detail 里含 ✓/✕（实况窗终态文案）时
        # print 会抛 UnicodeEncodeError 并**在已取到结论后崩掉**（真机踩到：结果已拿到，
        # 报告却没落盘）。所有输出统一走 UTF-8 安全打印。
        safe_print("[b70] %-12s %-13s %-6.0fs %s" % (name, verdict, secs, detail))

    def wait_for(self, pred, timeout: float, step: float = 2.0):
        """轮询 pred()，返回首个非 None 结果。"""
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = pred()
            if v:
                return v
            time.sleep(step)
        return None

    # ---------------- ① 等待态实况窗 ----------------
    def probe_open(self):
        """等待态挂起窗口内取证：contentIntent 类型 + 等价入口唤起面板。

        等价入口用 AssistActivity（exported=true）→ OverlayService.openAssistantFromKey()，
        与实况窗 PendingIntent（getService + action_open_assistant）是同一条 Context 级路径；
        OverlayService 自身 exported=false，adb shell 无法直接 startForegroundService。
        返回 (contentIntent 类型, 提问卡片是否在场, 命中文本样本)。
        """
        b = self.live("open")
        intent_kind = b["contentIntent"] if b else ""
        self.dev.shell("input keyevent 3")
        self.dev.shell("am start -n %s/.AssistActivity" % PKG)
        panel, texts = False, []
        t1 = time.time()
        while time.time() - t1 < 14:
            texts = [(n.get("text") or "").strip() for n in self.nodes()]
            if any(QUESTION_CARD_TITLE in t for t in texts) and any(
                    t in ("取消提问", "提交回答", "允许一次", "拒绝") for t in texts):
                panel = True
                break
            time.sleep(1.2)
        self.screencap("open-panel.png")
        return intent_kind, panel, [t for t in texts if t][:8]

    def check_wait(self, with_open: bool) -> bool:
        self.rewind()
        t0 = time.time()
        if not self.ensure_panel():
            self.add("wait", "FAIL", "悬浮面板起不来（找 App 无障碍桥 dump 里的「发送」按钮失败）", time.time() - t0)
            if with_open:
                self.add("open", "FAIL", "前置条件（等待态）未建立", 0.0)
            return False
        self.submit(ASK_PROMPT)

        samples = []

        def probe():
            b = self.live("wait-%d" % (len(samples) + 1))
            if b and b["short"] == SHORT_QUESTION:
                samples.append(b)
                return b
            return None

        first = self.wait_for(probe, 120, 2.5)
        if not first:
            self.add("wait", "FAIL", "120s 内未出现「请作答」等待态实况窗（实况窗未发布？）", time.time() - t0)
            if with_open:
                self.add("open", "FAIL", "前置条件（等待态）未建立", 0.0)
            return False
        # 挂起窗口只有 ~25s（模型侧提问会在约 20-25s 后被放开），所以先抢时间做 ②
        open_ev = self.probe_open() if with_open else None
        # 秒数增长：采样（1s ticker 在刷实况窗正文）+ 日志（每秒一行 interaction kind=question）双判据
        inter, secs, growing, el = [], [], False, []
        t_grow = time.time()
        while time.time() - t_grow < 14:
            time.sleep(3)
            probe()
            el = [s["elapsed"] for s in samples]
            inter = [l for l in self.since() if "interaction kind=question" in l]
            secs = [int(m.group(1)) for m in
                    (re.search(r"elapsedSecs=(\d+)", l) for l in inter) if m]
            growing = (len(el) >= 2 and el[-1] > el[0]) or (secs and secs[-1] >= first["elapsed"] + 3)
            if growing:
                break
        ok = (first["flags"] and first["promoted"] and first["color"] == AMBER
              and first["title"] == TITLE_QUESTION and bool(inter))
        detail = ("flags=%s color=%s title=%s short=%s 秒数采样=%s/日志到%s 增长=%s interaction日志=%d"
                  % (first["flags"], first["color"], first["title"], first["short"],
                     el, (secs[-1] if secs else "-"), growing, len(inter)))
        self.screencap("wait-panel.png")
        self.add("wait", "PASS" if (ok and growing) else "FAIL", detail, time.time() - t0)
        if with_open:
            intent_kind, panel, texts = open_ev
            intent_ok = intent_kind in ("startService", "startForegroundService")
            self.add("open", "PASS" if (intent_ok and panel) else "FAIL",
                     "contentIntent=%s（期望 startService，非 startActivity）面板提问卡片在场=%s 面板文本=%s"
                     % (intent_kind or "(取不到)", panel, texts),
                     time.time() - t0)
        return True

    def cleanup_question(self) -> None:
        """取消挂起提问，避免留下等待态（幂等：没有挂起时静默返回）。"""
        for _ in range(3):
            ns = self.nodes()
            if not any((n.get("text") or "").strip() in ("取消提问", "拒绝") for n in ns):
                self.dev.shell("input keyevent 3")
                self.dev.shell("am start -n %s/.AssistActivity" % PKG)
                time.sleep(2.5)
                ns = self.nodes()
            if self.tap_text("取消提问", "拒绝"):
                time.sleep(2)
                return
            time.sleep(1)
        safe_print("[b70] 警告：没能点掉挂起提问（请手工确认面板是否还有等待卡片）")

    # ---------------- ③ 需审批（有界尝试） ----------------
    def check_approval(self) -> None:
        self.rewind()
        t0 = time.time()
        if not self.ensure_panel():
            self.add("approval", "MANUAL", "悬浮面板起不来，未做尝试", time.time() - t0)
            return
        self.submit(APPROVAL_PROMPT)
        hit = self.wait_for(lambda: (lambda b: b if b and b["short"] == SHORT_APPROVAL else None)(
            self.live("approval")), 150, 3.0)
        if hit:
            self.add("approval", "PASS",
                     "flags=%s color=%s title=%s short=%s text=%s"
                     % (hit["flags"], hit["color"], hit["title"], hit["short"], hit["text"]),
                     time.time() - t0)
            self.cleanup_question()
            return
        # 未命中：给出可核查的边界说明（详见报告）
        lines = self.since()
        card = [l for l in lines if "interaction pending kind=approval" in l]
        self.add("approval", "MANUAL",
                 "150s 内未出现「需审批」等待态；本机 approval/request 事件未产生（dsh-overlay approval 卡片=%d 行）"
                 % len(card), time.time() - t0)
        self.cleanup_question()

    # ---------------- ④ 定时任务实况互通 ----------------
    def check_scheduled(self) -> None:
        self.rewind()
        t0 = time.time()
        before = self.dev.shell("wc -c < %s 2>/dev/null" % SCHED_LOG).strip()
        body = json.dumps({"text": SCHED_TASK, "when": str(SCHED_AFTER_SEC), "repeat": "once"})
        b64 = base64.b64encode(body.encode("utf-8")).decode()
        resp = self.dev.shell("sh /data/local/tmp/e2e_b70_sched.sh " + b64, timeout=40).strip()
        (self.out / "schedule-post.txt").write_text(
            "body=%s\nresp=%s\n" % (body, resp), encoding="utf-8")
        if '"ok":true' not in resp:
            self.add("scheduled", "FAIL", "3081 /schedule 未受理：%s" % resp[:160], time.time() - t0)
            return

        seen_start = seen_running = None

        def look():
            nonlocal seen_start, seen_running
            lines = self.since()
            if seen_start is None:
                for l in lines:
                    if "start id=%d text=定时任务" % LIVE_ID in l:
                        seen_start = l.strip()
                        break
            b = self.live("scheduled")
            if b and ("定时任务" in b["title"] or "定时任务" in b["text"]):
                if "执行中" in b["text"]:
                    seen_running = b
            return None

        t_end = time.time() + SCHED_AFTER_SEC + 150
        terminal = None
        while time.time() < t_end:
            look()
            for l in self.since():
                if "finish id=%d" % LIVE_ID in l:
                    terminal = l.strip()
                    break
            if terminal:
                break
            time.sleep(3)
        tail = self.dev.shell("tail -6 %s 2>/dev/null" % SCHED_LOG).strip()
        after = self.dev.shell("wc -c < %s 2>/dev/null" % SCHED_LOG).strip()
        ready = self.dev.shell("sh /data/local/tmp/e2e_b70_ready.sh", timeout=40).strip()
        want = SCHED_TERMINAL["done"]
        ok = bool(terminal) and want in terminal
        if ok:
            verdict = "PASS"
        elif terminal and SCHED_TERMINAL["timeout"] in terminal:
            # 任务在首个 3s 采样前就结束 → 引擎 never saw running=true → 超时态（方案已知边界）
            verdict = "FAIL"
        else:
            verdict = "FAIL"
        self.add("scheduled", verdict,
                 "实况窗发布=%s 执行中采样=%s 终态=%s | 文件日志(new=%sB): %s | engineReady 判据(%s)"
                 % ("是" if seen_start else "否", "是" if seen_running else "否",
                    (terminal[-90:] if terminal else "(未捕获到 finish 行)"),
                    (int(after) - int(before)) if before.isdigit() and after.isdigit() else "?",
                    tail.replace("\n", " | ")[-200:], ready.replace("\n", " | ")[:150]),
                 time.time() - t0)
        time.sleep(2)

    # ---------------- ⑤ 设置页「实况窗」开关 ----------------
    def open_keepalive_card(self) -> bool:
        """打开保活自检卡片（「实况窗：开/关」按钮所在的那张卡）。

        注意：该按钮与同行 7 个按钮共处一条横向 LinearLayout，卡片可用宽只有 864px，
        第 4 个起被压成 0 宽 —— 无障碍 dump 会丢弃 w<=0 的节点，坐标点击也打空。
        因此只认「卡片在屏」这一可达判据，真正点它走 bridge 的 /tap?text=（ACTION_CLICK，
        不依赖可见性与坐标）。
        """
        self.dev.shell("input keyevent 3")
        self.dev.shell("am start -n %s/.MainActivity --ez action_open_keepalive true" % PKG)
        t0 = time.time()
        while time.time() - t0 < 12:
            if any("保活自检" in (n.get("text") or "") for n in self.nodes()):
                return True
            time.sleep(1.5)
        return False

    def wait_publish(self, timeout: float) -> bool:
        """在 timeout 内观察实况窗是否被发布（DSH-LiveUpdate start/getLog 行）。"""
        t0 = time.time()
        while time.time() - t0 < timeout:
            if any(("start id=%d" % LIVE_ID) in l or ("post attempt" in l and "id=%d" % LIVE_ID in l)
                   for l in self.since()):
                return True
            time.sleep(2)
        return False

    def run_short_task(self, timeout: float) -> bool:
        if not self.ensure_panel():
            safe_print("[b70] 悬浮面板起不来，短任务未提交")
            return False
        self.submit(SHORT_TASK)
        return self.wait_publish(timeout)

    def check_toggle(self) -> None:
        self.rewind()
        t0 = time.time()
        if not self.open_keepalive_card():
            self.add("toggle", "MANUAL", "打不开保活卡片（dump 里没有「保活自检」），未做尝试", time.time() - t0)
            return

        # a) 用 bridge /tap?text= 把开关切到「关」。文本 needle = 按钮当前文案，
        #    所以「实况窗：开」命中 = 之前是开态、现在被点成关态。
        r_off = self.tap_node_text("实况窗：开")
        note = ""
        if not r_off.get("found"):
            # 可能是上次跑崩在关态：再点「实况窗：关」把它点开，然后再关一次
            r_back = self.tap_node_text("实况窗：关")
            note = "首次 needle 未命中（%s）；「实况窗：关」found=%s" % (
                (r_off.get("error") or r_off.get("method") or "?")[:60], r_back.get("found"))
            if not r_back.get("found"):
                self.add("toggle", "MANUAL",
                         "两个 needle 都未命中，无法切换开关。r(开)=%s r(关)=%s"
                         % (json.dumps(r_off, ensure_ascii=False)[:220],
                            json.dumps(r_back, ensure_ascii=False)[:220]), time.time() - t0)
                return
            r_off = self.tap_node_text("实况窗：开")
        off_ok = bool(r_off.get("found"))
        time.sleep(1.5)

        # b) 关态跑任务：不应再发布实况窗
        self.dev.shell("input keyevent 3")
        self.rewind()
        published_off = self.run_short_task(25)

        # c) 恢复「开」
        on_ok = False
        for _ in range(2):
            if not self.open_keepalive_card():
                break
            r_on = self.tap_node_text("实况窗：关")
            if r_on.get("found"):
                on_ok = True
                break
            time.sleep(2)
        time.sleep(1.5)

        # d) 开态跑任务：应重新发布实况窗
        self.rewind()
        self.dev.shell("input keyevent 3")
        published_on = self.run_short_task(35) if on_ok else False

        ok = off_ok and on_ok and (not published_off) and published_on
        self.add("toggle", "PASS" if ok else "FAIL",
                 "切到关=%s（bridge=%s）恢复开=%s 关态发布实况窗=%s 开态发布实况窗=%s %s"
                 % (off_ok, json.dumps(r_off, ensure_ascii=False)[:120], on_ok,
                    published_off, published_on, note), time.time() - t0)
        if not on_ok:
            safe_print("[b70] 警告：实况窗开关可能没恢复成「开」，请手工确认（保活卡片 → 实况窗）")

    # ---------------- ⑥ c-ares 注入现状（INFO） ----------------
    def check_dns(self) -> None:
        self.rewind()
        t0 = time.time()
        out = self.dev.shell("sh /data/local/tmp/e2e_b70_dns.sh", timeout=60).strip()
        (self.out / "dns-probe.txt").write_text(out, encoding="utf-8", errors="replace")
        injected = bool([l for l in out.splitlines() if "env.NODE_OPTIONS=" in l and l.strip() != "env.NODE_OPTIONS="])
        resolved = "DNS_OK" in out
        self.add("dns", "INFO",
                 "引擎 env 注入 NODE_OPTIONS/DSH_RESOLV_CONF=%s dns.resolve4=%s | %s"
                 % (injected, "成功" if resolved else "失败",
                    " ".join(l for l in out.splitlines() if l.startswith(("env.", "DNS_"))))[:600],
                 time.time() - t0)

    # ---------------- 报告 ----------------
    def report(self) -> Path:
        rp = self.out / "report.md"
        rows = ["# 批次70 全域实况互联 · 真机 e2e 报告",
                "",
                "- 时间：%s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "- 设备：%s" % self.dev.serial,
                "- 脚本：tools/e2e_batch70_live_wait.py",
                "",
                "| 子项 | 判定 | 耗时 | 证据 |",
                "|---|---|---|---|"]
        for n, v, d, s in self.results:
            rows.append("| %s | %s | %.0fs | %s |" % (n, v, s, d.replace("|", "\\|")))
        rows += ["", "原始 logcat：logcat.txt；通知快照：notif-*.txt；dumpsys 之外的证据文件同目录。"]
        rp.write_text("\n".join(rows) + "\n", encoding="utf-8")
        safe_print("[b70] 报告：%s" % rp)
        return rp


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("which", nargs="?", default="all",
                    choices=["all", "wait", "open", "approval", "scheduled", "toggle", "dns", "privsetting"])
    ap.add_argument("--serial")
    ap.add_argument("--out-dir", type=Path)
    a = ap.parse_args(argv)

    out = a.out_dir or Path(".local/repro/b70") / datetime.now().strftime("%Y%m%d-%H%M%S")
    r = Runner(a.serial, out)
    r.setup_helpers()
    use_utf8_stdout()
    safe_print("[b70] 设备=%s out=%s" % (r.dev.serial, out))
    r.start_log()
    try:
        if a.which in ("all", "wait", "open"):
            r.check_wait(with_open=a.which in ("all", "open"))
            r.cleanup_question()
        if a.which in ("all", "approval"):
            r.check_approval()
        if a.which in ("all", "scheduled"):
            r.check_scheduled()
        if a.which in ("all", "toggle"):
            r.check_toggle()
        if a.which in ("all", "dns"):
            r.check_dns()
        if a.which in ("all", "privsetting"):
            r.add("privsetting", "MANUAL",
                  "需虚拟屏会话 + 灭屏触发 put secure doze_always_on 才能看到 [b70] privSetting ok=… 回读日志；"
                  "按 tools/e2e_batch66_lock_screen.py 跑一轮并 grep 该行", 0.0)
    finally:
        r.stop_log()
    r.report()

    bad = [x for x in r.results if x[1] == "FAIL"]
    if bad:
        safe_print("[b70] FAIL 子项最后 20 行相关日志：")
        for ln in r._tail()[-20:]:
            safe_print("    " + ln)
    safe_print("[b70] 汇总：" + " ".join("%s=%s" % (n, v) for n, v, _, _ in r.results))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
