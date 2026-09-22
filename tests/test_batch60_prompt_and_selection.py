from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
OVERLAY_SRC = (PKG / 'OverlayService.java').read_text(encoding='utf-8')
CHIP_ITEM_SRC = (PKG / 'PromptChipItem.java').read_text(encoding='utf-8')
CHIP_MGR_SRC = (PKG / 'PromptChipManager.java').read_text(encoding='utf-8')
SELECTION_SRC = (PKG / 'SelectionOverlayView.java').read_text(encoding='utf-8')
A11Y_SRC = (PKG / 'AccessibilityService.java').read_text(encoding='utf-8')
VS_MGR_SRC = (PKG / 'VscreensManager.java').read_text(encoding='utf-8')
# 批次97：.local/ 被 gitignore（新克隆/公开仓库里不存在）—— 优先读工作区镜像，缺失时回退受控权威副本。
_BUILD_LOCAL = ROOT / '.local' / 'b47_build.py'
BUILD_SRC = (_BUILD_LOCAL if _BUILD_LOCAL.is_file() else (ROOT / 'tools' / 'b47_build.py')) \
    .read_text(encoding='utf-8')


class Batch60PromptChipWorkflowTests(unittest.TestCase):
    '''批次60 模块一：复杂意图模板预设（Prompt Chips 自定义工作流）。'''

    def test_prompt_chip_item_model(self) -> None:
        self.assertIn('public String id;', CHIP_ITEM_SRC)
        self.assertIn('public String label;', CHIP_ITEM_SRC)
        self.assertIn('public String prompt;', CHIP_ITEM_SRC)
        self.assertIn('public boolean isBuiltin;', CHIP_ITEM_SRC)
        self.assertIn('public int order;', CHIP_ITEM_SRC)
        self.assertIn('public JSONObject toJson()', CHIP_ITEM_SRC)
        self.assertIn('public static PromptChipItem fromJson(JSONObject obj)', CHIP_ITEM_SRC)

    def test_prompt_chip_manager_contract(self) -> None:
        self.assertIn('public static final String KEY_CUSTOM_CHIPS = "custom_prompt_chips";', CHIP_MGR_SRC)
        self.assertIn('public static final String PREFS = "dsh_prefs";', CHIP_MGR_SRC)
        self.assertIn('public static List<PromptChipItem> getChips(Context ctx)', CHIP_MGR_SRC)
        self.assertIn('public static synchronized void saveChips(Context ctx, List<PromptChipItem> list)', CHIP_MGR_SRC)
        self.assertIn('public static synchronized PromptChipItem addChip(Context ctx, String label, String prompt)', CHIP_MGR_SRC)
        self.assertIn('public static synchronized boolean updateChip(Context ctx, String id, String newLabel, String newPrompt)', CHIP_MGR_SRC)
        self.assertIn('public static synchronized boolean deleteChip(Context ctx, String id)', CHIP_MGR_SRC)
        self.assertIn('public static synchronized boolean moveToTop(Context ctx, String id)', CHIP_MGR_SRC)
        self.assertIn('public static synchronized void resetToDefault(Context ctx)', CHIP_MGR_SRC)

    def test_builtin_chips_defined(self) -> None:
        self.assertIn('builtin_screen', CHIP_MGR_SRC)
        self.assertIn('builtin_summary', CHIP_MGR_SRC)
        self.assertIn('builtin_ocr', CHIP_MGR_SRC)
        self.assertIn('builtin_translate', CHIP_MGR_SRC)
        self.assertIn('if (item.isBuiltin) return false;', CHIP_MGR_SRC)  # 内置项删除保护

    def test_overlay_prompt_chip_integration(self) -> None:
        self.assertIn('renderPromptChips();', OVERLAY_SRC)
        self.assertIn('showChipManageDialog(item);', OVERLAY_SRC)
        self.assertIn('showAddChipDialog();', OVERLAY_SRC)
        self.assertIn('showEditChipDialog(item);', OVERLAY_SRC)
        self.assertIn('PromptChipManager.getChips(this)', OVERLAY_SRC)
        self.assertIn('"🔍 划选"', OVERLAY_SRC)
        self.assertIn('"+ 新建"', OVERLAY_SRC)


class Batch60MultimodalSelectionTests(unittest.TestCase):
    '''批次60 模块二：多模态即时选区（SelectionOverlayView）。'''

    def test_selection_overlay_properties(self) -> None:
        self.assertIn('public class SelectionOverlayView extends FrameLayout', SELECTION_SRC)
        self.assertIn('TYPE_APPLICATION_OVERLAY', SELECTION_SRC)
        self.assertIn('PorterDuff.Mode.CLEAR', SELECTION_SRC)  # 镂空露出底层真机画面
        self.assertIn('0xFF3890F0', SELECTION_SRC)             # 冰川蓝发光描边
        self.assertIn('0x66000000', SELECTION_SRC)             # 黑曜石半透明蒙层
        self.assertIn('makeBubbleAction', SELECTION_SRC)

    def test_selection_actions_declared(self) -> None:
        self.assertIn('void onAskWithImage(Bitmap cropped, Rect rect);', SELECTION_SRC)
        self.assertIn('void onExtractText(Bitmap cropped, Rect rect);', SELECTION_SRC)
        self.assertIn('void onCopyImage(Bitmap cropped, Rect rect);', SELECTION_SRC)
        self.assertIn('void onCancel();', SELECTION_SRC)

    def test_overlay_service_selection_wiring(self) -> None:
        self.assertIn('startAreaSelection()', OVERLAY_SRC)
        self.assertIn('AccessibilityService.captureScreen', OVERLAY_SRC)
        self.assertIn('showSelectionOverlay(', OVERLAY_SRC)
        self.assertIn('onAskWithImage', OVERLAY_SRC)
        self.assertIn('onExtractText', OVERLAY_SRC)
        self.assertIn('onCopyImage', OVERLAY_SRC)
        self.assertIn('saveCroppedBitmap(', OVERLAY_SRC)


class Batch60DeadweightEliminationTests(unittest.TestCase):
    '''批次60 死重剔除反向契约：自绘胶囊与悬浮球彻底移除。'''

    def test_capsule_fields_completely_removed(self) -> None:
        self.assertNotIn('private LinearLayout capsuleView;', OVERLAY_SRC)
        self.assertNotIn('private TextView capsuleDot;', OVERLAY_SRC)
        self.assertNotIn('private TextView capsuleText;', OVERLAY_SRC)
        self.assertNotIn('private TextView capsuleAction;', OVERLAY_SRC)
        self.assertNotIn('private ValueAnimator capsuleAnimator;', OVERLAY_SRC)

    def test_floating_ball_fields_and_touches_removed(self) -> None:
        self.assertNotIn('private FrameLayout fab;', OVERLAY_SRC)
        self.assertNotIn('fab.setOnTouchListener(dragTouch);', OVERLAY_SRC)
        self.assertNotIn('rootView.addView(fab);', OVERLAY_SRC)

    def test_minibar_view_removed(self) -> None:
        self.assertNotIn('private TextView miniBar;', OVERLAY_SRC)
        self.assertNotIn('rootView.addView(miniBar);', OVERLAY_SRC)

    def test_build_script_includes_batch60_files(self) -> None:
        self.assertIn('PromptChipItem', BUILD_SRC)
        self.assertIn('PromptChipManager', BUILD_SRC)
        self.assertIn('SelectionOverlayView', BUILD_SRC)


if __name__ == '__main__':
    unittest.main()


class Batch60SelectionContextFixTests(unittest.TestCase):
    def test_a11y_selection_text_extract_api(self) -> None:
        self.assertIn('public static String extractTextInSelectionRect(final Rect selectionRect)', A11Y_SRC)

    def test_overlay_selection_context_state(self) -> None:
        self.assertIn('private Rect activeSelectionRect = null;', OVERLAY_SRC)
        self.assertIn('private String activeSelectionText = null;', OVERLAY_SRC)
        self.assertIn('private TextView selectionBadgeView;', OVERLAY_SRC)
        self.assertIn('updateSelectionBadge()', OVERLAY_SRC)
        self.assertIn('clearSelectionContext()', OVERLAY_SRC)

    def test_resolve_effective_command_injects_bounds_and_text(self) -> None:
        self.assertIn('resolveEffectiveCommand(', OVERLAY_SRC)
        self.assertIn('【用户当前在屏幕上圈选了特定区域】', OVERLAY_SRC)
        self.assertIn('切勿回复「屏幕上不存在选区」', OVERLAY_SRC)


class Batch60VscreenRoutingTests(unittest.TestCase):
    """批次60-B：虚拟屏（vscreen）任务级路由与生命周期收尾。"""

    def test_manager_exposes_session_query(self) -> None:
        self.assertIn('public static boolean isSessionActive()', VS_MGR_SRC)
        self.assertIn('return m != null && m.sessionActive;', VS_MGR_SRC)

    def test_overlay_task_level_state(self) -> None:
        self.assertIn('private boolean vscreenPreferred = true;', OVERLAY_SRC)
        self.assertIn('private boolean vscreenUsedThisTask = false;', OVERLAY_SRC)
        self.assertIn('private boolean vscreenPreexisting = false;', OVERLAY_SRC)

    def test_marker_lists_declared(self) -> None:
        self.assertIn('private static final String[] VSCREEN_REQUIRED_MARKERS', OVERLAY_SRC)
        self.assertIn('private static final String[] READ_ONLY_SCREEN_MARKERS', OVERLAY_SRC)

    def test_router_prefers_main_screen_for_readonly(self) -> None:
        # 只读/理解类必须先被过滤（先判禁，再判需），否则划选提取又会拉起虚拟屏
        start = OVERLAY_SRC.index('private boolean shouldUseVscreen(String command)')
        end = OVERLAY_SRC.index('private static boolean containsAny', start)
        body = OVERLAY_SRC[start:end]
        # 批次80：只读判定收紧为「命中只读词 **且** 不含任何动作词」——
        # 复合指令（如「分析一下当前页面，然后进入设置逐页检查」）不再被判成只读任务
        # （误判会让虚拟屏被硬闸门关掉，长自动化只能回头追问用户要授权）。
        self.assertIn('containsAny(cmd, READ_ONLY_SCREEN_MARKERS)', body)
        self.assertIn('!containsAny(cmd, ACTION_SCREEN_MARKERS)', body)
        self.assertIn('return false;', body)
        self.assertIn('return true;', body)

    def test_prompt_injects_vscreen_rules(self) -> None:
        self.assertIn('private String applyVscreenPolicy(String rawCommand)', OVERLAY_SRC)
        self.assertIn('【虚拟屏（vscreen）使用规范】', OVERLAY_SRC)
        self.assertIn('禁止调用 android_vscreen_create', OVERLAY_SRC)
        self.assertIn("vscreenPreferred = readVscreenPreferred();", OVERLAY_SRC)
        self.assertIn("vscreenPreexisting = VscreensManager.isSessionActive();", OVERLAY_SRC)
        self.assertIn("return applyVscreenPolicy(command)", OVERLAY_SRC)

    def test_global_switch_off_hard_gate(self) -> None:
        self.assertIn('private boolean readVscreenPreferred()', OVERLAY_SRC)
        self.assertIn('getBoolean("vscreen_mode", true)', OVERLAY_SRC)
        self.assertIn('【用户已关闭「虚拟屏执行」总开关】', OVERLAY_SRC)
        self.assertIn('if (!vscreenPreferred) need = false;', OVERLAY_SRC)

    def test_task_end_auto_cleanup(self) -> None:
        self.assertIn('private void maybeCleanupVscreen(String reason)', OVERLAY_SRC)
        self.assertIn('VscreensManager.get().shutdown(app);', OVERLAY_SRC)
        self.assertIn('if (!vscreenUsedThisTask || vscreenPreexisting)', OVERLAY_SRC)
        # 成功与失败两条收尾路径都必须回收
        self.assertEqual(OVERLAY_SRC.count('maybeCleanupVscreen("task end");'), 2)

    def test_cancel_path_also_recycles_vscreen(self) -> None:
        # 批次60-B 补丁：cancelCommand() 会 agentGeneration++，使 onResult/onError 的
        # 收尾回调被代际守卫丢弃；若取消/急停路径不自行回收，本轮自建虚拟屏会残留。
        i = OVERLAY_SRC.index('private void cancelCommand()')
        body = OVERLAY_SRC[i:OVERLAY_SRC.index('private void postAgentCallback', i)]
        self.assertIn('agentGeneration++', body)
        self.assertIn('maybeCleanupVscreen("task canceled");', body)
        # 急停走的就是 cancelCommand，必须同样受盖
        self.assertIn('maybeCleanupVscreen("task canceled");', OVERLAY_SRC)


class Batch60VscreenRouterMirrorTests(unittest.TestCase):
    '''镜像校验：与 Java shouldUseVscreen 同一套规则，锁定「何时开虚拟屏」的判定契约。'''

    def _grab(self, name):
        import re
        i = OVERLAY_SRC.index('String[] ' + name)
        body = OVERLAY_SRC[i:OVERLAY_SRC.index('};', i)]
        return re.findall('"([^"]+)"', body)

    def _need(self, cmd):
        required = self._grab('VSCREEN_REQUIRED_MARKERS')
        readonly = self._grab('READ_ONLY_SCREEN_MARKERS')
        actions = self._grab('ACTION_SCREEN_MARKERS')
        self.assertTrue(required)
        self.assertTrue(readonly)
        self.assertTrue(actions)
        # 批次80：与 Java shouldUseVscreen 同一套规则——只读词 + 动作词 = 需要动手的任务
        if any(m in cmd for m in readonly) and not any(m in cmd for m in actions):
            return False
        return True

    def test_readonly_tasks_stay_on_main_screen(self) -> None:
        for cmd in ('识别屏幕', '提取文字', '提取此选区画面中的文字', '翻译页面', '总结页面', '针对此选区：帮我解释'):
            self.assertFalse(self._need(cmd), cmd)

    def test_batch_tasks_require_vscreen(self) -> None:
        for cmd in ('跨应用批量给 10 个人发消息', '循环遍历列表逐个点赞', '锁屏后台跑一下签到'):
            self.assertTrue(self._need(cmd), cmd)
        # 批次63：打开+之后/然后/再/并 自动晋升虚拟屏
        self.assertTrue(self._need('打开微博领取浏览红包之后关闭'), '打开并多步骤操作应当启用虚拟屏')

    def test_plain_browsing_stays_on_main_screen(self) -> None:
        for cmd in ('打开设置', '返回桌面', '点一下右上角按钮'):
            self.assertTrue(self._need(cmd), '批次64：非只读任务默认均允许虚拟屏隔离执行')

    def test_batch61_readonly_task_hard_gate_contract(self) -> None:
        '''批次61：只读任务硬闸门契约 —— VscreensManager 查 isReadOnlyTaskInFlight 拒绝建屏。'''
        self.assertIn("public static boolean isReadOnlyTaskInFlight()", OVERLAY_SRC)
        self.assertIn("OverlayService.isReadOnlyTaskInFlight()", VS_MGR_SRC)
        self.assertIn("REASON_READONLY_TASK", VS_MGR_SRC)
        self.assertIn("vscreen create refused: read-only task in flight", VS_MGR_SRC)

    def test_composite_command_is_not_readonly(self) -> None:
        '''批次80：只读词 + 动作词 → 不是只读任务（长自动化不再被判只读后反问授权）。'''
        for cmd in ('分析一下当前页面，然后进入设置逐页把通知关掉',
                    '识别屏幕内容并点击「同意」继续',
                    '看看这个页面，帮我打开设置里的 WLAN 并关闭它'):
            self.assertTrue(self._need(cmd), cmd)
        # 纯只读仍然留在主屏
        for cmd in ('识别当前屏幕', '总结当前页面', '分析一下当前界面'):
            self.assertFalse(self._need(cmd), cmd)

