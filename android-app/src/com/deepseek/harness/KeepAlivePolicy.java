package com.deepseek.harness;

/**
 * 批次 23 S1（设计文档 D5）：保活决策纯函数——输入输出全显式，<b>零 Android 依赖</b>，
 * 可在任意 JVM 上直接运行（对齐审计发现 B：决策逻辑与 Android API 隔离）。
 *
 * <p>职责：给定活跃任务数与 jobWakeLock 的持有/续期状态，回答"此刻应该 HOLD（持有/维持）、
 * RENEW（续期）还是 RELEASE（释放）"。调用方是 {@link TaskReaper}（30s tick），执行是
 * {@link TaskStore}（wakelock 独占持有者，D5 决策 1/5）。本类不做任何 I/O、不持任何状态。</p>
 *
 * <p>与 D5 原始签名 {@code evaluate(activeTasks, nowMs, lastRenewMs, config)} 的差异（均有因）：
 * <ul>
 *   <li>新增输入 {@code currentlyHeld}——区分"新持有(HOLD)"与"已持有未到续期(维持)"所必需，
 *       否则这两个动作无法从纯输入推导；</li>
 *   <li>新增输入 {@code lastTransitionMs}（hold↔release 上次翻转时刻）——承载防抖细则；</li>
 *   <li>从简不收 screenOn/charging（指令允许"若文档定义更简，从简"）：PARTIAL_WAKE_LOCK
 *       与屏幕/充电状态无关，收进来只会制造无用分支。</li>
 * </ul></p>
 *
 * <p><b>决策表</b>（按序判定，命中即返回；t0=nowMs）：
 * <table border="1">
 *   <tr><th>#</th><th>activeTaskCount</th><th>currentlyHeld</th><th>t0-lastRenewMs</th><th>t0-lastTransitionMs</th><th>action</th><th>holdWakeLock</th><th>timeoutMs</th></tr>
 *   <tr><td>1</td><td>&gt;0</td><td>false</td><td>任意</td><td>任意</td><td>HOLD</td><td>true</td><td>wakelockTimeoutMs</td></tr>
 *   <tr><td>2</td><td>&gt;0</td><td>true</td><td>≥renewIntervalMs 或 lastRenewMs≤0</td><td>任意</td><td>RENEW</td><td>true</td><td>wakelockTimeoutMs</td></tr>
 *   <tr><td>3</td><td>&gt;0</td><td>true</td><td>&lt;renewIntervalMs</td><td>任意</td><td>HOLD（维持，无操作）</td><td>true</td><td>0</td></tr>
 *   <tr><td>4</td><td>≤0</td><td>false</td><td>任意</td><td>任意</td><td>RELEASE（幂等无操作）</td><td>false</td><td>0</td></tr>
 *   <tr><td>5</td><td>≤0</td><td>true</td><td>任意</td><td>&lt;releaseDebounceMs</td><td>HOLD（防抖宽限，暂缓释放）</td><td>true</td><td>0</td></tr>
 *   <tr><td>6</td><td>≤0</td><td>true</td><td>任意</td><td>≥releaseDebounceMs</td><td>RELEASE</td><td>false</td><td>0</td></tr>
 * </table>
 * 防抖不对称（有意为之，见 main 自检 case5/case2 注释）：HOLD/RENEW <b>从不</b>被防抖——
 * 保活正确性优先，任务在场却延迟持有会让设备在任务运行中入睡；只有 RELEASE 吃 30s 防抖，
 * 防"任务快速连发"场景的 hold/release 抖动，代价是最多 30s 的多余持有——空闲<b>稳态</b>仍是
 * 零 wakelock（批次 21 红线、功耗红线 §四.1），不违背红线口径。</p>
 *
 * <p>自检入口：{@link #main}——决策表逐条断言，任何一条失败以非 0 退出码结束。
 * 运行：{@code java -cp <classes> com.deepseek.harness.KeepAlivePolicy}（构建期/人工均可跑）。
 * 仓内构建是 javac 直编译、无 JUnit 依赖，故以 main 自检充当"JVM 单测"（D7.3 语义测试的政策落法）。</p>
 */
public final class KeepAlivePolicy {

    private KeepAlivePolicy() {}

    // ==== 三个动作（D5 枚举）====
    /** 持有/维持 wakelock：timeoutMs&gt;0 时需 acquire(timeoutMs)，==0 表示已是目标状态、无操作。 */
    public static final String ACTION_HOLD = "HOLD";
    /** 续期：重新 acquire(wakelockTimeoutMs)（non-reference-counted 锁上等价于刷新到期时刻）。 */
    public static final String ACTION_RENEW = "RENEW";
    /** 释放（对未持有的锁是幂等无操作，对齐 handleWakelockRequest release 语义）。 */
    public static final String ACTION_RELEASE = "RELEASE";

    /** 单次 acquire 时长上限：复用 handleWakelockRequest 的 30min clamp（D5 决策：30min 上限保留）。 */
    public static final long DEFAULT_WAKELOCK_TIMEOUT_MS = 30 * 60 * 1000L;
    /** 续期节奏：默认 timeout 的一半（15min）——即使 Reaper 连丢一个 30s tick 也远碰不到 30min 自动释放。 */
    public static final long DEFAULT_RENEW_INTERVAL_MS = DEFAULT_WAKELOCK_TIMEOUT_MS / 2;
    /** RELEASE 防抖窗口：30s（批次23 S1 指令细则：状态翻转 30s 内不重复翻转；HOLD/RENEW 不受此限，见类注释）。 */
    public static final long DEFAULT_RELEASE_DEBOUNCE_MS = 30 * 1000L;

    /** 策略参数（不可变；全部显式传入，测试可用任意小值驱动而无需真实等待）。 */
    public static final class Config {
        public final long wakelockTimeoutMs;
        public final long renewIntervalMs;
        public final long releaseDebounceMs;

        public Config(long wakelockTimeoutMs, long renewIntervalMs, long releaseDebounceMs) {
            this.wakelockTimeoutMs = Math.max(1000L, wakelockTimeoutMs);
            this.renewIntervalMs = Math.max(1000L, renewIntervalMs);
            this.releaseDebounceMs = Math.max(0L, releaseDebounceMs);
        }

        /** 生产缺省：30min clamp + 15min 续期 + 30s 释放防抖。 */
        public static Config defaults() {
            return new Config(DEFAULT_WAKELOCK_TIMEOUT_MS, DEFAULT_RENEW_INTERVAL_MS, DEFAULT_RELEASE_DEBOUNCE_MS);
        }
    }

    /** 决策结果（不可变值对象）：action ∈ {HOLD,RENEW,RELEASE}；reason 为人读日志串。 */
    public static final class Decision {
        public final String action;
        public final boolean holdWakeLock;
        public final String reason;
        /** acquire 时长（HOLD/RENEW 生效时 &gt;0；维持/释放时为 0，调用方据此跳过 acquire）。 */
        public final long timeoutMs;

        Decision(String action, boolean holdWakeLock, String reason, long timeoutMs) {
            this.action = action;
            this.holdWakeLock = holdWakeLock;
            this.reason = reason;
            this.timeoutMs = timeoutMs;
        }

        @Override public String toString() {
            return action + "(hold=" + holdWakeLock + ", timeoutMs=" + timeoutMs + ", reason=" + reason + ")";
        }
    }

    /**
     * 决策入口（纯函数：不改任何状态、不碰时钟之外的副作用）。
     *
     * @param activeTaskCount  活跃（state=RUNNING）任务数；负数按 0 处理
     * @param currentlyHeld    jobWakeLock 此刻是否被持有（TaskStore 实测 isHeld，勿凭记忆传）
     * @param nowMs            当前时刻（System.currentTimeMillis() 或测试注入的假时钟）
     * @param lastRenewMs      上次 acquire/续期时刻；0 表示未知（如 App 重启后，按"立即该续"处理，防重建后永不再续）
     * @param lastTransitionMs 上次 hold↔release 翻转时刻；0 表示从未翻转（防抖判定天然通过）
     * @param config           策略参数；null 用 {@link Config#defaults()}
     */
    public static Decision evaluate(int activeTaskCount, boolean currentlyHeld,
                                    long nowMs, long lastRenewMs, long lastTransitionMs, Config config) {
        Config c = config != null ? config : Config.defaults();
        int active = Math.max(0, activeTaskCount);

        if (active > 0) {
            if (!currentlyHeld) {
                // 决策表 #1：任务在场且未持有 → 立即持有（不受防抖约束：保活正确性 > 抖动开销）。
                return new Decision(ACTION_HOLD, true,
                        "activeTasks=" + active + " 且未持有 → 立即持有", c.wakelockTimeoutMs);
            }
            if (lastRenewMs <= 0 || nowMs - lastRenewMs >= c.renewIntervalMs) {
                // 决策表 #2：已持有且到续期点（lastRenewMs 未知按立即续期处理）。
                return new Decision(ACTION_RENEW, true,
                        "已持有且距上次续期 " + Math.max(0L, nowMs - lastRenewMs) + "ms ≥ renewInterval "
                                + c.renewIntervalMs + "ms → 续期", c.wakelockTimeoutMs);
            }
            // 决策表 #3：已持有、未到续期点 → 维持（无操作）。
            return new Decision(ACTION_HOLD, true,
                    "已持有且未到续期点（剩余 " + (c.renewIntervalMs - (nowMs - lastRenewMs)) + "ms）→ 维持", 0L);
        }

        if (!currentlyHeld) {
            // 决策表 #4：空闲且未持有 → 幂等无操作（稳态：无任务零 wakelock，批次 21 红线）。
            return new Decision(ACTION_RELEASE, false, "空闲且未持有 → 幂等无操作", 0L);
        }
        long sinceTransition = nowMs - lastTransitionMs;
        if (sinceTransition < c.releaseDebounceMs) {
            // 决策表 #5：任务刚清零 → 防抖宽限（下个 tick 再放），防任务快速连发时的 hold/release 抖动。
            return new Decision(ACTION_HOLD, true,
                    "空闲但距上次翻转 " + Math.max(0L, sinceTransition) + "ms < 防抖 "
                            + c.releaseDebounceMs + "ms → 宽限，下个 tick 再释放", 0L);
        }
        // 决策表 #6：空闲且防抖窗口已过 → 释放。
        return new Decision(ACTION_RELEASE, false,
                "空闲且距上次翻转 " + Math.max(0L, sinceTransition) + "ms 已过防抖窗口 → 释放", 0L);
    }

    // =========================================================================================
    // 批次55-C：保活自检与自愈（后台服务常驻；桌面球形态已于批次60 移除，文案统一为「助手」）
    //
    // 背景：球的保活只有「前台服务 + START_STICKY」两条腿，系统重启/覆盖安装靠
    // {@link BootReceiver}，但「用户是否被 Honor 应用启动管理拦下」这件事<b>程序读不到</b>
    // （MagicOS 无公开 API）——所以本节的职责是把能读到的判据如实评估、把读不到的判据
    // 标成软判据 + 给出可执行引导，并把「球被清理后要不要自己回来」变成显式决策。
    //
    // 仍然是纯逻辑：零 Android 依赖（不 import 任何 android.*），跳转只输出 {@code TARGET_*}
    // 键，真正的 Intent 由调用方（MainActivity）构造——这样决策与文案可在任意 JVM 上自测。
    //
    // 自检入口：{@link #selfCheck}；自愈入口：{@link #onTaskRemoved}（一行钩子，供
    // OverlayService.onTaskRemoved 末尾调用，片段见 .local/repro/b55c/OVERLAYSERVICE_HOOK.md）。
    // =========================================================================================

    /** 跳转键：Honor/MagicOS「应用启动管理」（调用方走 {@link #startupManagerTargets()} 降级链）。 */
    public static final String TARGET_STARTUP_MANAGER = "startup_manager";
    /** 跳转键：系统「电池优化 / 不限制后台」。 */
    public static final String TARGET_BATTERY_OPTIMIZATION = "battery_optimization";
    /** 跳转键：应用详情页（通用兜底，所有 ROM 都有）。 */
    public static final String TARGET_APP_DETAILS = "app_details";
    /** 批次67：Shizuku 授权页（托管引擎的通道，重启后需重新激活）。 */
    public static final String TARGET_SHIZUKU = "shizuku";
    /** 批次67：Android 16 实况窗（Live Updates）应用级开关页。 */
    public static final String TARGET_PROMOTED_NOTIFICATION = "promoted_notification";
    /** 批次67：通知读取权限页（声明了 NotificationListener 但未授权时引导）。 */
    public static final String TARGET_NOTIFICATION_LISTENER = "notification_listener";
    /** 跳转键：无（该项只能靠 App 内动作，例如重新打开助手）。 */
    public static final String TARGET_NONE = "";

    /** 降级链条目类型：按组件直跳（{@code setComponent(pkg, cls)}）。 */
    public static final String KIND_COMPONENT = "component";
    /** 降级链条目类型：按 action 直跳（各 ROM 私有 action）。 */
    public static final String KIND_ACTION = "action";
    /** 降级链条目类型：末级兜底 = 系统应用详情页（用 {@code ACTION_APPLICATION_DETAILS_SETTINGS}）。 */
    public static final String KIND_APP_DETAILS = "app_details";

    /** Honor/MagicOS 启动管理主界面组件（批次49 真机验证过：能直达原厂启动管理列表）。 */
    public static final String HONOR_STARTUP_PKG = "com.hihonor.systemmanager";
    /** 见 {@link #HONOR_STARTUP_PKG}。 */
    public static final String HONOR_STARTUP_CLS =
            "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity";
    /** Honor 私有 action（组件直跳被拦时的第二跳）。 */
    public static final String HONOR_STARTUP_ACTION = "hihonor.intent.action.HSM_STARTUPAPP_MANAGER";

    /** 偏好文件名：与 BootReceiver/OverlayService 同一份（本类只提供字面量，不做 I/O）。 */
    public static final String PREFS_NAME = "dsh_prefs";
    /** 偏好键：助手自启开关（缺省 true；BootReceiver 读这条决定重启/更新后是否拉起）。 */
    public static final String KEY_BALL_AUTOSTART = "ball_autostart";
    /** 偏好键：最近一次自检时刻（ms）。 */
    public static final String PREF_LAST_CHECK_AT = "keepalive_last_check_at";
    /** 偏好键：最近一次自检一行结论（卡片「最近一次自检」）。 */
    public static final String PREF_LAST_CHECK_SUMMARY = "keepalive_last_check";
    /** 偏好键：服务自检心跳时刻（ms；由 OverlayService 心跳定时器写，判定「常驻可观测」）。 */
    public static final String PREF_LAST_BEAT_AT = "keepalive_last_beat_at";
    /** 偏好键：用户是否打开过「应用启动管理」引导页（点过引导按钮即 true）。 */
    public static final String PREF_STARTUP_GUIDED = "keepalive_startup_guided";
    /** 偏好键：上次 onTaskRemoved 自愈时刻（ms）。 */
    public static final String PREF_LAST_HEAL_AT = "keepalive_last_heal_at";
    /** 偏好键：当前窗口内的自愈次数（防重启风暴）。 */
    public static final String PREF_HEAL_COUNT = "keepalive_heal_count";

    /** 自检心跳周期：5min（纯记账，无网络/无磁盘，功耗可忽略）。 */
    public static final long DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000L;
    /** 心跳过期阈值：2h（超过即认为球已被系统清理或长期未运行）。 */
    public static final long DEFAULT_CHECK_MAX_AGE_MS = 2 * 60 * 60 * 1000L;
    /** 自愈最小间隔：1min（系统刚弹回时不要立刻再拉起）。 */
    public static final long DEFAULT_HEAL_MIN_INTERVAL_MS = 60 * 1000L;
    /** 自愈窗口：10min（窗口内计数，防重启风暴）。 */
    public static final long DEFAULT_HEAL_WINDOW_MS = 10 * 60 * 1000L;
    /** 窗口内最多自愈次数：3 次（超了就不再硬刚，转白名单引导）。 */
    public static final int DEFAULT_HEAL_MAX_IN_WINDOW = 3;

    /** 自检等级：全部判据满足（硬判据 + 软判据）。 */
    public static final String LEVEL_OK = "OK";
    /** 自检等级：硬判据全过，但有软判据不满足（读不到的系统放行/心跳过期）。 */
    public static final String LEVEL_WARN = "WARN";
    /** 自检等级：有硬判据不满足 = 常驻不可靠（重启/被清理后可能回不来）。 */
    public static final String LEVEL_FAIL = "FAIL";

    /** 判据名：电池优化白名单（硬）。 */
    public static final String NAME_BATTERY = "忽略电池优化";
    /** 判据名：系统后台限制（硬）。 */
    public static final String NAME_BG_RESTRICTED = "后台限制";
    /** 判据名：助手自启动开关（硬，dsh_prefs/ball_autostart）。 */
    public static final String NAME_AUTOSTART = "自启动开关";
    /** 判据名：助手前台服务是否在跑（硬）。 */
    public static final String NAME_SERVICE = "后台服务";
    /** 判据名：开机/更新自启接收器是否在册（硬）。 */
    public static final String NAME_BOOT_RECEIVER = "开机自启接收器";
    /** 判据名：启动管理引导（软——系统是否真放行，程序读不到）。 */
    public static final String NAME_STARTUP_GUIDE = "启动管理引导";
    /** 判据名：自检心跳新鲜度（软）。 */
    public static final String NAME_HEARTBEAT = "自检心跳";
    /** 批次67：引擎级判据（App 内 7 条只看「后台服务能不能活」，这里补「引擎在不在、是不是托管、看护活没活」）。 */
    public static final String NAME_ENGINE = "引擎在线(3080)";
    public static final String NAME_ENGINE_HOSTED = "引擎托管常驻";
    public static final String NAME_WATCHDOG = "shell 看护";
    public static final String NAME_EXACT_ALARM = "精确闹钟";
    public static final String NAME_PROMOTED = "实况窗可晋升";

    /**
     * 自检输入（全部显式；调用方负责<b>如实取值</b>，勿凭记忆——批次47 的教训）。
     * 取值来源（MainActivity 侧）：
     * <ul>
     *   <li>{@code ignoringBatteryOptimizations} ← {@code PowerManager.isIgnoringBatteryOptimizations}</li>
     *   <li>{@code backgroundRestricted} ← {@code ActivityManager.isBackgroundRestricted}（API 24+）</li>
     *   <li>{@code ballAutostart} ← {@code dsh_prefs/ball_autostart}（与 BootReceiver 同源）</li>
     *   <li>{@code overlayRunning} ← {@code OverlayService.isRunning}（实测，非记忆）</li>
     *   <li>{@code bootReceiverDeclared} ← {@code PackageManager.queryBroadcastReceivers(BOOT_COMPLETED)}</li>
     *   <li>{@code startupManagerGuided} ← {@code dsh_prefs/keepalive_startup_guided}</li>
     *   <li>{@code lastBeatMs} ← {@code dsh_prefs/keepalive_last_beat_at}（0 = 无记录）</li>
     *   <li>{@code manufacturer} ← {@code Build.MANUFACTURER}</li>
     * </ul>
     */
    public static final class SelfCheck {
        public final boolean ignoringBatteryOptimizations;
        public final boolean backgroundRestricted;
        public final boolean ballAutostart;
        public final boolean overlayRunning;
        public final boolean bootReceiverDeclared;
        public final boolean startupManagerGuided;
        public final long lastBeatMs;
        public final long nowMs;
        public final String manufacturer;
        // ===== 批次67：引擎级判据输入（App 内 7 条之外新增 5 条） =====
        /** 3080 上是不是「自家引擎」（401 可信 / 首页 title 命中）。 */
        public final boolean engineOnline;
        /** 引擎是否由特权通道（root(su) 或 Shizuku）托管常驻（false = 跑在 App 进程树下，装包/强停会中断）。 */
        public final boolean engineHosted;
        /** shell 看护脚本是否存活（负责无人时自动复活引擎）。 */
        public final boolean watchdogAlive;
        /** {@code AlarmManager.canScheduleExactAlarms()}（Doze 下能精确唤醒探活的硬前提）。 */
        public final boolean exactAlarmOk;
        /** {@code NotificationManager.canPostPromotedNotifications()}（实况窗能否晋升）。 */
        public final boolean promotedOk;
        /** Shizuku 授权是否在位（托管通路的兜底通道）。 */
        public final boolean shizukuOk;
        /** 批次95：当前托管通道（"root" / "shizuku" / ""=未知或无通道）。 */
        public final String hostedChannel;
        /** 本进程是否处于被系统「强行停止」后的状态（Android 15+ 的 ApplicationStartInfo.wasForceStopped）。 */
        public final boolean forceStoppedNow;

        public SelfCheck(boolean ignoringBatteryOptimizations, boolean backgroundRestricted,
                         boolean ballAutostart, boolean overlayRunning, boolean bootReceiverDeclared,
                         boolean startupManagerGuided, long lastBeatMs, long nowMs, String manufacturer) {
            this.ignoringBatteryOptimizations = ignoringBatteryOptimizations;
            this.backgroundRestricted = backgroundRestricted;
            this.ballAutostart = ballAutostart;
            this.overlayRunning = overlayRunning;
            this.bootReceiverDeclared = bootReceiverDeclared;
            this.startupManagerGuided = startupManagerGuided;
            this.lastBeatMs = lastBeatMs;
            this.nowMs = nowMs;
            this.manufacturer = manufacturer != null ? manufacturer : "";
            // 旧 9 参构造（自测/兼容路径）：引擎级判据按「不打扰」填，避免老调用点凭空多出 WARN。
            this.engineOnline = true;
            this.engineHosted = true;
            this.watchdogAlive = true;
            this.exactAlarmOk = true;
            this.promotedOk = true;
            this.shizukuOk = false;
            this.forceStoppedNow = false;
            this.hostedChannel = "";
        }

        /** 批次67 全量构造（16 参，兼容旧调用点；托管通道未知 ⇒ 卡片按 shizukuOk 推断身份词）。 */
        public SelfCheck(boolean ignoringBatteryOptimizations, boolean backgroundRestricted,
                         boolean ballAutostart, boolean overlayRunning, boolean bootReceiverDeclared,
                         boolean startupManagerGuided, long lastBeatMs, long nowMs, String manufacturer,
                         boolean engineOnline, boolean engineHosted, boolean watchdogAlive,
                         boolean exactAlarmOk, boolean promotedOk, boolean shizukuOk,
                         boolean forceStoppedNow) {
            this(ignoringBatteryOptimizations, backgroundRestricted, ballAutostart, overlayRunning,
                    bootReceiverDeclared, startupManagerGuided, lastBeatMs, nowMs, manufacturer,
                    engineOnline, engineHosted, watchdogAlive, exactAlarmOk, promotedOk, shizukuOk,
                    forceStoppedNow, "");
        }

        /** 批次95 全量构造（17 参）：多一个托管通道，卡片据此显示 root / shell。 */
        public SelfCheck(boolean ignoringBatteryOptimizations, boolean backgroundRestricted,
                         boolean ballAutostart, boolean overlayRunning, boolean bootReceiverDeclared,
                         boolean startupManagerGuided, long lastBeatMs, long nowMs, String manufacturer,
                         boolean engineOnline, boolean engineHosted, boolean watchdogAlive,
                         boolean exactAlarmOk, boolean promotedOk, boolean shizukuOk,
                         boolean forceStoppedNow, String hostedChannel) {
            this.ignoringBatteryOptimizations = ignoringBatteryOptimizations;
            this.backgroundRestricted = backgroundRestricted;
            this.ballAutostart = ballAutostart;
            this.overlayRunning = overlayRunning;
            this.bootReceiverDeclared = bootReceiverDeclared;
            this.startupManagerGuided = startupManagerGuided;
            this.lastBeatMs = lastBeatMs;
            this.nowMs = nowMs;
            this.manufacturer = manufacturer != null ? manufacturer : "";
            this.engineOnline = engineOnline;
            this.engineHosted = engineHosted;
            this.watchdogAlive = watchdogAlive;
            this.exactAlarmOk = exactAlarmOk;
            this.promotedOk = promotedOk;
            this.shizukuOk = shizukuOk;
            this.forceStoppedNow = forceStoppedNow;
            this.hostedChannel = hostedChannel != null ? hostedChannel : "";
        }
    }

    /**
     * 单条判据（不可变）。{@code ok} 是否满足；{@code critical} 不满足是否算「常驻不可靠」；
     * {@code actual} 真机取值（人读，直接上卡片）；{@code advice} 不满足时的下一步；
     * {@code target} 跳转键（{@code TARGET_*}，无则 {@link #TARGET_NONE}）。
     */
    public static final class Criterion {
        public final String name;
        public final boolean ok;
        public final boolean critical;
        public final String actual;
        public final String advice;
        public final String target;

        Criterion(String name, boolean ok, boolean critical, String actual, String advice, String target) {
            this.name = name;
            this.ok = ok;
            this.critical = critical;
            this.actual = actual;
            this.advice = advice;
            this.target = target;
        }

        @Override public String toString() {
            return (ok ? "ok " : "NG ") + name + "=" + actual;
        }
    }

    /** 自检结论（不可变）：等级 + 逐条判据 + 一行结论 + 多行引导（卡片直接渲染）。 */
    public static final class SelfCheckReport {
        public final boolean ok;
        public final String level;
        public final Criterion[] items;
        /** 首个不满足判据的跳转键（硬判据排在数组前部，故硬判据优先；
         *  {@link #TARGET_NONE} = 所有不满足项都没有可直达的设置页）。 */
        public final String firstTarget;
        /** 一行结论（写 prefs/日志、卡片标题行）。 */
        public final String summary;
        /** 多行引导文案（不满足项 + 逐条建议；卡片正文）。 */
        public final String guidance;

        SelfCheckReport(boolean ok, String level, Criterion[] items,
                        String firstTarget, String summary, String guidance) {
            this.ok = ok;
            this.level = level;
            this.items = items;
            this.firstTarget = firstTarget;
            this.summary = summary;
            this.guidance = guidance;
        }

        /** 满足项数（等级行 "n/m 项满足"）。 */
        public int okCount() {
            int n = 0;
            for (int i = 0; i < items.length; i++) {
                if (items[i].ok) n++;
            }
            return n;
        }

        @Override public String toString() { return summary; }
    }

    /**
     * 保活自检（纯函数）：把「能不能被系统杀回来」拆成逐条判据，逐条给出真机取值与建议。
     *
     * <p>硬判据（不满足 → {@link #LEVEL_FAIL}，常驻不可靠）：电池优化白名单、后台限制、
     * 自启动开关、后台服务在跑、开机自启接收器在册。软判据（不满足 → {@link #LEVEL_WARN}）：
     * 启动管理引导是否走过、自检心跳是否新鲜——这两项程序无法判定系统真实放行状态，
     * 只能软提示，绝不假报「已授权」。</p>
     *
     * @param in 自检输入；null 按「全不满足」处理（防御，不抛）
     */
    public static SelfCheckReport selfCheck(SelfCheck in) {
        SelfCheck s = in != null ? in
                : new SelfCheck(false, false, false, false, false, false, 0L, 0L, "");
        boolean honor = isHonorRom(s.manufacturer);
        boolean beatFresh = !isStale(s.lastBeatMs, s.nowMs, DEFAULT_CHECK_MAX_AGE_MS);
        long beatAgeMin = Math.max(0L, s.nowMs - s.lastBeatMs) / 60000L;

        Criterion[] items = new Criterion[12];
        items[0] = new Criterion(NAME_BATTERY, s.ignoringBatteryOptimizations, true,
                s.ignoringBatteryOptimizations ? "已忽略电池优化（后台不限制）" : "仍受电池优化限制",
                "点下方「电池优化」→ 选择「不限制 / 允许后台活动」",
                s.ignoringBatteryOptimizations ? TARGET_NONE : TARGET_BATTERY_OPTIMIZATION);
        items[1] = new Criterion(NAME_BG_RESTRICTED, !s.backgroundRestricted, true,
                s.backgroundRestricted ? "受系统后台限制（后台活动被禁）" : "未受系统后台限制",
                "到应用详情 → 电池 → 允许后台活动（MagicOS 的「应用启动管理」也控制这条）",
                s.backgroundRestricted ? TARGET_BATTERY_OPTIMIZATION : TARGET_NONE);
        items[2] = new Criterion(NAME_AUTOSTART, s.ballAutostart, true,
                s.ballAutostart ? "已开启（重启/更新后自动拉起）" : "已关闭（重启/更新后不会拉起）",
                "回到 App 首页重新打开助手（会写回 ball_autostart=true）", TARGET_NONE);
        items[3] = new Criterion(NAME_SERVICE, s.overlayRunning, true,
                s.overlayRunning ? "运行中（前台服务在册）" : "未运行",
                "回到 App 首页点「开始使用」重新拉起助手服务", TARGET_NONE);
        items[4] = new Criterion(NAME_BOOT_RECEIVER, s.bootReceiverDeclared, true,
                s.bootReceiverDeclared ? "已声明（BOOT_COMPLETED / MY_PACKAGE_REPLACED）"
                        : "未声明（系统重启后不会拉起）",
                "当前 APK 缺 receiver 声明：请安装完整包（勿用裁剪包）", TARGET_NONE);
        items[5] = new Criterion(NAME_STARTUP_GUIDE, s.startupManagerGuided, false,
                s.startupManagerGuided ? "已打开过引导页（是否放行请自行确认）"
                        : "尚未引导（系统是否放行，程序读不到）",
                honor ? "点下方「应用启动管理」→ 设为「手动管理」并开启允许自启动、允许关联启动、允许后台活动"
                        : "点下方「应用启动管理」→ 在自启动/后台管理里放行本应用",
                s.startupManagerGuided ? TARGET_NONE : TARGET_STARTUP_MANAGER);
        items[6] = new Criterion(NAME_HEARTBEAT, beatFresh, false,
                s.lastBeatMs <= 0L ? "无心跳记录（服务从未上报）"
                        : (beatFresh ? "最近心跳 " + beatAgeMin + " 分钟前"
                                : "心跳已过期 " + beatAgeMin + " 分钟（球可能已被系统清理）"),
                "打开助手并保持运行（心跳 >2h 视为过期；心跳由 OverlayService 自检定时器上报）",
                TARGET_NONE);
        // ===== 批次67：引擎级 5 条（7 条看「球能不能活」，这 5 条看「引擎在不在、能不能脱离 App 存活」）=====
        items[7] = new Criterion(NAME_ENGINE, s.engineOnline, true,
                s.engineOnline ? "在线（127.0.0.1:3080 命中自家引擎判据）" : "离线（3080 无自家引擎）",
                "点下方「启动引擎」或打开助手提交一次指令，App 会在后台把引擎拉起来",
                s.engineOnline ? TARGET_NONE : TARGET_NONE);
        // 批次95：身份词按真实通道（root 优先）；通道未知时退回按 shizukuOk 推断
        String hostedWord = HostedEngineManager.CHANNEL_ROOT.equals(s.hostedChannel) ? "root"
                : (HostedEngineManager.CHANNEL_SHIZUKU.equals(s.hostedChannel) ? "shell"
                        : (s.shizukuOk ? "shell" : "root"));
        items[8] = new Criterion(NAME_ENGINE_HOSTED, s.engineHosted, false,
                s.engineHosted ? "已托管（" + hostedWord + " 身份常驻，覆盖安装/强停不断）"
                        : (s.shizukuOk ? "App 内模式（装包与强停会中断引擎）"
                                : "App 内模式（未检测到 root 且 Shizuku 不可用，无法托管）"),
                s.engineHosted ? "无需处理"
                        : (s.shizukuOk ? "点下方「启用托管」把引擎交给特权通道常驻（覆盖安装不再中断）"
                                : "点下方「Shizuku 授权」激活 Shizuku（或给本 App 授予 root）后即可托管"),
                s.engineHosted ? TARGET_NONE : (s.shizukuOk ? TARGET_NONE : TARGET_SHIZUKU));
        items[9] = new Criterion(NAME_WATCHDOG, s.watchdogAlive, false,
                s.watchdogAlive ? "运行中（45s 一轮探活，挂了自动复活）" : "未运行（无人看护）",
                s.engineHosted ? "点下方「重新启用托管」拉起看护脚本" : "启用托管后自动带上看护脚本",
                TARGET_NONE);
        items[10] = new Criterion(NAME_EXACT_ALARM, s.exactAlarmOk, false,
                s.exactAlarmOk ? "可用（Doze 下可精确唤醒探活）" : "不可用（Doze 下探活会被推迟）",
                "到应用详情 → 闹钟和提醒 → 允许（Android 12+ 的「闹钟和提醒」开关）",
                s.exactAlarmOk ? TARGET_NONE : TARGET_APP_DETAILS);
        items[11] = new Criterion(NAME_PROMOTED, s.promotedOk, false,
                s.promotedOk ? "可晋升（任务实况会出现在灵动胶囊）" : "未放行（实况窗可能被降级为普通通知）",
                "点下方「实况窗设置」把本应用的实况通知打开",
                s.promotedOk ? TARGET_NONE : TARGET_PROMOTED_NOTIFICATION);

        int failures = 0;
        boolean fail = false;
        boolean warn = false;
        String firstTarget = TARGET_NONE;
        StringBuilder missing = new StringBuilder();
        for (int i = 0; i < items.length; i++) {
            Criterion c = items[i];
            if (c.ok) continue;
            failures++;
            if (c.critical) {
                fail = true;
            } else {
                warn = true;
            }
            // 跳转键取「首个不满足且能直达设置页」的判据（硬判据在前，故硬判据优先）。
            if (firstTarget.length() == 0 && c.target.length() > 0) firstTarget = c.target;
            if (missing.length() > 0) missing.append('、');
            missing.append(c.name);
        }
        String level = fail ? LEVEL_FAIL : (warn ? LEVEL_WARN : LEVEL_OK);
        String summary = "保活自检 " + level + " · " + (items.length - failures) + "/" + items.length
                + " 项满足" + (missing.length() > 0 ? " · 待处理：" + missing : "");

        StringBuilder g = new StringBuilder(summary).append('\n');
        if (failures == 0) {
            g.append("全部判据满足：重启/更新后能自动拉起助手，且心跳新鲜。");
        } else {
            g.append("不满足项（✗）：\n");
            int n = 0;
            for (int i = 0; i < items.length; i++) {
                Criterion c = items[i];
                if (c.ok) continue;
                n++;
                g.append("  ").append(n).append(". ").append(c.name).append("：").append(c.actual)
                        .append(" → ").append(c.advice).append('\n');
            }
            if (fail) {
                g.append("提示：Honor/MagicOS 需在「应用启动管理」把本应用设为「手动管理」并开启"
                        + "允许自启动 / 允许关联启动 / 允许后台活动，否则系统重启或清理后不会拉起助手。");
            } else {
                g.append("硬判据均已满足；带软判据的项只能软判定（系统是否真放行，程序读不到），"
                        + "出现异常时按上面的建议逐条核对。");
            }
        }
        return new SelfCheckReport(!fail, level, items, firstTarget, summary, g.toString());
    }

    /** 是否 Honor/Huawei 系 ROM（决定引导文案用「应用启动管理」还是通用「自启动管理」）。 */
    public static boolean isHonorRom(String manufacturer) {
        if (manufacturer == null) return false;
        String m = manufacturer.trim().toLowerCase();
        return m.contains("honor") || m.contains("huawei");
    }

    /**
     * 时刻是否过期：{@code lastMs<=0}（无记录）算过期；时钟回拨（now &lt; last）算「新鲜」——
     * 回拨时宁可少报一次，也不要因为系统时间跳变把正常的球误判成被杀。
     */
    public static boolean isStale(long lastMs, long nowMs, long maxAgeMs) {
        if (lastMs <= 0L) return true;
        long age = nowMs - lastMs;
        if (age < 0L) return false;
        return age > Math.max(0L, maxAgeMs);
    }

    /**
     * 自检心跳下一跳延迟（一行钩子）：无记录 / 已到期 / 时钟回拨 → 0（父调用方立刻自检一次）；
     * 否则返回剩余间隔（正数，交给 handler.postDelayed）。
     *
     * @param intervalMs 心跳周期；&lt;=0 用 {@link #DEFAULT_HEARTBEAT_INTERVAL_MS}
     */
    public static long nextHeartbeatDelayMs(long lastBeatMs, long nowMs, long intervalMs) {
        long iv = intervalMs > 0L ? intervalMs : DEFAULT_HEARTBEAT_INTERVAL_MS;
        if (lastBeatMs <= 0L) return 0L;
        long elapsed = nowMs - lastBeatMs;
        if (elapsed < 0L) return 0L;
        long left = iv - elapsed;
        return left > 0L ? left : 0L;
    }

    /** 自愈决策（不可变）：restart=是否拉起；delayMs&gt;0 表示延后；giveUp=别再硬刚（转白名单引导）。 */
    public static final class HealDecision {
        public final boolean restart;
        public final long delayMs;
        public final boolean giveUp;
        public final String reason;

        HealDecision(boolean restart, long delayMs, boolean giveUp, String reason) {
            this.restart = restart;
            this.delayMs = delayMs;
            this.giveUp = giveUp;
            this.reason = reason;
        }

        @Override public String toString() {
            return (restart ? "RESTART" : (giveUp ? "GIVE_UP" : "SKIP"))
                    + "(delayMs=" + delayMs + ", reason=" + reason + ")";
        }
    }

    /** 自愈输入；{@code minIntervalMs}/{@code maxHealsPerWindow} 非正数时按缺省常量归一（同 Config 风格）。 */
    public static final class HealInputs {
        public final boolean selfStartEnabled;
        public final int healsInWindow;
        public final long nowMs;
        public final long lastHealMs;
        public final long minIntervalMs;
        public final int maxHealsPerWindow;

        /** 缺省参数版（一行钩子用）：1min 间隔 + 10min 窗口内最多 3 次。 */
        public HealInputs(boolean selfStartEnabled, int healsInWindow, long nowMs, long lastHealMs) {
            this(selfStartEnabled, healsInWindow, nowMs, lastHealMs,
                    DEFAULT_HEAL_MIN_INTERVAL_MS, DEFAULT_HEAL_MAX_IN_WINDOW);
        }

        public HealInputs(boolean selfStartEnabled, int healsInWindow, long nowMs, long lastHealMs,
                          long minIntervalMs, int maxHealsPerWindow) {
            this.selfStartEnabled = selfStartEnabled;
            this.healsInWindow = Math.max(0, healsInWindow);
            this.nowMs = nowMs;
            this.lastHealMs = lastHealMs;
            this.minIntervalMs = minIntervalMs > 0L ? minIntervalMs : DEFAULT_HEAL_MIN_INTERVAL_MS;
            this.maxHealsPerWindow = maxHealsPerWindow > 0 ? maxHealsPerWindow : DEFAULT_HEAL_MAX_IN_WINDOW;
        }
    }

    /**
     * onTaskRemoved 之后的自愈决策（纯函数）。决策表（按序判定，命中即返回）：
     * <table border="1">
     *   <tr><th>#</th><th>条件</th><th>restart</th><th>delayMs</th><th>giveUp</th></tr>
     *   <tr><td>1</td><td>selfStartEnabled=false（用户主动关过球）</td><td>false</td><td>0</td><td>false</td></tr>
     *   <tr><td>2</td><td>窗口内已自愈 ≥ maxHealsPerWindow</td><td>false</td><td>0</td><td><b>true</b></td></tr>
     *   <tr><td>3</td><td>距上次自愈 &lt; minIntervalMs</td><td>false</td><td>剩余等待</td><td>false</td></tr>
     *   <tr><td>4</td><td>其余（含时钟回拨）</td><td><b>true</b></td><td>0</td><td>false</td></tr>
     * </table>
     * 口径：#1 尊重用户选择（BootReceiver 同口径：autostart=false 只记录不拉起）；#2 防重启风暴——
     * 连拉 3 次仍被系统清理说明白名单没放行，继续硬刚只会白耗电，改为在卡片上给引导（giveUp=true）。
     */
    public static HealDecision decideSelfHeal(HealInputs in) {
        HealInputs h = in != null ? in
                : new HealInputs(false, 0, 0L, 0L);
        if (!h.selfStartEnabled) {
            return new HealDecision(false, 0L, false,
                    "自启开关关闭（用户选择）→ 不自愈，交回用户手动打开");
        }
        if (h.healsInWindow >= h.maxHealsPerWindow) {
            return new HealDecision(false, 0L, true,
                    "窗口内已自愈 " + h.healsInWindow + " 次仍被清理 → 停止硬刚，转「应用启动管理」白名单引导");
        }
        long elapsed = h.nowMs - h.lastHealMs;
        if (h.lastHealMs > 0L && elapsed >= 0L && elapsed < h.minIntervalMs) {
            long wait = h.minIntervalMs - elapsed;
            return new HealDecision(false, wait, false,
                    "距上次自愈仅 " + elapsed + "ms < " + h.minIntervalMs + "ms → 延后 " + wait + "ms 再试");
        }
        return new HealDecision(true, 0L, false,
                "被系统清理且允许自愈（窗口内 " + h.healsInWindow + "/" + h.maxHealsPerWindow
                        + " 次）→ 立即重启前台服务");
    }

    /**
     * <b>一行钩子</b>（OverlayService.onTaskRemoved 末尾调用，缺省参数版）：
     * 读 {@code dsh_prefs/ball_autostart} 与自愈记账 → {@link #decideSelfHeal}。
     * 调用方据返回值：restart=true → 立刻 startForegroundService 自愈；delayMs&gt;0 → postDelayed 后重试；
     * giveUp=true → 记一条日志/prefs，让设置页卡片显示「已被多次清理，请放行白名单」。
     *
     * <p>记账口径见 {@link #healCountInWindow}：写回 prefs 时，
     * restart 成立才 ++{@link #PREF_HEAL_COUNT} 并写 {@link #PREF_LAST_HEAL_AT}。</p>
     */
    public static HealDecision onTaskRemoved(boolean selfStartEnabled, int healsInWindow,
                                             long nowMs, long lastHealMs) {
        return decideSelfHeal(new HealInputs(selfStartEnabled, healsInWindow, nowMs, lastHealMs));
    }

    /**
     * 自愈窗口计数：距上次自愈已超过 windowMs（或从未自愈）→ 计数归零重新起算，否则沿用当前计数。
     * 调用方把结果回填 {@link #PREF_HEAL_COUNT}，窗口滑出即自动清零。
     */
    public static int healCountInWindow(long lastHealMs, long nowMs, long windowMs, int healCount) {
        if (healCount <= 0 || lastHealMs <= 0L) return 0;
        long w = windowMs > 0L ? windowMs : DEFAULT_HEAL_WINDOW_MS;
        long elapsed = nowMs - lastHealMs;
        if (elapsed < 0L || elapsed >= w) return 0;
        return healCount;
    }

    /**
     * Honor「应用启动管理」跳转降级链（纯数据，零 Android 依赖）：按序尝试，前一条抛异常/stub 就试下一条。
     * 每行为 {@code {kind, arg1, arg2}}：
     * <ul>
     *   <li>{@link #KIND_COMPONENT}：{@code {kind, pkg, cls}} → {@code setComponent(pkg, cls)}</li>
     *   <li>{@link #KIND_ACTION}：{@code {kind, action, ""}} → {@code new Intent(action)}</li>
     *   <li>{@link #KIND_APP_DETAILS}：{@code {kind, "", ""}} → 系统应用详情页（所有 ROM 都有，末级兜底）</li>
     * </ul>
     * 批次49 已在真机验证过前两跳可达原厂启动管理；本方法把这条链收敛成单点定义（批次49 的
     * MainActivity 实现改为消费它），避免「策略在纯逻辑里、链在 UI 里」两份字面量各自漂移。
     */
    public static String[][] startupManagerTargets() {
        return new String[][]{
                {KIND_COMPONENT, HONOR_STARTUP_PKG, HONOR_STARTUP_CLS},
                {KIND_ACTION, HONOR_STARTUP_ACTION, ""},
                {KIND_APP_DETAILS, "", ""},
        };
    }

    // =========================================================================================
    // main 自检：决策表逐条断言（无 JUnit 依赖的"JVM 单测"落法，见类注释）。
    // 任一断言失败 → 打印 FAIL 并 System.exit(1)；全过 → 打印 PASS，退出码 0。
    // =========================================================================================

    // 任一断言失败 → 打印 FAIL 并 System.exit(1)；全过 → 打印 PASS，退出码 0。
    // =========================================================================================

    private static int sFailures = 0;

    private static void check(String name, boolean cond, String detail) {
        if (cond) {
            System.out.println("  ok  " + name);
        } else {
            sFailures++;
            System.out.println("  FAIL " + name + " — " + detail);
        }
    }

    private static void checkDecision(String name, Decision d, String wantAction, boolean wantHold, long wantTimeoutMs) {
        check(name + ".action", wantAction.equals(d.action), "want " + wantAction + " got " + d.action);
        check(name + ".hold", wantHold == d.holdWakeLock, "want " + wantHold + " got " + d.holdWakeLock);
        check(name + ".timeout", wantTimeoutMs == d.timeoutMs, "want " + wantTimeoutMs + " got " + d.timeoutMs);
    }

    /** 决策表全分支自检（假时钟，零等待）。 */
    public static void main(String[] args) {
        System.out.println("KeepAlivePolicy self-check:");

        // 测试用小参数：timeout=1000、renew=1000（均为 Config 下限）、debounce=100，便于纯数值驱动。
        Config cfg = new Config(1000L, 1000L, 100L);
        final long T0 = 1_000_000L;

        // #1 active>0、未持有 → 立即 HOLD（即使刚翻转过也不防抖——不对称性）。
        checkDecision("case1 hold-when-task-present",
                evaluate(2, false, T0, 0L, T0 - 10L, cfg), ACTION_HOLD, true, 1000L);

        // #2 已持有、lastRenew 距今 ≥ renewInterval → RENEW。
        checkDecision("case2 renew-due",
                evaluate(1, true, T0, T0 - 1000L, T0 - 500L, cfg), ACTION_RENEW, true, 1000L);

        // #2b lastRenewMs=0（未知，如 App 重启）按"立即该续"处理，防重建后永不再续。
        checkDecision("case2b renew-when-lastRenew-unknown",
                evaluate(1, true, T0, 0L, T0 - 500L, cfg), ACTION_RENEW, true, 1000L);

        // #3 已持有、未到续期点 → HOLD 维持、timeout=0（调用方跳过 acquire）。
        checkDecision("case3 keep-when-not-due",
                evaluate(1, true, T0, T0 - 999L, T0 - 500L, cfg), ACTION_HOLD, true, 0L);

        // #4 空闲且未持有 → RELEASE 幂等无操作。
        checkDecision("case4 idle-idempotent-release",
                evaluate(0, false, T0, 0L, 0L, cfg), ACTION_RELEASE, false, 0L);

        // #5 空闲但距上次翻转 < debounce → 防抖宽限（维持持有）。
        checkDecision("case5 release-debounce-grace",
                evaluate(0, true, T0, T0 - 500L, T0 - 99L, cfg), ACTION_HOLD, true, 0L);

        // #6 空闲且防抖窗口已过 → RELEASE。
        checkDecision("case6 release-after-debounce",
                evaluate(0, true, T0, T0 - 500L, T0 - 100L, cfg), ACTION_RELEASE, false, 0L);

        // 边角：负任务数按 0；config=null 用缺省值；边界值恰等于阈值。
        checkDecision("case7 negative-active-clamped",
                evaluate(-3, false, T0, 0L, 0L, cfg), ACTION_RELEASE, false, 0L);
        Decision case8 = evaluate(1, false, T0, 0L, 0L, null); // config=null → defaults()
        checkDecision("case8 null-config-defaults", case8, ACTION_HOLD, true, DEFAULT_WAKELOCK_TIMEOUT_MS);
        checkDecision("case9 renew-at-exact-interval",
                evaluate(1, true, T0, T0 - DEFAULT_RENEW_INTERVAL_MS, T0 - 500L, Config.defaults()),
                ACTION_RENEW, true, DEFAULT_WAKELOCK_TIMEOUT_MS);
        checkDecision("case10 release-at-exact-debounce",
                evaluate(0, true, T0, T0 - 500L, T0 - DEFAULT_RELEASE_DEBOUNCE_MS, Config.defaults()),
                ACTION_RELEASE, false, 0L);

        // 不对称性回归：任务在场（active>0）时即便 0ms 前刚 release 翻转过，也必须立即 HOLD，
        // 绝不允许防抖把运行中任务的保活推迟（否则设备可在任务运行中入睡）。
        checkDecision("case11 hold-never-debounced",
                evaluate(1, false, T0, 0L, T0, cfg), ACTION_HOLD, true, 1000L);

        // ================= 批次55-C：保活自检 / 自愈决策 / 启动管理链（纯逻辑断言）=================
        System.out.println("批次55-C keep-alive self-check / self-heal:");

        // 判据全绿（硬判据 + 软判据都满足）→ OK、无待处理、无跳转键。
        SelfCheckReport c1 = selfCheck(new SelfCheck(true, false, true, true, true, true, T0, T0, "HONOR"));
        check("c55c all-green ok", c1.ok, c1.summary);
        check("c55c all-green level", LEVEL_OK.equals(c1.level), "want OK got " + c1.level);
        check("c55c all-green okCount", c1.okCount() == 7, "okCount=" + c1.okCount());
        check("c55c all-green no-target", TARGET_NONE.equals(c1.firstTarget), "target=" + c1.firstTarget);

        // 硬判据不满足（电池优化未放行 / 后台受限 / 球没跑）→ FAIL，首个跳转键 = 电池优化。
        SelfCheckReport c2 = selfCheck(new SelfCheck(false, true, true, false, true, false,
                T0 - 3 * 60 * 60 * 1000L, T0, "HONOR"));
        check("c55c hard-fail level", LEVEL_FAIL.equals(c2.level), "want FAIL got " + c2.level);
        check("c55c hard-fail not-ok", !c2.ok, c2.summary);
        check("c55c hard-fail first-target", TARGET_BATTERY_OPTIMIZATION.equals(c2.firstTarget),
                "target=" + c2.firstTarget);
        check("c55c guidance lists-battery", c2.guidance.contains(NAME_BATTERY), c2.guidance);
        check("c55c guidance lists-service", c2.guidance.contains(NAME_SERVICE), c2.guidance);
        check("c55c guidance honor-hint", c2.guidance.contains("应用启动管理"), c2.guidance);
        check("c55c heartbeat-expired-named", c2.guidance.contains(NAME_HEARTBEAT), c2.guidance);

        // 仅软判据不满足（引导没走过）→ WARN 但 ok=true，跳转键指向启动管理。
        SelfCheckReport c3 = selfCheck(new SelfCheck(true, false, true, true, true, false, T0, T0, "HONOR"));
        check("c55c soft-warn level", LEVEL_WARN.equals(c3.level), "want WARN got " + c3.level);
        check("c55c soft-warn still-ok", c3.ok, c3.summary);
        check("c55c soft-warn target", TARGET_STARTUP_MANAGER.equals(c3.firstTarget),
                "target=" + c3.firstTarget);

        // 非 Honor：引导文案走通用「自启动管理」，且 null 输入不炸（防御分支）。
        SelfCheckReport c4 = selfCheck(new SelfCheck(true, false, true, true, true, false, T0, T0, "Xiaomi"));
        check("c55c non-honor guidance", c4.guidance.contains("自启动"), c4.guidance);
        check("c55c null-input-safe", LEVEL_FAIL.equals(selfCheck(null).level), "null 输入应判 FAIL");

        check("c55c honor-rom-detect",
                isHonorRom("HONOR") && isHonorRom("huawei") && isHonorRom("Huawei Technologies Co., Ltd.")
                        && !isHonorRom("Xiaomi") && !isHonorRom(null), "厂商判定");
        check("c55c stale-detect",
                isStale(0L, T0, DEFAULT_CHECK_MAX_AGE_MS)
                        && isStale(T0 - DEFAULT_CHECK_MAX_AGE_MS - 1L, T0, DEFAULT_CHECK_MAX_AGE_MS)
                        && !isStale(T0 - 1000L, T0, DEFAULT_CHECK_MAX_AGE_MS)
                        && !isStale(T0 + 5000L, T0, DEFAULT_CHECK_MAX_AGE_MS), "过期判定（含时钟回拨）");
        check("c55c heartbeat-delay",
                nextHeartbeatDelayMs(0L, T0, 0L) == 0L
                        && nextHeartbeatDelayMs(T0 - 1000L, T0, 60000L) == 59000L
                        && nextHeartbeatDelayMs(T0 - 60000L, T0, 60000L) == 0L
                        && nextHeartbeatDelayMs(T0 + 5000L, T0, 60000L) == 0L, "心跳延迟");

        // 自愈决策表 #1~#4（含时钟回拨不算「刚自愈过」）。
        HealDecision h1 = onTaskRemoved(true, 0, T0, 0L);
        check("c55c heal-restart", h1.restart && !h1.giveUp && h1.delayMs == 0L, h1.reason);
        HealDecision h2 = onTaskRemoved(false, 0, T0, 0L);
        check("c55c heal-respects-user", !h2.restart && !h2.giveUp, h2.reason);
        HealDecision h3 = onTaskRemoved(true, DEFAULT_HEAL_MAX_IN_WINDOW, T0, T0 - 60000L);
        check("c55c heal-giveup-after-cap", !h3.restart && h3.giveUp && h3.delayMs == 0L, h3.reason);
        HealDecision h4 = decideSelfHeal(new HealInputs(true, 1, T0, T0 - 1000L, 60000L, 3));
        check("c55c heal-backoff", !h4.restart && !h4.giveUp && h4.delayMs == 59000L, h4.reason);
        HealDecision h5 = decideSelfHeal(new HealInputs(true, 1, T0, T0 + 5000L, 60000L, 3));
        check("c55c heal-clock-rollback", h5.restart, h5.reason);
        check("c55c heal-window-count",
                healCountInWindow(T0 - DEFAULT_HEAL_WINDOW_MS, T0, DEFAULT_HEAL_WINDOW_MS, 3) == 0
                        && healCountInWindow(T0 - 1000L, T0, DEFAULT_HEAL_WINDOW_MS, 3) == 3
                        && healCountInWindow(T0 - 1000L, T0, DEFAULT_HEAL_WINDOW_MS, 0) == 0,
                "窗口内计数");

        // 启动管理降级链：单点定义（批次49 的字面量收敛到这里），末级必须是应用详情兜底。
        String[][] chain = startupManagerTargets();
        check("c55c chain-length", chain.length == 3, "len=" + chain.length);
        check("c55c chain-head-honor",
                KIND_COMPONENT.equals(chain[0][0]) && HONOR_STARTUP_PKG.equals(chain[0][1])
                        && chain[0][2].endsWith("StartupNormalAppListActivity"), chain[0][1]);
        check("c55c chain-second-action",
                KIND_ACTION.equals(chain[1][0]) && HONOR_STARTUP_ACTION.equals(chain[1][1]),
                chain[1][1]);
        check("c55c chain-tail-app-details", KIND_APP_DETAILS.equals(chain[chain.length - 1][0]),
                chain[chain.length - 1][0]);

        if (sFailures > 0) {
            System.out.println("KeepAlivePolicy self-check: FAIL (" + sFailures + " assertion(s))");
            System.exit(1);
        }
        System.out.println("KeepAlivePolicy self-check: PASS");
    }
}
