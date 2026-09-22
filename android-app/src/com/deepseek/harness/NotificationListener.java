package com.deepseek.harness;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * 通知读取服务（v1.8.5 能力增强：AI 能看到手机通知）。
 *
 * 用户在系统设置授予「通知读取权限」后，本服务把到达的系统通知记入环形缓冲
 * （每应用保留最新一条，全局上限 50 条），AI 经插件工具 android_notifications
 * → 本地 3081 GET /notifications 查询。仅读取标题/正文/来源应用/时间，不含私密
 * 之外的数据；未授权时查询返回引导文案。
 */
public class NotificationListener extends NotificationListenerService {

    private static final String TAG = "dsh-notif";
    private static final int MAX_ENTRIES = 50;

    /** 单条通知快照：pkg / appName / title / text / when / key。 */
    static final class Entry {
        final String pkg;
        final String appName;
        final String title;
        final String text;
        final long when;
        final String key;

        Entry(String pkg, String appName, String title, String text, long when, String key) {
            this.pkg = pkg;
            this.appName = appName;
            this.title = title;
            this.text = text;
            this.when = when;
            this.key = key;
        }
    }

    /** 最新在前。MainActivity（同进程）经 queryAll() 读取。 */
    private static final Deque<Entry> RECENT = new ArrayDeque<Entry>();
    private static volatile boolean connected = false;

    @Override
    public void onListenerConnected() {
        connected = true;
        Log.i(TAG, "notification listener connected");
        // 补捞当前已有的活动通知（如 App 重启后到达但未清除的）
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active != null) {
                for (int i = active.length - 1; i >= 0; i--) record(active[i]);
            }
        } catch (Throwable t) {
            Log.w(TAG, "seed active notifications failed", t);
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        record(sbn);
    }

    private void record(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        try {
            String pkg = sbn.getPackageName();
            // 自己 App 的通知（AI 通知/保活/审批）不录入，避免自指
            if ("com.deepseek.harness".equals(pkg)) return;
            CharSequence titleCs = null;
            CharSequence textCs = null;
            if (sbn.getNotification().extras != null) {
                titleCs = sbn.getNotification().extras.getCharSequence("android.title");
                textCs = sbn.getNotification().extras.getCharSequence("android.text");
            }
            String title = titleCs == null ? "" : titleCs.toString();
            String text = textCs == null ? "" : textCs.toString();
            if (title.isEmpty() && text.isEmpty()) return;
            String appName = pkg;
            try {
                CharSequence label = getPackageManager().getApplicationLabel(
                        getPackageManager().getApplicationInfo(pkg, 0));
                if (label != null) appName = label.toString();
            } catch (Throwable ignored) {
            }
            synchronized (RECENT) {
                // 同一应用只保留最新一条
                for (Entry e : RECENT) {
                    if (pkg.equals(e.pkg)) {
                        RECENT.remove(e);
                        break;
                    }
                }
                RECENT.addFirst(new Entry(pkg, appName, title, text, sbn.getPostTime(),
                        String.valueOf(sbn.getKey())));
                while (RECENT.size() > MAX_ENTRIES) RECENT.removeLast();
            }
        } catch (Throwable t) {
            Log.w(TAG, "record notification failed", t);
        }
    }

    @Override
    public void onListenerDisconnected() {
        connected = false;
        Log.i(TAG, "notification listener disconnected");
    }

    /** 是否已授权并连接（MainActivity /status 用）。 */
    public static boolean isReady() {
        return connected;
    }

    /** 查询最近通知，JSON 数组文本。limit 上限 50。 */
    public static String queryJson(int limit) {
        try {
            JSONArray arr = new JSONArray();
            synchronized (RECENT) {
                int n = 0;
                for (Entry e : RECENT) {
                    if (n >= limit) break;
                    JSONObject o = new JSONObject();
                    o.put("pkg", e.pkg);
                    o.put("app", e.appName);
                    o.put("title", e.title);
                    o.put("text", e.text);
                    o.put("when", e.when);
                    arr.put(o);
                    n++;
                }
            }
            JSONObject res = new JSONObject();
            res.put("ok", true);
            res.put("granted", connected);
            res.put("count", arr.length());
            res.put("items", arr);
            return res.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }
}
