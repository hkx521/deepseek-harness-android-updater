package com.deepseek.harness;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import java.util.Locale;

/**
 * 定时任务闹钟接收器（⑥ 全自动版）：
 * AI 通过 android_schedule 设置定时后，MainActivity 用 AlarmManager 注册系统闹钟；
 * 到点时系统唤醒本接收器（即使 App 被杀也能触发）：
 *   1) 推送通知提醒（任务文本同时追加到执行日志，防丢失）
 *   2) 启动前台服务 EngineService（带任务 extra）→ 后台执行任务（ScheduleExecutor）
 *      —— 前台服务进程不会被系统回收，保证任务真正执行（不依赖 Activity/用户操作）
 */
public class AlarmReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "dsh_schedule";
    private static final int NOTIF_ID = 9001;
    private static final String TAG = "dsh-schedule";
    /** 批次67：引擎探活周期（15 分钟；Doze 下靠精确闹钟唤醒）。 */
    private static final long ENGINE_PROBE_INTERVAL_MS = 15L * 60L * 1000L;
    private static final int ENGINE_PROBE_REQ = 9020;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            // 批次67：引擎探活闹钟（不是定时任务）——提前返回，别走通知/执行链路
            if (intent != null && intent.getBooleanExtra("engineProbe", false)) {
                handleEngineProbe(ctx);
                return;
            }
            String task = intent != null ? intent.getStringExtra("task") : null;
            String taskId = intent != null ? intent.getStringExtra("taskId") : null;
            if (task == null || task.isEmpty()) task = "定时任务时间到了";

            ScheduleExecutor.log(ctx, "闹钟触发 taskId=" + (taskId == null ? "?" : taskId) + " task=" + task);

            // 1) 推送通知（内容 = 任务文本；点击打开 App 可查看执行情况）
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                if (Build.VERSION.SDK_INT >= 26) {
                    NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "定时任务",
                            NotificationManager.IMPORTANCE_HIGH);
                    ch.setDescription("AI 设置的定时提醒");
                    nm.createNotificationChannel(ch);
                }
                Intent open = new Intent(ctx, MainActivity.class);
                open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
                PendingIntent pi = PendingIntent.getActivity(ctx, 0, open,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notification.Builder b;
                if (Build.VERSION.SDK_INT >= 26) {
                    b = new Notification.Builder(ctx, CHANNEL_ID);
                } else {
                    b = new Notification.Builder(ctx);
                }
                Notification n = b.setContentTitle("⏰ 定时任务")
                        .setContentText(task)
                        .setSmallIcon(R.drawable.ic_launcher)
                        .setContentIntent(pi)
                        .setAutoCancel(true)
                        .build();
                nm.notify(NOTIF_ID, n);
            }

            // 2) 启动前台服务执行任务（前台服务不会被杀，保证执行完成）
            try {
                Intent svc = new Intent(ctx, EngineService.class);
                svc.putExtra("scheduledTask", task);
                if (Build.VERSION.SDK_INT >= 26) {
                    ctx.startForegroundService(svc);
                } else {
                    ctx.startService(svc);
                }
            } catch (Throwable t) {
                ScheduleExecutor.log(ctx, "启动执行服务失败: " + t.getMessage());
            }

            // 3) 重复任务（Kun 式调度）：daily/interval 到点后自动安排下一次
            try {
                String repeatType = intent != null ? intent.getStringExtra("repeatType") : null;
                int intervalMin = intent != null ? intent.getIntExtra("intervalMin", 0) : 0;
                long origAt = intent != null ? intent.getLongExtra("triggerAt", 0L) : 0L;
                if (repeatType != null && !repeatType.isEmpty() && !repeatType.equals("once")) {
                    long nextAt = 0L;
                    if (repeatType.equals("interval") && intervalMin > 0) {
                        nextAt = System.currentTimeMillis() + intervalMin * 60L * 1000L;
                    } else if (repeatType.equals("daily")) {
                        // 批次88 修 D9：原来只 +24h 一次，迟到 >24h（关机/Doze 跨天）时
                        // nextAt 仍落在过去 → 下面的守卫不成立 → 既不落盘也不注册，
                        // 表现是「每天」任务静默停止重复，界面却仍显示「每天 · 启用」。
                        // 与 MainActivity.registerScheduledAlarm 的 while 顺延口径对齐。
                        nextAt = origAt > 0 ? origAt + 24L * 3600L * 1000L
                                : System.currentTimeMillis() + 24L * 3600L * 1000L;
                        while (nextAt <= System.currentTimeMillis()) {
                            nextAt += 24L * 3600L * 1000L;
                        }
                    }
                    if (nextAt > System.currentTimeMillis()) {
                        ScheduleExecutor.log(ctx, "重复任务下次触发: " + repeatType + " @ "
                                + new java.text.SimpleDateFormat("MM-dd HH:mm:ss", Locale.US)
                                        .format(new java.util.Date(nextAt)));
                        saveRepeatTask(ctx, taskId, task, nextAt, repeatType, intervalMin);
                        registerNextAlarm(ctx, task, taskId, nextAt, repeatType, intervalMin);
                    }
                }
            } catch (Throwable t) {
                ScheduleExecutor.log(ctx, "安排下次触发失败: " + t.getMessage());
            }
        } catch (Throwable t) {
            // 静默：闹钟触发失败不应崩溃
        }
    }

    // ====================================================================================
    // 批次67：引擎探活（Shizuku 托管掉线 / App 内模式被清 的兜底发现与自愈）
    // ====================================================================================

    /** 注册下一次引擎探活闹钟（幂等；无精确闹钟权限时逐级降级到不精确 set）。 */
    public static void scheduleEngineProbe(Context ctx) {
        try {
            android.app.AlarmManager am =
                    (android.app.AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long at = System.currentTimeMillis() + ENGINE_PROBE_INTERVAL_MS;
            Intent i = new Intent(ctx, AlarmReceiver.class);
            i.putExtra("engineProbe", true);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, ENGINE_PROBE_REQ, i,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            try {
                if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                } else {
                    am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                }
            } catch (Throwable t) {
                am.set(android.app.AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Throwable t) {
            Log.w(TAG, "[b67] scheduleEngineProbe failed", t);
        }
    }

    /**
     * 探活：先自续期，再看引擎是否在线。
     * <p>托管可用且引擎掉线 → 交给 shell 直接拉起（不弹 UI）；否则退回 App 内自愈（静默唤起 MainActivity）。</p>
     */
    private static void handleEngineProbe(final Context ctx) {
        try {
            scheduleEngineProbe(ctx);
            if (HostedEngineManager.engineOnline(ctx)) {
                if (HostedEngineManager.hostedUsable(ctx)) HostedEngineManager.startWatchdog(ctx);
                Log.i(TAG, "[b67] engine probe: online");
                return;
            }
            Log.i(TAG, "[b67] engine probe: offline -> revive");
            if (HostedEngineManager.hostedUsable(ctx)) {
                final Context app = ctx.getApplicationContext();
                new Thread(new Runnable() {
                    @Override public void run() { HostedEngineManager.ensureRunning(app); }
                }, "b67-probe-hosted").start();
                return;
            }
            Intent open = new Intent(ctx, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra("action_launch_engine", true);
            open.putExtra("silent", true);
            ctx.startActivity(open);
        } catch (Throwable t) {
            Log.w(TAG, "[b67] engine probe failed", t);
        }
    }

    /** 追加一条重复任务记录（与 MainActivity.saveScheduledTask 同格式）。 */
    private static void saveRepeatTask(Context ctx, String taskId, String text, long triggerAt,
                                       String repeatType, int intervalMin) {
        try {
            java.io.File f = new java.io.File(ctx.getFilesDir(), "scheduled-tasks.json");
            String line = taskId + "|" + triggerAt + "|" + repeatType + "|" + intervalMin + "|"
                    + text.replace("|", " ").replace("\n", " ") + "\n";
            java.io.FileOutputStream fos = new java.io.FileOutputStream(f, true);
            fos.write(line.getBytes("UTF-8"));
            fos.close();
        } catch (Throwable ignored) {}
    }

    /** 注册下一次闹钟（与 MainActivity 同款 setAlarmClock 最高优先级，Doze 也触发）。 */
    private static void registerNextAlarm(Context ctx, String task, String taskId, long triggerAt,
                                          String repeatType, int intervalMin) {
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            Intent i = new Intent(ctx, AlarmReceiver.class);
            i.putExtra("task", task);
            i.putExtra("taskId", taskId);
            i.putExtra("repeatType", repeatType);
            i.putExtra("intervalMin", intervalMin);
            i.putExtra("triggerAt", triggerAt);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, taskId.hashCode(), i,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (Build.VERSION.SDK_INT >= 21) {
                Intent show = new Intent(ctx, MainActivity.class);
                show.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent showPi = PendingIntent.getActivity(ctx, 1, show,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new android.app.AlarmManager.AlarmClockInfo(triggerAt, showPi), pi);
            } else {
                am.setExact(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        } catch (Throwable t) {
            ScheduleExecutor.log(ctx, "注册下次闹钟失败: " + t.getMessage());
        }
    }
}
