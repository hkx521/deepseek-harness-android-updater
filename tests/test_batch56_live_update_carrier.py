from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
NOTIFIER_SRC = (PKG / 'PromotedProgressNotifier.java').read_text(encoding='utf-8')
MANIFEST_SRC = (ROOT / 'android-app' / 'AndroidManifest.xml').read_text(encoding='utf-8')

# 批次55 已声明（本轮不得新增任何权限；Android 16 实况窗准入靠它，属既有事实）
PERM_POST_PROMOTED = 'android.permission.POST_PROMOTED_NOTIFICATIONS'
# 批次56-A 冻结的权限基线（16 条，与 android-app/AndroidManifest.xml 完全一致）
BASELINE_PERMISSIONS = (
    'moe.shizuku.manager.permission.API_V23',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.INTERNET',
    'android.permission.MANAGE_EXTERNAL_STORAGE',
    'android.permission.PACKAGE_USAGE_STATS',
    'android.permission.POST_NOTIFICATIONS',
    PERM_POST_PROMOTED,
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    'android.permission.REQUEST_INSTALL_PACKAGES',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.WAKE_LOCK',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.WRITE_SETTINGS',
)


def method_body(src: str, signature: str) -> str:
    '''截取某个方法的源码片段（从签名到该方法 4 空格缩进的收尾括号）。'''
    start = src.index(signature)
    end = src.index('\n    }', start)
    return src[start:end + len('\n    }')]


def int_constant(name: str) -> int:
    m = re.search(r'private static final int ' + name + r' = (\d+);', NOTIFIER_SRC)
    assert m is not None, '缺常量：' + name
    return int(m.group(1))


def long_constant(name: str) -> int:
    m = re.search(r'private static final long ' + name + r' = (\d+)L;', NOTIFIER_SRC)
    assert m is not None, '缺常量：' + name
    return int(m.group(1))


def duration_label(secs: int) -> str:
    '''镜像 Java durationLabel(long)：45s / 12m3s / 1h5m。'''
    if secs >= 3600:
        return '%dh%dm' % (secs // 3600, (secs % 3600) // 60)
    if secs >= 60:
        return '%dm%ds' % (secs // 60, secs % 60)
    return '%ds' % secs


def short_label(step: int, elapsed_secs: int, max_segments: int = 20) -> str:
    '''镜像 Java shortLabel(long)：带耗时，超长则退回纯状态样式。'''
    base = '运行中' if step < 1 else ('步骤%d' % min(step, max_segments))
    if elapsed_secs <= 0:
        return base
    with_elapsed = base + ' · ' + duration_label(elapsed_secs)
    return with_elapsed if len(with_elapsed) <= int_constant('MAX_SHORT') else base


class Batch56RunInfoOnSystemCapsuleTests(unittest.TestCase):
    '''批次56-A：isRunInfoOnSystemCapsule = 「运行信息已由系统胶囊承载」的唯一判据。'''

    SIGNATURE = 'public static boolean isRunInfoOnSystemCapsule(Context ctx)'

    def test_api_signature(self) -> None:
        self.assertIn(self.SIGNATURE, NOTIFIER_SRC)
        body = method_body(NOTIFIER_SRC, self.SIGNATURE)
        self.assertTrue(body.startswith(self.SIGNATURE), body)
        # API 36 才有 canPostPromotedNotifications()：整个方法必须带 @TargetApi(36)
        head = NOTIFIER_SRC[:NOTIFIER_SRC.index(self.SIGNATURE)]
        self.assertTrue(head.rstrip().endswith('@TargetApi(MIN_SDK)'), '缺 @TargetApi(MIN_SDK)')

    def test_three_gates_in_order(self) -> None:
        '''三个条件缺一不可：开关 → SDK>=36 → canPostPromotedNotifications()；
        且最便宜的判据在前（null / 版本 / 开关都先于跨进程查询）。'''
        body = method_body(NOTIFIER_SRC, self.SIGNATURE)
        self.assertIn('if (ctx == null) return false;', body)
        self.assertIn('if (Build.VERSION.SDK_INT < MIN_SDK) return false;', body)
        self.assertIn('if (!isEnabled(ctx)) return false;', body)
        self.assertIn('return nm.canPostPromotedNotifications();', body)
        order = [
            body.index('if (ctx == null) return false;'),
            body.index('if (Build.VERSION.SDK_INT < MIN_SDK) return false;'),
            body.index('if (!isEnabled(ctx)) return false;'),
            body.index('return nm.canPostPromotedNotifications();'),
        ]
        self.assertEqual(order, sorted(order), '门控顺序被改：' + str(order))
        self.assertEqual(body.count('canPostPromotedNotifications()'), 1)

    def test_fail_closed_on_null_and_exception(self) -> None:
        '''ctx == null / 服务缺失 / 任何异常 → false（保守：退回自绘胶囊兜底）。'''
        body = method_body(NOTIFIER_SRC, self.SIGNATURE)
        self.assertIn('Context app = ctx.getApplicationContext();', body)
        self.assertIn('if (app == null) return false;', body)
        self.assertIn('if (nm == null) return false;', body)
        self.assertGreaterEqual(body.count('return false;'), 6)
        catch_tail = body.split('catch (Throwable t)')[-1]
        self.assertIn('isRunInfoOnSystemCapsule failed', catch_tail)
        self.assertIn('return false;', catch_tail)

    def test_uses_same_switch_and_manager_as_post_path(self) -> None:
        '''判据必须与本类真实发通知用同一开关 / 同一服务，不能另起一套。'''
        self.assertIn('public static final String KEY_ENABLED = "promoted_live_update";', NOTIFIER_SRC)
        self.assertIn('private static final String PREFS = "dsh_prefs";', NOTIFIER_SRC)
        self.assertIn('private static final int MIN_SDK = 36;', NOTIFIER_SRC)
        self.assertIn('(NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE)',
                      NOTIFIER_SRC)


class Batch56UpdateWithElapsedTests(unittest.TestCase):
    '''批次56-A：update() 4 参版本把耗时带进右侧短文案，3 参版本仅委托。'''

    SIG3 = 'public static void update(Context ctx, String text, int stepNumber)'
    SIG4 = 'public static void update(Context ctx, String text, int stepNumber, long elapsedSecs)'

    def test_both_overloads_exist(self) -> None:
        self.assertIn(self.SIG3 + ' {', NOTIFIER_SRC)
        self.assertIn(self.SIG4 + ' {', NOTIFIER_SRC)
        self.assertEqual(NOTIFIER_SRC.count('public static void update(Context ctx'), 2)

    def test_three_arg_delegates_with_zero_elapsed(self) -> None:
        '''老调用点（3 参）不得内联重复逻辑：等价 elapsedSecs = 0。'''
        body = method_body(NOTIFIER_SRC, self.SIG3)
        self.assertIn('update(ctx, text, stepNumber, 0L);', body)
        self.assertNotIn('shortLabel', body)
        self.assertNotIn('post(', body)

    def test_four_arg_keeps_title_text_progress_semantics(self) -> None:
        body = method_body(NOTIFIER_SRC, self.SIG4)
        self.assertIn('if (!active) return;', body)           # 非活动态零行为
        self.assertIn('if (stepNumber > step) step = stepNumber;', body)
        self.assertIn('int total = step < 1 ? 1 : step;', body)
        # 标题 / 正文 / 进度段语义与 3 参版本一致，只有 shortText 参数不同
        self.assertIn('post(ctx, title, text, total, total, shortLabel(elapsedSecs))', body)
        self.assertIn('if (elapsedSecs < 0L) elapsedSecs = 0L;', body)
        self.assertIn('lastText = text;', body)
        self.assertIn('lastElapsedSecs = elapsedSecs;', body)

    def test_short_text_contract_and_cap(self) -> None:
        '''短文案形如 "步骤2 · 45s" / "运行中 · 12s"，总长 <= MAX_SHORT=15，超长退回纯状态。'''
        self.assertEqual(int_constant('MAX_SHORT'), 15)
        self.assertIn('" · "', NOTIFIER_SRC)
        self.assertIn('private static String shortLabel(long elapsedSecs) {', NOTIFIER_SRC)
        self.assertIn('if (elapsedSecs <= 0L) return base;', NOTIFIER_SRC)
        self.assertIn('return withElapsed.length() <= MAX_SHORT ? withElapsed : base;', NOTIFIER_SRC)
        self.assertIn('return secs + "s";', NOTIFIER_SRC)
        self.assertIn('return (secs / 60L) + "m" + (secs % 60L) + "s";', NOTIFIER_SRC)
        self.assertIn('return (secs / 3600L) + "h" + ((secs % 3600L) / 60L) + "m";', NOTIFIER_SRC)

    def test_documented_examples_fit_budget(self) -> None:
        self.assertIn('"步骤2 · 45s"', NOTIFIER_SRC)
        self.assertIn('"运行中 · 12s"', NOTIFIER_SRC)
        self.assertLessEqual(len('步骤2 · 45s'), 15)
        self.assertLessEqual(len('运行中 · 12s'), 15)

    def test_short_label_mirror_invariants(self) -> None:
        '''镜像验证：任何步骤号 / 一天内的耗时都带得上耗时且不超 15 字符；
        极端长任务则回退为纯状态样式（绝不截断出半个字）。'''
        self.assertEqual(short_label(2, 45), '步骤2 · 45s')
        self.assertEqual(short_label(0, 12), '运行中 · 12s')
        self.assertEqual(short_label(2, 0), '步骤2')          # <=0 → 现有样式
        self.assertEqual(short_label(0, -5), '运行中')
        for step in (0, 1, 2, 20, 200):
            for secs in (1, 45, 59, 60, 61, 599, 3599, 3600, 86399, 86400):
                label = short_label(step, secs)
                self.assertLessEqual(len(label), 15, (step, secs, label))
                self.assertIn(' · ', label, (step, secs, label))   # 一天内总是带耗时
        self.assertEqual(short_label(20, 999999999), '步骤20')     # 超长 → 由守卫退回纯状态


class Batch56HeartbeatTests(unittest.TestCase):
    '''批次56-A：活跃期心跳（240000ms）——防 MagicOS 5 分钟胶囊收缩。'''

    def test_interval_constant_is_240000(self) -> None:
        self.assertEqual(long_constant('HEARTBEAT_INTERVAL_MS'), 240000)
        self.assertIn('private static final long HEARTBEAT_INTERVAL_MS = 240000L;', NOTIFIER_SRC)
        # 依据必须写死在注释里：MagicOS mCapsuleExpandDuration = 300000，比它更频繁
        self.assertIn('mCapsuleExpandDuration = 300000', NOTIFIER_SRC)

    def test_scheduled_by_update_and_start(self) -> None:
        '''update() 触发/重排；start() 也排期——「单步长时间无回报」才是收缩场景。'''
        update4 = method_body(NOTIFIER_SRC, Batch56UpdateWithElapsedTests.SIG4)
        self.assertIn('if (shown) scheduleHeartbeat(ctx);', update4)
        start = method_body(NOTIFIER_SRC, 'public static void start(Context ctx, String text)')
        self.assertIn('if (active) {', start)
        self.assertIn('scheduleHeartbeat(ctx);', start)
        self.assertIn('lastText = text;', start)

    def test_main_thread_handler_and_delay(self) -> None:
        self.assertIn('private static void scheduleHeartbeat(Context ctx) {', NOTIFIER_SRC)
        body = method_body(NOTIFIER_SRC, 'private static void scheduleHeartbeat(Context ctx)')
        self.assertIn('Handler h = mainHandler();', body)
        self.assertIn('if (h == null) return;', body)
        self.assertIn('final Context app = ctx.getApplicationContext();', body)
        self.assertIn('h.postDelayed(heartbeat, HEARTBEAT_INTERVAL_MS);', body)
        self.assertIn('handler = new Handler(Looper.getMainLooper());', NOTIFIER_SRC)
        self.assertIn('private static Runnable heartbeat;', NOTIFIER_SRC)

    def test_heartbeat_reraises_and_keeps_gates(self) -> None:
        '''心跳 runnable：单实例、重排、门控齐全、异常静默。'''
        body = method_body(NOTIFIER_SRC, 'private static void scheduleHeartbeat(Context ctx)')
        self.assertIn('heartbeat = new Runnable() {', body)
        self.assertIn('heartbeat = null;', body)
        self.assertIn('if (!active) return;', body)
        self.assertIn('if (Build.VERSION.SDK_INT < MIN_SDK) return;', body)
        self.assertIn('if (!isEnabled(app)) return;', body)
        self.assertIn('scheduleHeartbeat(app);', body)          # 发出成功才续期
        self.assertIn('Log.w(TAG, "heartbeat failed: " + t);', body)
        self.assertIn('"heartbeat id=" + NOTIF_ID', body)
        # 复用同一通知：心跳不再自建 Notification / channel / id
        self.assertNotIn('nm.notify', body)
        self.assertNotIn('Notification.Builder', body)
        self.assertNotIn('ensureChannel', body)

    def test_cancelled_by_finish_and_stop(self) -> None:
        self.assertIn('private static void cancelHeartbeat() {', NOTIFIER_SRC)
        cancel = method_body(NOTIFIER_SRC, 'private static void cancelHeartbeat()')
        self.assertIn('handler.removeCallbacks(heartbeat);', cancel)
        self.assertIn('heartbeat = null;', cancel)
        # 批次82-N1：两参 finish 变成 3 参重载的薄转发，心跳收尾契约落到 3 参实现里
        finish = method_body(
            NOTIFIER_SRC,
            'public static void finish(Context ctx, String text, boolean allowProceed)',
        )
        self.assertIn('cancelHeartbeat();', finish)
        stop = method_body(NOTIFIER_SRC, 'public static void stop(Context ctx)')
        self.assertIn('cancelHeartbeat();', stop)
        # finish 里必须在 active=false 之前就停心跳（否则完成态 5s 后被心跳捞起）
        self.assertLess(finish.index('cancelHeartbeat();'), finish.index('active = false;'))
        # stop 复位心跳用的残留状态
        self.assertIn('lastText = "";', stop)
        self.assertIn('lastElapsedSecs = 0L;', stop)

    def test_cancel_is_idempotent_and_silent(self) -> None:
        cancel = method_body(NOTIFIER_SRC, 'private static void cancelHeartbeat()')
        self.assertIn('try {', cancel)
        self.assertIn('} catch (Throwable ignored) {}', cancel)
        self.assertIn('private static void cancelHeartbeat() {\n        try {', NOTIFIER_SRC)


class Batch56ZeroBehaviorGateTests(unittest.TestCase):
    '''批次56-A：SDK>=36 门控、开关关闭零行为、异常零副作用、权限零新增。'''

    def test_sdk_gate_still_holds_everywhere(self) -> None:
        self.assertIn('private static final int MIN_SDK = 36;', NOTIFIER_SRC)
        post = method_body(NOTIFIER_SRC, 'private static boolean post(Context ctx, String titleText,')
        self.assertIn('if (Build.VERSION.SDK_INT < MIN_SDK) return false;', post)
        self.assertIn('if (!isEnabled(ctx)) return false;', post)
        heartbeat = method_body(NOTIFIER_SRC, 'private static void scheduleHeartbeat(Context ctx)')
        self.assertIn('if (Build.VERSION.SDK_INT < MIN_SDK) return;', heartbeat)
        self.assertIn('if (!isEnabled(app)) return;', heartbeat)
        gate = method_body(NOTIFIER_SRC, Batch56RunInfoOnSystemCapsuleTests.SIGNATURE)
        self.assertIn('if (Build.VERSION.SDK_INT < MIN_SDK) return false;', gate)
        self.assertIn('if (!isEnabled(ctx)) return false;', gate)

    def test_switch_key_and_default_unchanged(self) -> None:
        self.assertIn('public static final String KEY_ENABLED = "promoted_live_update";', NOTIFIER_SRC)
        self.assertIn('sp.getBoolean(KEY_ENABLED, true)', NOTIFIER_SRC)
        self.assertIn('public static final String CHANNEL_ID = "dsh_live_update";', NOTIFIER_SRC)
        self.assertIn('public static final int NOTIF_ID = 0x55A1;', NOTIFIER_SRC)

    def test_no_swallowed_side_effects(self) -> None:
        '''异常只留一行日志：不 printStackTrace、不 System.err、不抛给主流程。'''
        self.assertNotIn('printStackTrace', NOTIFIER_SRC)
        self.assertNotIn('System.err', NOTIFIER_SRC)
        self.assertNotIn('throw new', NOTIFIER_SRC)
        self.assertEqual(NOTIFIER_SRC.count('} catch (Throwable'), NOTIFIER_SRC.count('catch (Throwable'))

    def test_no_new_permission(self) -> None:
        '''本类不得声明/请求任何权限；权限基线必须与批次56-A 冻结值完全一致。'''
        self.assertNotIn('uses-permission', NOTIFIER_SRC)
        self.assertNotIn('permission.', NOTIFIER_SRC)
        declared = sorted(set(re.findall(r'<uses-permission\s+android:name="([^"]+)"', MANIFEST_SRC)))
        self.assertEqual(declared, sorted(BASELINE_PERMISSIONS),
                         '权限集变化（本轮禁止新增/删除权限）')

    def test_targetsdk_and_versioncode_untouched(self) -> None:
        self.assertIn('<uses-sdk android:minSdkVersion="24" android:targetSdkVersion="28" />',
                      MANIFEST_SRC)
        self.assertIn('android:versionCode="28"', MANIFEST_SRC)


if __name__ == '__main__':
    unittest.main()
