from __future__ import annotations

import ast
import io
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_TOOLS = ROOT / "tools" / "b47_build.py"
BUILD_LOCAL = ROOT / ".local" / "b47_build.py"
SYNC_TOOL = ROOT / "tools" / "sync_base_apk_plugins.py"
PAYLOAD_NAME = "assets/payload.zip"


def _func_src(path: Path, name: str) -> str:
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text)
    lines = text.splitlines()
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return "\n".join(lines[node.lineno - 1:node.end_lineno])
    raise AssertionError("构建脚本里找不到函数 %s" % name)


class BuildPluginSyncHookTests(unittest.TestCase):
    """批次81-T1 闸门：pack 阶段必须在重新打包前把 `plugins/**` 同步进 base APK payload。

    背景（2026-09-18 真机复现）：本地增量构建不重建 `assets/**`，设备侧插件来自
    `assets/payload.zip`；漏跑 `tools/sync_base_apk_plugins.py` 就会「改了插件却没进 APK」。
    批次80 只加了 pytest 闸门（记得跑才拦得住），本批次把同步钉进构建期。
    """

    def test_repack_syncs_plugins_before_repacking(self) -> None:
        seg = _func_src(BUILD_TOOLS, "stage_repack")
        self.assertIn("sync_plugins()", seg,
                      "stage_repack 必须调用 sync_plugins()")
        sync_at = seg.index("sync_plugins()")
        patch_at = seg.index("patch_base_apk_attachment")
        self.assertLess(sync_at, patch_at,
                        "插件同步必须发生在 pack 前置其它补丁之前")

    def test_sync_plugins_helper_contract(self) -> None:
        seg = _func_src(BUILD_TOOLS, "sync_plugins")
        self.assertIn("sync_base_apk_plugins.py", seg,
                      "同步必须复用 tools/sync_base_apk_plugins.py（幂等实现）")
        self.assertIn("--check", seg, "先 --check，一致时不做无谓重写")
        self.assertIn("run(", seg, "不一致时必须自动同步，而不是只提示")
        self.assertIn("B47_PLUGIN_STRICT", seg,
                      "需要一条「不一致就失败」的交付前严格模式")

    def test_tools_and_local_build_scripts_identical(self) -> None:
        if not BUILD_LOCAL.is_file():
            self.skipTest(".local/b47_build.py 不在工作区（gitignore，新克隆属预期）")
        self.assertEqual(
            BUILD_LOCAL.read_bytes(), BUILD_TOOLS.read_bytes(),
            "两份构建脚本已分叉；请以 tools/b47_build.py 为准执行 "
            "copy tools\\b47_build.py .local\\b47_build.py")

    def test_sync_tool_rewrites_stale_payload(self) -> None:
        """行为验证：用假 APK 证明 sync 工具真能把过期插件文件写回 payload。"""
        sys.path.insert(0, str(ROOT / "tools"))
        import sync_base_apk_plugins as sync  # noqa: E402

        want = sync.repo_plugin_files()
        self.assertTrue(want, "plugins/ 下应至少有一个插件文件")
        suffixes = sorted(want)
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / "fake.apk"
            payload = io.BytesIO()
            with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED) as zp:
                for suffix in suffixes:
                    zp.writestr("dshhome/profiles/web/" + suffix, b"stale-bytes")
            with zipfile.ZipFile(fake, "w", zipfile.ZIP_DEFLATED) as z:
                z.writestr(PAYLOAD_NAME, payload.getvalue())

            check = subprocess.run(
                [sys.executable, str(SYNC_TOOL), "--apk", str(fake), "--check"],
                capture_output=True, text=True, encoding="utf-8",
                errors="replace", timeout=180)
            self.assertEqual(check.returncode, 1,
                             "过期 payload 必须被 --check 判为不一致\n"
                             + (check.stdout or "") + (check.stderr or ""))

            run = subprocess.run(
                [sys.executable, str(SYNC_TOOL), "--apk", str(fake)],
                capture_output=True, text=True, encoding="utf-8",
                errors="replace", timeout=180)
            self.assertEqual(run.returncode, 0,
                             "同步应当成功\n" + (run.stdout or "") + (run.stderr or ""))

            with zipfile.ZipFile(fake) as z:
                after = z.read(PAYLOAD_NAME)
            with zipfile.ZipFile(io.BytesIO(after)) as zp:
                names = zp.namelist()
                for suffix in suffixes:
                    hit = [n for n in names if n.endswith("/" + suffix)]
                    self.assertEqual(len(hit), 1, "payload 里 %s 必须唯一条目" % suffix)
                    self.assertEqual(zp.read(hit[0]), want[suffix],
                                     "同步后 %s 必须与 plugins/ 字节一致" % suffix)


if __name__ == "__main__":
    unittest.main()
