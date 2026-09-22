from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANDROID_PLUGIN_PATH = ROOT / "plugins" / "dsh-tool-android" / "lib" / "index.js"
ANDROID_PLUGIN = ANDROID_PLUGIN_PATH.read_text(encoding="utf-8")

CHROOT_TOOLS = (
    "android_chroot_exec",
    "android_chroot_job",
    "android_task_list",
    "android_task_resume",
)
# 本机实测**可用**的只读系统工具（反向契约：不得被 chroot 闸门顺手关掉）
CAPABLE_TOOLS = (
    "android_sms",
    "android_calllog",
    "android_contacts",
    "android_location",
)
GATED_REGISTER = "if (chrootToolsAvailable()) ctx.tools.register(defineTool({"


def _register_guard(tool: str) -> str:
    """返回该工具 defineTool 注册调用所在行的前缀（判据前缀或空串）。"""
    idx = ANDROID_PLUGIN.index('name: "%s",' % tool)
    reg = ANDROID_PLUGIN.rindex("ctx.tools.register(defineTool({", 0, idx)
    line_start = ANDROID_PLUGIN.rindex("\n", 0, reg) + 1
    return ANDROID_PLUGIN[line_start:reg]


class Batch86P2PrivilegedToolsTests(unittest.TestCase):
    """批次86-P2-1：chroot 工具面（chroot_exec/job + task_list/resume）改为**按设备能力注册**。

    实测判据（2026-09-21，serial SN-HONOR-XXXX / Honor BKQ-AN10 / MagicOS 11 / Android 17）：
      * adb shell id = uid=2000(shell)，which su 无输出、/data/local/dsh-chroot/bin/busybox
        不存在 ⇒ 这 4 个工具在本机恒不可用（旧实现里它们注册在特权门控**之前**，只会拿到必然
        失败的入口）；
      * 反向：content query --uri content://sms 与 content://call_log/calls、dumpsys location
        均正常 ⇒ android_sms/calllog/contacts/location 本机可用，必须继续注册。

    契约要点：
      ① 判据函数 chrootToolsAvailable() 存在，且条件恰为 ROOT_AVAILABLE=1 或 rootfs 已在位；
      ② 4 个 chroot 工具全部、且只有它们共用该判据（严格 4 处 gated register）；
      ③ 反向契约：本机可用的 4 个只读系统工具不得被该判据包住；
      ④ 旧注释（batch5「故意先注册」/ 批次23「注册在特权门控之前」）已改写为新决策 + 理由 + 批次号；
      ⑤ 跨设备纪律：只收窄注册条件，特权路径实现全部保留（用户还有其他有 root 的机器）。
      行为型对照用例：tests/test_batch86_p2_privileged_gate.mjs（node，离线跑注册表实测）。

    根因与取证：docs/批次86-重审与瘦身方案.md §P2-1。
    """

    # ---- ① 判据函数 ----

    def test_criterion_function_exists_with_both_conditions(self) -> None:
        self.assertIn("function chrootToolsAvailable() {", ANDROID_PLUGIN)
        body = ANDROID_PLUGIN.split("function chrootToolsAvailable() {")[1].split("\n}")[0]
        self.assertIn('process.env.ROOT_AVAILABLE === "1"', body, "条件一：root 通道在位")
        self.assertIn('existsSync(CHROOT_DIR + "/bin/busybox")', body, "条件二：rootfs 已在位")

    def test_criterion_not_conflated_with_privileged_available(self) -> None:
        """不能用 privilegedAvailable()：它把托管 shell(uid=2000) 也算特权，而 shell 无 mount/chroot 权限。"""
        self.assertIn("function privilegedAvailable() {", ANDROID_PLUGIN)
        self.assertIn("不要改用 privilegedAvailable()", ANDROID_PLUGIN)
        body = ANDROID_PLUGIN.split("function chrootToolsAvailable() {")[1].split("\n}")[0]
        self.assertNotIn("privilegedAvailable()", body)

    def test_criterion_exported_for_behavioral_case(self) -> None:
        self.assertIn("  chrootToolsAvailable,", ANDROID_PLUGIN)
        case = ROOT / "tests" / "test_batch86_p2_privileged_gate.mjs"
        self.assertTrue(case.exists(), "行为型 node 用例缺失")
        text = case.read_text(encoding="utf-8")
        self.assertIn("chrootToolsAvailable", text)
        for tool in CHROOT_TOOLS:
            self.assertIn(tool, text)

    # ---- ② 4 个 chroot 工具共用判据（不多不少） ----

    def test_exactly_four_gated_registers(self) -> None:
        self.assertEqual(
            ANDROID_PLUGIN.count(GATED_REGISTER),
            len(CHROOT_TOOLS),
            "共用该判据的注册点必须严格等于 4 处（chroot 工具面）",
        )

    def test_four_chroot_tools_are_gated(self) -> None:
        for tool in CHROOT_TOOLS:
            self.assertEqual(
                _register_guard(tool).strip(),
                "if (chrootToolsAvailable())",
                tool + " 的注册必须由 chrootToolsAvailable() 判据包住",
            )

    # ---- ③ 反向契约：本机可用的只读系统工具不受影响 ----

    def test_capable_readonly_tools_are_not_gated(self) -> None:
        for tool in CAPABLE_TOOLS:
            guard = _register_guard(tool)
            self.assertNotIn(
                "chrootToolsAvailable",
                guard,
                tool + " 本机实测可用（content query / dumpsys location），不得被 chroot 判据包住",
            )

    def test_app_layer_tools_stay_ungated(self) -> None:
        """App 层工具（走 3081，不依赖特权）必须与本次收窄无关。"""
        for tool in ("android_usage", "android_notifications"):
            self.assertNotIn("chrootToolsAvailable", _register_guard(tool))
        self.assertIn("  ctx.tools.register(defineTool({", ANDROID_PLUGIN)

    # ---- ④ 旧决策注释已改写 ----

    def test_old_register_before_gate_decision_replaced(self) -> None:
        self.assertNotIn("注册在下面的特权门控「之前」", ANDROID_PLUGIN)
        self.assertNotIn("注册在特权门控之前（与 chroot 同族）", ANDROID_PLUGIN)
        self.assertIn("批次86-P2-1", ANDROID_PLUGIN)
        self.assertIn("docs/批次86-重审与瘦身方案.md §P2-1", ANDROID_PLUGIN)

    # ---- ⑤ 跨设备纪律：实现不删，只收窄注册条件 ----

    def test_privileged_implementations_kept(self) -> None:
        for needle in (
            "function privilegedAvailable() {",
            "function isHostedShellPrivileged() {",
            "function chrootRootfsHint() {",
            "function buildChrootScript(",
            "function parseChrootOutput(",
            "async function startChrootJob(",
            "async function listChrootJobs(",
            "if (!privilegedAvailable()) {",
            'name: "android_chroot_exec",',
            'name: "android_chroot_job",',
            'name: "android_task_list",',
            'name: "android_task_resume",',
        ):
            self.assertIn(needle, ANDROID_PLUGIN, "特权路径实现/工具定义不得删除：" + needle)


if __name__ == "__main__":
    unittest.main()

