from __future__ import annotations

import unittest
from pathlib import Path


SOURCE = (
    Path(__file__).resolve().parents[1]
    / "android-app"
    / "src"
    / "com"
    / "deepseek"
    / "harness"
    / "AccessibilityService.java"
).read_text(encoding="utf-8")


class M1ContextSourceTests(unittest.TestCase):
    def test_context_route_is_registered(self) -> None:
        self.assertIn('if (base.equals("/context")) return handleContext();', SOURCE)
        self.assertIn("private String handleContext()", SOURCE)

    def test_context_filters_harness_and_tracks_external_package(self) -> None:
        self.assertNotIn(
            "if (!isSelfPackage(activePackage)) lastExternalPackage = activePackage;",
            SOURCE,
        )
        self.assertIn(
            "if (packageName.isEmpty() || isSelfPackage(packageName)) return o.toString();",
            SOURCE,
        )
        self.assertIn(
            "return packageName != null && packageName.equals(getPackageName());",
            SOURCE,
        )

    def test_context_unavailable_response_has_contract_fields(self) -> None:
        self.assertIn(
            'o.put("reason", REASON_NO_ACCESSIBILITY_READABLE_WINDOW);',
            SOURCE,
        )
        for field in (
            '"ok", false',
            '"available", false',
            '"package", ""',
            '"applicationLabel", ""',
            '"nodeCount", 0',
        ):
            self.assertIn(f"o.put({field});", SOURCE)

    def test_context_display_id_is_fixed_to_main_display(self) -> None:
        # 批次72：主屏解析仍是默认路径（无参 readContextTarget 固定 CONTEXT_DISPLAY_ID），
        # 但窗口枚举改为按 displayId 参数化，供 exclude_self 分支显式指定主屏。
        self.assertIn("private static final int CONTEXT_DISPLAY_ID = 0;", SOURCE)
        self.assertIn('o.put("displayId", CONTEXT_DISPLAY_ID);', SOURCE)
        self.assertIn("return readContextTarget(CONTEXT_DISPLAY_ID);", SOURCE)
        self.assertIn("List<AccessibilityWindowInfo> wins = windowsForDisplay(displayId);", SOURCE)

    def test_context_prefers_recent_external_window_without_reading_other_app(self) -> None:
        # 批次72：最近外部包仍优先命中；但最近目标已消失时必须回退到同一 display 的窗口列表，
        # 不得跨 display 读取缓存（虚拟屏缓存不得充当主屏结果）。
        self.assertIn(
            "if (!preferredPackage.isEmpty() && preferredPackage.equals(packageName)) preferred = target;",
            SOURCE,
        )
        self.assertIn(
            "String preferredPackage = (displayId == CONTEXT_DISPLAY_ID) ? lastExternalPackage : \"\";",
            SOURCE,
        )
        self.assertIn("ContextTarget cached = lastReadableContextTarget;", SOURCE)
        self.assertNotIn(
            "if (!preferredPackage.isEmpty()) return null; // \u6709\u6700\u8fd1\u76ee\u6807\u4f46\u7a97\u53e3\u4e0d\u5339\u914d\u65f6\u4e0d\u5f97\u8bef\u8bfb\u5176\u4ed6\u5e94\u7528",
            SOURCE,
        )

    def test_context_reuses_pre_focus_external_window_snapshot(self) -> None:
        self.assertIn("private volatile ContextTarget lastReadableContextTarget;", SOURCE)
        self.assertIn("rememberCurrentExternalTarget();", SOURCE)
        self.assertIn("window.getType() != AccessibilityWindowInfo.TYPE_APPLICATION", SOURCE)
        self.assertIn("lastReadableContextTarget = new ContextTarget(root, packageName);", SOURCE)
        self.assertIn("ContextTarget cached = lastReadableContextTarget;", SOURCE)
        self.assertIn("preferredPackage.equals(cached.packageName)", SOURCE)
        self.assertIn("return cached;", SOURCE)


if __name__ == "__main__":
    unittest.main()
