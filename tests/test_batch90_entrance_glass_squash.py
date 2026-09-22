#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次90 契约：入场「流挂」动效期间面板顶部不再出现「整张桌面压扁进细缝」的灰带。

真机根因（2026-09-21，SN-HONOR-XXXX，对照：
  - 修复前 .local/z.mp4：入场帧 panel 内容与「玻璃底快照按 panel scale 压扁」corr +0.69（强），与 1:1 桌面 corr +0.19（弱），
    即观察到的内容 = 整张桌面快照被 panelView 的 scaleX=0.318 / scaleY=0.017 压扁。
  - 修复后：动效期间 drawable 不画背景位图，只画 tint + 棱边（= 玻璃兜底档视觉），与「整张桌面压扁」解耦。

契约要点（防回退）：
  ① PanelGlassDrawable 必须有 entranceSquashed 字段与 setEntranceSquashed(boolean) setter；
  ② draw() 在 entranceSquashed=true 时跳过 AGSL 折射 shader 与 drawBitmap 两条分支；
  ③ 外部服务在「入场动效起跑」时调用 setEntranceSquashedOnBackground(true)、
    「动画结束 / 被取消」时调用 false；
  ④ 静态路径（无动效）仍走原来的完整 AGSL 渲染。
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


class Batch90EntranceGlassSquashTests(unittest.TestCase):
    """① 字段 + setter 必须存在；② draw() 在 squashed 时跳过背景；③ 服务侧设/清时机。"""

    def test_squashed_field_and_setter(self) -> None:
        cls = _between(SRC, 'static final class PanelGlassDrawable extends Drawable {',
                       'void setSpecular(int color)')
        self.assertIn('private boolean entranceSquashed', cls)
        self.assertIn('void setEntranceSquashed(boolean squashed) {', cls)
        self.assertIn('this.entranceSquashed = squashed;', cls)
        self.assertIn('invalidateSelf();', cls)

    def test_draw_skips_backdrop_when_squashed(self) -> None:
        draw = _between(SRC, 'public void draw(Canvas canvas) {', 'canvas.restoreToCount(save);')
        self.assertIn('// 批次90', draw)
        # 批次92：有形变姿态时改为「补偿后 1:1 画」，没有姿态（收起动效等未逐帧驱动路径）时仍跳过背景
        self.assertIn('final boolean drawBackdrop = !entranceSquashed || compensate;', draw)
        self.assertIn('if (drawBackdrop && backdrop != null', draw)

    def test_service_helper_present(self) -> None:
        body = _between(SRC, 'private void haptic()', 'public static void showTapHighlight')
        self.assertIn('private void setEntranceSquashedOnBackground(boolean squashed)', body)
        self.assertIn('g.setEntranceSquashed(squashed);', body)

    def test_service_calls_set_on_entrance_start(self) -> None:
        open_fn = _between(SRC, 'public void openAssistantCapsule() {',
                           'handler.postDelayed(panelShowWatchdog, 900L);')
        self.assertIn('setEntranceSquashedOnBackground(true);', open_fn)

    def test_service_clears_set_on_restore_and_cancel(self) -> None:
        restore = _between(SRC, 'private void restorePanelGlassAndLayout() {',
                            'private void setPanelGlassCorner(float radiusDp)')
        self.assertIn('setEntranceSquashedOnBackground(false);', restore)
        cancel = _between(SRC, 'private void cancelFlowAnimator() {',
                            'private void restorePanelGlassAndLayout()')
        self.assertIn('setEntranceSquashedOnBackground(false);', cancel)

    def test_static_path_unchanged(self) -> None:
        draw = _between(SRC, 'public void draw(Canvas canvas) {',
                        'if (gradient == null || gradientW != b.width() || gradientH != b.height())')
        self.assertIn('Shader sh = refractionShader(b.width(), b.height());', draw)
        self.assertIn('paint.setShader(sh);', draw)
        self.assertIn('canvas.drawRect(rect, paint);', draw)


if __name__ == '__main__':
    unittest.main()
