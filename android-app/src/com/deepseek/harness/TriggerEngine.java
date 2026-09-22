package com.deepseek.harness;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.os.BatteryManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;

/**
 * 批次85-R4：事件触发器（Trigger）MVP —— 让自动化从「定时」升级为「事件驱动」。
 *
 * <p>在此之前全项目只有两个触发器：<b>开机</b>（BootReceiver）与<b>定时</b>（AlarmReceiver）。
 * 对标 MacroDroid / Tasker / 快捷指令，「触发器 × 动作」才是自动化的核心，而动作一侧我们早已齐备
 * （{@link ScheduleExecutor#execute} 能后台拉起引擎、建会话、把任务文本交给 AI 执行）。本类补触发器一侧。</p>
 *
 * <h3>事件来源</h3>
 * <ul>
 *   <li><b>运行期注册</b>（{@link #ensureRegistered}，由 OverlayService / MainActivity / BootReceiver 调用）：
 *       电量与电源、亮灭屏、耳机插拔、网络连通性。</li>
 *   <li><b>清单注册</b>（TriggerReceiver）：包安装/卸载/替换 —— 这类广播在 Android 8+ 的隐式广播限制里属于例外，
 *       清单注册可在 App 进程未运行时也收到。</li>
 * </ul>
 *
 * <h3>为什么电源/电量也走 ACTION_BATTERY_CHANGED</h3>
 * ACTION_POWER_CONNECTED / ACTION_BATTERY_LOW <b>不在</b> Android 8+ 隐式广播例外名单里，targetSdk 28 下
 * 清单注册收不到、运行期注册也收不全；而 sticky 的 ACTION_BATTERY_CHANGED 在运行期一定可达，
 * 于是用「记住上次状态 + 边沿触发」实现，代价是需要持久化上一次状态（见 KEY_POWER / KEY_LOW）。
 *
 * <h3>防抖 / 防环</h3>
 * 每条触发器带 cooldownSec（默认 60s），命中后把「上次触发时刻」写进文件；触发动作本身是异步的
 * （{@link ScheduleExecutor#execute} 会起线程），不阻塞广播主线程。
 *
 * <h3>存储</h3>
 * filesDir/triggers.txt，逐行 id|event|match|text|enabled|cooldownSec|lastFiredMs；
 * match 只对 package_* 有意义（包名，支持 * 或留空 = 任意）。
 *
 * <p>实现约定：本文件不使用反斜杠字面量（换行/竖线/引号一律用字符常量或 Pattern.quote），
 * 以免在多语言工具链里被吃掉转义。</p>
 */
public final class TriggerEngine {
    private static final String TAG = "dsh-trigger";
    private static final String PREFS = "dsh_prefs";
    private static final String FILE_NAME = "triggers.txt";
    /** 上次电源/电量/网络状态（边沿判定用）。 */
    private static final String KEY_POWER = "trig_power_plugged";
    private static final String KEY_LOW = "trig_batt_low";
    private static final String KEY_NET = "trig_net_up";
    private static final char NL = (char) 10;
    private static final char CR = (char) 13;
    private static final String BAR = "|";

    /** 事件 → 中文标签（顺序即 UI 顺序）。 */
    public static final String[][] EVENTS = {
            {"power_connected", "接通电源"},
            {"power_disconnected", "断开电源"},
            {"battery_low", "电量低（≤15%）"},
            {"battery_okay", "电量恢复（>15%）"},
            {"screen_on", "屏幕亮起"},
            {"screen_off", "屏幕熄灭"},
            {"headset_plug", "插入耳机"},
            {"headset_unplug", "拔出耳机"},
            {"net_connected", "网络连通"},
            {"net_disconnected", "网络断开"},
            {"package_added", "安装了应用"},
            {"package_removed", "卸载了应用"},
            {"package_replaced", "应用被更新"},
    };

    private static boolean registered = false;

    /**
     * 内存缓存（批次85-R4 修正）：ACTION_BATTERY_CHANGED 是 sticky 且高频的广播，onReceive 在**主线程**；
     * 若每次都 readAll() 就是「每次电量变化都在主线程读一次文件」—— 真机上会让面板入场动画掉帧
     * （e2e 量到 settled_width 由 1010 掉到 912）。单进程独占该文件，故用静态缓存 + 写时同步即可。
     */
    private static volatile List<String[]> CACHE = null;

    private TriggerEngine() {}

    public static String label(String event) {
        for (String[] e : EVENTS) if (e[0].equals(event)) return e[1];
        return event;
    }

    public static boolean isKnownEvent(String event) {
        for (String[] e : EVENTS) if (e[0].equals(event)) return true;
        return false;
    }

    private static File file(Context ctx) { return new File(ctx.getFilesDir(), FILE_NAME); }

    public static String[] parseLine(String line) {
        if (line == null || line.trim().isEmpty()) return null;
        String[] p = line.split(java.util.regex.Pattern.quote(BAR), -1);
        if (p.length < 5) return null;
        String[] r = new String[7];
        for (int i = 0; i < 7; i++) r[i] = i < p.length ? p[i] : "";
        if (r[5].isEmpty()) r[5] = "60";
        if (r[6].isEmpty()) r[6] = "0";
        return r;
    }

    private static String join(String[] r) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 7; i++) {
            String v = r[i] == null ? "" : r[i];
            // 文本里的换行/竖线会破坏行格式：统一压成空格
            v = v.replace(BAR, " ").replace(String.valueOf(NL), " ").replace(String.valueOf(CR), " ");
            if (i > 0) sb.append(BAR);
            sb.append(v);
        }
        return sb.toString();
    }

    /** 按 id 去重的全量读取（后写覆盖先写）。 */
    public static List<String[]> readAll(Context ctx) {
        List<String[]> cached = CACHE;
        // 返回副本：调用方会 add/mutate 再 writeAll，直接交出缓存会让「写失败」污染内存态
        if (cached != null) return new ArrayList<String[]>(cached);
        return new ArrayList<String[]>(reload(ctx));
    }

    private static synchronized List<String[]> reload(Context ctx) {
        if (CACHE != null) return CACHE;
        LinkedHashMap<String, String[]> map = new LinkedHashMap<String, String[]>();
        try {
            File f = file(ctx);
            if (!f.exists()) { CACHE = new ArrayList<String[]>(); return CACHE; }
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            String line;
            while ((line = r.readLine()) != null) {
                String[] p = parseLine(line);
                if (p == null) continue;
                map.remove(p[0]);
                map.put(p[0], p);
            }
            r.close();
        } catch (Throwable t) {
            Log.w(TAG, "readAll error", t);
        }
        CACHE = new ArrayList<String[]>(map.values());
        return CACHE;
    }

    private static boolean writeAll(Context ctx, List<String[]> rows) {
        try {
            StringBuilder sb = new StringBuilder();
            for (String[] r : rows) sb.append(join(r)).append(NL);
            FileOutputStream fos = new FileOutputStream(file(ctx), false);
            fos.write(sb.toString().getBytes("UTF-8"));
            fos.close();
            CACHE = new ArrayList<String[]>(rows);   // 写时同步缓存（下次读不再落盘）
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "writeAll error", t);
            return false;
        }
    }

    public static boolean enabled(String[] r) { return !"off".equalsIgnoreCase(r[4]); }

    private static int intOf(String s, int def) {
        try { return Integer.parseInt(s.trim()); } catch (Exception e) { return def; }
    }

    private static long longOf(String s, long def) {
        try { return Long.parseLong(s.trim()); } catch (Exception e) { return def; }
    }

    /** 新增一条触发器；返回 id（失败返回 null）。cooldownSec &lt;= 0 时按 60 秒。 */
    public static String add(Context ctx, String event, String match, String text, int cooldownSec) {
        if (event == null || !isKnownEvent(event)) return null;
        if (text == null || text.trim().isEmpty()) return null;
        String id = "trig-" + System.currentTimeMillis();
        String[] r = { id, event, match == null ? "" : match.trim(), text.trim(), "on",
                String.valueOf(cooldownSec > 0 ? cooldownSec : 60), "0" };
        List<String[]> rows = readAll(ctx);
        rows.add(r);
        return writeAll(ctx, rows) ? id : null;
    }

    public static boolean remove(Context ctx, String id) {
        List<String[]> rows = readAll(ctx);
        List<String[]> out = new ArrayList<String[]>();
        for (String[] r : rows) if (!r[0].equals(id)) out.add(r);
        if (out.size() == rows.size()) return false;
        return writeAll(ctx, out);
    }

    public static boolean setEnabled(Context ctx, String id, boolean on) {
        List<String[]> rows = readAll(ctx);
        boolean hit = false;
        for (String[] r : rows) {
            if (r[0].equals(id)) { r[4] = on ? "on" : "off"; hit = true; }
        }
        return hit && writeAll(ctx, rows);
    }

    public static int count(Context ctx) { return readAll(ctx).size(); }

    public static int enabledCount(Context ctx) {
        int n = 0;
        for (String[] r : readAll(ctx)) if (enabled(r)) n++;
        return n;
    }

    /** 设置弹窗入口行文案。 */
    public static String summaryText(Context ctx) {
        List<String[]> rows = readAll(ctx);
        int on = 0, off = 0;
        for (String[] r : rows) { if (enabled(r)) on++; else off++; }
        if (rows.isEmpty()) {
            return "⚡ 事件触发器 · 插电/灭屏/联网时自动干活" + NL
                    + "暂无触发器；对助手说「插上充电器就静音」即可创建";
        }
        return "⚡ 事件触发器 · 插电/灭屏/联网时自动干活" + NL
                + "共 " + rows.size() + " 条（启用 " + on + " / 停用 " + off + "）；点此查看与测试";
    }

    // ---------- 事件注册 ----------

    /** 幂等注册运行期广播接收器（App 进程内常驻；进程重启后由调用方再次调用）。 */
    public static synchronized void ensureRegistered(Context ctx) {
        if (registered) return;
        Context app = ctx.getApplicationContext();
        try {
            IntentFilter f = new IntentFilter();
            f.addAction(Intent.ACTION_BATTERY_CHANGED);   // 电源/电量边沿（sticky，注册即回调一次用于校准基线）
            f.addAction(Intent.ACTION_SCREEN_ON);
            f.addAction(Intent.ACTION_SCREEN_OFF);
            f.addAction(Intent.ACTION_HEADSET_PLUG);
            f.addAction(ConnectivityManager.CONNECTIVITY_ACTION);
            app.registerReceiver(runtimeReceiver, f);
            registered = true;
            Log.i(TAG, "[b85r4] runtime receivers registered");
        } catch (Throwable t) {
            Log.w(TAG, "ensureRegistered failed", t);
        }
    }

    private static final BroadcastReceiver runtimeReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            try {
                handle(context, intent);
            } catch (Throwable t) {
                Log.w(TAG, "runtime onReceive error", t);
            }
        }
    };

    // ---------- 事件 → 触发器 ----------

    /** 把一条系统广播翻译成 0..N 个逻辑事件并分发。 */
    public static void handle(Context ctx, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;
        Context app = ctx.getApplicationContext();
        // 批次85-R4 修正：**没有触发器时立刻返回**，不做任何 prefs 读写。
        // ACTION_BATTERY_CHANGED 是 sticky 且高频广播（充电时更密），onReceive 在主线程；
        // 空触发器场景下仍去读写 prefs 会持续给主线程添堵（面板入场动画掉帧）。
        if (readAll(app).isEmpty()) return;
        SharedPreferences sp = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        if (Intent.ACTION_BATTERY_CHANGED.equals(action)) {
            int plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            boolean nowPlugged = plugged != 0;
            if (sp.contains(KEY_POWER)) {
                boolean wasPlugged = sp.getBoolean(KEY_POWER, nowPlugged);
                if (nowPlugged != wasPlugged) {
                    dispatch(app, nowPlugged ? "power_connected" : "power_disconnected", "");
                }
            }
            sp.edit().putBoolean(KEY_POWER, nowPlugged).apply();

            int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            if (level >= 0 && scale > 0) {
                int pct = level * 100 / scale;
                boolean nowLow = pct <= 15;
                if (sp.contains(KEY_LOW)) {
                    boolean wasLow = sp.getBoolean(KEY_LOW, nowLow);
                    if (nowLow != wasLow) dispatch(app, nowLow ? "battery_low" : "battery_okay", "");
                }
                sp.edit().putBoolean(KEY_LOW, nowLow).apply();
            }
            return;
        }
        if (Intent.ACTION_SCREEN_ON.equals(action)) { dispatch(app, "screen_on", ""); return; }
        if (Intent.ACTION_SCREEN_OFF.equals(action)) { dispatch(app, "screen_off", ""); return; }
        if (Intent.ACTION_HEADSET_PLUG.equals(action)) {
            int state = intent.getIntExtra("state", 0);
            dispatch(app, state == 1 ? "headset_plug" : "headset_unplug", "");
            return;
        }
        if (ConnectivityManager.CONNECTIVITY_ACTION.equals(action)) {
            boolean up = !intent.getBooleanExtra(ConnectivityManager.EXTRA_NO_CONNECTIVITY, false);
            boolean known = sp.getBoolean(KEY_NET, up);
            if (up != known) dispatch(app, up ? "net_connected" : "net_disconnected", "");
            sp.edit().putBoolean(KEY_NET, up).apply();
            return;
        }
        if (Intent.ACTION_PACKAGE_ADDED.equals(action) || Intent.ACTION_PACKAGE_REMOVED.equals(action)
                || Intent.ACTION_PACKAGE_REPLACED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            String pkg = "";
            try {
                if (intent.getData() != null) pkg = String.valueOf(intent.getData().getSchemeSpecificPart());
            } catch (Throwable ignored) {}
            boolean replacing = intent.getBooleanExtra(Intent.EXTRA_REPLACING, false);
            String ev;
            if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) ev = "package_replaced";
            else if (Intent.ACTION_PACKAGE_ADDED.equals(action)) ev = replacing ? "package_replaced" : "package_added";
            else if (Intent.ACTION_PACKAGE_REPLACED.equals(action)) ev = "package_replaced";
            else ev = replacing ? "package_replaced" : "package_removed";
            dispatch(app, ev, pkg == null ? "" : pkg);
        }
    }

    /** 找出所有匹配该事件的启用触发器并执行（带冷却）。 */
    private static void dispatch(Context app, String event, String match) {
        List<String[]> rows = readAll(app);
        // 批次85-R4 修正：**没有触发器就直接返回**。ACTION_BATTERY_CHANGED 是 sticky 且高频广播，
        // 原实现即使 0 条触发器也会走到底部的 writeAll → 每次广播都做一次主线程文件写
        // （真机上表现为呼出面板的入场帧不干净：e2e 量到 settled_width 912 / cx 484.8 而非居中 1010/542.9）。
        if (rows.isEmpty()) return;
        long now = System.currentTimeMillis();
        boolean touched = false;
        for (String[] r : rows) {
            if (!enabled(r) || !r[1].equals(event)) continue;
            String m = r[2] == null ? "" : r[2].trim();
            if (!m.isEmpty() && !"*".equals(m)) {
                if (match == null || match.isEmpty()) continue;
                if (!m.equalsIgnoreCase(match)) continue;
            }
            long cool = intOf(r[5], 60) * 1000L;
            long last = longOf(r[6], 0L);
            if (cool > 0 && last > 0 && now - last < cool) {
                Log.i(TAG, "[b85r4] skip (cooldown) " + r[0] + " event=" + event);
                continue;
            }
            r[6] = String.valueOf(now);
            touched = true;
            ScheduleExecutor.log(app, "触发器命中: " + label(event) + (m.isEmpty() ? "" : "[" + match + "]")
                    + " → " + r[3]);
            fire(app, r[3]);
        }
        if (touched) writeAll(app, rows);   // 只在真有命中时回写 lastFired
    }

    /** 手动触发（管理页「测试」与路由 /trigger 都用它）。 */
    public static boolean fireById(Context ctx, String id) {
        List<String[]> rows = readAll(ctx);
        if (rows.isEmpty()) return false;
        boolean hit = false;
        for (String[] r : rows) {
            if (!r[0].equals(id)) continue;
            r[6] = String.valueOf(System.currentTimeMillis());
            ScheduleExecutor.log(ctx, "触发器手动测试: " + label(r[1]) + " → " + r[3]);
            fire(ctx.getApplicationContext(), r[3]);
            hit = true;
        }
        if (hit) writeAll(ctx, rows);
        return hit;
    }

    /** 手动触发某条事件（不依赖真实系统广播；用于真机验证与「测试」。 */
    public static int dispatchForTest(Context ctx, String event, String match) {
        int before = count(ctx);
        if (before == 0) return 0;
        int[] hits = new int[1];
        List<String[]> rows = readAll(ctx);
        if (rows.isEmpty()) return 0;
        long now = System.currentTimeMillis();
        for (String[] r : rows) {
            if (!enabled(r) || !r[1].equals(event)) continue;
            String m = r[2] == null ? "" : r[2].trim();
            if (!m.isEmpty() && !"*".equals(m)) {
                if (match == null || match.isEmpty()) continue;
                if (!m.equalsIgnoreCase(match)) continue;
            }
            r[6] = String.valueOf(now);
            hits[0]++;
            ScheduleExecutor.log(ctx, "触发器测试命中: " + label(event) + " → " + r[3]);
            fire(ctx.getApplicationContext(), r[3]);
        }
        if (hits[0] > 0) writeAll(ctx, rows);
        return hits[0];
    }

    private static void fire(final Context app, final String text) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    ScheduleExecutor.execute(app, text);
                } catch (Throwable t) {
                    ScheduleExecutor.log(app, "触发器执行失败: " + t.getMessage());
                }
            }
        }, "b85r4-trigger-fire").start();
    }

    /** 事件清单 JSON（给 android_trigger 工具读）。 */
    public static String eventsJson() {
        try {
            JSONArray a = new JSONArray();
            for (String[] e : EVENTS) {
                JSONObject o = new JSONObject();
                o.put("event", e[0]);
                o.put("label", e[1]);
                a.put(o);
            }
            JSONObject root = new JSONObject();
            root.put("ok", true);
            root.put("events", a);
            return root.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"json\"}";
        }
    }

    /** 触发器列表 JSON（给 android_trigger 工具读）。 */
    public static String listJson(Context ctx) {
        try {
            JSONArray a = new JSONArray();
            for (String[] r : readAll(ctx)) {
                JSONObject o = new JSONObject();
                o.put("id", r[0]);
                o.put("event", r[1]);
                o.put("label", label(r[1]));
                o.put("match", r[2]);
                o.put("text", r[3]);
                o.put("enabled", enabled(r));
                o.put("cooldownSec", intOf(r[5], 60));
                o.put("lastFiredMs", longOf(r[6], 0L));
                a.put(o);
            }
            JSONObject root = new JSONObject();
            root.put("ok", true);
            root.put("count", a.length());
            root.put("triggers", a);
            return root.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"json\"}";
        }
    }
}
