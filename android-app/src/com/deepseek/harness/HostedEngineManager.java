package com.deepseek.harness;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Environment;
import android.os.SystemClock;
import android.system.Os;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;

import moe.shizuku.server.IRemoteProcess;
import moe.shizuku.server.IShizukuService;
import rikka.shizuku.Shizuku;
import rikka.shizuku.ShizukuBinderWrapper;

/**
 * 批次67：托管引擎（类系统应用常驻）。
 *
 * <p><b>要解决的问题</b>：引擎（node，127.0.0.1:3080）旧实现是 App 进程用 ProcessBuilder fork 的
 * <b>子进程</b>（真机实测 PPID = App 主进程 pid）。因此 adb install -r 覆盖安装、用户「强行停止」、
 * 系统 force-stop 都会连带杀掉引擎，重拉一次要等 10~30s。</p>
 *
 * <p><b>本类做法（非破坏性）</b>：经由本机可用的特权通道把引擎改用 <b>setsid 脱离 App 进程树</b>拉起，
 * 并配一个 shell 看护脚本负责自动复活。运行文件必须落在 /data/local/tmp/dsh（实测 /sdcard 是 noexec：
 * can't execute: Permission denied），用户数据（DSH_HOME）落在共享目录 /sdcard/DeepSeekHarness/home，
 * App 与特权身份进程都可读写（可备份、卸载不丢、可回滚到旧私有目录）。</p>
 *
 * <p><b>批次95：两条托管通道</b>（root 优先 / Shizuku 兜底，与 VscreensManager 的 auto 口径一致）：
 * <ul>
 *   <li><b>root(su)</b>：`su -c` 拉起，引擎以 <b>uid 0</b> 常驻（有 root、没装 Shizuku 的设备走这条）；
 *       allowlist 已授权本 App 时静默放行，未授权时 su 会阻塞，由探测超时判不可用并回退；</li>
 *   <li><b>Shizuku</b>：shell uid=2000（批次67 原路径，行为不变）。</li>
 * </ul>
 * 两条通道的运行文件 / 看护 / 脚本完全共用，差别只有「谁执行 shell 命令」（runHost）与 engine.env 里的
 * ROOT_AVAILABLE；通道变更会让 staging 指纹失配 ⇒ 自动重新 staging（避免 root/shell 混属主）。</p>
 *
 * <p><b>与旧链路的关系</b>：App 内模式（MainActivity.spawnNode）完整保留，作为两条通道都不可用
 * （未装 / 未激活 / 未授权）时的回退路径；本类只负责「可用时优先托管」。</p>
 *
 * <p><b>安全边界</b>：托管引擎跑在特权身份下（root 或 shell），AI 的 bash/文件工具随之获得同级能力，
 * 因此托管模式强制打开危险操作审批门（dsh_prefs/confirm_gate=true），退出托管时还原用户原值
 * （confirm_gate_hosted_backup）。</p>
 */
public final class HostedEngineManager {

    private static final String TAG = "HostedEngineManager";

    // ==== 偏好（与 MainActivity 同库 dsh_prefs） ====
    private static final String PREFS = "dsh_prefs";
    /** 托管开关（缺省 true）。关掉即回到 App 内引擎。 */
    private static final String KEY_HOSTED_MODE = "engine_hosted_mode";
    /** 已完成 staging 的 payload 指纹（与 App 内模式 payload_fp 同口径）。 */
    public static final String KEY_HOSTED_STAMP = "hosted_staged_fp";
    /** 最近一次托管动作结果（人读，展示用）。 */
    public static final String KEY_HOSTED_LAST = "hosted_last_result";
    /** 托管前的 confirm_gate 原值（退出托管还原）。 */
    public static final String KEY_CONFIRM_GATE_BACKUP = "confirm_gate_hosted_backup";
    /** 批次85-R3：设置页要显示/切换该门（托管期写的是 BACKUP，退出托管时还原到本键）。 */
    public static final String KEY_CONFIRM_GATE = "confirm_gate";

    // ==== 批次95：托管通道（root 优先 / Shizuku 兜底） ====
    /** 通道标识：root(su) 拉起，引擎 uid=0。 */
    public static final String CHANNEL_ROOT = "root";
    /** 通道标识：Shizuku 拉起，引擎 uid=2000（批次67 原路径）。 */
    public static final String CHANNEL_SHIZUKU = "shizuku";
    /** 最近一次成功托管所用通道（展示用，不参与判定）。 */
    public static final String KEY_HOSTED_CHANNEL = "hosted_channel";
    /** root 探测缓存：TTL 与结果（应用内唯一一份 root 探测，MainActivity / ScheduleExecutor 共用）。 */
    private static final long ROOT_PROBE_TTL_MS = 60000L;
    private static volatile Boolean sRootOk = null;
    private static volatile long sRootAtMs = 0L;

    // ==== 路径契约（e2e 脚本与真机取证依赖这些字面量，勿随意改名） ====
    /** 引擎运行目录：唯一允许执行二进制的落点（/sdcard 为 noexec）。 */
    public static final String HOSTED_DIR = "/data/local/tmp/dsh";
    public static final String STAMP_FILE = "/data/local/tmp/dsh/.stamp";
    public static final String ENGINE_PID_FILE = "/data/local/tmp/dsh/engine.pid";
    public static final String WATCHDOG_PID_FILE = "/data/local/tmp/dsh/watchdog.pid";
    public static final String ENGINE_ENV_FILE = "/data/local/tmp/dsh/engine.env";
    public static final String WATCHDOG_STATE_FILE = "/data/local/tmp/dsh/watchdog.state";
    public static final String ENGINE_LOG_FILE = "/data/local/tmp/dsh/logs/engine.log";
    public static final String WATCHDOG_LOG_FILE = "/data/local/tmp/dsh/logs/watchdog.log";
    /**
     * DSH_HOME（引擎实际使用）：必须在内部存储——dsh-app-boot 要求
     * profiles/node_modules/@deepseek-ai/dsh 是 <b>symlink</b>，而 /sdcard（FUSE）不支持 symlink。
     * 用户数据（sessions / attachments / storages）用 symlink 落到共享目录，配置文件双向镜像，
     * 既满足引擎约束，又保留「App 与 shell 共见、可备份、卸载不丢」。
     */
    public static final String HOSTED_HOME_DIR = "/data/local/tmp/dsh/home";
    /** 共享目录名（与 MainActivity.EXT_DSHROOT_ROOT 同源口径）。 */
    private static final String SHARED_DIR_NAME = "DeepSeekHarness";
    private static final String HOSTED_SUBDIR = "hosted";
    private static final String HOME_SUBDIR = "home";

    /**
     * 批次68：home 根目录的「用户 / 第三方插件自有文件」——包内种子即使同名也<b>不得覆盖</b>，
     * 并且必须在「托管 home ↔ 共享 home」之间搬运。
     *
     * <p>真机教训（批次67 托管上线后用户报「模型突然没账号 / 没有模型显示」）：
     * <ol>
     *   <li>staging 的 {@code cp -rf "$DIR/dshhome/." "$DIR/home/"} 会把用户 settings.yaml（826 B，
     *       含模型与提供方配置）冲成包内默认值（88 B）；</li>
     *   <li>第三方插件把状态放在自己家里，例如 dsh-agy 的账号池
     *       {@code <DSH_HOME>/agy-accounts.json}（dsh-agy/lib/plugin-common-DWSiyQG-.mjs:340）——
     *       不在搬运名单里就永远进不了托管 home（两个 home 目录不共享），表现为
     *       「No agy account configured」。</li>
     * </ol>
     * 新增第三方插件时，只要它在 home 根目录放文件，就往这里加一行（契约测试锁住既有条目）。</p>
     */
    static final String[] HOME_USER_FILES = {
            "settings.yaml",
            ".credentials.yaml",
            ".anonymous-user-id",
            "agy-master-key.json",
            "agy-accounts.json",
            "agy-fingerprint-data.json"
    };
    /**
     * 批次68「从私有 home 捞回用户配置」修复的落点标记（落共享 home，只跑一次）。
     * v2：判据加了「只往更丰富的方向补」（v1 只在共享侧还与包内种子完全一致时才敢修，
     * 而真机共享侧已被旧 start 脚本的回镜像改写成 187 B，导致 v1 什么都没修）。
     */
    static final String REPAIR_MARKER = ".repaired-private-home-v2";

    /**
     * 批次69：payload 的 glibc 被二进制补丁改写为读 App 私有目录里的 resolv.conf
     * （真机取证：libc.so.6 内该字符串 = /data/user/0/com.deepseek.harness/files/etc/r.conf）。
     * App 内模式（同 uid）没问题；**托管引擎跑在 shell uid=2000，读不到该文件**（cat → Permission
     * denied），glibc 拿不到 nameserver → getaddrinfo EAI_AGAIN → 所有出网请求失败
     * （表现为「模型列表空 / DeepSeek API 请求失败」，与 API Key 无关）。
     * 修复：把托管 libc 的该路径改写为 shell 可读的 RESOLV_PATH_HOSTED，并由 start 脚本每次启动刷新内容。
     */
    static final String RESOLV_PATH_APP_PRIVATE = "/data/user/0/com.deepseek.harness/files/etc/r.conf";
    static final String RESOLV_PATH_HOSTED = HOSTED_DIR + "/etc/r.conf";
    /** 托管 DNS 配置在暂存目录的暂存名（App 写，start 脚本搬进 $DIR/etc/r.conf）。 */
    static final String HOSTED_RESOLV_NAME = "hosted-resolv.conf";
    /** 改写托管 libc 解析器路径的小脚本（staging 后与每次 start 前幂等执行）。 */
    static final String RESOLVER_PATCH_SCRIPT_NAME = "fix-hosted-resolver.cjs";

    /** 三个脚本先写共享目录（App 可直写），再同步进 HOSTED_DIR 供看护自愈复用。 */
    private static final String STAGE_SCRIPT_NAME = "stage-payload.sh";
    private static final String START_SCRIPT_NAME = "start-engine.sh";
    private static final String WATCHDOG_SCRIPT_NAME = "watchdog.sh";
    private static final String PAYLOAD_ZIP_NAME = "payload.zip";
    private static final String PAYLOAD_ZIP_FP_NAME = "payload.zip.fp";

    // ==== 引擎契约 ====
    public static final int ENGINE_PORT = 3080;
    private static final String REL_BIN_JS =
            "dshroot/lib/node_modules/@deepseek-ai/dsh/lib/bin.js";
    private static final String REL_TOOLS_JS =
            "dshroot/lib/node_modules/@deepseek-ai/dsh-tools/lib/index.js";
    private static final String RISH_DEX_REL = "rish/rish_shizuku.dex";
    private static final String AUTH_MARKER =
            "dsh web: http://127.0.0.1:" + ENGINE_PORT + "/?token=";

    // ==== 时序与预算（对齐批次66 的救援口径） ====
    /** 看护轮询间隔（秒）。真机待机掉电明显时可放宽到 90。 */
    private static final long WATCHDOG_INTERVAL_SEC = 45;
    /** 批次70：空闲档间隔 —— 无 ESTABLISHED 连接时放宽到 90s（待机省电）。 */
    private static final long WATCHDOG_INTERVAL_IDLE_SEC = 90;
    /** 单窗口最多抢救次数（稳定 120s 复位预算）。 */
    private static final int WATCHDOG_MAX_ATTEMPTS = 3;
    /** 两次抢救之间的冷却（秒）。 */
    private static final long WATCHDOG_COOLDOWN_SEC = 60;
    /** 引擎稳定这么多秒后复位抢救预算。 */
    private static final long WATCHDOG_STABLE_SEC = 120;
    /** 托管拉起后等 3080 就绪的上限。 */
    private static final long HEALTH_WAIT_MS = 90000;
    private static final long HEALTH_POLL_MS = 500;
    public static final String WATCHDOG_PATTERN = "dsh/watchdog.sh";
    private static final String ENGINE_PROC_PATTERN = "/data/local/tmp/dsh/dshroot";

    private HostedEngineManager() {}

    // =====================================================================================
    // 探针
    // =====================================================================================

    /** Shizuku 服务活着且已授权本 App（模式对齐 VscreensManager.shizukuAvailable）。 */
    public static boolean shizukuReady() {
        try {
            return Shizuku.pingBinder()
                    && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    public static boolean shizukuBinderAlive() {
        try {
            return Shizuku.pingBinder();
        } catch (Throwable t) {
            return false;
        }
    }

    /** 用户是否希望托管（缺省 true：常驻是默认体验）。 */
    public static boolean hostedWanted(Context ctx) {
        try {
            return prefs(ctx).getBoolean(KEY_HOSTED_MODE, true);
        } catch (Throwable t) {
            return false;
        }
    }

    public static void setHostedWanted(Context ctx, boolean on) {
        try {
            prefs(ctx).edit().putBoolean(KEY_HOSTED_MODE, on).apply();
        } catch (Throwable ignored) {}
    }

    /**
     * 批次95：root(su) 是否可用（60s TTL 缓存）——判据 = `su -c id` 3s 内返回且首行含 uid=0。
     *
     * <p>未授权 / 未预置授权策略时 su 会等弹窗而阻塞，此处一律判不可用，调用方回退 App 内引擎。</p>
     */
    public static boolean rootReady() {
        Boolean cached = sRootOk;
        long now = SystemClock.elapsedRealtime();
        if (cached != null && (now - sRootAtMs) < ROOT_PROBE_TTL_MS) return cached;
        boolean ok = probeRootNow();
        sRootOk = ok;
        sRootAtMs = now;
        return ok;
    }

    /** 立即探测 root（不走缓存）：`su -c id` → uid=0。 */
    public static boolean probeRootNow() {
        Process p = null;
        try {
            p = Runtime.getRuntime().exec(new String[]{"su", "-c", "id"});
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String line = r.readLine();
            try {
                if (!p.waitFor(3, TimeUnit.SECONDS)) p.destroy();
            } catch (Throwable ignored) {}
            boolean ok = line != null && line.contains("uid=0");
            Log.i(TAG, "[b95] root probe: " + (ok ? "su available (uid=0)" : "no root (" + line + ")"));
            return ok;
        } catch (Throwable t) {
            Log.i(TAG, "[b95] root probe failed: " + t);
            return false;
        } finally {
            try { if (p != null) p.destroy(); } catch (Throwable ignored) {}
        }
    }

    /** 让 root 探测缓存失效（例如用户刚在 root 管理器里授权本 App）。 */
    public static void invalidateRootCache() {
        sRootOk = null;
    }

    /**
     * 当前可用的托管通道：<b>root(su) 优先，Shizuku 兜底</b>（与 VscreensManager 的 auto 口径一致）；
     * 两条都不可用返回 null（调用方回退 App 内引擎）。
     */
    public static String activeChannel() {
        if (rootReady()) return CHANNEL_ROOT;
        if (shizukuReady()) return CHANNEL_SHIZUKU;
        return null;
    }

    /** 展示口径：托管(root) / 托管(shell) / App 内。 */
    public static String modeLabel(Context ctx) {
        String ch = activeChannel();
        if (CHANNEL_ROOT.equals(ch)) return "托管(root)";
        if (CHANNEL_SHIZUKU.equals(ch)) return "托管(shell)";
        return "App 内";
    }

    /** 是否应当走托管：用户开关 + 任一托管通道可用（root 优先 / Shizuku 兜底）。 */
    public static boolean hostedUsable(Context ctx) {
        return hostedWanted(ctx) && activeChannel() != null;
    }

    /** 3080 上是不是「自家引擎」（401 可信 / 首页 title 命中，与 App 内模式同一判据）。 */
    public static boolean engineOnline(Context ctx) {
        return engineOnline(ctx, 1200, 1500);
    }

    static boolean engineOnline(Context ctx, int connectMs, int readMs) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://127.0.0.1:" + ENGINE_PORT + "/").openConnection();
            c.setConnectTimeout(connectMs);
            c.setReadTimeout(readMs);
            c.setRequestProperty("User-Agent", "dsh-probe");
            String cookie = ctx == null ? null : prefs(ctx).getString("engine_cookie", null);
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            int code = c.getResponseCode();
            if (code == 401) {
                InputStream error = c.getErrorStream();
                if (error == null) return false;
                return readAll(error, 8192).contains("dsh web authentication required");
            }
            if (code < 200 || code >= 400) return false;
            return readAll(c.getInputStream(), 262144).contains("<title>DeepSeek Harness</title>");
        } catch (Throwable t) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    // =====================================================================================
    // 目录
    // =====================================================================================

    /** 共享目录根：/sdcard/DeepSeekHarness（App 有 MANAGE_EXTERNAL_STORAGE，shell 也可读写）。 */
    public static File sharedRoot(Context ctx) {
        return new File(Environment.getExternalStorageDirectory(), SHARED_DIR_NAME);
    }

    /** 脚本与 payload.zip 的暂存目录（App 直写）。 */
    public static File stagingDir(Context ctx) {
        return new File(sharedRoot(ctx), HOSTED_SUBDIR);
    }

    /** DSH_HOME：会话/设置/凭证（App 与 shell 共见，卸载不丢，可备份回滚）。 */
    public static File homeDir(Context ctx) {
        return new File(sharedRoot(ctx), HOME_SUBDIR);
    }

    /** 共享目录里的 payload.zip（同时兼容轻壳模式的既有约定路径）。 */
    public static File payloadZip(Context ctx) {
        return new File(sharedRoot(ctx), PAYLOAD_ZIP_NAME);
    }

    /** 幂等创建共享目录（FUSE 下 owner 位不够，必须放开 other 位，否则 shell 写不进去）。 */
    static boolean ensureDirWritable(File dir) {
        try {
            if (!dir.exists() && !dir.mkdirs()) return false;
            dir.setReadable(true, false);
            dir.setWritable(true, false);
            dir.setExecutable(true, false);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    // =====================================================================================
    // 主入口
    // =====================================================================================

    /** 托管动作结果：直接喂给 MainActivity 的握手字段（authUrl / cookie）。 */
    public static final class Result {
        public boolean ok;
        public boolean reused;
        public String reason = "";
        public int pid;
        public String authUrl;
        public String cookie;

        static Result fail(String reason) {
            Result r = new Result();
            r.ok = false;
            r.reason = reason;
            return r;
        }
    }

    /**
     * 托管拉起引擎（幂等）：
     * <ol>
     *   <li>共享目录就绪 + 首次把 App 私有 dshhome 迁到共享 home（只补缺、不删原目录）；</li>
     *   <li>staging（指纹一致直接跳过；运行文件丢失/被清理工具清空则自动重 staging）；</li>
     *   <li>写 engine.env（600）+ 同步脚本到 HOSTED_DIR；</li>
     *   <li>执行 start-engine.sh 等 3080 就绪 从引擎日志取一次性 token 换 Cookie；</li>
     *   <li>拉起看护脚本（已存活则跳过）。</li>
     * </ol>
     */
    public static Result startEngine(Context ctx, File payload, String fingerprint) {
        return startEngine(ctx, payload, fingerprint, true);
    }

    /**
     * 批次69：托管拉起是「全局单飞」——MainActivity / BootReceiver / 看护探活 会并发调用它，
     * 并发时一个线程在 staging、另一个线程读到旧指纹 → STAGE_FAILED → 回退 App 内引擎 →
     * 两个 node 抢 3080（真机实测：App 卡在启动页，其中一个 node 立刻 EADDRINUSE 崩）。
     * 串行化后，后到的调用会看到引擎已在线，直接走「复用」分支（毫秒级）。
     */
    private static final Object START_LOCK = new Object();

    static Result startEngine(Context ctx, File payload, String fingerprint, boolean startWatchdog) {
        synchronized (START_LOCK) {
            return startEngineLocked(ctx, payload, fingerprint, startWatchdog);
        }
    }

    private static Result startEngineLocked(Context ctx, File payload, String fingerprint, boolean startWatchdog) {
        Result r = new Result();
        String channel = activeChannel();
        if (channel == null) return Result.fail("NO_HOST_CHANNEL");
        if (!ensureDirWritable(sharedRoot(ctx)) || !ensureDirWritable(stagingDir(ctx))) {
            return Result.fail("SHARED_DIR_UNAVAILABLE");
        }
        if (!ensureDirWritable(homeDir(ctx))) return Result.fail("HOME_DIR_UNAVAILABLE");
        migrateHomeIfNeeded(ctx, payload);
        boolean repaired = repairPrivateHomeOnce(ctx, payload);
        applyConfirmGate(ctx, true);
        if (repaired) {
            // 修复写的是共享 home（权威副本）；正在跑的内部 home 还是被种子覆盖过的旧副本 →
            // 先停一次，让随后的 start 脚本按「mtime 新者胜」把修复结果搬进 /data/local/tmp/dsh/home。
            Log.i(TAG, "[b68] private home repaired -> restart hosted engine");
            stopEngine(ctx);
        }
        writeSharedResolvConf(ctx);
        writeScripts(ctx);
        try {
            ensurePayloadZip(ctx);
        } catch (Throwable t) {
            Log.w(TAG, "payload.zip staging failed", t);
            return Result.fail("ZIP_STAGE_FAILED:" + t.getMessage());
        }
        if (!ensureStaged(ctx, fingerprint)) return Result.fail("STAGE_FAILED");
        if (!writeEngineEnv(ctx, payload)) return Result.fail("ENV_WRITE_FAILED");
        if (!syncScriptsToHostedDir(ctx)) return Result.fail("SCRIPT_SYNC_FAILED");

        int before = remoteEnginePid(ctx);
        if (before > 0 && engineOnline(ctx, 800, 1200)) {
            r.ok = true;
            r.reused = true;
            r.pid = before;
            r.authUrl = readAuthUrlFromLog(ctx);
            r.cookie = prefs(ctx).getString("engine_cookie", null);
            Log.i(TAG, "[b67] hosted engine reused pid=" + before);
            if (startWatchdog) adoptOnlineEngine(ctx);
            return r;
        }
        runHost("sh " + HOSTED_DIR + "/" + START_SCRIPT_NAME, 20000);
        long deadline = SystemClock.elapsedRealtime() + HEALTH_WAIT_MS;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (engineOnline(ctx, 1200, 1500)) break;
            sleep(HEALTH_POLL_MS);
        }
        if (!engineOnline(ctx, 1200, 1500)) {
            String tail = runHost("tail -c 2048 " + ENGINE_LOG_FILE, 8000);
            Log.w(TAG, "[b67] hosted engine not ready within " + HEALTH_WAIT_MS + "ms"
                    + (tail == null ? "" : " · log tail: " + redactToken(tail)));
            return Result.fail("HEALTH_TIMEOUT");
        }
        r.ok = true;
        r.pid = remoteEnginePid(ctx);
        r.authUrl = readAuthUrlFromLog(ctx);
        r.cookie = exchangeCookie(r.authUrl);
        if (r.cookie != null) {
            try {
                prefs(ctx).edit().putString("engine_cookie", r.cookie).apply();
            } catch (Throwable ignored) {}
        }
        Log.i(TAG, "[b67] hosted engine ready ch=" + channel
                + " uid=" + (CHANNEL_ROOT.equals(channel) ? "0" : "2000") + " pid=" + r.pid
                + " stamp=" + String.valueOf(fingerprint));
        try { prefs(ctx).edit().putString(KEY_HOSTED_CHANNEL, channel).apply(); } catch (Throwable ignored) {}
        if (startWatchdog) startWatchdog(ctx);
        return r;
    }

    /** 在线就复用、不在线就拉起来（看护/闹钟探活路径用；不需要 payload 与指纹）。 */
    /**
     * 引擎已在线时的「收养」路径：只打印复用标记并确保看护在位，绝不重拉（避免两个引擎抢 3080）。
     * <p>为什么必须有它：App 内模式里「引擎已在线」会在 MainActivity.startEngineLocked 直接早退，
     * 而托管模式还需要看护脚本在位——缺了这一步，引擎在跑却无人看护（真机实测踩到）。</p>
     *
     * @return 复用到的引擎 pid（0 = 读不到或没在跑）
     */
    public static int adoptOnlineEngine(Context ctx) {
        if (activeChannel() == null) return 0;
        int pid = remoteEnginePid(ctx);
        if (pid <= 0) return 0;
        // 批次68：引擎在线也不能跳过「修复迁移」——App 冷启动通常走的正是这条收养路径
        // （真机实测：只挂 startEngine 不够）。修复的落点是共享 home，因此需要重启一次，
        // 让 start 脚本按「mtime 新者胜」把修复结果搬进内部 home。
        if (repairPrivateHomeOnce(ctx, null)) {
            Log.i(TAG, "[b68] home repaired -> restart hosted engine (adopt path)");
            stopEngine(ctx);
            Result again = startEngine(ctx, null, null, true);
            return again != null && again.ok ? again.pid : 0;
        }
        // 批次69：APK 升级后必须重 staging（脚本/payload 随包更新；批次69 还要给托管 libc 打 DNS 补丁）。
        // 收养路径不走 startEngine，所以这里主动停一次，让它重 staging 并重启。
        if (!stagedFingerprintMatches(ctx)) {
            Log.i(TAG, "[b69] staged payload stale (APK upgraded) -> restage + restart hosted engine");
            stopEngine(ctx);
            Result again = startEngine(ctx, new File(ctx.getFilesDir(), "payload"), apkFingerprint(ctx), true);
            return again != null && again.ok ? again.pid : 0;
        }
        try {
            prefs(ctx).edit().putString(KEY_HOSTED_LAST, "reused pid=" + pid).apply();
        } catch (Throwable ignored) {}
        Log.i(TAG, "[b67] hosted engine reused pid=" + pid);
        startWatchdog(ctx);
        return pid;
    }

    public static boolean ensureRunning(Context ctx) {
        if (!hostedUsable(ctx)) return false;
        if (engineOnline(ctx, 1200, 1500)) {
            // 与 adoptOnlineEngine 同一语义（含 [b67] hosted engine reused 标记 + 看护幂等拉起）：
            // 早退路径也必须留可观测标记，否则外部取证只能看到「无人看护」的假象（真机 e2e 踩到）。
            adoptOnlineEngine(ctx);
            return true;
        }
        Result r = startEngine(ctx, null, null, true);
        return r.ok;
    }

    // =====================================================================================
    // staging（payload.zip 到 /data/local/tmp/dsh）
    // =====================================================================================

    /** 把 assets/payload.zip 发布到共享目录（轻壳模式退回共享目录里既有的 payload.zip）。 */
    static File ensurePayloadZip(Context ctx) throws IOException {
        File target = payloadZip(ctx);
        File fpFile = new File(sharedRoot(ctx), PAYLOAD_ZIP_FP_NAME);
        String wanted = payloadZipFingerprint(ctx);
        String have = readTextQuiet(fpFile);
        if (target.isFile() && target.length() > 0 && wanted != null && wanted.equals(have)) {
            return target;
        }
        InputStream in = null;
        OutputStream out = null;
        try {
            in = ctx.getAssets().open(PAYLOAD_ZIP_NAME);
        } catch (IOException e) {
            if (target.isFile() && target.length() > 0) {
                Log.i(TAG, "assets/" + PAYLOAD_ZIP_NAME + " 缺失（轻壳模式），沿用共享目录既有 zip");
                return target;
            }
            throw new IOException("assets/" + PAYLOAD_ZIP_NAME + " 缺失且共享目录无既有 zip");
        }
        try {
            out = new FileOutputStream(target, false);
            byte[] buf = new byte[1 << 16];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                total += n;
            }
            out.flush();
            try { ((FileOutputStream) out).getFD().sync(); } catch (Throwable ignored) {}
            target.setReadable(true, false);
            writeTextQuiet(fpFile, wanted);
            Log.i(TAG, "published payload.zip -> " + target.getAbsolutePath() + " (" + total + " bytes)");
            return target;
        } finally {
            try { if (in != null) in.close(); } catch (Throwable ignored) {}
            try { if (out != null) out.close(); } catch (Throwable ignored) {}
        }
    }

    /** payload.zip 指纹：assets 口径 = 条目长度 + APK 指纹；轻壳口径 = 文件长度 + mtime。 */
    static String payloadZipFingerprint(Context ctx) {
        try {
            android.content.res.AssetFileDescriptor fd = ctx.getAssets().openFd(PAYLOAD_ZIP_NAME);
            long len = fd.getLength();
            fd.close();
            return "asset:" + len + ":" + apkFingerprint(ctx);
        } catch (Throwable ignored) {}
        try {
            File f = payloadZip(ctx);
            if (f.isFile()) return "file:" + f.length() + ":" + f.lastModified();
        } catch (Throwable ignored) {}
        return null;
    }

    /** APK 指纹（与 App 内模式 payload_fp 同口径：length + lastModified + versionCode）。 */
    public static String apkFingerprint(Context ctx) {
        try {
            String src = ctx.getApplicationInfo() != null ? ctx.getApplicationInfo().sourceDir : null;
            if (src == null || src.isEmpty()) return "";
            File apk = new File(src);
            int vcode = 0;
            try {
                vcode = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionCode;
            } catch (Throwable ignored) {}
            return apk.length() + ":" + apk.lastModified() + ":" + vcode;
        } catch (Throwable t) {
            return "";
        }
    }

    /**
     * 批次95：托管 staging 指纹 = APK 指纹 + 托管通道。
     *
     * <p>为什么必须带通道：root 通道解出来的运行文件属主是 root，Shizuku 通道是 shell；切换通道后若沿用
     * 旧 staging，会出现「root 写的目录 shell 删不掉」的混属主状态。带上通道后一次失配即触发重新 staging
     * （stage 脚本会 rm -rf 运行树再解）。</p>
     */
    static String hostedStamp(Context ctx, String fingerprint) {
        if (fingerprint == null || fingerprint.length() == 0) return fingerprint;
        String ch = activeChannel();
        // 幂等：入参可能已经是「指纹|通道」（KEY_HOSTED_STAMP 存的就是这个形态，AlarmReceiver 路径
        // 会把它当 fingerprint 再传回来）——不去后缀就会拼成 |root|root，导致每次启动都「指纹失配 →
        // 重新 staging」（真机 2026-09-22 实测踩到）。
        String base = fingerprint;
        int bar = base.lastIndexOf('|');
        if (bar > 0) base = base.substring(0, bar);
        return base + "|" + (ch == null ? "none" : ch);
    }

    /**
     * 批次95：App 私有 rish dex 路径（Shizuku 通道用；由 MainActivity.extractRishDex 落盘）。
     * 文件不在时返回空串 —— 插件侧 privCmd 会退到「托管 shell / su」分支，不会报 SHIZUKU_DEX 未配置。
     */
    public static String rishDexPath(Context ctx) {
        try {
            File f = new File(ctx.getFilesDir(), RISH_DEX_REL);
            if (f.isFile() && f.length() > 0) return f.getAbsolutePath();
        } catch (Throwable ignored) {}
        return "";
    }

    /**
     * 批次69：已 staging 的指纹是否与当前 APK 一致。收养路径用它判断要不要重 staging + 重启 ——
     * 覆盖安装后脚本/payload 都随包更新（批次69 还要给托管 libc 打 DNS 补丁），而收养路径不经过
     * startEngine，只走「复用」，不修就会一直跑旧 staging（真机实测：升级后 libc 仍是旧解析器路径）。
     */
    static boolean stagedFingerprintMatches(Context ctx) {
        try {
            String fp = hostedStamp(ctx, apkFingerprint(ctx));
            if (fp == null || fp.length() == 0) return false;
            String remote = runHost("cat " + STAMP_FILE, 8000);
            return remote != null && remote.trim().equals(fp);
        } catch (Throwable t) {
            return false;
        }
    }

    /** 指纹一致且运行文件在位就跳过 staging；否则执行 stage 脚本（解 zip + chmod + 写 .stamp）。 */
    static boolean ensureStaged(Context ctx, String fingerprint) {
        String fp = hostedStamp(ctx, fingerprint != null ? fingerprint
                : prefs(ctx).getString(KEY_HOSTED_STAMP, null));
        String remote = runHost("cat " + STAMP_FILE, 8000);
        boolean onDisk = runHost("test -x " + HOSTED_DIR + "/runtime/bin/node && echo ok", 8000) != null
                && runHost("test -f " + HOSTED_DIR + "/" + REL_BIN_JS + " && echo ok", 8000) != null
                && runHost("test -d " + HOSTED_HOME_DIR + " && echo ok", 8000) != null;
        if (remote != null && fp != null && remote.trim().equals(fp) && onDisk) {
            return true;
        }
        if (remote != null && fp != null && !remote.trim().equals(fp)) {
            Log.i(TAG, "[b67] staged payload fingerprint mismatch -> restage (disk="
                    + remote.trim() + " want=" + fp + ")");
        } else if (!onDisk) {
            Log.i(TAG, "[b67] staged payload missing -> restage");
        }
        String out = runHost("sh " + stagingDir(ctx) + "/" + STAGE_SCRIPT_NAME
                + " " + q(payloadZip(ctx).getAbsolutePath()) + " " + q(String.valueOf(fp)), 600000);
        String after = runHost("cat " + STAMP_FILE, 8000);
        boolean ok = after != null && fp != null && after.trim().equals(fp);
        if (ok) {
            try {
                prefs(ctx).edit().putString(KEY_HOSTED_STAMP, fp).apply();
            } catch (Throwable ignored) {}
            Log.i(TAG, "[b67] hosted staged fp=" + fp + (out == null ? "" : " · " + out.trim()));
        } else {
            Log.w(TAG, "[b67] staging failed (stamp=" + String.valueOf(after) + ")");
        }
        return ok;
    }

    // =====================================================================================
    // 脚本与 env（App 写共享目录 再同步进 HOSTED_DIR）
    // =====================================================================================

    /** 三个脚本一次性写到共享目录（幂等覆盖，保证与 APK 同步）。 */
    static void writeScripts(Context ctx) {
        File dir = stagingDir(ctx);
        writeTextQuiet(new File(dir, STAGE_SCRIPT_NAME), stageScriptText());
        writeTextQuiet(new File(dir, START_SCRIPT_NAME), startScriptText());
        writeTextQuiet(new File(dir, WATCHDOG_SCRIPT_NAME), watchdogScriptText());
        writeTextQuiet(new File(dir, RESOLVER_PATCH_SCRIPT_NAME), resolverPatchScriptText());
    }

    /** 批次78：看护脚本内容指纹（变了要重启看护进程，否则改动不生效）。 */
    private static final String WATCHDOG_SCRIPT_FP_KEY = "watchdog_script_fp";

    /** 把脚本同步进 HOSTED_DIR：watchdog 必须能用 HOSTED_DIR 内的副本自愈，不依赖 /sdcard 在挂。 */
    static boolean syncScriptsToHostedDir(Context ctx) {
        // 批次78：看护脚本内容指纹 —— 变了就必须弹掉正在跑的看护进程（见下方 wdChanged 分支）
        String wdFp = Integer.toHexString(watchdogScriptText().hashCode());
        SharedPreferences sp = ctx.getSharedPreferences("dsh_prefs", Context.MODE_PRIVATE);
        boolean wdChanged = !wdFp.equals(sp.getString(WATCHDOG_SCRIPT_FP_KEY, ""));
        // 先按当前 APK 重写共享目录里的脚本：收养路径（引擎已在线）不会走 startEngine，
        // 若不在这里刷新，/data/local/tmp 里就会一直沿用旧版本脚本（真机实测踩到）。
        writeScripts(ctx);
        String src = stagingDir(ctx).getAbsolutePath();
        String cmd = "mkdir -p " + HOSTED_DIR + "/logs " + HOSTED_DIR + "/tmp " + HOSTED_DIR + "/etc"
                + " && cp -f " + q(src + "/" + STAGE_SCRIPT_NAME) + " " + q(src + "/" + START_SCRIPT_NAME)
                + " " + q(src + "/" + WATCHDOG_SCRIPT_NAME) + " " + q(src + "/" + RESOLVER_PATCH_SCRIPT_NAME)
                + " " + q(src + "/" + HOSTED_RESOLV_NAME) + " " + q(HOSTED_DIR + "/")
                + " && chmod 755 " + q(HOSTED_DIR + "/" + STAGE_SCRIPT_NAME)
                + " " + q(HOSTED_DIR + "/" + START_SCRIPT_NAME)
                + " " + q(HOSTED_DIR + "/" + WATCHDOG_SCRIPT_NAME)
                + " && chmod 644 " + q(HOSTED_DIR + "/" + HOSTED_RESOLV_NAME)
                + " && echo ok";
        boolean ok = runHost(cmd, 30000) != null;
        if (ok && wdChanged) {
            // 批次78：看护脚本内容变了 → 必须弹掉正在跑的看护进程。
            // 原因：旧的 sh 已经把 while 循环解析进内存，改文件不会生效；
            // 这样「升级 APK 即修复生效」，不必等设备重启。
            String bounce = "P=$(cat " + WATCHDOG_PID_FILE + " 2>/dev/null); "
                    + "if [ -n \"$P\" ]; then kill \"$P\" 2>/dev/null; fi; "
                    + "rm -rf " + HOSTED_DIR + "/watchdog.lock; echo bounced";
            boolean bounced = runHost(bounce, 15000) != null;
            Log.i(TAG, "[b78] watchdog script changed (" + wdFp + ") → bounce=" + bounced);
            if (bounced) {
                sp.edit().putString(WATCHDOG_SCRIPT_FP_KEY, wdFp).apply();
                startWatchdog(ctx);
            }
        }
        return ok;
    }

    /** 写 engine.env（含 token）：先写共享临时文件，再由 shell 搬进 HOSTED_DIR 并 chmod 600。 */
    static boolean writeEngineEnv(Context ctx, File payload) {
        File tmp = new File(stagingDir(ctx), "engine.env.tmp");
        try {
            writeText(tmp, envFileText(ctx, payload));
            tmp.setReadable(true, false);
        } catch (Throwable t) {
            Log.w(TAG, "write engine.env failed", t);
            return false;
        }
        String cmd = "cp -f " + q(tmp.getAbsolutePath()) + " " + q(ENGINE_ENV_FILE)
                + " && chmod 600 " + q(ENGINE_ENV_FILE) + " && rm -f " + q(tmp.getAbsolutePath())
                + " && echo ok";
        return runHost(cmd, 30000) != null;
    }

    /**
     * engine.env 文本：与 App 内模式（MainActivity.spawnNode 的 env 白名单）逐项等价。
     * 任何一项缺失都会让托管引擎行为与 App 内模式分叉（插件降级、路径找不到、token 校验失败）。
     */
    static String envFileText(Context ctx, File payload) {
        String dir = HOSTED_DIR;
        String home = HOSTED_HOME_DIR;
        StringBuilder sb = new StringBuilder();
        String chNow = activeChannel();
        sb.append("# 批次67/95 托管引擎环境（通道=").append(chNow == null ? "none" : chNow)
                .append("；由 App 写入，chmod 600）\n");
        sb.append("export LD_LIBRARY_PATH=").append(q(dir + "/runtime/lib")).append("\n");
        sb.append("export OPENSSL_CONF=").append(q(dir + "/runtime/etc/openssl.cnf")).append("\n");
        sb.append("export CURL_CA_BUNDLE=").append(q(dir + "/runtime/etc/curl-ca-bundle.crt")).append("\n");
        sb.append("export PATH=").append(q(dir + "/bin:" + dir + "/runtime/bin:/system/bin:/system/xbin:"
                + dir + "/runtime-glibc/bin")).append("\n");
        sb.append("export DSH_RG_PATH=").append(q(dir + "/runtime/bin/rg")).append("\n");
        sb.append("export HOME=").append(q(home)).append("\n");
        sb.append("export DSH_HOME=").append(q(home)).append("\n");
        sb.append("export DSH_ANDROID=").append(q("1")).append("\n");
        sb.append("export TMPDIR=").append(q(dir + "/tmp")).append("\n");
        sb.append("export TERM=").append(q("xterm")).append("\n");
        sb.append("export NODE_COMPILE_CACHE=").append(q(dir + "/node-compile-cache")).append("\n");
        sb.append("export SHIZUKU_APP_ID=").append(q(ctx.getPackageName())).append("\n");
        sb.append("export SHIZUKU_AVAILABLE=").append(q(shizukuReady() ? "1" : "0")).append("\n");
        // 批次95：root 通道托管时引擎本身就是 uid 0 ⇒ ROOT_AVAILABLE=1（插件走 su 分支、注册 chroot 族）；
        // Shizuku 通道保持 0（引擎以 shell 身份跑，特权命令走 /system/bin/sh 直通，与批次67 行为一致）。
        sb.append("export ROOT_AVAILABLE=").append(q(CHANNEL_ROOT.equals(chNow) ? "1" : "0")).append("\n");
        sb.append("export DSH_HOSTED_CHANNEL=").append(q(chNow == null ? "" : chNow)).append("\n");
        sb.append("export DSH_TOOLS_MODULE=").append(q("file://" + dir + "/" + REL_TOOLS_JS)).append("\n");
        sb.append("export APP_NOTIFY_PORT=").append(q(String.valueOf(ENGINE_PORT + 1))).append("\n");
        sb.append("export APP_LOCAL_TOKEN=").append(q(TokenStore.getOrCreate(ctx))).append("\n");
        sb.append("export APP_CONFIRM_DANGEROUS=").append(q("1")).append("\n");
        sb.append("export APP_A11Y_PORT=").append(q(String.valueOf(a11yPort(ctx)))).append("\n");
        sb.append("export DSH_VSCREEN_MODE=").append(q(vscreenEnabled(ctx) ? "1" : "0")).append("\n");
        String ws = workspacePath(ctx);
        if (ws != null && !ws.isEmpty()) {
            sb.append("export DSH_WORKSPACE=").append(q(ws)).append("\n");
        }
        sb.append("export NODE_BIN=").append(q(nodeBin(payload))).append("\n");
        sb.append("export BIN_JS=").append(q(dir + "/" + REL_BIN_JS)).append("\n");
        sb.append("export DSH_HOSTED_DIR=").append(q(dir)).append("\n");
        sb.append("export DSH_HOSTED_HOME=").append(q(home)).append("\n");
        sb.append("export DSH_SHARED_HOME=").append(q(homeDir(ctx).getAbsolutePath())).append("\n");
        return sb.toString();
    }

    /** 与 spawnNode 同口径挑 node：glibc 产物在位且 mode=glibc 用 node.glibc 包装脚本。 */
    static String nodeBin(File payload) {
        String mode = "glibc";
        try {
            if (payload != null) {
                File prefsFile = new File(payload, ".runtime_mode");
                if (prefsFile.isFile()) {
                    String v = readTextQuiet(prefsFile);
                    if (v != null && v.trim().length() > 0) mode = v.trim();
                }
            }
        } catch (Throwable ignored) {}
        if ("glibc".equals(mode)) return HOSTED_DIR + "/runtime/bin/node.glibc";
        return HOSTED_DIR + "/runtime/bin/node";
    }

    private static int a11yPort(Context ctx) {
        try {
            int p = prefs(ctx).getInt("a11y_port", 0);
            if (p > 0) return p;
        } catch (Throwable ignored) {}
        return ENGINE_PORT + 101;
    }

    private static boolean vscreenEnabled(Context ctx) {
        try {
            return ctx.getSharedPreferences("vscreen_prefs", Context.MODE_PRIVATE)
                    .getBoolean("vscreen_mode", true);
        } catch (Throwable t) {
            return true;
        }
    }

    private static String workspacePath(Context ctx) {
        try {
            // 键名必须与 MainActivity.KEY_WORKSPACE 一致（workspace_path）；写错会让托管引擎丢掉工作区
            return prefs(ctx).getString("workspace_path", null);
        } catch (Throwable t) {
            return null;
        }
    }

    // ---------------- 脚本正文（静态纯函数，便于契约测试与审阅） ----------------

    /** HOME_USER_FILES 的空格分隔形式（给 shell 脚本用；不用 String.join 以兼容旧 API）。 */
    private static String homeUserFilesShellList() {
        StringBuilder sb = new StringBuilder();
        for (String f : HOME_USER_FILES) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(f);
        }
        return sb.toString();
    }

    /** stage：解 payload.zip 到 HOSTED_DIR（/sdcard 不能执行，运行文件只能落这里）。 */
    static String stageScriptText() {
        return "#! /system/bin/sh\n"
                + "# 批次67：把共享目录的 payload.zip 解到 " + HOSTED_DIR + "（/sdcard 为 noexec）\n"
                + "DIR=" + HOSTED_DIR + "\n"
                + "ZIP=\"$1\"\n"
                + "FP=\"$2\"\n"
                + "mkdir -p \"$DIR\" \"$DIR/logs\" \"$DIR/tmp\"\n"
                + "rm -rf \"$DIR/runtime\" \"$DIR/runtime-glibc\" \"$DIR/dshroot\" \"$DIR/bin\" "
                + "\"$DIR/rish\"\n"
                + "cd \"$DIR\" || exit 2\n"
                + "unzip -o \"$ZIP\" > \"$DIR/logs/stage.log\" 2>&1 || exit 3\n"
                + "# 种子 home：包内 dshhome（settings/cordis.patch/profiles-web）解到内部 home（symlink 只能落内部）\n"
                + "mkdir -p \"$DIR/home\"\n"
                + "# 批次68：包内种子不得覆盖用户/插件自有文件（旧实现的 cp -rf 会把用户 settings.yaml 冲成包内默认 88 B）\n"
                + "for e in \"$DIR\"/dshhome/* \"$DIR\"/dshhome/.[!.]* \"$DIR\"/dshhome/..?*\n"
                + "do\n"
                + "  [ -e \"$e\" ] || continue\n"
                + "  b=$(basename \"$e\")\n"
                + "  keep=0\n"
                + "  for u in " + homeUserFilesShellList() + "\n"
                + "  do\n"
                + "    if [ \"$b\" = \"$u\" ] && [ -e \"$DIR/home/$b\" ]; then keep=1; fi\n"
                + "  done\n"
                + "  [ \"$keep\" = \"1\" ] && continue\n"
                + "  cp -rf \"$e\" \"$DIR/home/\" 2>/dev/null\n"
                + "done\n"
                + "rm -rf \"$DIR/dshhome\"\n"
                + "# 批次69：把托管 libc 的 resolv.conf 路径从 App 私有目录改写到 shell 可读路径（否则 DNS 全灭）\n"
                + "PATCHNODE=\"$DIR/runtime/bin/node.glibc\"\n"
                + "[ -x \"$PATCHNODE\" ] || PATCHNODE=\"$DIR/runtime/bin/node\"\n"
                + "if [ -f \"$DIR/" + RESOLVER_PATCH_SCRIPT_NAME + "\" ]; then "
                + "LD_LIBRARY_PATH=\"$DIR/runtime-glibc/lib:$DIR/runtime/lib\" \"$PATCHNODE\" "
                + "\"$DIR/" + RESOLVER_PATCH_SCRIPT_NAME + "\" \"$DIR\" 2>&1 | tail -2; fi\n"
                + "chmod -R 755 \"$DIR/runtime\" \"$DIR/runtime-glibc\" \"$DIR/bin\" \"$DIR/dshroot\" 2>/dev/null\n"
                + "chmod 755 \"$DIR/runtime/bin/node\" \"$DIR/runtime/bin/node.glibc\" "
                + "\"$DIR/runtime/bin/rg\" \"$DIR/runtime/bin/curl\" 2>/dev/null\n"
                + "chmod 755 \"$DIR/runtime-glibc/bin/node\" \"$DIR/runtime-glibc/lib/ld.so\" 2>/dev/null\n"
                + "mkdir -p \"$DIR/node-compile-cache\"\n"
                + "echo \"$FP\" > " + STAMP_FILE + "\n"
                + "echo \"staged fp=$FP\"\n";
    }

    /** start：幂等拉起引擎并写 engine.pid（stdout 落文件，不接 App 管道，避免 App 死亡拖死 node）。 */
    static String startScriptText() {
        return "#! /system/bin/sh\n"
                + "# 批次67：托管引擎启动（shell 身份 + setsid 脱离 App 进程树）\n"
                + "DIR=" + HOSTED_DIR + "\n"
                + "ENVF=" + ENGINE_ENV_FILE + "\n"
                + "PIDF=" + ENGINE_PID_FILE + "\n"
                + "LOG=" + ENGINE_LOG_FILE + "\n"
                + "[ -f \"$ENVF\" ] || { echo \"engine.env missing\"; exit 2; }\n"
                + "mkdir -p \"$DIR/logs\" \"$DIR/tmp\" \"$DIR/etc\"\n"
                + "P=$(cat \"$PIDF\" 2>/dev/null)\n"
                + "[ -n \"$P\" ] || P=0\n"
                + ". \"$ENVF\"\n"
                + "# 批次69：单实例启动锁 —— App 与看护会同时拉起（都过了「未运行」检查），两个 node 抢 3080\n"
                + "# 时输的那个 EADDRINUSE 崩掉，还可能把 App 的 token 交换引到败者的日志行上。\n"
                + "LOCK=\"$DIR/start.lock\"\n"
                + "if ! mkdir \"$LOCK\" 2>/dev/null; then\n"
                + "  L=$(cat \"$LOCK/pid\" 2>/dev/null)\n"
                + "  if [ -n \"$L\" ] && kill -0 \"$L\" 2>/dev/null; then echo \"start already in progress pid=$L\"; exit 0; fi\n"
                + "  rm -rf \"$LOCK\"\n"
                + "  mkdir \"$LOCK\" 2>/dev/null || exit 0\n"
                + "fi\n"
                + "echo $$ > \"$LOCK/pid\"\n"
                + "trap 'rm -rf \"$LOCK\"' EXIT INT TERM\n"
                + "# 用户数据落共享目录（App 与 shell 共见、可备份）：sessions/attachments/storages 用 symlink\n"
                + "SH=\"$DSH_SHARED_HOME\"\n"
                + "[ -n \"$SH\" ] || SH=/sdcard/DeepSeekHarness/home\n"
                + "mkdir -p \"$SH\" \"$DIR/home\" \"$SH/sessions\" \"$SH/attachments\" \"$SH/storages\"\n"
                + "# 批次68：home 根目录普通文件双向搬运（同则不动；一边缺失或对边更新才复制，覆盖前先存 .bak-<ts>）\n"
                + "# 必须有它：托管 home 与共享 home 目录不共享，插件自有状态（如 dsh-agy 的 agy-accounts.json）\n"
                + "# 不跟着走，就会出现「模型突然没账号 / 模型列表空了」。目录不参与（profiles/web 由种子管，\n"
                + "# sessions/attachments/storages 走下面的 symlink，profiles/node_modules 里是 symlink 只能是内部）。\n"
                + "carry()\n"
                + "{\n"
                + "  SRC=\"$1\"\n"
                + "  DST=\"$2\"\n"
                + "  for f in \"$SRC\"/* \"$SRC\"/.[!.]* \"$SRC\"/..?*\n"
                + "  do\n"
                + "    [ -f \"$f\" ] || continue\n"
                + "    b=$(basename \"$f\")\n"
                + "    case \"$b\" in *.bak-*|.migrated-*) continue;; esac\n"
                + "    if [ ! -e \"$DST/$b\" ]; then cp -f \"$f\" \"$DST/$b\" 2>/dev/null\n"
                + "    elif [ \"$f\" -nt \"$DST/$b\" ] && ! cmp -s \"$f\" \"$DST/$b\"; then\n"
                + "      cp -f \"$DST/$b\" \"$DST/$b.bak-$(date +%s)\" 2>/dev/null\n"
                + "      cp -f \"$f\" \"$DST/$b\" 2>/dev/null\n"
                + "    fi\n"
                + "  done\n"
                + "}\n"
                + "# ① 共享 → 内部（补缺 / mtime 新者胜）：把 App 侧可见的最新配置带进引擎 home\n"
                + "carry \"$SH\" \"$DIR/home\"\n"
                + "for d in sessions attachments storages\n"
                + "do\n"
                + "  T=\"$DIR/home/$d\"\n"
                + "  if [ -L \"$T\" ]; then continue; fi\n"
                + "  if [ -d \"$T\" ]; then\n"
                + "    N=$(ls -A \"$T\" | wc -l)\n"
                + "    if [ \"$N\" != \"0\" ]; then continue; fi\n"
                + "    rmdir \"$T\" 2>/dev/null\n"
                + "  fi\n"
                + "  ln -s \"$SH/$d\" \"$T\" 2>/dev/null\n"
                + "done\n"
                + "# 凭证类文件必须 owner-only（dsh-credentials-local 会 assertOwnerOnly；共享目录是 660，必须收紧内部副本）\n"
                + "chmod 600 \"$DIR/home/.credentials.yaml\" 2>/dev/null\n"
                + "chmod 600 \"$DIR/home/agy-master-key.json\" 2>/dev/null\n"
                + "chmod 600 \"$DIR/home/agy-accounts.json\" 2>/dev/null\n"
                + "for b in \"$DIR/home/\".credentials.yaml.bak-*\n"
                + "do\n"
                + "  if [ -f \"$b\" ]; then chmod 600 \"$b\"; fi\n"
                + "done\n"
                + "# 批次69：托管 DNS —— libc 被补丁写死读 App 私有 resolv.conf（shell 读不到）→ 改写路径 + 刷新内容\n"
                + "if grep -aq \"" + RESOLV_PATH_APP_PRIVATE + "\" \"$DIR/runtime-glibc/lib/libc.so.6\" 2>/dev/null; then\n"
                + "  PATCHNODE=\"$DIR/runtime/bin/node.glibc\"; [ -x \"$PATCHNODE\" ] || PATCHNODE=\"$DIR/runtime/bin/node\"\n"
                + "  LD_LIBRARY_PATH=\"$DIR/runtime-glibc/lib:$DIR/runtime/lib\" \"$PATCHNODE\" "
                + "\"$DIR/" + RESOLVER_PATCH_SCRIPT_NAME + "\" \"$DIR\" >> \"$LOG\" 2>&1\n"
                + "fi\n"
                + "if [ -f \"$DIR/" + HOSTED_RESOLV_NAME + "\" ]; then cp -f \"$DIR/" + HOSTED_RESOLV_NAME + "\" \"$DIR/etc/r.conf\"\n"
                + "else\n"
                + "  { echo \"# generated by start-engine.sh (fallback)\"; dumpsys connectivity 2>/dev/null "
                + "| grep -o \"DnsAddresses.*\" | grep -oE \"[0-9]{1,3}(\\.[0-9]{1,3}){3}\" | head -2 "
                + "| sed \"s/^/nameserver /\"; } > \"$DIR/etc/r.conf\"\n"
                + "fi\n"
                + "grep -q \"^nameserver\" \"$DIR/etc/r.conf\" || printf \"nameserver 223.5.5.5\\nnameserver 119.29.29.29\\n\" >> \"$DIR/etc/r.conf\"\n"
                + "chmod 644 \"$DIR/etc/r.conf\"\n"                + "# 引擎已在跑：上面的 ① 已把共享侧新配置带进来，这里只做 ② 回镜像、不重启\n"
                + "if [ \"$P\" != \"0\" ] && kill -0 \"$P\" 2>/dev/null && "
                + "grep -q '0100007F:0C08.*0A' /proc/net/tcp; then carry \"$DIR/home\" \"$SH\"; echo \"already running pid=$P\"; exit 0; fi\n"
                + "if [ -f \"$DIR/" + RISH_DEX_REL + "\" ]; then export SHIZUKU_DEX=\"$DIR/"
                + RISH_DEX_REL + "\"; else export SHIZUKU_DEX=\"\"; fi\n"
                + "cd \"$DIR\" || exit 2\n"
                + "echo \"===== [hosted] $(date) start =====\" >> \"$LOG\"\n"
                + "setsid nohup \"$NODE_BIN\" --expose-internals \"$BIN_JS\" web --no-open "
                + "--host 127.0.0.1 --port " + ENGINE_PORT + " >> \"$LOG\" 2>&1 &\n"
                + "echo $! > \"$PIDF\"\n"
                + "# 批次69：等 3080 就绪再放锁 —— 否则第二个实例会在「已拉起但还没 LISTEN」的窗口里再起一个 node\n"
                + "i=0\n"
                + "while [ $i -lt 40 ]; do\n"
                + "  grep -q '0100007F:0C08.*0A' /proc/net/tcp && break\n"
                + "  i=$((i+1))\n"
                + "  sleep 0.5\n"
                + "done\n"
                + "# ② 内部 → 共享（回镜像）：用户在托管侧改的模型/提供方设置要 App 侧可见、可备份；内容相同不动\n"
                + "carry \"$DIR/home\" \"$SH\"\n"
                + "echo \"started pid=$(cat $PIDF)\"\n";
    }

    /** watchdog：45s 一轮探活，挂了就自愈（冷却 60s / 最多 3 次 / 稳定 120s 复位预算）。 */
    static String watchdogScriptText() {
        return "#! /system/bin/sh\n"
                + "# 批次67：托管引擎看护（shell 身份常驻；App 被杀/被覆盖安装也继续看护）\n"
                + "DIR=" + HOSTED_DIR + "\n"
                + "PIDF=" + ENGINE_PID_FILE + "\n"
                + "WATCH=" + WATCHDOG_PID_FILE + "\n"
                + "STATE=" + WATCHDOG_STATE_FILE + "\n"
                + "LOG=" + WATCHDOG_LOG_FILE + "\n"
                + "INTERVAL=" + WATCHDOG_INTERVAL_SEC + "\n"
                + "IDLE_INTERVAL=" + WATCHDOG_INTERVAL_IDLE_SEC + "\n"
                + "COOLDOWN=" + WATCHDOG_COOLDOWN_SEC + "\n"
                + "MAXATT=" + WATCHDOG_MAX_ATTEMPTS + "\n"
                + "STABLE=" + WATCHDOG_STABLE_SEC + "\n"
                + "mkdir -p \"$DIR/logs\"\n"
                + "# 单实例：mkdir 原子锁（用 pgrep 计数会把启动用的 sh -c 包装串也算进来，实测误判）\n"
                + "LOCK=\"$DIR/watchdog.lock\"\n"
                + "if ! mkdir \"$LOCK\" 2>/dev/null; then\n"
                + "  L=$(cat \"$LOCK/pid\" 2>/dev/null)\n"
                + "  if [ -n \"$L\" ] && kill -0 \"$L\" 2>/dev/null; then\n"
                + "    echo \"watchdog already running pid=$L\" >> \"$LOG\"\n"
                + "    exit 0\n"
                + "  fi\n"
                + "  rm -rf \"$LOCK\"\n"
                + "  mkdir \"$LOCK\" 2>/dev/null || exit 0\n"
                + "fi\n"
                + "echo $$ > \"$LOCK/pid\"\n"
                + "echo $$ > \"$WATCH\"\n"
                + "ATT=0\n"
                + "LAST=0\n"
                + "OKRUN=0\n"
                + "while true; do\n"
                + "  P=$(cat \"$PIDF\" 2>/dev/null)\n"
                + "  [ -n \"$P\" ] || P=0\n"
                + "  ALIVE=0\n"
                + "  if [ \"$P\" != \"0\" ] && kill -0 \"$P\" 2>/dev/null; then ALIVE=1; fi\n"
                + "  LISTEN=$(grep -c '0100007F:0C08.*0A' /proc/net/tcp 2>/dev/null)\n"
                + "  [ -n \"$LISTEN\" ] || LISTEN=0\n"
                + "  # 批次78：3080 必须真由 engine.pid 持有 —— 旧判据只看「端口有人听」，\n"
                + "  # App 内引擎占用同一端口时会误判 OK，或白耗重试预算后永久 COOLDOWN（永远拉不回托管引擎）。\n"
                + "  INODE=$(grep '0100007F:0C08.*0A' /proc/net/tcp 2>/dev/null | head -n 1 | awk '{print $10}')\n"
                + "  OWNER=0\n"
                + "  if [ \"$ALIVE\" = \"1\" ] && [ -n \"$INODE\" ] && ls -l \"/proc/$P/fd\" 2>/dev/null | grep -q \"socket:\\[$INODE\\]\"; then OWNER=1; fi\n"
                + "  # 批次70：忙闲两档间隔 —— 3080 上有 ESTABLISHED 连接（前端在用）走 45s，否则 90s\n"
                + "  BUSY_HITS=$(grep -c '0100007F:0C08.* 01 ' /proc/net/tcp 2>/dev/null)\n"
                + "  [ -n \"$BUSY_HITS\" ] || BUSY_HITS=0\n"
                + "  if [ \"$BUSY_HITS\" != \"0\" ]; then\n"
                + "    INTERVAL=" + WATCHDOG_INTERVAL_SEC + "\n"
                + "  else\n"
                + "    INTERVAL=$IDLE_INTERVAL\n"
                + "  fi\n"
                + "  NOW=$(date +%s)\n"
                + "  if [ \"$ALIVE\" = \"1\" ] && [ \"$LISTEN\" != \"0\" ] && [ \"$OWNER\" = \"1\" ]; then\n"
                + "    OKRUN=$((OKRUN + 1))\n"
                + "    if [ \"$OKRUN\" -ge \"$((STABLE / INTERVAL))\" ]; then ATT=0; OKRUN=0; fi\n"
                + "    echo \"ts=$NOW state=OK pid=$P attempts=$ATT interval=$INTERVAL busy=$BUSY_HITS\" > \"$STATE\"\n"
                + "  elif [ \"$LISTEN\" != \"0\" ] && [ \"$OWNER\" = \"0\" ]; then\n"
                + "    # 端口被别的进程占着（典型：App 内引擎）：重启必然 EADDRINUSE → 明确报冲突并复位重试预算\n"
                + "    ATT=0\n"
                + "    OKRUN=0\n"
                + "    echo \"ts=$NOW state=MODE_CONFLICT pid=$P inode=$INODE interval=$INTERVAL\" > \"$STATE\"\n"
                + "    echo \"$(date) mode conflict: 3080 held by another process (engine.pid=$P inode=$INODE)\" >> \"$LOG\"\n"
                + "  else\n"
                + "    OKRUN=0\n"
                + "    if [ \"$ATT\" -lt \"$MAXATT\" ] && [ \"$((NOW - LAST))\" -ge \"$COOLDOWN\" ]; then\n"
                + "      ATT=$((ATT + 1))\n"
                + "      LAST=$NOW\n"
                + "      echo \"ts=$NOW state=RESTART attempt=$ATT interval=$INTERVAL\" > \"$STATE\"\n"
                + "      echo \"$(date) revive attempt=$ATT\" >> \"$LOG\"\n"
                + "      sh \"$DIR/" + START_SCRIPT_NAME + "\" >> \"$LOG\" 2>&1\n"
                + "      NEW=$(cat \"$PIDF\" 2>/dev/null)\n"
                + "      echo \"[b67] hosted watchdog revive ok pid=$NEW\" >> \"$LOG\"\n"
                + "    else\n"
                + "      echo \"ts=$NOW state=COOLDOWN attempts=$ATT interval=$INTERVAL\" > \"$STATE\"\n"
                + "    fi\n"
                + "  fi\n"
                + "  sleep \"$INTERVAL\"\n"
                + "done\n";
    }

    // =====================================================================================
    // 看护
    // =====================================================================================

    /** 幂等拉起看护（已存活不重复起）。 */
    // =====================================================================================
    // 批次78：App 内模式也把用户数据接到共享 home（模式间可见性统一）
    // =====================================================================================

    /** 需要与托管模式共用真源的用户数据目录（symlink 只能落在内部存储，见 HOSTED_HOME_DIR 注释）。 */
    private static final String[] SHARED_DATA_DIRS = { "sessions", "attachments", "storages" };

    /**
     * 批次78：把 App 内引擎 home 的 sessions/attachments/storages 接到共享 home。
     *
     * <p>背景（批次76 核查）：两种模式此前各写各的 home —— 托管模式写共享目录（dsh 页面 / PC 侧可见），
     * App 内模式写 App 私有 home（外部看不到），表现为「有时在 dsh 里找不到刚才的任务」。
     *
     * <p>规则与托管脚本 start-engine.sh 的 symlink 段一致：目录已是指向共享目录的 symlink → 跳过；
     * 是真实目录 → 先把缺的文件补拷到共享目录，再把私有目录改名留存（*.private-bak-&lt;ts&gt;），
     * 最后建 symlink —— 只补缺、不删用户数据。
     */
    public static void linkSharedData(File internalHome, Context ctx) {
        try {
            if (internalHome == null) return;
            File shared = homeDir(ctx);
            if (shared == null) return;
            int linked = 0;
            int carried = 0;
            for (String name : SHARED_DATA_DIRS) {
                File target = new File(shared, name);
                if (!target.isDirectory() && !target.mkdirs()) {
                    Log.w(TAG, "[b78] shared dir not ready: " + target);
                    continue;
                }
                File link = new File(internalHome, name);
                if (isSameSymlink(link, target)) continue;
                if (link.exists()) {
                    carried += copyTreeMissing(link, target, 0);
                    File bak = new File(internalHome,
                            name + ".private-bak-" + (System.currentTimeMillis() / 1000L));
                    if (!link.renameTo(bak)) {
                        Log.w(TAG, "[b78] rename failed: " + link);
                        continue;
                    }
                    Log.i(TAG, "[b78] private dir kept as " + bak.getName());
                }
                try {
                    Os.symlink(target.getAbsolutePath(), link.getAbsolutePath());
                    linked++;
                } catch (Throwable t) {
                    Log.w(TAG, "[b78] symlink failed: " + link + " -> " + target + " (" + t + ")");
                }
            }
            Log.i(TAG, "[b78] shared data link done: linked=" + linked + " carried=" + carried
                    + " internal=" + internalHome.getAbsolutePath() + " shared=" + shared.getAbsolutePath());
        } catch (Throwable t) {
            Log.w(TAG, "[b78] linkSharedData failed", t);
        }
    }

    /** link 是否已经是指向 target 的 symlink（幂等判据）。 */
    private static boolean isSameSymlink(File link, File target) {
        try {
            // readlink 在「不是 symlink」时抛 ErrnoException(EINVAL) —— 这正是我们要的 false 分支
            // （android.jar 的 StructStat 上没有 isSymbolicLink()，不要用）。
            return target.getAbsolutePath().equals(Os.readlink(link.getAbsolutePath()));
        } catch (Throwable t) {
            return false;
        }
    }

    public static boolean startWatchdog(Context ctx) {
        if (activeChannel() == null) return false;
        int existing = remoteWatchdogPid(ctx);
        if (existing > 0) {
            Log.i(TAG, "[b67] watchdog already running pid=" + existing);
            return true;
        }
        syncScriptsToHostedDir(ctx);
        String cmd = "cd " + HOSTED_DIR + " && setsid nohup sh " + q(HOSTED_DIR + "/" + WATCHDOG_SCRIPT_NAME)
                + " >> " + q(WATCHDOG_LOG_FILE) + " 2>&1 & echo started";
        runHost(cmd, 15000);
        long deadline = SystemClock.elapsedRealtime() + 5000;
        while (SystemClock.elapsedRealtime() < deadline) {
            int pid = remoteWatchdogPid(ctx);
            if (pid > 0) {
                Log.i(TAG, "[b67] watchdog started pid=" + pid);
                return true;
            }
            sleep(300);
        }
        Log.w(TAG, "[b67] watchdog start not observed");
        return false;
    }

    public static int remoteWatchdogPid(Context ctx) {
        // 只看 pidfile + 存活 + cmdline 命中：pgrep 会把「启动看护的 sh -c 包装串」也算进来（实测误判）
        String out = runHost("W=$(cat " + WATCHDOG_PID_FILE + " 2>/dev/null); "
                + "if [ -n \"$W\" ] && kill -0 \"$W\" 2>/dev/null && grep -qa watchdog.sh /proc/$W/cmdline 2>/dev/null; "
                + "then echo \"pid=$W\"; else echo \"pid=0\"; fi", 8000);
        return parseKvInt(out, "pid");
    }

    public static int remoteEnginePid(Context ctx) {
        String out = runHost("P=$(cat " + ENGINE_PID_FILE + " 2>/dev/null); "
                + "[ -n \"$P\" ] || P=0; echo \"pid=$P\"", 8000);
        return parseKvInt(out, "pid");
    }

    // =====================================================================================
    // 停止 / 清理
    // =====================================================================================

    /** 停看护 + 杀托管引擎（按 /data/local/tmp/dsh 前缀精确匹配，绝不误杀 App 内进程）。 */
    public static void stopEngine(Context ctx) {
        int pid = remoteEnginePid(ctx);
        // 注意：pgrep -f 会把「执行本命令的 sh -c 自身」也匹配进来（实测自杀 → 收尾不完整），
        // 因此先按 pidfile 精确 kill，再遍历匹配项并跳过 $$ / $PPID。
        String cmd = "D=" + HOSTED_DIR + "; "
                + "kill -9 $(cat " + WATCHDOG_PID_FILE + " 2>/dev/null) 2>/dev/null; "
                + "kill -9 $(cat " + ENGINE_PID_FILE + " 2>/dev/null) 2>/dev/null; "
                + "for p in $(pgrep -f " + q(WATCHDOG_PATTERN) + ") $(pgrep -f " + q(ENGINE_PROC_PATTERN) + "); do "
                + "if [ \"$p\" != \"$$\" ] && [ \"$p\" != \"$PPID\" ]; then kill -9 \"$p\" 2>/dev/null; fi; done; "
                + "rm -f " + ENGINE_PID_FILE + " " + WATCHDOG_PID_FILE
                + "; rm -rf $D/watchdog.lock $D/start.lock; echo done";
        runHost(cmd, 20000);
        Log.i(TAG, "[b67] hosted stop -> engine killed pid=" + pid);
        applyConfirmGate(ctx, false);
    }

    /** 彻底清理托管残留（保留共享目录里的会话数据）。 */
    public static void cleanup(Context ctx) {
        stopEngine(ctx);
        runHost("rm -rf " + HOSTED_DIR + " && echo done", 30000);
        try {
            prefs(ctx).edit().remove(KEY_HOSTED_STAMP).apply();
        } catch (Throwable ignored) {}
        Log.i(TAG, "[b67] hosted cleanup done");
    }

    /** 托管模式强制打开审批门（退出托管还原用户原值）。 */
    static void applyConfirmGate(Context ctx, boolean hosted) {
        try {
            SharedPreferences sp = prefs(ctx);
            if (hosted) {
                if (!sp.contains(KEY_CONFIRM_GATE_BACKUP)) {
                    sp.edit()
                            .putBoolean(KEY_CONFIRM_GATE_BACKUP, sp.getBoolean(KEY_CONFIRM_GATE, false))
                            .putBoolean(KEY_CONFIRM_GATE, true)
                            .apply();
                    Log.i(TAG, "[b67] confirm gate forced on (hosted mode)");
                } else if (!sp.getBoolean(KEY_CONFIRM_GATE, false)) {
                    sp.edit().putBoolean(KEY_CONFIRM_GATE, true).apply();
                }
            } else if (sp.contains(KEY_CONFIRM_GATE_BACKUP)) {
                sp.edit()
                        .putBoolean(KEY_CONFIRM_GATE, sp.getBoolean(KEY_CONFIRM_GATE_BACKUP, false))
                        .remove(KEY_CONFIRM_GATE_BACKUP)
                        .apply();
            }
        } catch (Throwable t) {
            Log.w(TAG, "applyConfirmGate failed", t);
        }
    }

    // =====================================================================================
    // 数据迁移（私有 dshhome 到共享 home；只补缺、不删原目录，可回滚）
    // =====================================================================================

    static void migrateHomeIfNeeded(Context ctx, File payload) {
        if (payload == null) return;
        File dst = homeDir(ctx);
        File marker = new File(dst, ".migrated-from-private");
        if (marker.isFile()) return;
        File src = new File(payload, "dshhome");
        if (!src.isDirectory()) return;
        int copied = copyTreeMissing(src, dst, 0);
        File sessions = new File(src, "sessions");
        if (sessions.isDirectory()) copied += copyTreeMissing(sessions, new File(dst, "sessions"), 0);
        writeTextQuiet(marker, String.valueOf(System.currentTimeMillis()));
        Log.i(TAG, "migrated private dshhome -> " + dst.getAbsolutePath() + " (files=" + copied + ")");
    }

    /**
     * 批次68「修复迁移」：批次67 首次托管 staging 用包内种子覆盖了共享 home 的用户配置
     * （真机实测 settings.yaml 826 B → 88 B），而原迁移标记（.migrated-from-private）已写、不会重跑，
     * 所以这里单独做一次「把私有 home 的用户配置与插件自有状态捞回来」的修复（只执行一次，落 REPAIR_MARKER）：
     * <ul>
     *   <li>私有 home 有、共享 home 缺 → 直接补上（例如 dsh-agy 的 agy-accounts.json）；</li>
     *   <li>两边都有但内容不同，且「共享侧与<b>包内种子</b>逐字节一致」或「私有侧更大」→
     *       备份为 .bak-&lt;ts&gt; 后以私有侧为准（只往更丰富的方向补）；</li>
     *   <li>其余情况一律不动（绝不把更小的旧文件盖回去）。</li>
     * </ul>
     * 复制后把 mtime 抬到当前时间，使 start 脚本「mtime 新者胜」的搬运把它带进托管 home。
     *
     * @return true = 本次真的有文件被修复（调用方需要重启托管引擎让新配置生效）
     */
    static boolean repairPrivateHomeOnce(Context ctx, File payload) {
        File dst = homeDir(ctx);
        File marker = new File(dst, REPAIR_MARKER);
        if (marker.isFile()) return false;
        try {
            File payloadDir = payload != null ? payload : new File(ctx.getFilesDir(), "payload");
            File src = new File(payloadDir, "dshhome");
            if (!src.isDirectory()) {
                writeTextQuiet(marker, "no-private-home");
                return false;
            }
            long ts = System.currentTimeMillis();
            int fixed = 0;
            for (String name : HOME_USER_FILES) {
                File s = new File(src, name);
                if (!s.isFile()) continue;
                File d = new File(dst, name);
                if (!d.isFile()) {
                    if (copyFile(s, d)) {
                        d.setLastModified(System.currentTimeMillis());
                        fixed++;
                    }
                    continue;
                }
                if (sameContent(s, d)) continue;
                boolean seedDerived = isSeedDefault(ctx, name, d);
                // 只往「更丰富」的方向补：① 共享侧是包内种子残骸（＝被批次67 的 staging 覆盖过）；
                // ② 私有侧更大（批次67 之前，私有 home 才是权威副本）。绝不把更小的旧文件盖回去，
                // 因此不会牺牲用户在托管侧新加的配置。
                if (!seedDerived && s.length() <= d.length()) continue;
                copyFile(d, new File(dst, name + ".bak-" + (ts / 1000)));
                if (copyFile(s, d)) {
                    d.setLastModified(System.currentTimeMillis());
                    fixed++;
                }
            }
            writeTextQuiet(marker, String.valueOf(System.currentTimeMillis()));
            if (fixed > 0) {
                Log.i(TAG, "[b68] repaired " + fixed + " user/plugin file(s) from private home -> "
                        + dst.getAbsolutePath());
            }
            return fixed > 0;
        } catch (Throwable t) {
            // 不写标记：下次启动再试（失败多为 IO 抖动，重试成本很低）
            Log.w(TAG, "repairPrivateHomeOnce failed", t);
            return false;
        }
    }

    /**
     * 批次69：DNS 配置文本（托管与 App 内模式共用一套来源）。
     *
     * <p>来源顺序与 App 内模式一致：{@code /system/etc/resolv.conf} → {@code net.dns1} / {@code net.dns2}
     * → {@code dumpsys connectivity} 的 DnsAddresses → 公共 DNS 兜底（223.5.5.5 / 119.29.29.29）。
     * 之所以必须兜底：glibc 没有 resolv.conf 时 getaddrinfo 直接失败，比"错误的 DNS"更糟。</p>
     */
    static String resolvConfText(Context ctx) {
        StringBuilder sb = new StringBuilder("# generated by DeepSeekHarness (DNS for the engine)\n");
        boolean wrote = false;
        File systemResolv = new File("/system/etc/resolv.conf");
        if (systemResolv.isFile()) {
            try {
                java.io.BufferedReader r = new java.io.BufferedReader(
                        new java.io.InputStreamReader(new java.io.FileInputStream(systemResolv), "UTF-8"));
                String line;
                while ((line = r.readLine()) != null) sb.append(line).append('\n');
                r.close();
                wrote = sb.indexOf("nameserver") >= 0;
            } catch (Throwable t) {
                Log.w(TAG, "copy /system/etc/resolv.conf failed", t);
            }
        }
        if (!wrote) {
            String dns1 = runFirstLine("/system/bin/getprop", "net.dns1");
            String dns2 = runFirstLine("/system/bin/getprop", "net.dns2");
            if (dns1.length() > 0) {
                sb.append("nameserver ").append(dns1).append('\n');
                wrote = true;
            }
            if (dns2.length() > 0 && !dns2.equals(dns1)) {
                sb.append("nameserver ").append(dns2).append('\n');
                wrote = true;
            }
        }
        if (!wrote) {
            // 现代 Android 没有 net.dns1/2 也没有 /system/etc/resolv.conf →
            // 从 dumpsys connectivity 的 DnsAddresses 行提取 IPv4。
            try {
                Process p = new ProcessBuilder("/system/bin/dumpsys", "connectivity")
                        .redirectErrorStream(true).start();
                java.io.BufferedReader r = new java.io.BufferedReader(
                        new java.io.InputStreamReader(p.getInputStream(), "UTF-8"));
                java.util.regex.Matcher m = java.util.regex.Pattern
                        .compile("(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})").matcher("");
                java.util.LinkedHashSet<String> ips = new java.util.LinkedHashSet<>();
                String line;
                while ((line = r.readLine()) != null) {
                    if (!line.contains("DnsAddresses")) continue;
                    m.reset(line);
                    while (m.find()) ips.add(m.group(1));
                }
                r.close();
                p.waitFor();
                int appended = 0;
                for (String ip : ips) {
                    sb.append("nameserver ").append(ip).append('\n');
                    wrote = true;
                    if (++appended >= 2) break;
                }
            } catch (Throwable t) {
                Log.w(TAG, "dumpsys connectivity DNS parse failed", t);
            }
        }
        if (!wrote) {
            sb.append("# fallback public DNS (no system DNS source found)\n");
            sb.append("nameserver 223.5.5.5\n");
            sb.append("nameserver 119.29.29.29\n");
        }
        return sb.toString();
    }

    /** 跑一条命令取首行（DNS 探测用；任何异常返回空串）。 */
    private static String runFirstLine(String... argv) {
        try {
            Process p = new ProcessBuilder(argv).redirectErrorStream(true).start();
            java.io.BufferedReader r = new java.io.BufferedReader(
                    new java.io.InputStreamReader(p.getInputStream(), "UTF-8"));
            String line = r.readLine();
            r.close();
            p.waitFor();
            return line == null ? "" : line.trim();
        } catch (Throwable t) {
            return "";
        }
    }

    /**
     * 批次69：把 DNS 配置写到暂存目录（start 脚本负责搬进 {@code $DIR/etc/r.conf}，
     * 也就是托管 libc 被改写后读取的路径）。
     */
    static void writeSharedResolvConf(Context ctx) {
        try {
            File f = new File(stagingDir(ctx), HOSTED_RESOLV_NAME);
            writeText(f, resolvConfText(ctx));
            f.setReadable(true, false);
            Log.i(TAG, "[b69] hosted resolv.conf -> " + f.getAbsolutePath());
        } catch (Throwable t) {
            Log.w(TAG, "writeSharedResolvConf failed", t);
        }
    }

    /**
     * 批次69：改写托管 libc 解析器路径的 node 脚本正文（幂等；找不到旧串则什么都不做）。
     * 为什么用 node：shell 侧只有 toybox（二进制替换不安全），而托管目录里本来就有 node。
     */
    static String resolverPatchScriptText() {
        return "// 批次69：把托管运行时 glibc 的 resolv.conf 路径从 App 私有目录改写到 shell 可读路径。\n"
                + "// 背景：App 私有文件 shell uid=2000 读不到（Permission denied）→ getaddrinfo EAI_AGAIN。\n"
                + "const fs = require('fs');\n"
                + "const DIR = process.argv[2] || '" + HOSTED_DIR + "';\n"
                + "const FROM = '" + RESOLV_PATH_APP_PRIVATE + "';\n"
                + "const TO = '" + RESOLV_PATH_HOSTED + "';\n"
                + "const LIBC = DIR + '/runtime-glibc/lib/libc.so.6';\n"
                + "if (TO.length > FROM.length) { console.log('resolver patch skipped: target path too long'); process.exit(0); }\n"
                + "if (!fs.existsSync(LIBC)) { console.log('resolver patch skipped: libc not found'); process.exit(0); }\n"
                + "const buf = fs.readFileSync(LIBC);\n"
                + "let idx = buf.indexOf(FROM);\n"
                + "let n = 0;\n"
                + "while (idx >= 0) {\n"
                + "  const ins = Buffer.alloc(FROM.length, 0);\n"
                + "  ins.write(TO, 0, 'utf8');\n"
                + "  ins.copy(buf, idx);\n"
                + "  n++;\n"
                + "  idx = buf.indexOf(FROM, idx + FROM.length);\n"
                + "}\n"
                + "if (n > 0) {\n"
                + "  const tmp = LIBC + '.tmp-patch';\n"
                + "  fs.writeFileSync(tmp, buf);\n"
                + "  fs.chmodSync(tmp, 0o755);\n"
                + "  fs.renameSync(tmp, LIBC);\n"
                + "}\n"
                + "console.log('resolver patch: replaced=' + n + ' to=' + TO);\n";
    }

    /** 两个文件内容是否完全一致（分块比较，不整份读进内存）。 */
    private static boolean sameContent(File a, File b) {
        InputStream ia = null;
        InputStream ib = null;
        try {
            if (a.length() != b.length()) return false;
            ia = new java.io.FileInputStream(a);
            ib = new java.io.FileInputStream(b);
            byte[] ba = new byte[1 << 14];
            byte[] bb = new byte[1 << 14];
            while (true) {
                int na = readChunk(ia, ba);
                int nb = readChunk(ib, bb);
                if (na != nb) return false;
                if (na <= 0) return true;
                for (int i = 0; i < na; i++) if (ba[i] != bb[i]) return false;
            }
        } catch (Throwable t) {
            return false;
        } finally {
            closeQuiet(ia);
            closeQuiet(ib);
        }
    }

    /** 尽量读满 buf（不足即 EOF），返回实际读到的字节数。 */
    private static int readChunk(InputStream in, byte[] buf) throws IOException {
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n <= 0) break;
            off += n;
        }
        return off;
    }

    private static void closeQuiet(java.io.Closeable c) {
        if (c == null) return;
        try {
            c.close();
        } catch (Throwable ignored) {}
    }

    /**
     * 目标文件是否与包内 payload.zip 的同名种子文件逐字节一致（缺 payload 的轻壳模式退回共享目录里的
     * payload.zip；两处都取不到 → false，即「保守不修复」）。
     */
    private static boolean isSeedDefault(Context ctx, String name, File target) {
        byte[] seed = null;
        try {
            seed = readZipEntry(ctx.getAssets().open(PAYLOAD_ZIP_NAME), "dshhome/" + name);
        } catch (Throwable ignored) {}
        if (seed == null) {
            InputStream in = null;
            try {
                File fallback = payloadZip(ctx);
                if (fallback.isFile()) in = new java.io.FileInputStream(fallback);
                seed = readZipEntry(in, "dshhome/" + name);
            } catch (Throwable ignored) {
            } finally {
                closeQuiet(in);
            }
        }
        if (seed == null) return false;
        InputStream cur = null;
        try {
            if (target.length() != seed.length) return false;
            cur = new java.io.FileInputStream(target);
            byte[] buf = new byte[seed.length];
            if (readChunk(cur, buf) != seed.length) return false;
            for (int i = 0; i < seed.length; i++) if (buf[i] != seed[i]) return false;
            return true;
        } catch (Throwable t) {
            return false;
        } finally {
            closeQuiet(cur);
        }
    }

    /** 从 zip 流里取出指定条目内容（流为 null 或找不到 → null）。 */
    private static byte[] readZipEntry(InputStream raw, String entryName) {
        if (raw == null) return null;
        java.util.zip.ZipInputStream zin = null;
        try {
            zin = new java.util.zip.ZipInputStream(raw);
            java.util.zip.ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                if (!entryName.equals(e.getName())) continue;
                java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[1 << 14];
                int n;
                while ((n = zin.read(buf)) > 0) bos.write(buf, 0, n);
                return bos.toByteArray();
            }
            return null;
        } catch (Throwable t) {
            return null;
        } finally {
            closeQuiet(zin);
        }
    }

    private static int copyTreeMissing(File src, File dst, int depth) {
        if (depth > 12) return 0;
        int n = 0;
        try {
            if (!dst.exists()) {
                if (!dst.mkdirs()) return 0;
                dst.setReadable(true, false);
                dst.setWritable(true, false);
                dst.setExecutable(true, false);
            }
            File[] kids = src.listFiles();
            if (kids == null) return 0;
            for (File kid : kids) {
                File target = new File(dst, kid.getName());
                if (kid.isDirectory()) {
                    n += copyTreeMissing(kid, target, depth + 1);
                } else if (!target.exists() && copyFile(kid, target)) {
                    n++;
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "copyTreeMissing failed at " + src, t);
        }
        return n;
    }

    private static boolean copyFile(File src, File dst) {
        InputStream in = null;
        OutputStream out = null;
        try {
            in = new java.io.FileInputStream(src);
            out = new FileOutputStream(dst, false);
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
            dst.setReadable(true, false);
            dst.setWritable(true, false);
            return true;
        } catch (Throwable t) {
            return false;
        } finally {
            try { if (in != null) in.close(); } catch (Throwable ignored) {}
            try { if (out != null) out.close(); } catch (Throwable ignored) {}
        }
    }

    // =====================================================================================
    // 握手（token / Cookie）
    // =====================================================================================

    /** 从引擎日志里取一次性鉴权 URL（stdout 不再接 App 管道，只能读文件；token 只进内存）。 */
    static String readAuthUrlFromLog(Context ctx) {
        String tail = runHost("tail -c 262144 " + q(ENGINE_LOG_FILE), 15000);
        if (tail == null) return null;
        int at = tail.lastIndexOf(AUTH_MARKER);
        if (at < 0) return null;
        int start = at + "dsh web: ".length();
        int end = start;
        while (end < tail.length() && !Character.isWhitespace(tail.charAt(end))) end++;
        return tail.substring(start, end);
    }

    /** 一次性 token 换会话 Cookie（与 MainActivity.captureEngineAuthUrl 同款 303 交换）。 */
    static String exchangeCookie(String authUrl) {
        if (authUrl == null) return null;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(authUrl).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(2000);
            c.setReadTimeout(2000);
            c.setRequestProperty("User-Agent", "dsh-probe");
            int code = c.getResponseCode();
            String setCookie = c.getHeaderField("Set-Cookie");
            if (code == 303 && setCookie != null) {
                int semi = setCookie.indexOf(';');
                return semi >= 0 ? setCookie.substring(0, semi) : setCookie;
            }
        } catch (Throwable t) {
            Log.w(TAG, "cookie exchange failed", t);
        } finally {
            if (c != null) c.disconnect();
        }
        return null;
    }

    // =====================================================================================
    // 状态（自检面板用）
    // =====================================================================================

    /** 托管引擎状态快照（一次 shell 往返取全，避免多次往返拖慢卡片刷新）。 */
    public static final class Status {
        public boolean shizuku;
        public boolean wanted;
        public boolean hosted;
        /** 批次95：当前托管通道（"root" / "shizuku" / ""=无通道）。 */
        public String channel = "";
        public int enginePid;
        public int watchdogPid;
        public boolean portListening;
        public String stamp = "";
        public String watchdogState = "";
        public String engineUid = "";
        public String error = "";

        public String summary() {
            if (enginePid <= 0 && !portListening) return hosted ? "托管引擎未运行" : "引擎未运行";
            if (hosted) {
                return "托管引擎(" + (CHANNEL_ROOT.equals(channel) ? "root" : "shell") + ") uid="
                        + (engineUid.isEmpty() ? (CHANNEL_ROOT.equals(channel) ? "0" : "shell") : engineUid)
                        + " pid=" + enginePid
                        + (watchdogPid > 0 ? " · 看护 pid=" + watchdogPid : " · 无看护");
            }
            return "App 内引擎 pid=" + enginePid;
        }
    }

    public static Status probe(Context ctx) {
        Status s = new Status();
        s.wanted = hostedWanted(ctx);
        s.shizuku = shizukuReady();
        String ch = activeChannel();
        s.channel = ch == null ? "" : ch;
        if (ch == null) {
            s.error = shizukuBinderAlive()
                    ? "未检测到 root（su 不可用），且 Shizuku 未授权"
                    : "未检测到 root（su 不可用），且 Shizuku 未运行（重启后需重新激活）";
            s.portListening = engineOnline(ctx, 600, 900);
            return s;
        }
        String out = runHost("D=" + HOSTED_DIR + "; P=$(cat $D/engine.pid 2>/dev/null); "
                + "W=$(pgrep -f " + q(WATCHDOG_PATTERN) + " | head -n 1); "
                + "L=$(grep -c '0100007F:0C08.*0A' /proc/net/tcp 2>/dev/null); "
                + "U=$(awk 'NR==1{print $1}' /proc/$(cat $D/engine.pid 2>/dev/null)/status 2>/dev/null); "
                + "[ -n \"$P\" ] || P=0; [ -n \"$W\" ] || W=0; [ -n \"$L\" ] || L=0; "
                + "echo \"pid=$P watchdog=$W listen=$L uid=$U "
                + "stamp=$(cat $D/.stamp 2>/dev/null) state=$(cat $D/watchdog.state 2>/dev/null)\"", 12000);
        if (out != null) {
            s.enginePid = parseKvInt(out, "pid");
            s.watchdogPid = parseKvInt(out, "watchdog");
            s.portListening = parseKvInt(out, "listen") > 0;
            s.stamp = parseKvValue(out, "stamp");
            s.watchdogState = parseKvValue(out, "state");
            s.engineUid = parseKvValue(out, "uid");
        }
        s.hosted = hostedUsable(ctx) && (s.enginePid > 0 || s.portListening);
        if (!s.hosted) s.error = s.wanted ? "尚未启用托管" : "用户已关闭托管";
        return s;
    }

    /** 一行状态文本（卡片/悬浮窗直接用）。 */
    public static String statusLine(Context ctx) {
        Status s = probe(ctx);
        String line = s.summary();
        if (s.channel.length() == 0) line = line + " · " + s.error;
        return line;
    }

    // =====================================================================================
    // 工具
    // =====================================================================================

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** shell 单引号包裹（输入均为内部路径/token；含单引号时剥离，避免命令注入）。 */
    static String q(String s) {
        if (s == null) return "''";
        return "'" + s.replace("'", "") + "'";
    }

    /** [通道内部] 经 Shizuku 执行命令并抓 stdout（失败/超时返回 null）；对外一律用 runHost。 */
    private static String shizukuRunDirect(String cmd, long timeoutMs) {
        IShizukuService svc = shizukuService();
        if (svc == null) return null;
        Process p = null;
        try {
            IRemoteProcess rp = svc.newProcess(new String[]{"sh", "-c", cmd}, null, null);
            p = new ShizukuProcessAdapter(rp);
            final Process proc = p;
            final StringBuilder sb = new StringBuilder();
            Thread reader = new Thread(new Runnable() {
                @Override public void run() {
                    BufferedReader br = null;
                    try {
                        br = new BufferedReader(new InputStreamReader(proc.getInputStream(), "UTF-8"));
                        String line;
                        while ((line = br.readLine()) != null) {
                            if (sb.length() < 65536) sb.append(line).append('\n');
                        }
                    } catch (Throwable ignored) {
                    } finally {
                        try { if (br != null) br.close(); } catch (Throwable ignored) {}
                    }
                }
            }, "hosted-sh-read");
            reader.setDaemon(true);
            reader.start();
            reader.join(timeoutMs);
            int rc;
            try {
                rc = proc.exitValue();
            } catch (Throwable t) {
                rc = 0;
            }
            String out = sb.toString();
            if (rc != 0 && out.trim().isEmpty()) return null;
            return out;
        } catch (Throwable t) {
            Log.w(TAG, "shizukuRun failed: " + cmd, t);
            return null;
        } finally {
            try { if (p != null) p.destroy(); } catch (Throwable ignored) {}
        }
    }

    /**
     * 批次95：走「当前托管通道」执行一条命令 —— root 优先（`su -c`）/ Shizuku 兜底（app_process rish）。
     *
     * <p>契约与旧 shizukuRun 完全一致：返回 stdout 文本；失败/超时返回 null（调用方以 null 判失败）。</p>
     */
    static String runHost(String cmd, long timeoutMs) {
        String ch = activeChannel();
        if (CHANNEL_ROOT.equals(ch)) return rootRun(cmd, timeoutMs);
        if (CHANNEL_SHIZUKU.equals(ch)) return shizukuRunDirect(cmd, timeoutMs);
        Log.w(TAG, "[b95] no host channel available for: " + cmd);
        return null;
    }

    /**
     * 批次95：以 root 执行一条命令（`su -c <cmd>`）并抓 stdout；失败/超时返回 null。
     *
     * <p>与 VscreensManager 的 root 通道同构（`Runtime.exec({"su","-c",cmd})`）：KernelSU / Magisk
     * allowlist 已授权本 App 时静默放行；未授权时 su 会等弹窗而阻塞，由调用方传入的 timeout 兜底
     * （读线程 join 超时 → destroy 子进程 → 返回 null ⇒ 调用方判失败并回退）。</p>
     */
    static String rootRun(String cmd, long timeoutMs) {
        Process p = null;
        try {
            p = Runtime.getRuntime().exec(new String[]{"su", "-c", cmd});
            final Process proc = p;
            final StringBuilder sb = new StringBuilder();
            Thread reader = new Thread(new Runnable() {
                @Override public void run() {
                    BufferedReader br = null;
                    try {
                        br = new BufferedReader(new InputStreamReader(proc.getInputStream(), "UTF-8"));
                        String line;
                        while ((line = br.readLine()) != null) {
                            if (sb.length() < 65536) sb.append(line).append('\n');
                        }
                    } catch (Throwable ignored) {
                    } finally {
                        try { if (br != null) br.close(); } catch (Throwable ignored) {}
                    }
                }
            }, "hosted-root-read");
            reader.setDaemon(true);
            reader.start();
            reader.join(timeoutMs);
            int rc;
            try {
                rc = proc.exitValue();
            } catch (Throwable t) {
                rc = 0;
            }
            String out = sb.toString();
            if (rc != 0 && out.trim().isEmpty()) return null;
            return out;
        } catch (Throwable t) {
            Log.w(TAG, "[b95] rootRun failed: " + cmd, t);
            return null;
        } finally {
            try { if (p != null) p.destroy(); } catch (Throwable ignored) {}
        }
    }

    private static IShizukuService shizukuService() {
        try {
            return IShizukuService.Stub.asInterface(new ShizukuBinderWrapper(Shizuku.getBinder()));
        } catch (Throwable t) {
            return null;
        }
    }

    static int parseKvInt(String text, String key) {
        try {
            return (int) Long.parseLong(parseKvValue(text, key));
        } catch (Throwable t) {
            return 0;
        }
    }

    static String parseKvValue(String text, String key) {
        if (text == null) return "";
        String[] toks = text.split("[ \t\n\r]+");
        for (int i = 0; i < toks.length; i++) {
            int eq = toks[i].indexOf('=');
            if (eq <= 0) continue;
            if (toks[i].substring(0, eq).equals(key)) return toks[i].substring(eq + 1);
        }
        return "";
    }

    /** 日志脱敏：token 只进内存，任何落盘/打印前都过这一层。 */
    static String redactToken(String s) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder();
        int at = 0;
        while (true) {
            int i = s.indexOf("token=", at);
            if (i < 0) {
                out.append(s.substring(at));
                break;
            }
            out.append(s, at, i).append("token=[redacted]");
            int j = i + "token=".length();
            while (j < s.length()) {
                char ch = s.charAt(j);
                if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == '&' || ch == '"') break;
                j++;
            }
            at = j;
        }
        return out.toString();
    }

    private static String readAll(InputStream in, int cap) throws IOException {
        try {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            int total = 0;
            while ((n = in.read(buf)) > 0 && total < cap) {
                bos.write(buf, 0, n);
                total += n;
            }
            return bos.toString("UTF-8");
        } finally {
            try { in.close(); } catch (Throwable ignored) {}
        }
    }

    private static void writeText(File f, String text) throws IOException {
        OutputStream out = null;
        try {
            out = new FileOutputStream(f, false);
            out.write(text.getBytes("UTF-8"));
            out.flush();
        } finally {
            try { if (out != null) out.close(); } catch (Throwable ignored) {}
        }
    }

    private static void writeTextQuiet(File f, String text) {
        try {
            File parent = f.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            writeText(f, text);
        } catch (Throwable t) {
            Log.w(TAG, "writeTextQuiet failed: " + f, t);
        }
    }

    private static String readTextQuiet(File f) {
        try {
            if (!f.isFile()) return null;
            return readAll(new java.io.FileInputStream(f), 1 << 20);
        } catch (Throwable t) {
            return null;
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    /** IRemoteProcess 转 java.lang.Process（AAR 自带实现的构造器是包私有，这里同构自包）。 */
    private static final class ShizukuProcessAdapter extends Process {
        private final IRemoteProcess rp;

        ShizukuProcessAdapter(IRemoteProcess rp) { this.rp = rp; }

        @Override public OutputStream getOutputStream() {
            try {
                return new android.os.ParcelFileDescriptor.AutoCloseOutputStream(rp.getOutputStream());
            } catch (Throwable t) { throw new RuntimeException(t); }
        }

        @Override public InputStream getInputStream() {
            try {
                return new android.os.ParcelFileDescriptor.AutoCloseInputStream(rp.getInputStream());
            } catch (Throwable t) { throw new RuntimeException(t); }
        }

        @Override public InputStream getErrorStream() {
            try {
                return new android.os.ParcelFileDescriptor.AutoCloseInputStream(rp.getErrorStream());
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
                throw new IllegalThreadStateException();
            }
        }

        @Override public void destroy() {
            try { rp.destroy(); } catch (Throwable ignored) {}
        }
    }
}
