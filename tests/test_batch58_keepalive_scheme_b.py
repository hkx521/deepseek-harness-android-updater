from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
OVERLAY_SRC = (PKG / 'OverlayService.java').read_text(encoding='utf-8')
MAIN_SRC = (PKG / 'MainActivity.java').read_text(encoding='utf-8')
BOOT_SRC = (PKG / 'BootReceiver.java').read_text(encoding='utf-8')
POLICY_SRC = (PKG / 'KeepAlivePolicy.java').read_text(encoding='utf-8')


class Batch58OverlayKeepAliveDiagnosisTests(unittest.TestCase):
    '''批次58（方案B）：悬浮窗状态详情内保活健康度实时感知与一键跳转引导。'''

    def test_overlay_fields_and_view_binding(self) -> None:
        self.assertIn('private TextView keepAliveStatusText;', OVERLAY_SRC)
        self.assertIn('keepAliveStatusText = new TextView(this);', OVERLAY_SRC)
        self.assertIn('detailBox.addView(keepAliveStatusText);', OVERLAY_SRC)
        self.assertIn('detailBox.addView(keepAliveBar);', OVERLAY_SRC)

    def test_three_quick_action_pills_in_overlay(self) -> None:
        '''悬浮窗必须提供三个保活自检胶囊药丸：启动管理、电池优化、完整自检。'''
        self.assertIn('makeKeepAlivePill("⚡ 启动管理"', OVERLAY_SRC)
        self.assertIn('makeKeepAlivePill("🔋 电池优化"', OVERLAY_SRC)
        self.assertIn('makeKeepAlivePill("🩺 完整自检"', OVERLAY_SRC)
        self.assertIn('private TextView makeKeepAlivePill(', OVERLAY_SRC)

    def test_overlay_consumes_startup_manager_chain(self) -> None:
        '''悬浮窗的启动管理跳转必须消费 KeepAlivePolicy 的单点降级链。'''
        self.assertIn('KeepAlivePolicy.startupManagerTargets()', OVERLAY_SRC)
        self.assertIn('KeepAlivePolicy.PREF_STARTUP_GUIDED', OVERLAY_SRC)
        self.assertIn('openStartupManager()', OVERLAY_SRC)

    def test_overlay_battery_optimization_fallback(self) -> None:
        '''电池优化包含忽略申请 -> 列表页 -> 应用详情页的健壮降级。'''
        self.assertIn('openBatteryOptimizationSetting()', OVERLAY_SRC)
        self.assertIn('Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', OVERLAY_SRC)
        self.assertIn('Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS', OVERLAY_SRC)

    def test_overlay_full_keepalive_check_intent(self) -> None:
        '''完整自检通过 action_open_keepalive 唤起 MainActivity 并自动收起悬浮面板。'''
        self.assertIn('action_open_keepalive', OVERLAY_SRC)
        self.assertIn('openFullKeepAliveCheck()', OVERLAY_SRC)
        self.assertIn('setPanelVisible(false);', OVERLAY_SRC)

    def test_overlay_realtime_evaluation_and_color_contract(self) -> None:
        '''updateKeepAliveDetail 实时读真机状态并按 OK/WARN/FAIL 区分色值。'''
        self.assertIn('updateKeepAliveDetail()', OVERLAY_SRC)
        self.assertIn('KeepAlivePolicy.selfCheck(check)', OVERLAY_SRC)
        self.assertIn('0xFF10B981', OVERLAY_SRC)  # 绿色 (OK)
        self.assertIn('0xFFF59E0B', OVERLAY_SRC)  # 橙黄色 (WARN)
        self.assertIn('0xFFEF4444', OVERLAY_SRC)  # 红色 (FAIL)


class Batch58MainActivityDirectRouteTests(unittest.TestCase):
    '''批次58（方案B）：MainActivity 响应来自悬浮窗的 action_open_keepalive。'''

    def test_main_handles_action_in_create_and_new_intent(self) -> None:
        self.assertIn('in.getBooleanExtra("action_open_keepalive", false)', MAIN_SRC)
        self.assertIn('intent.getBooleanExtra("action_open_keepalive", false)', MAIN_SRC)
        self.assertIn('showKeepAliveDialog();', MAIN_SRC)


class Batch58KeepAlivePolicyIntegrityTests(unittest.TestCase):
    '''批次58（方案B）：策略单点定义与权威源口径彻底闭环。'''

    def test_boot_receiver_and_policy_aligned(self) -> None:
        self.assertIn('PREFS_NAME = "dsh_prefs"', POLICY_SRC)
        self.assertIn('KEY_BALL_AUTOSTART = "ball_autostart"', POLICY_SRC)
        self.assertIn('PREFS = "dsh_prefs"', BOOT_SRC)
        self.assertIn('KEY_BALL_AUTOSTART = "ball_autostart"', BOOT_SRC)


if __name__ == '__main__':
    unittest.main()

