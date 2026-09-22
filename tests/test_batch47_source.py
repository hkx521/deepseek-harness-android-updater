from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
A11Y_SRC = (PKG / 'AccessibilityService.java').read_text(encoding='utf-8')
OVERLAY_SRC = (PKG / 'OverlayService.java').read_text(encoding='utf-8')
MAIN_SRC = (PKG / 'MainActivity.java').read_text(encoding='utf-8')
MANIFEST_SRC = (ROOT / 'android-app' / 'AndroidManifest.xml').read_text(encoding='utf-8')


class Batch47NoYoyoBindingTests(unittest.TestCase):
    '''批次47（策略调整）：彻底解除与厂商助手 / YOYO 的绑定（用户明确不需要）。'''

    def test_no_vendor_assistant_recognition_left(self) -> None:
        for needle in ('com.hihonor.magicvoice', 'com.huawei.vassistant', 'com.miui.voiceassist',
                       'com.heytap.speechassist', 'com.vivo.agent', 'com.samsung.android.bixby.agent',
                       'isTargetSystemAssistant'):
            self.assertNotIn(needle, A11Y_SRC, '无障碍服务不应再识别厂商助手包名：' + needle)

    def test_no_intercept_chain_left(self) -> None:
        # 注：GLOBAL_ACTION_BACK 本身是 AI 工具链的正式能力（/back 路由、收起输入法），
        # 只要求「压灭厂商助手」的那套链路消失，因此这里不把该常量列为禁项。
        for needle in ('ASSISTANT_INTERCEPT_COOLDOWN_MS', 'interceptAssistantNow',
                       'checkAndInterceptSystemAssistant', 'checkWindowListForAssistant',
                       'scanWindowsForAssistant', 'intercept_system_assistant'):
            self.assertNotIn(needle, A11Y_SRC, '助手拦截链应已移除：' + needle)

    def test_voice_interaction_components_removed(self) -> None:
        for name in ('DshVoiceInteractionService.java', 'DshVoiceInteractionSessionService.java',
                     'DshVoiceInteractionSession.java', 'DshRecognitionService.java',
                     'AssistantTakeover.java'):
            self.assertFalse((PKG / name).exists(), name + ' 应已删除')
        self.assertFalse((ROOT / 'android-app' / 'res' / 'xml' /
                          'voice_interaction_service.xml').exists(),
                         'voice-interaction 元数据应已删除')
        for needle in ('DshVoiceInteraction', 'BIND_VOICE_INTERACTION', 'voice_interaction_service'):
            self.assertNotIn(needle, MANIFEST_SRC, '清单不应再声明系统助手接管：' + needle)

    def test_strategy_note_present(self) -> None:
        '''策略变更必须留痕，避免后人又把拦截链加回来。'''
        self.assertIn('批次47（策略调整）', A11Y_SRC)

    def test_a11y_core_capability_intact(self) -> None:
        '''去 YOYO 化只删「助手拦截」，读屏/手势/截图核心能力必须原样保留。'''
        for needle in ('public void onAccessibilityEvent(AccessibilityEvent event) {',
                       'startServer(port);', 'executeGesture(ops)',
                       'public static boolean captureScreen(', 'handleStatus()'):
            self.assertIn(needle, A11Y_SRC, '无障碍核心能力被误删：' + needle)


class Batch47BallLifecycleTests(unittest.TestCase):
    '''批次47：悬浮球的保活与启动（开机 / 覆盖安装自愈）。'''

    def test_boot_receiver_exists_and_wired(self) -> None:
        boot_path = PKG / 'BootReceiver.java'
        self.assertTrue(boot_path.is_file(), 'BootReceiver.java 缺失（开机自启入口）')
        boot = boot_path.read_text(encoding='utf-8')
        self.assertIn('extends BroadcastReceiver', boot)
        self.assertIn('Intent.ACTION_BOOT_COMPLETED', boot)
        self.assertIn('Intent.ACTION_MY_PACKAGE_REPLACED', boot)
        self.assertIn('ball_autostart', boot)
        self.assertIn('startForegroundService', boot)

        self.assertIn('android.permission.RECEIVE_BOOT_COMPLETED', MANIFEST_SRC)
        self.assertIn('android:name=".BootReceiver"', MANIFEST_SRC)
        self.assertIn('android.intent.action.BOOT_COMPLETED', MANIFEST_SRC)
        self.assertIn('android.intent.action.MY_PACKAGE_REPLACED', MANIFEST_SRC)
        self.assertIn('android.intent.action.QUICKBOOT_POWERON', MANIFEST_SRC)

    def test_manual_toggle_writes_autostart_pref(self) -> None:
        self.assertIn('PREF_BALL_AUTOSTART = "ball_autostart"', MAIN_SRC)
        self.assertIn('putBoolean(PREF_BALL_AUTOSTART, true)', MAIN_SRC)
        self.assertIn('putBoolean(PREF_BALL_AUTOSTART, false)', MAIN_SRC)

    def test_foreground_keepalive_untouched(self) -> None:
        self.assertIn('return START_STICKY;', OVERLAY_SRC)

    def test_cold_start_visibility_default_is_background(self) -> None:
        '''冷启动的进程没有前台 UI：overlayForeground 缺省必须是 false，否则球建出来就是 GONE。'''
        self.assertIn('public static volatile boolean overlayForeground = false;', MAIN_SRC)

    def test_fab_field_not_shadowed(self) -> None:
        self.assertNotIn('private FrameLayout fab;', OVERLAY_SRC)
        self.assertNotIn('rootView.addView(fab);', OVERLAY_SRC)


class Batch48PurgeAllDockTests(unittest.TestCase):
    '''批次48（彻底清理）：彻底删除 YOYO 底部胶囊代码与长按绑定。'''

    def test_no_dock_residuals_in_overlay(self) -> None:
        for banned in ('dockContainer', 'enterDockMode', 'exitDockMode', 'BALL_HOLD_MS',
                       'ballHoldRunnable', 'dockBackdrop', 'DockWaveView', 'ic_yoyo',
                       'dockMode', 'makeDockChip', 'showQuickDock'):
            self.assertNotIn(banned, OVERLAY_SRC, 'OverlayService 仍残留：' + banned)

    def test_yoyo_assets_and_files_purged(self) -> None:
        self.assertFalse((PKG / 'DockWaveView.java').exists())
        for png in ('ic_yoyo_avatar.png', 'ic_yoyo_lens.png', 'ic_yoyo_plus.png', 'ic_yoyo_wave.png'):
            self.assertFalse((ROOT / 'android-app' / 'res' / 'drawable' / png).exists(), png + ' 应该已删除')


class Batch47KeptToolingTests(unittest.TestCase):
    def test_ui_diff_tool_still_shipped(self) -> None:
        self.assertTrue((ROOT / 'tools' / 'ui-diff.py').is_file())


class Batch48EngineHealTests(unittest.TestCase):
    '''批次48：引擎健康可达与一键自愈。'''

    def test_detail_button_and_status_clickable(self) -> None:
        self.assertIn('TextView detailBtn = new TextView(this);', OVERLAY_SRC)
        self.assertIn('detailBtn.setText("ⓘ");', OVERLAY_SRC)
        self.assertIn('statusDot.setOnClickListener(statusClick);', OVERLAY_SRC)
        self.assertIn('statusLabel.setOnClickListener(statusClick);', OVERLAY_SRC)
        self.assertIn('launchEngineFromOverlay()', OVERLAY_SRC)

    def test_main_activity_handles_launch_action(self) -> None:
        self.assertIn('action_launch_engine', MAIN_SRC)
        self.assertIn('protected void onNewIntent(Intent intent)', MAIN_SRC)

    def test_port_text_shows_probe_age(self) -> None:
        self.assertIn('最近探活', OVERLAY_SRC)


if __name__ == '__main__':
    unittest.main()
