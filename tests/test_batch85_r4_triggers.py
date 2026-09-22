"""批次85-R4 契约：事件触发器（TriggerEngine + TriggerReceiver + /trigger 路由 + android_trigger 工具）。

背景（批次85 审计 R4）：在此之前全项目**只有两个触发器** —— 开机（BootReceiver）与定时（AlarmReceiver）；
对标 MacroDroid / Tasker / 快捷指令，「触发器 × 动作」才是自动化的核心，而动作一侧早已齐备
（ScheduleExecutor.execute 能后台拉起引擎、建会话、把任务交给 AI）。本批次补触发器一侧。

关键实现约束（真机取证得来）：
- ACTION_POWER_CONNECTED / ACTION_BATTERY_LOW **不在** Android 8+ 隐式广播例外名单里 ⇒ 用 sticky 的
  ACTION_BATTERY_CHANGED + 边沿判定实现（需要持久化上次状态）。
- 包安装/卸载/替换属例外名单，可清单注册（TriggerReceiver），App 进程未运行也能收。
"""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
ENGINE = (HARNESS / 'TriggerEngine.java').read_text(encoding='utf-8')
RECEIVER = (HARNESS / 'TriggerReceiver.java').read_text(encoding='utf-8')
MAIN = (HARNESS / 'MainActivity.java').read_text(encoding='utf-8')
OVERLAY = (HARNESS / 'OverlayService.java').read_text(encoding='utf-8')
BOOT = (HARNESS / 'BootReceiver.java').read_text(encoding='utf-8')
MANIFEST = (ROOT / 'android-app' / 'AndroidManifest.xml').read_text(encoding='utf-8')
PLUGIN = (ROOT / 'plugins' / 'dsh-tool-shizuku' / 'lib' / 'index.js').read_text(encoding='utf-8')


class Batch85R4TriggerTests(unittest.TestCase):

    def test_event_catalog_covers_expected_events(self) -> None:
        for ev in ('power_connected', 'power_disconnected', 'battery_low', 'battery_okay',
                   'screen_on', 'screen_off', 'headset_plug', 'headset_unplug',
                   'net_connected', 'net_disconnected', 'package_added', 'package_removed',
                   'package_replaced'):
            self.assertIn('"%s"' % ev, ENGINE, ev)

    def test_runtime_registration_is_idempotent_and_wired(self) -> None:
        self.assertIn('public static synchronized void ensureRegistered(Context ctx) {', ENGINE)
        self.assertIn('if (registered) return;', ENGINE)
        # 四个运行期广播源
        for a in ('Intent.ACTION_BATTERY_CHANGED', 'Intent.ACTION_SCREEN_ON', 'Intent.ACTION_SCREEN_OFF',
                  'Intent.ACTION_HEADSET_PLUG', 'ConnectivityManager.CONNECTIVITY_ACTION'):
            self.assertIn(a, ENGINE, a)
        # 三个常驻入口都要注册（OverlayService 常驻 / MainActivity 冷启 / BootReceiver 开机）
        self.assertIn('TriggerEngine.ensureRegistered(this);', OVERLAY)
        self.assertIn('TriggerEngine.ensureRegistered(getApplicationContext());', MAIN)
        self.assertIn('TriggerEngine.ensureRegistered(ctx.getApplicationContext());', BOOT)

    def test_power_and_battery_use_edge_detection(self) -> None:
        # 电源/电量只能靠 ACTION_BATTERY_CHANGED 的边沿（POWER_CONNECTED 等不在隐式广播例外名单）
        self.assertIn('int plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);', ENGINE)
        self.assertIn('sp.edit().putBoolean(KEY_POWER, nowPlugged).apply();', ENGINE)
        self.assertIn('boolean nowLow = pct <= 15;', ENGINE)
        self.assertIn('sp.edit().putBoolean(KEY_LOW, nowLow).apply();', ENGINE)
        self.assertIn('if (sp.contains(KEY_POWER)) {', ENGINE)

    def test_cooldown_prevents_event_storms(self) -> None:
        self.assertIn('long cool = intOf(r[5], 60) * 1000L;', ENGINE)
        self.assertIn('if (cool > 0 && last > 0 && now - last < cool) {', ENGINE)
        self.assertIn('String.valueOf(cooldownSec > 0 ? cooldownSec : 60)', ENGINE)

    def test_storage_schema_and_crud(self) -> None:
        self.assertIn('private static final String FILE_NAME = "triggers.txt";', ENGINE)
        self.assertIn('public static String[] parseLine(String line) {', ENGINE)
        self.assertIn('public static List<String[]> readAll(Context ctx) {', ENGINE)
        self.assertIn('public static String add(Context ctx, String event, String match, String text, int cooldownSec) {', ENGINE)
        self.assertIn('public static boolean remove(Context ctx, String id) {', ENGINE)
        self.assertIn('public static boolean setEnabled(Context ctx, String id, boolean on) {', ENGINE)
        # 行格式：id|event|match|text|enabled|cooldownSec|lastFiredMs（7 段）
        self.assertIn('for (int i = 0; i < 7; i++) r[i] = i < p.length ? p[i] : "";', ENGINE)

    def test_action_reuses_schedule_executor(self) -> None:
        self.assertIn('ScheduleExecutor.execute(app, text);', ENGINE)
        self.assertIn('new Thread(new Runnable() {', ENGINE)   # 不阻塞广播主线程

    def test_manifest_receiver_for_package_events(self) -> None:
        i = MANIFEST.index('.TriggerReceiver')
        seg = MANIFEST[i:i + 700]
        for a in ('PACKAGE_ADDED', 'PACKAGE_REMOVED', 'PACKAGE_REPLACED', 'MY_PACKAGE_REPLACED'):
            self.assertIn(a, seg, a)
        self.assertIn('<data android:scheme="package" />', seg)
        self.assertIn('TriggerEngine.handle(ctx.getApplicationContext(), intent);', RECEIVER)

    def test_route_and_tool_surface(self) -> None:
        self.assertIn('respBody = handleTriggerRequest(rawPath, body.toString());', MAIN)
        self.assertIn('private String handleTriggerRequest(String rawPath, String raw) {', MAIN)
        for act in ('"list"', '"events"', '"add"', '"remove"', '"enable"', '"disable"', '"fire"', '"test"'):
            self.assertIn(act, MAIN, act)
        self.assertIn('name: "android_trigger",', PLUGIN)
        self.assertIn('path: "/trigger",', PLUGIN)
        self.assertIn('action: String(args.action || "list"),', PLUGIN)

    def test_manager_ui_entry_points(self) -> None:
        self.assertIn('private void showTriggerManager() {', MAIN)
        self.assertIn('private View buildTriggerRow(final AlertDialog dialog, final String[] r) {', MAIN)
        # 批次86-P0-3：设置弹窗里的「⚡事件触发器」入口行**撤下**（用户：这些事件没发现用处）——
        # 动作侧目前只有「交给 AI 执行」一种，入口留着只会误导。页面与 summaryText 保留，
        # 等 P1-3 有了直连动作（静音/亮度/WiFi…）再把入口放回来。
        self.assertNotIn('tgText.setText(TriggerEngine.summaryText(this));', MAIN)
        self.assertIn('public static String summaryText(Context ctx) {', ENGINE)
        # 事件清单可点 = 手动模拟（真机验证不依赖真实系统广播）
        self.assertIn('TriggerEngine.dispatchForTest(MainActivity.this, en, "");', MAIN)
        self.assertIn('public static int dispatchForTest(Context ctx, String event, String match) {', ENGINE)


if __name__ == '__main__':
    unittest.main()
