#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次70 契约：等待态实况窗 + 一键唤起 + 设置页开关 + 定时任务互通 + 看护忙闲两档。"""
import pathlib
import unittest

PKG = pathlib.Path(__file__).resolve().parents[1] / "android-app" / "src" / "com" / "deepseek" / "harness"


class LiveUpdateWaitContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ppn = (PKG / "PromotedProgressNotifier.java").read_text(encoding="utf-8")
        cls.overlay = (PKG / "OverlayService.java").read_text(encoding="utf-8")
        cls.main = (PKG / "MainActivity.java").read_text(encoding="utf-8")
        cls.sched = (PKG / "ScheduleExecutor.java").read_text(encoding="utf-8")

    def test_waiting_api_and_amber(self) -> None:
        """等待态 API + 琥珀段 + 关键文案。"""
        self.assertIn("public static void interaction(Context ctx, String kind, long elapsedSecs)",
                      self.ppn)
        self.assertIn("public static void clearInteraction()", self.ppn)
        self.assertIn("private static final int AMBER = 0xFFFF9800;", self.ppn)
        self.assertIn("if (interactionPending) seg.setColor(AMBER);", self.ppn)
        self.assertIn('"请作答"', self.ppn)
        self.assertIn('"需审批"', self.ppn)
        self.assertIn("WAIT_TITLE_QUESTION", self.ppn)
        self.assertIn("WAIT_TITLE_APPROVAL", self.ppn)

    def test_waiting_content_intent_opens_panel(self) -> None:
        """挂起交互时点实况窗要直达助手面板（action_open_assistant）。"""
        self.assertIn("open.putExtra(\"action_open_assistant\", true);", self.ppn)
        self.assertIn("PendingIntent.getService(ctx, REQ_WAIT, open", self.ppn)
        self.assertIn("PendingIntent open = interactionPending ? waitIntent(ctx) : openIntent(ctx);",
                      self.ppn)
        self.assertIn('intent.getBooleanExtra("action_open_assistant", false)', self.overlay)

    def test_overlay_drives_waiting_state(self) -> None:
        """提问卡片与 1s ticker 都走等待态；作答后回进度态。"""
        self.assertIn("PromotedProgressNotifier.interaction(this, kind, elapsedSecs());", self.overlay)
        self.assertIn("PromotedProgressNotifier.interaction(OverlayService.this, pendingInteractionKind, secs);",
                      self.overlay)
        self.assertIn("PromotedProgressNotifier.clearInteraction();", self.overlay)
        # 旧的「等待态走普通 update」应已被替换
        self.assertNotIn('PromotedProgressNotifier.update(this, "等待您的回答…", 0, elapsedSecs());',
                         self.overlay)

    def test_settings_switch_binds_pref(self) -> None:
        """设置页开关绑定 dsh_prefs/promoted_live_update，关闭时撤销实况窗。"""
        self.assertIn("PromotedProgressNotifier.isEnabled(MainActivity.this)", self.main)
        self.assertIn(".putBoolean(PromotedProgressNotifier.KEY_ENABLED, on).apply();", self.main)
        self.assertIn("if (!on) PromotedProgressNotifier.stop(MainActivity.this);", self.main)
        self.assertIn('liveUpdateToggleView.setText("实况窗："', self.main)

    def test_scheduled_task_live_states(self) -> None:
        """定时任务实况三态 + 有界轮询（3s / 600s / 先 true 后回落）。"""
        self.assertIn('PromotedProgressNotifier.start(ctx, "定时任务："', self.sched)
        self.assertIn('PromotedProgressNotifier.finish(ctx, "✓ 定时任务已完成");', self.sched)
        self.assertIn('PromotedProgressNotifier.finish(ctx, "⚠ 定时任务超时未确认");', self.sched)
        self.assertIn('PromotedProgressNotifier.finish(ctx, "✕ 定时任务未完成");', self.sched)
        self.assertIn("Thread.sleep(3000L);", self.sched)
        self.assertIn("< 600000L", self.sched)
        self.assertIn("boolean sawRunning = false;", self.sched)
        self.assertIn('"任务已提交：\\n" + task', self.sched)

    def test_watchdog_busy_idle_intervals(self) -> None:
        """看护忙闲两档间隔 + state 里带 interval。"""
        hosted = (PKG / "HostedEngineManager.java").read_text(encoding="utf-8")
        self.assertIn("WATCHDOG_INTERVAL_IDLE_SEC = 90", hosted)
        self.assertIn("IDLE_INTERVAL=", hosted)
        self.assertIn("BUSY_HITS=$(grep -c '0100007F:0C08.* 01 ' /proc/net/tcp", hosted)
        self.assertIn("INTERVAL=$IDLE_INTERVAL", hosted)
        self.assertIn("interval=$INTERVAL", hosted)


    def test_priv_setting_readback(self) -> None:
        """privSetting 以回读判定成败；读流阶段异常降级为 info（批次66b/67 遗留）。"""
        vs = (PKG / "VscreensManager.java").read_text(encoding="utf-8")
        self.assertIn("private static String readbackCmdFor(String args)", vs)
        self.assertIn('return "get " + a.substring(4, lastSpace).trim();', vs)
        self.assertIn("[b70] privSetting \" + args + \" ok=true readback=\" + seen", vs)
        self.assertIn("[b70] privSetting \" + args + \" ok=false readback=\" + seen", vs)
        self.assertIn("exec-phase note", vs)
        self.assertNotIn('Log.w(TAG, "privSetting failed: ' + '" + args, t);', vs)

if __name__ == "__main__":
    unittest.main()

