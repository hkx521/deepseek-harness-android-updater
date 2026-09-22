from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
OVERLAY_SRC = (PKG / 'OverlayService.java').read_text(encoding='utf-8')
MAIN_SRC = (PKG / 'MainActivity.java').read_text(encoding='utf-8')
ASSIST_SRC = (PKG / 'AssistActivity.java').read_text(encoding='utf-8')
MANIFEST_SRC = (ROOT / 'android-app' / 'AndroidManifest.xml').read_text(encoding='utf-8')


class Batch50SmartCapsuleTests(unittest.TestCase):
    '''批次50至批次60演进：自绘胶囊死重已剔除，100% 由系统原生灵动胶囊(PromotedProgressNotifier)接管。'''

    def test_capsule_fields_cleared_for_batch60(self) -> None:
        self.assertNotIn('private LinearLayout capsuleView;', OVERLAY_SRC)
        self.assertNotIn('private TextView capsuleDot;', OVERLAY_SRC)
        self.assertNotIn('private TextView capsuleText;', OVERLAY_SRC)
        self.assertNotIn('private TextView capsuleAction;', OVERLAY_SRC)

    def test_capsule_cutout_overlay_properties(self) -> None:
        self.assertIn('Gravity.TOP | Gravity.CENTER_HORIZONTAL', OVERLAY_SRC)
        self.assertIn('TYPE_APPLICATION_OVERLAY', OVERLAY_SRC)
        self.assertNotIn('rootView.addView(capsuleView);', OVERLAY_SRC)

    def test_capsule_lifecycle_wiring(self) -> None:
        self.assertIn('showCapsule(', OVERLAY_SRC)
        self.assertIn('hideCapsule(', OVERLAY_SRC)
        self.assertIn('updateCapsuleProgress(', OVERLAY_SRC)
        self.assertIn('PromotedProgressNotifier.start(this, "正在提交…");', OVERLAY_SRC)

    def test_capsule_emergency_stop_wired(self) -> None:
        self.assertIn('triggerEmergencyStop()', OVERLAY_SRC)


class Batch50HiddenIdleAndAiKeyTests(unittest.TestCase):
    '''平时完全隐藏（0 遮挡），AI 键短按直通灵动助手弹窗。'''

    def test_idle_fully_hidden(self) -> None:
        '''待机时必须零占屏：rootView 默认 GONE，关面板后整体收起。'''
        self.assertIn('rootView.setVisibility(View.GONE);', OVERLAY_SRC)

    def test_ai_key_entry_points_present(self) -> None:
        self.assertIn('public static void openAssistantFromKey(Context ctx)', OVERLAY_SRC)
        self.assertIn('public void openAssistantCapsule()', OVERLAY_SRC)
        self.assertIn('getBooleanExtra("action_open_assistant", false)', OVERLAY_SRC)
        self.assertIn('OverlayService.openAssistantFromKey(this);', ASSIST_SRC)

    def test_launcher_entry_registered_for_ai_key_settings(self) -> None:
        '''系统「AI 键短按 → 打开应用」列表要求 MAIN/LAUNCHER，否则看不到入口。'''
        self.assertIn('android:label="灵动助手弹窗"', MANIFEST_SRC)
        self.assertIn('android.intent.category.LAUNCHER', MANIFEST_SRC)
        self.assertIn('android:launchMode="singleInstance"', MANIFEST_SRC)
        self.assertIn('android:launchMode="singleTask"', MANIFEST_SRC)
        self.assertIn('moveTaskToBack(true);', MAIN_SRC)

    def test_liquid_glass_panel_styling(self) -> None:
        # 批次83：面板玻璃底收敛到 buildPanelGlass()（唯一生成点；批次83 起返回自绘 Drawable）
        self.assertIn('private Drawable buildPanelGlass()', OVERLAY_SRC)
        self.assertIn('panelView.setBackground(buildPanelGlass());', OVERLAY_SRC)
        self.assertIn('panelView.setClipToOutline(true);', OVERLAY_SRC)

    def test_droplet_expand_animation(self) -> None:
        '''按下 AI 键从顶部向下弹出。

        批次82-N8 的「三段式流挂」已在批次92 被**「胶囊展开」**取代（对齐系统灵动胶囊实测曲线）——
        逐段参数与契约见 tests/test_batch82_n8_flow_hang.py。这里只保留「呼出前后必须压初值」
        与「走同一条实现」这两条与批次50/51 一脉相承的约束。
        '''
        # 批次83/92：呼出初值同步压「起点姿态」态（applyFlowStartPose），第一帧就可见
        self.assertIn('applyFlowStartPose();', OVERLAY_SRC)
        self.assertIn('public void openAssistantCapsule()', OVERLAY_SRC)
        self.assertIn('playFlowHangEnter();', OVERLAY_SRC)
        self.assertIn('private void playFlowHangEnter() {', OVERLAY_SRC)


if __name__ == '__main__':
    unittest.main()
