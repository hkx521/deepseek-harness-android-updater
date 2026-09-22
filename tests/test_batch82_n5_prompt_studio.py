#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次82-N5 契约：Prompt Studio（指令库管理页 + 顺序管理 + 改完即时刷新）。

批次60 已落地数据层与面板药丸渲染；N5 只补三块缺口：
  ① 用户可发现的管理入口（设置页入口行 + PromptStudio 管理页）；
  ② 顺序管理（moveUp / moveDown = 与相邻项交换 order；不动 moveToTop）；
  ③ 改完立即生效（OverlayService 的同进程静态刷新入口）。
另补方案2 的「🔁 重新执行」（历史项一键重跑）。

边界（本文件同时钉住）：
  - 存储契约不变：唯一存储点仍是 dsh_prefs/custom_prompt_chips（管理页不自己碰 SharedPreferences）；
  - 芯片模型不加 pinned 之类第二套排序语义（只用 order）；
  - N5 不碰插件、不碰 N1 的面板终态药丸插入点（quickRow 索引 0/1/2）。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
OVERLAY = (HARNESS / "OverlayService.java").read_text(encoding="utf-8")
MAIN = (HARNESS / "MainActivity.java").read_text(encoding="utf-8")
MGR = (HARNESS / "PromptChipManager.java").read_text(encoding="utf-8")
ITEM = (HARNESS / "PromptChipItem.java").read_text(encoding="utf-8")
STUDIO = (HARNESS / "PromptStudio.java").read_text(encoding="utf-8")
BUILD = (ROOT / "tools" / "b47_build.py").read_text(encoding="utf-8")
PLUGIN_A = (ROOT / "plugins" / "dsh-tool-android" / "lib" / "index.js").read_text(encoding="utf-8")
PLUGIN_B = (ROOT / "plugins" / "dsh-tool-accessibility" / "lib" / "index.js").read_text(encoding="utf-8")


def _between(source: str, start: str, end: str) -> str:
    i = source.index(start)
    j = source.index(end, i + len(start))
    return source[i:j]


class Batch82N5ManagerOrderTests(unittest.TestCase):
    """顺序管理与上限：一律用 order 字段表达。"""

    def test_move_up_down_and_cap_exist(self) -> None:
        self.assertIn("public static final int MAX_CHIPS = 30;", MGR)
        self.assertIn("public static boolean isFull(Context ctx)", MGR)
        self.assertIn("public static synchronized boolean moveUp(Context ctx, String id)", MGR)
        self.assertIn("public static synchronized boolean moveDown(Context ctx, String id)", MGR)
        self.assertIn("return swapNeighbour(ctx, id, -1);", MGR)
        self.assertIn("return swapNeighbour(ctx, id, 1);", MGR)

    def test_swap_semantics_and_move_to_top_untouched(self) -> None:
        swap = _between(MGR, "private static boolean swapNeighbour(", "public static synchronized void resetToDefault(")
        self.assertIn("int other = index + delta;", swap)
        self.assertIn("if (index < 0 || other < 0 || other >= list.size()) return false;", swap)
        self.assertIn("list.get(index).order = list.get(other).order;", swap)
        self.assertIn("target.order = minOrder - 1;", MGR)

    def test_no_second_sort_semantics(self) -> None:
        """不加 pinned 之类第二套语义（只有 order）。"""
        self.assertNotIn("pinned", MGR)
        self.assertNotIn("pinned", ITEM)
        self.assertIn('public static final String KEY_CUSTOM_CHIPS = "custom_prompt_chips";', MGR)
        self.assertIn('public static final String PREFS = "dsh_prefs";', MGR)


class Batch82N5StudioPageTests(unittest.TestCase):
    """管理页：只通过 PromptChipManager 读写，窗口类型由调用方决定。"""

    def test_public_entry(self) -> None:
        self.assertIn("public final class PromptStudio {", STUDIO)
        self.assertIn("public static void show(final Context ctx, final boolean overlayWindow, final Runnable onChanged)",
                      STUDIO)

    def test_storage_contract_not_bypassed(self) -> None:
        """管理页不得自己碰 SharedPreferences（唯一存储点仍是 PromptChipManager）。"""
        self.assertNotIn("getSharedPreferences", STUDIO)
        self.assertNotIn(".edit()", STUDIO)
        self.assertNotIn("putString(", STUDIO)
        for call in ("PromptChipManager.getChips(", "PromptChipManager.addChip(",
                     "PromptChipManager.updateChip(", "PromptChipManager.deleteChip(",
                     "PromptChipManager.moveToTop(", "PromptChipManager.moveUp(",
                     "PromptChipManager.moveDown(", "PromptChipManager.resetToDefault(",
                     "PromptChipManager.isFull(", "PromptChipManager.MAX_CHIPS"):
            self.assertIn(call, STUDIO, call)
    def test_builtin_delete_guard_survives(self) -> None:
        """内置项可编辑/可排序，但不给删除按钮（沿用 deleteChip 的保护）。"""
        self.assertIn("if (!item.isBuiltin) {", STUDIO)
        self.assertIn("PromptChipManager.deleteChip(ctx, item.id)", STUDIO)
        self.assertIn('toast(ctx, "内置药丸不可删除");', STUDIO)
    def test_overlay_window_type_only_when_requested(self) -> None:
        self.assertIn("if (overlayWindow) {", STUDIO)
        self.assertIn("win.setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);", STUDIO)
        self.assertIn("if (overlayWindow && d.getWindow() != null) {", STUDIO)
    def test_edit_dialog_and_footer_actions(self) -> None:
        self.assertIn('b.setTitle(isNew ? "➕ 新建指令药丸" : ("✏️ 编辑 · " + item.label));', STUDIO)
        self.assertIn('row.addView(pill(ctx, "➕ 新建"', STUDIO)
        self.assertIn('row.addView(pill(ctx, "🔄 恢复默认"', STUDIO)
        self.assertIn('b.setMessage("会重置为 4 个内置药丸，自己新增的药丸将全部丢失。确定继续？");', STUDIO)


class Batch82N5WiringTests(unittest.TestCase):
    """接线：面板刷新入口 + 设置页入口行 + 历史一键重跑 + 边界。"""

    def test_overlay_refresh_hook(self) -> None:
        self.assertIn("static void refreshPromptChipsFromOutside() {", OVERLAY)
        hook = _between(OVERLAY, "static void refreshPromptChipsFromOutside() {",
                        "private void renderPromptChips() {")
        self.assertIn("final OverlayService s = instance;", hook)
        self.assertIn("if (s == null) return;", hook)
        self.assertIn("s.handler.post(new Runnable() {", hook)
        self.assertIn("s.renderPromptChips();", hook)
        self.assertIn("OverlayService.refreshPromptChipsFromOutside();", STUDIO)
    def test_overlay_manage_dialog_has_move_items(self) -> None:
        self.assertIn('"⬆ 上移", "⬇ 下移"', OVERLAY)
        self.assertIn("PromptChipManager.moveUp(OverlayService.this, item.id)", OVERLAY)
        self.assertIn("PromptChipManager.moveDown(OverlayService.this, item.id)", OVERLAY)
    def test_n1_terminal_chips_boundary_untouched(self) -> None:
        """N5 不得挪动 N1 的面板终态药丸插入点。"""
        self.assertIn("quickRow.addView(newChatChip, 0);", OVERLAY)
        self.assertIn("quickRow.addView(trackChip, 1);", OVERLAY)
        self.assertIn("quickRow.addView(proceedChip, 2);", OVERLAY)
    def test_settings_entry_and_studio_launch(self) -> None:
        self.assertIn('csText.setText("指令库 · 常用指令药丸', MAIN)
        self.assertIn("PromptStudio.show(MainActivity.this, false, null);", MAIN)
        self.assertIn("PromptChipManager.getChips(this).size()", MAIN)
    def test_history_rerun_action(self) -> None:
        self.assertIn('"🔁 重新执行"', OVERLAY)
        self.assertIn("applyQuickAction(prompt);", OVERLAY)
        self.assertIn("} else if (which == 4 && hasSession) {", OVERLAY)
    def test_build_registers_studio_and_plugins_untouched(self) -> None:
        self.assertIn("PromptStudio", BUILD)
        for src in (PLUGIN_A, PLUGIN_B):
            self.assertNotIn("PromptStudio", src)
            self.assertNotIn("custom_prompt_chips", src)


if __name__ == "__main__":
    unittest.main()
