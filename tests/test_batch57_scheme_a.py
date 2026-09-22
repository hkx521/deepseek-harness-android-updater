# -*- coding: utf-8 -*-
"""
批次 57 · 方案 A：交互感知与可读性深度打磨契约测试。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OVERLAY_SERVICE = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness" / "OverlayService.java"
PROMOTED_NOTIFIER = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness" / "PromotedProgressNotifier.java"

def extract_action_word(text: str, step_num: int) -> str:
    if text:
        t = text.lower()
        if any(k in t for k in ["问", "question", "answer", "回答", "作答"]):
            return "请作答"
        if any(k in t for k in ["识屏", "屏幕", "截图", "screenshot", "read_screen", "ocr", "inspect"]):
            return "识屏"
        if any(k in t for k in ["定位", "查找", "find", "element", "node", "控件"]):
            return "定位"
        if any(k in t for k in ["输入", "type", "input", "key", "填", "text"]):
            return "输入"
        if any(k in t for k in ["点击", "click", "tap", "按"]):
            return "点击"
        if any(k in t for k in ["滑动", "swipe", "scroll", "翻"]):
            return "滑动"
        if any(k in t for k in ["提交", "submit", "发送"]):
            return "提交"
    return "步" + str(min(step_num, 20)) if step_num > 0 else "运行中"

def duration_label(secs: int) -> str:
    if secs >= 3600:
        return str(secs // 3600) + "h" + str((secs % 3600) // 60) + "m"
    if secs >= 60:
        return str(secs // 60) + "m" + str(secs % 60) + "s"
    return str(secs) + "s"

def compact_short_label(text: str, step_num: int, elapsed_secs: int) -> str:
    action = extract_action_word(text, step_num)
    if action == "请作答":
        return "请作答 ⏳"
    if elapsed_secs <= 0:
        return action
    dur = duration_label(elapsed_secs)
    with_elapsed = action + " · " + dur
    if len(with_elapsed) <= 8:
        return with_elapsed
    tight = action + dur
    return tight if len(tight) <= 8 else action

def test_capsule_action_extraction():
    assert extract_action_word("正在识屏并截图...", 1) == "识屏"
    assert extract_action_word("查找登录按钮定位元素", 2) == "定位"
    assert extract_action_word("正在输入密码", 3) == "输入"
    assert extract_action_word("点击确认", 4) == "点击"
    assert extract_action_word("向上滑动一屏", 5) == "滑动"
    assert extract_action_word("等待用户回答提问", 0) == "请作答"
    assert extract_action_word("思考下一步动作", 3) == "步3"
    assert extract_action_word("", 0) == "运行中"

def test_capsule_compact_short_label_length_budget():
    cases = [
        ("正在截图分析屏幕...", 1, 2, "识屏 · 2s"),
        ("定位确认按钮", 2, 14, "定位 · 14s"),
        ("正在模拟输入文本", 3, 5, "输入 · 5s"),
        ("等待用户回答提问", 0, 10, "请作答 ⏳"),
        ("执行通用步骤", 4, 30, "步4 · 30s"),
        ("超长任务识屏", 1, 125, "识屏2m5s"),
    ]
    for text, step, elapsed, expected in cases:
        lbl = compact_short_label(text, step, elapsed)
        assert len(lbl) <= 8, "Label exceeds 8 chars budget!"
        assert lbl == expected

def test_promoted_notifier_source_contract():
    content = PROMOTED_NOTIFIER.read_text(encoding="utf-8")
    assert "extractActionWord" in content
    assert "compactShortLabel" in content
    assert 'SHORT_DONE = "完成 ✓"' in content
    assert "compactShortLabel(lastText, step, elapsedSecs)" in content

def test_overlay_service_source_contract():
    content = OVERLAY_SERVICE.read_text(encoding="utf-8")
    assert "historyBtn" in content
    assert "showHistoryDialog" in content
    assert "saveTaskHistory" in content
    assert "currentPrompt" in content
    assert "task_history_items" in content
    assert "SimpleMarkdownParser" in content
    assert "extractCodeBlocks" in content
    assert "复制代码" in content
    assert "SimpleMarkdownParser.parse(" in content
