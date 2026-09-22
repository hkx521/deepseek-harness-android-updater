#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次93 契约：入场起点口径（能不能从「灵动胶囊的位置」展开）+ 起点胶囊必须被填满。

用户 2026-09-22 追问：「为什么不能是从灵动胶囊的位置展开，这样不是更自然吗」。

真机结论（SN-HONOR-XXXX，探针 `flow_origin`，`.local/b91/{oriA*,oriB*}` 录屏与连拍）：
  ① **起点胶囊必须被材质填满**：材质若钉死在「静止屏幕位置」（cdy = -ty），起点窗口被抬起后
     与材质区不重叠 ⇒ 胶囊顶端 28px 是空的（实测顶端材质从 y≈168 才开始、顶边是平口不是圆头）。
     改成 cdy = 0（材质随窗口走）后顶端材质从 y≈140 开始 ⇒ 完整圆头胶囊。
  ② **状态栏那条带画不出来**：`flow_origin=1` 把形状摆到 y 31..136（系统胶囊 562×114px 所在带），
     那一带屏幕上看不到任何面板材质（差异低于噪声阈值），面板只有从 y≈136 往下可见 ⇒
     系统状态栏窗口在我们之上，App 浮动窗口画不进那条带。默认口径保持
     `FLOW_ORIGIN_BELOW_STATUS_BAR`（贴状态栏**下缘** = 系统胶囊正下方）。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
SRC = (HARNESS / 'OverlayService.java').read_text(encoding='utf-8')


def _between(src: str, start: str, end: str) -> str:
    i = src.index(start)
    j = src.index(end, i + len(start))
    return src[i:j]


class Batch93CapsuleOriginTests(unittest.TestCase):
    """① 材质随窗口走；② 起点口径常量与默认；③ 起点姿态与动效共用同一算法。"""

    def test_material_follows_window(self) -> None:
        draw = _between(SRC, 'public void draw(Canvas canvas) {', 'canvas.restoreToCount(save);')
        # cdy 必须为 0：否则「钉在静止屏幕位置」的材质会被 View 自身 bounds 裁掉，起点胶囊是空壳
        self.assertIn('cdy = 0f;', draw)
        self.assertNotIn('cdy = -squashTy;', draw)

    def test_start_origins_present_and_default_is_below_status_bar(self) -> None:
        self.assertIn('private static final int FLOW_ORIGIN_BELOW_STATUS_BAR = 0;', SRC)
        self.assertIn('private static final int FLOW_ORIGIN_CAPSULE_BAND = 1;', SRC)
        fn = _between(SRC, 'private float flowStartTranslateY() {', 'private void playFlowHangEnter() {')
        self.assertIn('(probeFlowOrigin >= 0 ? probeFlowOrigin : FLOW_ORIGIN_BELOW_STATUS_BAR)', fn)
        self.assertIn('? statusBarHeightPx() - dp(FLOW_START_H_DP)', fn)
        self.assertIn(': statusBarHeightPx();', fn)

    def test_capsule_band_documented_unusable(self) -> None:
        doc = _between(SRC, '起点口径：与系统灵动胶囊**同一条带**', 'private static final int FLOW_ORIGIN_CAPSULE_BAND = 1;')
        self.assertIn('实测不可用', doc)
        self.assertIn('画不进状态栏那条带', doc)

    def test_probe_extra_wired_through_activity(self) -> None:
        self.assertIn('intent.hasExtra("flow_origin")', SRC)
        self.assertIn('probe.putExtra("flow_origin", getIntent().getIntExtra("flow_origin", -1));',
                      (HARNESS / 'AssistActivity.java').read_text(encoding='utf-8'))

    def test_start_pose_and_animation_share_origin(self) -> None:
        pose = _between(SRC, 'private void applyFlowStartPose() {', 'private void cancelFlowAnimator() {')
        self.assertIn('final float ty = flowStartTranslateY();', pose)
        flow = _between(SRC, 'private void playFlowHangEnter() {', 'private void applyFlowStartPose() {')
        self.assertIn('final float startY = flowStartTranslateY();', flow)


if __name__ == '__main__':
    unittest.main()
