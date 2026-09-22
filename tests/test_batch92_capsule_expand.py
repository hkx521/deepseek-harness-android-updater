#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次92 契约：入场「胶囊展开」的**屏幕空间补偿**与形变姿态真相源。

用户原话：「现在没黑影了但是依然不好看，这个会不会是入场动画的问题，就没有那种很流畅的出场动画吗，
就像系统的灵动胶囊展开的样子，让小鲸鱼助手的出现不突兀，很顺滑，好好参考设计一下」。

真机实测参考（SN-HONOR-XXXX，`docs/批次92-*.md` §2，系统计时器灵动胶囊 → 点开）：
  胶囊 562×114 px（160.6×32.6 dp），点开后 400ms 内宽度 548→1246 px（钟形速度 = 缓入缓出）、
  高度跟随 114→270 px，末段过冲 ~3% 后回落到 1208×(263) px，总长约 700ms，圆角全程保持「屏幕上是圆的」。

契约要点（防回退）：
  ① drawable 必须有形变姿态（scaleX/scaleY/translationY）字段与 set/clear 接口；
  ② 有形变姿态时 draw() 必须：
       - 圆角按屏幕空间反解成本地两轴半径（`float[] { rx, ry, ... }` 交给 Path.addRoundRect）
         ⇒ 各向异性缩放不再把圆角压成椭圆 / 直角；
       - 材质先逆掉形变再画（`scale(1/csx, 1/csy)` + `translate(cdx, cdy)`，
         `cdx=(csx-1)*w/2`、`cdy=-ty`）⇒ 细缝里是**真正背后的桌面像素**（玻璃窗口），不是压扁的快照；
  ③ 服务侧持有 (sx, sy, ty) 真相源，drawable 被 applyPanelGlass() 重建后能立刻复位；
  ④ 姿态在动效结束 / 被打断时清掉（`setEntranceSquashedOnBackground(false)` ⇒ clearSquashPose）。
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


class Batch92CapsuleExpandTests(unittest.TestCase):
    """① 姿态字段；② draw() 的补偿；③ 服务侧真相源；④ 生命周期。"""

    def test_drawable_has_squash_pose(self) -> None:
        cls = _between(SRC, 'static final class PanelGlassDrawable extends Drawable {',
                       'static final class GlassRefractor')
        self.assertIn('private boolean squashPoseValid', cls)
        self.assertIn('private float squashSx = 1f, squashSy = 1f, squashTy = 0f;', cls)
        self.assertIn('void setSquashPose(float sx, float sy, float ty) {', cls)
        self.assertIn('void clearSquashPose() {', cls)
        self.assertIn('boolean hasSquashPose()', cls)

    def test_draw_compensates_corner_radius_two_axes(self) -> None:
        draw = _between(SRC, 'public void draw(Canvas canvas) {', 'canvas.restoreToCount(save);')
        # 屏幕空间半径 → 本地两轴半径
        self.assertIn('final float rScreen = Math.min(cornerRadiusPx,', draw)
        self.assertIn('Math.min(b.width() * csx, b.height() * csy) / 2f);', draw)
        self.assertIn('rx = rScreen / csx;', draw)
        self.assertIn('ry = rScreen / csy;', draw)
        self.assertIn('clip.addRoundRect(rect, new float[] { rx, ry, rx, ry, rx, ry, rx, ry },', draw)

    def test_draw_compensates_material_placement(self) -> None:
        draw = _between(SRC, 'public void draw(Canvas canvas) {', 'canvas.restoreToCount(save);')
        self.assertIn('final boolean compensate = entranceSquashed && squashPoseValid', draw)
        self.assertIn('cdx = (csx - 1f) * b.width() / 2f;', draw)
        # 批次93：cdy 必须为 0（材质随窗口走）——View 自身 bounds 会裁掉「钉在静止位置」的材质，
        # 那样起点胶囊落在状态栏那条带里时窗口内什么都没有（真机实测全空）。
        self.assertIn('cdy = 0f;', draw)
        self.assertIn('canvas.scale(1f / csx, 1f / csy);', draw)
        self.assertIn('canvas.translate(cdx, cdy);', draw)
        # 有补偿时仍画背景位图（1:1 落位）；没有姿态时才跳过（收起动效等未逐帧驱动的路径）
        self.assertIn('final boolean drawBackdrop = !entranceSquashed || compensate;', draw)

    def test_service_side_pose_truth_source(self) -> None:
        self.assertIn('private float squashSxActive = 1f, squashSyActive = 1f, squashTyActive = 0f;', SRC)
        helper = _between(SRC, 'private void applySquashPoseToBackground() {',
                          'private void setPanelSquashPose(float sx, float sy, float ty)')
        self.assertIn('.setSquashPose(squashSxActive, squashSyActive, squashTyActive);', helper)
        setter = _between(SRC, 'private void setPanelSquashPose(float sx, float sy, float ty) {',
                          'public static void showTapHighlight')
        self.assertIn('squashSxActive = sx;', setter)
        self.assertIn('applySquashPoseToBackground();', setter)

    def test_pose_cleared_on_anim_end(self) -> None:
        helper = _between(SRC, 'private void setEntranceSquashedOnBackground(boolean squashed) {',
                          'private void applySquashPoseToBackground() {')
        self.assertIn('if (!squashed) g.clearSquashPose();', helper)

    def test_animation_pushes_pose_every_frame(self) -> None:
        flow = _between(SRC, 'private void playFlowHangEnter() {', 'private void cancelFlowAnimator() {')
        self.assertIn('setPanelSquashPose(startX, startYScale, startY);', flow)   # 初值
        self.assertIn('setPanelSquashPose(sx, sy, ty);', flow)                   # 逐帧


if __name__ == '__main__':
    unittest.main()
