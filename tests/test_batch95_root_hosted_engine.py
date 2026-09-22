"""批次95 契约：root 托管通道（root 优先 / Shizuku 兜底）+ 定时任务引擎特权环境修复。

背景（真机取证 2026-09-22，Pixel 6 Pro / SukiSU Ultra 4.1.3 KernelSU）：
- 旧实现只有 Shizuku 一条托管通道（hostedUsable = hostedWanted && shizukuReady）。没装 Shizuku 的
  有 root 设备只能退回 App 内引擎：App 进程被杀 / 被覆盖安装引擎就跟着死，没有 setsid 常驻、没有看护自愈；
- 定时任务引擎（ScheduleExecutor.startEngine）把 SHIZUKU_AVAILABLE / ROOT_AVAILABLE 双双硬编码为 "0"，
  插件注册期（privilegedAvailable()）直接跳过整族特权工具，「到点执行」的任务与主引擎能力分叉。

本文件按既有 mirror-contract 风格（源码文本断言）锁定这两条修复，防止回退。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
HOSTED = (PKG / "HostedEngineManager.java").read_text(encoding="utf-8")
MAIN = (PKG / "MainActivity.java").read_text(encoding="utf-8")
OVERLAY = (PKG / "OverlayService.java").read_text(encoding="utf-8")
SCHED = (PKG / "ScheduleExecutor.java").read_text(encoding="utf-8")


class Batch95ChannelTests(unittest.TestCase):
    """通道定义与优先级：root(su) 优先，Shizuku 兜底。"""

    def test_channel_constants(self) -> None:
        self.assertIn('public static final String CHANNEL_ROOT = "root";', HOSTED)
        self.assertIn('public static final String CHANNEL_SHIZUKU = "shizuku";', HOSTED)
        self.assertIn('public static final String KEY_HOSTED_CHANNEL = "hosted_channel";', HOSTED)

    def test_root_priority_over_shizuku(self) -> None:
        seg = HOSTED[HOSTED.index("public static String activeChannel()"):]
        seg = seg[:seg.index("public static String modeLabel(")]
        self.assertLess(seg.index("rootReady()"), seg.index("shizukuReady()"))

    def test_hosted_usable_accepts_any_channel(self) -> None:
        self.assertIn("return hostedWanted(ctx) && activeChannel() != null;", HOSTED)
        self.assertNotIn("return hostedWanted(ctx) && shizukuReady();", HOSTED)

    def test_mode_label_covers_three_states(self) -> None:
        self.assertIn('return "托管(root)";', HOSTED)
        self.assertIn('return "托管(shell)";', HOSTED)
        seg = HOSTED[HOSTED.index("public static String modeLabel("):]
        seg = seg[:seg.index("public static boolean hostedUsable(")]
        self.assertIn('return "App 内";', seg)
        self.assertIn("recordEngineMode(HostedEngineManager.modeLabel(this));", MAIN)
        self.assertIn("engineMode = HostedEngineManager.modeLabel(this);", OVERLAY)


class Batch95RootProbeTests(unittest.TestCase):
    """root 探测只有一份实现（HostedEngineManager），App 侧旧副本删除。"""

    def test_probe_lives_in_hosted_manager(self) -> None:
        self.assertIn("public static boolean probeRootNow()", HOSTED)
        self.assertIn('new String[]{"su", "-c", "id"}', HOSTED)
        self.assertIn('line.contains("uid=0")', HOSTED)
        self.assertIn("if (!p.waitFor(3, TimeUnit.SECONDS)) p.destroy();", HOSTED)
        self.assertIn("private static final long ROOT_PROBE_TTL_MS = 60000L;", HOSTED)

    def test_main_activity_delegates(self) -> None:
        self.assertIn("return HostedEngineManager.probeRootNow();", MAIN)
        self.assertNotIn('Runtime.getRuntime().exec(new String[]{"su", "-c", "id"})', MAIN
                         .replace("return HostedEngineManager.probeRootNow();", ""))


class Batch95TransportTests(unittest.TestCase):
    """特权命令统一走 runHost（root 优先 / Shizuku 兜底），不再直连单一通道。"""

    def test_run_host_routes(self) -> None:
        self.assertIn("static String runHost(String cmd, long timeoutMs) {", HOSTED)
        self.assertIn("if (CHANNEL_ROOT.equals(ch)) return rootRun(cmd, timeoutMs);", HOSTED)
        self.assertIn("if (CHANNEL_SHIZUKU.equals(ch)) return shizukuRunDirect(cmd, timeoutMs);", HOSTED)
        self.assertEqual(1, HOSTED.count("shizukuRunDirect(cmd, timeoutMs)"))

    def test_root_run_matches_vscreen_channel(self) -> None:
        self.assertIn('Runtime.getRuntime().exec(new String[]{"su", "-c", cmd})', HOSTED)
        self.assertIn("static String rootRun(String cmd, long timeoutMs) {", HOSTED)

    def test_rish_dex_path_helper(self) -> None:
        self.assertIn("public static String rishDexPath(Context ctx)", HOSTED)

    def test_engine_env_reports_channel(self) -> None:
        self.assertIn('sb.append("export ROOT_AVAILABLE=").append(q(CHANNEL_ROOT.equals(chNow) ? "1" : "0"))',
                      HOSTED)
        self.assertIn('sb.append("export DSH_HOSTED_CHANNEL=")', HOSTED)
        self.assertIn("String chNow = activeChannel();", HOSTED)

    def test_staging_fingerprint_is_channel_aware(self) -> None:
        self.assertIn("static String hostedStamp(Context ctx, String fingerprint) {", HOSTED)
        self.assertIn("String fp = hostedStamp(ctx, apkFingerprint(ctx));", HOSTED)
        self.assertIn("String fp = hostedStamp(ctx, fingerprint != null ? fingerprint", HOSTED)
        # 幂等：重复套用不得拼出 |root|root（否则每次启动都重新 staging）
        self.assertIn("if (bar > 0) base = base.substring(0, bar);", HOSTED)

    def test_status_snapshot_carries_channel(self) -> None:
        self.assertIn('public String channel = "";', HOSTED)
        self.assertIn('s.channel = ch == null ? "" : ch;', HOSTED)
        self.assertIn('if (s.channel.length() == 0) line = line + " · " + s.error;', HOSTED)


class Batch95GuardTests(unittest.TestCase):
    """没有通道时如实失败并回退，且安全边界（审批门）不回退。"""

    def test_start_requires_a_channel(self) -> None:
        self.assertIn('if (channel == null) return Result.fail("NO_HOST_CHANNEL");', HOSTED)
        self.assertIn('? "NO_HOST_CHANNEL" : "HOSTED_DISABLED"', MAIN)

    def test_watchdog_and_adopt_guard(self) -> None:
        self.assertIn("if (activeChannel() == null) return false;", HOSTED)   # startWatchdog
        self.assertIn("if (activeChannel() == null) return 0;", HOSTED)       # adoptOnlineEngine

    def test_hosted_keeps_confirm_gate(self) -> None:
        self.assertIn("applyConfirmGate(ctx, true);", HOSTED)


class Batch95SpawnFallbackTests(unittest.TestCase):
    """托管模式让 App 内回落路径首次变得可达 —— dshrootDir 未准备时必须自行补齐，"""
    """不能以「dsh bin.js missing」无限空转（new File(null, child) 是相对路径，不抛 NPE）。"""

    def test_spawn_node_repopulates_dshroot(self) -> None:
        self.assertIn("File dshroot = dshrootDir != null ? dshrootDir : new File(payload, \"dshroot\");", MAIN)
        self.assertIn("dshroot not prepared in spawnNode", MAIN)
        self.assertIn("extractPayload(payload, null, \"dshroot\");", MAIN)
        self.assertIn("dshrootDir = dshroot;", MAIN)


class Batch95ScheduleEngineEnvTests(unittest.TestCase):
    """缺陷修复：定时任务引擎不再把特权通道硬编码为 0。"""

    def test_hardcode_removed(self) -> None:
        self.assertNotIn('env.put("ROOT_AVAILABLE", "0");', SCHED)
        self.assertNotIn('env.put("SHIZUKU_AVAILABLE", "0");', SCHED)

    def test_env_matches_main_engine(self) -> None:
        self.assertIn('env.put("ROOT_AVAILABLE", HostedEngineManager.rootReady() ? "1" : "0");', SCHED)
        self.assertIn('env.put("SHIZUKU_AVAILABLE", HostedEngineManager.shizukuReady() ? "1" : "0");', SCHED)
        self.assertIn('env.put("SHIZUKU_DEX", HostedEngineManager.rishDexPath(ctx));', SCHED)


if __name__ == "__main__":
    unittest.main()
