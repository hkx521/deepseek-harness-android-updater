#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""助手面板入场动效契约：批次82-N8「三段式流挂」→ **批次92 重做为「胶囊展开」**（本文件已同步当前实现）。

批次82-N8 引入三段式「流挂」（出液/垂落/定形，540ms）。用户 2026-09-22 反馈「没有那种很流畅的出场动画，
就像系统的灵动胶囊展开的样子」⇒ 批次92 按**本机系统灵动胶囊展开的实测曲线**重做（`docs/批次92-*.md` §2）：

    ① 铺开（0 → 180ms）   起点胶囊圆头 152dp × 30dp（对齐系统胶囊 160.6dp × 32.6dp），横向铺到卡片全宽
    ② 垂落（180 → 520ms） 高度缓入缓出长到满高（速度呈钟形，对齐系统实测），内容 200 → 480ms 渐显 + 16dp 上浮
    ③ 定形（520 → 660ms） 1.2% 过冲收回 1.0、棱边高光闪一次；总 660ms（系统实测展开 ~700ms）

契约要点（防回退）：
  ① 参数全部外置成 FLOW_* 常量（真机逐轮微调不改结构）；
  ② 总时长 **必须**小于入场看门狗 900ms，否则动画会被看门狗硬复位；
  ③ 形变原点 = 面板顶部中心 + translationY 抬到「状态栏（挖孔）下缘」的屏幕坐标；
  ④ 动效改过面板玻璃底（圆角 / 棱边描边 alpha），结束必须精确还原成静态值；
  ⑤ 收起 / 重开时先取消未跑完的流挂动画，避免两套动画抢同一批 View 属性。
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
SRC = (HARNESS / "OverlayService.java").read_text(encoding="utf-8")


def _const(name: str) -> int:
    m = re.search(r"private static final (?:int|long) %s = (\d+)L?;" % re.escape(name), SRC)
    assert m, "找不到常量 " + name
    return int(m.group(1))


def _const_float(name: str) -> float:
    m = re.search(r"private static final float %s = ([\d.]+)f;" % re.escape(name), SRC)
    assert m, "找不到浮点常量 " + name
    return float(m.group(1))


def _between(source: str, start: str, end: str) -> str:
    i = source.index(start)
    j = source.index(end, i + len(start))
    return source[i:j]


FLOW = _between(SRC, "private void playFlowHangEnter() {", "private void cancelFlowAnimator() {")
CANCEL = _between(SRC, "private void cancelFlowAnimator() {", "private void restorePanelGlassAndLayout() {")
RESTORE = _between(SRC, "private void restorePanelGlassAndLayout() {", "private void setPanelGlassCorner(float radiusDp) {")
PANEL_VISIBLE = _between(SRC, "private void setPanelVisible(boolean show) {",
                         "public static void setOverlayVisible(boolean show) {")


class Batch82N8FlowHangParamsTests(unittest.TestCase):
    """① 参数外置 + 三段时长闭合（批次92 起：宽度段 + 高度段 + 定形段）。"""

    def test_stage_durations_sum_to_total(self) -> None:
        w, h, total = _const("FLOW_W_MS"), _const("FLOW_H_MS"), _const("FLOW_TOTAL_MS")
        self.assertEqual((w, h, total), (180, 520, 660))
        self.assertLess(w, h)          # 宽度先到位（系统实测：宽度领跑高度）
        self.assertLess(h, total)      # 高度到位后还有定形回落段

    def test_total_shorter_than_show_watchdog(self) -> None:
        """② 总时长必须小于看门狗 900ms（否则动画中途被硬复位）。"""
        self.assertIn("handler.postDelayed(panelShowWatchdog, 900L);", SRC)
        self.assertLess(_const("FLOW_TOTAL_MS"), 900)

    def test_geometry_matches_plan(self) -> None:
        # 批次92：起点 = 系统胶囊量级（本机实测系统胶囊 160.6dp × 32.6dp）
        self.assertEqual(_const("FLOW_START_W_DP"), 152)
        self.assertEqual(_const("FLOW_START_H_DP"), 30)
        # 批次93：起点位移改为按口径计算（贴状态栏下缘 / 与系统胶囊同带），不再是固定 -8dp
        self.assertIn("private float flowStartTranslateY() {", SRC)
        self.assertEqual(_const("FLOW_ORIGIN_BELOW_STATUS_BAR"), 0)
        self.assertEqual(_const("FLOW_ORIGIN_CAPSULE_BAND"), 1)
        self.assertIn("statusBarHeightPx() - dp(FLOW_START_H_DP)", SRC)

    def test_corner_and_content_params(self) -> None:
        self.assertEqual(_const("FLOW_CORNER_FINAL_DP"), 26)  # 与静态玻璃底 dp(26) 一致
        # 批次83：静态玻璃底由 buildPanelGlass() 生成，圆角取同一常量（值仍是 26dp）
        self.assertIn("g.setCornerRadius(dp(FLOW_CORNER_FINAL_DP));", SRC)
        # 批次92：内容 200→480ms 渐显，并从 +16dp 上浮到位
        self.assertEqual(_const("FLOW_CONTENT_DELAY_MS"), 200)
        self.assertEqual(_const("FLOW_CONTENT_FADE_MS"), 280)
        self.assertEqual(_const("FLOW_CONTENT_RISE_DP"), 16)
        self.assertIn("setPanelChildrenRise(", FLOW)

    def test_first_frame_is_already_visible(self) -> None:
        """批次83/92：起点姿态必须同步压上，第一帧就是可见的胶囊圆头（不再是 8dp 细缝）。"""
        self.assertAlmostEqual(_const_float("FLOW_START_ALPHA"), 0.94, places=3)
        self.assertIn("private void applyFlowStartPose() {", SRC)
        self.assertIn("panelView.setAlpha(FLOW_START_ALPHA);", SRC)
        self.assertIn("applyFlowStartPose();", SRC)   # openAssistantCapsule 同步压初值
        self.assertIn("alpha = lerp(FLOW_START_ALPHA, 1f, u);", FLOW)
        self.assertNotIn("alpha = 0.92f * u;", FLOW)

    def test_ime_delayed_to_end_of_spread_stage(self) -> None:
        # 批次83 第三版：IME 必须在「动效结束 + 取焦之后」——窗口还没获焦时 showSoftInput 会静默失败
        self.assertIn("private static final long FLOW_FOCUS_DELAY_MS = FLOW_TOTAL_MS + 80L;", SRC)
        self.assertIn("private static final long FLOW_IME_DELAY_MS = FLOW_FOCUS_DELAY_MS + 100L;", SRC)
        self.assertIn("}, FLOW_IME_DELAY_MS);", SRC)
        # 旧值 260ms（内容未成形就弹键盘）不得回退
        self.assertNotIn("}, 260L);", SRC)


class Batch82N8FlowHangImplementationTests(unittest.TestCase):
    """③④⑤ 实现：分段驱动、原点、还原、取消、两条入场路径共用。"""

    def test_master_timeline_is_linear_and_piecewise(self) -> None:
        self.assertIn("anim.setInterpolator(new LinearInterpolator());", FLOW)
        self.assertIn("long t = (long) (a.getAnimatedFraction() * FLOW_TOTAL_MS);", FLOW)
        self.assertIn("if (t < FLOW_W_MS) {", FLOW)
        self.assertIn("} else if (t < FLOW_H_MS) {", FLOW)
        # 缓动曲线也外置（批次92：铺开 emphasized-decelerate、垂落缓入缓出）
        self.assertIn("new PathInterpolator(FLOW_EASE_W_X1, FLOW_EASE_W_Y1,", FLOW)
        self.assertIn("new PathInterpolator(FLOW_EASE_H_X1, FLOW_EASE_H_Y1,", FLOW)

    def test_origin_is_cutout_bottom_center(self) -> None:
        self.assertIn("panelView.setPivotX(panelW / 2f);", FLOW)
        self.assertIn("panelView.setPivotY(0f);", FLOW)
        # 批次83/92：起点用**静态几何**（卡片静态顶边 = 状态栏高度 + 8dp topMargin ⇒ 起点恒 -8dp）。
        # 原来用 getLocationOnScreen，会被上一次收起的 scale/translationY 污染（实测起点偏移）。
        self.assertIn("final float startY = flowStartTranslateY();", FLOW)
        self.assertIn("final float baseTop = statusBarHeightPx() + dp(8);", FLOW)
        self.assertNotIn("int[] loc = new int[2];", FLOW)   # 不再做屏幕坐标查询（注释里提到不算）

    def test_children_fade_delayed(self) -> None:
        self.assertIn("float cu = clamp01((t - FLOW_CONTENT_DELAY_MS)", FLOW)
        self.assertIn("setPanelChildrenAlpha(cu);", FLOW)
        self.assertIn("setPanelChildrenAlpha(0f);", FLOW)

    def test_settle_edge_highlight(self) -> None:
        # 批次83：出液/垂落期棱边保持更亮（0.85），定形期抬到 1.0 —— 黑底上液滴靠高光才看得见
        self.assertAlmostEqual(_const_float("FLOW_EDGE_BASE"), 0.85, places=3)
        self.assertIn("setPanelEdgeHighlight(FLOW_EDGE_BASE + (1f - FLOW_EDGE_BASE) * u);", FLOW)
        self.assertIn("setPanelEdgeHighlight(FLOW_EDGE_BASE);", FLOW)
        self.assertIn("private void setPanelEdgeHighlight(float factor) {", SRC)
        self.assertIn("(a << 24) | (base & 0x00FFFFFF)", SRC)

    def test_restore_exact_static_glass(self) -> None:
        """④ 动效改过的圆角与棱边描边必须还原成构建期的静态值。"""
        self.assertIn("g.setCornerRadius(dp(FLOW_CORNER_FINAL_DP));", RESTORE)
        self.assertIn("g.setStroke(GLASS_STROKE_WIDTH_PX, glassStrokeColor);", RESTORE)
        # 批次83 第三版：动效期间压掉静态阴影（49px 阴影跟着圆角每帧重算是掉帧来源之一），结束时还原
        self.assertIn("panelView.setElevation(0f);", FLOW)
        self.assertIn("panelView.setElevation(dp(PANEL_ELEVATION_DP));", RESTORE)
        # 批次83：棱边基色改中性白令牌（批次82-N8 只负责按 alpha 缩放它的基色，语义不变）
        self.assertIn("private int glassStrokeColor = GLASS_STROKE_DAY;", SRC)
        self.assertIn("glassStrokeColor = nightMode() ? GLASS_STROKE_NIGHT : GLASS_STROKE_DAY;", SRC)
        self.assertIn("panelView.setAlpha(1f);", RESTORE)
        self.assertIn("setPanelChildrenAlpha(1f);", RESTORE)
        self.assertIn("setPanelChildrenRise(0f);", RESTORE)   # 批次92：内容上浮也要复位

    def test_cancel_on_hide_and_reopen(self) -> None:
        """⑤ 收起 / 重开先取消流挂（否则两套动画抢 View 属性）。"""
        self.assertIn("cancelFlowAnimator();", FLOW)   # 重开时先取消上一轮未跑完的流挂
        self.assertIn("a.removeAllUpdateListeners();", CANCEL)
        self.assertIn(
            "cancelFlowAnimator(); // 批次82-N8：先停「流挂」再硬复位，避免两套动画抢 View 属性",
            PANEL_VISIBLE,
        )
        self.assertIn(
            "cancelFlowAnimator(); // 批次82-N8：先停未跑完的「流挂」，收起动画才能接管",
            PANEL_VISIBLE,
        )

    def test_both_entrances_share_one_implementation(self) -> None:
        self.assertEqual(SRC.count("playFlowHangEnter();"), 2)          # 呼出 + 任务完成后自动展开
        self.assertIn("public void openAssistantCapsule() {", SRC)
        self.assertIn("private void autoExpandAfterTask() {", SRC)
        auto = _between(SRC, "private void autoExpandAfterTask() {", "private static int parseStepNumber(String text) {")
        self.assertIn("playFlowHangEnter();", auto)
        self.assertIn("setPanelVisible(true);", auto)

    def test_failure_is_swallowed_and_logged(self) -> None:
        self.assertIn('Log.w(TAG, "[b92] capsule expand failed", t);', SRC)
        self.assertIn('[b92] capsule expand: w=', SRC)


if __name__ == "__main__":
    unittest.main()
