#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次78 契约：看护判据（端口归属 / MODE_CONFLICT）+ App 内模式用户数据接共享 home。"""
import pathlib
import unittest

PKG = pathlib.Path(__file__).resolve().parents[1] / "android-app" / "src" / "com" / "deepseek" / "harness"


class EngineModeContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.hosted = (PKG / "HostedEngineManager.java").read_text(encoding="utf-8")
        cls.main = (PKG / "MainActivity.java").read_text(encoding="utf-8")
        cls.sched = (PKG / "ScheduleExecutor.java").read_text(encoding="utf-8")
        cls.overlay = (PKG / "OverlayService.java").read_text(encoding="utf-8")

    def test_watchdog_checks_port_owner(self) -> None:
        """看护必须确认 3080 真由 engine.pid 持有，而不是「端口有人听」。"""
        self.assertIn("INODE=$(grep '0100007F:0C08.*0A' /proc/net/tcp", self.hosted)
        self.assertIn('ls -l \\"/proc/$P/fd\\"', self.hosted)
        self.assertIn("socket:\\\\[$INODE\\\\]", self.hosted)
        self.assertIn("state=MODE_CONFLICT", self.hosted)
        self.assertIn("mode conflict: 3080 held by another process", self.hosted)

    def test_conflict_resets_attempt_budget(self) -> None:
        """冲突分支必须复位重试预算，否则 App 内引擎退出后托管引擎永远拉不回来。"""
        marker = "state=MODE_CONFLICT"
        i = self.hosted.index(marker)
        seg = self.hosted[max(0, i - 500):i]
        self.assertIn("ATT=0", seg)
        self.assertIn('if [ \\"$LISTEN\\" != \\"0\\" ] && [ \\"$OWNER\\" = \\"0\\" ]', self.hosted)

    def test_watchdog_keeps_ok_and_restart_paths(self) -> None:
        self.assertIn("state=OK pid=$P attempts=$ATT", self.hosted)
        self.assertIn("state=RESTART attempt=$ATT", self.hosted)
        self.assertIn("state=COOLDOWN attempts=$ATT", self.hosted)

    def test_app_internal_home_links_shared_data(self) -> None:
        dirs = self.hosted.split("SHARED_DATA_DIRS = {")[1][:120]
        for name in ("sessions", "attachments", "storages"):
            self.assertIn('"%s"' % name, dirs)
        self.assertIn("public static void linkSharedData(File internalHome, Context ctx)", self.hosted)
        self.assertIn("Os.symlink(target.getAbsolutePath(), link.getAbsolutePath());", self.hosted)
        seg = self.hosted[self.hosted.index("public static void linkSharedData"):]
        seg = seg[:seg.index("private static boolean isSameSymlink")]
        # 只补缺、不删用户数据：先补拷到共享目录，再把私有目录改名留存
        self.assertIn("copyTreeMissing(link, target, 0)", seg)
        self.assertIn(".private-bak-", seg)
        self.assertIn("link.renameTo(bak)", seg)
        self.assertNotIn(".delete()", seg)

    def test_link_call_sites(self) -> None:
        self.assertIn("HostedEngineManager.linkSharedData(home, this);", self.main)
        self.assertIn("HostedEngineManager.linkSharedData(home, ctx);", self.sched)


    def test_watchdog_script_change_bounces_watchdog(self) -> None:
        """看护脚本变化时必须弹掉在跑的看护进程，否则旧脚本（已解析进内存）让修复不生效。"""
        self.assertIn('private static final String WATCHDOG_SCRIPT_FP_KEY = "watchdog_script_fp";',
                      self.hosted)
        self.assertIn("boolean wdChanged = !wdFp.equals(sp.getString(WATCHDOG_SCRIPT_FP_KEY",
                      self.hosted)
        self.assertIn("watchdog script changed", self.hosted)
        seg = self.hosted[self.hosted.index("if (ok && wdChanged) {"):]
        seg = seg[:seg.index("return ok;")]
        self.assertIn('kill \\"$P\\" 2>/dev/null', seg)
        self.assertIn('rm -rf " + HOSTED_DIR + "/watchdog.lock', seg)
        self.assertIn("startWatchdog(ctx);", seg)

    def test_engine_mode_recorded_and_shown(self) -> None:
        """ⓘ 详情必须能看出当前引擎模式（用户自查「任务落在哪个 home」）。"""
        self.assertIn("private void recordEngineMode(String mode)", self.main)
        self.assertIn('putString("engine_mode", mode)', self.main)
        # 批次95：模式标签改经 HostedEngineManager.modeLabel（区分 托管(root) / 托管(shell) / App 内），
        # 不再写死 "托管(shell)"。
        self.assertIn('recordEngineMode(HostedEngineManager.modeLabel(this))', self.main)
        self.assertIn('recordEngineMode("App 内")', self.main)
        self.assertIn("engineMode = HostedEngineManager.modeLabel(this);", self.overlay)
        self.assertIn('+ " · 模式：" + engineMode', self.overlay)
        self.assertIn("用户数据：共享 home", self.overlay)

if __name__ == "__main__":
    unittest.main()
