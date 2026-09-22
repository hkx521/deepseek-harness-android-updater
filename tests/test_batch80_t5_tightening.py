from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
A11Y_PLUGIN = ROOT / "plugins" / "dsh-tool-accessibility" / "lib" / "index.js"
STAGING_A11Y = (ROOT / "android-app" / "staging" / "dshhome" / "profiles" / "web"
                / "node_modules" / "@deepseek-ai" / "dsh-tool-accessibility" / "lib" / "index.js")


def _between(source: str, start: str, end: str) -> str:
    i = source.index(start)
    j = source.index(end, i + len(start))
    return source[i:j]


class Batch80ReadOnlyHeuristicTests(unittest.TestCase):
    """批次80（T5-1）：只读误判收紧。

    批次77 §五.4 真机取证：长自动化（12 页设置巡检）被模型反问「要不要继续 / 请授权」。
    根因链：只读词命中即整轮判只读 → applyVscreenPolicy 注入「禁止虚拟屏」+
    VscreensManager 硬闸门拒绝 /vscreen/create → 长任务只能停在主屏回头问用户。
    契约：只有「不含任何动作词」的指令才算只读任务。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.src = (HARNESS / "OverlayService.java").read_text(encoding="utf-8")

    def test_action_markers_exist(self) -> None:
        self.assertIn("private static final String[] ACTION_SCREEN_MARKERS = {", self.src)
        for word in ("\"打开\"", "\"进入\"", "\"点击\"", "\"依次\"", "\"批量\""):
            self.assertIn(word, self.src)

    def test_read_only_requires_no_action_word(self) -> None:
        body = _between(self.src, "private boolean shouldUseVscreen(String command) {",
                        "private static boolean containsAny(")
        self.assertIn("containsAny(cmd, READ_ONLY_SCREEN_MARKERS)", body)
        self.assertIn("!containsAny(cmd, ACTION_SCREEN_MARKERS)", body)
        # 旧的「命中只读词就 return false」已被复合条件取代
        self.assertNotIn("if (containsAny(cmd, READ_ONLY_SCREEN_MARKERS)) return false;", body)


class Batch80AutoProceedTests(unittest.TestCase):
    """批次80（T5-2）：「直接执行」开关 + prompt 授权前置。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.overlay = (HARNESS / "OverlayService.java").read_text(encoding="utf-8")
        cls.main = (HARNESS / "MainActivity.java").read_text(encoding="utf-8")

    def test_pref_and_prompt_branch(self) -> None:
        self.assertIn('getBoolean("agent_auto_proceed", false)', self.overlay)
        self.assertIn("private boolean agentAutoProceed() {", self.overlay)
        self.assertIn("agentAutoProceed()", self.overlay.split("private String buildAgentPrompt")[1][:1200])
        self.assertIn("【用户已授权 · 直接执行】", self.overlay)
        # 可取证：开启时构建 prompt 留一行日志
        self.assertIn("[b80] prompt: auto-proceed authorized", self.overlay)

    def test_settings_toggle(self) -> None:
        self.assertIn("private TextView autoProceedToggleView;", self.main)
        self.assertIn('autoProceedToggleView = keepAliveJumpButton("直接执行"', self.main)
        self.assertIn('putBoolean("agent_auto_proceed", on)', self.main)
        self.assertIn('autoProceedToggleView.setText("直接执行："', self.main)


class Batch80ScreenTargetAndPrivTests(unittest.TestCase):
    """批次80（T5-3/T5-4/T5-5）：假空屏 / privSetting 假报错回读腿 / 保活锁竞态。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.a11y = (HARNESS / "AccessibilityService.java").read_text(encoding="utf-8")
        cls.vsm = (HARNESS / "VscreensManager.java").read_text(encoding="utf-8")

    def test_context_target_rejects_empty_trees(self) -> None:
        body = _between(self.a11y, "private ContextTarget readContextTarget(int displayId) {",
                        "private int countNodes(")
        self.assertGreaterEqual(body.count("if (countNodes(root) <= 0)"), 2,
                                "活动窗口与候选窗口两条路径都要拒绝空树")

    def test_privsetting_readback_distinguishes_unreadable(self) -> None:
        self.assertIn("private String privSettingGetRaw(Context ctx, String args) {", self.vsm)
        body = _between(self.vsm, "String readbackCmd = readbackCmdFor(args);",
                        "private static String readbackCmdFor(")
        self.assertIn("privSettingGetRaw(ctx, readbackCmd)", body)
        self.assertIn('unverified (readback unreadable)', body)
        # 原 "null" 契约的 privSettingGet 必须保留（ensure 原值判断依赖它）
        self.assertIn('return "null";', self.vsm)

    def test_panel_wakelock_race_hardened(self) -> None:
        body = _between(self.vsm, "private void escalatePanelKeepAliveIfNeeded(Context ctx) {",
                        "private void releasePanelWakeLock()")
        self.assertIn("if (!sessionActive || shutdownRequested) {", body)
        self.assertIn("KEY_LOCK_PANEL_KEEPALIVE, true)", body.split("panelWakeLock.acquire()")[0][-800:])


class Batch80A11yPluginActTypeTests(unittest.TestCase):
    """批次80（T5-6，插件侧）：android_act 事务内 type 接上特权兜底。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.src = A11Y_PLUGIN.read_text(encoding="utf-8")

    def test_shared_fallback_helper_exists(self) -> None:
        self.assertIn("async function typePrivilegedFallback(args, displayId, direct) {", self.src)
        helper = _between(self.src, "async function typePrivilegedFallback(", "\nasync function")
        self.assertIn('vscreenBridge("POST", "/vscreen/key", { key: "279" }', helper)
        self.assertIn("await privilegedType(args, scoped ? displayId : null)", helper)

    def test_single_tool_and_act_share_one_chain(self) -> None:
        # 单工具：return typePrivilegedFallback(...)；事务：await typePrivilegedFallback(...)
        self.assertIn("return typePrivilegedFallback(args, displayId, direct);", self.src,
                      "单工具 android_type 必须走抽出的兜底链")
        self.assertIn("await typePrivilegedFallback(a, ensured.displayId, direct)", self.src,
                      "android_act 事务内 type 必须走同一条兜底链")
        act = _between(self.src, "// 批次74：事务内 type 必须与单工具 android_type 同语义",
                       "// scroll / back / home")
        self.assertIn("typePrivilegedFallback(a, ensured.displayId, direct)", act)
        # 主屏分支：只有在 IME_NOT_READY / POSTCONDITION_FAILED 时才兜底（与单工具一致）
        self.assertIn('direct.reason === "IME_NOT_READY" || direct.reason === "POSTCONDITION_FAILED"', act)

    def test_staging_copy_matches_repo_plugin(self) -> None:
        if not STAGING_A11Y.is_file():
            self.skipTest("staging 派生副本不存在")
        self.assertEqual(STAGING_A11Y.read_bytes(), A11Y_PLUGIN.read_bytes(),
                         "staging 副本必须与 plugins/ 一致（否则排查时会被误导）")


if __name__ == "__main__":
    unittest.main()
