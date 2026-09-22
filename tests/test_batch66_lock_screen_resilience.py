"""批次66 镜像契约：锁屏挂机不再中断（探活防抖 / 抢救预算 / 灭屏宽限 / 面板保活 / 建屏复用）。

真机症状（用户反馈）：虚拟屏执行任务时锁屏 → 「虚拟屏销毁重建再销毁」，任务跑不动。
根因（代码级）：① 旧 supervisor 单次 /health 失败即杀服务端 + 换道重建，auto 通道还会
root↔shizuku 无限乒乓；② 旧 /vscreen/create 在「未指定尺寸」时按默认 1008x1792 归一化，
与现有 display 尺寸不等 → closeDisplay() 销毁重建。
本文件按既有 mirror-contract 风格（源码文本断言）锁定修复，防止回退。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
VS_MGR_SRC = (PKG / 'VscreensManager.java').read_text(encoding='utf-8')
SERVER_SRC = (PKG / 'vscreen' / 'Main.java').read_text(encoding='utf-8')


class Batch66ProbeDebounceTests(unittest.TestCase):
    '''探活防抖：单次抖动不得判死，连续阈值 + 单 tick 自证重试。'''

    def test_probe_thresholds_declared(self) -> None:
        self.assertIn('private static final int HEALTH_FAIL_THRESHOLD = 3;', VS_MGR_SRC)
        self.assertIn('private static final int SUPERVISOR_PROBE_RETRY = 2;', VS_MGR_SRC)
        self.assertIn('private static final int SUPERVISOR_PROBE_READ_TIMEOUT_MS = 3000;', VS_MGR_SRC)
        self.assertIn('private static final long SUPERVISOR_PROBE_RETRY_GAP_MS = 400;', VS_MGR_SRC)

    def test_supervisor_probe_helper_exists(self) -> None:
        self.assertIn('private boolean supervisorProbe(Context ctx)', VS_MGR_SRC)
        self.assertIn('healthOk(probeHealth(c, SUPERVISOR_PROBE_READ_TIMEOUT_MS))', VS_MGR_SRC)
        # supervisor 必须用带超时的探活重载，而不是路由用的 1500ms 短超时
        self.assertIn('private JSONObject probeHealth(Context ctx, int readTimeoutMs)', VS_MGR_SRC)
        self.assertIn('return probeHealth(ctx, 1500);', VS_MGR_SRC)

    def test_death_only_after_threshold(self) -> None:
        loop_start = VS_MGR_SRC.index('private void supervisorLoop()')
        loop_end = VS_MGR_SRC.index('Log.i(TAG, "session supervisor stopped");')
        loop = VS_MGR_SRC[loop_start:loop_end]
        # 阈值内不得判死：先自增 streak 并提前 continue
        self.assertIn('if (healthFailStreak < HEALTH_FAIL_THRESHOLD) {', loop)
        self.assertIn('healthFailStreak++;', loop)
        self.assertLess(loop.index('healthFailStreak < HEALTH_FAIL_THRESHOLD'),
                        loop.index('handleSessionDeath();'))
        tail = loop[loop.index('healthFailStreak < HEALTH_FAIL_THRESHOLD'):]
        self.assertIn('continue;', tail.split('handleSessionDeath();')[0])


class Batch66ScreenOffGraceTests(unittest.TestCase):
    '''灭屏宽限：灭屏后 120s 内只探活 + 复述 AOD，绝不杀进程/重建。'''

    def test_grace_constants_and_branch(self) -> None:
        self.assertIn('private static final long SCREEN_OFF_GRACE_MS = 120000;', VS_MGR_SRC)
        self.assertIn('if (screenOffAt > 0L && now - screenOffAt < SCREEN_OFF_GRACE_MS) {', VS_MGR_SRC)
        self.assertIn('keep session, reassert AOD', VS_MGR_SRC)
        grace = VS_MGR_SRC[VS_MGR_SRC.index('now - screenOffAt < SCREEN_OFF_GRACE_MS'):]
        self.assertIn('continue;', grace.split('handleSessionDeath();')[0])

    def test_screen_receiver_registered_only_with_session(self) -> None:
        self.assertIn('private void ensureScreenReceiver(final Context ctx)', VS_MGR_SRC)
        self.assertIn('Intent.ACTION_SCREEN_OFF.equals(action)', VS_MGR_SRC)
        self.assertIn('Intent.ACTION_USER_PRESENT.equals(action)', VS_MGR_SRC)
        self.assertIn('private void releaseScreenReceiver()', VS_MGR_SRC)
        # 会话建立注册 / 会话收尾与判死注销
        self.assertIn('ensureScreenReceiver(ctx);', VS_MGR_SRC)
        self.assertGreaterEqual(VS_MGR_SRC.count('releaseScreenReceiver();'), 3)


class Batch66RecoveryBudgetTests(unittest.TestCase):
    '''抢救预算：禁止 root↔shizuku 无限乒乓重建（「销毁重建再销毁」的直接来源）。'''

    def test_budget_constants(self) -> None:
        self.assertIn('private static final int RECOVERY_MAX_ATTEMPTS = 2;', VS_MGR_SRC)
        self.assertIn('private static final long RECOVERY_COOLDOWN_MS = 60000;', VS_MGR_SRC)
        self.assertIn('private static final long SESSION_STABLE_MS = 120000;', VS_MGR_SRC)

    def test_budget_guard_and_chain(self) -> None:
        death_start = VS_MGR_SRC.index('private void handleSessionDeath()')
        death_end = VS_MGR_SRC.index('private void markSessionDead(Context ctx, String reason)')
        death = VS_MGR_SRC[death_start:death_end]
        # 预算耗尽 → 直接判死，不再重建
        self.assertIn('if (recoveryAttempts >= RECOVERY_MAX_ATTEMPTS) {', death)
        self.assertIn('markSessionDead(', death)
        # 抢救链去重：同一链内不重复换道
        self.assertIn('!recoveryChain.contains(CHANNEL_SHIZUKU)', death)
        self.assertIn('!recoveryChain.contains(CHANNEL_ROOT)', death)
        self.assertIn('recoveryChain.add(alt);', death)
        self.assertIn('recoveryAttempts++;', death)
        self.assertLess(death.index('recoveryAttempts++;'), death.index('killByPidfile(ctx);'))

    def test_single_dead_path_idempotent(self) -> None:
        self.assertIn('private void markSessionDead(Context ctx, String reason)', VS_MGR_SRC)
        dead_start = VS_MGR_SRC.index('private void markSessionDead(Context ctx, String reason)')
        dead = VS_MGR_SRC[dead_start:dead_start + 900]
        for needle in ('sessionActive = false;', 'releaseScreenReceiver();', 'releasePanelWakeLock();',
                       'releaseWakelock();', 'restoreDozeAod(ctx);',
                       'VscreensPreviewService.stopSession();', 'postSessionDeadNotification(ctx, reason);'):
            self.assertIn(needle, dead)


class Batch66PanelKeepAliveTests(unittest.TestCase):
    '''锁屏面板保活：AOD 被 ROM 忽略时升级为「面板不熄」，保证 SF 继续合成虚拟屏。'''

    def test_aod_reassert(self) -> None:
        self.assertIn('private static final long AOD_REASSERT_INTERVAL_MS = 60000;', VS_MGR_SRC)
        self.assertIn('private void assertPanelAodIfNeeded(Context ctx, boolean force)', VS_MGR_SRC)
        self.assertIn('privSetting(ctx, "put secure doze_always_on 1");', VS_MGR_SRC)

    def test_panel_wakelock_escalation(self) -> None:
        self.assertIn('private static final String PANEL_WAKELOCK_TAG = "dsh:vscreen-panel";', VS_MGR_SRC)
        self.assertIn('private static final String KEY_LOCK_PANEL_KEEPALIVE = "vscreen_lock_panel_keepalive";',
                      VS_MGR_SRC)
        self.assertIn('private void escalatePanelKeepAliveIfNeeded(Context ctx)', VS_MGR_SRC)
        self.assertIn('PowerManager.SCREEN_DIM_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP', VS_MGR_SRC)
        esc = VS_MGR_SRC[VS_MGR_SRC.index('private void escalatePanelKeepAliveIfNeeded'):]
        esc = esc[:esc.index('private void releasePanelWakeLock()')]
        # 偏好可关（默认 true）+ 面板已亮（AOD/ON）时不打扰
        self.assertIn('getBoolean(KEY_LOCK_PANEL_KEEPALIVE, true)', esc)
        self.assertIn('if (pm.isInteractive()) {', esc)
        self.assertIn('return;', esc)
        self.assertIn('private void releasePanelWakeLock()', VS_MGR_SRC)
        self.assertGreaterEqual(VS_MGR_SRC.count('releasePanelWakeLock();'), 3)


class Batch66ServerBuildReuseTests(unittest.TestCase):
    '''服务端：未指定尺寸的 create 必须复用现有 display（不再销毁重建）。'''

    def test_build_fingerprint_bumped(self) -> None:
        self.assertIn('static final String BUILD = "b12";', SERVER_SRC)
        self.assertIn('private static final String SERVER_VERSION = "b12";', VS_MGR_SRC)

    def test_unspecified_size_reuses_display(self) -> None:
        self.assertIn('boolean sizeSpecified = reqW > 0 || reqH > 0;', SERVER_SRC)
        self.assertIn('if (sCurrentDisplayId >= 0 && !sizeSpecified) {', SERVER_SRC)
        create_start = SERVER_SRC.index('private static synchronized String createDisplay(')
        create = SERVER_SRC[create_start:create_start + 2600]
        # 复用分支必须早于「尺寸不同 → 重建」的 closeDisplay()
        self.assertLess(create.index('!sizeSpecified'), create.index('closeDisplay();'))
        self.assertIn('\\"reused\\":true', create)
        # 显式尺寸变化仍然重建（横竖屏切换语义保留）
        self.assertIn('不同 → 重建', SERVER_SRC)


class Batch66bUpgradePathTests(unittest.TestCase):
    '''批次66b 真机取证修正：升级后必须换到新服务端 jar，残留服务端必须能杀掉，token 不得进 logcat。

    真机症状（本轮实测）：APK 内已是 b12，盘上残留 b11 → App 判 version mismatch → 反复
    kill/respawn，而 Shizuku 通道 pidfile 在外部目录（旧实现只查私有目录）+ 盘上 pid 早已过期
    → 残留服务端永远杀不掉 → 8998 被占 → 新建屏一律 SPAWN_FAILED（虚拟屏彻底不可用）。
    '''

    def test_server_jar_refreshed_by_hash(self) -> None:
        start = VS_MGR_SRC.index('private File ensureServerJar(Context ctx, String channel)')
        end = VS_MGR_SRC.index('private File stageServerJarForShizuku(Context ctx, File source)')
        jar = VS_MGR_SRC[start:end]
        # 不得再用「文件已存在就沿用」的旧早退（等长的 b11→b12 只有内容哈希能识别）
        self.assertNotIn('if (jar.exists() && jar.length() > 0) {', jar)
        self.assertIn('sha1Hex(asset).equals(sha1Hex(onDisk))', jar)
        self.assertIn('byte[] onDisk = readFileBytesQuiet(jar);', jar)

    def test_pidfile_kill_covers_both_channels_and_name_fallback(self) -> None:
        start = VS_MGR_SRC.index('private void killByPidfile(Context ctx)')
        end = VS_MGR_SRC.index('private File externalPidFile(Context ctx)')
        kill = VS_MGR_SRC[start:end]
        self.assertIn('externalPidFile(ctx)', kill)
        self.assertIn('"kill -9 $(pidof dsh-vscreen)"', kill)
        self.assertIn('killViaPrivilege', kill)

    def test_privileged_kill_handles_missing_channels(self) -> None:
        self.assertIn('private void killViaPrivilege(Context ctx, String killCmd, String what)', VS_MGR_SRC)
        self.assertIn('svc.newProcess(new String[]{"sh", "-c", killCmd}, null, null)', VS_MGR_SRC)
        self.assertIn('cannot kill vscreen ', VS_MGR_SRC)

    def test_spawn_log_masks_token(self) -> None:
        self.assertIn('maskToken(cmd, token)', VS_MGR_SRC)
        self.assertIn('maskToken(joinArgv(argv), token)', VS_MGR_SRC)
        self.assertNotIn('"spawn vscreen server via root: " + cmd', VS_MGR_SRC)
        self.assertNotIn('"spawn vscreen server via shizuku: " + joinArgv(argv)', VS_MGR_SRC)

    def test_close_also_tears_down_session(self) -> None:
        """真机实测：模型自己调 /vscreen/close 后，收尾判定（sessionActive=false）不会再走 shutdown()，
        于是 doze_always_on 永久停在 1、dsh-vscreen 残留占着 8998；close 必须自己收尾。"""
        start = VS_MGR_SRC.index('private void handleClose(Context ctx, String method, String rawPath, String body,')
        end = VS_MGR_SRC.index('// 批次 12w：会话结束（close）→ 停预览悬浮窗', start)
        close = VS_MGR_SRC[start:end]
        self.assertIn('restoreDozeAod(ctx);', close)
        self.assertIn('killByPidfile(ctx);', close)
        self.assertIn('releaseScreenReceiver();', close)

    def test_doze_aod_unset_original_is_restored(self) -> None:
        """原值「未设置」（settings 返回字符串 null）时收尾必须 delete 还原：
        旧实现把它和「本会话未改过」都表示成 Java null → 收尾早退 → 系统设置被永久改成 1。"""
        self.assertIn('private boolean dozeAodDirty;', VS_MGR_SRC)
        self.assertNotIn('dozeAodOriginal = "null".equals(cur) ? null : cur;', VS_MGR_SRC)
        start = VS_MGR_SRC.index('private void restoreDozeAod(Context ctx)')
        end = VS_MGR_SRC.index('private void privSetting(Context ctx, String args)')
        restore = VS_MGR_SRC[start:end]
        self.assertIn('if (!dozeAodDirty) {', restore)
        self.assertIn('delete secure doze_always_on', restore)

    def test_screen_on_while_locked_keeps_keepalive(self) -> None:
        """真机实测：这次 SCREEN_ON 是我们自己保活锁唤醒的，旧逻辑清宽限 + 释放锁 → 系统 ~10s 后又熄屏
        → 再唤醒，锁屏期间屏幕反复闪烁。改为按「是否仍锁定」判定，未解锁则保留宽限与面板锁。"""
        self.assertIn('private boolean isKeyguardLocked(Context ctx)', VS_MGR_SRC)
        self.assertIn('if (isKeyguardLocked(app)) {', VS_MGR_SRC)
        self.assertIn('[b66] screen on while still locked -> keep panel keepalive', VS_MGR_SRC)
        start = VS_MGR_SRC.index('} else if (Intent.ACTION_SCREEN_ON.equals(action)) {')
        end = VS_MGR_SRC.index('} else if (Intent.ACTION_USER_PRESENT.equals(action)) {')
        branch = VS_MGR_SRC[start:end]
        self.assertIn('isKeyguardLocked(app)', branch)
        self.assertNotIn('releasePanelWakeLock();', branch.split('} else {')[0])




if __name__ == '__main__':
    unittest.main()
