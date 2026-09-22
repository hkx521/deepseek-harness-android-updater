#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次81-T5：App 侧本地桥（3081）不可用时，插件失败文案是否「可操作」的真机 e2e。

背景（2026-09-19 取证）
----------------------
3081 由 App 进程内的 `MainActivity.startNotifyServer()` 提供（日志 `notify server listening on 3081`），
承载 `/vscreen/*`、剪贴板、通知、悬浮窗、定时任务上报。App 进程不在场时（`adb install -r` 后只由
`BootReceiver` 拉起悬浮球、或只走了 `AssistActivity` 入口）它一直不监听，而托管引擎 3080 照常在跑 ——
用户侧表现就是「dsh 里任务还在跑，小鲸鱼助手显示执行失败」。

本批次拍板：**不自动拉起 App 进程**（会破坏批次67「App 可被杀、引擎不受影响」的设计，且牵涉 Honor
后台/自启策略），改为三件事：① 悬浮面板 + 设置页显式呈现该中间态；② 插件侧统一可操作指引
（`APP_BRIDGE_HINT`：打开小鲸鱼助手后重试）；③ 记档为已知边界。

本脚本验证 ① 与 ② 的真机行为，分三段：

  Phase A（只读）—— 前置事实
    * 3080 LISTEN、3081 未 LISTEN（这就是待验证的中间态）；
    * 设备侧两个插件的 index.js 含 `APP_BRIDGE_HINT` 且旧文案已消失（交付链真的到位）。

  Phase B（只读）—— 面板可见性
    * 3181 桥 dump 面板节点，断言状态行出现「助手离线」（引擎在线 + 3081 不在场）；
    * 断言详情行 `App 侧能力：不可用（3081 未监听…）` 且含恢复动作「点此打开小鲸鱼助手后重试」。
    不点任何 App 浮层控件（本机注入触摸对 App 浮层无效，见 AGENTS.md）；展开详情走 3181 桥的
    `tap?text=ⓘ`（ACTION_CLICK）。

  Phase C（--live，可选）—— 工具侧文案（模型实际看到的那一行）
    在设备上用托管引擎自己的 node 加载**设备侧真实插件**，把 3081 指向一个未监听端口
    （`APP_NOTIFY_PORT=<dead port>`），直接跑 `android_vscreen_tap` / `android_tap`，打印 `execute`
    结果与 `render` 输出，断言新指引「打开「小鲸鱼助手」」真的进了模型可见文本。

    为什么不用「经 App 提交 prompt 让模型调工具」：那条路要经 `ProcessTextActivity`/`OverlayService`
    唤醒 App 进程，**会把 3081 拉起来**（真机实测：提交后 3081 立即 LISTEN），等于在验证前把待验证的
    前提消掉（自相矛盾）。用死端口复现「桥不在场」既不改变设备状态，又覆盖真实插件构建。
    注意：Phase C 验证的是「桥不可达时的文案」这条代码路径；「3081 真的没监听」由 Phase A 断言。

安全红线：不 install / 不 uninstall / 不 pm clear / 不改设备设置 / 不写 `/sdcard` 之外的设备路径 /
不 kill 引擎 / 不自动拉起 App 进程。Phase B 需要 App 与悬浮面板在场；Phase C 只读插件源码 + 打一个死端口。

退出码
------
  0 = 全部断言通过；1 = 有断言失败；2 = 环境不满足（无设备 / 面板不可见 / 3081 意外在监听）。

用法
----
    python tools/e2e_batch81_app_bridge_visibility.py            # A + B（只读）
    python tools/e2e_batch81_app_bridge_visibility.py --live     # 再加 C（设备上跑插件探针）
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# ---------- 端口事实（/proc/net/tcp{,6} 用 16 进制端口号） ----------
PORT_3080_HEX = "0C08"
PORT_3081_HEX = "0C09"
PORT_3181_HEX = "0C6D"

# ---------- 设备侧插件路径（托管引擎 re-stage 后的运行副本） ----------
DEV_PLUGIN_BASE = "/data/local/tmp/dsh/home/profiles/web/node_modules/@deepseek-ai"

# ---------- 3181 桥（token 只在设备侧 shell 展开，不回传宿主） ----------
A11Y_ENV = ". /data/local/tmp/dsh/engine.env 2>/dev/null; export LD_LIBRARY_PATH=/data/local/tmp/dsh/runtime/lib; "

# ---------- Phase C：设备侧插件探针 ----------
DEV_PROBE = "/data/local/tmp/dsh/b81t5_probe.mjs"
# 死端口：故意指向没有监听的端口，复现「3081 不在场」而不动设备状态
DEAD_PORT = 39999
# 探针：用引擎自己的 node 加载设备侧真实插件，直接跑某个工具并打印 execute/render。
# ctx 只实现插件真正用到的最小面（tools.register / inject / on / log）；inject 回调传自身，
# 让 `ctx.inject(["attachments"], cb)` 这类嵌套注册也能拿到同名接口。
PROBE_JS = '''
const tools = new Map();
const makeCtx = () => ({
  tools: { register: (t) => { tools.set(t.name, t); } },
  inject: (names, cb) => { try { cb(makeCtx()); } catch (_) {} },
  on: () => {},
  log: () => {},
  attachments: {},
});
const pkg = process.env.B81_PKG;
const mod = await import("/data/local/tmp/dsh/home/profiles/web/node_modules/@deepseek-ai/" + pkg + "/lib/index.js");
mod.apply(makeCtx());
const want = process.env.B81_TOOL;
const args = process.env.B81_ARGS ? JSON.parse(process.env.B81_ARGS) : {};
const tool = tools.get(want);
if (!tool) {
  console.log(JSON.stringify({ ok: false, err: "tool not registered: " + want, have: [...tools.keys()] }));
  process.exit(2);
}
let res, thrown = null;
try { res = await tool.execute(args, {}); } catch (e) { thrown = String((e && e.message) || e); }
const render = (!thrown && tool.output && tool.output.render) ? tool.output.render(args, res) : null;
console.log("RESULT=" + JSON.stringify(res));
console.log("RENDER=" + JSON.stringify(render));
console.log("THROWN=" + thrown);
'''

# ---------- 断言用文案（与源码常量一致） ----------
HINT_MARK = "APP_BRIDGE_HINT"
HINT_TEXT = "请打开「小鲸鱼助手」"
PANEL_DOWN_MARK = "App 侧能力：不可用（3081 未监听"
PANEL_UP_MARK = "App 侧能力：可用（3081 在监听"
PANEL_ACTION = "点此打开小鲸鱼助手后重试"
STATUS_ASSISTANT_DOWN = "助手离线"
STALE_TEXT = "App 原生桥不可达"
# 面板标题：收起态是「小鲸鱼 · 助手」，展开详情后变「小鲸鱼 · 详情」——两种都算在场
PANEL_TITLES = ("小鲸鱼 · 助手", "小鲸鱼 · 详情")

LIVE_PROMPT = (
    "只做这一件事：调用工具 android_vscreen_see（虚拟屏截图），不要调用 android_vscreen_create，"
    "也不要改用主屏截图。然后只回复一行：B81T5_HINT=<你看到的失败原因原文的前 60 个字符>，立即停止。"
)


def use_utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


class Device:
    def __init__(self, serial: str) -> None:
        self.serial = serial

    def adb(self, *args: str, timeout: int = 60) -> subprocess.CompletedProcess:
        return subprocess.run(["adb", "-s", self.serial, *args], capture_output=True,
                              text=True, encoding="utf-8", errors="replace", timeout=timeout)

    def shell(self, cmd: str, timeout: int = 60) -> str:
        return self.adb("shell", cmd, timeout=timeout).stdout

    def push(self, local: Path, remote: str) -> None:
        self.adb("push", str(local), remote, timeout=120)


def pick_serial(arg):
    if arg:
        return arg
    out = subprocess.run(["adb", "devices"], capture_output=True, text=True).stdout
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            return parts[0]
    raise SystemExit("未找到 adb 设备")


class Report:
    def __init__(self, out: Path) -> None:
        self.out = out
        self.rows: list[tuple[str, str, str]] = []
        self.notes: list[str] = []

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.rows.append(("PASS" if ok else "FAIL", name, detail))
        print("[%s] %s%s" % ("PASS" if ok else "FAIL", name, (" — " + detail) if detail else ""))
        return ok

    def info(self, text: str) -> None:
        self.notes.append(text)
        print("[info] " + text)

    def write(self, phase_a: str, phase_b: str, live: str) -> None:
        fails = [r for r in self.rows if r[0] == "FAIL"]
        lines = ["# 批次81-T5 真机 e2e 报告", "",
                 "- 时间：%s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                 "- 设备：%s" % self.serial if hasattr(self, "serial") else "",
                 "- 断言：%d 通过 / %d 失败" % (len(self.rows) - len(fails), len(fails)), "",
                 "## 事实", ""]
        lines += ["- " + n for n in self.notes]
        lines += ["", "## Phase A 前置事实", "", phase_a, "",
                  "## Phase B 面板可见性", "", phase_b, ""]
        if live:
            lines += ["## Phase C 模型侧文案", "", live, ""]
        lines += ["## 断言明细", "", "| 结果 | 断言 | 明细 |", "|---|---|---|"]
        lines += ["| %s | %s | %s |" % r for r in self.rows]
        (self.out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def listening(dev: Device, port_hex: str) -> bool:
    """端口是否有 LISTEN（state 0A）。3081 是 IPv6 dual-stack，两个表都要看。"""
    out = dev.shell("cat /proc/net/tcp6 /proc/net/tcp | grep -i ':%s' | grep -c ' 0A '" % port_hex)
    return out.strip().isdigit() and int(out.strip()) > 0


def a11y_dump(dev: Device) -> list[dict]:
    """3181 桥 dump 当前屏（只读）。返回节点数组；失败返回空表。"""
    cmd = (A11Y_ENV + 'curl -s -m 10 -H "X-DSH-Token: $APP_LOCAL_TOKEN" '
           '"http://127.0.0.1:3181/dump?scope=current"')
    raw = dev.shell(cmd)
    try:
        return json.loads(raw).get("nodes") or []
    except Exception:
        return []


def a11y_tap_text(dev: Device, text: str) -> str:
    """经 3181 桥 ACTION_CLICK 点一个文本节点（本机注入触摸对 App 浮层无效）。"""
    q = "".join("%%%02X" % b for b in text.encode("utf-8"))
    cmd = (A11Y_ENV + 'curl -s -m 10 -H "X-DSH-Token: $APP_LOCAL_TOKEN" '
           '"http://127.0.0.1:3181/tap?text=%s"' % q)
    return dev.shell(cmd).strip()


def node_texts(nodes: list[dict]) -> list[str]:
    return [(n.get("text") or "") for n in nodes]


def phase_a(dev: Device, rep: Report) -> str:
    """前置事实：3080 在跑、3081 不在、设备侧插件已带新指引。"""
    e3080 = listening(dev, PORT_3080_HEX)
    e3081 = listening(dev, PORT_3081_HEX)
    rep.check("3080（引擎）LISTEN", e3080, "hex %s" % PORT_3080_HEX)
    rep.check("3081（App 侧桥）未 LISTEN —— 待验证中间态", not e3081, "hex %s" % PORT_3081_HEX)

    detail = []
    for pkg in ("dsh-tool-android", "dsh-tool-accessibility"):
        path = "%s/%s/lib/index.js" % (DEV_PLUGIN_BASE, pkg)
        n_hint = dev.shell("grep -c %s %s || true" % (HINT_MARK, path)).strip()
        n_stale = dev.shell("grep -c '%s' %s || true" % (STALE_TEXT, path)).strip()
        rep.check("设备侧 %s 含 APP_BRIDGE_HINT" % pkg, n_hint.isdigit() and int(n_hint) > 0, "count=%s" % n_hint)
        rep.check("设备侧 %s 旧文案已清除" % pkg, n_stale.strip() in ("", "0"), "count=%s" % n_stale)
        detail.append("- %s: hint=%s stale=%s" % (pkg, n_hint, n_stale))
    return "\n".join(detail)


def phase_b(dev: Device, rep: Report) -> tuple[str, bool]:
    """面板可见性：状态行「助手离线」+ 详情行可操作指引。"""
    # 面板必须先展开：3181 dump 只返回「聚焦窗口」，收起态（只剩悬浮球）读不到面板。
    # 走 AssistActivity → OverlayService.openAssistantFromKey：只唤起悬浮助手，**不**进
    # MainActivity.startEngine()，因此不会把 3081 拉起来（待验证前提得以保留）。
    def expand() -> None:
        dev.shell("am start -n com.deepseek.harness/.AssistActivity")

    expand()
    time.sleep(3)
    nodes = a11y_dump(dev)
    texts = node_texts(nodes)
    title = next((t for t in texts if t in PANEL_TITLES), "")
    if not title:
        # 一次重试：首次唤起偶发落在面板展开动画中
        expand()
        time.sleep(3)
        nodes = a11y_dump(dev)
        texts = node_texts(nodes)
        title = next((t for t in texts if t in PANEL_TITLES), "")
    if not title:
        rep.check("悬浮面板在场（前置）", False, "未找到面板标题（%s）" % "/".join(PANEL_TITLES))
        return "", False
    rep.info("面板在场（标题：%s）" % title)

    # 唤起路径不得把 3081 拉起来（否则本脚本的待验证前提自毁）
    rep.check("唤起助手后 3081 仍未 LISTEN（前提未被自毁）", not listening(dev, PORT_3081_HEX),
              "hex %s" % PORT_3081_HEX)

    rep.check("状态行显示「助手离线」（引擎在线 + 3081 不在场）",
              any(t.strip() == STATUS_ASSISTANT_DOWN for t in texts),
              "节点文本命中" if any(t.strip() == STATUS_ASSISTANT_DOWN for t in texts) else "未命中")

    # 展开详情（App 浮层用 3181 ACTION_CLICK）；已经是详情态就不重复点（避免收起）
    nodes2, texts2 = nodes, texts
    if title != "小鲸鱼 · 详情":
        a11y_tap_text(dev, "ⓘ")
        time.sleep(1.5)
        nodes2 = a11y_dump(dev)
        texts2 = node_texts(nodes2)
    down_row = next((t for t in texts2 if PANEL_DOWN_MARK in t), "")
    rep.check("详情行出现「App 侧能力：不可用（3081 未监听…）」", bool(down_row), down_row[:80])
    rep.check("详情行含恢复动作「%s」" % PANEL_ACTION, PANEL_ACTION in down_row, down_row[:80])
    rep.check("详情行点按可直达主应用（clickable + desc）",
              any((n.get("desc") or "") == "App 侧本地桥状态（点击打开主应用）" and n.get("clickable")
                  for n in nodes2), "contentDescription 命中")
    body = "\n".join(["- 状态行：%s" % STATUS_ASSISTANT_DOWN, "- 详情行：%s" % down_row])
    return body, True


def phase_c(dev: Device, rep: Report, out: Path, timeout: int, poll: int) -> str:
    """工具侧：在设备上用引擎自己的 node 跑设备侧真实插件，断言模型可见文本含新指引。

    用死端口（APP_NOTIFY_PORT=DEAD_PORT）复现「3081 不在场」，不改变任何设备状态。
    见文件头「为什么不用经 App 提交 prompt」。
    """
    probe = out / "b81t5_probe.mjs"
    probe.write_text(PROBE_JS, encoding="utf-8", newline="\n")
    dev.push(probe, DEV_PROBE)
    rep.info("Phase C：设备侧插件探针已推送 %s" % DEV_PROBE)

    cases = (
        ("android_vscreen_tap（dsh-tool-android）", "dsh-tool-android",
         "android_vscreen_tap", '{"x":500,"y":500}'),
        ("android_tap（dsh-tool-accessibility）", "dsh-tool-accessibility",
         "android_tap", '{"fx":0.5,"fy":0.5}'),
    )
    lines = []
    for label, pkg, tool, args in cases:
        cmd = (A11Y_ENV + "cd /data/local/tmp/dsh/home/profiles/web; "
               "export B81_PKG='%s'; export B81_TOOL='%s'; export B81_ARGS='%s'; "
               "export DSH_VSCREEN_MODE=1; "
               "APP_NOTIFY_PORT=%d node %s 2>&1 | tail -c 1600"
               % (pkg, tool, args, DEAD_PORT, DEV_PROBE))
        raw = dev.shell(cmd, timeout=120)
        result = next((ln for ln in raw.splitlines() if ln.startswith("RESULT=")), "")
        render = next((ln for ln in raw.splitlines() if ln.startswith("RENDER=")), "")
        rep.check("Phase C %s：execute 返回 BRIDGE_UNREACHABLE" % label,
                  '"reason":"BRIDGE_UNREACHABLE"' in result, result[:120])
        rep.check("Phase C %s：模型可见 render 含新指引「%s」" % (label, HINT_TEXT),
                  HINT_TEXT in render, render[:160])
        lines.append("- %s\n  - RESULT=%s\n  - RENDER=%s" % (label, result[:200], render[:260]))
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial")
    ap.add_argument("--live", action="store_true", help="追加 Phase C（设备上跑插件探针）")
    ap.add_argument("--live-timeout", type=int, default=180, help="保留参数（Phase C 已改为即时探针）")
    ap.add_argument("--poll", type=int, default=10, help="保留参数（Phase C 已改为即时探针）")
    ap.add_argument("--out-dir", type=Path)
    args = ap.parse_args()

    use_utf8_stdout()
    dev = Device(pick_serial(args.serial))
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = args.out_dir or (ROOT / ".local" / "repro" / "b81t5" / stamp)
    out.mkdir(parents=True, exist_ok=True)
    rep = Report(out)
    rep.serial = dev.serial

    body_a = phase_a(dev, rep)
    body_b, _panel_ok = phase_b(dev, rep)
    body_c = phase_c(dev, rep, out, args.live_timeout, args.poll) if args.live else ""

    rep.write(body_a, body_b, body_c)
    fails = [r for r in rep.rows if r[0] == "FAIL"]
    print("[e2e] out=%s  exit=%d" % (out, 1 if fails else 0))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
