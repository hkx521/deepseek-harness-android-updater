#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次82-N7 契约：实况窗胶囊「静默续期心跳」改为可选开关（默认关）。

背景：批次56-A 为规避 MagicOS `mCapsuleExpandDuration = 300000`（单步静默超 5 分钟胶囊收成
圆点、文字隐去）给 PromotedProgressNotifier 加了「每 4 分钟按原样重发同一通知」的续期心跳。
N7 是产品取舍：**默认不再续期**，遵守 ROM 原生行为（静默超时 → 胶囊自然收成圆点，诚实表达
「还在跑、暂无新进展」；下一次 update() 会重新发布并展开）；确实需要「长静默也保持展开有字」
的用户，可在设置页打开该开关。

三处契约：
  ① PromotedProgressNotifier：新键 KEY_HEARTBEAT（默认 false）+ isHeartbeatEnabled()；
  ② scheduleHeartbeat()：只在开关开启时才排期（关闭时零续期，但正常发布路径不受影响）；
  ③ MainActivity 设置页：新增一行可点开关（翻转偏好 + 就地回读文案）。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
PPN = (HARNESS / "PromotedProgressNotifier.java").read_text(encoding="utf-8")
MAIN = (HARNESS / "MainActivity.java").read_text(encoding="utf-8")


def _between(source: str, start: str, end: str) -> str:
    i = source.index(start)
    j = source.index(end, i + len(start))
    return source[i:j]


HEARTBEAT_BODY = _between(
    PPN,
    "private static void scheduleHeartbeat(Context ctx) {",
    "private static void cancelHeartbeat()",
)
SETTINGS_BODY = _between(
    MAIN,
    "private void showSettingsDialog() {",
    "private void showPermissionScreen()",
)


class Batch82N7HeartbeatSwitchTests(unittest.TestCase):
    """App 侧：新开关 + 排期闸门；既有心跳/总开关契约不得回退。"""

    def test_new_key_default_off(self) -> None:
        self.assertIn('public static final String KEY_HEARTBEAT = "promoted_capsule_heartbeat";', PPN)
        self.assertIn("public static boolean isHeartbeatEnabled(Context ctx) {", PPN)
        self.assertIn("return sp.getBoolean(KEY_HEARTBEAT, false);", PPN)

    def test_schedule_gated_before_post(self) -> None:
        self.assertIn("if (!isHeartbeatEnabled(ctx)) return;", HEARTBEAT_BODY)
        self.assertLess(
            HEARTBEAT_BODY.index("if (!isHeartbeatEnabled(ctx)) return;"),
            HEARTBEAT_BODY.index("h.postDelayed(heartbeat, HEARTBEAT_INTERVAL_MS);"),
            "续期开关闸门必须在排期之前（关着就一次都不排）",
        )
        # 闸门必须在「心跳 runnable 自身门控」之前：关掉开关时连排期都不发生
        self.assertLess(
            HEARTBEAT_BODY.index("if (!isHeartbeatEnabled(ctx)) return;"),
            HEARTBEAT_BODY.index("heartbeat = new Runnable() {"),
        )

    def test_interval_constant_and_master_switch_untouched(self) -> None:
        # 批次56-A 契约：间隔与依据写死
        self.assertIn("private static final long HEARTBEAT_INTERVAL_MS = 240000L;", PPN)
        self.assertIn("mCapsuleExpandDuration = 300000", PPN)
        # 总开关（默认开）与心跳开关是两个独立偏好，不得互相顶替
        self.assertIn('public static final String KEY_ENABLED = "promoted_live_update";', PPN)
        self.assertIn("sp.getBoolean(KEY_ENABLED, true)", PPN)
        self.assertNotIn("sp.getBoolean(KEY_HEARTBEAT, true)", PPN)

    def test_heartbeat_runnable_gates_kept(self) -> None:
        """心跳 runnable 自身的既有门控必须原样保留（批次56-A / 批次70 契约）。"""
        self.assertIn("if (!active) return;", HEARTBEAT_BODY)
        self.assertIn("if (Build.VERSION.SDK_INT < MIN_SDK) return;", HEARTBEAT_BODY)
        self.assertIn("if (!isEnabled(app)) return;", HEARTBEAT_BODY)
        self.assertIn("scheduleHeartbeat(app);", HEARTBEAT_BODY)
        self.assertIn('"heartbeat id=" + NOTIF_ID', HEARTBEAT_BODY)

    def test_public_publish_paths_untouched(self) -> None:
        """关闭心跳只停「续期」：start / update 仍会发布（否则等于把实况窗整个关掉）。"""
        update4 = _between(
            PPN,
            "public static void update(Context ctx, String text, int stepNumber, long elapsedSecs) {",
            "public static void finish(Context ctx, String text) {",
        )
        self.assertIn("if (shown) scheduleHeartbeat(ctx);", update4)
        self.assertLess(
            update4.index("boolean shown = post(ctx, title, text, total, total, shortLabel(elapsedSecs));"),
            update4.index("if (shown) scheduleHeartbeat(ctx);"),
            "update() 先发布再排期：关掉续期开关不影响这次发布本身",
        )


class Batch82N7SettingsRowTests(unittest.TestCase):
    """设置页：一行可点开关（翻转偏好 + 就地回读），且必须落在 showSettingsDialog 内。"""

    def test_row_text_and_toggle(self) -> None:
        self.assertIn('"胶囊续期 · 实况窗静默续期', MAIN)
        self.assertIn("PromotedProgressNotifier.isHeartbeatEnabled(this)", MAIN)
        self.assertIn("putBoolean(PromotedProgressNotifier.KEY_HEARTBEAT, on)", MAIN)
        self.assertIn("root.addView(capsuleHbRow, hblp);", MAIN)

    def test_row_lives_in_settings_dialog(self) -> None:
        self.assertIn('"胶囊续期 · 实况窗静默续期', SETTINGS_BODY)
        self.assertIn("putBoolean(PromotedProgressNotifier.KEY_HEARTBEAT, on)", SETTINGS_BODY)
        # 与批次82-N5 的指令库入口同页（都挂在 root 上）
        self.assertIn("root.addView(chipStudioEntry, cslp);", SETTINGS_BODY)

    def test_row_reads_writes_same_prefs_file(self) -> None:
        """MainActivity 的 PREFS 常量是 dsh_setup，本开关必须写 dsh_prefs（与 PPN 同源）。"""
        row = _between(MAIN, "// 批次82-N7：实况窗胶囊", "// 分隔线 + 底栏")
        self.assertIn('getSharedPreferences("dsh_prefs", MODE_PRIVATE)', row)
        self.assertNotIn('getSharedPreferences(PREFS, MODE_PRIVATE).edit()', row)


if __name__ == "__main__":
    unittest.main()
