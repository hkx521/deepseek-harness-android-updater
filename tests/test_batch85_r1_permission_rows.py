"""批次85-R1 契约：权限引导页必须包含「无障碍服务」与「通知使用权」两行，且各自的判据与跳转正确。

背景（批次85 审计）：`showPermissionScreen()` 原本只有 10 行，**缺「无障碍服务」「通知使用权」**——
无障碍是读屏/点击的命脉（缺它时只能等掉线通知），通知使用权则连入口都没有；
而 `NotificationListener.isReady()` 在补这两行之前是**全仓零引用**的死方法。
"""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = (ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness' / 'MainActivity.java').read_text(encoding='utf-8')


class Batch85R1PermissionRowsTests(unittest.TestCase):

    def test_a11y_row_exists_with_live_status(self) -> None:
        self.assertIn('addPermRow(col, "无障碍服务（读屏与自动操作）"', SRC)
        # 状态必须读系统「已启用的无障碍服务」列表（真机实测：关→未授权、开→已授权）
        self.assertIn('@Override public boolean granted() { return a11yEnabledInSecureSettings(); }', SRC)
        self.assertIn('new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)', SRC)

    def test_notification_access_row_exists_and_wires_is_ready(self) -> None:
        self.assertIn('addPermRow(col, "通知使用权（读取通知）"', SRC)
        # 判据 = 已连接（替代此前零引用的死方法）或出现在 enabled_notification_listeners 里
        self.assertIn('if (NotificationListener.isReady()) return true;', SRC)
        self.assertIn('"enabled_notification_listeners"'  , SRC)
        self.assertIn('new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)', SRC)

    def test_both_rows_are_above_the_legacy_rows(self) -> None:
        # 两行插在「悬浮窗」之前（核心能力靠前），且顺序为 无障碍 → 通知使用权
        i_a11y = SRC.index('addPermRow(col, "无障碍服务（读屏与自动操作）"')
        i_noti = SRC.index('addPermRow(col, "通知使用权（读取通知）"')
        i_overlay = SRC.index('addPermRow(col, "悬浮窗"')
        self.assertLess(i_a11y, i_noti)
        self.assertLess(i_noti, i_overlay)

    def test_probe_allows_reopening_first_run_page(self) -> None:
        # 该页原本只在 setup_done=false（首次启动）可达；探针默认关，供装机后复验渲染
        self.assertIn('getBooleanExtra("show_permission", false)', SRC)
        self.assertIn('showPermissionScreen();', SRC)


if __name__ == '__main__':
    unittest.main()
