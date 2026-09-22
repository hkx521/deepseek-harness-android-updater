from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
A11Y_SRC = (PKG / 'AccessibilityService.java').read_text(encoding='utf-8')
OVERLAY_SRC = (PKG / 'OverlayService.java').read_text(encoding='utf-8')
MAIN_SRC = (PKG / 'MainActivity.java').read_text(encoding='utf-8')
POLICY_SRC = (PKG / 'KeepAlivePolicy.java').read_text(encoding='utf-8')


class Batch49AutomationCruiseTests(unittest.TestCase):
    '''批次49：悬浮球跨 App 自动化巡航避让与急停总线（G1 & G2）。'''

    def test_a11y_force_release_fingers_provided(self) -> None:
        self.assertIn('public static void forceReleaseFingers()', A11Y_SRC)
        self.assertIn('releaseAllFingers();', A11Y_SRC)

    def test_a11y_tap_triggers_overlay_highlight(self) -> None:
        self.assertIn('OverlayService.showTapHighlight(x, y);', A11Y_SRC)

    def test_overlay_tap_ripple_method_exists(self) -> None:
        self.assertIn('public static void showTapHighlight(final int x, final int y)', OVERLAY_SRC)
        self.assertIn('displayTapRipple(x, y)', OVERLAY_SRC)

    def test_overlay_emergency_stop_wired(self) -> None:
        self.assertIn('triggerEmergencyStop()', OVERLAY_SRC)
        self.assertIn('AccessibilityService.forceReleaseFingers()', OVERLAY_SRC)
        self.assertIn('cancelCommand()', OVERLAY_SRC)

    def test_cruise_pulse_animation_wired(self) -> None:
        self.assertIn('startPulseAnimation()', OVERLAY_SRC)
        self.assertIn('stopPulseAnimation()', OVERLAY_SRC)

    def test_minibar_cruise_progress_and_emergency_stop(self) -> None:
        self.assertIn('点击急停', OVERLAY_SRC)
        self.assertIn('triggerEmergencyStop();', OVERLAY_SRC)


class Batch49ResultPersistenceTests(unittest.TestCase):
    '''批次49：成果真实文件落盘与全文视图（G3 & G4）。'''

    def test_full_result_preservation_and_break_truncation(self) -> None:
        self.assertIn('private String fullResult = "";', OVERLAY_SRC)
        self.assertIn('fullResult = full;', OVERLAY_SRC)
        self.assertIn('showFullResultDialog()', OVERLAY_SRC)

    def test_save_result_to_markdown_file(self) -> None:
        self.assertIn('saveResultToFile()', OVERLAY_SRC)
        self.assertIn('DSH_Outputs', OVERLAY_SRC)
        self.assertIn('.md', OVERLAY_SRC)
        self.assertIn('DeepSeek Harness 任务结果', OVERLAY_SRC)
        self.assertIn('openFileExternally(targetFile);', OVERLAY_SRC)

    def test_chips_contain_save_and_full_view(self) -> None:
        self.assertIn('makeChip("📄 存为文件"', OVERLAY_SRC)
        self.assertIn('makeChip("⤢ 查看全文"', OVERLAY_SRC)
        self.assertIn('HorizontalScrollView', OVERLAY_SRC)

    def test_full_result_dialog_copy_and_share(self) -> None:
        self.assertIn('shareResultText(content)', OVERLAY_SRC)
        self.assertIn('ACTION_SEND', OVERLAY_SRC)
        self.assertIn('复制全文', OVERLAY_SRC)


class Batch49StartupManagerKeepAliveTests(unittest.TestCase):
    '''批次49：荣耀专有启动白名单引导（模块 C）。

    批次55-C 把这条降级链的字面量收敛成 KeepAlivePolicy.startupManagerTargets()（单点定义，
    纯逻辑可自测），MainActivity 改为按链尝试 —— 断言随实现移到链的权威位置，强度不变：
    Honor 组件 → Honor 私有 action → 系统应用详情页兜底。
    '''

    def test_honor_startup_manager_chain_declared_once(self) -> None:
        self.assertIn('com.hihonor.systemmanager', POLICY_SRC)
        self.assertIn('StartupNormalAppListActivity', POLICY_SRC)
        self.assertIn('hihonor.intent.action.HSM_STARTUPAPP_MANAGER', POLICY_SRC)

    def test_main_activity_routes_through_chain(self) -> None:
        self.assertIn('openStartupManager()', MAIN_SRC)
        self.assertIn('KeepAlivePolicy.startupManagerTargets()', MAIN_SRC)

    def test_permission_screen_has_startup_row(self) -> None:
        self.assertIn('应用启动管理（荣耀/自启保活）', MAIN_SRC)


if __name__ == '__main__':
    unittest.main()

