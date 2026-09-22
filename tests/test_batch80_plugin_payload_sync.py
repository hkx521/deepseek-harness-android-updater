from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BASE_APK = ROOT / "android-app" / "DeepSeekHarness.apk"
TOOL = ROOT / "tools" / "sync_base_apk_plugins.py"


class PluginPayloadSyncGateTests(unittest.TestCase):
    """批次80 闸门：`plugins/**` 必须已经同步进 base APK 的 `assets/payload.zip`。

    背景（2026-09-18 真机复现）：本地增量构建（b47）**不重建 assets/**，插件真正随 payload 分发；
    批次74/75 只改了 `plugins/` 并跑增量构建 → 设备侧 dsh-tool-accessibility 仍是旧版本
    （payload sha b1133e2d，缺批次74/75 改动）。本测试就是防止「改了插件却没进 APK」再次静默发生。

    base APK 是 git-ignored 的构建输入，缺失时跳过（新克隆环境属预期）。
    """

    def test_payload_plugins_in_sync(self) -> None:
        if not BASE_APK.is_file():
            self.skipTest("base APK 不在工作区（构建输入，gitignore）")
        proc = subprocess.run([sys.executable, str(TOOL), "--check"],
                              capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=180)
        self.assertEqual(proc.returncode, 0,
                         "plugins/ 与 base APK payload 不一致；请运行 "
                         "`python tools/sync_base_apk_plugins.py` 后重新构建\n"
                         + (proc.stdout or "") + (proc.stderr or ""))


if __name__ == "__main__":
    unittest.main()
