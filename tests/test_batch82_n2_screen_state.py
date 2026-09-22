from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
MAIN_SRC = (HARNESS / "MainActivity.java").read_text(encoding="utf-8")
VSMC_SRC = (HARNESS / "VscreensManager.java").read_text(encoding="utf-8")
A11Y_SRC = (HARNESS / "AccessibilityService.java").read_text(encoding="utf-8")
ANDROID_PLUGIN = (ROOT / "plugins" / "dsh-tool-android" / "lib" / "index.js").read_text(encoding="utf-8")


class Batch82N2ScreenStateTests(unittest.TestCase):
    """批次82-N2：息屏决策的产品收口 —— 视觉类工具在熄屏时必须「诚实失败」，不能把黑帧当成功。

    背景（用户 2026-09-19 拍板）：**放弃「息屏下虚拟屏渲染」路线**。本机（Honor BKQ-AN10 /
    MagicOS 11 / Android 17）主屏熄灭后 SurfaceFlinger 停止合成虚拟屏，三轮穷尽实测
    （9 条公开路径 / 显示组 flags / 厂商私有通路 / 陪伴虚拟设备）均无绕过通路；唯一可用是
    「充电时保持屏幕亮」（stay_on）。

    因此产品侧只做三件事：
      ① 3081 `/status` 暴露 `screenOn`（App 侧唯一实时屏态源）；
      ② 熄屏时 `/vscreen/see`（3081）与 `/screenshot`（3181）如实失败并给可执行提示；
      ③ 插件侧把该失败翻译成「点亮屏幕 / 开保持屏幕亮 / 改用读节点」的可操作文案。
    """

    # ---- ① 屏态出参 ----

    def test_status_exposes_screen_on(self) -> None:
        body = MAIN_SRC.split("private String handleStatusRequest() {")[1].split("\n    }")[0]
        self.assertIn('sb.append(",\\"screenOn\\":")', body)
        self.assertIn('sb.append(",\\"screenState\\":\\"")', body)
        self.assertIn("boolean screenOn = isScreenInteractive();", body)

    def test_screen_interactive_helper_never_blocks(self) -> None:
        """取不到 PowerManager 时按「亮着」处理：宁可放过（工具照跑），不可误杀。"""
        main = MAIN_SRC.split("private boolean isScreenInteractive() {")[1].split("\n    }")[0]
        self.assertIn("pm.isInteractive()", main)
        self.assertIn("return true;", main)

    # ---- ② 熄屏时如实失败 ----

    def test_vscreen_see_refuses_while_screen_off(self) -> None:
        self.assertIn('private static final String REASON_SCREEN_OFF = "SCREEN_OFF";', VSMC_SRC)
        self.assertIn("HINT_SCREEN_OFF", VSMC_SRC)
        body = VSMC_SRC.split('} else if (path.equals("/vscreen/see")) {')[1].split("} else if (")[0]
        self.assertIn("if (!isScreenInteractive(ctx))", body)
        self.assertIn("failJson(REASON_SCREEN_OFF, HINT_SCREEN_OFF)", body)
        # 旧写法（see 与 launch/tap/swipe 合并分支）已拆开，防止回归
        self.assertNotIn('path.equals("/vscreen/launch") || path.equals("/vscreen/see")', VSMC_SRC)

    def test_screenshot_refuses_while_screen_off(self) -> None:
        body = A11Y_SRC.split("private String handleScreenshot(String path) {")[1].split("final CountDownLatch latch")[0]
        self.assertIn("if (!isScreenInteractive())", body)
        self.assertIn("SCREEN_OFF", body)

    # ---- ③ 插件侧可操作文案 ----

    def test_plugin_maps_screen_off_to_actionable_hint(self) -> None:
        self.assertIn("const SCREEN_OFF_HINT =", ANDROID_PLUGIN)
        self.assertIn('if (out.reason === "SCREEN_OFF" && !out.hint) out.hint = SCREEN_OFF_HINT;', ANDROID_PLUGIN)
        self.assertIn("async function appScreenOn()", ANDROID_PLUGIN)
        self.assertIn('await appRequest("/status")', ANDROID_PLUGIN)

    def test_screenshot_tool_gates_on_screen_state(self) -> None:
        body = ANDROID_PLUGIN.split('name: "android_screenshot"')[1].split("name: ")[0]
        self.assertIn("const screenOn = await appScreenOn();", body)
        self.assertIn("if (screenOn === false)", body)
        self.assertIn('error: "SCREEN_OFF"', body)


if __name__ == "__main__":
    unittest.main()
