package com.deepseek.harness;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * 批次47 · 保活与自启链路：开机 / 应用更新 / 快启重启后，把助手浮层服务（{@link OverlayService}）拉回来。
 *
 * <p><b>为什么需要它</b>：{@code OverlayService.onStartCommand} 虽然返回 START_STICKY
 * （进程被系统低内存回收后由系统重建服务），但「设备重启」与「App 被覆盖安装（更新）后」
 * 系统不会重建任何服务；用户若在更新/重启前就开着助手浮层，它会永久消失、只能手动进 App 再打开。
 * 本接收器补上这两条自愈路径。</p>
 *
 * <p><b>只做三件事</b>（onReceive 有 10s 限制，且不能持有 Context 引用）：
 * <ol>
 *   <li>读 {@code dsh_prefs} 的 {@code ball_autostart}（缺省 true）；</li>
 *   <li>为 true 时请求拉起 {@link OverlayService}（Android 8+ 用 startForegroundService）；</li>
 *   <li>打一条 {@code dsh-boot} 日志。任何异常只 Log.w，不抛出、不弹 UI、不起线程。</li>
 * </ol></p>
 *
 * <p><b>偏好键说明</b>：OverlayService 自身<b>不</b>持久化「助手浮层是否被用户开启过」——它只在
 * {@code dsh_prefs} 下写 {@code engine_port} 与 {@code overlay_user_width/height}
 * （常量见 OverlayService.java 顶部的 PREFS / KEY_PORT / PREF_CARD_*；具体行号随主线改动会漂移，
 * 故此处只引符号名），后者只记录尺寸，无法区分「用户从未开过球」与「用户主动关掉过球」。
 * 该语义由 MainActivity 的 {@code PREF_BALL_AUTOSTART = "ball_autostart"} 承担：
 * {@code startOverlayService()} 写 true、{@code stopOverlayService()} 写 false。</p>
 *
 * <p>本接收器因此<b>与 MainActivity 同键</b>：只认 {@code dsh_prefs.ball_autostart}，缺省 true
 * （保证全新安装、用户从未表过态时，开机/更新后仍是「装完即用、球常在」）。</p>
 *
 * <p><b>已知语义漏洞（不在本类范围内，勿在此处顺手改）</b>：MainActivity 的 {@code startEngine()} 每次启动
 * 都会调用 {@code startOverlayService()}（仅以「已授权悬浮窗」为条件，且其中会回写 {@code ball_autostart=true}），所以用户「关闭球」
 * 的选择会在下次打开 App 时被覆盖——要严格尊重用户选择，需在那条调用点加 {@code ball_autostart} 判断。</p>
 *
 * <p><b>Manifest 声明</b>：需 {@code RECEIVE_BOOT_COMPLETED} 权限，以及
 * {@code <receiver android:name=".BootReceiver" android:exported="true">} + BOOT_COMPLETED /
 * MY_PACKAGE_REPLACED / QUICKBOOT_POWERON 三个 intent-filter（BOOT_COMPLETED 与厂商私有的
 * QUICKBOOT_POWERON 均要求 exported=true 才能送达）。</p>
 */
public class BootReceiver extends BroadcastReceiver {

    /** 日志 TAG：与包内 dsh-* 惯例一致（dsh-overlay / dsh-schedule …）。 */
    private static final String TAG = "dsh-boot";

    /** 偏好文件名：与 OverlayService.java:71、MainActivity.java:4014 的 "dsh_prefs" 同一份。 */
    private static final String PREFS = "dsh_prefs";

    /** 自启开关：缺省 true。 */
    private static final String KEY_BALL_AUTOSTART = "ball_autostart";

    /** 厂商快启：部分 ROM 用私有 action 代替 BOOT_COMPLETED，漏接会导致重启后不自启。 */
    private static final String ACTION_QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON";
    /** HTC 系私有快启 action（同一处理，零成本覆盖）。 */
    private static final String ACTION_QUICKBOOT_POWERON_HTC = "com.htc.intent.action.QUICKBOOT_POWERON";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        // 只做「读一个布尔 + 提交一个 startService intent」：不建线程、不建通知、不做磁盘/网络 I/O，
        // 也不把 ctx 存进任何静态字段（防内存泄漏，也防 onReceive 超时）。
        if (ctx == null || intent == null) return;
        // 批次85-R4：事件触发器的系统广播可能在 App 进程未运行时拉起本接收器（如包安装/卸载），先交给触发器匹配。
        if (TriggerEngine.count(ctx.getApplicationContext()) > 0) {
            try { TriggerEngine.handle(ctx.getApplicationContext(), intent); } catch (Throwable ignored) {}
            TriggerEngine.ensureRegistered(ctx.getApplicationContext());
        }

        String action = intent.getAction();
        // 白名单校验：即使 Manifest 过滤写错，也不会被其它 action 误触发。
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                && !ACTION_QUICKBOOT_POWERON.equals(action)
                && !ACTION_QUICKBOOT_POWERON_HTC.equals(action)) {
            return;
        }

        // 1) 读自启开关，缺省 true；读失败（极端情况：存储不可用）按缺省值继续，不阻断自启动。
        boolean autostart = true;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            autostart = sp.getBoolean(KEY_BALL_AUTOSTART, true);
        } catch (Throwable t) {
            Log.w(TAG, "[b47] 读取 " + PREFS + "/" + KEY_BALL_AUTOSTART + " 失败，按缺省 true 处理", t);
        }

        // 2) 用户明确关过自启 → 尊重用户选择，只记录不拉起。
        if (!autostart) {
            Log.i(TAG, "[b47] 开机/更新自启：跳过（autostart=false, action=" + action + ")");
            return;
        }

        // 3) 拉起助手浮层前台服务。Android 8+ 从后台启动服务必须用 startForegroundService，
        //    且 OverlayService.onCreate 会立刻调用 startForegroundCompat() → startForeground()，
        //    满足「5s 内 startForeground」的约束；低版本（minSdk 24 见 AndroidManifest）退回 startService。
        try {
            Intent svc = new Intent(ctx, OverlayService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                ctx.startForegroundService(svc);
            } else {
                ctx.startService(svc);
            }
            // 4) 留痕：真机取证可直接 adb logcat -s dsh-boot:I 确认自启链路是否走到。
            Log.i(TAG, "[b47] 开机/更新自启：已请求拉起助手浮层 (autostart=" + autostart + ")");
            // 批次67：引擎也要在重启后回来。托管可用（Shizuku 在线）→ 直接由 shell 托管拉起，不弹 UI；
            // 否则退回 App 内模式（静默唤起 MainActivity，由它按单飞闸门拉起引擎）。
            try {
                if (HostedEngineManager.hostedUsable(ctx)) {
                    final Context app = ctx.getApplicationContext();
                    new Thread(new Runnable() {
                        @Override public void run() { HostedEngineManager.ensureRunning(app); }
                    }, "b67-boot-hosted").start();
                    Log.i(TAG, "[b67] 开机自启：请求托管引擎常驻");
                } else {
                    Intent eng = new Intent(ctx, MainActivity.class);
                    eng.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    eng.putExtra("action_launch_engine", true);
                    eng.putExtra("silent", true);
                    ctx.startActivity(eng);
                    Log.i(TAG, "[b67] 开机自启：静默唤起 MainActivity 拉起 App 内引擎");
                }
            } catch (Throwable t) {
                Log.w(TAG, "[b67] 拉起引擎失败: " + t.getMessage(), t);
            }
        } catch (Throwable t) {
            // 常见异常：后台启动前台服务被系统拒绝（ForegroundServiceStartNotAllowed）、
            // 或厂商自启动管理拦截。只警告，不抛出（避免「应用无响应 / 已停止运行」提示）。
            Log.w(TAG, "[b47] 拉起 OverlayService 失败: " + t.getMessage(), t);
        }
    }
}
