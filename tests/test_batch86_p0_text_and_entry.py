"""批次86-P0/P1 契约：显示文字、入口与「管理页配得上管理」。

背景（批次86 用户反馈，证据见 docs/批次86-重审与瘦身方案.md）：
1. 定时任务管理页把任务文本渲染成**字面**的「反斜杠 u8bf7 反斜杠 u5206 5 ...」（真机截图
   docs/screenshots/批次85/batch85-R2-定时任务管理页.png 可见）——手写 jsonField 只按引号截串，
   不解反斜杠 u 转义；本轮修法 = 统一过 unescapeJson（并在读盘时解码历史行，让旧数据自愈）。
2. 设置弹窗 / 保活卡片 / 权限页仍挂「悬浮球」文案（悬浮球形态批次60 已废除）→ 全量改为「助手 / 助手浮层 / 后台服务」。
3. 事件触发器入口从设置弹窗撤下（动作侧只有「交给 AI」一种，做不了「插电→静音」，入口留着只会误导）；
   引擎 / TriggerReceiver / android_trigger / trigger 路由保留。
4. 定时任务页此前只能「管」不能「建」→ 补「＋ 新建任务」与每条任务的「编辑」，全程不需要对助手说话。
"""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
MAIN = (HARNESS / 'MainActivity.java').read_text(encoding='utf-8')


class Batch86EscapeDecodeTests(unittest.TestCase):
    """P0-1：字面转义（反斜杠 u + 4 位十六进制）双重转义。"""

    def test_decoder_exists_and_handles_unicode_escapes(self) -> None:
        self.assertIn('private static String unescapeJson(String s) {', MAIN)
        # 反斜杠 u 四位十六进制 —— 本轮真机看到的正是这种
        self.assertIn("if (n == 'u' && i + 4 < s.length()) {", MAIN)
        # 标准短转义
        for esc in ("case 'n':", "case 't':", "case 'r':", "case 'b':", "case 'f':", "case '/':"):
            self.assertIn(esc, MAIN, '缺转义分支：' + esc)
        self.assertIn("""case '"': out.append('"'); break;""", MAIN)
        # 认不出的转义保留反斜杠（不许把 Windows 路径这类文本改坏）
        self.assertIn("default: out.append('\\\\').append(n); break;", MAIN)

    def test_all_input_paths_decode(self) -> None:
        # 三条取字段路径都必须解码：JSON 字段 / query 字段 / 历史任务行
        self.assertIn('return unescapeJson(json.substring(q1 + 1, q2));', MAIN)
        self.assertIn('return unescapeJson(q.substring(i + k.length(), e).replace("+", " "));', MAIN)
        self.assertIn('p[4] = unescapeJson(p[4]);', MAIN)


class Batch86NoLegacyBallTextTests(unittest.TestCase):
    """P0-2：「悬浮球」文案全量清理（用户可见的更要清）。"""

    def test_no_ball_wording_in_user_visible_files(self) -> None:
        for name in ('MainActivity.java', 'KeepAlivePolicy.java', 'BootReceiver.java',
                     'OverlayService.java', 'VscreensManager.java'):
            text = (HARNESS / name).read_text(encoding='utf-8')
            self.assertNotIn('悬浮球', text, name + ' 仍有「悬浮球」文案')

    def test_keepalive_names_are_live_wording(self) -> None:
        policy = (HARNESS / 'KeepAlivePolicy.java').read_text(encoding='utf-8')
        self.assertIn('public static final String NAME_AUTOSTART = "自启动开关";', policy)
        self.assertIn('public static final String NAME_SERVICE = "后台服务";', policy)
        self.assertIn('title.setText("保活自检（后台常驻）");', MAIN)
        self.assertIn('保活自检 · 后台常驻诊断', MAIN)


class Batch86TriggerEntryRemovedTests(unittest.TestCase):
    """P0-3：触发器入口撤下、能力保留。"""

    def test_settings_entry_row_is_gone(self) -> None:
        self.assertNotIn('tgText.setText(TriggerEngine.summaryText(this));', MAIN)
        self.assertNotIn('root.addView(trigEntry, tglp);', MAIN)

    def test_trigger_capability_kept(self) -> None:
        # 页面 / 工具 / 路由 / 引擎都保留（等有真实动作场景再放回入口）
        self.assertIn('private void showTriggerManager() {', MAIN)
        self.assertIn('respBody = handleTriggerRequest(rawPath, body.toString());', MAIN)
        engine = (HARNESS / 'TriggerEngine.java').read_text(encoding='utf-8')
        self.assertIn('public static String summaryText(Context ctx) {', engine)


class Batch86ScheduleFormTests(unittest.TestCase):
    """P1：定时任务页可建可改。"""

    def test_manager_has_create_entry(self) -> None:
        self.assertIn('addBtn.setText("＋ 新建任务");', MAIN)
        self.assertIn('showScheduleForm(null);', MAIN)
        self.assertIn('private void showScheduleForm(final String[] existing) {', MAIN)

    def test_each_task_can_be_edited(self) -> None:
        self.assertIn('edit.setText("编辑");', MAIN)
        self.assertIn('showScheduleForm(p);', MAIN)

    def test_form_has_defaults_and_quick_chips(self) -> None:
        self.assertIn('private String defaultScheduleWhenSpec() {', MAIN)
        self.assertIn('private String tomorrowMorningSpec() {', MAIN)
        self.assertIn('whenIn.setText("600");', MAIN)
        self.assertIn('whenIn.setText("3600");', MAIN)
        self.assertIn('whenIn.setText(tomorrowMorningSpec());', MAIN)
        self.assertIn('intervalIn.setText(String.valueOf(isEdit ? Math.max(1, parseIntSafe(existing[3])) : 60));', MAIN)
        for chip in ('formChip("一次", null)', 'formChip("每天", null)', 'formChip("每 N 分钟", null)'):
            self.assertIn(chip, MAIN)

    def test_form_and_route_share_one_creation_path(self) -> None:
        # 表单不许自己拼 JSON 再喂 jsonField（那条路对引号/转义不鲁棒）——必须直调 createScheduledTask
        self.assertIn('private String createScheduledTask(String text, String when, String repeat, int intervalMin) {', MAIN)
        self.assertIn('String resp = createScheduledTask(text, when, repeat[0], iv);', MAIN)
        self.assertIn('return createScheduledTask(text, when, repeat, leadingInt(im));', MAIN)

    def test_edit_deletes_old_line_then_creates(self) -> None:
        self.assertIn('cancelScheduledAlarm(existing[0]);', MAIN)
        self.assertIn('rewriteScheduledTasks(existing[0], null, true);', MAIN)
        self.assertIn('logSchedule("任务已编辑（旧条目先删）: " + existing[4]);', MAIN)


class Batch86PermissionRowMergeTests(unittest.TestCase):
    """P2-2：权限页「存储权限 / 所有文件访问」合并为一行（状态取或）。"""

    def test_single_storage_row(self) -> None:
        self.assertIn('addPermRow(col, "存储与文件访问"', MAIN)
        self.assertNotIn('addPermRow(col, "存储权限"', MAIN)
        self.assertNotIn('addPermRow(col, "所有文件访问"', MAIN)
        self.assertIn('if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager() || runtime;', MAIN)


if __name__ == '__main__':
    unittest.main()
