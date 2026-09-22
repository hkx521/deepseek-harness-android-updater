#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次83 契约：助手面板「液态玻璃」材质（自绘玻璃 + 系统令牌 + 降级）。

设计依据：`docs/批次83-液态玻璃材质统一方案.md`（本机三通路取证 + 第三方浮窗真模糊装机实测 + 追加取证）。

契约要点（防回退）：
  ① 面板玻璃底只有一个生成点 `buildPanelGlass()`，返回自绘 `PanelGlassDrawable`：
     圆角裁剪 → 背景位图 → 中性 tint → 1dp 白棱边；拿不到背景图时自动用 95% 兜底档；
  ② **禁止回退到窗口级 `FLAG_BLUR_BEHIND` / `setBlurBehindRadius`**：本机真机实测 Honor 的 Dim 层
     覆盖整个显示（`Dim Layer for - Display 0 bounds={0,0,2808,1256}`），开窗口模糊会把整屏背景
     一起糊掉、也会糊掉无障碍截屏内容 —— 所以材质必须客户端自绘，作用范围 = 卡片圆角；
  ③ 背景位图只在**面板未显示**时采样（显示中截图会把自己拍进背景），采样=截屏→裁卡片矩形→缩小 1/6→三次盒式模糊；
  ④ 棱边与 tint 用中性令牌（白棱边 + 白/黑半透），不得回退到批次50 的蓝调硬编码；
  ⑤ 与批次82-N8 动效对接：`setCornerRadius` / `setStroke` 仍由动效逐帧改，结束精确还原。
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
SRC = (HARNESS / 'OverlayService.java').read_text(encoding='utf-8')


def _const_hex(name: str) -> int:
    m = re.search(r'private static final int %s = 0x([0-9A-Fa-f]+);' % re.escape(name), SRC)
    assert m, '找不到常量 ' + name
    return int(m.group(1), 16)


def _const_int(name: str) -> int:
    m = re.search(r'private static final int %s = (\d+);' % re.escape(name), SRC)
    assert m, '找不到常量 ' + name
    return int(m.group(1))


def _const_int_ms(name: str) -> int:
    m = re.search(r'private static final long %s = (\d+)L;' % re.escape(name), SRC)
    assert m, '找不到长整型常量 ' + name
    return int(m.group(1))


def _const_float2(name: str) -> float:
    m = re.search(r'private static final float %s = ([\d.]+)f;' % re.escape(name), SRC)
    assert m, '找不到浮点常量 ' + name
    return float(m.group(1))

def _between(source: str, start: str, end: str) -> str:
    i = source.index(start)
    j = source.index(end, i + len(start))
    return source[i:j]


GLASS = None


class Batch83GlassTokenTests(unittest.TestCase):
    """① 令牌：数值与来源（对齐 Honor 系统玻璃，见方案 §4）。"""

    def test_blur_radius_and_downscale(self) -> None:
        # 第五版：0 = 完全不模糊 + 1 = 不缩放（用户定稿「液态玻璃像透明水滴做的玻璃，没有模糊没有磨砂」）
        # 第六版：改为**酷安 dex 实测值** 2dp（@560dpi = 7px）；仍不缩放（缩放的盒式平均=额外模糊）
        self.assertEqual(_const_int('GLASS_BLUR_RADIUS_PX'), 7)
        self.assertEqual(_const_int('GLASS_BACKDROP_DOWNSCALE'), 1)
        crop_fn = _between(SRC, 'private Bitmap makeGlassBackdrop(Bitmap screen) {', 'private static void boxBlur(')
        self.assertIn('if (GLASS_BLUR_RADIUS_PX > 0) {', crop_fn)
        self.assertIn('if (GLASS_BACKDROP_DOWNSCALE <= 1) {', crop_fn)

    def test_glass_and_fallback_fills(self) -> None:
        # 第七版：容器不再平铺白。真机量测（White 0.30 = 卡内 +35、饱和度 0.187→0.150）就是「磨砂白」的根因，
        # 上游 demo 控制中心容器是 `Color.Black.copy(0.05f)` —— 白由棱边高光给，不由容器给。
        # 酷安 surfaceColor 的运行期真值：暗色 Black 0.28 / 亮色 White 0.6（CoolapkTheme 覆盖预设的 0.30/0.50）
        self.assertEqual(_const_hex('GLASS_FILL_TOP_DAY'), 0x99FFFFFF)
        self.assertEqual(_const_hex('GLASS_FILL_BOTTOM_DAY'), 0x99FFFFFF)
        self.assertEqual(_const_hex('GLASS_FILL_TOP_NIGHT'), 0x47000000)
        self.assertEqual(_const_hex('GLASS_FILL_BOTTOM_NIGHT'), 0x47000000)
        # 暗色档必须是「黑 N%」而不是「白 N%」——白 0.30 正是用户说的「磨砂白」
        for name in ('GLASS_FILL_TOP_NIGHT', 'GLASS_FILL_BOTTOM_NIGHT'):
            self.assertEqual(_const_hex(name) & 0x00FFFFFF, 0x000000, name + ' 必须是黑，不是白')
        self.assertEqual(_const_hex('GLASS_FILL_TOP_NIGHT') >> 24, 0x47, '黑 0.28 = 0x47')
        for name in ('GLASS_FILL_TOP_DAY', 'GLASS_FILL_BOTTOM_DAY'):
            self.assertEqual(_const_hex(name) & 0x00FFFFFF, 0xFFFFFF, name + ' 亮色档是 White 0.6')
        # 第五版那层「斜向整面反光」在第六版关掉（改由 shader 的方向性棱边高光承担）
        self.assertEqual(_const_hex('GLASS_SPEC_NIGHT'), 0x00000000)
        self.assertEqual(_const_hex('GLASS_SPEC_DAY'), 0x00000000)
        self.assertIn('void setSpecular(int color)', SRC)
        self.assertIn('g.setSpecular(night ? GLASS_SPEC_NIGHT : GLASS_SPEC_DAY);', SRC)
        # night 玻璃档必须比批次83 第一版（0xCC=80%）更透 —— 用户明确反馈「太黑」
        self.assertLess(_const_hex('GLASS_FILL_TOP_NIGHT') >> 24, 0xCC)
        self.assertLess(_const_hex('GLASS_FILL_BOTTOM_NIGHT') >> 24, 0xB8)
        # 兜底档（拿不到背景图）：≥0xE0，保证文字可读
        for name in ('GLASS_FALLBACK_TOP_DAY', 'GLASS_FALLBACK_BOTTOM_DAY',
                     'GLASS_FALLBACK_TOP_NIGHT', 'GLASS_FALLBACK_BOTTOM_NIGHT'):
            self.assertGreaterEqual(_const_hex(name) >> 24, 0xE0, name + ' 兜底档 alpha 必须 ≥ 0xE0')
        # 夜档兜底也要是浅色（白玻璃的一致降级，不许悄悄变回深色板）
        self.assertGreaterEqual((_const_hex('GLASS_FALLBACK_TOP_NIGHT') >> 16) & 0xFF, 0xE0)

    def test_stroke_is_neutral_white_not_brand_blue(self) -> None:
        # 第六版：均匀描边整体关掉（上游只有「方向性高光」，没有实心棱边）
        self.assertEqual(_const_hex('GLASS_STROKE_DAY'), 0x00FFFFFF)
        self.assertEqual(_const_hex('GLASS_STROKE_NIGHT'), 0x00FFFFFF)
        self.assertEqual(_const_int('GLASS_STROKE_WIDTH_PX'), 2)
        self.assertNotIn('0x8FB8FF', SRC)


class Batch83NoWindowBlurTests(unittest.TestCase):
    """② 硬约束：不得用窗口级模糊（Honor Dim 层 = 整屏，见文件头 ②）。"""

    def test_window_blur_api_absent(self) -> None:
        self.assertNotIn('FLAG_BLUR_BEHIND', SRC.replace('{@code FLAG_BLUR_BEHIND}', ''))
        self.assertNotIn('setBlurBehindRadius', SRC)
        self.assertNotIn('addCrossWindowBlurEnabledListener', SRC)


class Batch83PanelMaterialTests(unittest.TestCase):
    """③ 材质：唯一生成点 + 两档 + 自绘 drawable 契约。"""

    def test_single_glass_builder_with_two_tiers(self) -> None:
        glass = _between(SRC, 'private Drawable buildPanelGlass() {', 'static final class PanelGlassDrawable')
        self.assertIn('boolean glassy = glassBackdrop != null && probeBackdrop != 0;', glass)
        self.assertIn('GLASS_FILL_TOP_NIGHT : GLASS_FILL_TOP_DAY', glass)
        self.assertIn('GLASS_FALLBACK_TOP_NIGHT : GLASS_FALLBACK_TOP_DAY', glass)
        self.assertIn('g.setCornerRadius(dp(FLOW_CORNER_FINAL_DP));', glass)
        self.assertIn('g.setStroke(GLASS_STROKE_WIDTH_PX, glassStrokeColor);', glass)
        self.assertIn('g.setBackdrop(glassy ? glassBackdrop : null, glassBackdropDx, glassBackdropDy,', glass)
        self.assertIn('g.setRefraction(glassy && probeRefract != 0,', glass)

    def test_drawable_contract(self) -> None:
        d = _between(SRC, 'static final class PanelGlassDrawable extends Drawable {', 'private Rect panelScreenRect()')
        self.assertIn('clip.addRoundRect(rect, cornerRadiusPx, cornerRadiusPx, Path.Direction.CW);', d)
        self.assertIn('canvas.drawBitmap(backdrop, null, rect, paint);', d)
        # 白雾光泽（液感）：第二层渐变，顶边 → 45% 高度处透明
        self.assertIn('void setSheen(int color)', d)
        self.assertIn('b.top + b.height() * 0.45f', d)
        self.assertIn('g.setSheen(glassy ?', SRC)
        self.assertIn('outline.setRoundRect(b.left, b.top, b.right, b.bottom, cornerRadiusPx);', d)
        self.assertIn('void setCornerRadius(float radiusPx)', d)
        self.assertIn('void setStroke(int widthPx, int color)', d)
        self.assertIn('return PixelFormat.TRANSLUCENT;', d)
        # clipToOutline 依赖 getOutline 提供圆角，二者必须同时存在
        self.assertIn('panelView.setClipToOutline(true);', SRC)

    def test_old_blue_glass_fill_removed(self) -> None:
        for legacy in ('0xE61A2233', '0xD90F1522', '0xE6F5F8FE', '0xD9E8EDF8'):
            self.assertNotIn(legacy, SRC, '批次50 蓝调玻璃底不得回退：' + legacy)


class Batch83BackdropTests(unittest.TestCase):
    """④ 背景采样：只在面板不可见时、按卡片矩形裁、缩放 + 盒式模糊、并发护栏。"""

    def test_capture_only_when_panel_hidden(self) -> None:
        open_fn = _between(SRC, 'public void openAssistantCapsule() {', 'if (commandInput != null)')
        self.assertIn('if (!panelVisible) refreshGlassBackdrop();', open_fn)
        hide_fn = _between(SRC, 'handler.postDelayed(new Runnable() {', '}, 270L);')
        self.assertIn('refreshGlassBackdrop();', hide_fn)
        refresh = _between(SRC, 'private void refreshGlassBackdrop() {', 'private Bitmap makeGlassBackdrop(')
        self.assertIn('if (glassBackdropPending || destroyed || probeBackdrop == 0 || rect == null) {', refresh)
        # 批次83：截图回调跑在**后台线程**（glassExecutor）——解码/裁剪/模糊放主线程会吃掉一帧
        self.assertIn('AccessibilityService.captureScreen(glassExecutor,', refresh)

    def test_crop_scale_and_blur(self) -> None:
        crop_fn = _between(SRC, 'private Bitmap makeGlassBackdrop(Bitmap screen) {', 'private static void boxBlur(')
        # 第四版：采样矩形 = 卡片矩形外扩一个折射环带（棱边折射要往卡片外采样）
        self.assertIn('final Rect want = panelSampleRect();', crop_fn)
        self.assertIn('final Rect card = panelScreenRect();', crop_fn)
        self.assertIn('glassBackdropDx = sx - card.left;', crop_fn)
        self.assertIn('Bitmap.createBitmap(screen, sx, sy, sw, sh);', crop_fn)
        self.assertIn('Bitmap.createScaledBitmap(crop, tw, th, true);', crop_fn)
        # 第五版：模糊与缩放都可关（0 / 1），关掉时改成条件调用
        self.assertIn('boxBlur(small, Math.max(1, Math.round(GLASS_BLUR_RADIUS_PX / (float) Math.max(1, GLASS_BACKDROP_DOWNSCALE))), 3);', crop_fn)
        self.assertIn('private static void boxBlurH(', SRC)
        self.assertIn('private static void boxBlurV(', SRC)

    def test_panel_screen_rect_uses_location_on_screen(self) -> None:
        rect_fn = _between(SRC, 'private Rect panelScreenRect() {', 'private void refreshGlassBackdrop() {')
        # 采样发生在呼出瞬间（上一次收起的 scale/translation 还没复位）—— getLocationOnScreen 会给出
        # 偏移坐标（真机实测拿到 Rect(468,38-1612,1464)），所以只能用静态几何。
        self.assertNotIn('new int[2]', rect_fn)   # 不再做任何屏幕坐标查询（注释里提到不算）
        self.assertIn('final int top = statusBarHeightPx() + dp(8);', rect_fn)
        self.assertIn('final int left = (dm.widthPixels - w) / 2;', rect_fn)


class Batch83DegradeTests(unittest.TestCase):
    """⑤ 降级 + 探针 + N8 对接。"""

    def test_apply_panel_glass_rebuilds_background(self) -> None:
        apply_fn = _between(SRC, 'private void applyPanelGlass() {', 'private void applyGlassProbe() {')
        self.assertIn('panelView.setBackground(buildPanelGlass());', apply_fn)

    def test_n8_animation_talks_to_new_drawable(self) -> None:
        self.assertNotIn('instanceof GradientDrawable) return;', SRC)
        self.assertIn('if (panelView.getBackground() instanceof PanelGlassDrawable) {', SRC)
        self.assertGreaterEqual(SRC.count('PanelGlassDrawable) panelView.getBackground()'), 3)

    def test_probe_defaults_to_no_intervention(self) -> None:
        self.assertIn('private int probeBackdrop = -1;', SRC)
        self.assertIn('probeBackdrop = intent.getIntExtra("glass_backdrop", -1);', SRC)


class Batch83EntranceFlowTests(unittest.TestCase):
    """⑥ 第三版：玻璃底新鲜度 + 入场「行云流水」（真机取证见方案 §12）。"""

    def test_backdrop_ttl_is_short_enough_to_stay_fresh(self) -> None:
        # 真机 A/B 实测：白色页 vs 深色桌面两次渲染同为 86 ⇒ t≈0，60s TTL 让玻璃底一直显示旧画面
        self.assertLessEqual(_const_int_ms('GLASS_BACKDROP_TTL_MS'), 2000)
        self.assertGreaterEqual(_const_int_ms('GLASS_BACKDROP_TTL_MS'), 500)
        refresh = _between(SRC, 'private void refreshGlassBackdrop() {', 'private Bitmap makeGlassBackdrop(')
        self.assertIn('System.currentTimeMillis() - glassBackdropAt < GLASS_BACKDROP_TTL_MS', refresh)

    def test_open_path_does_not_relayout_synchronously(self) -> None:
        # 呼出首帧的那次同步 updateViewLayout（含取焦 + ADJUST_RESIZE 尺寸复核）= 「顿一下」主因
        panel_visible = _between(SRC, 'private void setPanelVisible(boolean show) {',
                                 'public static void setOverlayVisible')
        self.assertNotIn('lp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;', panel_visible)
        self.assertIn('handler.postDelayed(acquireFocusRunnable, FLOW_FOCUS_DELAY_MS);', panel_visible)
        self.assertIn('private final Runnable acquireFocusRunnable = new Runnable() {', SRC)
        self.assertIn('setOverlayWindowFocusable(true);', _between(
            SRC, 'private final Runnable acquireFocusRunnable = new Runnable() {',
            'private void setPanelVisible(boolean show) {'))
        # 显式放弃焦点（autoExpandAfterTask）必须取消待执行的取焦
        focus_fn = _between(SRC, 'private void setOverlayWindowFocusable(boolean focusable) {',
                            'private final Runnable acquireFocusRunnable =')
        self.assertIn('if (!focusable) handler.removeCallbacks(acquireFocusRunnable);', focus_fn)

    def test_ime_after_focus(self) -> None:
        # 取焦延后 ⇒ 弹键盘也必须排在取焦之后（窗口不可获焦时 showSoftInput 静默失败）
        self.assertIn('private static final long FLOW_FOCUS_DELAY_MS = FLOW_TOTAL_MS + 80L;', SRC)
        self.assertIn('private static final long FLOW_IME_DELAY_MS = FLOW_FOCUS_DELAY_MS + 100L;', SRC)

    def test_per_frame_stroke_updates_are_debounced(self) -> None:
        # 出液/垂落期棱边系数恒为 FLOW_EDGE_BASE，原实现每帧重建 Stroke + invalidateSelf
        self.assertIn('private float edgeHighlightApplied = -1f;', SRC)
        self.assertIn('if (edgeHighlightApplied >= 0f && Math.abs(factor - edgeHighlightApplied) < 0.02f) return;', SRC)
        self.assertIn('edgeHighlightApplied = factor;', SRC)

    def test_panel_draw_warm_up_wired(self) -> None:
        # 首次绘制要 shaping / 矢量解码（批次82-N8：冷启动首帧 ~200ms 会吞掉整段出液）
        self.assertIn('private void warmUpPanelDraw() {', SRC)
        self.assertIn('panelView.draw(new Canvas(scratch));', SRC)
        self.assertIn('warmUpPanelDraw();', SRC)

    def test_result_box_is_not_a_dark_slab(self) -> None:
        """结果区衬底不许再压黑玻璃：夜档原 0x470C121D（28% 暗蓝）把卡内从玻璃本底 125 压到 87，
        而同位置系统通知栏玻璃是 127（真机 A/B，白色页）。这是「太黑、不像玻璃」的主因。"""
        self.assertIn('resultScroll.setBackground(roundBg(nightMode() ? 0x1AFFFFFF : 0x14000000, 14, 1,', SRC)
        # 只禁「把旧暗色用回 roundBg」，注释里保留历史数值是允许的
        self.assertNotIn('roundBg(nightMode() ? 0x470C121D', SRC)


if __name__ == '__main__':
    unittest.main()
class Batch83RefractionTests(unittest.TestCase):
    """⑦ 第四版：棱边折射 + 光谱色散（AGSL，逆向自酷安 dock 的公开实现）。"""

    def test_agsl_ports_coolapk_algorithm(self) -> None:
        # 与酷安 `RoundedRectRefractionWithDispersionShaderString` 同构：圆角 SDF → circleMap 透镜剖面 →
        # 沿 SDF 梯度外推采样 → 7 段光谱采样做色散
        for piece in ('uniform shader content;', 'float sdRoundedRect(', 'float2 gradSdRoundedRect(',
                      'float circleMap(float x)', 'uniform float refractionHeight;',
                      'uniform float refractionAmount;', 'uniform float depthEffect;',
                      'uniform float chromaticAberration;',
                      'float d = circleMap(1.0 - -sd / refractionHeight) * refractionAmount;',
                      'float2 refracted = coord + d * grad;',
                      'float2 dispersed = d * grad * disp;'):
            self.assertIn(piece, SRC, piece)
        # 7 次光谱采样（红/橙/黄/绿/青/蓝/紫），不是简单 RGB 三分裂
        for var in ('red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'):
            self.assertIn('half4 %s = vib(tap(' % var, SRC, var)
        self.assertIn('half4 tap(float2 c) { return content.eval((c + contentOffset) * contentScale); }', SRC)

    def test_no_local_matrix_on_child_shader(self) -> None:
        """AGSL 的 uniform shader eval() 不认子 shader 的 localMatrix（真机实测：内部平区会被采成
        clamp 边缘 ⇒ 整块糊成一条）—— 坐标变换必须用 uniform 在 shader 里做。"""
        self.assertNotIn('bs.setLocalMatrix(', SRC)
        self.assertIn('shader.setFloatUniform("contentScale", scaleX, scaleY);', SRC)
        self.assertIn('shader.setFloatUniform("contentOffset", offsetX, offsetY);', SRC)

    def test_api_guard_and_fallback(self) -> None:
        """RuntimeShader 是 API 33 才有的类：只在可用时 new；不可用/编译失败一律降级为纯模糊。"""
        refractor = _between(SRC, 'static final class GlassRefractor {', 'private void setOverlayWindowFocusable')
        self.assertIn('static boolean available() { return Build.VERSION.SDK_INT >= 33; }', refractor)
        self.assertIn('new android.graphics.RuntimeShader(GLASS_AGSL_REFRACT);', refractor)
        draw = _between(SRC, 'private Shader refractionShader(int w, int h) {', '@Override public void draw(')
        self.assertIn('if (!refractOn || backdrop == null || backdrop.isRecycled()) return null;', draw)
        self.assertIn('if (r.init()) refractor = r;', draw)
        self.assertIn('if (refractor == null) return null;', draw)
        # draw 里 shader 拿不到就走位图路径（并处理环带外扩的偏移）
        paint_path = _between(SRC, 'Shader sh = refractionShader(b.width(), b.height());', 'paint.setAlpha(255);')
        self.assertIn('canvas.drawBitmap(backdrop, null, rect, paint);', paint_path)
        self.assertIn('rect.left + bdDx + bdSrcW', paint_path)

    def test_band_capture_and_tokens(self) -> None:
        # 第六版令牌 = 酷安 dex 实测（预设 A）：12dp / 24dp / depthEffect=false / 默认无色散
        self.assertAlmostEqual(_const_float2('GLASS_REFRACT_BAND_DP'), 12.0, places=3)
        self.assertAlmostEqual(_const_float2('GLASS_REFRACT_AMOUNT_DP'), 24.0, places=3)
        self.assertAlmostEqual(_const_float2('GLASS_REFRACT_DEPTH'), 0.0, places=3)
        self.assertAlmostEqual(_const_float2('GLASS_DISPERSION'), 0.0, places=3)
        # vibrancy（饱和度 ×1.5）与方向性高光（白 0.5 / 45° / falloff 1）
        self.assertAlmostEqual(_const_float2('GLASS_VIBRANCY'), 1.5, places=3)
        # 第七版：酷安暗色档棱边高光的有效值 = Highlight.alpha 0.58 × Default 的白 0.5
        self.assertAlmostEqual(_const_float2('GLASS_HL_ALPHA'), 0.29, places=3)
        self.assertAlmostEqual(_const_float2('GLASS_HL_ANGLE_DEG'), 45.0, places=3)
        self.assertAlmostEqual(_const_float2('GLASS_HL_FALLOFF'), 1.0, places=3)
        # 上游 Lens.kt：refractionAmount 上传前取负；depthEffect/chromaticAberration 是布尔 0/1
        self.assertIn('shader.setFloatUniform("refractionAmount", -amount);', SRC)
        # 第七版：高光笔宽照抄上游 `HighlightModifier.configurePaint`：ceil(width.toPx()) * 2f
        self.assertIn('final float rimPx = (float) Math.ceil(dp(GLASS_HL_WIDTH_DP)) * 2f;', SRC)
        self.assertIn('GLASS_HL_FALLOFF, rimPx, dp(GLASS_HL_BLUR_DP));', SRC)
        # Java 源码里是字符串字面量 `"uniform float vibrancy;\n"`，文件字节里是反斜杠 + n，故用 raw string
        self.assertIn(r'uniform float vibrancy;\n', SRC)
        self.assertIn('half4 vib(half4 c)', SRC)
        self.assertIn('color.rgb += half3(highlight.rgb * hint * hband);', SRC)
        self.assertIn('private Rect panelSampleRect() {', SRC)
        # 批次93：上边界一直裁到屏幕顶（起点胶囊可以落在状态栏那条带里），左右与下边界仍按折射环带外扩
        self.assertIn('return new Rect(card.left - band, card.top - band, card.right + band, card.bottom + band);', SRC)

    def test_probe_can_disable_refraction(self) -> None:
        self.assertIn('private int probeRefract = -1;', SRC)
        self.assertIn('probeRefract = intent.getIntExtra("glass_refract", -1);', SRC)
        self.assertIn('intent.hasExtra("glass_refract")', SRC)
        activity = (ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness' / 'AssistActivity.java').read_text(encoding='utf-8')
        self.assertIn('probe.putExtra("glass_refract", getIntent().getIntExtra("glass_refract", -1));', activity)


if __name__ == '__main__':
    unittest.main()
