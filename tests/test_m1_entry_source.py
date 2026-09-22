from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = (ROOT / "android-app" / "AndroidManifest.xml").read_text(encoding="utf-8")
TILE_SRC = (ROOT / "android-app" / "src" / "com" / "deepseek" / "harness" / "AssistantTileService.java").read_text(encoding="utf-8")
PROCESS_SRC = (ROOT / "android-app" / "src" / "com" / "deepseek" / "harness" / "ProcessTextActivity.java").read_text(encoding="utf-8")
ASSIST_SRC = (ROOT / "android-app" / "src" / "com" / "deepseek" / "harness" / "AssistActivity.java").read_text(encoding="utf-8")
OVERLAY_SRC = (ROOT / "android-app" / "src" / "com" / "deepseek" / "harness" / "OverlayService.java").read_text(encoding="utf-8")


class M1EntrySourceTests(unittest.TestCase):
    def test_manifest_registers_all_p1_system_entries(self) -> None:
        """批次42：AndroidManifest 必须注册磁贴、划词和助手三个系统级入口。"""
        self.assertIn(".AssistantTileService", MANIFEST)
        self.assertIn("android.service.quicksettings.action.QS_TILE", MANIFEST)
        self.assertIn("android.permission.BIND_QUICK_SETTINGS_TILE", MANIFEST)

        self.assertIn(".ProcessTextActivity", MANIFEST)
        self.assertIn("android.intent.action.PROCESS_TEXT", MANIFEST)
        self.assertIn('android:mimeType="text/plain"', MANIFEST)

        self.assertIn(".AssistActivity", MANIFEST)
        self.assertIn("android.intent.action.ASSIST", MANIFEST)

    def test_tile_service_implements_contract(self) -> None:
        self.assertIn("extends TileService", TILE_SRC)
        self.assertIn("getQsTile()", TILE_SRC)
        self.assertIn("OverlayService.toggleOrShowFromTile(this)", TILE_SRC)

    def test_process_text_activity_extracts_and_routes(self) -> None:
        self.assertIn("Intent.EXTRA_PROCESS_TEXT", PROCESS_SRC)
        self.assertIn("OverlayService.handleIncomingText(this, selected)", PROCESS_SRC)

    def test_overlay_service_provides_external_entry_hooks(self) -> None:
        self.assertIn("public static void toggleOrShowFromTile(Context ctx)", OVERLAY_SRC)
        self.assertIn("public static void handleIncomingText(Context ctx, final String text)", OVERLAY_SRC)


if __name__ == "__main__":
    unittest.main()
