"""批次68 契约：托管 home 与用户数据的三条硬规则。

背景（2026-09-18 真机取证）：批次67 上线托管引擎后，用户报「刚改好的模型突然不能用了 / 没有模型显示」。
取证结论两条：
1. staging 的 `cp -rf "$DIR/dshhome/." "$DIR/home/"` 用**包内种子**覆盖了共享 home 里的用户配置
   （实测 settings.yaml 826 B → 88 B，且后者与 android-app/staging/dshhome/settings.yaml 逐字节一致）；
2. 插件自有状态文件（dsh-agy 的账号池 `<DSH_HOME>/agy-accounts.json`）不在搬运/镜像白名单里，
   而托管 home 与共享 home 目录不共享 → 引擎永远看不到 → `No agy account configured`。

本文件按既有 mirror-contract 风格（源码文本断言）锁住修复，防止回退。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
HOSTED_SRC = (PKG / "HostedEngineManager.java").read_text(encoding="utf-8")

STAGE = HOSTED_SRC[HOSTED_SRC.index("static String stageScriptText()"):HOSTED_SRC.index("static String startScriptText()")]
START = HOSTED_SRC[HOSTED_SRC.index("static String startScriptText()"):HOSTED_SRC.index("static String watchdogScriptText()")]


class Batch68SeedClobberTests(unittest.TestCase):
    """包内种子只补缺，绝不覆盖用户/插件自有文件。"""

    def test_seed_no_longer_clobbers_home(self) -> None:
        self.assertNotIn(r"cp -rf \"$DIR/dshhome/.\" \"$DIR/home/\"", STAGE,
                         "staging 又变回无条件 cp -rf：会把用户 settings.yaml 冲成包内默认")
        self.assertIn("keep=1", STAGE)
        self.assertIn(r'cp -rf \"$e\" \"$DIR/home/\"', STAGE)

    def test_user_file_list_covers_plugin_state(self) -> None:
        self.assertIn("static final String[] HOME_USER_FILES", HOSTED_SRC)
        for name in ("settings.yaml", ".credentials.yaml", ".anonymous-user-id",
                     "agy-master-key.json", "agy-accounts.json", "agy-fingerprint-data.json"):
            self.assertIn('"' + name + '"', HOSTED_SRC, "HOME_USER_FILES 缺条目：" + name)

    def test_user_list_is_shared_to_shell(self) -> None:
        """脚本用 homeUserFilesShellList() 拼清单（不用 String.join，兼容旧 API）。"""
        self.assertIn("private static String homeUserFilesShellList()", HOSTED_SRC)
        self.assertIn(r'"  for u in " + homeUserFilesShellList() + "\n"', STAGE)


class Batch68CarryTests(unittest.TestCase):
    """home 根目录普通文件双向搬运：补缺 + mtime 新者胜 + 覆盖前备份。"""

    def test_carry_defined_and_used_both_ways(self) -> None:
        self.assertIn("carry()", START)
        self.assertIn(r'carry \"$SH\" \"$DIR/home\"', START)
        self.assertIn(r'carry \"$DIR/home\" \"$SH\"', START)

    def test_carry_semantics(self) -> None:
        self.assertIn("-nt", START, "缺少 mtime 新者胜判据")
        self.assertIn("cmp -s", START, "缺少内容比较（避免无意义回写/备份膨胀）")
        self.assertIn(".bak-$(date +%s)", START, "覆盖前必须备份")
        self.assertIn("*.bak-*|.migrated-*", START, "备份文件与迁移标记不参与搬运")
        self.assertIn(r"for f in \"$SRC\"/* \"$SRC\"/.[!.]* \"$SRC\"/..?*", START,
                      "必须覆盖隐藏文件（.credentials.yaml 等）")

    def test_carry_in_happens_before_early_exit(self) -> None:
        """引擎已在跑时也要先把共享侧新配置搬进内部 home，早退检查必须在其后。"""
        self.assertLess(START.index(r'carry \"$SH\" \"$DIR/home\"'),
                        START.index("already running pid=$P"))

    def test_agy_account_pool_is_owner_only(self) -> None:
        """dsh-agy 的账号池同样走 assertOwnerOnly，内部副本必须 600。"""
        self.assertIn(r'chmod 600 \"$DIR/home/agy-accounts.json\"', START)

    def test_whitelist_mirror_back_removed(self) -> None:
        self.assertNotIn(r'if [ -f \"$DIR/home/$f\" ]; then cp -f \"$DIR/home/$f\" \"$SH/$f\"', START,
                         "回镜像又变回白名单无条件覆盖（会冲掉共享侧用户配置）")


class Batch68RepairTests(unittest.TestCase):
    """一次性修复迁移：把私有 home 的用户配置与插件状态捞回共享 home。"""

    def test_repair_hooked_into_start_engine(self) -> None:
        self.assertIn("repairPrivateHomeOnce(ctx, payload);", HOSTED_SRC)
        self.assertIn("if (repaired)", HOSTED_SRC)
        self.assertIn("[b68] private home repaired -> restart hosted engine", HOSTED_SRC)

    def test_repair_is_one_shot_and_marked(self) -> None:
        self.assertIn('static final String REPAIR_MARKER = ".repaired-private-home-v2";', HOSTED_SRC)
        self.assertIn("static boolean repairPrivateHomeOnce(Context ctx, File payload)", HOSTED_SRC)
        self.assertIn("if (marker.isFile()) return false;", HOSTED_SRC)

    def test_repair_only_overwrites_seed_derived_files(self) -> None:
        """只在「共享侧是包内种子残骸」或「私有侧更大」时以私有侧覆盖，且先备份。"""
        self.assertIn("boolean seedDerived = isSeedDefault(ctx, name, d);", HOSTED_SRC)
        self.assertIn("if (!seedDerived && s.length() <= d.length()) continue;", HOSTED_SRC)
        self.assertIn("private static boolean isSeedDefault(Context ctx, String name, File target)", HOSTED_SRC)
        self.assertIn("private static byte[] readZipEntry(InputStream raw, String entryName)", HOSTED_SRC)
        self.assertIn('readZipEntry(ctx.getAssets().open(PAYLOAD_ZIP_NAME), "dshhome/" + name)', HOSTED_SRC)
        self.assertIn('name + ".bak-" + (ts / 1000)', HOSTED_SRC)
        self.assertIn("private static boolean sameContent(File a, File b)", HOSTED_SRC)

    def test_repair_touches_mtime_so_carry_picks_it_up(self) -> None:
        self.assertGreaterEqual(HOSTED_SRC.count("d.setLastModified(System.currentTimeMillis());"), 2)

    def test_repair_also_hooked_in_adopt_path(self) -> None:
        """引擎已在线时的「收养」路径也必须跑修复（真机实测：冷启动走的就是收养，startEngine 根本不被调用）。"""
        adopt = HOSTED_SRC[HOSTED_SRC.index("public static int adoptOnlineEngine(Context ctx)"):]
        adopt = adopt[:adopt.index("public static boolean ensureRunning(Context ctx)")]
        self.assertIn("repairPrivateHomeOnce(ctx, null)", adopt)
        self.assertIn("startEngine(ctx, null, null, true)", adopt)
        self.assertIn("[b68] home repaired -> restart hosted engine (adopt path)", adopt)


if __name__ == "__main__":
    unittest.main()
