#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次91 契约：入场「流挂」缩扁态的生命周期必须自洽（批次90 的闸门否则形同虚设）。

真机根因（2026-09-21，SN-HONOR-XXXX）：
  - `openAssistantCapsule()` 里把缩扁态置 true，但下一帧 `playFlowHangEnter()` 第一句就是
    `cancelFlowAnimator()`；而批次90 在 `cancelFlowAnimator()` 里写了「打断 ⇒ 退出缩扁态」的
    `setEntranceSquashedOnBackground(false)` —— 于是缩扁态**在动效起跑前被清掉**，整段 540ms
    动效照旧把桌面快照压扁进细缝（用户报的「顶端阴影」）。
  - 运行时直证：动效第 3ms 仍打出 `[b83] AGSL refraction shader ready`（该日志只在背景分支
    真正绘制时触发）；动效帧顶端条带与「0.72 × 桌面」模型 MAE 34、corr 0.16（对不上平铺 tint）。

契约要点（防回退）：
  ① `playFlowHangEnter()` / `applyFlowSeepPose()` 里，置位 true 必须发生在 `cancelFlowAnimator()` **之后**；
  ② 服务侧持有真相源 `entranceSquashedActive`，`applyPanelGlass()` 重建 drawable 后必须按它复位；
  ③ `cancelFlowAnimator()` 仍保持「打断 ⇒ false」语义；
  ④ 折射 shader 预热存在且被调用（缩扁态不画背景 ⇒ 首编译不能被推到动效结束那一帧）。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
SRC = (HARNESS / 'OverlayService.java').read_text(encoding='utf-8')


def _between(src: str, start: str, end: str) -> str:
    i = src.index(start)
    j = src.index(end, i)
    return src[i:j]


class Batch91EntranceSquashLifecycleTests(unittest.TestCase):
    """① 置位顺序；② 真相源 + 重建复位；③ 打断语义；④ shader 预热。"""

    def test_play_flow_reasserts_squash_after_cancel(self) -> None:
        body = _between(SRC, 'private void playFlowHangEnter() {',
                        'final ValueAnimator anim = ValueAnimator.ofFloat(0f, 1f);')
        cancel_at = body.index('cancelFlowAnimator();')
        set_at = body.index('setEntranceSquashedOnBackground(true);')
        self.assertGreater(set_at, cancel_at,
                           'playFlowHangEnter 必须在 cancelFlowAnimator() 之后重新置位缩扁态')

    def test_seep_pose_reasserts_squash_after_cancel(self) -> None:
        body = _between(SRC, 'private void applyFlowStartPose() {',
                        'private void cancelFlowAnimator() {')
        cancel_at = body.index('cancelFlowAnimator();')
        set_at = body.index('setEntranceSquashedOnBackground(true);')
        self.assertGreater(set_at, cancel_at,
                           'applyFlowStartPose 摆的就是缩扁姿态，必须置位')

    def test_service_side_truth_source(self) -> None:
        self.assertIn('private boolean entranceSquashedActive = false;', SRC)
        helper = _between(SRC, 'private void setEntranceSquashedOnBackground(boolean squashed) {',
                          'public static void showTapHighlight')
        self.assertIn('entranceSquashedActive = squashed;', helper)

    def test_apply_panel_glass_restores_state_after_rebuild(self) -> None:
        body = _between(SRC, 'private void applyPanelGlass() {',
                        'private boolean retargetPanelGlassInPlace()')
        rebuild_at = body.index('panelView.setBackground(buildPanelGlass());')
        restore_at = body.index('setEntranceSquashedOnBackground(entranceSquashedActive);')
        self.assertGreater(restore_at, rebuild_at,
                           '重建 drawable 后必须按服务侧真相源复位缩扁态')

    def test_cancel_keeps_abort_semantics(self) -> None:
        cancel = _between(SRC, 'private void cancelFlowAnimator() {',
                          'private void restorePanelGlassAndLayout()')
        self.assertIn('setEntranceSquashedOnBackground(false);', cancel)

    def test_refraction_warmup_present_and_used(self) -> None:
        cls = _between(SRC, 'static final class PanelGlassDrawable extends Drawable {',
                       'static final class GlassRefractor')
        self.assertIn('void warmRefraction(int w, int h)', cls)
        self.assertIn('refractionShader(w, h);', cls)
        self.assertIn('private void warmPanelGlassRefraction()', SRC)
        play = _between(SRC, 'private void playFlowHangEnter() {',
                        'private void applyFlowStartPose() {')
        self.assertIn('warmPanelGlassRefraction();', play)
        glass = _between(SRC, 'private void applyPanelGlass() {',
                         'private boolean retargetPanelGlassInPlace()')
        self.assertIn('warmPanelGlassRefraction();', glass)


if __name__ == '__main__':
    unittest.main()
