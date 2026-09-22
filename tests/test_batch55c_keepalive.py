from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
POLICY_SRC = (PKG / 'KeepAlivePolicy.java').read_text(encoding='utf-8')
MAIN_SRC = (PKG / 'MainActivity.java').read_text(encoding='utf-8')
BOOT_SRC = (PKG / 'BootReceiver.java').read_text(encoding='utf-8')


class Batch55CKeepAliveSelfCheckTests(unittest.TestCase):
    '''批次55-C：保活自检 = 5 条硬判据（电池优化/后台限制/自启开关/服务/开机接收器）+ 2 条软判据。'''

    def test_self_check_api_and_judges(self) -> None:
        self.assertIn('public static SelfCheckReport selfCheck(SelfCheck in)', POLICY_SRC)
        for name in ('NAME_BATTERY', 'NAME_BG_RESTRICTED', 'NAME_AUTOSTART', 'NAME_SERVICE',
                     'NAME_BOOT_RECEIVER', 'NAME_STARTUP_GUIDE', 'NAME_HEARTBEAT'):
            self.assertIn(name, POLICY_SRC, '缺判据：' + name)

    def test_levels_and_first_target_contract(self) -> None:
        '''等级三档 + 「首个不满足判据」的跳转键（硬判据优先，卡片据此给一键入口）。'''
        for key in ('LEVEL_OK = "OK"', 'LEVEL_WARN = "WARN"', 'LEVEL_FAIL = "FAIL"'):
            self.assertIn(key, POLICY_SRC)
        self.assertIn('public final String firstTarget;', POLICY_SRC)
        self.assertIn('public static final String TARGET_STARTUP_MANAGER', POLICY_SRC)
        self.assertIn('public static final String TARGET_BATTERY_OPTIMIZATION', POLICY_SRC)

    def test_true_device_probes_not_hardcoded(self) -> None:
        '''判据必须取自真机 API / 实测值，不能写死（批次47 的教训）。'''
        self.assertIn('pm.isIgnoringBatteryOptimizations(getPackageName())', MAIN_SRC)
        self.assertIn('am.isBackgroundRestricted()', MAIN_SRC)
        self.assertIn('OverlayService.isRunning', MAIN_SRC)
        self.assertIn('queryBroadcastReceivers(probe, 0)', MAIN_SRC)

    def test_main_activity_renders_card_with_last_check(self) -> None:
        for needle in ('buildKeepAliveCard()', 'refreshKeepAliveCard()', 'keepAliveJumpButton(',
                       '保活自检（后台常驻）', 'KeepAlivePolicy.selfCheck(', '最近一次自检：'):
            self.assertIn(needle, MAIN_SRC, '卡片缺件：' + needle)
        self.assertIn('KeepAlivePolicy.PREF_LAST_CHECK_SUMMARY', MAIN_SRC)
        self.assertIn('KeepAlivePolicy.PREF_LAST_CHECK_AT', MAIN_SRC)
        self.assertIn('KeepAlivePolicy.PREF_LAST_BEAT_AT', MAIN_SRC)

    def test_card_reachable_from_settings_dialog(self) -> None:
        '''卡片不能只在「首次使用」页：设置弹窗要有入口，否则装完就再也看不到。'''
        self.assertIn('保活自检 · 后台常驻诊断', MAIN_SRC)
        self.assertIn('showKeepAliveDialog();', MAIN_SRC)


class Batch55CJumpChainTests(unittest.TestCase):
    '''批次55-C：一键跳转 + 降级链（启动管理 / 电池优化 / 应用详情）。'''

    def test_startup_manager_chain_single_definition(self) -> None:
        '''批次49 的 Honor 链字面量收敛到 KeepAlivePolicy（单点定义，纯逻辑可自测）。'''
        self.assertIn('public static String[][] startupManagerTargets()', POLICY_SRC)
        self.assertIn('HONOR_STARTUP_PKG = "com.hihonor.systemmanager"', POLICY_SRC)
        self.assertIn('StartupNormalAppListActivity', POLICY_SRC)
        self.assertIn('HONOR_STARTUP_ACTION = "hihonor.intent.action.HSM_STARTUPAPP_MANAGER"',
                      POLICY_SRC)
        self.assertIn('KIND_APP_DETAILS', POLICY_SRC)

    def test_main_activity_consumes_chain(self) -> None:
        self.assertIn('KeepAlivePolicy.startupManagerTargets()', MAIN_SRC)
        self.assertIn('openStartupManager()', MAIN_SRC)
        self.assertIn('Settings.ACTION_APPLICATION_DETAILS_SETTINGS', MAIN_SRC)

    def test_battery_optimization_fallback_chain(self) -> None:
        self.assertIn('openBatteryOptimizationSetting()', MAIN_SRC)
        self.assertIn('Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', MAIN_SRC)
        self.assertIn('Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS', MAIN_SRC)

    def test_guided_flag_recorded_on_click(self) -> None:
        self.assertIn('PREF_STARTUP_GUIDED, true', MAIN_SRC)


class Batch55CSelfHealAndHeartbeatTests(unittest.TestCase):
    '''批次55-C：onTaskRemoved 自愈决策 + 自检心跳（纯逻辑，供 OverlayService 一行接入）。'''

    def test_self_heal_api(self) -> None:
        self.assertIn('public static HealDecision onTaskRemoved(boolean selfStartEnabled, int healsInWindow,',
                      POLICY_SRC)
        self.assertIn('public static HealDecision decideSelfHeal(HealInputs in)', POLICY_SRC)
        self.assertIn('public static int healCountInWindow(long lastHealMs, long nowMs,', POLICY_SRC)
        self.assertIn('DEFAULT_HEAL_MAX_IN_WINDOW = 3', POLICY_SRC)
        self.assertIn('DEFAULT_HEAL_MIN_INTERVAL_MS = 60 * 1000L', POLICY_SRC)
        self.assertIn('public final boolean restart;', POLICY_SRC)
        self.assertIn('public final boolean giveUp;', POLICY_SRC)

    def test_heartbeat_api_and_pref_keys(self) -> None:
        self.assertIn('public static long nextHeartbeatDelayMs(long lastBeatMs, long nowMs, long intervalMs)',
                      POLICY_SRC)
        self.assertIn('public static boolean isStale(long lastMs, long nowMs, long maxAgeMs)', POLICY_SRC)
        self.assertIn('DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000L', POLICY_SRC)
        for key in ('PREF_LAST_BEAT_AT = "keepalive_last_beat_at"',
                    'PREF_LAST_HEAL_AT = "keepalive_last_heal_at"',
                    'PREF_HEAL_COUNT = "keepalive_heal_count"',
                    'PREF_STARTUP_GUIDED = "keepalive_startup_guided"'):
            self.assertIn(key, POLICY_SRC, '缺偏好键：' + key)

    def test_policy_stays_android_free_with_main_selfcheck(self) -> None:
        '''保活策略仍是纯逻辑：不 import android.*，靠 in-file main 充当 JVM 单测。'''
        self.assertNotIn('import android.', POLICY_SRC)
        self.assertIn('public static void main(String[] args)', POLICY_SRC)
        self.assertIn('批次55-C keep-alive self-check / self-heal:', POLICY_SRC)


class Batch55CBallAutostartSingleSourceTests(unittest.TestCase):
    '''批次55-C：自启开关单一权威源（dsh_prefs/ball_autostart，与 BootReceiver 同源）。'''

    def test_policy_and_boot_receiver_agree_on_prefs_file(self) -> None:
        self.assertIn('PREFS_NAME = "dsh_prefs"', POLICY_SRC)
        self.assertIn('KEY_BALL_AUTOSTART = "ball_autostart"', POLICY_SRC)
        self.assertIn('private static final String PREFS = "dsh_prefs";', BOOT_SRC)
        self.assertIn('KEY_BALL_AUTOSTART = "ball_autostart"', BOOT_SRC)

    def test_main_activity_writes_authoritative_source(self) -> None:
        '''批次47 把开关写在 dsh_setup，BootReceiver 读 dsh_prefs —— 用户「关球」在重启后失效。
        批次55-C 起权威源为 dsh_prefs：开关必须同步写这条（dsh_setup 仅兼容回退）。'''
        self.assertIn('putBoolean(KeepAlivePolicy.KEY_BALL_AUTOSTART, true)', MAIN_SRC)
        self.assertIn('putBoolean(KeepAlivePolicy.KEY_BALL_AUTOSTART, false)', MAIN_SRC)
        self.assertIn('ballAutostartWanted()', MAIN_SRC)


if __name__ == '__main__':
    unittest.main()
