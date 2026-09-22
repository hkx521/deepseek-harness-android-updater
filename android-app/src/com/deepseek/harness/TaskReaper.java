package com.deepseek.harness;

import android.content.Context;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * 批次 23 S1（设计文档 D5）：任务收割线程——30s tick，<b>仅 activeTasks&gt;0 时存在</b>。
 *
 * <p>模式复用 VscreensManager 的 SessionSupervisor（单条常驻 daemon 线程 + sleep 循环），两点差异：
 * <ul>
 *   <li>间隔放宽至 30s——chroot 任务对秒级延迟不敏感（D5 原文）；</li>
 *   <li>等待用 wait/notify 而非纯 sleep：任务终态落库后 {@link #nudge()} 可提前唤醒，
 *       让 KeepAlivePolicy 的 RELEASE 防抖判定尽快走完（空闲稳态零 wakelock，批次 21 红线）。</li>
 * </ul></p>
 *
 * <p>每个 tick 做三件事（批次23 S2 真机缺陷修复后的统一时序：<b>对账 → 保活决策</b>）：
 * <ol>
 *   <li>S1 对账：RUNNING 且 updatedAt 停更超阈值 → 标记 STALE（无 pgid 任务与无 root 设备的
 *       6h 兜底，{@link TaskStore#reconcileStale}）；</li>
 *   <li>S2 pgid 收养对账（批次23 S2 指令 ②）：对有 pgid 的任务用 App 侧 rootShell 执行
 *       {@code kill -0 -&lt;pgid&gt;}——组消失 → {@link TaskStore#reconcileMarkGone} 落
 *       INTERRUPTED（无 rc、exit_code 留空）。三段式快照→锁外判活→锁内落库，rootShell
 *       绝不在 TaskStore 锁内（锁序单向 reaper→store，见 {@link #reconcilePgid} 注释）；</li>
 *   <li>保活决策：实测<b>对账后</b>的活跃数/持锁态/续期时刻喂给 {@link KeepAlivePolicy}，
 *       决策由 {@link TaskStore#applyKeepAlive} 执行（wakelock 独占归 TaskStore，D5 决策 1/5）。
 *       决策必须收尾——曾试过决策前移（S2 首版），「决策时活跃（HOLD 已 acquire）、收养后归零」
 *       的 tick 会让循环退出路径跳过释放，wakelock 泄漏到 30min clamp（真机实证 02:16 HOLD →
 *       02:19 仍持有）。对账里的 su 往返会略推迟首个 HOLD，换决策输入强一致，可接受
 *       （D5：chroot 任务对秒级延迟不敏感）。</li>
 * </ol></p>
 *
 * <p>生命周期：{@link #ensure} 在任务注册（upsert）与 list 观察时被调用，活跃任务存在且线程
 * 不在 → 启动；activeTasks 归零 → 循环退出前<b>强制 RELEASE</b>（{@link #forceReleaseBeforeExit}，
 * 不受 30s 防抖约束——防抖只约束运行中的翻转，线程退出=监督生命周期结束；下次任务 upsert 时
 * ensure() 新建线程重新 HOLD，语义闭合），空闲零持有。
 * S1 已知缺口（报告注明）：App 冷启动时若 tasks.json 里有遗留 RUNNING 任务（D6"App 重启后
 * Reaper 重建"），本片没有 onCreate 钩子自动重建——下一次任何 /task/* 路由触发 ensure 即补上；
 * 常驻自愈留 S2。</p>
 */
public final class TaskReaper {

    private static final String TAG = "TaskReaper";

    /** tick 间隔：30s（D5：chroot 任务对秒级延迟不敏感）。 */
    public static final long TICK_MS = 30 * 1000L;

    /** 单例线程句柄与 nudge 监视器共用一把锁（无 store→reaper 嵌套持锁路径，无死锁环）。 */
    private static final Object REAPER_LOCK = new Object();
    private static Thread sThread;

    private TaskReaper() {}

    /**
     * 确保 Reaper 活着（有活跃任务且线程不在时启动；已在跑则顺带 nudge 提前 tick）。
     * 幂等，可在任意 /task/* 路由后调用；空注册表上是零开销 no-op（不建线程——
     * "仅 activeTasks&gt;0 时存在"，D5）。
     */
    public static void ensure(Context ctx) {
        synchronized (REAPER_LOCK) {
            try {
                TaskStore store = TaskStore.get(ctx);
                if (store.activeTaskCount() <= 0) return;
                if (sThread != null && sThread.isAlive()) {
                    REAPER_LOCK.notifyAll(); // 已在跑：当作一次 nudge（新注册可能改变活跃数）
                    return;
                }
                Thread t = new Thread(new Runnable() {
                    @Override public void run() { loop(ctx); }
                }, "task-reaper");
                t.setDaemon(true);
                t.start();
                sThread = t;
                Log.i(TAG, "task reaper started (tick=" + TICK_MS + "ms)");
            } catch (Throwable t) {
                Log.w(TAG, "ensure failed", t);
            }
        }
    }

    /** 提前唤醒 Reaper 走一次 tick（任务终态落库后尽快判定 RELEASE；错过窗口则下个 tick 兜底）。 */
    public static void nudge() {
        synchronized (REAPER_LOCK) {
            try {
                REAPER_LOCK.notifyAll();
            } catch (Throwable ignored) {}
        }
    }

    /**
     * 主循环：tick → 活跃归零即退出；否则最多等一个 tick。两条退出路径（归零 break 与
     * 进程退出 interrupt）都先走 {@link #forceReleaseBeforeExit}——<b>退出路径绝不允许在持锁
     * 状态下离开</b>（批次23 S2 真机缺陷：旧时序下归零发生在决策之后，退出路径不跑任何
     * RELEASE 决策，wakelock 泄漏到 30min clamp）。
     */
    private static void loop(Context ctx) {
        try {
            TaskStore store = TaskStore.get(ctx);
            while (true) {
                tick(ctx, store);
                if (store.activeTaskCount() <= 0) break;
                synchronized (REAPER_LOCK) {
                    try {
                        REAPER_LOCK.wait(TICK_MS); // nudge 提前唤醒；超时则到点 tick
                    } catch (InterruptedException e) {
                        break; // 进程退出（daemon 被打断）；wakelock 仍由下方强制释放兜底（D6 App 死语义下随进程释放）
                    }
                }
            }
            forceReleaseBeforeExit(store);
            Log.i(TAG, "task reaper exited（无活跃任务，空闲零持有）");
        } catch (Throwable t) {
            Log.w(TAG, "task reaper crashed", t);
            // 崩溃路径同样是退出路径，同样不持锁离场（尽力而为；内部各自再吞异常）
            try { forceReleaseBeforeExit(TaskStore.get(ctx)); } catch (Throwable ignored) {}
        }
    }

    /**
     * 线程退出前的强制释放（批次23 S2 真机缺陷修复）。两个要点：
     * <ul>
     *   <li><b>不受 30s RELEASE 防抖约束</b>：防抖（KeepAlivePolicy 决策表 #5）只约束「运行中」
     *       的翻转，防任务快速连发时的 hold/release 抖动；线程退出 = 监督生命周期结束，之后
     *       无人再翻转、宽限毫无意义——直接构造 RELEASE 决策执行（Decision 构造器包内可见，
     *       本类同包合法，不改 KeepAlivePolicy）。下次任务 upsert 时 ensure() 新建线程，
     *       首个 tick 决策表 #1 立即重新 HOLD，语义闭合；</li>
     *   <li>幂等：未持有直接返回；释放后再实测一次，仍被持有则 Log.w（不应发生，留现场排查）。</li>
     * </ul>
     */
    private static void forceReleaseBeforeExit(TaskStore store) {
        try {
            if (!store.isJobWakeLockHeld()) return;
            store.applyKeepAlive(new KeepAlivePolicy.Decision(
                    KeepAlivePolicy.ACTION_RELEASE, false,
                    "reaper exit：监督线程退出，强制释放（防抖只约束运行中的翻转）", 0L));
            if (store.isJobWakeLockHeld()) {
                Log.w(TAG, "reaper exit 强制释放后 wakelock 仍被持有（不应发生，请抓 dumpsys power 复核）");
            }
        } catch (Throwable t) {
            Log.w(TAG, "forceReleaseBeforeExit failed", t);
        }
    }

    /**
     * 单个 tick（批次23 S2 真机缺陷修复后的统一时序）：<b>对账 → 保活决策</b>。
     * 决策必须用对账后的 activeTaskCount：S2 首版曾把决策放在对账之前，真机实证
     * 「决策时活跃（HOLD 已 acquire 02:16:10.938）→ reconcilePgid 收养归零（02:16:11.008）→
     * 循环退出路径跳过释放」，wakelock 泄漏到 30min clamp。对账里的 su 往返会略推迟首个
     * HOLD（仅在有 pgid 活跃任务时发生，典型百余 ms），换决策输入强一致，可接受
     * （D5 原文：chroot 任务对秒级延迟不敏感）。
     */
    private static void tick(Context ctx, TaskStore store) {
        try {
            long now = System.currentTimeMillis();
            // 1) S1 对账：updatedAt 停更 → STALE（6h 兜底；S2 起只服务无 pgid 任务/无 root 设备）。
            int stale = store.reconcileStale(now);
            if (stale > 0) Log.i(TAG, "对账标记 STALE " + stale + " 条");
            // 2) S2 pgid 收养对账（批次23 S2 指令 ②；rootShell 在 TaskStore 锁外，见 reconcilePgid）。
            reconcilePgid(store);
            // 3) 保活决策：实测对账后的活跃数/持锁态/续期时刻喂 KeepAlivePolicy，决策由
            //    TaskStore 执行（D5）。时刻取决策现场值（对账的 su 往返可能已耗数百 ms）。
            KeepAlivePolicy.Decision d = KeepAlivePolicy.evaluate(
                    store.activeTaskCount(),
                    store.isJobWakeLockHeld(),
                    System.currentTimeMillis(),
                    store.lastRenewAtMs(),
                    store.lastTransitionAtMs(),
                    null);
            store.applyKeepAlive(d);
        } catch (Throwable t) {
            Log.w(TAG, "tick failed", t);
        }
    }

    /**
     * 批次23 S2（指令 ②）：pgid 收养对账——三段式，rootShell 调用绝不在 TaskStore 锁内：
     * <ol>
     *   <li>锁内取快照（{@link TaskStore#snapshotReapable}，返回即不持锁）；</li>
     *   <li>锁外 rootShell {@code kill -0 -&lt;pgid&gt;} 判活（su 往返慢，且 App 无法直接看
     *       root 进程，只能借道 su——与插件 list/output 的设备侧判活同款命令）；</li>
     *   <li>锁内落库（{@link TaskStore#reconcileMarkGone}）。</li>
     * </ol>
     * 先探测 su 通道（{@code rootShell("true")}）：rootShell 只回 boolean（设计文档冲突 4），
     * "su 不可用"与"进程组已死"都表现为 false、不可区分——无 root 时跳过对账、维持 S1 的
     * STALE 6h 兜底（指令：rootShell 不可用不硬判）。误判方向安全性：pgid 被复用时 kill -0
     * 误报"仍活"→ 无操作（保守，任务最终仍走 STALE 兜底）；反向误杀只可能来自 su 抖动
     * （探测通过后单条偶发失败），每次 tick 重探重判可自愈（对已终态任务 markGone 幂等跳过）。
     */
    private static void reconcilePgid(TaskStore store) {
        try {
            List<TaskStore.PgidRef> snap = store.snapshotReapable(); // ① 锁内取快照
            if (snap.isEmpty()) return; // 无 pgid 活跃任务：零 su 开销（空闲零成本，D5 红线）
            if (!MainActivity.rootShellForTaskReaper("true")) {
                Log.w(TAG, "rootShell 不可用（su 探测失败），跳过 pgid 收养对账（维持 STALE 6h 兜底）");
                return;
            }
            List<String> dead = new ArrayList<String>();
            for (TaskStore.PgidRef ref : snap) { // ② 锁外判活
                boolean alive = MainActivity.rootShellForTaskReaper("kill -0 -" + ref.pgid);
                if (!alive) dead.add(ref.id);
            }
            if (dead.isEmpty()) return;
            int n = store.reconcileMarkGone(dead, null); // ③ 锁内落库
            if (n > 0) {
                Log.i(TAG, "pgid 收养对账: " + n + " 个任务进程组已消失 → INTERRUPTED");
                // 无需 nudge：同 tick 收尾的保活决策就用对账后的活跃数——归零即决策 RELEASE
                //（决策表 #4/#6）；即便 #5 防抖宽限，循环退出路径的 forceReleaseBeforeExit 也会兜底强制释放。
            }
        } catch (Throwable t) {
            Log.w(TAG, "reconcilePgid failed", t);
        }
    }
}
