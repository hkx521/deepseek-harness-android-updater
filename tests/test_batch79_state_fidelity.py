from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
CLIENT = HARNESS / "OverlayAgentClient.java"
OVERLAY = HARNESS / "OverlayService.java"
SCHEDULE = HARNESS / "ScheduleExecutor.java"
MAIN = HARNESS / "MainActivity.java"


def _between(source: str, start_marker: str, end_marker: str) -> str:
    start = source.index(start_marker)
    end = source.index(end_marker, start + len(start_marker))
    return source[start:end]


class Batch79ClientStateFidelityTests(unittest.TestCase):
    """批次79（T4）：助手状态 = 引擎状态的忠实投影。

    批次76 取证的三条误判路径里，批次77 已删掉「本地判死」；本批次收口两条残留：
      1) running=false 只代表「此刻没在跑」——引擎在 checkpoint 拼接 / queue 排队 /
         轮间空档都会短暂为 false，旧实现「连续 30 轮（≈30s）running=false 就中性收尾」
         仍会抢在引擎前面宣布「任务：已结束」；
      2) 助手收尾后没有回到引擎状态的通路，用户只能看着面板与 dsh 分叉。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.source = CLIENT.read_text(encoding="utf-8")

    def test_neutral_end_requires_real_silence(self) -> None:
        """中性收尾门槛：120 轮，且必须「既没在跑、也没有新事件」。"""
        self.assertIn("private static final int ENDED_WITHOUT_RESULT_ROUNDS = 120;", self.source)
        self.assertNotIn("ENDED_WITHOUT_RESULT_ROUNDS = 30;", self.source)
        self.assertIn("final boolean seqAdvanced = latestSeq > lastSeenSeq;", self.source)

        block = _between(self.source, "if (!sessionRunning) {", "Thread.sleep(POLL_INTERVAL_MS);")
        # 计数仍建立在「会话未运行」之上（旧契约不变），新增的是「有新事件即清零」的静默门
        self.assertIn("endedRounds++;", block)
        reset = block.index("if (seqAdvanced) {")
        self.assertIn("endedRounds = 0;", block[reset:])
        self.assertIn("if (!seqAdvanced && endedRounds >= ENDED_WITHOUT_RESULT_ROUNDS)", block)

    def test_track_prefix_and_settle_rounds(self) -> None:
        self.assertIn('public static final String TRACK_RESULT_PREFIX = "【续跟】";', self.source)
        self.assertIn("private static final int TRACK_SETTLE_ROUNDS = 10;", self.source)

    def test_track_never_prompts_or_cancels(self) -> None:
        """续跟是只读的：不发 prompt、不新建会话、不 cancel。"""
        self.assertIn("void track(String sessionId, final Listener listener) {", self.source)
        body = _between(self.source, "private String trackSession(", "private static String trackSnapshot(")
        for forbidden in (
            'rpc("session.prompt"',
            'rpc("session.create"',
            'rpc("session.cancel"',
            'put("mode", "queue")',
        ):
            self.assertNotIn(forbidden, body, "续跟不得出现 %s" % forbidden)
        self.assertIn('rpc("session.list"', body)
        self.assertIn("fetchPage(", body)
        # 跟踪无终态时只报「仍在运行」，绝不判失败
        self.assertIn("跟踪超时（引擎侧仍在运行", body)

    def test_track_snapshot_reports_engine_state(self) -> None:
        snap = _between(self.source, "private static String trackSnapshot(", "void cancel() {")
        self.assertIn("TRACK_RESULT_PREFIX", snap)
        self.assertIn("已运行结束", snap)
        self.assertIn("当前空闲", snap)

    def test_page_state_exposes_latest_assistant_text(self) -> None:
        """续跟没有 requestId 可匹配，只能展示窗口内最后一条助手文本。"""
        self.assertIn("String latestAssistantText;", self.source)
        self.assertIn("state.latestAssistantText = latest;", self.source)


class Batch79OverlayStateFidelityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = OVERLAY.read_text(encoding="utf-8")

    def test_session_probe_sends_cookie_and_slash_path(self) -> None:
        """面板的会话探测曾经恒 401（无 Cookie + 点号路径），导致「AI：回复中…」永远显示空闲。"""
        self.assertIn('"/api/session/list"', self.source)
        self.assertNotIn("/api/session.list", self.source)
        self.assertIn('c.setRequestProperty("Cookie", engineCookie);', self.source)
        self.assertIn('getString("engine_cookie", null)', self.source)

    def test_track_entry_visible_only_on_terminal_states(self) -> None:
        self.assertIn('trackChip = makeChip("🔄 续跟引擎", "", false);', self.source)
        self.assertIn('if ("🔄 续跟引擎".equals(label)) {', self.source)
        self.assertIn("private void startTrackingSession() {", self.source)
        self.assertIn("private void updateTrackChip(String text) {", self.source)
        gate = _between(self.source, "private void updateTrackChip(String text) {", "private static String shortSessionId(")
        self.assertIn('text.startsWith("任务：失败")', gate)
        self.assertIn('text.startsWith("任务：已结束")', gate)
        self.assertIn("submitInFlight || (client != null && client.isRunning())", gate)

    def test_track_calls_client_track_and_never_resubmits(self) -> None:
        body = _between(
            self.source,
            "private void startTrackingSession() {",
            "private static String summarizeText(",
        )
        self.assertIn("client.track(target, new OverlayAgentClient.Listener() {", body)
        self.assertNotIn("client.submit(", body)
        self.assertNotIn("saveTaskHistory(", body, "续跟不写任务历史")
        self.assertIn('getString("overlay_last_session_id", "")', body)

    def test_history_items_carry_session_id(self) -> None:
        self.assertIn('item.put("sessionId", histSession.trim());', self.source)
        self.assertIn('final String sessionId = obj.optString("sessionId", "");', self.source)
        self.assertIn("showHistoryItemActions(prompt, result, sessionId);", self.source)
        self.assertIn('"🔄 续跟该会话"', self.source)
        # 批次82-N5：动作数组插入了「🔁 重新执行」（索引 1），「🔄 续跟该会话」由 3 顺延为 4
        self.assertIn("else if (which == 4 && hasSession) {", self.source)
        self.assertIn('putString("overlay_last_session_id", sessionId.trim())', self.source)

    def test_neutral_end_still_recognised(self) -> None:
        """批次77 的中性终态语义不能回退（仍是「已结束」，不是失败）。"""
        self.assertIn("summary.startsWith(OverlayAgentClient.ENDED_WITHOUT_RESULT_TEXT)", self.source)
        self.assertIn('setTaskStatus("任务：已结束（引擎侧本轮已结束，未取到文本）")', self.source)


class Batch79EngineEventBypassTests(unittest.TestCase):
    """批次79（T4）：事件旁路的最终裁决 —— **不做**（有真机取证）。

    只读调查显示 `$events` 白名单里存在会话级 emit（`api-session/status` 等），但真机实测
    （2026-09-18 23:31，任务运行中、每秒都有会话活动）App 的 mux 在整段窗口里**只收到 ready 帧**，
    没有任何 `emit` 帧 → 该通路在当前 dsh 0.1.5 部署下不投递会话状态。判据：
    ① `[b79] frame type=ready keys=type,clientId,host` 仅此一行；② 全程无 `emit` 行；
    ③ 面板「AI：回复中…」已由 session/list 轮询（Cookie 修复）正确驱动。
    因此不保留任何 emit 消费代码（避免「声明了却不生效」的死代码），本类只锁「mux 不得
    因新增长期语义而改动提问/审批链路」这一既有边界。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.mux = (HARNESS / "DshEventMux.java").read_text(encoding="utf-8")
        cls.client = CLIENT.read_text(encoding="utf-8")

    def test_mux_keeps_only_question_and_approval_semantics(self) -> None:
        self.assertIn("void onQuestion(String eventId, String agentId, JSONObject request);", self.mux)
        self.assertIn("void onApproval(String eventId, String agentId, JSONObject request);", self.mux)
        self.assertIn("void onCleared(String eventId);", self.mux)
        for dropped in ("onSessionStatus", "api-session/status", "EVENT_SESSION_STATUS"):
            self.assertNotIn(dropped, self.mux, "事件旁路已裁决不做：%s 不应残留" % dropped)

    def test_neutral_end_has_idle_absolute_cap(self) -> None:
        """兜底：running=false 连续 600 轮（≈10min）也中性收尾，避免杂散事件把面板永久挂着。"""
        self.assertIn("private static final int IDLE_WITHOUT_RESULT_ABS_CAP_ROUNDS = 600;", self.client)
        block = _between(self.client, "if (!sessionRunning) {", "Thread.sleep(POLL_INTERVAL_MS);")
        self.assertIn("idleRounds++;", block)
        self.assertIn("if (idleRounds >= IDLE_WITHOUT_RESULT_ABS_CAP_ROUNDS)", block)
        self.assertIn("idleRounds = 0;", block)


class Batch79SilentBreakageFixTests(unittest.TestCase):
    """批次79 附带修复：两处「功能静默失效」（脚本化 e2e 真机取证发现，见 §5.2）。

    A) 定时任务链路：dsh 0.1.5 把首页放到 process token 门禁后（无 token 恒 401），
       `ScheduleExecutor.engineReady()` 旧实现读到 401 即抛异常 → 恒 false → 「引擎未运行 →
       30 秒未就绪，放弃」，任务既不执行也不发布实况窗。401 + 该文案恰恰证明引擎活着。
    B) 设置页实况窗开关：保活卡片 8 个 WRAP_CONTENT 按钮把后 5 个压成 0 宽（dump 丢弃 w<=0
       节点、坐标点击打空），用户根本够不到该开关 → 改横向滚动容器。
    """

    def test_schedule_executor_treats_gated_401_as_alive(self) -> None:
        src = SCHEDULE.read_text(encoding="utf-8")
        self.assertIn("if (code == 401) {", src)
        self.assertIn('contains("dsh web authentication required")', src)
        self.assertNotIn("if (code < 200 || code >= 500) return false;", src)

    def test_keepalive_button_row_scrolls_instead_of_zero_width(self) -> None:
        src = MAIN.read_text(encoding="utf-8")
        self.assertIn("HorizontalScrollView btnsScroll = new HorizontalScrollView(this);", src)
        self.assertIn("btnsScroll.addView(btns, new FrameLayout.LayoutParams(", src)
        self.assertIn("keepAliveCard.addView(btnsScroll);", src)
        self.assertNotIn("keepAliveCard.addView(btns);", src)


if __name__ == "__main__":
    unittest.main()
