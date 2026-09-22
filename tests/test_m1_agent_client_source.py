from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLIENT = (
    ROOT
    / "android-app"
    / "src"
    / "com"
    / "deepseek"
    / "harness"
    / "OverlayAgentClient.java"
)


class OverlayAgentClientSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = CLIENT.read_text(encoding="utf-8")

    def test_through_seq_uses_as_of_seq(self) -> None:
        """批次38 P0 根因回归：throughSeq 必须取会话 asOfSeq。

        引擎按 log.slice(0, throughSeq + 1) 切片：
          - throughSeq=-1 -> 空数组，records 恒为 0（真机复现：拿不到任何回复）
          - 省略该字段   -> gateway/input-invalid（该字段必填）
        """
        # 批次77：取数抽到 fetchPage(...)，throughSeq 仍必须来自 session.list 的 asOfSeq（latestSeq）
        self.assertIn("fetchPage(taskGeneration, sessionId, latestSeq", self.source)
        self.assertIn('pagePayload.put("throughSeq", throughSeq);', self.source)
        self.assertNotIn('pagePayload.put("throughSeq", -1);', self.source)
        self.assertIn("private static long sessionAsOfSeq(JSONObject summary)", self.source)
        self.assertIn('projections.optLong("asOfSeq", -1L)', self.source)

    def test_poll_does_not_kill_task_on_transient_not_running(self) -> None:
        """批次77（用户拍板「助手只展示 dsh 的真实状态」）：

        旧契约（批次38 P0）在 running=false 连续 3 轮（约 3s）时抛
        [poll/turn-ended-no-output] 判死 —— 实测会把「轮间 / checkpoint 拼接 / queue 排队」
        的中间态误判成失败，而引擎侧任务仍在继续（用户报的「dsh 还在跑、助手说失败」）。
        新契约：本地不再据此判死，只计数；长时间取不到本轮终态才中性收尾。
        """
        self.assertNotIn('"turn-ended-no-output"', self.source)
        self.assertIn("int endedRounds = 0;", self.source)
        self.assertIn("endedRounds >= ENDED_WITHOUT_RESULT_ROUNDS", self.source)
        self.assertIn("return ENDED_WITHOUT_RESULT_TEXT;", self.source)
        # 计数必须建立在「会话未运行」之上
        start = self.source.index("if (!sessionRunning) {", self.source.index("endedRounds"))
        end = self.source.index("} else {", start)
        self.assertIn("endedRounds++", self.source[start:end])

    def test_failures_carry_stage_and_code(self) -> None:
        """批次38 P0：错误必须带 stage/code，便于判别与支持。"""
        self.assertIn("final String stage;", self.source)
        self.assertIn("final String code;", self.source)
        self.assertIn("String describe()", self.source)
        self.assertIn("e.describe()", self.source)

    def test_contract_and_build_manifest(self) -> None:
        self.assertIn("final class OverlayAgentClient", self.source)
        self.assertIn("interface Listener", self.source)
        for signature in (
            "void onStarted(String sessionId);",
            "void onProgress(String text);",
            "void onPartial(String text);",
            "void onDiag(String info);",
            "void onResult(String text);",
            "void onError(String message);",
            "OverlayAgentClient(Context ctx)",
            "boolean isRunning()",
            "void submit(String prompt, final Listener listener)",
            "void cancel()",
            "void close()",
        ):
            self.assertIn(signature, self.source)

        build = (ROOT / "android-app" / "build.sh").read_text(encoding="utf-8")
        self.assertIn("OverlayAgentClient.java", build)

    def test_uses_http_json_rpc_without_lambda_or_websocket(self) -> None:
        self.assertIn("HttpURLConnection", self.source)
        self.assertIn("import org.json.JSONObject;", self.source)
        self.assertIn('envelope.put("type", "client-request");', self.source)
        self.assertIn('String endpoint = method.replace(\'.\', \'/\');', self.source)
        self.assertIn('"/api/" + endpoint', self.source)
        self.assertIn('envelope.put("method", endpoint);', self.source)
        self.assertIn('String argumentName = "session.list".equals(method) ? "_request" : "request";', self.source)
        self.assertIn('arguments.put(argumentName, payload);', self.source)
        self.assertIn('payloadWrapper.put("args", arguments);', self.source)
        self.assertIn('envelope.put("payload", payloadWrapper);', self.source)
        self.assertIn('"server-response".equals(root.optString("type", ""))', self.source)
        self.assertNotIn("WebSocket", self.source)
        self.assertNotIn("->", self.source)
        self.assertNotIn("::", self.source)

    def test_prompt_page_and_cancel_payloads_match_schema(self) -> None:
        self.assertIn('rpc("session.create"', self.source)
        self.assertIn('rpc("session.list"', self.source)
        self.assertIn('rpc("session.prompt"', self.source)
        self.assertIn('rpc("session.page"', self.source)
        self.assertIn('rpc("session.cancel"', self.source)
        self.assertIn('promptPayload.put("requestId", requestId);', self.source)
        self.assertIn('promptPayload.put("mode", "queue");', self.source)
        self.assertIn("JSONArray content = new JSONArray();", self.source)
        self.assertIn('textBlock.put("type", "text");', self.source)
        self.assertIn('pagePayload.put("throughSeq", throughSeq);', self.source)
        self.assertIn('pagePayload.put("maxMessages", maxMessages);', self.source)
        self.assertIn('address.put("kind", "session");', self.source)
        self.assertIn('cancelPayload.put("sessionId", cancelSessionId);', self.source)

    def test_batch77_assistant_follows_engine_state(self) -> None:
        """批次77 契约：状态以引擎（dsh）为准，本地只做保守兜底。"""
        self.assertIn("private PageState fetchPage(", self.source)
        self.assertIn("PAGE_MAX_MESSAGES_WIDE", self.source)
        self.assertIn("boolean retryIo", self.source)
        self.assertIn("POLL_IO_MAX_ATTEMPTS", self.source)
        self.assertIn("private static boolean isRetryableIo(AgentException e)", self.source)
        self.assertIn("page.completedWithoutText && page.promptSeq >= 0", self.source)
        self.assertIn("state.promptSeq = promptSeq;", self.source)
        self.assertIn("ACTIVITY_ABSOLUTE_CAP_MS", self.source)
        # 重试只允许网络类错误；提交类 RPC（create/prompt/cancel）一律单次，避免重复投递
        self.assertIn('return e != null && "net".equals(e.stage);', self.source)
        self.assertIn('private static final long[] POLL_IO_BACKOFF_MS = { 1000L, 2000L, 4000L };',
                      self.source)
        self.assertIn('rpc("session.page", pagePayload, taskGeneration, false, true)', self.source)
        self.assertIn('rpc("session.list", listPayload, taskGeneration, false, true)', self.source)
        self.assertIn("return rpc(method, payload, taskGeneration, cancelCall, false);", self.source)

    def test_polls_list_and_page_then_returns_current_turn_result(self) -> None:
        self.assertIn('"assistant/message".equals(type)', self.source)
        self.assertIn("assistantText(data)", self.source)
        self.assertIn('requestId.equals(rpcId)', self.source)
        self.assertIn("parsePage(pageValue, requestId)", self.source)
        self.assertIn("if (!sessionRunning && page.resultText != null)", self.source)
        self.assertIn("TOTAL_TIMEOUT_MS", self.source)
        self.assertIn("POLL_INTERVAL_MS", self.source)

    def test_session_resume_persistence_and_explicit_failures(self) -> None:
        self.assertIn('"overlay_last_session_id"', self.source)
        self.assertIn("findSession(listValue, stored)", self.source)
        self.assertIn('"auth", "http-401"', self.source)
        self.assertIn("HTTP 401", self.source)
        self.assertIn('"引擎不可达"', self.source)
        self.assertIn('"引擎请求超时"', self.source)
        self.assertIn('"DSH 响应解析失败"', self.source)

    def test_cancel_close_and_sensitive_log_boundaries(self) -> None:
        self.assertIn("cancelRequested = true;", self.source)
        self.assertIn("task.interrupt();", self.source)
        self.assertIn("closed = true;", self.source)
        self.assertIn("disconnectActiveConnection();", self.source)
        self.assertIn('prefs.getString(KEY_COOKIE, null)', self.source)
        self.assertNotIn("local_token", self.source)
        self.assertNotIn("X-DSH-Token", self.source)
        self.assertNotIn("Log.w(TAG, response", self.source)
        self.assertNotIn("Log.i(TAG, response", self.source)


    def test_batch41_adaptive_timeout_and_tool_tracking(self) -> None:
        """批次41：自适应长任务生命周期与工具调用轨迹捕获。"""
        self.assertIn("TOTAL_TIMEOUT_MS = 600000L;", self.source)
        self.assertIn("STEP_IDLE_TIMEOUT_MS = 120000L;", self.source)
        self.assertIn('"tool/call".equals(type)', self.source)
        self.assertIn("friendlyTool(page.lastTool)", self.source)
        self.assertIn("void resetSession()", self.source)

if __name__ == "__main__":
    unittest.main()


