
"""批次72 契约：主屏 current 读屏污染、托管特权通道、虚拟屏输入回退。

背景（2026-09-18 真机取证，Honor BKQ-AN10 / Android 17）：
1) android_screen scope=current（/dump?displayId=0&exclude_self=1）在虚拟屏开启并运行设置时，
   返回的是虚拟屏里 com.android.settings 的节点树；虚拟屏关闭后直接返回节点数 0。
   根因：rememberCurrentExternalTarget() 不区分 display，虚拟屏窗口事件把主屏的
   lastExternalPackage / lastReadableContextTarget 改写成了虚拟屏应用；
   rootForPath() 又在 exclude_self=1 分支无条件丢弃 displayId 直接走主屏 /context 选择链。
2) android_device_info 在托管常驻下报 SHIZUKU_DEX 未配置：引擎自身已是 shell(uid=2000)，
   却仍走 app_process/rish 代理通道。
3) 虚拟屏内软键盘不会弹出，android_type 直接以 IME_NOT_READY 失败，缺少按 displayId 的特权注入兜底。
"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
A11Y_SRC = (PKG / "AccessibilityService.java").read_text(encoding="utf-8")

TOOLS_JS_PATH = ROOT / "plugins" / "dsh-tool-android" / "lib" / "index.js"
A11Y_JS_PATH = ROOT / "plugins" / "dsh-tool-accessibility" / "lib" / "index.js"
TOOLS_JS = TOOLS_JS_PATH.read_text(encoding="utf-8")
A11Y_JS = A11Y_JS_PATH.read_text(encoding="utf-8")


def java_block(start_marker: str, end_marker: str) -> str:
    body = A11Y_SRC[A11Y_SRC.index(start_marker):]
    return body[: body.index(end_marker)]


class CurrentScopeDisplayIsolationTests(unittest.TestCase):
    """A：主屏 current 读屏不得被虚拟屏窗口事件污染。"""

    def test_remember_current_external_target_guards_main_display(self) -> None:
        body = java_block("private void rememberCurrentExternalTarget()", "private boolean isSelfPackage")
        self.assertIn("window.getDisplayId() != CONTEXT_DISPLAY_ID", body,
                      "必须拒绝非主屏（虚拟屏）窗口写入 lastExternalPackage/lastReadableContextTarget")

    def test_read_context_target_accepts_display_id(self) -> None:
        self.assertIn("private ContextTarget readContextTarget(int displayId)", A11Y_SRC)
        body = java_block("private ContextTarget readContextTarget(int displayId)",
                          "private ContextTarget rememberContextTarget")
        # 非主屏调用不得写回主屏缓存，也不得返回主屏缓存（跨屏误读）
        self.assertIn("(displayId == CONTEXT_DISPLAY_ID) ? rememberContextTarget", body)
        self.assertNotIn("if (!preferredPackage.isEmpty()) return null;", body)

    def test_root_for_path_honours_display_id_with_exclude_self(self) -> None:
        body = java_block("private AccessibilityNodeInfo rootForPath(String path)",
                          "private List<AccessibilityWindowInfo> windowsForDisplay")
        self.assertIn('boolean excludeSelf = "1".equals(queryParam(path, "exclude_self").trim());', body)
        self.assertIn("ContextTarget target = readContextTarget(dId);", body,
                      "exclude_self 分支必须把 displayId 透传下去，不能无条件读主屏")

    def test_stale_cached_snapshot_is_not_returned(self) -> None:
        """失效快照（应用切走、窗口消失后节点树被回收，遍历得 0 节点）不得冒充主屏结果。"""
        body = java_block("private ContextTarget readContextTarget(int displayId)",
                          "private ContextTarget rememberContextTarget")
        self.assertIn("&& countNodes(cached.root) > 0) {", body,
                      "缓存必须校验仍有可读节点，否则 scope=current 会返回 package 正确但 count=0 的伪空结果")

    def test_get_root_in_active_window_fallback_rejects_foreign_display(self) -> None:
        body = java_block("private ContextTarget readContextTarget(int displayId)",
                          "private ContextTarget rememberContextTarget")
        self.assertIn("if (Build.VERSION.SDK_INT >= 30 && window.getDisplayId() != CONTEXT_DISPLAY_ID)", body,
                      "getRootInActiveWindow() 兜底也必须校验 displayId")


class HostedPrivilegedChannelTests(unittest.TestCase):
    """B：托管 shell(uid=2000) 直接执行特权命令，不再依赖 rish dex。"""

    def test_both_plugins_detect_hosted_shell(self) -> None:
        for name, src in (("dsh-tool-android", TOOLS_JS), ("dsh-tool-accessibility", A11Y_JS)):
            self.assertIn("function isHostedShellPrivileged()", src, name)
            self.assertIn("if (process.env.DSH_HOSTED_DIR) return true;", src, name)
            self.assertIn("process.getuid() === 2000", src, name)

    def test_privileged_available_includes_hosted_shell(self) -> None:
        for name, src in (("dsh-tool-android", TOOLS_JS), ("dsh-tool-accessibility", A11Y_JS)):
            body = src[src.index("function privilegedAvailable()"):]
            body = body[: body.index("}", body.index("return"))]
            self.assertIn("isHostedShellPrivileged()", body, name)

    def test_priv_cmd_uses_system_sh_before_rish(self) -> None:
        self.assertIn('spawn("/system/bin/sh", ["-c", command]', TOOLS_JS)
        body = TOOLS_JS[TOOLS_JS.index("function privCmd(command, timeoutMs, maxMs)"):]
        body = body[: body.index("\n}", body.index("shizukuCmd"))]
        self.assertIn("if (isHostedShellPrivileged() || !process.env.SHIZUKU_DEX) {", body,
                      "托管 shell / 无 dex 时必须先走 /system/bin/sh，而不是抛 SHIZUKU_DEX 未配置")
        self.assertLess(body.index("if (isHostedShellPrivileged() || !process.env.SHIZUKU_DEX) {"),
                        body.index("shizukuCmd(command, process.env.SHIZUKU_DEX"))

        a11y_body = A11Y_JS[A11Y_JS.index("function privCmd(command, timeoutMs, displayId = null)"):]
        a11y_body = a11y_body[: a11y_body.index("\n}", a11y_body.index("APP_PROC"))]
        self.assertIn('return runPrivCmd("/system/bin/sh", ["-c", scoped], sanitizeEnv(process.env), timeoutMs);',
                      a11y_body)

    def test_no_shizuku_dex_hard_failure_remains_in_a11y_plugin(self) -> None:
        self.assertNotIn("SHIZUKU_DEX 未配置", A11Y_JS,
                         "托管 shell 可用时不允许再以 SHIZUKU_DEX 未配置硬失败")


class VscreenTypeFallbackTests(unittest.TestCase):
    """C：虚拟屏 / 主屏 IME_NOT_READY 时回退特权通道注入。"""

    def test_privileged_type_helper_exists(self) -> None:
        body = A11Y_JS[A11Y_JS.index("async function privilegedType(args, displayId = null)"):]
        body = body[: body.index("async function typeCore(args, opts = {}) {")]
        self.assertIn("function asciiInputCmd(text)", A11Y_JS)
        self.assertIn("const PRINTABLE_ASCII", A11Y_JS)
        self.assertIn("injected = await privCmd(asciiInputCmd(text), 15000, dId);", body)
        self.assertIn('injected = await privCmd("input keyevent 279", 15000, dId);', body)
        # 只有回读通过才允许声称 verified
        self.assertIn("if (back.ok !== false && back.verified === true)", body)
        self.assertIn("verified: true", body)
        self.assertIn('verifyParams = { text, verifyOnly: "1" }', body)

    def test_android_type_falls_back_in_vscreen_and_on_ime_not_ready(self) -> None:
        idx = A11Y_JS.index('name: "android_type"')
        body = A11Y_JS[idx: A11Y_JS.index("\n  }));", idx)]
        # 批次80：虚拟屏兜底链抽到共享函数 typePrivilegedFallback（android_act 事务也调它），
        # 工具体内改为「回读未通过 → return typePrivilegedFallback(args, displayId, direct)」。
        self.assertIn("return typePrivilegedFallback(args, displayId, direct);", body,
                      "虚拟屏分支必须走特权注入兜底链")
        helper = A11Y_JS[A11Y_JS.index("async function typePrivilegedFallback("):]
        helper = helper[: helper.index("\nasync function", 10)]
        self.assertIn("await privilegedType(args, scoped ? displayId : null)", helper,
                      "兜底链必须能按虚拟屏 displayId 直注特权通道")
        self.assertIn('vscreenBridge("POST", "/vscreen/key", { key: "279" }', helper,
                      "虚拟屏兜底保留剪贴板 + 279 粘贴中间链")
        self.assertIn('if (direct.reason === "IME_NOT_READY" || direct.reason === "POSTCONDITION_FAILED") {', body)
        self.assertIn("const priv = await privilegedType(args, null);", body,
                      "主屏 IME 未就绪时也必须回退特权注入（默认屏作用域）")


class PluginSyntaxTests(unittest.TestCase):
    """防退化：插件必须是合法 JavaScript（历史事故：转义写坏导致 node 语法错误）。"""

    def test_plugins_pass_node_check(self) -> None:
        for path in (TOOLS_JS_PATH, A11Y_JS_PATH):
            proc = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, path.name + " 语法错误: " + proc.stderr[:400])

    def test_shq_shell_escaping_is_intact(self) -> None:
        idx = A11Y_JS.index("function shq(s) {")
        body = A11Y_JS[idx: A11Y_JS.index("}", idx)]
        self.assertIn(r"""replace(/'/g, "'\\''")""", body,
                      "shell 单引号转义必须是反斜杠形式，写坏会把命令参数截断")


if __name__ == "__main__":
    unittest.main()
