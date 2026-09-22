"""批次85-R1b/R3 契约：设置弹窗里的「配置手机权限」入口 与 「危险操作审批门」现状行。

- R1b：首次使用页原本只在 setup_done=false 可达；设置弹窗加常驻入口，并用 revisit 口径
  （标题「配置手机权限」、底部按钮「返回」、**不写** setup_done）。
- R3：approval gate（dsh_prefs/confirm_gate）此前 App 内既看不到也改不了；托管模式会强制开启它
  并把用户原值存进 confirm_gate_hosted_backup，所以行文案必须同时显示「当前生效」与「你的设置」。
"""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = (ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness' / 'MainActivity.java').read_text(encoding='utf-8')
HOSTED = (ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness' / 'HostedEngineManager.java').read_text(encoding='utf-8')


class Batch85SettingsEntriesTests(unittest.TestCase):

    def test_revisit_overload_and_no_setup_done_write(self) -> None:
        self.assertIn('private void showPermissionScreen() { showPermissionScreen(false); }', SRC)
        self.assertIn('private void showPermissionScreen(boolean revisit) {', SRC)
        self.assertIn('title.setText(revisit ? "配置手机权限" : "首次使用 · 配置手机权限");', SRC)
        self.assertIn('start.setText(revisit ? "返回" : "开始使用");', SRC)
        # revisit 分支必须在写 setup_done 之前 return
        i = SRC.index('if (revisit) { showEngineScreen(); return; }')
        j = SRC.index('putBoolean("setup_done", true)')
        self.assertLess(i, j)

    def test_settings_dialog_has_permission_entry(self) -> None:
        self.assertIn('peText.setText("配置手机权限\\n', SRC)
        self.assertIn('showPermissionScreen(true);', SRC)
        # 入口在设置弹窗内（与胶囊续期行同处一个 root 容器之后）
        self.assertLess(SRC.index('root.addView(capsuleHbRow, hblp);'), SRC.index('root.addView(permEntry, pelp);'))

    def test_approval_gate_row_shows_effective_and_user_intent(self) -> None:
        self.assertIn('private String confirmGateRowText() {', SRC)
        self.assertIn('boolean hosted = sp.contains(HostedEngineManager.KEY_CONFIRM_GATE_BACKUP);', SRC)
        self.assertIn('boolean effective = sp.getBoolean(HostedEngineManager.KEY_CONFIRM_GATE, false);', SRC)
        self.assertIn('gateText.setText(confirmGateRowText());', SRC)
        # 托管期写 BACKUP（退出托管后生效），非托管期写本体
        self.assertIn('ed.putBoolean(HostedEngineManager.KEY_CONFIRM_GATE_BACKUP, next);', SRC)
        self.assertIn('ed.putBoolean(HostedEngineManager.KEY_CONFIRM_GATE, next);', SRC)
        self.assertIn('Log.i(TAG, "[b85r3] confirm_gate user=" + next + " hosted=" + hosted);', SRC)

    def test_hosted_manager_keys_are_public(self) -> None:
        self.assertIn('public static final String KEY_CONFIRM_GATE = "confirm_gate";', HOSTED)
        self.assertIn('public static final String KEY_CONFIRM_GATE_BACKUP = "confirm_gate_hosted_backup";', HOSTED)


if __name__ == '__main__':
    unittest.main()
