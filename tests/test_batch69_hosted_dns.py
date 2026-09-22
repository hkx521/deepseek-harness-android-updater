"""批次69 契约：托管引擎 DNS（App 私有 resolv.conf shell 读不到 → EAI_AGAIN）。

背景（2026-09-18 真机取证）：payload 的 glibc 被二进制补丁写死读
`/data/user/0/com.deepseek.harness/files/etc/r.conf`（实测 libc.so.6 内该字符串唯一）。App 内模式
同 uid 没问题；托管引擎跑在 shell uid=2000，`cat` 该文件 → Permission denied，glibc 拿不到
nameserver → `dns.lookup` 返回 `EAI_AGAIN` → **所有出网请求失败**：Command Code 的模型目录
（api.commandcode.ai / unpkg.com）拉不到 → 模型列表空；DeepSeek API 请求失败。
修复：start/staging 用 node 改写托管 libc 的路径字符串到 shell 可读路径，并在每次启动刷新配置。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
HOSTED_SRC = (PKG / "HostedEngineManager.java").read_text(encoding="utf-8")
MAIN_SRC = (PKG / "MainActivity.java").read_text(encoding="utf-8")

STAGE = HOSTED_SRC[HOSTED_SRC.index("static String stageScriptText()"):HOSTED_SRC.index("static String startScriptText()")]
START = HOSTED_SRC[HOSTED_SRC.index("static String startScriptText()"):HOSTED_SRC.index("static String watchdogScriptText()")]


class Batch69ResolverPathTests(unittest.TestCase):
    """路径契约：App 私有路径（二进制补丁写死）与托管可读路径。"""

    def test_constants(self) -> None:
        self.assertIn('static final String RESOLV_PATH_APP_PRIVATE = "/data/user/0/com.deepseek.harness/files/etc/r.conf";',
                      HOSTED_SRC)
        self.assertIn('static final String RESOLV_PATH_HOSTED = HOSTED_DIR + "/etc/r.conf";', HOSTED_SRC)
        self.assertIn('static final String RESOLVER_PATCH_SCRIPT_NAME = "fix-hosted-resolver.cjs";', HOSTED_SRC)
        self.assertIn('static final String HOSTED_RESOLV_NAME = "hosted-resolv.conf";', HOSTED_SRC)

    def test_patch_script_is_binary_safe_and_idempotent(self) -> None:
        body = HOSTED_SRC[HOSTED_SRC.index("static String resolverPatchScriptText()"):]
        body = body[:body.index("private static int copyTreeMissing")]
        self.assertIn("Buffer.alloc(FROM.length, 0)", body, "必须以 NUL 补齐到原长度（C 字符串）")
        self.assertIn("fs.renameSync(tmp, LIBC)", body, "必须原子替换")
        self.assertIn("fs.chmodSync(tmp, 0o755)", body)
        self.assertIn("process.argv[2]", body)
        self.assertIn("if (TO.length > FROM.length)", body, "目标路径过长必须放弃而不是写坏二进制")
        self.assertIn("replaced=", body)

    def test_patch_script_has_valid_javascript_syntax(self) -> None:
        """防退化：提取生成的 fix-hosted-resolver.cjs 并在本地通过 node --check 验证语法合法。"""
        import subprocess
        import tempfile
        body = HOSTED_SRC[HOSTED_SRC.index("static String resolverPatchScriptText()"):]
        body = body[:body.index("return ")] + body[body.index("return ")+7:body.index(";\n    }")]
        body = body.replace('" + HOSTED_DIR + "', '/data/local/tmp/dsh')
        body = body.replace('" + RESOLV_PATH_APP_PRIVATE + "', '/data/user/0/com.deepseek.harness/files/etc/r.conf')
        body = body.replace('" + RESOLV_PATH_HOSTED + "', '/data/local/tmp/dsh/etc/r.conf')
        lines = []
        for line in body.splitlines():
            line = line.strip()
            if line.startswith('+ '):
                line = line[2:]
            if line.startswith('"') and line.endswith('"'):
                content = line[1:-1]
                content = content.replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\')
                lines.append(content)
        script_text = ''.join(lines)
        with tempfile.NamedTemporaryFile('w', suffix='.cjs', delete=False, encoding='utf-8') as f:
            f.write(script_text)
            tmp_name = f.name
        try:
            res = subprocess.run(['node', '--check', tmp_name], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, f"fix-hosted-resolver.cjs has syntax errors:\n{res.stderr}")
        finally:
            Path(tmp_name).unlink(missing_ok=True)



class Batch69ScriptsTests(unittest.TestCase):
    """脚本契约：staging 后改写一次 + 每次启动刷新 DNS 配置。"""

    def test_stage_runs_patch_after_unzip(self) -> None:
        self.assertIn("RESOLVER_PATCH_SCRIPT_NAME", STAGE, "staging 必须跑改写脚本")
        self.assertIn("runtime/bin/node.glibc", STAGE, "用托管自带的 glibc node")
        self.assertLess(STAGE.index("unzip -o"), STAGE.index("RESOLVER_PATCH_SCRIPT_NAME"))
        # 真机踩过：插入块末尾漏 \n 会把下一条语句粘成 "…; fichmod -R 755 …" → unmatched 'if'
        self.assertIn(r"2>&1 | tail -2; fi\n", STAGE)

    def test_start_has_etc_dir_and_resolv_refresh(self) -> None:
        for needle in ("/etc", "HOSTED_RESOLV_NAME", "cp -f", "chmod 644", "grep -q", "nameserver"):
            self.assertIn(needle, START, "start 脚本缺件：" + needle)
        self.assertIn("dumpsys connectivity", START, "缺 dumpsys 兜底 DNS 源")
        self.assertIn("223.5.5.5", START, "缺公共 DNS 兜底")

    def test_start_repatches_if_still_old(self) -> None:
        self.assertIn("grep -aq", START, "启动时要检测 libc 是否仍是旧路径")
        self.assertIn("RESOLV_PATH_APP_PRIVATE", START)
        self.assertIn("RESOLVER_PATCH_SCRIPT_NAME", START)

    def test_scripts_are_synced_into_hosted_dir(self) -> None:
        self.assertIn("RESOLVER_PATCH_SCRIPT_NAME", HOSTED_SRC[HOSTED_SRC.index("static boolean syncScriptsToHostedDir"):HOSTED_SRC.index("static boolean writeEngineEnv")])
        self.assertIn("RESOLVER_PATCH_SCRIPT_NAME", HOSTED_SRC[HOSTED_SRC.index("static void writeScripts"):HOSTED_SRC.index("static boolean syncScriptsToHostedDir")])


class Batch69DnsSourceTests(unittest.TestCase):
    """DNS 来源与 App 内模式同源（一处实现，两种模式共用）。"""

    def test_resolv_conf_text_has_all_sources(self) -> None:
        body = HOSTED_SRC[HOSTED_SRC.index("static String resolvConfText(Context ctx)"):]
        body = body[:body.index("static void writeSharedResolvConf")]
        for needle in ("/system/etc/resolv.conf", "net.dns1", "net.dns2", "dumpsys", "nameserver"):
            self.assertIn(needle, body, "DNS 来源缺件：" + needle)
        self.assertIn("223.5.5.5", body)

    def test_hosted_resolv_conf_is_written_on_start(self) -> None:
        self.assertIn("writeSharedResolvConf(ctx);", HOSTED_SRC)
        self.assertIn("static void writeSharedResolvConf(Context ctx)", HOSTED_SRC)
        self.assertIn("stagingDir(ctx)", HOSTED_SRC[HOSTED_SRC.index("static void writeSharedResolvConf"):])

    def test_main_activity_delegates_to_shared_builder(self) -> None:
        self.assertIn("HostedEngineManager.resolvConfText(this)", MAIN_SRC,
                      "App 内模式必须复用同一套 DNS 探测（避免两处逻辑分叉）")
        self.assertIn("static String resolvConfText(Context ctx)", HOSTED_SRC)


class Batch69StaleStagingTests(unittest.TestCase):
    """覆盖安装后必须重 staging（收养路径不经过 startEngine，不修就一直跑旧 payload/脚本）。"""

    def test_adopt_path_restages_on_apk_change(self) -> None:
        adopt = HOSTED_SRC[HOSTED_SRC.index("public static int adoptOnlineEngine(Context ctx)"):]
        adopt = adopt[:adopt.index("public static boolean ensureRunning(Context ctx)")]
        self.assertIn("static boolean stagedFingerprintMatches(Context ctx)", HOSTED_SRC)
        self.assertIn("if (!stagedFingerprintMatches(ctx))", adopt)
        self.assertIn("[b69] staged payload stale (APK upgraded) -> restage + restart hosted engine", adopt)
        self.assertIn('startEngine(ctx, new File(ctx.getFilesDir(), "payload"), apkFingerprint(ctx), true)', adopt)


class Batch69StartLockTests(unittest.TestCase):
    """单实例启动锁：App 与看护同时拉起会各起一个 node 抢 3080。"""

    def test_start_script_has_atomic_lock(self) -> None:
        self.assertIn("start.lock", START)
        self.assertIn("start already in progress pid=", START)
        self.assertIn("$LOCK", START)

    def test_stop_engine_clears_start_lock(self) -> None:
        self.assertIn("$D/start.lock", HOSTED_SRC)
if __name__ == "__main__":
    unittest.main()
