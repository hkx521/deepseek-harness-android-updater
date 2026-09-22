package com.deepseek.harness;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.view.KeyEvent;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Socket;
import java.net.URL;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import moe.shizuku.server.IRemoteProcess;
import moe.shizuku.server.IShizukuService;
import rikka.shizuku.Shizuku;
import rikka.shizuku.ShizukuBinderWrapper;

/**
 * 批次 11：vscreen 虚拟屏通道抽象（root / Shizuku 双通道）+ 3081 本地桥网关。
 *
 * <p>职责边界（契约 §0/§2，冻结 v1）：<b>App 层不含任何建屏/注入细节</b>——只做
 * 特权探测（PrivilegeDetector）、通道选择（ChannelSelector）、服务端拉起（ServerLauncher）、
 * 探活与降级（SessionSupervisor）、wakelock（WakelockOwner）、
 * 3081→8998 网关转发（key 路由含键名→keycode 归一化，批次 11r1）、shutdown。
 * 建屏阶梯（S1/S2/S3）、tap/swipe/key/see 注入全部在 8998 特权服务端（LGPL，vscreen/ 目录）。</p>
 *
 * <p>线程模型（ANR 红线）：
 * <ul>
 *   <li>{@link #handleLocal} 只在本地桥的 local-conn 线程里被 MainActivity 调用，绝不在主线程；</li>
 *   <li>spawn（su / Shizuku）与健康等待都在调用线程（local-conn 或 supervisor）执行；</li>
 *   <li>SessionSupervisor：单条常驻 daemon 线程（vscreen-supervisor），间隔 5s 探活 /health；</li>
 *   <li>{@link #shutdownAsync}（onDestroy 调用）：瞬时线程，不阻塞主线程；
 *       onDestroy 里直接做 HTTP 会抛 NetworkOnMainThreadException，必须异步。</li>
 * </ul></p>
 *
 * <p>通道说明（DEVIATION，详见批次 11b 报告）：libs/shizuku-api.aar 的
 * {@code rikka.shizuku.Shizuku} <b>没有</b> {@code newProcess} 方法（javap 全量核实）；
 * 实际拉起走同 classpath 的 AIDL 直连：
 * {@code IShizukuService.Stub.asInterface(new ShizukuBinderWrapper(Shizuku.getBinder()))
 * .newProcess(argv, env, dir)}，签名与契约 §1 语义一致（argv/env/dir），返回 IRemoteProcess
 * 用本类的 {@link ShizukuProcessAdapter} 包装成 java.lang.Process
 * （rikka 自带的 ShizukuRemoteProcess 构造器是包私有，不可用）。</p>
 */
public final class VscreensManager {

    private static final String TAG = "VscreensManager";

    // ==== 契约 §0/§1 常量 ====
    private static final String PREFS = "dsh_prefs";
    private static final String KEY_CHANNEL_PREF = "vscreen_channel"; // auto|root|shizuku，缺省 auto
    private static final String KEY_LOCAL_TOKEN = "local_token";      // 与 3081 同源（dsh_prefs）
    private static final int SERVER_PORT = 8998;
    private static final String SERVER_VERSION = "b12";               // /health version 匹配才复用（批次66：b11→b12，强制换成防抖版服务端）
    private static final String SERVER_MAIN = "com.deepseek.harness.vscreen.Main";
    private static final String SERVER_JAR_ASSET = "vscreen/vscreen-server.jar";
    private static final String CHANNEL_ROOT = "root";
    private static final String CHANNEL_SHIZUKU = "shizuku";
    private static final String PREF_AUTO = "auto";
    private static final String PREF_ROOT = "root";
    private static final String PREF_SHIZUKU = "shizuku";

    // ==== 失败 reason 全集（契约 §3，App 层统一产出；每个失败必须带 hint） ====
    private static final String REASON_NO_PRIVILEGE = "NO_PRIVILEGE";
    private static final String REASON_ROOT_DENIED = "ROOT_DENIED";
    private static final String REASON_SHIZUKU_UNAVAILABLE = "SHIZUKU_UNAVAILABLE";
    private static final String REASON_SHIZUKU_DENIED = "SHIZUKU_DENIED";
    private static final String REASON_SPAWN_FAILED = "SPAWN_FAILED";
    private static final String REASON_SESSION_DEAD = "SESSION_DEAD";
    private static final String REASON_NOT_CREATED = "NOT_CREATED";
    private static final String REASON_INVALID_ARGUMENT = "INVALID_ARGUMENT";
    private static final String REASON_BRIDGE_UNREACHABLE = "BRIDGE_UNREACHABLE";
    /** 批次61：只读任务期间被 App 硬闸门拒绝建屏（不是权限/通道问题，不要重试）。 */
    private static final String REASON_READONLY_TASK = "READONLY_TASK";

    /** 批次61：只读任务期间拒绝建屏时给插件的可执行提示（插件据此降级读主屏）。 */
    private static final String HINT_READONLY_TASK =
            "本轮为只读任务（识别屏幕/提取文字/翻译/总结/划选问答），App 已禁用虚拟屏创建；"
            + "请改用主屏只读能力（android_screen 传 scope=current）继续，不要重试建屏。";

    /** 批次82-N2：屏幕熄灭时虚拟屏 see 只会回黑帧（面板 OFF → SF 停止合成，三轮实测无绕过通路）。 */
    private static final String REASON_SCREEN_OFF = "SCREEN_OFF";
    private static final String HINT_SCREEN_OFF =
            "屏幕已熄灭：虚拟屏画面只在屏幕亮着时可靠（本机息屏后必黑，属 ROM 行为，已决定不再尝试绕过）。"
            + "请点亮屏幕后重试；充电时常亮可在「小鲸鱼助手 → 保活自检（后台常驻）」里开启；"
            + "不需要像素的步骤请改用 android_see / android_dump 读节点。";

    // ==== 时序参数 ====
    private static final long HEALTH_WAIT_MS = 15000;          // spawn 后等服务端就绪上限
    private static final long HEALTH_POLL_MS = 300;            // 就绪轮询间隔
    private static final long PROBE_TTL_MS = 15000;            // root/shizuku 探测缓存 TTL
    private static final long SUPERVISOR_INTERVAL_MS = 5000;   // 探活间隔（契约要求 ≥3s）
    private static final long GATE_WAIT_MS = 40000;            // 单飞闸门等待上限（spawn+spawn 兜底）

    // ==== WakelockOwner ====
    private static final String WAKELOCK_TAG = "dsh:vscreen";
    /** 单次 acquire 时长：supervisor 每 5s 续期，会话死亡后最多 30s 自动释放（防泄漏）。 */
    private static final long WAKELOCK_TIMEOUT_MS = 30000;

    // ==== 批次66：锁屏挂机与探活防抖（消除「销毁→重建→销毁」抖动环） ====
    /** 连续探活失败阈值：瞬态抖动（锁屏/深睡眠/CPU 被抢占）不换道、不杀服务端。 */
    private static final int HEALTH_FAIL_THRESHOLD = 3;
    /** 单 tick 内立即重试探次数与间隔（判死前先自证）。 */
    private static final int SUPERVISOR_PROBE_RETRY = 2;
    private static final long SUPERVISOR_PROBE_RETRY_GAP_MS = 400;
    /** supervisor 专用读取超时（比路由探活 1500ms 宽松：锁屏态下本进程线程随时被抢占）。 */
    private static final int SUPERVISOR_PROBE_READ_TIMEOUT_MS = 3000;
    /** 单次会话最多抢救次数：超过后诚实报 SESSION_DEAD，禁止 root↔shizuku 无限乒乓重建。 */
    private static final int RECOVERY_MAX_ATTEMPTS = 2;
    /** 两次抢救之间的冷却：冷却期内即使探活失败也不杀进程/不重建。 */
    private static final long RECOVERY_COOLDOWN_MS = 60000;
    /** 会话稳定时长：健康维持这么久才算「真活」，此时才复位抢救预算。 */
    private static final long SESSION_STABLE_MS = 120000;
    /** 灭屏宽限：灭屏后这段时间内只探活 + 复述 AOD，绝不杀进程。 */
    private static final long SCREEN_OFF_GRACE_MS = 120000;
    /** 灭屏期间 AOD 复述间隔（防系统/其它 App 把 doze_always_on 改回 0）。 */
    private static final long AOD_REASSERT_INTERVAL_MS = 60000;
    /** 面板唤醒锁标签（锁屏挂机兜底：AOD 无效时强制面板不熄，保证 SF 继续合成虚拟屏）。 */
    private static final String PANEL_WAKELOCK_TAG = "dsh:vscreen-panel";
    /** 锁屏面板保活偏好：true（缺省）=AOD 无效时自动保持面板点亮（仍锁屏）；false=只依赖 AOD。 */
    private static final String KEY_LOCK_PANEL_KEEPALIVE = "vscreen_lock_panel_keepalive";

    // ==== 掉线通知（对齐 a11y 掉线通知的既有模式） ====
    private static final String VSCREEN_NOTIFY_CHANNEL_ID = "dsh_vscreen";

    // ==== 单例（进程级：MainActivity 是 standard 启动模式，可能多实例；引擎单飞同款理由） ====
    private static volatile VscreensManager sInstance;

    /**
     * 批次60-B：问答/划选等任务收尾时判断「本轮是否真的开了虚拟屏」。
     * 只读本地 volatile 状态，不打桥、不阻塞主线程。
     */
    public static boolean isSessionActive() {
        VscreensManager m = sInstance;
        return m != null && m.sessionActive;
    }

    public static VscreensManager get() {
        if (sInstance == null) {
            synchronized (VscreensManager.class) {
                if (sInstance == null) sInstance = new VscreensManager();
            }
        }
        return sInstance;
    }

    private VscreensManager() {}

    // ==== 会话状态（volatile：跨 local-conn / supervisor 线程读写） ====
    private final Object stateLock = new Object();
    /** 当前会话通道（create 成功后非空；close/shutdown/探活死亡后随 sessionActive 清理）。 */
    private volatile String sessionChannel = null;
    private volatile boolean sessionActive = false;
    /** 上次 create 请求体：探活死亡自动换道重拉后，按原参数重建 display（G3 会话恢复）。 */
    private volatile String lastCreateBody = null;
    /** 最近一次失败/换道原因（ROOT_DENIED / SHIZUKU_UNAVAILABLE / SESSION_DEAD），进 logcat 供排查。 */
    private volatile String lastFailReason = null;
    private PowerManager.WakeLock wakeLock;

    /** Application Context（supervisor/shutdown 线程用；handleLocal 首次调用时落定）。 */
    private volatile Context appContext = null;

    // ==== PrivilegeDetector 探测缓存（TTL 15s；su -c id 不能跑在主线程，调用方均为后台线程） ====
    private volatile Boolean rootCache = null;
    private volatile long rootCacheAt = 0L;
    private volatile Boolean shizukuCache = null;
    private volatile long shizukuCacheAt = 0L;

    // ==== ServerLauncher / ensure 单飞闸门（引擎 engineStartInFlight 同款：并发 create 只跑一条 spawn 流程） ====
    private final AtomicBoolean spawnInFlight = new AtomicBoolean(false);

    // ==== SessionSupervisor 线程 ====
    private volatile Thread supervisorThread = null;
    private volatile boolean shutdownRequested = false;

    // ==== 批次66：探活防抖 / 抢救预算 / 灭屏宽限 状态 ====
    /** 连续探活失败计数（健康即清零）。 */
    private volatile int healthFailStreak = 0;
    /** 本会话已抢救次数（防 root↔shizuku 乒乓；稳定 120s 后复位）。 */
    private volatile int recoveryAttempts = 0;
    /** 上次抢救时刻（elapsedRealtime）；冷却期内禁止再次杀进程重建。 */
    private volatile long lastRecoveryAt = 0L;
    /** 本次抢救链已试过的通道（同一链内不重复换道）。 */
    private final Set<String> recoveryChain = new HashSet<String>();
    /** 会话进入连续健康状态的起点（0=当前不健康）。 */
    private volatile long healthySinceAt = 0L;
    /** 灭屏时刻（elapsedRealtime；会话收尾/亮屏时清零）。 */
    private volatile long screenOffAt = 0L;
    /** 面板唤醒锁（锁屏挂机兜底；与 dsh:vscreen 主锁分离，便于独立释放）。 */
    private PowerManager.WakeLock panelWakeLock;
    /** 灭屏广播接收器（仅会话存活期注册，保证零常驻开销）。 */
    private BroadcastReceiver screenStateReceiver = null;
    /** 上次 AOD 复述时刻（限流用）。 */
    private volatile long lastAodAssertAt = 0L;

    // =============================================================================================
    // 3081 /vscreen/* 入口（MainActivity 本地桥分发到这里；与 /clipboard 同一鉴权前置：X-DSH-Token）
    // =============================================================================================

    /**
     * 处理一条 3081 本地桥请求（MainActivity.route 的 /vscreen/ 前缀分支委托到这里）。
     * 运行线程：local-conn（本地桥每连接一线程），<b>绝不在主线程调用</b>。
     * 响应由本方法直接写回 socket（see 的 PNG 字节流需原样透传，不能走 MainActivity 的 JSON 文本路径），
     * 写回后由调用方 keep-alive 循环继续读下一条请求。
     *
     * @param ctx         MainActivity（token 取 {@code localToken()}，与 3081 同源）
     * @param method      HTTP 方法（GET/POST，MainActivity 从请求行解析）
     * @param rawPath     原始路径（含 ?query）
     * @param body        请求正文（JSON 文本；GET 为空串）
     * @param socket      目标 socket
     * @param clientClose 请求是否要求 Connection: close
     */
    public void handleLocal(Context ctx, String method, String rawPath, String body,
                            Socket socket, boolean clientClose) {
        if (appContext == null && ctx != null) appContext = ctx.getApplicationContext();
        String path = rawPath == null ? "" : rawPath;
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        try {
            if (path.equals("/vscreen/status")) {
                // 契约 §2：status 由 App 自己产出（不透传 8998）
                writeResponse(socket, 200, "application/json",
                        statusJson(ctx).getBytes("UTF-8"), clientClose);
            } else if (path.equals("/vscreen/create")) {
                handleCreate(ctx, method, rawPath, body, socket, clientClose);
            } else if (path.equals("/vscreen/close")) {
                handleClose(ctx, method, rawPath, body, socket, clientClose);
            } else if (path.equals("/vscreen/shutdown")) {
                // 契约 §2：会话收尾 = close（overlay 还原）→ kill → pidfile 兜底 → 释放 wakelock
                shutdown(ctx);
                writeResponse(socket, 200, "application/json",
                        "{\"ok\":true}".getBytes("UTF-8"), clientClose);
            } else if (path.equals("/vscreen/key")) {
                // /vscreen/key：键名→keycode 必须在 App 层翻译（8998 服务端只认数字 keycode，契约 §1），
                // 归一化/本地拒绝完成后经 proxyRoute 透传（批次 11r1 修复）
                handleKey(ctx, method, rawPath, body, socket, clientClose);
            } else if (path.equals("/vscreen/see")) {
                // 批次82-N2：屏幕熄灭时 8998 的 see 只会回黑帧（面板 OFF → SurfaceFlinger 停止合成，
                // 已穷尽实测确认无绕过通路）。在 App 层如实失败，避免模型把黑帧当成功继续判断。
                if (!isScreenInteractive(ctx)) {
                    writeResponse(socket, 200, "application/json",
                            failJson(REASON_SCREEN_OFF, HINT_SCREEN_OFF).getBytes("UTF-8"), clientClose);
                } else {
                    proxyRoute(ctx, method, rawPath, body, socket, clientClose);
                }
            } else if (path.equals("/vscreen/launch")
                    || path.equals("/vscreen/tap") || path.equals("/vscreen/swipe")) {
                // 其余契约路由：8998 透传（JSON 失败补 hint；see 的 image/png 原样字节流）
                proxyRoute(ctx, method, rawPath, body, socket, clientClose);
            } else {
                // 3081 只暴露契约 §2 的 9 条路由（kill 只在 shutdown 内部编排，不对外）
                writeResponse(socket, 200, "application/json",
                        failJson(REASON_INVALID_ARGUMENT, "未知 /vscreen 路径，可用：create/status/launch/see/tap/swipe/key/close/shutdown")
                                .getBytes("UTF-8"), clientClose);
            }
        } catch (Throwable t) {
            Log.w(TAG, "handleLocal " + rawPath + " failed", t);
            writeSafe(socket, clientClose, t);
        }
    }

    /**
     * 批次82-N9：无会话时的失败原因 —— 只读任务硬闸门在场时给 {@code READONLY_TASK}。
     *
     * <p>原来一律回 {@code NOT_CREATED} +「先 android_vscreen_create」：而此刻 create 恰好会被
     * 只读闸门拒（{@code handleCreate} 的第一道门），调用方照提示做只会再被拒一次 —— 语义不准，
     * 且把「本轮不该建屏」的真实原因藏了起来。这里把原因说实话，提示仍走 {@link #hintFor}。</p>
     */
    private static String noSessionReason() {
        try {
            if (OverlayService.isReadOnlyTaskInFlight()) return REASON_READONLY_TASK;
        } catch (Throwable ignored) {}
        return REASON_NOT_CREATED;
    }

    /** 批次82-N2：屏幕是否亮着（取不到按「亮」处理，宁可放过不可误杀）。 */
    private static boolean isScreenInteractive(Context ctx) {
        try {
            Context app = ctx == null ? null : ctx.getApplicationContext();
            if (app == null) app = ctx;
            PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
            return pm == null || pm.isInteractive();
        } catch (Throwable t) {
            return true;
        }
    }

    /** 透传 launch/see/tap/swipe 到 8998（key 由 handleKey 归一化后复用本方法）；服务端不可达时按会话状态给 SESSION_DEAD / NOT_CREATED。 */
    private void proxyRoute(Context ctx, String method, String rawPath, String body,
                            Socket socket, boolean clientClose) {
        // 批次 11 Gate：writeResponse/getBytes 抛受检异常，整段 try/catch 兜底（与 handleLocal 同款，
        // 异常时 writeSafe 尽力回 500，避免连接悬挂）。
        try {
            proxyRouteInner(ctx, method, rawPath, body, socket, clientClose);
        } catch (Throwable t) {
            Log.w(TAG, "proxyRoute " + rawPath + " failed", t);
            writeSafe(socket, clientClose, t);
        }
    }

    private void proxyRouteInner(Context ctx, String method, String rawPath, String body,
                                 Socket socket, boolean clientClose) throws java.io.IOException {
        if (!serverAliveQuick(ctx)) {
            String reason = sessionActive ? REASON_SESSION_DEAD : noSessionReason();
            writeResponse(socket, 200, "application/json",
                    failJson(reason, hintFor(reason)).getBytes("UTF-8"), clientClose);
            return;
        }
        ProxyResult r = proxyRequest(ctx, method, rawPath, body, 30000);
        if (r == null) {
            String reason = sessionActive ? REASON_SESSION_DEAD : noSessionReason();
            writeResponse(socket, 200, "application/json",
                    failJson(reason, hintFor(reason)).getBytes("UTF-8"), clientClose);
            return;
        }
        boolean isJson = r.contentType != null && r.contentType.contains("json");
        byte[] out = isJson ? injectHint(r.body) : r.body;
        writeResponse(socket, r.code, r.contentType, out, clientClose);
    }

    /**
     * POST /vscreen/create：选道 → （必要时）拉起服务端 → 透传 create → 成功则持 wakelock。
     * 失败 reason：NO_PRIVILEGE / ROOT_DENIED / SHIZUKU_UNAVAILABLE / SHIZUKU_DENIED / SPAWN_FAILED，
     * 或服务端建屏失败的 VDM_DENIED / OVERLAY_FAILED / DISPLAY_TIMEOUT / CREATE_FAILED（透传 + 补 hint）。
     */
    private void handleCreate(Context ctx, String method, String rawPath, String body,
                              Socket socket, boolean clientClose) {
        try {
            // 批次61：只读任务硬闸门 —— 识别屏幕/提取文字/翻译/总结/划选问答等只读任务期间，
            // 任何来源（插件自愈建屏 / android_vscreen_create / 会话自愈）都不允许创建虚拟屏。
            // 用户反馈「划选屏幕文字 → 提取文字后仍弹出黑色虚拟屏小窗」：批次60B 的 Prompt 约束
            // 只是软约束，插件侧 isVscreenModeEnabled 仍会自愈建屏并亮起 VscreensPreviewService。
            // 这里在选道 / 拉起 8998 服务端之前直接拒绝，避免无谓的建屏与黑色预览小窗。
            if (OverlayService.isReadOnlyTaskInFlight()) {
                Log.i(TAG, "vscreen create refused: read-only task in flight");
                writeResponse(socket, 200, "application/json",
                        failJson(REASON_READONLY_TASK, HINT_READONLY_TASK).getBytes("UTF-8"), clientClose);
                return;
            }
            SelectResult sel = ensureSession(ctx, channelPref(ctx));
            if (sel.reason != null) {
                writeResponse(socket, 200, "application/json",
                        failJson(sel.reason, hintFor(sel.reason)).getBytes("UTF-8"), clientClose);
                return;
            }
            lastCreateBody = (body == null || body.isEmpty()) ? "{}" : body;
            ProxyResult r = proxyRequest(ctx, "POST", rawPath, lastCreateBody, 30000);
            if (r == null) {
                // 拉起后仍连不上（几乎不可能）：诚实给 SPAWN_FAILED
                writeResponse(socket, 200, "application/json",
                        failJson(REASON_SPAWN_FAILED, hintFor(REASON_SPAWN_FAILED)).getBytes("UTF-8"), clientClose);
                return;
            }
            byte[] out = r.body;
            try {
                JSONObject o = new JSONObject(new String(r.body, "UTF-8"));
                if (o.optBoolean("ok")) {
                    // 契约 §2：create 成功响应要带 channel（服务端不知道通道概念，由 App 补）
                    o.put("channel", sel.channel);
                    sessionChannel = sel.channel;
                    sessionActive = true;
                    lastFailReason = null;
                    // 批次66：新会话复位探活/抢救状态（旧会话的抖动计数不得继承到新会话）
                    healthFailStreak = 0;
                    recoveryAttempts = 0;
                    lastRecoveryAt = 0L;
                    recoveryChain.clear();
                    healthySinceAt = SystemClock.elapsedRealtime();
                    acquireWakelock(ctx);
                    ensureSupervisor();
                    // 批次 14 修复（批次14f F2 根因）：A17 面板 OFF 时 SF 停止合成 trusted VD（黑帧），
                    // deviceidle disable 亦无效——会话期置 doze_always_on=1（AOD 态实测 0 黑帧），
                    // 先存原值、收尾恢复；代价=挂机期间锁屏 AOD 时钟（USB 供电可忽略）。
                    ensureDozeAodForSession(ctx);
                    // 批次66：立刻复述一次 AOD（跳过限流）+ 注册灭屏广播（锁屏挂机保障入口）
                    assertPanelAodIfNeeded(ctx, true);
                    ensureScreenReceiver(ctx);
                    // 批次 12w：会话建立 → 显示 vscreen 预览悬浮窗（服务内部自失败仅 logcat，
                    // 不影响 create 主流程；换道恢复路径不经过这里，悬浮窗保持不动继续轮询）
                    VscreensPreviewService.start(ctx);
                } else if (!o.has("hint")) {
                    String hint = hintFor(o.optString("reason"));
                    if (hint != null) o.put("hint", hint);
                }
                out = o.toString().getBytes("UTF-8");
            } catch (Throwable ignored) {
                // 非 JSON 原样透传（不应发生，兜底）
            }
            writeResponse(socket, r.code, "application/json", out, clientClose);
        } catch (Throwable t) {
            Log.w(TAG, "handleCreate failed", t);
            writeSafe(socket, clientClose, t);
        }
    }

    /** POST /vscreen/close：透传（服务端还原 overlay）→ 会话结束（契约 §2：close 释放 wakelock）。 */
    private void handleClose(Context ctx, String method, String rawPath, String body,
                             Socket socket, boolean clientClose) {
        try {
            ProxyResult r = serverAliveQuick(ctx) ? proxyRequest(ctx, method, rawPath, body, 15000) : null;
            if (r != null) {
                byte[] out = injectHint(r.body);
                writeResponse(socket, r.code, "application/json", out, clientClose);
            } else {
                // 服务端已不在：无 overlay 可还原，幂等 ok（close 后允许不创建直接 close 的幂等调用）
                writeResponse(socket, 200, "application/json",
                        "{\"ok\":true,\"restoredOverlay\":false}".getBytes("UTF-8"), clientClose);
            }
            sessionActive = false;
            releaseWakelock();
            // 批次66：会话结束 → 撤销锁屏挂机保障（面板保活锁 + 灭屏广播 + 抖动计数）
            releasePanelWakeLock();
            releaseScreenReceiver();
            healthFailStreak = 0;
            healthySinceAt = 0L;
            recoveryAttempts = 0;
            recoveryChain.clear();
            // 批次66b（真机实测）：close 同样是「会话结束」。模型在任务中自己调 close 后，
            // OverlayService 收尾判定看到 sessionActive=false 就不再走 shutdown()，于是
            // ①doze_always_on 永久停在 1（原本 null，收尾没人还原）；②dsh-vscreen 残留进程占着 8998
            // （升级后新服务端起不来 → 新建屏必 SPAWN_FAILED）。故把「还原 AOD + 回收服务端」收进 close。
            restoreDozeAod(ctx);
            killByPidfile(ctx);
            // 批次 12w：会话结束（close）→ 停预览悬浮窗（stopSelf：移窗 + 停轮询）
            VscreensPreviewService.stopSession();
        } catch (Throwable t) {
            Log.w(TAG, "handleClose failed", t);
            writeSafe(socket, clientClose, t);
        }
    }

    // =============================================================================================
    // /vscreen/key 键名→keycode 映射（批次 11r1 修复）：8998 服务端只认数字 {"keycode":N}（契约 §1），
    // 键名字符串原样转发会被解析成 keycode 0（keyevent 0，事件丢失）——翻译必须在 App 层完成。
    // =============================================================================================

    /** 插件 android_vscreen_key 白名单的 App 层镜像（契约 §4，大写键名；用于区分「未知键名」与「白名单内但本机不支持」）。 */
    private static final Set<String> VSCREEN_KEY_NAMES = new HashSet<String>(Arrays.asList(
            "HOME", "BACK", "ENTER", "DEL", "FORWARD_DEL", "MENU", "POWER",
            "VOLUME_UP", "VOLUME_DOWN", "VOLUME_MUTE", "MUTE",
            "RECENT", "APPS", "ALL_APPS", "SEARCH", "NOTIFICATION", "VOICE_ASSIST",
            "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT", "DPAD_CENTER",
            "TAB", "ESC", "SPACE", "SHIFT_LEFT", "SHIFT_RIGHT", "ALT_LEFT", "ALT_RIGHT",
            "CTRL_LEFT", "CTRL_RIGHT", "CAPS_LOCK", "MOVE_HOME", "MOVE_END",
            "PAGE_UP", "PAGE_DOWN", "WAKEUP", "SLEEP",
            "CAMERA", "CALL", "ENDCALL", "HEADSETHOOK",
            "MEDIA_PLAY_PAUSE", "MEDIA_STOP", "MEDIA_NEXT", "MEDIA_PREVIOUS",
            "MEDIA_FAST_FORWARD", "MEDIA_REWIND",
            "BRIGHTNESS_UP", "BRIGHTNESS_DOWN", "SYM", "FN", "ZOOM_IN", "ZOOM_OUT",
            "EXPLORER", "ENVELOPE", "FOCUS", "CLEAR", "PICTURES", "MUSIC", "CALCULATOR"));

    /**
     * POST /vscreen/key：契约 §2 的 key 允许键名（"HOME"）或数字键值（"4"），而 8998 服务端
     * 只认数字 {"keycode":N}（契约 §1）——键名必须在 App 层翻译后再转发：
     * <ul>
     *   <li>key 为纯数字（^\d{1,5}$ 且 ≤65535）→ 换算 {"keycode":N} 直接转发；</li>
     *   <li>key 为键名 → {@link #vscreenKeyToCode} 映射后转发 {"keycode":N}
     *       （客户端若带 metaState 一并透传）；</li>
     *   <li>其余（缺 key / 未知键名 / 本机不支持 / 键值越界）→ INVALID_ARGUMENT 本地拒绝，不打 8998。</li>
     * </ul>
     * 插件侧 normalizeVscreenKey 已先做一轮归一（数字串 / 大写白名单键名），这里独立再校验（纵深防御）。
     */
    private void handleKey(Context ctx, String method, String rawPath, String body,
                           Socket socket, boolean clientClose) {
        try {
            JSONObject o;
            try {
                o = new JSONObject(body == null || body.isEmpty() ? "{}" : body);
            } catch (Throwable t) {
                o = new JSONObject(); // 非 JSON 请求体按缺 key 处理（本地拒绝，不打 8998）
            }
            String key = o.optString("key", "").trim();
            if (key.isEmpty()) {
                writeResponse(socket, 200, "application/json",
                        failJson(REASON_INVALID_ARGUMENT, "缺少 key 字段（键名或数字键值，见 android_vscreen_key 白名单）")
                                .getBytes("UTF-8"), clientClose);
                return;
            }
            Integer code;
            if (key.matches("^\\d{1,5}$")) {
                int n = Integer.parseInt(key);
                if (n > 65535) {
                    writeResponse(socket, 200, "application/json",
                            failJson(REASON_INVALID_ARGUMENT, "数字键值越界（0-65535），见 android_vscreen_key 白名单")
                                    .getBytes("UTF-8"), clientClose);
                    return;
                }
                code = Integer.valueOf(n);
            } else {
                String name = key.toUpperCase(Locale.US);
                code = vscreenKeyToCode(name);
                if (code == null) {
                    // 白名单内但本机 KeyEvent 无对应常量 → 「本机不支持」；否则「未知键名」（引导方向不同）
                    String hint = VSCREEN_KEY_NAMES.contains(name)
                            ? "该键名本机不支持，见 android_vscreen_key 白名单"
                            : "未知键名，见 android_vscreen_key 白名单";
                    writeResponse(socket, 200, "application/json",
                            failJson(REASON_INVALID_ARGUMENT, hint).getBytes("UTF-8"), clientClose);
                    return;
                }
            }
            // 重写为服务端契约 §1 请求体后走通用透传（探活 / 失败补 hint 复用 proxyRoute）
            JSONObject req = new JSONObject();
            req.put("keycode", code.intValue());
            if (o.has("metaState")) req.put("metaState", o.optInt("metaState", 0));
            proxyRoute(ctx, method, rawPath, req.toString(), socket, clientClose);
        } catch (Throwable t) {
            Log.w(TAG, "handleKey failed", t);
            writeSafe(socket, clientClose, t);
        }
    }

    /**
     * 键名（已归一大写）→ android.view.KeyEvent keycode（批次 11r1）。
     *
     * <p>一律引用 KeyEvent 编译期常量、禁止手写数字——javac 对照 android.jar 逐个验证键名
     * 真实存在（API 37；本表 59 项已用 javap 全量预核）。白名单内但本机 KeyEvent 无对应
     * 常量的键名不硬凑：APPS / PICTURES 返回 null，由调用方以「该键名本机不支持」拒绝。</p>
     *
     * @return keycode；null = 未知键名或本机不支持的键名
     */
    private static Integer vscreenKeyToCode(String name) {
        if (name == null) return null;
        switch (name) {
            case "HOME":               return KeyEvent.KEYCODE_HOME;
            case "BACK":               return KeyEvent.KEYCODE_BACK;
            case "ENTER":              return KeyEvent.KEYCODE_ENTER;
            case "DEL":                return KeyEvent.KEYCODE_DEL;              // 退格（Backspace），非 FORWARD_DEL
            case "FORWARD_DEL":        return KeyEvent.KEYCODE_FORWARD_DEL;
            case "MENU":               return KeyEvent.KEYCODE_MENU;
            case "POWER":              return KeyEvent.KEYCODE_POWER;
            case "VOLUME_UP":          return KeyEvent.KEYCODE_VOLUME_UP;
            case "VOLUME_DOWN":        return KeyEvent.KEYCODE_VOLUME_DOWN;
            case "VOLUME_MUTE":        return KeyEvent.KEYCODE_VOLUME_MUTE;
            case "MUTE":               return KeyEvent.KEYCODE_MUTE;
            case "RECENT":             return KeyEvent.KEYCODE_APP_SWITCH;       // 最近任务键
            case "ALL_APPS":           return KeyEvent.KEYCODE_ALL_APPS;
            case "SEARCH":             return KeyEvent.KEYCODE_SEARCH;
            case "NOTIFICATION":       return KeyEvent.KEYCODE_NOTIFICATION;
            case "VOICE_ASSIST":       return KeyEvent.KEYCODE_VOICE_ASSIST;
            case "DPAD_UP":            return KeyEvent.KEYCODE_DPAD_UP;
            case "DPAD_DOWN":          return KeyEvent.KEYCODE_DPAD_DOWN;
            case "DPAD_LEFT":          return KeyEvent.KEYCODE_DPAD_LEFT;
            case "DPAD_RIGHT":         return KeyEvent.KEYCODE_DPAD_RIGHT;
            case "DPAD_CENTER":        return KeyEvent.KEYCODE_DPAD_CENTER;
            case "TAB":                return KeyEvent.KEYCODE_TAB;
            case "ESC":                return KeyEvent.KEYCODE_ESCAPE;
            case "SPACE":              return KeyEvent.KEYCODE_SPACE;
            case "SHIFT_LEFT":         return KeyEvent.KEYCODE_SHIFT_LEFT;
            case "SHIFT_RIGHT":        return KeyEvent.KEYCODE_SHIFT_RIGHT;
            case "ALT_LEFT":           return KeyEvent.KEYCODE_ALT_LEFT;
            case "ALT_RIGHT":          return KeyEvent.KEYCODE_ALT_RIGHT;
            case "CTRL_LEFT":          return KeyEvent.KEYCODE_CTRL_LEFT;
            case "CTRL_RIGHT":         return KeyEvent.KEYCODE_CTRL_RIGHT;
            case "CAPS_LOCK":          return KeyEvent.KEYCODE_CAPS_LOCK;
            case "MOVE_HOME":          return KeyEvent.KEYCODE_MOVE_HOME;
            case "MOVE_END":           return KeyEvent.KEYCODE_MOVE_END;
            case "PAGE_UP":            return KeyEvent.KEYCODE_PAGE_UP;
            case "PAGE_DOWN":          return KeyEvent.KEYCODE_PAGE_DOWN;
            case "WAKEUP":             return KeyEvent.KEYCODE_WAKEUP;
            case "SLEEP":              return KeyEvent.KEYCODE_SLEEP;
            case "CAMERA":             return KeyEvent.KEYCODE_CAMERA;
            case "CALL":               return KeyEvent.KEYCODE_CALL;
            case "ENDCALL":            return KeyEvent.KEYCODE_ENDCALL;
            case "HEADSETHOOK":        return KeyEvent.KEYCODE_HEADSETHOOK;
            case "MEDIA_PLAY_PAUSE":   return KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
            case "MEDIA_STOP":         return KeyEvent.KEYCODE_MEDIA_STOP;
            case "MEDIA_NEXT":         return KeyEvent.KEYCODE_MEDIA_NEXT;
            case "MEDIA_PREVIOUS":     return KeyEvent.KEYCODE_MEDIA_PREVIOUS;
            case "MEDIA_FAST_FORWARD": return KeyEvent.KEYCODE_MEDIA_FAST_FORWARD;
            case "MEDIA_REWIND":       return KeyEvent.KEYCODE_MEDIA_REWIND;
            case "BRIGHTNESS_UP":      return KeyEvent.KEYCODE_BRIGHTNESS_UP;
            case "BRIGHTNESS_DOWN":    return KeyEvent.KEYCODE_BRIGHTNESS_DOWN;
            case "SYM":                return KeyEvent.KEYCODE_SYM;
            case "FN":                 return KeyEvent.KEYCODE_FUNCTION;
            case "ZOOM_IN":            return KeyEvent.KEYCODE_ZOOM_IN;
            case "ZOOM_OUT":           return KeyEvent.KEYCODE_ZOOM_OUT;
            case "EXPLORER":           return KeyEvent.KEYCODE_EXPLORER;
            case "ENVELOPE":           return KeyEvent.KEYCODE_ENVELOPE;
            case "FOCUS":              return KeyEvent.KEYCODE_FOCUS;
            case "CLEAR":              return KeyEvent.KEYCODE_CLEAR;
            case "MUSIC":              return KeyEvent.KEYCODE_MUSIC;
            case "CALCULATOR":         return KeyEvent.KEYCODE_CALCULATOR;
            // APPS / PICTURES：android.jar（API 37）KeyEvent 无 KEYCODE_APPS / KEYCODE_PICTURES
            // （javap 核实），不硬凑——白名单保留键名但映射为 null → 调用处报「该键名本机不支持」。
            default:                   return null;
        }
    }

    // =============================================================================================
    // PrivilegeDetector：root（su -c id → uid=0，模式对齐 MainActivity.probeRoot）+ Shizuku（pingBinder + 授权）
    // =============================================================================================

    /** root 可用（结果缓存 15s；只允许后台线程调用——su -c id 走子进程，主线程调用会卡 UI）。 */
    private boolean rootAvailable(Context ctx) {
        Boolean cached = rootCache;
        long now = SystemClock.elapsedRealtime();
        if (cached != null && now - rootCacheAt < PROBE_TTL_MS) return cached;
        boolean ok = probeRoot();
        rootCache = ok;
        rootCacheAt = now;
        return ok;
    }

    /** 与 MainActivity.probeRoot(:1206) 同模式：`su -c id`，首行含 uid=0 即可用。 */
    private boolean probeRoot() {
        Process p = null;
        try {
            p = Runtime.getRuntime().exec(new String[]{"su", "-c", "id"});
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String line = r.readLine();
            try {
                if (Build.VERSION.SDK_INT >= 26) {
                    if (!p.waitFor(3, TimeUnit.SECONDS)) p.destroy();
                } else {
                    p.waitFor();
                }
            } catch (Throwable ignored) {}
            return line != null && line.contains("uid=0");
        } catch (Throwable t) {
            return false;
        } finally {
            try { if (p != null) p.destroy(); } catch (Throwable ignored) {}
        }
    }

    /** Shizuku 可用（pingBinder + 授权，模式对齐 MainActivity.shizukuAvailable(:1187)；结果缓存 15s）。 */
    private boolean shizukuAvailable() {
        Boolean cached = shizukuCache;
        long now = SystemClock.elapsedRealtime();
        if (cached != null && now - shizukuCacheAt < PROBE_TTL_MS) return cached;
        boolean ok;
        try {
            ok = Shizuku.pingBinder()
                    && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            ok = false;
        }
        shizukuCache = ok;
        shizukuCacheAt = now;
        return ok;
    }

    /** Shizuku binder 是否活着（区分 SHIZUKU_UNAVAILABLE「服务没跑」与 SHIZUKU_DENIED「弹窗被拒」）。 */
    private boolean shizukuBinderAlive() {
        try {
            return Shizuku.pingBinder();
        } catch (Throwable t) {
            return false;
        }
    }

    /** 批次 11 Gate 1 修复：取得 IShizukuService（ShizukuBinderWrapper 包 Shizuku.getBinder() 后
     *  AIDL asInterface）。binder 死/未启动时返回 null，调用方（spawn/kill）均已判空。
     *  rikka.shizuku.Shizuku 无 newProcess 静态方法（javap 核实），AIDL 直连是 B 代理 DEVIATION-1 的定案。 */
    private static IShizukuService shizukuService() {
        try {
            return IShizukuService.Stub.asInterface(
                    new ShizukuBinderWrapper(Shizuku.getBinder()));
        } catch (Throwable t) {
            Log.w(TAG, "shizukuService: " + t);
            return null;
        }
    }

    // ===== 批次 14 修复（批次14f F2 根因）：doze_always_on 会话级 AOD 常显 =====
    /** 本会话改前的 doze_always_on 原值；null=本会话未改过；"ALREADY_1"=原本就是 1（非本会话所改，不还原）。 */
    private String dozeAodOriginal;
    /** 本会话是否真的改过 doze_always_on。批次66b：原实现用 null 同时表示「未改过」与「原值未设置」，
     *  于是原值未设置的机器（真机就是）收尾永远不还原 → 系统设置被永久改成 1（本轮真机实测）。 */
    private boolean dozeAodDirty;

    /** 会话建立：确保 doze_always_on=1（熄屏后 AOD 态合成持续，见 docs/批次14f-F2黑帧调查报告.md）。 */
    private void ensureDozeAodForSession(Context ctx) {
        try {
            String cur = privSettingGet(ctx, "get secure doze_always_on");
            if ("1".equals(cur)) {
                dozeAodOriginal = "ALREADY_1";
                dozeAodDirty = false;
                return;
            }
            // 原样保真：字符串 "null" 必须存下来；「本会话未改过」改由 dozeAodDirty 表示
            dozeAodOriginal = cur;
            dozeAodDirty = true;
            privSetting(ctx, "put secure doze_always_on 1");
            Log.i(TAG, "doze_always_on=1 for vscreen session (original=" + dozeAodOriginal + ")");
        } catch (Throwable t) {
            Log.w(TAG, "ensureDozeAod failed", t);
        }
    }

    /** 会话收尾：还原 doze_always_on 原值（幂等；无会话改动时不执行）。 */
    private void restoreDozeAod(Context ctx) {
        if (!dozeAodDirty) {   // 本会话没改过系统设置 → 什么都不动（幂等）
            dozeAodOriginal = null;
            return;
        }
        dozeAodDirty = false;
        String orig = dozeAodOriginal;
        dozeAodOriginal = null;
        if (orig == null || "ALREADY_1".equals(orig)) return;
        try {
            privSetting(ctx, "null".equals(orig)
                    ? "delete secure doze_always_on"
                    : "put secure doze_always_on " + orig);
            Log.i(TAG, "doze_always_on restored (" + orig + ")");
        } catch (Throwable t) {
            Log.w(TAG, "restoreDozeAod failed", t);
        }
    }

    /**
     * 特权执行 settings 子命令（root: su -c；shizuku: shell uid newProcess——shell 持 WRITE_SECURE_SETTINGS）。
     *
     * <p>批次70：**以回读判定成败**。真机实测：命令已生效，但 Shizuku 适配器在**读流阶段**抛异常，
     * 旧实现把它记成 {@code privSetting failed} —— 日志误导排查（批次66b/67 遗留）。现在：</p>
     * <ol>
     *   <li>执行阶段异常降级为 info（不再断言失败）；</li>
     *   <li>{@code put} 之后用 {@link #privSettingGet} 回读，回读值与期望一致才算 ok；</li>
     *   <li>结论日志统一为 {@code [b70] privSetting <args> ok=<bool> readback=<值>}。</li>
     * </ol>
     */
    private void privSetting(Context ctx, String args) {
        try {
            if (rootAvailable(ctx)) {
                Process p = Runtime.getRuntime().exec(new String[]{"su", "-c", "settings " + args});
                drain(p);
                p.waitFor(5, TimeUnit.SECONDS);
            } else {
                IShizukuService svc = shizukuService();
                if (svc != null) {
                    // 批次 14 Gate 修复：IRemoteProcess 流是 ParcelFileDescriptor、waitFor 无超时版
                    //（javac 实证）——复用既有 ShizukuProcessAdapter（extends Process，批次 11b）
                    Process p = new ShizukuProcessAdapter(svc.newProcess(
                            new String[]{"sh", "-c", "settings " + args}, null, null));
                    drain(p);
                    p.waitFor(5, TimeUnit.SECONDS);
                } else {
                    Log.w(TAG, "privSetting: no privilege channel for: " + args);
                }
            }
        } catch (Throwable t) {
            // 批次70：读流阶段异常 ≠ 失败（命令可能已生效）——结论交给下面的回读判定
            Log.i(TAG, "[b70] privSetting " + args + " exec-phase note: " + t);
        }
        String readbackCmd = readbackCmdFor(args);
        if (readbackCmd == null) return;
        String expect = args.substring(args.lastIndexOf(' ') + 1).trim();
        // 批次80：回读腿同样要区分「读不到」与「值不对」——privSettingGet 的 "null" 契约被
        // ensure 原值判断路径依赖，不能改；这里改用 raw 版本：Java null = 读不到（不下结论）。
        String seen = privSettingGetRaw(ctx, readbackCmd);
        if (seen == null) {
            Log.i(TAG, "[b70] privSetting " + args + " unverified (readback unreadable)");
            return;
        }
        if (seen.trim().equals(expect)) {
            Log.i(TAG, "[b70] privSetting " + args + " ok=true readback=" + seen);
        } else {
            Log.w(TAG, "[b70] privSetting " + args + " ok=false readback=" + seen);
        }
    }

    /** 批次70：把 {@code put a b value} 映射成回读命令 {@code get a b}；非 put 形式返回 null（不判定）。 */
    private static String readbackCmdFor(String args) {
        if (args == null) return null;
        String a = args.trim();
        if (!a.startsWith("put ")) return null;
        int lastSpace = a.lastIndexOf(' ');
        if (lastSpace <= 4) return null;
        return "get " + a.substring(4, lastSpace).trim();
    }

    /** 特权读 settings 值（供 ensure 判断原值；失败/不可得返回 "null"）。 */
    private String privSettingGet(Context ctx, String args) {
        try {
            if (rootAvailable(ctx)) {
                Process p = Runtime.getRuntime().exec(new String[]{"su", "-c", "settings " + args});
                return readAll(p);
            }
            IShizukuService svc = shizukuService();
            if (svc != null) {
                Process p = new ShizukuProcessAdapter(svc.newProcess(
                        new String[]{"sh", "-c", "settings " + args}, null, null));
                return readAll(p);
            }
        } catch (Throwable t) {
            Log.w(TAG, "privSettingGet failed: " + args, t);
        }
        return "null";
    }

    /**
     * 批次80：与 {@link #privSettingGet} 同链路，但「读不到」（无特权通道 / 抛异常）返回
     * Java {@code null}，与真值字面量 {@code "null"} 区分开 —— 供 privSetting 的成败判定使用，
     * 避免把「读流失败 / 没有特权通道」记成「值不对」的假报错。
     */
    private String privSettingGetRaw(Context ctx, String args) {
        try {
            if (rootAvailable(ctx)) {
                Process p = Runtime.getRuntime().exec(new String[]{"su", "-c", "settings " + args});
                return readAll(p);
            }
            IShizukuService svc = shizukuService();
            if (svc != null) {
                Process p = new ShizukuProcessAdapter(svc.newProcess(
                        new String[]{"sh", "-c", "settings " + args}, null, null));
                return readAll(p);
            }
            Log.i(TAG, "[b80] privSetting readback: no privilege channel");
        } catch (Throwable t) {
            Log.i(TAG, "[b80] privSetting readback unreadable: " + args + " " + t);
        }
        return null;
    }


    // =============================================================================================
    // ChannelSelector：dsh_prefs/vscreen_channel（auto|root|shizuku，缺省 auto）
    // =============================================================================================

    private String channelPref(Context ctx) {
        try {
            String v = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString(KEY_CHANNEL_PREF, PREF_AUTO);
            if (PREF_ROOT.equals(v) || PREF_SHIZUKU.equals(v)) return v;
            return PREF_AUTO;
        } catch (Throwable t) {
            return PREF_AUTO;
        }
    }

    // =============================================================================================
    // ServerLauncher：探活复用（引擎单飞同款）→ 按通道拉起 → 等健康
    // =============================================================================================

    /** ensure 会话：复用健康服务端；否则选道拉起（auto 模式失败自动换道）。并发由单飞闸门收敛。 */
    private SelectResult ensureSession(Context ctx, String pref) {
        // 单飞闸门：已有 spawn/ensure 流程在跑 → 轮询探活等待复用（引擎 beginEngineStart 退让同款）
        long waited = 0;
        while (!spawnInFlight.compareAndSet(false, true)) {
            JSONObject h = probeHealth(ctx);
            if (healthOk(h)) {
                String ch = inferChannel(h);
                sessionChannel = ch;
                return SelectResult.ok(ch);
            }
            try { Thread.sleep(300); } catch (InterruptedException e) { return SelectResult.fail(REASON_SPAWN_FAILED); }
            waited += 300;
            if (waited >= GATE_WAIT_MS) {
                Log.w(TAG, "ensureSession: gate wait timeout (" + waited + "ms)");
                return SelectResult.fail(REASON_SPAWN_FAILED);
            }
        }
        try {
            JSONObject h = probeHealth(ctx);
            if (healthOk(h)) {
                // 8998 已有本 App 的健康服务端（token+version 匹配）→ 复用不重拉（引擎单飞同款）
                String ch = inferChannel(h);
                sessionChannel = ch;
                ensureSupervisor();
                return SelectResult.ok(ch);
            }
            if (h != null) {
                // 8998 可达但 token/版本不匹配（BAD_TOKEN / 旧版本 / 异主进程）→ 按 pidfile 清掉再重拉
                Log.w(TAG, "8998 reachable but foreign/mismatched (token or version) -> kill by pidfile, respawn");
                killByPidfile(ctx);
                try { Thread.sleep(500); } catch (InterruptedException ignored) {}
            }
            // 选道（契约 §0/§2：auto = root 优先；强制通道只认对应特权，不自动换）
            boolean rootOk = rootAvailable(ctx);
            boolean shizukuOk = shizukuAvailable();
            String ch;
            if (PREF_ROOT.equals(pref)) {
                if (!rootOk) return SelectResult.fail(REASON_ROOT_DENIED);
                ch = CHANNEL_ROOT;
            } else if (PREF_SHIZUKU.equals(pref)) {
                if (!shizukuOk) {
                    return SelectResult.fail(shizukuBinderAlive()
                            ? REASON_SHIZUKU_DENIED : REASON_SHIZUKU_UNAVAILABLE);
                }
                ch = CHANNEL_SHIZUKU;
            } else {
                if (rootOk) ch = CHANNEL_ROOT;
                else if (shizukuOk) ch = CHANNEL_SHIZUKU;
                else return SelectResult.fail(REASON_NO_PRIVILEGE);
            }
            int r1 = spawnAndAwait(ctx, ch);
            if (r1 != 0 && PREF_AUTO.equals(pref)) {
                // 契约 §2 降级（仅 auto）：root 拉起失败（su 被拒）→ 试 shizuku（ROOT_DENIED）；
                // shizuku 起不来 → 有 root 转 root（SHIZUKU_UNAVAILABLE）
                String alt = CHANNEL_ROOT.equals(ch) ? CHANNEL_SHIZUKU : CHANNEL_ROOT;
                boolean altOk = CHANNEL_ROOT.equals(alt) ? rootOk : shizukuOk;
                if (altOk) {
                    lastFailReason = CHANNEL_ROOT.equals(ch) ? REASON_ROOT_DENIED : REASON_SHIZUKU_UNAVAILABLE;
                    Log.w(TAG, "spawn via " + ch + " failed -> auto fallback " + alt
                            + " (reason=" + lastFailReason + ")");
                    ch = alt;
                    r1 = spawnAndAwait(ctx, ch);
                }
            }
            if (r1 != 0) {
                // r1==1：通道不可用（su 被拒 / Shizuku 服务或授权缺失）；r1==2：拉起但 /health 未就绪
                String reason = r1 == 1
                        ? (CHANNEL_ROOT.equals(ch) ? REASON_ROOT_DENIED : REASON_SHIZUKU_UNAVAILABLE)
                        : REASON_SPAWN_FAILED;
                Log.w(TAG, "spawn failed via " + ch + " -> " + reason);
                return SelectResult.fail(reason);
            }
            sessionChannel = ch;
            ensureSupervisor();
            return SelectResult.ok(ch);
        } finally {
            spawnInFlight.set(false);
        }
    }

    /**
     * 按通道拉起服务端并等待 /health 就绪。
     *
     * @return 0=就绪；1=通道不可用（exec 异常 / Shizuku binder 缺失）；2=拉起后健康等待超时
     */
    private int spawnAndAwait(Context ctx, String channel) {
        File jar;
        try {
            jar = ensureServerJar(ctx, channel);
        } catch (Throwable t) {
            Log.e(TAG, "vscreen-server.jar unavailable (等待 build.sh assets 接线): " + t);
            return 2;
        }
        String jarAbs = jar.getAbsolutePath();
        String pidfile = new File(jar.getParentFile(), "vscreen.pid").getAbsolutePath();
        String token = token(ctx);
        try {
            if (CHANNEL_ROOT.equals(channel)) {
                // root：`su -c '<完整命令>'`（契约 §1：两通道同构的 app_process 串）
                String cmd = "app_process -Djava.class.path=" + jarAbs
                        + " /system/bin --nice-name=dsh-vscreen " + SERVER_MAIN
                        + " --token " + token + " --port " + SERVER_PORT + " --pidfile " + pidfile;
                Log.i(TAG, "spawn vscreen server via root: " + maskToken(cmd, token));
                Process p = Runtime.getRuntime().exec(new String[]{"su", "-c", cmd});
                drain(p);
            } else {
                // shizuku：IShizukuService.newProcess(argv, null, null)（DEVIATION：AAR 无 Shizuku.newProcess，
                // 用 ShizukuBinderWrapper + AIDL 直连，签名语义与契约 §1 一致；上游 v1.9 同款形态）
                IShizukuService svc = shizukuService();
                if (svc == null) {
                    Log.w(TAG, "shizuku service unavailable for spawn");
                    return 1;
                }
                String[] argv = {
                        "app_process", "-Djava.class.path=" + jarAbs, "/system/bin",
                        "--nice-name=dsh-vscreen", SERVER_MAIN,
                        "--token", token, "--port", String.valueOf(SERVER_PORT), "--pidfile", pidfile
                };
                Log.i(TAG, "spawn vscreen server via shizuku: " + maskToken(joinArgv(argv), token));
                IRemoteProcess rp = svc.newProcess(argv, null, null);
                drain(new ShizukuProcessAdapter(rp));
            }
        } catch (Throwable t) {
            Log.w(TAG, "spawn via " + channel + " threw: " + t);
            return 1;
        }
        long deadline = SystemClock.elapsedRealtime() + HEALTH_WAIT_MS;
        while (SystemClock.elapsedRealtime() < deadline) {
            JSONObject h = probeHealth(ctx);
            if (healthOk(h)) {
                Log.i(TAG, "vscreen server healthy via " + channel + ": " + h);
                return 0;
            }
            try { Thread.sleep(HEALTH_POLL_MS); } catch (InterruptedException e) { return 2; }
        }
        Log.w(TAG, "vscreen server not healthy within " + HEALTH_WAIT_MS + "ms (channel=" + channel + ")");
        return 2;
    }

    /**
     * 确保服务端 JAR 位于拉起通道可读取的位置。
     * 内部副本是可信源；Shizuku 的 shell(uid=2000) 无法读取 App 私有 files 目录，
     * 因此该通道额外复制到 App 专属外部目录后再作为 classpath。
     */
    private File ensureServerJar(Context ctx, String channel) throws IOException {
        File dir = new File(ctx.getFilesDir(), "vscreen");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir failed: " + dir);
        File jar = new File(dir, "vscreen-server.jar");
        // 批次66b：包内 assets 是唯一可信源。旧实现「文件已存在就沿用」，升级后盘上仍是旧服务端
        // ——真机实测：APK 内已是 b12，盘上还是 b11 → App 判 version mismatch → kill/respawn 反复
        // → shizuku 通道 pidfile 杀不掉残留服务端 → 8998 被占 → SPAWN_FAILED 死循环（虚拟屏彻底不可用）。
        // 现按**内容哈希**比对：b11→b12 属等长改动（size 完全相同），只有哈希能识别，不一致即重抽。
        byte[] asset;
        try {
            asset = readAll(ctx.getAssets().open(SERVER_JAR_ASSET), 4 * 1024 * 1024);
        } catch (IOException e) {
            throw new IOException("assets/" + SERVER_JAR_ASSET + " 缺失（等待构建把服务端 jar 放进 APK assets）: "
                    + String.valueOf(e.getMessage()));
        }
        if (asset == null || asset.length == 0) {
            throw new IOException("assets/" + SERVER_JAR_ASSET + " 为空（等待构建把服务端 jar 放进 APK assets）");
        }
        if (jar.exists() && jar.length() == asset.length) {
            byte[] onDisk = readFileBytesQuiet(jar);
            if (onDisk != null && sha1Hex(asset).equals(sha1Hex(onDisk))) {
                return CHANNEL_SHIZUKU.equals(channel) ? stageServerJarForShizuku(ctx, jar) : jar;
            }
        }
        OutputStream out = null;
        try {
            out = new FileOutputStream(jar, false);
            out.write(asset);
            out.flush();
        } finally {
            try { if (out != null) out.close(); } catch (Throwable ignored) {}
        }
        Log.i(TAG, "extracted " + SERVER_JAR_ASSET + " -> " + jar.getAbsolutePath()
                + " (" + jar.length() + " bytes)");
        return CHANNEL_SHIZUKU.equals(channel) ? stageServerJarForShizuku(ctx, jar) : jar;
    }

    /** 将可信内部 JAR 复制到 Shizuku shell 可读的 App 专属外部目录。 */
    private File stageServerJarForShizuku(Context ctx, File source) throws IOException {
        File dir = ctx.getExternalFilesDir("vscreen");
        if (dir == null) {
            throw new IOException("Shizuku 通道需要 App 专属外部目录，但当前不可用");
        }
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir failed: " + dir);
        File target = new File(dir, "vscreen-server.jar");
        InputStream in = null;
        FileOutputStream out = null;
        try {
            in = new FileInputStream(source);
            out = new FileOutputStream(target, false);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
            try { out.getFD().sync(); } catch (Throwable ignored) {}
            target.setReadable(true, false);
            Log.i(TAG, "staged Shizuku vscreen jar -> " + target.getAbsolutePath()
                    + " (" + target.length() + " bytes)");
            return target;
        } finally {
            try { if (in != null) in.close(); } catch (Throwable ignored) {}
            try { if (out != null) out.close(); } catch (Throwable ignored) {}
        }
    }

    // =============================================================================================
    // 服务端探活 /health（127.0.0.1:8998，X-DSH-TOKEN 鉴权；对齐 a11yBridgeAlive 的 HttpURLConnection 模式）
    // =============================================================================================

    /**
     * 探测 /health。返回值：null=不可达；JSON ok:false（BAD_TOKEN）=可达但 token 不对；
     * ok:true 且 version 与 {@link #SERVER_VERSION} 一致 = 本 App 的健康服务端。
     */
    private JSONObject probeHealth(Context ctx) {
        return probeHealth(ctx, 1500);
    }

    /** 批次66：带读取超时的探活（supervisor 用更宽松的 3000ms，锁屏/低功耗下抗抖动）。 */
    private JSONObject probeHealth(Context ctx, int readTimeoutMs) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://127.0.0.1:" + SERVER_PORT + "/health").openConnection();
            c.setConnectTimeout(800);
            c.setReadTimeout(readTimeoutMs);
            c.setRequestProperty("X-DSH-TOKEN", token(ctx));
            int code = c.getResponseCode();
            if (code == 403) return new JSONObject("{\"ok\":false,\"reason\":\"BAD_TOKEN\"}");
            if (code != 200) return null;
            InputStream in = c.getInputStream();
            StringBuilder sb = new StringBuilder();
            byte[] buf = new byte[2048];
            int n;
            while ((n = in.read(buf)) > 0 && sb.length() < 65536) {
                sb.append(new String(buf, 0, n, "UTF-8"));
            }
            try { in.close(); } catch (Throwable ignored) {}
            return new JSONObject(sb.toString());
        } catch (Throwable t) {
            return null;
        } finally {
            if (c != null) {
                try { c.disconnect(); } catch (Throwable ignored) {}
            }
        }
    }

    /** 健康判据：可达 + ok:true + version 匹配（契约 §1：version 不匹配不复用）。 */
    private boolean healthOk(JSONObject h) {
        return h != null && h.optBoolean("ok") && SERVER_VERSION.equals(h.optString("version"));
    }

    /** 快速探活（路由透传前的廉价判活）。 */
    private boolean serverAliveQuick(Context ctx) {
        return healthOk(probeHealth(ctx));
    }

    /** 从 /health 的 uid 推断服务端实际通道：uid=0 → root，否则（shell=2000）→ shizuku。 */
    private String inferChannel(JSONObject h) {
        return h != null && h.optInt("uid", -1) == 0 ? CHANNEL_ROOT : CHANNEL_SHIZUKU;
    }

    // =============================================================================================
    // SessionSupervisor：后台探活线程（间隔 5s ≥ 契约 3s），死亡且 auto 且另一通道可用 → 换道重拉
    // =============================================================================================

    private void ensureSupervisor() {
        synchronized (stateLock) {
            if (supervisorThread != null && supervisorThread.isAlive()) return;
            shutdownRequested = false;
            Thread t = new Thread(new Runnable() {
                @Override public void run() { supervisorLoop(); }
            }, "vscreen-supervisor");
            t.setDaemon(true);
            t.start();
            supervisorThread = t;
            Log.i(TAG, "session supervisor started (interval " + SUPERVISOR_INTERVAL_MS + "ms)");
        }
    }

    /**
     * 批次66：抗抖动探活 —— 判死前先自证：失败后立即重试 {@link #SUPERVISOR_PROBE_RETRY} 次
     * （各间隔 400ms），任一成功即视为健康。
     *
     * <p>动机（真机症状「虚拟屏销毁重建再销毁」）：锁屏/深睡眠/CPU 被抢占时，单次 1.5s 读超时
     * 极易假死；旧实现一次失败就 kill 服务端 + 换道重建，下一次 tick 再失败再重建，
     * auto 通道还会 root↔shizuku 无限乒乓 —— 用户看到的就是「销毁 → 重建 → 销毁」的死循环，
     * 且期间 display 不断被销毁，任务自然跑不动。</p>
     */
    private boolean supervisorProbe(Context ctx) {
        Context c = ctx != null ? ctx : appContext;
        for (int i = 0; i <= SUPERVISOR_PROBE_RETRY; i++) {
            if (healthOk(probeHealth(c, SUPERVISOR_PROBE_READ_TIMEOUT_MS))) return true;
            if (i < SUPERVISOR_PROBE_RETRY) {
                try {
                    Thread.sleep(SUPERVISOR_PROBE_RETRY_GAP_MS);
                } catch (InterruptedException e) {
                    return false;
                }
            }
        }
        return false;
    }

    private void supervisorLoop() {
        while (!shutdownRequested) {
            try {
                Thread.sleep(SUPERVISOR_INTERVAL_MS);
            } catch (InterruptedException e) {
                return;
            }
            try {
                if (!sessionActive || sessionChannel == null) continue;
                Context ctx = appContext;
                if (supervisorProbe(ctx)) {
                    renewWakelock(); // 会话活跃期间持续续期 wakelock（死亡后最多 30s 自动释放）
                    healthFailStreak = 0;
                    long now = SystemClock.elapsedRealtime();
                    if (healthySinceAt == 0L) healthySinceAt = now;
                    if (now - healthySinceAt >= SESSION_STABLE_MS && recoveryAttempts != 0) {
                        Log.i(TAG, "vscreen session stable " + SESSION_STABLE_MS + "ms -> recovery budget reset");
                        recoveryAttempts = 0;
                        recoveryChain.clear();
                    }
                    if (screenOffAt > 0L) assertPanelAodIfNeeded(ctx, false);
                    continue;
                }
                healthySinceAt = 0L;
                healthFailStreak++;
                Log.w(TAG, "vscreen health miss " + healthFailStreak + "/" + HEALTH_FAIL_THRESHOLD
                        + " (channel=" + sessionChannel + ")");
                if (healthFailStreak < HEALTH_FAIL_THRESHOLD) {
                    renewWakelock(); // 抖动窗口内保持保活，等下一次 tick 自证
                    continue;
                }
                long now = SystemClock.elapsedRealtime();
                if (screenOffAt > 0L && now - screenOffAt < SCREEN_OFF_GRACE_MS) {
                    // 灭屏宽限：面板状态切换本身会拖慢调度/loopback，此时杀进程重建属于自伤
                    Log.w(TAG, "vscreen death suspected inside screen-off grace -> keep session, reassert AOD");
                    assertPanelAodIfNeeded(ctx, true);
                    renewWakelock();
                    continue;
                }
                if (now - lastRecoveryAt < RECOVERY_COOLDOWN_MS) {
                    Log.w(TAG, "vscreen recovery cooling down ("
                            + (RECOVERY_COOLDOWN_MS - (now - lastRecoveryAt))
                            + "ms left) -> skip kill/respawn");
                    renewWakelock();
                    continue;
                }
                healthFailStreak = 0;
                handleSessionDeath();
            } catch (Throwable t) {
                Log.w(TAG, "supervisor tick failed", t);
            }
        }
        Log.i(TAG, "session supervisor stopped");
    }

    /**
     * 探活死亡处理（契约 §2 降级，仅 auto 换道；强制通道只诚实报错）：
     * <ol>
     *   <li>auto 且另一通道可用 → kill 旧进程 → 换道重拉 → 按上次 create 参数重建 display
     *       （服务端单会话，进程死则 display 必失，重建才能算「会话恢复」G3）；</li>
     *   <li>救不回来 → SESSION_DEAD + 掉线通知 + 释放 wakelock（对齐 a11y 掉线通知模式）。</li>
     * </ol>
     * <p>批次66 追加护栏（针对「销毁重建再销毁」抖动环）：</p>
     * <ul>
     *   <li>抢救预算 {@link #RECOVERY_MAX_ATTEMPTS}：超预算直接判死，不再无限重建；</li>
     *   <li>抢救链 {@link #recoveryChain}：同一链内不重复换道，杜绝 root↔shizuku 乒乓；</li>
     *   <li>同通道就地重拉一次（alt==cur）优先于直接判死，避免「一次抖动 → 判死 → 插件立刻 create」
     *       的反复；</li>
     *   <li>冷却 {@link #RECOVERY_COOLDOWN_MS} 由 supervisor 判定。</li>
     * </ul>
     */
    private void handleSessionDeath() {
        Context ctx = appContext;
        if (ctx == null) return;
        String pref = channelPref(ctx);
        String cur = sessionChannel;
        if (recoveryAttempts >= RECOVERY_MAX_ATTEMPTS) {
            Log.w(TAG, "vscreen recovery budget exhausted (" + recoveryAttempts + "/"
                    + RECOVERY_MAX_ATTEMPTS + ") -> SESSION_DEAD without respawn");
            markSessionDead(ctx, lastFailReason != null ? lastFailReason : REASON_SESSION_DEAD);
            return;
        }
        String alt = null;
        String reason = null;
        if (PREF_AUTO.equals(pref)) {
            if (CHANNEL_ROOT.equals(cur) && shizukuAvailable() && !recoveryChain.contains(CHANNEL_SHIZUKU)) {
                alt = CHANNEL_SHIZUKU;
                reason = REASON_ROOT_DENIED;
            } else if (CHANNEL_SHIZUKU.equals(cur) && rootAvailable(ctx) && !recoveryChain.contains(CHANNEL_ROOT)) {
                alt = CHANNEL_ROOT;
                reason = REASON_SHIZUKU_UNAVAILABLE;
            }
        }
        if (alt == null) {
            // 批次66：换道无路（强制通道 / 抢救链已试过对面）→ 先在同一通道就地重拉一次
            alt = cur;
            reason = lastFailReason != null ? lastFailReason : REASON_SESSION_DEAD;
        }
        Log.w(TAG, "vscreen session dead (channel=" + cur + ", respawnAs=" + alt + ", reason=" + reason
                + ", attempts=" + recoveryAttempts + "/" + RECOVERY_MAX_ATTEMPTS + ")");
        recoveryAttempts++;
        lastRecoveryAt = SystemClock.elapsedRealtime();
        recoveryChain.add(alt);
        if (spawnInFlight.compareAndSet(false, true)) {
            try {
                killByPidfile(ctx); // 旧进程残留清理（探活死亡 ≠ 进程必然已退）
                if (spawnAndAwait(ctx, alt) == 0) {
                    String body = lastCreateBody;
                    boolean rebuilt = false;
                    if (body != null) {
                        ProxyResult r = proxyRequest(ctx, "POST", "/vscreen/create", body, 30000);
                        rebuilt = r != null && jsonOk(r.body);
                    }
                    if (rebuilt) {
                        sessionChannel = alt;
                        lastFailReason = reason;
                        healthFailStreak = 0;
                        healthySinceAt = SystemClock.elapsedRealtime();
                        ensureScreenReceiver(ctx);
                        Log.i(TAG, "vscreen session recovered via " + alt + " (reason=" + reason
                                + ", attempt=" + recoveryAttempts + ")");
                        return; // wakelock 未释放，下个 tick 继续续期
                    }
                }
            } finally {
                spawnInFlight.set(false);
            }
        }
        markSessionDead(ctx, reason);
    }

    /** 批次66：统一「救不回来」收尾（幂等）。批次14/12w 的 doze/预览收尾也收拢到这里。 */
    private void markSessionDead(Context ctx, String reason) {
        sessionActive = false;
        sessionChannel = null;
        lastFailReason = REASON_SESSION_DEAD;
        healthFailStreak = 0;
        healthySinceAt = 0L;
        recoveryChain.clear();
        releaseScreenReceiver();
        releasePanelWakeLock();
        releaseWakelock();
        // 批次 14 修复：会话死亡且救不回 → 恢复 doze_always_on 原值
        restoreDozeAod(ctx);
        // 批次 12w：会话死亡且救不回（SESSION_DEAD）→ 停预览悬浮窗
        VscreensPreviewService.stopSession();
        postSessionDeadNotification(ctx, reason);
    }

    // =============================================================================================
    // WakelockOwner：会话活跃（create 成功 → close/shutdown/探活死亡）持 PARTIAL_WAKE_LOCK
    // =============================================================================================

    private void acquireWakelock(Context ctx) {
        try {
            PowerManager pm = (PowerManager) ctx.getApplicationContext()
                    .getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            synchronized (stateLock) {
                if (wakeLock == null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG);
                    wakeLock.setReferenceCounted(false);
                }
                wakeLock.acquire(WAKELOCK_TIMEOUT_MS);
            }
            Log.i(TAG, "vscreen wakelock acquired (" + WAKELOCK_TIMEOUT_MS + "ms, supervisor 续期)");
        } catch (Throwable t) {
            Log.w(TAG, "vscreen wakelock acquire failed", t);
        }
    }

    private void renewWakelock() {
        synchronized (stateLock) {
            try {
                if (wakeLock != null && wakeLock.isHeld()) wakeLock.acquire(WAKELOCK_TIMEOUT_MS);
            } catch (Throwable ignored) {}
        }
    }

    private void releaseWakelock() {
        synchronized (stateLock) {
            try {
                if (wakeLock != null && wakeLock.isHeld()) {
                    wakeLock.release();
                    Log.i(TAG, "vscreen wakelock released");
                }
            } catch (Throwable ignored) {}
        }
    }

    // =============================================================================================
    // shutdown（契约 §2/§1：close（overlay 还原）→ /vscreen/kill → kill pidfile pid 兜底 → 释放 wakelock）
    // =============================================================================================

    // =============================================================================================
    // 批次66：锁屏挂机保障（灭屏宽限 + AOD 复述 + 面板保活兜底）
    // 背景：批次14f 已证 —— 面板 OFF 时 SF 停止合成 trusted VirtualDisplay，锁屏挂机必然读到黑帧。
    //   本段做三件事：① 会话期注册灭屏广播，灭屏后进入宽限期（不杀进程/不重建）；
    //   ② 灭屏瞬间复述 doze_always_on=1（AOD 态合成不中断，非侵入式首选）；
    //   ③ AOD 被 ROM 忽略（面板真进入 OFF）时，升一级持有「面板不熄」唤醒锁，
    //      仍保持锁屏（仅屏幕不熄），保证 SF 继续合成、自动化继续跑。
    // =============================================================================================

    /** 会话建立/恢复时注册灭屏广播（幂等；仅会话存活期注册，会话收尾即注销）。 */
    private void ensureScreenReceiver(final Context ctx) {
        if (screenStateReceiver != null) return;
        final Context app = ctx.getApplicationContext();
        try {
            BroadcastReceiver r = new BroadcastReceiver() {
                @Override public void onReceive(Context context, Intent intent) {
                    String action = intent == null ? null : intent.getAction();
                    if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                        screenOffAt = SystemClock.elapsedRealtime();
                        Log.i(TAG, "[b66] screen off during vscreen session -> grace "
                                + SCREEN_OFF_GRACE_MS + "ms, reassert AOD");
                        // 广播在主线程：AOD 复述 + 面板兜底必须挪到后台线程（零主线程阻塞红线）
                        new Thread(new Runnable() {
                            @Override public void run() {
                                assertPanelAodIfNeeded(app, true);
                                escalatePanelKeepAliveIfNeeded(app);
                            }
                        }, "vscreen-screenoff").start();
                    } else if (Intent.ACTION_SCREEN_ON.equals(action)) {
                        // 批次66b（真机实测）：这次 SCREEN_ON 很可能是我们自己的面板保活锁唤醒的
                        //（ACQUIRE_CAUSES_WAKEUP → 面板 ON → SCREEN_ON 广播）。旧逻辑在这里直接清宽限 +
                        // 释放锁，系统随后（约 10s）又熄屏 → 再唤醒 → 锁屏期间屏幕反复闪烁。
                        // 判据用「是否仍锁定」：仍锁定 = 用户没解锁 → 保留宽限与面板锁（继续保持屏幕不熄）。
                        if (isKeyguardLocked(app)) {
                            Log.i(TAG, "[b66] screen on while still locked -> keep panel keepalive");
                        } else {
                            screenOffAt = 0L;
                            releasePanelWakeLock();
                            Log.i(TAG, "[b66] screen on/unlock -> screen-off grace cleared");
                        }
                    } else if (Intent.ACTION_USER_PRESENT.equals(action)) {
                        // 用户真解锁：撤销锁屏挂机保障
                        screenOffAt = 0L;
                        releasePanelWakeLock();
                        Log.i(TAG, "[b66] screen on/unlock -> screen-off grace cleared");
                    }
                }
            };
            IntentFilter f = new IntentFilter();
            f.addAction(Intent.ACTION_SCREEN_OFF);
            f.addAction(Intent.ACTION_SCREEN_ON);
            f.addAction(Intent.ACTION_USER_PRESENT);
            app.registerReceiver(r, f);
            screenStateReceiver = r;
            Log.i(TAG, "[b66] screen state receiver registered");
        } catch (Throwable t) {
            Log.w(TAG, "register screen receiver failed", t);
        }
    }

    /** 会话收尾/判死：注销灭屏广播（幂等；未注册时零操作）。 */
    private void releaseScreenReceiver() {
        BroadcastReceiver r = screenStateReceiver;
        screenStateReceiver = null;
        screenOffAt = 0L;
        if (r == null) return;
        try {
            Context app = appContext;
            if (app != null) app.unregisterReceiver(r);
            Log.i(TAG, "[b66] screen state receiver released");
        } catch (Throwable ignored) {}
    }

    /**
     * AOD 复述（限流）：仅在本会话确实写过 doze_always_on 时执行；
     * force=true 用于灭屏瞬间（必须立即复述，跳过 60s 限流）。
     */

    /** 设备当前是否仍处于锁屏（未解锁）。批次66b：用于区分「我们的保活锁把面板唤醒」与「用户解锁」。 */
    private boolean isKeyguardLocked(Context ctx) {
        try {
            android.app.KeyguardManager km = (android.app.KeyguardManager)
                    ctx.getSystemService(Context.KEYGUARD_SERVICE);
            return km != null && km.isKeyguardLocked();
        } catch (Throwable t) {
            return false;   // 取不到状态就按「已解锁」处理：宁可多释放一次锁，也不长期占着屏幕
        }
    }
    private void assertPanelAodIfNeeded(Context ctx, boolean force) {
        if (ctx == null) return;
        if (!dozeAodDirty) return;   // 本会话没写过 → 不复述（避免只读任务也去改系统设置）
        long now = SystemClock.elapsedRealtime();
        if (!force && now - lastAodAssertAt < AOD_REASSERT_INTERVAL_MS) return;
        lastAodAssertAt = now;
        privSetting(ctx, "put secure doze_always_on 1");
        Log.i(TAG, "[b66] doze_always_on reasserted (force=" + force + ")");
    }

    /**
     * 锁屏挂机兜底：灭屏 1.5s 后若面板真进入 OFF（AOD 被系统/厂商 ROM 忽略），
     * 持一把「面板不熄」唤醒锁（ACQUIRE_CAUSES_WAKEUP + SCREEN_DIM），
     * 保证 SurfaceFlinger 继续合成虚拟屏（批次14f 结论：唯一充分条件是面板不 OFF）。
     * 设备仍处于锁屏态，仅屏幕不熄灭；解锁/会话收尾即释放。
     * 偏好 {@link #KEY_LOCK_PANEL_KEEPALIVE}（缺省 true）可整体关闭。
     */
    @SuppressWarnings("deprecation") // SCREEN_DIM_WAKE_LOCK 已废弃但仍是 targetSdk 28 下唯一「点亮面板」手段
    private void escalatePanelKeepAliveIfNeeded(Context ctx) {
        try {
            if (!ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getBoolean(KEY_LOCK_PANEL_KEEPALIVE, true)) {
                Log.i(TAG, "[b66] panel keepalive disabled by preference");
                return;
            }
            Thread.sleep(1500); // 等面板状态落定：AOD 生效则完全不打扰
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            if (pm.isInteractive()) {
                Log.i(TAG, "[b66] panel still interactive after screen off (AOD/ON) -> no escalation");
                return;
            }
            synchronized (stateLock) {
                if (panelWakeLock == null) {
                    panelWakeLock = pm.newWakeLock(
                            PowerManager.SCREEN_DIM_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                            PANEL_WAKELOCK_TAG);
                    panelWakeLock.setReferenceCounted(false);
                }
                if (!panelWakeLock.isHeld()) {
                    // 批次80：上面 sleep(1.5s) 期间会话可能已收尾/退出（receiver 已注销）——再核对一次，
                    // 否则会把「已结束的会话」点亮到下一次会话收尾为止（锁泄漏 + 屏幕一直微亮）。
                    if (!sessionActive || shutdownRequested) {
                        Log.i(TAG, "[b80] panel keepalive skipped: session already ended");
                        return;
                    }
                    if (!ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                            .getBoolean(KEY_LOCK_PANEL_KEEPALIVE, true)) {
                        Log.i(TAG, "[b80] panel keepalive skipped: preference turned off");
                        return;
                    }
                    panelWakeLock.acquire(); // 无超时：由解锁/会话收尾路径释放（防泄漏见 markSessionDead/shutdown）
                    Log.i(TAG, "[b66] panel keepalive acquired (panel was OFF while session active)");
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "escalatePanelKeepAlive failed", t);
        }
    }

    /** 释放面板保活锁（幂等）。 */
    private void releasePanelWakeLock() {
        synchronized (stateLock) {
            try {
                if (panelWakeLock != null && panelWakeLock.isHeld()) {
                    panelWakeLock.release();
                    Log.i(TAG, "[b66] panel keepalive released");
                }
            } catch (Throwable ignored) {}
        }
    }

    /** onDestroy 调用：异步线程收尾（onDestroy 在主线程，直接做 HTTP 会抛 NetworkOnMainThreadException）。 */
    public void shutdownAsync(final Context ctx) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    shutdown(ctx);
                } catch (Throwable t) {
                    Log.w(TAG, "vscreen shutdownAsync failed", t);
                }
            }
        }, "vscreen-shutdown").start();
    }

    /** 会话收尾。可在任意后台线程调用；幂等（服务端不在时各步 best-effort 跳过）。 */
    public void shutdown(Context ctx) {
        Context app = ctx.getApplicationContext();
        appContext = app;
        shutdownRequested = true;
        Log.i(TAG, "vscreen shutdown begin");
        // 0) 契约收尾：若本轮关联了特定目标 App（如微博/抖音等），强杀目标应用进程，彻底消除后台残留
        killTargetAppIfAny(app);
        // 1) close：overlay 会话还原 overlay_display_devices 改前值（服务端职责；App 只触发）
        if (serverAliveQuick(app)) {
            proxyRequest(app, "POST", "/vscreen/close", "{}", 10000);
            // 2) kill：服务端清理后 System.exit(0)（契约 §1）
            proxyRequest(app, "POST", "/vscreen/kill", "{}", 10000);
        }
        // 3) pidfile 兜底：服务端已死/无响应时按 pid kill（root 或 shizuku 通道）
        killByPidfile(app);
        // 4) 释放 wakelock + 清会话状态
        releaseWakelock();
        // 批次66：会话收尾 → 撤销锁屏挂机保障（面板保活锁 + 灭屏广播 + 抖动计数）
        releasePanelWakeLock();
        releaseScreenReceiver();
        healthFailStreak = 0;
        healthySinceAt = 0L;
        recoveryAttempts = 0;
        recoveryChain.clear();
        sessionActive = false;
        sessionChannel = null;
        // 批次 14 修复：会话收尾 → 恢复 doze_always_on 原值
        restoreDozeAod(app);
        // 批次 12w：会话收尾（shutdown）→ 停预览悬浮窗
        VscreensPreviewService.stopSession();
        Log.i(TAG, "vscreen shutdown done");
    }

    /** 按 pidfile 里的 pid kill 服务端（root → su kill；否则 Shizuku → newProcess kill；皆无则只能放弃）。
     *  批次66b 两处修正（真机取证）：① 两个通道的 pidfile 都要查——旧实现只看私有目录，而 Shizuku
     *  通道的 pidfile 在 App 专属外部目录，于是残留服务端永远杀不掉（8998 被占 → 新服务端起不来）；
     *  ② 追加「按进程名兜底」——实测 pidfile 里写的 pid 早已不存在、真正占端口的是另一个 dsh-vscreen。 */
    private void killByPidfile(Context ctx) {
        java.util.LinkedHashSet<Long> pids = new java.util.LinkedHashSet<Long>();
        File[] pidFiles = { new File(ctx.getFilesDir(), "vscreen/vscreen.pid"), externalPidFile(ctx) };
        for (File f : pidFiles) {
            if (f == null || !f.exists()) continue;
            long pid = -1;
            try {
                pid = new JSONObject(readFileText(f)).optLong("pid", -1);
            } catch (Throwable ignored) {}
            if (pid > 0) pids.add(pid);
            try { f.delete(); } catch (Throwable ignored) {}
        }
        for (Long pid : pids) killViaPrivilege(ctx, "kill -9 " + pid, "pid=" + pid);
        // 兜底：--nice-name=dsh-vscreen 只有本方服务端在用，扫一次不会误伤别的进程
        killViaPrivilege(ctx, "kill -9 $(pidof dsh-vscreen)", "pidof dsh-vscreen");
    }

    /** Shizuku 通道的 pidfile 落在 App 专属外部目录（见 stageServerJarForShizuku）；目录不可用返回 null。 */
    private File externalPidFile(Context ctx) {
        try {
            File dir = ctx.getExternalFilesDir("vscreen");
            return dir == null ? null : new File(dir, "vscreen.pid");
        } catch (Throwable t) {
            return null;
        }
    }

    /** 用可用特权通道执行一条 kill 命令（root: su -c；shizuku: sh -c，便于用 $(pidof …) 展开）。 */
    private void killViaPrivilege(Context ctx, String killCmd, String what) {
        try {
            if (rootAvailable(ctx)) {
                Process p = Runtime.getRuntime().exec(new String[]{"su", "-c", killCmd});
                try { p.waitFor(3, TimeUnit.SECONDS); } catch (Throwable ignored) {}
                try { p.destroy(); } catch (Throwable ignored) {}
                Log.i(TAG, "killed vscreen server " + what + " via root");
                return;
            }
            IShizukuService svc = shizukuService();
            if (svc == null) {
                Log.w(TAG, "cannot kill vscreen " + what + "（root/shizuku 均不可用，残留进程等其自愈/重启覆盖）");
                return;
            }
            IRemoteProcess rp = svc.newProcess(new String[]{"sh", "-c", killCmd}, null, null);
            try { rp.waitFor(); } catch (Throwable ignored) {}
            try { rp.destroy(); } catch (Throwable ignored) {}
            Log.i(TAG, "killed vscreen server " + what + " via shizuku");
        } catch (Throwable t) {
            Log.w(TAG, "killByPidfile failed (" + what + ")", t);
        }
    }

    /** 批次65-A：会话收尾时强杀本轮涉及的目标 App，杜绝后台应用残留耗电。 */
    private void killTargetAppIfAny(Context ctx) {
        try {
            String pkg = OverlayService.getCurrentTargetPackage();
            if (pkg == null || pkg.isEmpty() || pkg.equals(ctx.getPackageName())) return;
            if (pkg.contains("android") || pkg.contains("launcher") || pkg.contains("system")) return;
            if (rootAvailable(ctx)) {
                Process p = Runtime.getRuntime().exec(new String[]{"su", "-c", "am force-stop " + pkg});
                try { p.waitFor(3, TimeUnit.SECONDS); } catch (Throwable ignored) {}
                try { p.destroy(); } catch (Throwable ignored) {}
                Log.i(TAG, "force-stopped target app: " + pkg + " via root");
            } else {
                IShizukuService svc = shizukuService();
                if (svc != null) {
                    IRemoteProcess rp = svc.newProcess(
                            new String[]{"am", "force-stop", pkg}, null, null);
                    try { rp.waitFor(); } catch (Throwable ignored) {}
                    try { rp.destroy(); } catch (Throwable ignored) {}
                    Log.i(TAG, "force-stopped target app: " + pkg + " via shizuku");
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "killTargetAppIfAny failed", t);
        }
    }

    // =============================================================================================
    // 网关：3081 → 8998 转发（补 X-DSH-TOKEN 头；失败 JSON 补 hint；PNG/JSON 字节透传）
    // =============================================================================================

    private static final class ProxyResult {
        int code;
        String contentType;
        byte[] body;
    }

    /** 同步转发一条请求到 8998。失败（连不上/超时）返回 null，由调用方决定 reason。 */
    private ProxyResult proxyRequest(Context ctx, String method, String rawPath, String body, int readTimeoutMs) {
        HttpURLConnection c = null;
        try {
            byte[] out = body == null ? null : body.getBytes("UTF-8");
            c = (HttpURLConnection) new URL("http://127.0.0.1:" + SERVER_PORT + rawPath).openConnection();
            c.setRequestMethod(method);
            c.setConnectTimeout(1200);
            c.setReadTimeout(readTimeoutMs);
            c.setRequestProperty("X-DSH-TOKEN", token(ctx)); // 契约 §1：全部请求头 X-DSH-TOKEN
            if (out != null && out.length > 0 && !"GET".equalsIgnoreCase(method)) {
                c.setDoOutput(true);
                OutputStream os = c.getOutputStream();
                try { os.write(out); os.flush(); } finally { try { os.close(); } catch (Throwable ignored) {} }
            }
            int code = c.getResponseCode();
            String ctype = c.getHeaderField("Content-Type");
            if (ctype == null || ctype.isEmpty()) ctype = "application/json";
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            byte[] data = readAll(in, 64 * 1024 * 1024);
            ProxyResult r = new ProxyResult();
            r.code = code;
            r.contentType = ctype;
            r.body = data == null ? new byte[0] : data;
            return r;
        } catch (Throwable t) {
            Log.w(TAG, "proxy " + rawPath + " failed: " + t);
            return null;
        } finally {
            if (c != null) {
                try { c.disconnect(); } catch (Throwable ignored) {}
            }
        }
    }

    /** 失败 JSON 补 hint（契约 §3：每个失败响应必须带 hint；服务端不产 hint，由 App 网关统一补）。 */
    private byte[] injectHint(byte[] body) {
        try {
            JSONObject o = new JSONObject(new String(body, "UTF-8"));
            if (o.optBoolean("ok", true)) return body;         // 成功响应不动
            if (o.has("hint") || !o.has("reason")) return body; // 已带 hint / 非契约失败体不动
            String hint = hintFor(o.optString("reason"));
            if (hint == null) return body;
            o.put("hint", hint);
            return o.toString().getBytes("UTF-8");
        } catch (Throwable t) {
            return body; // 非 JSON（如 PNG）原样透传
        }
    }

    private static boolean jsonOk(byte[] body) {
        try {
            return new JSONObject(new String(body, "UTF-8")).optBoolean("ok");
        } catch (Throwable t) {
            return false;
        }
    }

    /** reason → hint（一句话引导，风格对齐插件既有失败语义 #57）。 */
    private static String hintFor(String reason) {
        if (reason == null) return null;
        switch (reason) {
            case REASON_NO_PRIVILEGE: return "开启 Shizuku（无线调试）或 root 后重试";
            case REASON_ROOT_DENIED: return "root 授权被拒绝，请在 su 管理器里允许本应用，或改用 Shizuku 通道";
            case REASON_SHIZUKU_UNAVAILABLE: return "Shizuku 服务未运行，请打开无线调试并启动 Shizuku 后重试";
            case REASON_SHIZUKU_DENIED: return "Shizuku 授权被拒绝，请在 Shizuku 弹窗中允许本应用";
            case REASON_SPAWN_FAILED: return "拉起 vscreen 服务端失败，请重试；仍失败请抓取 logcat 反馈";
            case "VDM_DENIED": return "系统拒绝创建虚拟屏（当前通道权限不足），可带 allowOverlay 走模拟副屏或使用 root";
            case "OVERLAY_FAILED": return "模拟副屏创建失败，请检查开发者选项或改用 root 通道";
            case "DISPLAY_TIMEOUT": return "虚拟屏创建超时，请重试";
            case "CREATE_FAILED": return "虚拟屏创建失败，请调整 width/height/dpi 后重试";
            case "LAUNCH_FAILED": return "在虚拟屏启动应用失败，请确认 packageName 正确";
            case "INJECT_FAILED": return "注入失败，请确认虚拟屏会话仍在（可先 status 查看）";
            case REASON_NOT_CREATED: return "先 android_vscreen_create";
            case REASON_READONLY_TASK: return HINT_READONLY_TASK; // 批次82-N9：原因与提示成对，任何路径都不再只说「先 create」
            case REASON_SESSION_DEAD: return "虚拟屏会话已失联，请重新 android_vscreen_create";
            case "BAD_TOKEN": return "本地 token 校验失败，请重启 App 后重试";
            case REASON_INVALID_ARGUMENT: return "参数不合法，请检查字段名与类型";
            default: return null;
        }
    }

    private static String failJson(String reason, String hint) {
        StringBuilder sb = new StringBuilder("{\"ok\":false,\"reason\":\"").append(reason).append('"');
        if (hint != null) sb.append(",\"hint\":\"").append(hint.replace("\"", "'")).append('"');
        return sb.append('}').toString();
    }

    // =============================================================================================
    // /vscreen/status：App 自己产出（契约 §2 形状，固定字段，不添加额外键）
    // =============================================================================================

    private String statusJson(Context ctx) {
        boolean rootOk = rootAvailable(ctx);
        boolean shizukuOk = shizukuAvailable();
        String pref = channelPref(ctx);
        JSONObject h = probeHealth(ctx);
        boolean serverOk = healthOk(h);
        String channel = null;
        if (sessionActive && sessionChannel != null) {
            channel = sessionChannel;
        } else if (serverOk) {
            channel = inferChannel(h); // App 重启后服务端仍在：按 uid 推断并回填会话通道
            sessionChannel = channel;
        }
        String strategy = null;
        long displayId = -1;
        long pid = -1;
        long uptime = -1;
        if (serverOk) {
            if (h.has("strategy") && !h.isNull("strategy")) strategy = h.optString("strategy");
            if (h.has("displayId") && !h.isNull("displayId")) displayId = h.optLong("displayId", -1);
            pid = h.optLong("pid", -1);
            uptime = h.optLong("uptimeMs", -1);
        }
        StringBuilder sb = new StringBuilder("{\"ok\":true");
        sb.append(",\"rootAvailable\":").append(rootOk);
        sb.append(",\"shizukuAvailable\":").append(shizukuOk);
        sb.append(",\"channel\":").append(channel != null ? "\"" + channel + "\"" : "null");
        sb.append(",\"strategy\":").append(strategy != null ? "\"" + strategy + "\"" : "null");
        sb.append(",\"displayId\":").append(displayId >= 0 ? String.valueOf(displayId) : "null");
        sb.append(",\"serverPid\":").append(pid >= 0 ? String.valueOf(pid) : "null");
        sb.append(",\"uptimeMs\":").append(uptime >= 0 ? String.valueOf(uptime) : "null");
        sb.append(",\"channelPref\":\"").append(pref).append("\"");
        sb.append('}');
        return sb.toString();
    }

    // =============================================================================================
    // 掉线通知（对齐 MainActivity.postA11yNotification 的既有模式）
    // =============================================================================================

    private void postSessionDeadNotification(Context ctx, String reason) {
        try {
            if (ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) return; // 无通知权限静默失败（a11y 同款）
            NotificationManager nm = (NotificationManager)
                    ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(VSCREEN_NOTIFY_CHANNEL_ID, "虚拟屏会话状态",
                        NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("vscreen 服务端失联时提醒（Shizuku 停止 / root 授权被撤）");
                nm.createNotificationChannel(ch);
            }
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                b = new Notification.Builder(ctx, VSCREEN_NOTIFY_CHANNEL_ID);
            } else {
                b = new Notification.Builder(ctx).setPriority(Notification.PRIORITY_HIGH);
            }
            String text = "虚拟屏服务已掉线"
                    + (reason != null ? "（" + reason + "）" : "")
                    + "。恢复 Shizuku（无线调试）或 root 后重新 android_vscreen_create 即可。";
            // 点按回到 App（无 vscreen 专属设置页，不做 deep-link）
            android.app.PendingIntent pi = null;
            try {
                Intent i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
                if (i != null) {
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    pi = PendingIntent.getActivity(ctx, 3, i,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                }
            } catch (Throwable ignored) {}
            Notification n = b.setContentTitle("DeepSeek Harness 虚拟屏已掉线")
                    .setContentText(text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setSmallIcon(R.drawable.ic_launcher)
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build();
            nm.notify(VSCREEN_NOTIFY_CHANNEL_ID.hashCode() & 0x7fffffff, n);
            Log.i(TAG, "vscreen session dead notification sent");
        } catch (Throwable t) {
            Log.w(TAG, "vscreen notification failed", t);
        }
    }

    // =============================================================================================
    // HTTP 响应直写（see 的 PNG 字节流不能走 MainActivity 的 JSON 文本路径）+ 小工具
    // =============================================================================================

    private static void writeResponse(Socket socket, int code, String contentType, byte[] body,
                                      boolean clientClose) throws IOException {
        OutputStream os = socket.getOutputStream();
        String head = "HTTP/1.1 " + code + " " + phrase(code) + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: " + (clientClose ? "close" : "keep-alive") + "\r\n\r\n";
        os.write(head.getBytes("UTF-8"));
        os.write(body);
        os.flush();
    }

    /** 内部错误兜底响应（reason 全集内就近取 BRIDGE_UNREACHABLE，hint 说明为网关内部错误）。 */
    private void writeSafe(Socket socket, boolean clientClose, Throwable t) {
        try {
            String body = failJson(REASON_BRIDGE_UNREACHABLE,
                    "vscreen 网关内部错误：" + String.valueOf(t).replace("\"", "'"));
            writeResponse(socket, 500, "application/json", body.getBytes("UTF-8"), clientClose);
        } catch (Throwable ignored) {}
    }

    private static String phrase(int code) {
        switch (code) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 500: return "Internal Server Error";
            case 502: return "Bad Gateway";
            default: return "OK";
        }
    }

    /** 本地桥 token：与 3081 同源（MainActivity.localToken()，包内可见；非 Activity 上下文回退读 prefs）。 */
    private String token(Context ctx) {
        try {
            if (ctx instanceof MainActivity) return ((MainActivity) ctx).localToken();
            return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LOCAL_TOKEN, "");
        } catch (Throwable t) {
            return "";
        }
    }

    /** 读小文本文件（pidfile）。 */
    private static String readFileText(File f) throws IOException {
        FileInputStream fin = new FileInputStream(f);
        try {
            StringBuilder sb = new StringBuilder();
            byte[] buf = new byte[1024];
            int n;
            while ((n = fin.read(buf)) > 0) sb.append(new String(buf, 0, n, "UTF-8"));
            return sb.toString();
        } finally {
            try { fin.close(); } catch (Throwable ignored) {}
        }
    }

    /** 读文件全部字节；失败返回 null（调用方视为「与包内不一致」，触发重抽）。 */
    private static byte[] readFileBytesQuiet(File f) {
        FileInputStream fin = null;
        try {
            fin = new FileInputStream(f);
            return readAll(fin, 4 * 1024 * 1024);
        } catch (Throwable t) {
            return null;
        } finally {
            try { if (fin != null) fin.close(); } catch (Throwable ignored) {}
        }
    }

    /** SHA-1 十六进制；入参为空返回空串（保证比对必然不等）。 */
    private static String sha1Hex(byte[] data) {
        if (data == null) return "";
        try {
            byte[] d = java.security.MessageDigest.getInstance("SHA-1").digest(data);
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xf, 16));
                sb.append(Character.forDigit(b & 0xf, 16));
            }
            return sb.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    /** 日志脱敏：spawn 命令行里带 --token，禁止把 token 写进 logcat（本机任何 App 都能读 logcat）。 */
    private static String maskToken(String s, String token) {
        if (s == null) return "";
        if (token == null || token.length() == 0) return s;
        return s.replace(token, "***");
    }

    private static byte[] readAll(InputStream in, int cap) throws IOException {
        if (in == null) return null;
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0 && bos.size() < cap) bos.write(buf, 0, n);
        try { in.close(); } catch (Throwable ignored) {}
        return bos.toByteArray();
    }

    private static String joinArgv(String[] argv) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < argv.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(argv[i]);
        }
        return sb.toString();
    }

    /** 消费子进程输出（丢弃）：防止服务端日志写满 pipe 缓冲区后阻塞服务端进程。 */
    /** 批次 14：读进程 stdout（settings get 用），stderr 丢弃防卡；5s 超时保护。 */
    private static String readAll(final Process p) {
        try {
            java.io.InputStream in = p.getInputStream();
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[2048];
            int n;
            while ((n = in.read(buf)) != -1) bo.write(buf, 0, n);
            try { p.getErrorStream().close(); } catch (Throwable ignored) {}
            p.waitFor(5, TimeUnit.SECONDS);
            return bo.toString("UTF-8").trim();
        } catch (Throwable t) {
            Log.w(TAG, "readAll failed", t);
            return "null";
        }
    }

    private static void drain(final Process p) {
        Thread out = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    InputStream in = p.getInputStream();
                    byte[] buf = new byte[4096];
                    while (in.read(buf) > 0) { /* discard */ }
                } catch (Throwable ignored) {}
            }
        }, "vscreen-out");
        Thread err = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    InputStream in = p.getErrorStream();
                    byte[] buf = new byte[4096];
                    while (in.read(buf) > 0) { /* discard */ }
                } catch (Throwable ignored) {}
            }
        }, "vscreen-err");
        out.setDaemon(true);
        err.setDaemon(true);
        out.start();
        err.start();
    }

    /**
     * IRemoteProcess → java.lang.Process 适配器（DEVIATION 的配套件）：
     * rikka.shizuku.ShizukuRemoteProcess 构造器是包私有，这里用 IRemoteProcess 的
     * ParcelFileDescriptor 流 + waitFor/exitValue/destroy 自行包装。
     */
    private static final class ShizukuProcessAdapter extends Process {
        private final IRemoteProcess rp;

        ShizukuProcessAdapter(IRemoteProcess rp) { this.rp = rp; }

        @Override public OutputStream getOutputStream() {
            try {
                return new ParcelFileDescriptor.AutoCloseOutputStream(rp.getOutputStream());
            } catch (Throwable t) { throw new RuntimeException(t); }
        }

        @Override public InputStream getInputStream() {
            try {
                return new ParcelFileDescriptor.AutoCloseInputStream(rp.getInputStream());
            } catch (Throwable t) { throw new RuntimeException(t); }
        }

        @Override public InputStream getErrorStream() {
            try {
                return new ParcelFileDescriptor.AutoCloseInputStream(rp.getErrorStream());
            } catch (Throwable t) { throw new RuntimeException(t); }
        }

        @Override public int waitFor() throws InterruptedException {
            try {
                return rp.waitFor();
            } catch (android.os.RemoteException e) { throw new RuntimeException(e); }
        }

        @Override public int exitValue() {
            try {
                return rp.exitValue();
            } catch (android.os.RemoteException e) {
                // 语义对齐 java.lang.Process.exitValue：未退出抛 IllegalThreadStateException
                throw new IllegalThreadStateException();
            }
        }

        @Override public void destroy() {
            try { rp.destroy(); } catch (Throwable ignored) {}
        }
    }

    /** ensureSession 内部返回：channel=选中通道；reason 非 null=失败原因。 */
    private static final class SelectResult {
        final String channel;
        final String reason;

        private SelectResult(String channel, String reason) {
            this.channel = channel;
            this.reason = reason;
        }

        static SelectResult ok(String channel) { return new SelectResult(channel, null); }

        static SelectResult fail(String reason) { return new SelectResult(null, reason); }
    }
}
