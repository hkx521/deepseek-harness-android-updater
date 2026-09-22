"""批次88 契约：定时任务链路的真实缺陷修复（D1/D4/D5/D7/D8/D9/D13）。

背景：用户明确要求「把定时任务做好，多任务管理做好」（其他新功能一律不要）。
本批只修**现有功能**的缺陷，证据全部来自真机取证 + 只读代码审计：
- D1 管理页「最近执行记录」读的是**内部**私有目录的 scheduled-log.txt，而到点执行
  （ScheduleExecutor/AlarmReceiver）写的是**外部** /sdcard/DeepSeekHarness/scheduled-log.txt
  ⇒ 页面永远看不到到点执行的真实结果（真机实证：两边尾部内容完全不同）。
- D4 到点前等引擎只有 30s（真机日志留证「引擎 30 秒未就绪，放弃」两条），冷启动慢就整条放弃。
- D5 三条失败路径（引擎启动失败 / 未就绪 / 建会话失败）只写日志、不发通知 ⇒ 用户以为跑了。
- D7/D14 SimpleDateFormat 默认 lenient ⇒ 真机实测 when="99:99" 静默建出「11 小时 20 分钟后」的任务。
- D8「重排全部闹钟」调 rewriteScheduledTasks(null,null,false) 会重读文件，内存里更新过的时间被丢弃。
- D9 AlarmReceiver 的 daily 只 +24h 一次，迟到 >24h 时守卫不成立 ⇒ 静默停止重复。
- D13 过期一次性任务只能逐条删，缺批量清理。
"""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
MAIN = (HARNESS / "MainActivity.java").read_text(encoding="utf-8")
SCHED = (HARNESS / "ScheduleExecutor.java").read_text(encoding="utf-8")
ALARM = (HARNESS / "AlarmReceiver.java").read_text(encoding="utf-8")


class Batch88ScheduleLogSourceTests(unittest.TestCase):
    """D1：执行记录必须读到「到点执行」写的那份日志。"""

    def test_log_file_is_external_like_executor(self) -> None:
        # ScheduleExecutor 写外部；MainActivity 必须读同一份
        self.assertIn('File root = new File(android.os.Environment.getExternalStorageDirectory(), rootName);', SCHED)
        self.assertIn('new File(Environment.getExternalStorageDirectory(), rootName)', MAIN)
        # 不允许再返回内部私有目录的同名文件
        self.assertNotIn('return new File(getFilesDir(), "scheduled-log.txt");', MAIN)

    def test_task_store_stays_internal(self) -> None:
        # 任务表本身仍在内部（AlarmReceiver 与 MainActivity 同 uid 可读写），不要顺手改成外部
        self.assertIn('private File scheduledTasksFile() { return new File(getFilesDir(), "scheduled-tasks.json"); }', MAIN)


class Batch88EngineWaitAndFailureVisibilityTests(unittest.TestCase):
    """D4 + D5：等引擎更久 + 失败必须可见。"""

    def test_wait_window_is_90s(self) -> None:
        self.assertIn("for (int i = 0; i < 90; i++) {", SCHED)
        self.assertNotIn("for (int i = 0; i < 30; i++) {", SCHED)
        self.assertIn("引擎 90 秒未就绪，放弃", SCHED)

    def test_all_failure_paths_notify(self) -> None:
        # 三条 early-return 前都要 notifyResult(ctx, false, ...)
        self.assertIn('notifyResult(ctx, false, "引擎启动失败，任务未执行：\\n" + task);', SCHED)
        self.assertIn('notifyResult(ctx, false, "引擎 90 秒未就绪，任务未执行：\\n" + task);', SCHED)
        self.assertIn('notifyResult(ctx, false, "创建会话失败，任务未执行（检查引擎 /api 鉴权）：\\n" + task);', SCHED)


class Batch88StrictTimeParseTests(unittest.TestCase):
    """D7/D14：非法时间不许静默归一化。"""

    def test_strict_parser_exists_and_is_used(self) -> None:
        self.assertIn("private static Long parseScheduleWhenStrict(String raw) {", MAIN)
        self.assertIn("Long parsed = parseScheduleWhenStrict(when.trim());", MAIN)
        self.assertIn("fmt.setLenient(false);", MAIN)
        # 字段范围显式校验（HH:mm）
        self.assertIn("if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;", MAIN)
        # 错误文案是中文、可执行
        self.assertIn("时间格式不对或不是合法时刻", MAIN)

    def test_old_lenient_block_is_gone(self) -> None:
        # 旧的 lenient 解析块（无 setLenient(false) 的三段 SimpleDateFormat）必须已被替换
        self.assertNotIn('fmt = new java.text.SimpleDateFormat("HH:mm", Locale.US);', MAIN)


class Batch88ReschedulePersistenceTests(unittest.TestCase):
    """D8：整体操作要落盘内存里的新表。"""

    def test_write_all_helper_exists(self) -> None:
        self.assertIn("private boolean writeScheduledTasksAll(List<String[]> rows) {", MAIN)

    def test_reschedule_all_uses_it(self) -> None:
        # 「重排全部闹钟」必须用整体写入，而不是会重读文件的 rewriteScheduledTasks
        i = MAIN.index('repair.setText("重排全部闹钟");')
        seg = MAIN[i:i + 2600]
        self.assertIn("writeScheduledTasksAll(tasks);", seg)
        self.assertNotIn("rewriteScheduledTasks(null, null, false);", seg)


class Batch88DailyRepeatCatchUpTests(unittest.TestCase):
    """D9：daily 迟到 >24h 必须继续顺延，不许静默停止。"""

    def test_daily_loops_forward(self) -> None:
        self.assertIn("while (nextAt <= System.currentTimeMillis()) {", ALARM)
        self.assertIn("nextAt += 24L * 3600L * 1000L;", ALARM)


class Batch88BatchCleanupTests(unittest.TestCase):
    """D13：多任务管理要有批量清理过期任务。"""

    def test_purge_button_exists(self) -> None:
        self.assertIn('purge.setText("清理已过期");', MAIN)
        self.assertIn("writeScheduledTasksAll(keep);", MAIN)
        self.assertIn('logSchedule("清理已过期任务: "', MAIN)


class Batch88DeadCodeRemovedTests(unittest.TestCase):
    """D2：零调用的旧方法已删。"""

    def test_take_due_removed(self) -> None:
        self.assertNotIn("takeDueScheduledTasks", MAIN)


if __name__ == "__main__":
    unittest.main()
