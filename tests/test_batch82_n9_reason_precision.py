#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次82-N9 契约：自愈失败时的 reason 精度。

缺陷（批次81 遗留 P2）：虚拟屏动作首次被 App 判 NOT_CREATED → 插件清陈旧守卫并自愈建屏 →
自愈恰好被「只读任务硬闸门」拒（READONLY_TASK）时，插件把自愈失败吞掉、沿用最初的 NOT_CREATED，
模型看到的是「先 android_vscreen_create」——而那正是刚被拒的动作，照做只会再被拒一次。

N9 两处一起收：
  ① App 侧：无会话时的失败原因改成 noSessionReason() —— 只读任务在场时给 READONLY_TASK + 可操作提示；
  ② 插件侧：自愈被「更具体的原因」拒绝时，把这个原因透出去（瞬态失败仍沿用原结果，不用自愈文案覆盖）。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
VS_MGR = (HARNESS / "VscreensManager.java").read_text(encoding="utf-8")
PLUGIN = (ROOT / "plugins" / "dsh-tool-android" / "lib" / "index.js").read_text(encoding="utf-8")
MJS = (ROOT / "tests" / "test_vscreen_router.mjs").read_text(encoding="utf-8")


def _between(source: str, start: str, end: str) -> str:
    i = source.index(start)
    j = source.index(end, i + len(start))
    return source[i:j]


class Batch82N9AppReasonTests(unittest.TestCase):
    """App 侧：无会话时把「只读任务」这个真实原因说清楚。"""

    def test_no_session_reason_helper(self) -> None:
        self.assertIn("private static String noSessionReason() {", VS_MGR)
        helper = _between(VS_MGR, "private static String noSessionReason() {",
                          "private static boolean isScreenInteractive(Context ctx) {")
        self.assertIn("if (OverlayService.isReadOnlyTaskInFlight()) return REASON_READONLY_TASK;", helper)
        self.assertIn("return REASON_NOT_CREATED;", helper)

    def test_proxy_route_uses_helper(self) -> None:
        """两条「服务端不可达 / 无响应」分支都必须走 helper，不能写死 NOT_CREATED。"""
        self.assertEqual(VS_MGR.count("String reason = sessionActive ? REASON_SESSION_DEAD : noSessionReason();"), 2)
        self.assertNotIn("String reason = sessionActive ? REASON_SESSION_DEAD : REASON_NOT_CREATED;", VS_MGR)

    def test_hint_pairs_with_reason(self) -> None:
        self.assertIn("case REASON_READONLY_TASK: return HINT_READONLY_TASK;", VS_MGR)
        self.assertIn('"请改用主屏只读能力（android_screen 传 scope=current）继续，不要重试建屏。"', VS_MGR)

    def test_create_gate_untouched(self) -> None:
        """批次61 的建屏硬闸门保持原样（N9 只改「原因怎么说」，不改「能不能建」）。"""
        gate = _between(VS_MGR, "private void handleCreate(", "SelectResult sel = ensureSession(")
        self.assertIn("if (OverlayService.isReadOnlyTaskInFlight()) {", gate)
        self.assertIn("failJson(REASON_READONLY_TASK, HINT_READONLY_TASK)", gate)


class Batch82N9PluginRetryTests(unittest.TestCase):
    """插件侧：自愈失败时透出更具体的 reason，瞬态不覆盖。"""

    def test_retry_only_on_session_level_reasons(self) -> None:
        body = _between(PLUGIN, "async function vscreenRetryAfterSessionLoss(ctx, res, again) {",
                        "function vscreenBridge(method, path, bodyObj, timeoutMs) {")
        self.assertIn('if (reason !== "NOT_CREATED" && reason !== "SESSION_DEAD") return null;', body)
        self.assertIn("setVscreenCreated(false);", body)

    def test_self_heal_specific_reason_is_surfaced(self) -> None:
        body = _between(PLUGIN, "async function vscreenRetryAfterSessionLoss(ctx, res, again) {",
                        "function vscreenBridge(method, path, bodyObj, timeoutMs) {")
        self.assertIn("const r = ensured.reason;", body)
        self.assertIn('r !== "NOT_CREATED" && r !== "SESSION_DEAD" && r !== "BRIDGE_UNREACHABLE"', body)
        self.assertIn("return { status: 200, json: { ok: false, reason: r, hint: ensured.hint, detail: ensured.error } };",
                      body)
        # 瞬态/无原因 → 仍沿用原失败结果（既有错误契约不被自愈文案覆盖）
        self.assertIn("return null;", body)

    def test_offline_case_pinned_in_mjs(self) -> None:
        """离线回归用例必须钉住两条口径（正例 READONLY_TASK / 负例保留 NOT_CREATED）。"""
        self.assertIn("[Test 14] 验证自愈失败时的 reason 精度（批次82-N9）", MJS)
        self.assertIn('assert.strictEqual(res.reason, "READONLY_TASK"'
                      + ', "必须透出自愈的真实原因，而不是最初的 NOT_CREATED");', MJS)
        self.assertIn('assert.strictEqual(negRes.reason, "NOT_CREATED", "瞬态（非会话级）自愈失败不得替换原有 reason");', MJS)
        self.assertIn("全部 14 组测试用例 100% 通过断言！", MJS)


if __name__ == "__main__":
    unittest.main()

