"""批次67 镜像契约：引擎级常驻（Shizuku 托管 + shell 看护 + 双模回退 + 系统能力自检）。

背景（真机取证）：引擎旧实现是 App 进程用 ProcessBuilder fork 的子进程（实测 PPID=App 主进程），
因此覆盖安装 / 强行停止必然中断引擎，重拉要等 10~30s；本机无 root，但 Shizuku 可用（shell uid=2000，
实测 GKD 与 shizuku_server 自身都是 PPID=1 的孤儿进程）。本文件按既有 mirror-contract 风格
（源码文本断言）锁定「托管引擎」这条新链路，防止回退。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
HOSTED_SRC = (PKG / "HostedEngineManager.java").read_text(encoding="utf-8")
MAIN_SRC = (PKG / "MainActivity.java").read_text(encoding="utf-8")
POLICY_SRC = (PKG / "KeepAlivePolicy.java").read_text(encoding="utf-8")
OVERLAY_SRC = (PKG / "OverlayService.java").read_text(encoding="utf-8")
BOOT_SRC = (PKG / "BootReceiver.java").read_text(encoding="utf-8")
ALARM_SRC = (PKG / "AlarmReceiver.java").read_text(encoding="utf-8")


class Batch67PathContractTests(unittest.TestCase):
    """路径契约：/sdcard 是 noexec（实测 can not execute: Permission denied），运行文件必须落 /data/local/tmp。"""

    def test_hosted_dir_and_pidfiles(self) -> None:
        self.assertIn("public static final String HOSTED_DIR = \"/data/local/tmp/dsh\";", HOSTED_SRC)
        self.assertIn("public static final String ENGINE_PID_FILE = \"/data/local/tmp/dsh/engine.pid\";", HOSTED_SRC)
        self.assertIn("public static final String WATCHDOG_PID_FILE = \"/data/local/tmp/dsh/watchdog.pid\";", HOSTED_SRC)
        self.assertIn("public static final String STAMP_FILE = \"/data/local/tmp/dsh/.stamp\";", HOSTED_SRC)
        self.assertIn("public static final String ENGINE_LOG_FILE = \"/data/local/tmp/dsh/logs/engine.log\";", HOSTED_SRC)
        self.assertIn("public static final String WATCHDOG_STATE_FILE = \"/data/local/tmp/dsh/watchdog.state\";", HOSTED_SRC)

    def test_shared_home_is_the_user_data_root(self) -> None:
        """DSH_HOME 落在共享目录：App 与 shell 共见、卸载不丢、可回滚。"""
        self.assertIn("private static final String SHARED_DIR_NAME = \"DeepSeekHarness\";", HOSTED_SRC)
        self.assertIn("private static final String HOME_SUBDIR = \"home\";", HOSTED_SRC)
        self.assertIn("export DSH_HOME=", HOSTED_SRC)
        self.assertIn("export HOME=", HOSTED_SRC)

    def test_prefs_contract(self) -> None:
        self.assertIn("private static final String KEY_HOSTED_MODE = \"engine_hosted_mode\";", HOSTED_SRC)
        self.assertIn("public static final String KEY_HOSTED_STAMP = \"hosted_staged_fp\";", HOSTED_SRC)
        self.assertIn("public static final String KEY_CONFIRM_GATE_BACKUP = \"confirm_gate_hosted_backup\";", HOSTED_SRC)


class Batch67StagingTests(unittest.TestCase):
    """staging：payload.zip 解到 /data/local/tmp/dsh（唯一可执行落点）+ 指纹判据。"""

    def test_stage_script_unzips_and_chmods(self) -> None:
        start = HOSTED_SRC.index("static String stageScriptText()")
        body = HOSTED_SRC[start:HOSTED_SRC.index("static String startScriptText()")]
        for needle in ("unzip -o", "chmod -R 755", "chmod 755", "mkdir -p", "rm -rf"):
            self.assertIn(needle, body, "staging 脚本缺件：" + needle)
        self.assertIn("node-compile-cache", body)
        self.assertIn("+ STAMP_FILE +", body)

    def test_fingerprint_gate_skips_and_self_heals(self) -> None:
        """指纹一致且运行文件在位才跳过；不一致 / 文件缺失都要重 staging。"""
        self.assertIn("static boolean ensureStaged(Context ctx, String fingerprint)", HOSTED_SRC)
        self.assertIn("staged payload fingerprint mismatch -> restage", HOSTED_SRC)
        self.assertIn("staged payload missing -> restage", HOSTED_SRC)
        self.assertIn("test -x ", HOSTED_SRC)

    def test_payload_zip_published_to_shared_dir(self) -> None:
        """assets/payload.zip 必须先发布到共享目录（shell 读不到 App 私有目录）。"""
        self.assertIn("static File ensurePayloadZip(Context ctx) throws IOException", HOSTED_SRC)
        self.assertIn("private static final String PAYLOAD_ZIP_NAME = \"payload.zip\";", HOSTED_SRC)
        self.assertIn("ctx.getAssets().open(PAYLOAD_ZIP_NAME)", HOSTED_SRC)


class Batch67LifecycleTests(unittest.TestCase):
    """拉起 / 复用 / 看护：shell 身份 + setsid 脱离 App 进程树，stdout 落文件。"""

    def test_start_script_detaches_process(self) -> None:
        start = HOSTED_SRC.index("static String startScriptText()")
        body = HOSTED_SRC[start:HOSTED_SRC.index("static String watchdogScriptText()")]
        self.assertIn("setsid nohup", body)
        self.assertIn("--expose-internals", body)
        self.assertIn("web --no-open", body)
        self.assertIn("2>&1 &", body)
        self.assertIn("echo $! > ", body)
        self.assertIn("0100007F:0C08", body)
        self.assertIn("already running pid=$P", body)

    def test_watchdog_script_budget_and_state(self) -> None:
        start = HOSTED_SRC.index("static String watchdogScriptText()")
        body = HOSTED_SRC[start:HOSTED_SRC.index("public static boolean startWatchdog(Context ctx)")]
        for needle in ("watchdog.lock", "state=OK", "state=RESTART", "state=COOLDOWN", "sleep ", "kill -0"):
            self.assertIn(needle, body, "看护脚本缺件：" + needle)
        # 单实例守卫必须是 mkdir 原子锁（实测：pgrep 计数会把启动用的 sh -c 包装串算进去 → 误判「已在运行」）
        self.assertIn("if ! mkdir \\\"$LOCK\\\" 2>/dev/null; then", body)
        self.assertIn("watchdog already running pid=$L", body)
        self.assertIn("private static final long WATCHDOG_INTERVAL_SEC = 45;", HOSTED_SRC)
        self.assertIn("private static final int WATCHDOG_MAX_ATTEMPTS = 3;", HOSTED_SRC)
        self.assertIn("private static final long WATCHDOG_COOLDOWN_SEC = 60;", HOSTED_SRC)
        self.assertIn("private static final long WATCHDOG_STABLE_SEC = 120;", HOSTED_SRC)

    def test_reuse_online_engine_instead_of_respawn(self) -> None:
        """引擎已在线一律复用（否则两个引擎抢 3080）。"""
        self.assertIn("[b67] hosted engine reused pid=", HOSTED_SRC)
        # 批次95：日志补托管通道（ch=root / ch=shizuku），uid 由通道决定
        self.assertIn("[b67] hosted engine ready ch=", HOSTED_SRC)
        self.assertIn("public static boolean ensureRunning(Context ctx)", HOSTED_SRC)

    def test_watchdog_liveness_uses_pidfile(self) -> None:
        """看护存活判定只看 pidfile + 存活 + cmdline 命中（pgrep 会误命中启动包装串）。"""
        self.assertIn("grep -qa watchdog.sh /proc/$W/cmdline", HOSTED_SRC)
        self.assertIn("q(WATCHDOG_PATTERN)", HOSTED_SRC)

    def test_stop_and_cleanup_are_scoped(self) -> None:
        """停止必须按 /data/local/tmp/dsh 前缀精确匹配，绝不误杀 App 内引擎（同机共存）。"""
        self.assertIn("private static final String ENGINE_PROC_PATTERN = \"/data/local/tmp/dsh/dshroot\";", HOSTED_SRC)
        self.assertIn("public static void stopEngine(Context ctx)", HOSTED_SRC)
        self.assertIn("public static void cleanup(Context ctx)", HOSTED_SRC)
        self.assertIn("[b67] hosted stop -> engine killed pid=", HOSTED_SRC)
        self.assertIn("[b67] hosted cleanup done", HOSTED_SRC)


class Batch67EnvEquivalenceTests(unittest.TestCase):
    """engine.env 必须与 App 内模式（MainActivity.spawnNode）的 env 白名单逐项等价。"""

    def test_env_whitelist_complete(self) -> None:
        start = HOSTED_SRC.index("static String envFileText(Context ctx, File payload)")
        body = HOSTED_SRC[start:HOSTED_SRC.index("static String nodeBin(File payload)")]
        keys = ["LD_LIBRARY_PATH", "OPENSSL_CONF", "CURL_CA_BUNDLE", "PATH", "DSH_RG_PATH",
                "HOME", "DSH_HOME", "DSH_ANDROID", "TMPDIR", "TERM", "NODE_COMPILE_CACHE",
                "SHIZUKU_APP_ID", "SHIZUKU_AVAILABLE", "ROOT_AVAILABLE", "DSH_HOSTED_CHANNEL",
                "DSH_TOOLS_MODULE",
                "APP_NOTIFY_PORT", "APP_LOCAL_TOKEN", "APP_CONFIRM_DANGEROUS", "APP_A11Y_PORT",
                "DSH_VSCREEN_MODE", "NODE_BIN", "BIN_JS"]
        for key in keys:
            self.assertIn("export " + key + "=", body, "env 缺项：" + key)

    def test_env_matches_spawn_node_defaults(self) -> None:
        """托管模式取值：Shizuku 按授权实测 / ROOT_AVAILABLE 按通道（批次95：root 通道=1）/ 审批门恒开。"""
        self.assertIn("shizukuReady() ? \"1\" : \"0\"", HOSTED_SRC)
        self.assertIn("q(CHANNEL_ROOT.equals(chNow) ? \"1\" : \"0\")", HOSTED_SRC)
        self.assertIn("DSH_HOSTED_CHANNEL", HOSTED_SRC)
        self.assertIn("sb.append(\"export APP_CONFIRM_DANGEROUS=\").append(q(\"1\"))", HOSTED_SRC)

    def test_token_written_once_and_redacted_in_logs(self) -> None:
        self.assertIn("TokenStore.getOrCreate(ctx)", HOSTED_SRC)
        # 工作区键名必须与 MainActivity.KEY_WORKSPACE 对齐（写错会让托管引擎丢掉工作区）
        self.assertIn("getString(\"workspace_path\", null)", HOSTED_SRC)
        self.assertIn("chmod 600 ", HOSTED_SRC)
        self.assertIn("static String redactToken(String s)", HOSTED_SRC)
        self.assertIn("token=[redacted]", HOSTED_SRC)

    def test_auth_captured_from_log_via_shizuku(self) -> None:
        """stdout 不再接 App 管道（App 死亡不拖死 node），token 只能从引擎日志读。"""
        self.assertIn("static String readAuthUrlFromLog(Context ctx)", HOSTED_SRC)
        self.assertIn("tail -c 262144 ", HOSTED_SRC)
        self.assertIn("/?token=", HOSTED_SRC)


class Batch67DualModeTests(unittest.TestCase):
    """双模：Shizuku 可用优先托管，否则原样回退 App 内模式（保留唯一 spawn 语义）。"""

    def test_main_prefers_hosted_and_falls_back(self) -> None:
        self.assertIn("private boolean startHostedEngineIfUsable(File payload)", MAIN_SRC)
        self.assertIn("if (startHostedEngineIfUsable(payload)) return;", MAIN_SRC)
        self.assertIn("HostedEngineManager.hostedUsable(this)", MAIN_SRC)
        self.assertIn("[b67] fallback to in-app engine (reason=", MAIN_SRC)
        self.assertIn("spawnNode(payload);", MAIN_SRC)

    def test_switch_does_not_break_online_engine(self) -> None:
        """开关只写偏好；在线引擎不被重启（避免无谓断线）。"""
        self.assertIn("HostedEngineManager.setHostedWanted(this, on)", MAIN_SRC)
        self.assertIn("public static void setHostedWanted(Context ctx, boolean on)", HOSTED_SRC)

    def test_hosted_control_intents(self) -> None:
        for key in ("action_hosted_stop", "action_hosted_cleanup", "action_hosted_switch"):
            self.assertIn(key, MAIN_SRC, "缺入口：" + key)
        self.assertIn("private void handleHostedExtras(Intent in)", MAIN_SRC)
        self.assertGreaterEqual(MAIN_SRC.count("handleHostedExtras("), 3)

    def test_boot_receiver_restores_engine(self) -> None:
        self.assertIn("HostedEngineManager.hostedUsable(ctx)", BOOT_SRC)
        self.assertIn("HostedEngineManager.ensureRunning(app)", BOOT_SRC)

    def test_engine_probe_alarm(self) -> None:
        self.assertIn("public static void scheduleEngineProbe(Context ctx)", ALARM_SRC)
        self.assertIn("setExactAndAllowWhileIdle", ALARM_SRC)
        self.assertIn("getBooleanExtra(\"engineProbe\", false)", ALARM_SRC)
        self.assertIn("private static final long ENGINE_PROBE_INTERVAL_MS = 15L * 60L * 1000L;", ALARM_SRC)
        self.assertIn("scheduleEngineProbe();", MAIN_SRC)

    def test_confirmation_gate_forced_on_hosted(self) -> None:
        """托管 = shell 身份（提权）：审批门默认打开，退出托管时还原原值。"""
        self.assertIn("static void applyConfirmGate(Context ctx, boolean hosted)", HOSTED_SRC)
        self.assertIn("[b67] confirm gate forced on (hosted mode)", HOSTED_SRC)
        self.assertIn("KEY_CONFIRM_GATE_BACKUP", HOSTED_SRC)
        self.assertIn("applyConfirmGate(ctx, true);", HOSTED_SRC)
        self.assertIn("applyConfirmGate(ctx, false);", HOSTED_SRC)


class Batch67SelfCheckTests(unittest.TestCase):
    """自检面板：7 条（悬浮球） + 5 条（引擎级） = 12 条。"""

    def test_criteria_count_is_twelve(self) -> None:
        self.assertIn("Criterion[] items = new Criterion[12];", POLICY_SRC)

    def test_engine_level_names_and_targets(self) -> None:
        names = ["NAME_ENGINE", "NAME_ENGINE_HOSTED", "NAME_WATCHDOG", "NAME_EXACT_ALARM", "NAME_PROMOTED"]
        for name in names:
            self.assertIn(name, POLICY_SRC, "缺判据名：" + name)
        targets = ["TARGET_SHIZUKU", "TARGET_PROMOTED_NOTIFICATION", "TARGET_NOTIFICATION_LISTENER"]
        for target in targets:
            self.assertIn(target, POLICY_SRC, "缺跳转键：" + target)

    def test_engine_criteria_wired_after_legacy_seven(self) -> None:
        self.assertIn("items[7] = new Criterion(NAME_ENGINE", POLICY_SRC)
        self.assertIn("items[11] = new Criterion(NAME_PROMOTED", POLICY_SRC)
        self.assertIn("public SelfCheck(boolean ignoringBatteryOptimizations, boolean backgroundRestricted,", POLICY_SRC)

    def test_selfcheck_inputs_probe_real_device(self) -> None:
        """引擎级取值必须真机探测（批次47 教训：不许写死）。"""
        self.assertIn("HostedEngineManager.probe(this)", MAIN_SRC)
        self.assertIn("HostedEngineManager.shizukuReady()", MAIN_SRC)
        self.assertIn("alarmMgr.canScheduleExactAlarms()", MAIN_SRC)
        self.assertIn("nm.canPostPromotedNotifications()", MAIN_SRC)
        self.assertIn("engineUp, hostedNow, watchdogUp, exactAlarm, promoted, shizukuOk, false", MAIN_SRC)
        self.assertIn("engineUp, hostedNow, watchdogUp, exactAlarm, promoted, shizukuOk, false", OVERLAY_SRC)

    def test_overlay_uses_dynamic_total(self) -> None:
        self.assertIn("rep.items.length", OVERLAY_SRC)
        self.assertNotIn("/7)", OVERLAY_SRC)

    def test_card_has_hosted_entry_buttons(self) -> None:
        for needle in ("keepAliveJumpButton(\"引擎托管\"", "keepAliveJumpButton(\"Shizuku 授权\"",
                       "keepAliveJumpButton(\"实况窗设置\""):
            self.assertIn(needle, MAIN_SRC, "卡片缺按钮：" + needle)
        self.assertIn("private void requestShizukuPermissionOrOpen()", MAIN_SRC)
        self.assertIn("private void openPromotedNotificationSetting()", MAIN_SRC)


class Batch67DataMigrationTests(unittest.TestCase):
    """数据迁移：私有 dshhome 到共享 home，只补缺、不删原目录（可回滚）。"""

    def test_migration_is_additive_only(self) -> None:
        self.assertIn("static void migrateHomeIfNeeded(Context ctx, File payload)", HOSTED_SRC)
        self.assertIn(".migrated-from-private", HOSTED_SRC)
        self.assertIn("private static int copyTreeMissing(File src, File dst, int depth)", HOSTED_SRC)
        self.assertIn("else if (!target.exists() && copyFile(kid, target))", HOSTED_SRC)
        self.assertNotIn("deleteRecursive", HOSTED_SRC)


if __name__ == "__main__":
    unittest.main()
