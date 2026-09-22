#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次89 契约：呼出「顶端卡顿一下」根因修复 —— 入场动效期间换玻璃底必须**就地**更新。

真机根因（SN-HONOR-XXXX，2026-09-21，logcat 时间轴对齐 gfxinfo framestats）：
  19:10:36.391  refreshBackdrop started=true（主线程发起无障碍截屏）
  19:10:36.424  [b82n8] flow-hang enter …（540ms「流挂」开始）
  19:10:36.545  [b83] glass backdrop 1228x1739（后台线程裁剪完成，回主线程）
  19:10:36.547  [b83] AGSL refraction shader ready   ← **第二次编译**，落在动效第 123ms
  ⇒ applyPanelGlass() 走 `panelView.setBackground(buildPanelGlass())` 新建了 drawable，
     把绑在旧 drawable 上的 GlassRefractor/RuntimeShader 一起丢掉；新 drawable 首次绘制要
     重编译 AGSL + 重建 BitmapShader，实测该帧 UI 耗时 16~20ms（掉一帧），
     且 buildPanelGlass() 把圆角/棱边高光写回**静态终值**，打断了动效逐帧插值 ⇒ 顶端跳一下。

修复：动效在飞时改走 retargetPanelGlassInPlace()（复用同一 drawable ⇒ 复用已编译 shader），
且**不碰** cornerRadiusPx / strokeColor（那两个由 onAnimationUpdate 逐帧插值）。

契约要点（防回退）：
  ① 动效进行中（flowAnimator != null）换底不得新建 drawable；
  ② 就地更新路径必须复用现有 PanelGlassDrawable，且不得调用 setCornerRadius / setStroke；
  ③ 动效结束后（flowAnimator == null）仍走原来的整块重建路径；
  ④ 就地更新必须同步填充档与白雾光泽（否则会「先不透明后变玻璃」）。
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


def _code_only(fragment: str) -> str:
    """剥掉整行注释，避免断言命中注释里的文字（本轮就踩过一次）。"""
    return '\n'.join(l for l in fragment.splitlines() if not l.strip().startswith('//'))


class Batch89EntranceGlassRetargetTests(unittest.TestCase):
    """① applyPanelGlass 的分支：动效在飞 ⇒ 就地更新。"""

    def test_apply_panel_glass_guards_on_running_animator(self) -> None:
        fn = _between(SRC, 'private void applyPanelGlass() {', 'private boolean retargetPanelGlassInPlace() {')
        self.assertIn('if (flowAnimator != null && retargetPanelGlassInPlace()) {', fn)
        # 就地更新成功后必须早退，不能再 setBackground（否则等于没修）
        self.assertIn('panelView.invalidate();', fn)
        self.assertIn('return;', fn)
        # 原路径保留（动效结束后 / 不是自绘玻璃时）
        self.assertIn('panelView.setBackground(buildPanelGlass());', fn)

    def test_in_place_retarget_reuses_existing_drawable(self) -> None:
        fn = _between(SRC, 'private boolean retargetPanelGlassInPlace() {', '/** 批次83 探针：')
        code = _code_only(fn)
        self.assertIn('final Drawable bg = panelView.getBackground();', fn)
        self.assertIn('if (!(bg instanceof PanelGlassDrawable)) return false;', fn)
        self.assertIn('final PanelGlassDrawable g = (PanelGlassDrawable) bg;', fn)
        # 不得新建 drawable
        self.assertNotIn('new PanelGlassDrawable()', code)
        self.assertNotIn('buildPanelGlass()', code)
        self.assertIn('return true;', fn)

    def test_in_place_retarget_leaves_animated_properties_alone(self) -> None:
        """② 圆角 / 棱边高光由 onAnimationUpdate 逐帧插值，就地更新不得覆盖。"""
        fn = _between(SRC, 'private boolean retargetPanelGlassInPlace() {', '/** 批次83 探针：')
        code = _code_only(fn)
        self.assertNotIn('setCornerRadius(', code)
        self.assertNotIn('setStroke(', code)
        # 但背景位图与折射参数必须落下去（这是本次刷新的目的）
        self.assertIn('g.setBackdrop(', fn)
        self.assertIn('g.setRefraction(', fn)

    def test_in_place_retarget_syncs_fill_and_sheen(self) -> None:
        """④ 兜底档 ↔ 玻璃档要能双向切换，否则会「先不透明后变玻璃」。"""
        fn = _between(SRC, 'private boolean retargetPanelGlassInPlace() {', '/** 批次83 探针：')
        self.assertIn('GLASS_FALLBACK_TOP_NIGHT : GLASS_FALLBACK_TOP_DAY', fn)
        self.assertIn('GLASS_FILL_TOP_NIGHT : GLASS_FILL_TOP_DAY', fn)
        self.assertIn('g.setColors(top, bottom);', fn)
        self.assertIn('g.setSheen(glassy ?', fn)

    def test_static_builder_unchanged(self) -> None:
        """③ 静态路径（无动效）仍是唯一生成点，且值不变。"""
        fn = _between(SRC, 'private Drawable buildPanelGlass() {', 'static final class PanelGlassDrawable')
        self.assertIn('g.setCornerRadius(dp(FLOW_CORNER_FINAL_DP));', fn)
        self.assertIn('g.setStroke(GLASS_STROKE_WIDTH_PX, glassStrokeColor);', fn)
        self.assertIn('g.setBackdrop(glassy ? glassBackdrop : null, glassBackdropDx, glassBackdropDy,', fn)


if __name__ == '__main__':
    unittest.main()
