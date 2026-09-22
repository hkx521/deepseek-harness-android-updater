#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次82-N4 契约：助手状态接上引擎的 `session/follow` 真事件流（turn/message 级推送）。

背景（见 docs/批次82-N4-会话事件流.md）：
  现状是 1s 轮询 `session/list`（读 running + projections.asOfSeq）→ `session/page`（throughSeq=asOfSeq）
  的快照链路，状态延迟 1~3s 且靠启发式。引擎侧其实有一条**流式 Remote 方法**：
  `session/follow(request:{address,maxMessages?,assistantStream?}, signal) -> AsyncIterable<SessionFollowFrame>`，
  帧形状 = snapshot | {type:'event',event} | {type:'assistant-stream',frame}（见引擎
  `@deepseek-ai/dsh-api-session-controller/lib/types/types.d.ts`）。

批次79 曾裁决「`$events` 不投递 api-session/* emit」，因此 N4 **不走 emit**，而是复用同一条
`/api/remote.mux` WebSocket 开**第二条逻辑流**（streamId 分流），这样也自然绕开该通道的边沿触发/不补发限制。
判定口径：事件流只做「状态实时化」（AI 文案 + turn 结束立刻催一次刷新），收尾与结果仍由既有轮询 + RPC 负责。
"""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
MUX = (HARNESS / "DshEventMux.java").read_text(encoding="utf-8")
OVS = (HARNESS / "OverlayService.java").read_text(encoding="utf-8")


def _between(source: str, start: str, end: str) -> str:
    i = source.index(start)
    j = source.index(end, i + len(start))
    return source[i:j]


class Batch82N4MuxStreamTests(unittest.TestCase):
    """mux：第二条逻辑流（session/follow）+ 按 streamId 分流；既有 $events 语义保持不变。"""

    def test_second_stream_constants(self) -> None:
        self.assertIn('private static final String SESSION_STREAM_ID = "overlay-session";', MUX)
        self.assertIn('private static final String SESSION_FOLLOW_ENDPOINT = "session/follow";', MUX)
        # 既有 $events 常量与开流帧一字不动（批次55B 闸门继续生效）
        self.assertIn('private static final String EVENTS_ENDPOINT = "$events";', MUX)
        self.assertIn('private static final String STREAM_ID = "overlay-events";', MUX)

    def test_follow_open_frame_uses_args_request_and_session_address(self) -> None:
        body = _between(MUX, "private void sendSessionOpen() {", "private void sendCancel(String streamId) {")
        self.assertIn('address.put("kind", "session");', body)
        self.assertIn('address.put("sessionId", sessionId);', body)
        self.assertIn('request.put("address", address);', body)
        self.assertIn('request.put("assistantStream", true);', body)
        self.assertIn('args.put("request", request);', body)
        self.assertIn('payload.put("args", args);', body)
        self.assertIn('open.put("endpoint", SESSION_FOLLOW_ENDPOINT);', body)
        self.assertIn('open.put("streamId", SESSION_STREAM_ID);', body)

    def test_items_are_routed_by_stream_id(self) -> None:
        body = _between(MUX, "private void handleText(String text) {", "private void handleValue(JSONObject value) {")
        self.assertIn('String streamId = message.optString("streamId", "");', body)
        self.assertIn("boolean sessionStream = SESSION_STREAM_ID.equals(streamId);", body)
        self.assertIn("if (listener != null) listener.onSessionFrame(value);", body)

    def test_session_stream_end_or_error_does_not_kill_events_stream(self) -> None:
        body = _between(MUX, "private void handleText(String text) {", "private void handleValue(JSONObject value) {")
        session_err = _between(body, "if (sessionStream) {", 'Log.w(TAG, "事件流错误')
        self.assertNotIn("reopenRequested = true;", session_err)
        session_end = _between(body, "if (sessionStream) {", "reopenRequested = true;")
        self.assertIn("sessionStreamOpen = false;", session_end)

    def test_follow_lifecycle_and_reconnect(self) -> None:
        self.assertIn("void followSession(String sessionId) {", MUX)
        self.assertIn("void unfollowSession() {", MUX)
        # 重连后自动补开第二条流
        conn = _between(MUX, "private Socket openConnection() throws IOException {", "private String plainProbe() {")
        self.assertIn("sessionStreamOpen = false;", conn)
        self.assertIn("sendSessionOpen();", conn)
        # 取消帧只取消这一条流
        cancel = _between(MUX, "private void sendCancel(String streamId) {", "private static String shortId(String id) {")
        self.assertIn('cancel.put("type", "cancel");', cancel)
        self.assertIn('cancel.put("streamId", streamId);', cancel)
        # stop() 清理 follow 状态
        stop = _between(MUX, "void stop() {", "boolean isConnected() {")
        self.assertIn('followSessionId = "";', stop)

    def test_batch79_boundary_kept(self) -> None:
        """批次79 的边界不回退：不消费 emit、不出现被裁决掉的会话状态命名。"""
        for dropped in ("onSessionStatus", "api-session/status", "EVENT_SESSION_STATUS"):
            self.assertNotIn(dropped, MUX)


class Batch82N4OverlayWiringTests(unittest.TestCase):
    """OverlayService：订阅、接帧、收尾关流、AI 文案 TTL。"""

    def test_listener_implements_new_callbacks(self) -> None:
        self.assertIn("public void onSessionFrame(final JSONObject frame) {", OVS)
        self.assertIn("public void onSessionStreamState(final boolean open, final String detail) {", OVS)
        self.assertIn("handleSessionFrame(frame);", OVS)

    def test_follow_on_start_unfollow_on_teardown(self) -> None:
        started = _between(OVS, "@Override public void onStarted(String sessionId) {", "postAgentCallback(generation")
        self.assertIn("eventMux.followSession(sessionId);", started)
        # 收尾关流：①onResult（成功/失败/中性）；②cancelCommand（取消；急停走的就是它）
        self.assertGreaterEqual(OVS.count("eventMux.unfollowSession();"), 2,
                                "收尾路径（onResult / cancelCommand）都要关掉第二条流")
        on_result = _between(OVS, "public void onResult(String text) {", "public void onError(")
        self.assertIn("eventMux.unfollowSession();", on_result)
        cancel = _between(OVS, "private void cancelCommand() {", "private void postAgentCallback(")
        self.assertIn("eventMux.unfollowSession();", cancel)
        # 服务销毁：会话流状态一并清空
        stop = _between(OVS, "private void stopEventMux() {", "/** 提问/审批卡片骨架")
        self.assertIn("sessionStreamActive = false;", stop)
        self.assertIn('sessionEventText = "";', stop)

    def test_frame_handling_covers_snapshot_assistant_and_turn(self) -> None:
        body = _between(OVS, "private void handleSessionFrame(JSONObject frame) {", "private void setSessionEventText(String text) {")
        self.assertIn('if ("snapshot".equals(type)) {', body)
        self.assertIn('if ("assistant-stream".equals(type)) {', body)
        self.assertIn('if ("event".equals(type)) {', body)
        self.assertIn('if ("start".equals(frameType)) {', body)
        self.assertIn('} else if ("chunk".equals(frameType)) {', body)
        self.assertIn('} else if ("end".equals(frameType)) {', body)
        self.assertIn('if ("turn/start".equals(name)) {', body)
        self.assertIn('} else if ("turn/end".equals(name)) {', body)
        self.assertEqual(body.count("kickSessionRefresh();"), 2, "assistant end 与 turn/end 各催一次刷新")

    def test_kick_refresh_reuses_poll_probe(self) -> None:
        body = _between(OVS, "private void kickSessionRefresh() {", "private void showInteractionCard(")
        self.assertIn("final SessionInfo si = fetchSessionInfo();", body)
        self.assertIn("lastSessionRunning = si.running;", body)
        self.assertIn("updateEngineStatusUi();", body)
        # 事件流不复制收尾逻辑：不得在事件回调里直接判成败
        self.assertNotIn("saveTaskHistory", body)
        self.assertNotIn("renderResult", body)

    def test_ai_text_prefers_fresh_event_text(self) -> None:
        block = _between(OVS, "if (aiText != null) {", "if (portText != null) {")
        self.assertIn("boolean sessionEventFresh = !sessionEventText.isEmpty()", block)
        self.assertIn("< 2500L;", block)
        self.assertIn("aiText.setText(sessionEventText);", block)
        self.assertIn('aiText.setText(lastSessionRunning ? "AI：回复中…" : "AI：空闲");', block)

    def test_event_text_ttl_and_kind_logging(self) -> None:
        body = _between(OVS, "private void setSessionEventText(String text) {", "private boolean logSessionEventKindOnce(")
        self.assertIn("sessionEventTextAt = System.currentTimeMillis();", body)
        kinds = _between(OVS, "private boolean logSessionEventKindOnce(String name) {", "private void kickSessionRefresh() {")
        self.assertIn("sessionEventKinds.indexOf(name) >= 0", kinds)
        self.assertIn("sessionEventKinds.append(name)", kinds)


if __name__ == "__main__":
    unittest.main()
