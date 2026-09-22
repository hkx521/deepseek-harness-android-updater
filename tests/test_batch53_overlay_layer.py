from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
OVERLAY_SRC = (PKG / 'OverlayService.java').read_text(encoding='utf-8')


class Batch53OverlayLayerTests(unittest.TestCase):
    '''批次53：撤销在本机零渲染的无障碍浮层升层，改用应用浮窗 + 内容下移 + 渲染看门狗。'''

    def test_accessibility_overlay_promotion_removed(self) -> None:
        '''不得再出现把 rootView 迁到 TYPE_ACCESSIBILITY_OVERLAY 的写法（本机零渲染，取证见源码注释）。'''
        # 注释里保留历史说明，但不得再有任何真正的代码用法
        self.assertNotIn('WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY', OVERLAY_SRC)
        self.assertNotIn('lp.type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY', OVERLAY_SRC)
        self.assertNotIn('getSystemService(WINDOW_SERVICE);\n                if (a11yWm != null)', OVERLAY_SRC)
        self.assertNotIn('AccessibilityService.instance', OVERLAY_SRC)
        self.assertNotIn('promoteToAccessibilityWindowIfNeeded', OVERLAY_SRC)

    def test_overlay_window_is_always_application_overlay(self) -> None:
        '''窗口类型恒为应用浮窗，且 addToWindow 不再挑选无障碍 WindowManager。'''
        self.assertIn('WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY', OVERLAY_SRC)
        self.assertIn('if (lp.type != wantType) lp.type = wantType;', OVERLAY_SRC)
        self.assertIn('WindowManager appWm = (WindowManager) getSystemService(WINDOW_SERVICE);', OVERLAY_SRC)

    def test_self_heal_reattach_path(self) -> None:
        '''视图没挂上（批次52 残留的 type=2032 / 失效 WM）时必须能自愈重新挂载。'''
        self.assertIn('private void ensureOverlayAttached() {', OVERLAY_SRC)
        self.assertIn('if (rootView.isAttachedToWindow() && rootView.getWindowToken() != null) return;', OVERLAY_SRC)
        self.assertIn('[b53] overlay re-attached', OVERLAY_SRC)
        # 两条呼出路径 + 看门狗都必须走自愈入口
        self.assertGreaterEqual(OVERLAY_SRC.count('ensureOverlayAttached();'), 3)

    def test_content_shifted_below_status_bar(self) -> None:
        '''应用浮窗压不过状态栏：整块内容必须下移一个状态栏高度，避免胶囊/面板被状态栏压住。'''
        self.assertIn('private int statusBarHeightPx() {', OVERLAY_SRC)
        self.assertIn('rootView.setPadding(0, statusBarHeightPx(), 0, 0);', OVERLAY_SRC)
        self.assertIn('"status_bar_height", "dimen", "android"', OVERLAY_SRC)

    def test_panel_show_watchdog(self) -> None:
        '''展开后 900ms 必须有渲染看门狗，兜底复位「可见但透明」残留并留痕。'''
        self.assertIn('panelShowWatchdog', OVERLAY_SRC)
        self.assertIn('handler.postDelayed(panelShowWatchdog, 900L);', OVERLAY_SRC)
        self.assertIn('panelView.setAlpha(1f);', OVERLAY_SRC)
        self.assertIn('[b53] watchdog', OVERLAY_SRC)


if __name__ == '__main__':
    unittest.main()
