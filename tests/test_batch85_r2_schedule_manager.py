"""批次85-R2 契约：定时任务管理页（列表 / 下次触发 / 启停 / 立即执行 / 删除 / 最近记录）。

背景（批次85 审计 R2）：定时任务底座（android_schedule + AlarmReceiver + ScheduleExecutor +
filesDir/scheduled-tasks.json + scheduled-log.txt）早已可用，但**零界面** —— 用户看不到自己设过什么、
下次何时触发、上轮成没成。另外本轮发现并修掉一个**多任务互相覆盖**的缺陷：
handleScheduleRequest 原来用固定 requestCode=0 注册闹钟（filterEquals 忽略 extras），
后建的任务会覆盖前一个的闹钟。
"""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = (ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness' / 'MainActivity.java').read_text(encoding='utf-8')
PLUGIN = (ROOT / 'plugins' / 'dsh-tool-shizuku' / 'lib' / 'index.js').read_text(encoding='utf-8')


class Batch85R2ScheduleManagerTests(unittest.TestCase):

    def test_request_code_is_per_task(self) -> None:
        # /schedule 注册闹钟必须按 taskId 区分 requestCode（否则后建任务覆盖前一个）
        self.assertIn('android.app.PendingIntent.getBroadcast(this, taskId.hashCode(), i,', SRC)
        # 只检查「注册闹钟」那一支：/schedule 里不得再用固定 requestCode=0
        seg = SRC[SRC.index('private String handleScheduleRequest('):SRC.index('// ============ 定时任务持久化')]
        self.assertNotIn('getBroadcast(this, 0, i,', seg)
        self.assertIn('android.app.PendingIntent.getBroadcast(this, taskId.hashCode(), i,', seg)
        # 旧实现遗留的那条 requestCode=0 闹钟要有清理入口
        self.assertIn('private void cancelLegacyScheduledAlarm() {', SRC)

    def test_storage_line_schema_and_flag(self) -> None:
        self.assertIn('private static String[] parseScheduledLine(String line) {', SRC)
        self.assertIn('private static String joinScheduledLine(String[] p) {', SRC)
        self.assertIn('private List<String[]> latestScheduledTasks() {', SRC)
        self.assertIn('private boolean rewriteScheduledTasks(String targetId, String[] keepNew, boolean doRemove) {', SRC)
        # 第 6 段 = on/off，缺省视为启用
        self.assertIn('String flag = "off".equalsIgnoreCase(p[5]) ? "off" : "on";', SRC)
        self.assertIn('return !(p.length >= 6 && "off".equalsIgnoreCase(p[5]));', SRC)

    def test_manager_actions(self) -> None:
        self.assertIn('private void showScheduleManager() {', SRC)
        self.assertIn('buildScheduleTaskRow(dialog, p)', SRC)
        for label in ('立即执行', '停用', '启用', '删除', '重排全部闹钟'):
            self.assertIn(label, SRC)
        # 立即执行复用既有执行链路（不等新写一套）
        self.assertIn('pendingScheduledTask = text;', SRC)
        self.assertIn('executePendingScheduledTask();', SRC)
        # 每个动作都要落执行日志（可审计）
        for line in ('logSchedule("手动执行任务: "', 'logSchedule("任务已停用: "',
                     'logSchedule("任务已启用: "', 'logSchedule("任务已删除: "'):
            self.assertIn(line, SRC)

    def test_settings_entry_and_recent_log(self) -> None:
        self.assertIn('private String scheduleSummaryText() {', SRC)
        self.assertIn('scText.setText(scheduleSummaryText());', SRC)
        self.assertIn('showScheduleManager();', SRC)
        self.assertIn('private String recentScheduleLog(int n) {', SRC)
        self.assertIn('logView.setText(recentScheduleLog(6));', SRC)

    def test_tool_surface_exposes_repeat(self) -> None:
        # 批次85-R2 一并修：android_schedule 此前只传 text/when ⇒ App 的 daily/interval 在工具面上不可达
        self.assertIn('repeat: {', PLUGIN)
        self.assertIn('intervalMin: {', PLUGIN)
        self.assertIn('repeat: String(args.repeat || ""),', PLUGIN)
        self.assertIn('intervalMin: Number(args.intervalMin || 0)', PLUGIN)

    def test_app_accepts_bare_number_when_and_interval(self) -> None:
        # 数值型字段必须**先**走 jsonNumField：jsonField 遇到裸数字会抓下一个引号串当值（真机实测把 when 当成了 intervalMin）
        self.assertIn('String when = jsonNumField(raw, "when");', SRC)
        self.assertIn('if (when.isEmpty()) when = jsonField(raw, "when");', SRC)
        self.assertIn('String im = jsonNumField(raw, "intervalMin");', SRC)
        self.assertIn('if (im.isEmpty()) im = jsonField(raw, "intervalMin");', SRC)
        # 批次86-P1：解析与建任务拆开了（App 内表单走同一个 createScheduledTask，不经 JSON 往返）
        self.assertIn('return createScheduledTask(text, when, repeat, leadingInt(im));', SRC)
        self.assertIn('private String createScheduledTask(String text, String when, String repeat, int intervalMin) {', SRC)
        self.assertIn('private static int leadingInt(String s) {', SRC)


if __name__ == '__main__':
    unittest.main()
