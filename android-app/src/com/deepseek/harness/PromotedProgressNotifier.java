package com.deepseek.harness;

import android.annotation.TargetApi;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.util.Locale;

/**
 * 批次55-A2：Android 16 Live Updates（原生实况窗）——「任务实况」通路。
 *
 * <p>与批次55-A1（可行性 spike「引擎运行中」）的区别：A2 起本类只表达<b>任务实况</b>——
 * 任务开始→发布（标题 + 步骤文案 + 进度），每步推进→更新（步骤序号），任务结束（成功/失败/取消）
 * →先短暂展示完成态再撤销，服务销毁→撤销（不留残留通知）。</p>
 *
 * <p><b>与自绘胶囊（OverlayService 顶部前摄灵动胶囊）的分工</b>：原生实况窗只负责
 * 「系统级可达性」——压过状态栏 chip / 锁屏 / AOD；动效、质感、展开交互仍由自绘胶囊负责，
 * 本类<b>不</b>做任何动画。</p>
 *
 * <p><b>可回滚 / 零副作用</b>：整条通路 {@code SDK_INT >= 36} 门控（低版本零行为），
 * 总开关 {@code dsh_prefs/promoted_live_update}（false → 零行为），任何异常吞掉只留一行日志，
 * 绝不影响任务主流程。</p>
 *
 * <p>状态只在主线程读写（OverlayService 的回调均 post 回主线程）。</p>
 *
 * <p><b>批次56-A（运行信息唯一载体）</b>：①{@link #isRunInfoOnSystemCapsule(Context)} 供
 * OverlayService 判断「运行信息已由系统胶囊承载，因此不再绘制自绘顶部胶囊」（OEM 未授权 /
 * 低版本 / 开关关闭 → false，自绘胶囊自动兜底）；②{@link #update(Context, String, int, long)}
 * 把耗时带进右侧短文案；③活跃期心跳（**批次82-N7 起为可选**，见 {@link #KEY_HEARTBEAT}，默认关）：
 * 开启后每 {@link #HEARTBEAT_INTERVAL_MS} 重发一次同一通知续期，规避 MagicOS
 * {@code mCapsuleExpandDuration = 300000}（单步静默超 5 分钟胶囊收成圆点、文字隐去）；
 * 关闭则遵守原生行为 —— 静默超时后胶囊自然收成圆点，下一次 {@code update()} 再展开。</p>
 *
 * <p>取证入口：{@code adb logcat -s DSH-LiveUpdate}。</p>
 */
public final class PromotedProgressNotifier {

    private static final String TAG = "DSH-LiveUpdate";
    /** 独立渠道 id（与 EngineService 的 dsh_engine、OverlayService 的渠道分离）。 */
    public static final String CHANNEL_ID = "dsh_live_update";
    /** 独立通知 id，避开 EngineService 的 1、OverlayService 的 9002、定时任务的 9003/9004。 */
    public static final int NOTIF_ID = 0x55A1;
    private static final String PREFS = "dsh_prefs";
    /** 总开关（默认开）；置 false 时本类完全不发通知（也不发完成态）。 */
    public static final String KEY_ENABLED = "promoted_live_update";
    /**
     * 批次82-N7：活跃期心跳（把胶囊续在「展开有字」态）是否开启，默认**关**。
     *
     * <p>关（默认）：遵守 MagicOS 原生行为 —— 单步静默超 {@code mCapsuleExpandDuration = 300000}
     * 后胶囊自然收成圆点（诚实表达「还在跑、暂无新进展」）；下一次 {@code update()} 会重新发布并展开。</p>
     *
     * <p>开：每 4 分钟续期一次，长静默步骤期间始终保留文字（代价：静默期右侧耗时/步骤文案是冻结值）。</p>
     */
    public static final String KEY_HEARTBEAT = "promoted_capsule_heartbeat";
    /** Live Updates / promoted ongoing 自 API 36（Android 16）起可用。 */
    private static final int MIN_SDK = 36;
    /** 进度段数上限，防止异常步骤号画出离谱进度条。 */
    private static final int MAX_SEGMENTS = 20;
    /** 完成态停留时长：先让用户看到结果，再撤销。 */
    private static final long COMPLETED_LINGER_MS = 5000L;
    /**
     * 批次82-N1：可放行终态（带「▶ 直接执行」按钮）的停留时长。
     *
     * <p>比普通完成态长，给用户点按钮的时间；但仍然**有界**——撤销任务挂在进程内
     * {@link Handler} 上，进程若在这个窗口里被杀且没走到 OverlayService.onDestroy，
     * 通知会残留（Live Update 是 ongoing，用户划不掉）。因此窗口不能放大成「一直挂着」。</p>
     */
    private static final long ACTION_LINGER_MS = 60000L;
    /** 批次82-N1：终态放行动作文案（实况窗动作按钮与面板 chip 共用同一份语义）。 */
    public static final String ACTION_PROCEED = "▶ 直接执行";
    /** 批次82-N1：放行动作的 PendingIntent requestCode（避开 REQ_OPEN / REQ_WAIT）。 */
    private static final int REQ_PROCEED = 0x55A4;
    /** contentIntent 的 requestCode（与其他通知的 PendingIntent 区分开）。 */
    private static final int REQ_OPEN = 0x55A2;
    private static final String DEFAULT_TITLE = "任务实况";
    /** 实况窗右侧短文案（MagicOS 胶囊右侧文字）：有步骤号显步骤，否则显运行态。 */
    private static final String SHORT_RUNNING = "运行中";
    private static final String SHORT_DONE = "完成 ✓";
    /** 实况窗正文长度上限（状态栏/锁屏只显示一行，超长截断避免脏排版）。 */
    private static final int MAX_TEXT = 80;
    /** 批次56-A：右侧短文案总长上限（{@code "步骤2 · 45s"} = 9 字符，留出步骤号/长任务的余量）。 */
    private static final int MAX_SHORT = 15;
    /**
     * 批次56-A：活跃期心跳间隔 240000ms（4 分钟）。
     *
     * <p>依据：MagicOS 侧 {@code mCapsuleExpandDuration = 300000}（5 分钟）——静默超时后胶囊
     * 收成圆点、文字隐去；4 分钟重发一次，始终留在「展开有字」态。复用同一通知 id / channel。</p>
     */
    private static final long HEARTBEAT_INTERVAL_MS = 240000L;
    // ===== 批次70：等待态（引擎挂起等作答 / 等审批）=====
    /** 等待态主色（琥珀）：进度段与通知 color 都用它，锁屏 / 状态栏一眼可辨。 */
    private static final int AMBER = 0xFFFF9800;
    private static final String WAIT_TITLE_QUESTION = "等待您的回答";
    private static final String WAIT_TITLE_APPROVAL = "等待授权确认";
    private static final String WAIT_SHORT_QUESTION = "请作答";
    private static final String WAIT_SHORT_APPROVAL = "需审批";
    /** 等待态 contentIntent 的 requestCode（与 REQ_OPEN 区分）。 */
    private static final int REQ_WAIT = 0x55A3;
    /** 是否有挂起的用户交互（决定 contentIntent 指向助手面板还是主界面）。 */
    private static boolean interactionPending = false;
    /**
     * 批次82-N1：本轮终态是否允许「一键放行」（决定终态通知带不带「▶ 直接执行」动作）。
     *
     * <p>只有助手侧「成功 / 失败 / 已结束」这条正常收尾路径置真；取消、急停、续跟结束一律
     * false —— 那些终态下没有「上一条指令」可放行（照抄 {@link #interactionPending} 的写法）。</p>
     */
    private static boolean proceedable = false;

    /** 任务实况是否处于活动态（仅主线程）。 */
    private static boolean active = false;
    private static String title = DEFAULT_TITLE;
    /** 已观测到的步骤序号（0 = 引擎未给出）。 */
    private static int step = 0;
    private static Handler handler;
    private static Runnable pendingStop;
    /** 批次56-A：最近一次正文（心跳按原样重发，不引入新文案）。 */
    private static String lastText = "";
    /** 批次56-A：最近一次耗时（心跳重发时沿用，保证短文案不跳变）。 */
    private static long lastElapsedSecs = 0L;
    /** 批次56-A：活跃期心跳任务（主线程 Handler，同一时刻至多一个）。 */
    private static Runnable heartbeat;

    private PromotedProgressNotifier() {}

    /** 总开关；读取失败视为关闭（保守）。 */
    public static boolean isEnabled(Context ctx) {
        try {
            if (ctx == null) return false;
            SharedPreferences sp = ctx.getApplicationContext()
                    .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            return sp.getBoolean(KEY_ENABLED, true);
        } catch (Throwable t) {
            return false;
        }
    }

    /** 批次82-N7：续期心跳是否开启（默认关；读取失败视为关 ＝ 遵守原生行为）。 */
    public static boolean isHeartbeatEnabled(Context ctx) {
        try {
            if (ctx == null) return false;
            SharedPreferences sp = ctx.getApplicationContext()
                    .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            return sp.getBoolean(KEY_HEARTBEAT, false);
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * 批次56-A：运行信息是否已由系统胶囊（Android 16 Live Updates 实况窗）承载。
     *
     * <p>用途：OverlayService 据此决定「不再绘制自绘顶部胶囊」，让原生灵动胶囊成为运行信息的
     * 唯一载体。三个条件<b>同时</b>成立才算数：</p>
     * <ol>
     *   <li>{@link #isEnabled(Context)} == true（总开关 {@code dsh_prefs/promoted_live_update}）；</li>
     *   <li>{@code Build.VERSION.SDK_INT >= 36}（Live Updates 起始版本）；</li>
     *   <li>{@link NotificationManager#canPostPromotedNotifications()} == true（权限 / AppOp 侧准入）。</li>
     * </ol>
     *
     * <p><b>为什么必须查第 ③ 条</b>：OEM 侧「设置 → 灵动胶囊 → 应用服务」的授权每次重装 APK
     * 都会被重置；此时返回 false，自绘胶囊自动兜底，用户不会「什么都看不到」。</p>
     *
     * @return {@code ctx == null} 或任何异常 → false（保守：失败一律退回自绘胶囊）。
     */
    @TargetApi(MIN_SDK)
    public static boolean isRunInfoOnSystemCapsule(Context ctx) {
        try {
            if (ctx == null) return false;
            if (Build.VERSION.SDK_INT < MIN_SDK) return false;
            if (!isEnabled(ctx)) return false;
            Context app = ctx.getApplicationContext();
            if (app == null) return false;
            NotificationManager nm =
                    (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return false;
            return nm.canPostPromotedNotifications();
        } catch (Throwable t) {
            Log.w(TAG, "isRunInfoOnSystemCapsule failed: " + t);
            return false;
        }
    }

    /** 任务开始：发布任务实况（单段进度，步骤序号待引擎回报）。 */
    public static void start(Context ctx, String text) {
        cancelPendingStop();
        proceedable = false; // 批次82-N1：新一轮开始 → 上一轮的放行按钮作废
        lastText = text;
        lastElapsedSecs = 0L;
        active = post(ctx, DEFAULT_TITLE, text, 1, 1, SHORT_RUNNING);
        step = 0;
        if (active) {
            Log.i(TAG, "start id=" + NOTIF_ID + " text=" + text);
            // 批次56-A：从 start 起就排期心跳——「单步长时间无回报」正是胶囊收成圆点的场景，
            // 只在 update() 排期会漏掉它。
            scheduleHeartbeat(ctx);
        }
    }

    /**
     * 每步推进：刷新步骤文案与进度（不带耗时，等价于 {@code elapsedSecs = 0}）。
     *
     * @param stepNumber 引擎给出的步骤序号（取自「步骤 #N」）；{@code <=0} 表示本轮无序号
     *                   （进度不推进，只刷新文案）。
     */
    public static void update(Context ctx, String text, int stepNumber) {
        update(ctx, text, stepNumber, 0L);
    }

    /**
     * 批次56-A：每步推进 + 耗时进右侧短文案（{@code "步骤2 · 45s"} / {@code "运行中 · 12s"}）。
     *
     * <p>标题 / 正文 / 进度段语义与 3 参版本完全一致；{@code elapsedSecs <= 0} 时退化为现有样式
     * （{@code 步骤N} / {@code 运行中}），保证 OEM 或调用方不给耗时时行为不变。</p>
     *
     * <p>同时重排心跳（活跃期每 {@code HEARTBEAT_INTERVAL_MS} 续期一次，防 5 分钟静默收缩）。</p>
     *
     * @param stepNumber  引擎给出的步骤序号（{@code <=0} = 本轮无序号）。
     * @param elapsedSecs 任务已运行秒数（{@code <=0} = 不带耗时）。
     */
    public static void update(Context ctx, String text, int stepNumber, long elapsedSecs) {
        if (!active) return; // 非活动态零行为：绝不凭空发出通知
        if (stepNumber > step) step = stepNumber;
        if (elapsedSecs < 0L) elapsedSecs = 0L;
        lastText = text;
        lastElapsedSecs = elapsedSecs;
        int total = step < 1 ? 1 : step;
        boolean shown = post(ctx, title, text, total, total, shortLabel(elapsedSecs));
        if (shown) scheduleHeartbeat(ctx);
    }

    /**
     * 任务结束（成功 / 失败 / 取消）：先短暂展示完成态（全段归位），{@link #COMPLETED_LINGER_MS}
     * 后撤销。若实况窗本未发布（非活动态 / 开关已关 / 低版本），只做一次幂等撤销，
     * 绝不凭空发出通知。
     */
    public static void finish(Context ctx, String text) {
        finish(ctx, text, false);
    }

    /**
     * 批次82-N1：终态收尾（可带放行动作）——{@code allowProceed=true} 时这条实况窗多一个
     * 「▶ 直接执行」按钮（点它 = 用同一引擎会话带授权补发上一条指令），并改用
     * {@link #ACTION_LINGER_MS} 停留，给用户点按钮的时间。
     *
     * @param allowProceed 仅「成功 / 失败 / 已结束」终态传 true；取消、急停、续跟结束传 false。
     */
    public static void finish(Context ctx, String text, boolean allowProceed) {
        cancelPendingStop();
        cancelHeartbeat(); // 批次56-A：完成态起停止心跳，避免 5s 完成态结束后又被心跳捞起来
        clearInteraction(); // 批次70：收尾回普通态（标题复位）
        if (!active) {
            proceedable = false;
            stop(ctx);
            return;
        }
        proceedable = allowProceed;
        active = false;
        int total = step < 1 ? 1 : step;
        boolean shown = post(ctx, title, text, total, total, SHORT_DONE);
        step = 0;
        if (!shown) {
            proceedable = false;
            stop(ctx);
            return;
        }
        // 批次82-N1：带动作的终态用更长的 linger（不带动作的完成态仍是 5s）
        long lingerMs = proceedable ? ACTION_LINGER_MS : COMPLETED_LINGER_MS;
        Log.i(TAG, "finish id=" + NOTIF_ID + " text=" + text + " lingerMs=" + lingerMs
                + " proceedable=" + proceedable);
        Handler h = mainHandler();
        if (h == null) {
            stop(ctx);
            return;
        }
        final Context app = ctx.getApplicationContext();
        pendingStop = new Runnable() {
            @Override public void run() {
                pendingStop = null;
                stop(app);
            }
        };
        h.postDelayed(pendingStop, lingerMs);
    }

    /**
     * 批次70：等待态实况窗 —— 引擎挂起等用户作答（question）/ 等审批（approval）。
     *
     * <p>复用同一条通知与频道，不新增第二条实况窗：琥珀色进度段 + 关键短文案（请作答 / 需审批），
     * 点击实况窗直接用 service PendingIntent 唤起助手面板并聚焦提问卡片。</p>
     *
     * <p>非活动态（任务实况没发布 / 开关关闭 / 低版本）零行为，绝不凭空发通知。</p>
     */
    public static void interaction(Context ctx, String kind, long elapsedSecs) {
        try {
            cancelPendingStop();
            if (!active) return;
            boolean approval = kind != null && kind.contains("approval");
            interactionPending = true;
            title = approval ? WAIT_TITLE_APPROVAL : WAIT_TITLE_QUESTION;
            long secs = elapsedSecs < 0L ? 0L : elapsedSecs;
            lastElapsedSecs = secs;
            lastText = title + " · 已 " + secs + "s";
            boolean shown = post(ctx, title, lastText, 1, 1,
                    approval ? WAIT_SHORT_APPROVAL : WAIT_SHORT_QUESTION);
            if (shown) {
                Log.i(TAG, "interaction kind=" + kind + " elapsedSecs=" + secs);
                scheduleHeartbeat(ctx);
            }
        } catch (Throwable t) {
            Log.w(TAG, "interaction failed: " + t);
        }
    }

    /** 批次70：交互已作答 / 取消 / 收尾 → 回到普通进度态（下一次 update() 会重画进度文案）。 */
    public static void clearInteraction() {
        interactionPending = false;
        if (active) title = DEFAULT_TITLE;
    }

    /** 撤销任务实况（幂等、静默）——服务销毁与任务收尾都走这里，保证不留残留通知。 */
    public static void stop(Context ctx) {
        cancelPendingStop();
        cancelHeartbeat();
        interactionPending = false;
        proceedable = false;
        active = false;
        step = 0;
        lastText = "";
        lastElapsedSecs = 0L;
        try {
            if (ctx == null) return;
            NotificationManager nm = (NotificationManager) ctx.getApplicationContext()
                    .getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            nm.cancel(NOTIF_ID);
            Log.i(TAG, "stop id=" + NOTIF_ID);
        } catch (Throwable t) {
            Log.w(TAG, "stop failed: " + t);
        }
    }

    /** 实况窗短文案：有步骤号就显步骤，否则显运行态。 */
    private static String shortLabel() {
        return step < 1 ? SHORT_RUNNING
                : ("步骤" + (step > MAX_SEGMENTS ? MAX_SEGMENTS : step));
    }

    /** 批次57-A1：核心动作词提取（控制在 2~3 字符），彻底避免右耳图标遮挡截断。 */
    public static String extractActionWord(String text, int stepNumber) {
        if (text != null && !text.isEmpty()) {
            String lower = text.toLowerCase(Locale.ROOT);
            if (lower.contains("问") || lower.contains("question") || lower.contains("answer") || lower.contains("回答") || lower.contains("作答")) {
                return "请作答";
            }
            if (lower.contains("识屏") || lower.contains("屏幕") || lower.contains("截图") || lower.contains("screenshot")
                    || lower.contains("read_screen") || lower.contains("ocr") || lower.contains("inspect")) {
                return "识屏";
            }
            if (lower.contains("定位") || lower.contains("查找") || lower.contains("find") || lower.contains("element")
                    || lower.contains("node") || lower.contains("控件")) {
                return "定位";
            }
            if (lower.contains("输入") || lower.contains("type") || lower.contains("input") || lower.contains("key")
                    || lower.contains("填") || lower.contains("text")) {
                return "输入";
            }
            if (lower.contains("点击") || lower.contains("click") || lower.contains("tap") || lower.contains("按")) {
                return "点击";
            }
            if (lower.contains("滑动") || lower.contains("swipe") || lower.contains("scroll") || lower.contains("翻")) {
                return "滑动";
            }
            if (lower.contains("提交") || lower.contains("submit") || lower.contains("发送")) {
                return "提交";
            }
        }
        return stepNumber > 0 ? ("步" + (stepNumber > MAX_SEGMENTS ? MAX_SEGMENTS : stepNumber)) : SHORT_RUNNING;
    }

    /** 批次57-A1：动态短文案紧凑压缩（<=8 字符严格预算，避让 5G/电量图标）。 */
    public static String compactShortLabel(String text, int stepNumber, long elapsedSecs) {
        String action = extractActionWord(text, stepNumber);
        if ("请作答".equals(action)) {
            return "请作答 ⏳";
        }
        if (elapsedSecs <= 0L) {
            return action;
        }
        String dur = durationLabel(elapsedSecs);
        String withElapsed = action + " · " + dur;
        if (withElapsed.length() <= 8) {
            return withElapsed;
        }
        String tight = action + dur;
        return tight.length() <= 8 ? tight : action;
    }

    /**
     * 批次56-A：右侧短文案带耗时（{@code "步骤2 · 45s"} / {@code "运行中 · 12s"}）。
     * 超过 {@link #MAX_SHORT} 字符时退回既有纯状态样式（{@code elapsedSecs <= 0} 亦同）。
     */
    private static String shortLabel(long elapsedSecs) {
        String base = shortLabel();
        if (elapsedSecs <= 0L) return base;
        String withElapsed = compactShortLabel(lastText, step, elapsedSecs);
        return withElapsed.length() <= MAX_SHORT ? withElapsed : base;
    }

    /** 耗时短标签：{@code 45s} / {@code 12m3s} / {@code 1h5m}（限定宽度，防长任务撑爆短文案）。 */
    private static String durationLabel(long secs) {
        if (secs >= 3600L) return (secs / 3600L) + "h" + ((secs % 3600L) / 60L) + "m";
        if (secs >= 60L) return (secs / 60L) + "m" + (secs % 60L) + "s";
        return secs + "s";
    }

    /**
     * 批次56-A：活跃期心跳——每 {@link #HEARTBEAT_INTERVAL_MS} 按原样重发同一通知
     * （同 id / 同 channel / 同文案，只做续期，不改标题 / 正文 / 进度段语义）。
     *
     * <p>只在 {@code active} 且门控成立时续期：开关关闭 / 低版本 / 发出失败 / 任何异常 →
     * 不再排期并静默返回（零副作用）。取消路径见 {@link #cancelHeartbeat()}。</p>
     */
    private static void scheduleHeartbeat(Context ctx) {
        cancelHeartbeat();
        if (!active) return;
        if (ctx == null) return;
        // 批次82-N7：续期心跳是可选行为（默认关）——关着就遵守 ROM 原生行为：
        // 单步静默超 5 分钟（mCapsuleExpandDuration = 300000）胶囊自己收成圆点。
        // 注意：这里只管「续期」；update() / start() / interaction() 的正常发布不受影响。
        if (!isHeartbeatEnabled(ctx)) return;
        Handler h = mainHandler();
        if (h == null) return;
        final Context app = ctx.getApplicationContext();
        if (app == null) return;
        heartbeat = new Runnable() {
            @Override public void run() {
                heartbeat = null;
                try {
                    if (!active) return;                        // 已收尾：不再续期
                    if (Build.VERSION.SDK_INT < MIN_SDK) return;
                    if (!isEnabled(app)) return;                 // 开关被关：心跳自然停止
                    int total = step < 1 ? 1 : step;
                    String shortText = interactionPending
                            ? (WAIT_TITLE_APPROVAL.equals(title) ? WAIT_SHORT_APPROVAL : WAIT_SHORT_QUESTION)
                            : shortLabel(lastElapsedSecs);
                    if (!post(app, title, lastText, total, total, shortText)) {
                        return;                                  // 发不出去（异常/门控）→ 保守停止
                    }
                    Log.i(TAG, "heartbeat id=" + NOTIF_ID + " intervalMs=" + HEARTBEAT_INTERVAL_MS);
                    scheduleHeartbeat(app);
                } catch (Throwable t) {
                    Log.w(TAG, "heartbeat failed: " + t);
                }
            }
        };
        h.postDelayed(heartbeat, HEARTBEAT_INTERVAL_MS);
    }

    /** 批次56-A：取消心跳（幂等、静默）；finish / stop 都会走这里。 */
    private static void cancelHeartbeat() {
        try {
            if (heartbeat != null && handler != null) handler.removeCallbacks(heartbeat);
        } catch (Throwable ignored) {}
        heartbeat = null;
    }

    private static void cancelPendingStop() {
        try {
            if (pendingStop != null && handler != null) handler.removeCallbacks(pendingStop);
        } catch (Throwable ignored) {}
        pendingStop = null;
    }

    private static Handler mainHandler() {
        try {
            if (handler == null) handler = new Handler(Looper.getMainLooper());
            return handler;
        } catch (Throwable t) {
            Log.w(TAG, "mainHandler failed: " + t);
            return null;
        }
    }

    /** 实况窗正文：压成一行并限长。 */
    private static String trim(String text) {
        if (text == null) return "";
        String t = text.replace('\r', ' ').replace('\n', ' ').trim();
        return t.length() <= MAX_TEXT ? t : t.substring(0, MAX_TEXT) + "…";
    }

    /** 发出/重发通知；返回是否真的发出了（开关关 / 低版本 / 异常 → false）。 */
    private static boolean post(Context ctx, String titleText, String text, int progress,
                               int total, String shortText) {
        try {
            if (ctx == null) return false;
            if (Build.VERSION.SDK_INT < MIN_SDK) return false;
            if (!isEnabled(ctx)) return false;
            Context app = ctx.getApplicationContext();
            NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return false;
            ensureChannel(nm);
            Notification n = build(app, titleText, text, progress, total, shortText);
            if (n == null) return false;
            emit(nm, n);
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "post failed: " + t);
            return false;
        }
    }

    /** 取证：canPostPromotedNotifications() = 权限/AppOp 侧准入；hasPromotableCharacteristics() = 通知特征侧准入。 */
    @TargetApi(MIN_SDK)
    private static void emit(NotificationManager nm, Notification n) {
        Log.i(TAG, "post attempt canPostPromoted=" + nm.canPostPromotedNotifications()
                + " promotableCharacteristics=" + n.hasPromotableCharacteristics()
                + " requestPromotedOngoing=" + n.isRequestPromotedOngoing()
                + " channel=" + CHANNEL_ID + " id=" + NOTIF_ID);
        nm.notify(NOTIF_ID, n);
    }

    @TargetApi(MIN_SDK)
    private static Notification build(Context ctx, String titleText, String text, int progress,
                                      int total, String shortText) {
        int segs = total < 1 ? 1 : total;
        if (segs > MAX_SEGMENTS) segs = MAX_SEGMENTS;
        int index = progress < 1 ? 1 : progress;
        if (index > segs) index = segs;

        Notification.ProgressStyle style = new Notification.ProgressStyle();
        for (int i = 0; i < segs; i++) {
            Notification.ProgressStyle.Segment seg =
                    new Notification.ProgressStyle.Segment(1).setId(i + 1);
            if (interactionPending) seg.setColor(AMBER); // 批次70：等待态琥珀段
            style.addProgressSegment(seg);
        }
        try {
            // A1 遗留：未配段图标时胶囊左侧是系统默认灰块占位；这里给出应用自己的起步图标。
            style.setProgressStartIcon(Icon.createWithResource(ctx, R.drawable.ic_whale_black));
        } catch (Throwable t) {
            Log.w(TAG, "startIcon failed: " + t);
        }
        style.setProgress(index);

        Notification.Builder b = new Notification.Builder(ctx, CHANNEL_ID);
        b.setSmallIcon(R.drawable.ic_whale_black); // 小图标用无背景鲸鱼：系统取 alpha 剔影，不会被抹成灰块
        b.setContentTitle(titleText == null || titleText.isEmpty() ? DEFAULT_TITLE : titleText);
        b.setContentText(trim(text));
        b.setStyle(style);
        // 批次70：等待态点击直达助手面板（回答卡片），否则维持打开主界面
        PendingIntent open = interactionPending ? waitIntent(ctx) : openIntent(ctx);
        if (open != null) b.setContentIntent(open);
        if (proceedable) {
            // 批次82-N1：终态放行动作；点通知本体也落到助手面板（按钮与面板 chip 同一入口）
            PendingIntent proceed = proceedIntent(ctx);
            if (proceed != null) b.addAction(0, ACTION_PROCEED, proceed);
            PendingIntent panel = waitIntent(ctx);
            if (panel != null) b.setContentIntent(panel);
        }
        if (interactionPending) b.setColor(AMBER);
        b.setOngoing(true);
        b.setOnlyAlertOnce(true);
        b.setCategory(Notification.CATEGORY_PROGRESS);
        b.setRequestPromotedOngoing(true);
        if (shortText != null && !shortText.isEmpty()) b.setShortCriticalText(shortText);
        return b.build();
    }

    /**
     * 批次70：等待态点击 → 直接唤起助手面板（OverlayService 已支持 action_open_assistant，
     * 批次51 起同一入口用于「顶部胶囊 → 面板」）。
     */
    @TargetApi(MIN_SDK)
    private static PendingIntent waitIntent(Context ctx) {
        try {
            Intent open = new Intent(ctx, OverlayService.class);
            open.putExtra("action_open_assistant", true);
            return PendingIntent.getService(ctx, REQ_WAIT, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        } catch (Throwable t) {
            Log.w(TAG, "waitIntent failed: " + t);
            return null;
        }
    }

    /**
     * 批次82-N1：终态「▶ 直接执行」→ service PendingIntent。
     *
     * <p>OverlayService 已在 manifest 注册（{@code exported=false}，本应用自己的 PendingIntent
     * 可直接拉起，不需要新增 receiver），extra 名与面板 chip 走同一个
     * {@code autoProceedTerminalTask()} 入口；服务若已被回收，重建后仍能靠历史指令兜底。</p>
     */
    @TargetApi(MIN_SDK)
    private static PendingIntent proceedIntent(Context ctx) {
        try {
            Intent proceed = new Intent(ctx, OverlayService.class);
            proceed.putExtra("action_auto_proceed", true);
            return PendingIntent.getService(ctx, REQ_PROCEED, proceed,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        } catch (Throwable t) {
            Log.w(TAG, "proceedIntent failed: " + t);
            return null;
        }
    }

    /** 点击实况窗 → 打开主界面（复用 EngineService 已验证的入口 Intent；MainActivity 为 singleTask）。 */
    @TargetApi(MIN_SDK)
    private static PendingIntent openIntent(Context ctx) {
        try {
            Intent open = new Intent(ctx, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            return PendingIntent.getActivity(ctx, REQ_OPEN, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        } catch (Throwable t) {
            Log.w(TAG, "contentIntent failed: " + t);
            return null;
        }
    }

    @TargetApi(26)
    private static void ensureChannel(NotificationManager nm) {
        try {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "任务实况",
                    NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("任务执行进度（Android 16 Live Updates 实况窗）");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        } catch (Throwable t) {
            Log.w(TAG, "ensureChannel failed: " + t);
        }
    }
}
