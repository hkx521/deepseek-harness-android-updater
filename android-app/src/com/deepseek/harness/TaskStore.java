package com.deepseek.harness;

import android.content.Context;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 批次 23 S1（设计文档 D1/D5）：App 侧任务注册表（Task DB）。
 *
 * <p><b>存储</b>：单 JSON 文件 {@code filesDir/tasks/tasks.json}（D1 判据①③：跨引擎重启存活、
 * 低频生命周期写）。TaskStore 独占写，<b>原子替换</b>——先写同目录 {@code tasks.json.dsh-tmp}
 * 再 rename(2)，与仓内 extractPayload 的 .dsh-tmp 模式（批次15 T3）同款：最终路径要么是旧完整
 * 文件、要么是新完整文件。读时容错：解析失败 → 把损坏文件备份为 {@code tasks.json.corrupt-&lt;ts&gt;}
 * 后以空表重建（Log.w），不抛异常打断本地桥。</p>
 *
 * <p><b>数据模型</b>（D1/D3/D6，S1 注册表能力；输出流不入库，仅指针引用）：
 * {@code id}（主键）、{@code kind}（MVP 仅 chroot-job，D2）、{@code state}
 * （D6 五态 RUNNING/COMPLETED/FAILED/CANCELLED/INTERRUPTED + S1 过渡态 STALE）、
 * {@code createdAt/updatedAt}、{@code job_id}（与设备 .jobs 执行句柄层关联）、
 * {@code command_b64}（S2 resume 重跑依据）、{@code out/err}（输出指针）、
 * {@code ckpt}（S3，checkpoint 文件指针——自愿续跑协议，App 只透传路径、不解析内容）、
 * {@code exit_code/finishedAt}（终态捕获 S2 落）、{@code resumed_from}（S2）、
 * {@code pgid}（S2，进程组——Reaper kill -0 收养对账的判活句柄）、
 * {@code session_dir}（S2，设备 .jobs 目录指针）、
 * {@code staleAfterMs}（可选，每任务覆盖 STALE 阈值）。</p>
 *
 * <p><b>wakelock 归属</b>（D5）：jobWakeLock 单实例归 TaskStore（PARTIAL_WAKE_LOCK、tag
 * {@code dsh:chroot-job} 与既有 /wakelock 路由一致、non-reference-counted、单次 acquire clamp
 * 30min 复用 handleWakelockRequest 的上限语义）。<b>仅 activeTasks&gt;0 时持有</b>——本片先落
 * API 与持有逻辑（{@link #applyKeepAlive}），chroot 启动/结束的调用方接线在 S2；TaskReaper 的
 * 30s tick 按 {@link KeepAlivePolicy} 决策驱动。/wakelock 路由保留兼容但 deprecated（D5）。
 * 注：既有 /wakelock 路由在 MainActivity 里另有独立 WakeLock 实例，全仓无调用方（调查发现 1），
 * S1 两者并存无实际冲突；S2 可把该路由改为委托本类，彻底单实例。</p>
 *
 * <p><b>线程模型</b>：所有公开方法 synchronized（调用方为 3081 local-conn 线程与 TaskReaper
 * 线程）；文件 I/O 在锁内——注册表写频率极低（仅生命周期迁移，D1 判据③），不构成热点。</p>
 */
public final class TaskStore {

    private static final String TAG = "TaskStore";

    // ==== D6 状态机：五态 + S1 过渡态 ====
    public static final String STATE_RUNNING = "RUNNING";
    public static final String STATE_COMPLETED = "COMPLETED";
    public static final String STATE_FAILED = "FAILED";
    public static final String STATE_CANCELLED = "CANCELLED";
    public static final String STATE_INTERRUPTED = "INTERRUPTED"; // 设备重启等无 rc 场景（D6，S2 list 对账落）
    /** S1 过渡态（批次23 S1 指令）：超时未上报的 RUNNING 由 TaskReaper 标记；S2 换 rc/done 终态迁移。 */
    public static final String STATE_STALE = "STALE";

    private static final String[] KNOWN_STATES = {
            STATE_RUNNING, STATE_COMPLETED, STATE_FAILED, STATE_CANCELLED, STATE_INTERRUPTED, STATE_STALE
    };

    /** 存储文件（filesDir/tasks/tasks.json，D1）。 */
    private final File mStoreFile;
    /** App context（单例持有，不泄漏 Activity）。 */
    private final Context mAppContext;
    /** 内存注册表：id → task 对象。LinkedHashMap 保持插入序，序列化顺序稳定（diff 友好）。 */
    private final LinkedHashMap<String, JSONObject> mTasks = new LinkedHashMap<String, JSONObject>();

    // ==== wakelook 独占（D5）+ 策略簿记（KeepAlivePolicy 的输入由这里实测供给）====
    private static final String WAKELOCK_TAG = "dsh:chroot-job"; // 与既有 /wakelock 路由同 tag
    private static final long WAKELOCK_MAX_MS = 30 * 60 * 1000L; // 复用 handleWakelockRequest clamp 上限（D5）
    private PowerManager.WakeLock mJobWakeLock;
    private long mLastRenewAtMs = 0L;      // 上次 acquire/续期时刻；0=未知（App 重启后）
    private long mLastTransitionAtMs = 0L; // 上次 hold↔release 翻转时刻；0=从未翻转

    // ==== 单例 ====
    private static volatile TaskStore sInstance;

    /** 单例入口（appContext 用 applicationContext，避免持有 Activity）。 */
    public static TaskStore get(Context ctx) {
        if (sInstance == null) {
            synchronized (TaskStore.class) {
                if (sInstance == null) {
                    sInstance = new TaskStore(ctx.getApplicationContext());
                }
            }
        }
        return sInstance;
    }

    private TaskStore(Context appContext) {
        mAppContext = appContext;
        mStoreFile = new File(new File(appContext.getFilesDir(), "tasks"), "tasks.json");
        loadFromDisk();
    }

    // =========================================================================================
    // 路由 API（3081 /task/* 调用；返回串均为 {"ok":...} 惯例，与相邻 handler 一致）
    // =========================================================================================

    /** GET /task/list → {"ok":true,"activeCount":N,"tasks":[...]}（activeCount 供插件/Reaper 快判活跃）。 */
    public synchronized String listJson() {
        try {
            StringBuilder sb = new StringBuilder("{\"ok\":true,\"activeCount\":");
            sb.append(activeTaskCountLocked());
            sb.append(",\"tasks\":[");
            boolean first = true;
            for (JSONObject t : mTasks.values()) {
                if (!first) sb.append(',');
                first = false;
                sb.append(t.toString());
            }
            sb.append("]}");
            return sb.toString();
        } catch (Throwable t) {
            return errJson("list 失败: " + t.getMessage());
        }
    }

    /** GET /task/get?id= → {"ok":true,"task":{...}}；不存在 → {"ok":false,"error":"not found"}（指令惯例）。 */
    public synchronized String getJson(String id) {
        try {
            JSONObject t = mTasks.get(id);
            if (t == null) return "{\"ok\":false,\"error\":\"not found\"}";
            return "{\"ok\":true,\"task\":" + t.toString() + "}";
        } catch (Throwable t) {
            return errJson("get 失败: " + t.getMessage());
        }
    }

    /**
     * POST /task/upsert（body 为单条任务 JSON，指令惯例；D1 task_id 主键 upsert 幂等）。
     * <ul>
     *   <li>id 缺省时生成 {@code t-<hex 时间戳>-<4 位随机>}；接受 {@code task_id} 别名；</li>
     *   <li>新建：kind 缺省 chroot-job（D2）、state 缺省 RUNNING、createdAt/updatedAt=now；</li>
     *   <li>更新：只覆盖 body 显式给出的字段，createdAt 保留、updatedAt 刷新（重复 POST 即心跳，
     *       供 S1 Reaper 的"超时未上报"对账；S2 换 rc/done 上报）；</li>
     *   <li>终态拒绝迁移（D4）：已终态任务不接受 state 改回非终态（RUNNING），其余字段仍可更新
     *       ——响应带 {@code stateKept:true} 说明；</li>
     *   <li>state 只认 KNOWN_STATES 六值，未知值 → ok:false。</li>
     * </ul>
     * 返回 {"ok":true,"created":bool,"task":{...}} 或 {"ok":false,"error":...}。
     */
    public synchronized String upsertJson(String bodyJson) {
        try {
            JSONObject body;
            try {
                body = new JSONObject(bodyJson == null ? "" : bodyJson.trim());
            } catch (Throwable parse) {
                return "{\"ok\":false,\"error\":\"body 不是有效 JSON\"}";
            }
            String id = body.optString("id", "").trim();
            if (id.isEmpty()) id = body.optString("task_id", "").trim();
            if (id.isEmpty()) id = newId();
            if (id.length() > 128) return "{\"ok\":false,\"error\":\"id 过长（>128）\"}";

            String state = body.optString("state", "").trim();
            if (!state.isEmpty()) {
                boolean known = false;
                for (String s : KNOWN_STATES) if (s.equals(state)) { known = true; break; }
                if (!known) return errJson("未知 state: " + state.replace("\"", "'")
                        + "（允许 RUNNING/COMPLETED/FAILED/CANCELLED/INTERRUPTED/STALE）");
            }

            JSONObject existing = mTasks.get(id);
            boolean created = existing == null;
            JSONObject task = created ? new JSONObject() : new JSONObject(existing.toString());
            if (created) {
                task.put("id", id);
                task.put("kind", "chroot-job"); // D2：MVP 仅 chroot 长命令 job 一类
                task.put("state", STATE_RUNNING);
                task.put("createdAt", nowMs());
            }
            // state 迁移（D4：终态拒绝迁移）。
            String oldState = task.optString("state", STATE_RUNNING);
            boolean oldTerminal = isTerminal(oldState);
            boolean stateKept = false;
            if (!state.isEmpty() && !state.equals(oldState)) {
                if (oldTerminal && !isTerminal(state)) {
                    stateKept = true; // 终态 → 非终态：拒绝，保持终态
                    Log.w(TAG, "upsert 拒绝终态迁移: id=" + id + " " + oldState + " → " + state);
                } else {
                    task.put("state", state);
                }
            }
            // 其余字段：只覆盖 body 显式给出的（optString 返回 "" 视为未给，避免误清空）。
            copyIfPresent(body, task, "kind");
            copyIfPresent(body, task, "job_id");
            copyIfPresent(body, task, "command_b64");
            copyIfPresent(body, task, "out");
            copyIfPresent(body, task, "err");
            copyIfPresent(body, task, "ckpt"); // 批次23 S3（D7）：checkpoint 文件指针（自愿协议，内核不解析内容）
            copyIfPresent(body, task, "session_dir"); // S2：设备 .jobs 目录指针（插件 startChrootJob 上报）
            copyIfPresent(body, task, "resumed_from");
            copyIfPresent(body, task, "note");
            if (body.has("pgid")) {
                // S2：数字字段不走 copyIfPresent（那是字符串通道）；pgid<=0 视为未上报不覆盖——
                // Reaper 收养对账（snapshotReapable）只信 pgid>0 的任务，0 会把对账面放大到全员。
                long pgid = body.optLong("pgid", 0L);
                if (pgid > 0) task.put("pgid", pgid);
            }
            if (body.has("staleAfterMs")) task.put("staleAfterMs", Math.max(0L, body.optLong("staleAfterMs", 0L)));
            task.put("updatedAt", nowMs());

            mTasks.put(id, task);
            if (!saveToDiskAtomic()) {
                Log.w(TAG, "upsert 内存已更新但落盘失败: id=" + id);
                return errJson("落盘失败（内存注册表已更新）");
            }
            return "{\"ok\":true,\"created\":" + created
                    + (stateKept ? ",\"stateKept\":true" : "")
                    + ",\"task\":" + task.toString() + "}";
        } catch (Throwable t) {
            return errJson("upsert 失败: " + t.getMessage());
        }
    }

    /**
     * POST /task/finish（markFinished）：exit=0 → COMPLETED，否则 FAILED；显式 state（如 kill 后补
     * CANCELLED，D4）优先于 exit 推导。终态幂等（D7.3）：同终态重复 finish → ok:true 原样返回；
     * 异终态迁移 → 拒绝（D4 终态拒绝迁移）。返回 {"ok":true,"task":{...}} 或错误体。
     */
    public synchronized String markFinishedJson(String id, long exitCode, long finishedAtMs, String stateOverride) {
        try {
            if (id == null || id.trim().isEmpty()) return "{\"ok\":false,\"error\":\"缺少 id\"}";
            JSONObject task = mTasks.get(id.trim());
            if (task == null) return "{\"ok\":false,\"error\":\"not found\"}";
            String oldState = task.optString("state", STATE_RUNNING);
            String target;
            if (stateOverride != null && !stateOverride.trim().isEmpty()) {
                target = stateOverride.trim();
                boolean known = false;
                for (String s : KNOWN_STATES) if (s.equals(target)) { known = true; break; }
                if (!known) return errJson("未知 state: " + target.replace("\"", "'"));
                if (!isTerminal(target)) return errJson("finish 只接受终态（COMPLETED/FAILED/CANCELLED/INTERRUPTED）");
            } else {
                target = exitCode == 0 ? STATE_COMPLETED : STATE_FAILED; // D3 终态语义
            }
            if (isTerminal(oldState)) {
                if (target.equals(oldState)) {
                    return "{\"ok\":true,\"idempotent\":true,\"task\":" + task.toString() + "}"; // D7.3 幂等
                }
                return errJson("task " + id.replace("\"", "'") + " already terminal (" + oldState + ")");
            }
            task.put("state", target);
            task.put("exit_code", exitCode);
            task.put("finishedAt", finishedAtMs > 0 ? finishedAtMs : nowMs());
            task.put("updatedAt", nowMs());
            boolean persisted = saveToDiskAtomic();
            if (!persisted) {
                Log.w(TAG, "finish 内存已更新但落盘失败: id=" + id);
                return errJson("落盘失败（内存注册表已更新）");
            }
            return "{\"ok\":true,\"task\":" + task.toString() + "}";
        } catch (Throwable t) {
            return errJson("finish 失败: " + t.getMessage());
        }
    }

    /**
     * S1 Reaper 简单对账（批次23 S1 指令）：RUNNING 且 updatedAt 停更超过 staleAfterMs
     * （每任务覆盖，缺省 {@link #DEFAULT_STALE_AFTER_MS}）→ 标记 STALE。"上报"通道 = 重复
     * POST /task/upsert 刷 updatedAt（幂等心跳）；S2 已接 pgid kill -0 收养对账
     * （{@link #snapshotReapable}/{@link #reconcileMarkGone}）与 rc/done 终态上报（插件侧），
     * 本 STALE 机制保留为无 pgid 任务与 rootShell 不可用时的兜底。
     *
     * @return 本次被标记 STALE 的条数（Reaper 日志用）
     */
    public synchronized int reconcileStale(long nowMs) {
        int n = 0;
        try {
            Iterator<Map.Entry<String, JSONObject>> it = mTasks.entrySet().iterator();
            while (it.hasNext()) {
                JSONObject t = it.next().getValue();
                if (!STATE_RUNNING.equals(t.optString("state", ""))) continue;
                long staleAfter = t.optLong("staleAfterMs", DEFAULT_STALE_AFTER_MS);
                long updatedAt = t.optLong("updatedAt", 0L);
                if (nowMs - updatedAt > staleAfter) {
                    t.put("state", STATE_STALE);
                    t.put("updatedAt", nowMs);
                    t.put("staleReason", "updatedAt 超时未上报（>" + staleAfter + "ms）");
                    n++;
                    Log.w(TAG, "task 标记 STALE: id=" + t.optString("id", "?")
                            + "（updatedAt 停更 " + (nowMs - updatedAt) + "ms）");
                }
            }
            if (n > 0) saveToDiskAtomic();
        } catch (Throwable t) {
            Log.w(TAG, "reconcileStale failed", t);
        }
        return n;
    }

    /** 活跃（state=RUNNING）任务数——wakelock 持有判据（仅 &gt;0 持有，D5）。 */
    public synchronized int activeTaskCount() {
        return activeTaskCountLocked();
    }

    // =========================================================================================
    // S2 收养对账（批次23 S2 指令 ②）：pgid 快照 + 锁外 rootShell 判活 + 锁内落库
    // =========================================================================================

    /** 对账快照条目（不可变）：id + 进程组 id，供 TaskReaper 在 TaskStore 锁外执行 kill -0 判活。 */
    public static final class PgidRef {
        public final String id;
        public final long pgid;

        PgidRef(String id, long pgid) {
            this.id = id;
            this.pgid = pgid;
        }
    }

    /**
     * 取需要 kill -0 对账的任务快照：state∈{RUNNING,STALE} 且 pgid&gt;0。<b>锁内取、锁外用</b>——
     * 调用方（TaskReaper.tick）拿快照后必须在 TaskStore 锁外跑 rootShell（su 往返上百 ms 且可能
     * 卡顿，绝不能拖住 3081 桥线程的 upsert/finish；锁序维持 S1 单向 reaper→store，本方法是
     * 快照语义、返回后不持任何锁）。STALE 也纳入：STALE 非终态、S2 对账允许其迁终态
     * （见 {@link #isTerminal} 注释），进程组确实消失的 STALE 不该永挂等 6h 兜底。
     */
    public synchronized List<PgidRef> snapshotReapable() {
        List<PgidRef> out = new ArrayList<PgidRef>();
        for (JSONObject t : mTasks.values()) {
            String st = t.optString("state", "");
            if (!STATE_RUNNING.equals(st) && !STATE_STALE.equals(st)) continue;
            long pgid = t.optLong("pgid", 0L);
            if (pgid <= 0) continue; // 无 pgid（旧注册/插件降级）无法判活，交给 reconcileStale 兜底
            out.add(new PgidRef(t.optString("id", ""), pgid));
        }
        return out;
    }

    /**
     * 收养对账落库：进程组已消失（App 侧 rootShell {@code kill -0 -&lt;pgid&gt;} 失败）的任务
     * 标记 INTERRUPTED（D6 无 rc 场景）。<b>exit_code 刻意不写</b>——结局未知，按缺省推导成
     * COMPLETED/0 是臆造（S1 /task/finish 的 exit 缺省语义不适合这里）；finishedAt=发现时刻
     * （死亡时刻的上界），note 落 {@code reaped: process gone}（批次23 S2 指令 ②）。
     * 终态幂等（D4）：已终态跳过；批量一次落盘。<b>调用前提：调用方不得持有本类监视器锁</b>
     * （与 snapshotReapable 之间隔着锁外 rootShell，见其注释）。
     *
     * @return 实际迁移条数（Reaper 日志用）
     */
    public synchronized int reconcileMarkGone(List<String> deadIds, String note) {
        if (deadIds == null || deadIds.isEmpty()) return 0;
        int n = 0;
        try {
            long now = nowMs();
            for (String id : deadIds) {
                JSONObject t = mTasks.get(id);
                if (t == null) continue; // 快照后已被 finish/upsert 删除或不存在：跳过
                String oldState = t.optString("state", "");
                if (isTerminal(oldState)) continue; // D4 终态拒绝迁移（并发 finish 赢了，幂等让路）
                t.put("state", STATE_INTERRUPTED);
                t.put("finishedAt", now);
                t.put("updatedAt", now);
                String fullNote = "reaped: process gone（kill -0 无进程组，发现时刻即 finishedAt）";
                if (note != null && !note.isEmpty()) fullNote += "；" + note;
                t.put("note", fullNote);
                n++;
                Log.i(TAG, "收养对账: task " + id + " " + oldState + " → INTERRUPTED（pgid 进程组消失）");
            }
            if (n > 0 && !saveToDiskAtomic()) {
                Log.w(TAG, "reconcileMarkGone 内存已更新但落盘失败");
            }
        } catch (Throwable t) {
            Log.w(TAG, "reconcileMarkGone failed", t);
        }
        return n;
    }

    // =========================================================================================
    // wakelock 独占（D5 决策 1/5）+ KeepAlivePolicy 决策执行
    // =========================================================================================

    /** jobWakeLock 此刻是否被持有（KeepAlivePolicy 的 currentlyHeld 输入，实测勿凭记忆）。 */
    public synchronized boolean isJobWakeLockHeld() {
        try {
            return mJobWakeLock != null && mJobWakeLock.isHeld();
        } catch (Throwable t) {
            return false;
        }
    }

    /** 上次 acquire/续期时刻（KeepAlivePolicy 的 lastRenewMs 输入；0=未知）。 */
    public synchronized long lastRenewAtMs() {
        return mLastRenewAtMs;
    }

    /** 上次 hold↔release 翻转时刻（KeepAlivePolicy 的 lastTransitionMs 输入；0=从未翻转）。 */
    public synchronized long lastTransitionAtMs() {
        return mLastTransitionAtMs;
    }

    /**
     * 按 {@link KeepAlivePolicy.Decision} 执行（TaskReaper 每个 tick 调用一次）：
     * HOLD/RENEW 且 timeoutMs&gt;0 → acquire（non-reference-counted 锁上重复 acquire 即刷新到期）；
     * timeoutMs==0 的维持 → 无操作；RELEASE → 释放（未持有幂等）。持锁态变化刷新策略簿记。
     * 任何异常吞掉记 Log.w——保活失败不反噬任务注册表主流程。
     */
    public synchronized void applyKeepAlive(KeepAlivePolicy.Decision d) {
        if (d == null) return;
        try {
            if (d.holdWakeLock) {
                if (d.timeoutMs <= 0) return; // 维持（决策表 #3/#5）：无操作
                PowerManager pm = (PowerManager) mAppContext.getSystemService(Context.POWER_SERVICE);
                if (pm == null) { Log.w(TAG, "PowerManager 不可用，无法保活"); return; }
                long timeout = Math.max(1000L, Math.min(d.timeoutMs, WAKELOCK_MAX_MS)); // clamp 同 /wakelock 路由
                boolean wasHeld = mJobWakeLock != null && mJobWakeLock.isHeld();
                if (mJobWakeLock == null) {
                    mJobWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG);
                    mJobWakeLock.setReferenceCounted(false);
                }
                mJobWakeLock.acquire(timeout);
                long now = nowMs();
                mLastRenewAtMs = now;
                if (!wasHeld) mLastTransitionAtMs = now; // release→hold 翻转
                Log.i(TAG, "jobWakeLock " + d.action + " " + timeout + "ms（activeTasks 对应决策: " + d.reason + "）");
            } else {
                if (mJobWakeLock != null && mJobWakeLock.isHeld()) {
                    mJobWakeLock.release();
                    mLastTransitionAtMs = nowMs(); // hold→release 翻转
                    Log.i(TAG, "jobWakeLock released（" + d.reason + "）");
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "applyKeepAlive failed: " + d.action, t);
        }
    }

    // =========================================================================================
    // 内部：落盘 / 读盘容错 / 小工具
    // =========================================================================================

    /** STALE 阈值：6h。S2 已有 pgid kill -0 对账 + rc/done 终态上报，本兜底保留服务两类残留：
     *  无 pgid 的任务（旧注册/插件 upsert 降级）与 rootShell 不可用的设备。长任务可在 upsert 里
     *  带 staleAfterMs 覆盖。 */
    public static final long DEFAULT_STALE_AFTER_MS = 6L * 60 * 60 * 1000L;

    private int activeTaskCountLocked() {
        int n = 0;
        for (JSONObject t : mTasks.values()) {
            if (STATE_RUNNING.equals(t.optString("state", ""))) n++;
        }
        return n;
    }

    /** 读盘：损坏 → 备份为 .corrupt-&lt;ts&gt; 后空表重建（Log.w，不抛出——本地桥不能因坏文件拒服务）。 */
    private void loadFromDisk() {
        mTasks.clear();
        FileInputStream fis = null;
        try {
            if (!mStoreFile.isFile()) return; // 首次启动：空表
            byte[] buf = new byte[(int) Math.min(mStoreFile.length(), 4L * 1024 * 1024)];
            fis = new FileInputStream(mStoreFile);
            int off = 0, n;
            while (off < buf.length && (n = fis.read(buf, off, buf.length - off)) > 0) off += n;
            JSONObject root = new JSONObject(new String(buf, 0, off, "UTF-8"));
            JSONArray arr = root.optJSONArray("tasks");
            if (arr == null) throw new IllegalStateException("缺 tasks 数组");
            for (int i = 0; i < arr.length(); i++) {
                JSONObject t = arr.optJSONObject(i);
                if (t == null) continue;
                String id = t.optString("id", "").trim();
                if (id.isEmpty()) continue; // 无主键条目丢弃（不应出现）
                mTasks.put(id, t);
            }
            Log.i(TAG, "Task DB 载入 " + mTasks.size() + " 条: " + mStoreFile.getAbsolutePath());
        } catch (Throwable t) {
            // 读时容错：备份损坏文件后重建空表（注册表增量文件，重建即回到可写状态）
            File backup = new File(mStoreFile.getParentFile(),
                    mStoreFile.getName() + ".corrupt-" + System.currentTimeMillis());
            boolean moved = mStoreFile.renameTo(backup);
            Log.w(TAG, "tasks.json 解析失败（备份 " + (moved ? backup.getPath() : "失败，原文件保留") + "），重建空表", t);
            mTasks.clear();
        } finally {
            if (fis != null) try { fis.close(); } catch (Throwable ignored) {}
        }
    }

    /**
     * 原子替换写：同目录 {@code tasks.json.dsh-tmp} 全量写完后 rename 覆盖目标（批次15 T3 同款）。
     * 结构：{"version":1,"tasks":[...]}（LinkedHashMap 插入序，顺序稳定）。
     *
     * @return true=落盘成功；false=写/换名失败（内存注册表不受影响，API 层会回 ok:false）
     */
    private boolean saveToDiskAtomic() {
        File tmp = new File(mStoreFile.getParentFile(), mStoreFile.getName() + ".dsh-tmp");
        FileOutputStream fos = null;
        try {
            if (!mStoreFile.getParentFile().exists() && !mStoreFile.getParentFile().mkdirs()) {
                Log.w(TAG, "tasks 目录创建失败: " + mStoreFile.getParent());
                return false;
            }
            JSONArray arr = new JSONArray();
            for (JSONObject t : mTasks.values()) arr.put(t);
            JSONObject root = new JSONObject();
            root.put("version", 1);
            root.put("tasks", arr);
            byte[] data = root.toString().getBytes("UTF-8");
            fos = new FileOutputStream(tmp);
            fos.write(data);
            fos.flush();
            fos.getFD().sync(); // 生命周期元数据，丢一次写就要靠对账收养兜底（D6），值得 fsync
            fos.close();
            fos = null;
            if (!tmp.renameTo(mStoreFile)) {
                Log.w(TAG, "rename 失败，tmp 保留待下次覆盖: " + tmp.getPath());
                return false;
            }
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "tasks.json 落盘失败", t);
            try { if (tmp.isFile()) tmp.delete(); } catch (Throwable ignored) {}
            return false;
        } finally {
            if (fos != null) try { fos.close(); } catch (Throwable ignored) {}
        }
    }

    /** body 里显式给出的字符串字段才覆盖（optString 缺省 ""，据此区分"未给"与"给空"）。 */
    private static void copyIfPresent(JSONObject from, JSONObject to, String key) throws org.json.JSONException {
        String v = from.optString(key, "");
        if (!v.isEmpty()) to.put(key, v);
    }

    /** id 缺省生成：t-<hex 时间戳>-<4 位随机>（SecureRandom，同 TokenStore 风格但仅 2 字节熵够用）。 */
    private static String newId() {
        byte[] b = new byte[2];
        new java.security.SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder("t-");
        sb.append(Long.toHexString(System.currentTimeMillis()));
        for (byte x : b) sb.append(Character.forDigit((x >> 4) & 0xf, 16));
        return sb.toString();
    }

    private static boolean isTerminal(String state) {
        return STATE_COMPLETED.equals(state) || STATE_FAILED.equals(state)
                || STATE_CANCELLED.equals(state) || STATE_INTERRUPTED.equals(state);
        // RUNNING/STALE 非终态：STALE 是 S1 过渡态，S2 对账允许迁移回终态
    }

    private static long nowMs() {
        return System.currentTimeMillis();
    }

    private static String errJson(String msg) {
        return "{\"ok\":false,\"error\":\"" + String.valueOf(msg).replace("\"", "'").replace("\n", " ") + "\"}";
    }
}
