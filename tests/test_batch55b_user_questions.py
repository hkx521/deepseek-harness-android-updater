from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
MUX_SRC = (PKG / 'DshEventMux.java').read_text(encoding='utf-8')
OVERLAY_SRC = (PKG / 'OverlayService.java').read_text(encoding='utf-8')
AGENT_SRC = (PKG / 'OverlayAgentClient.java').read_text(encoding='utf-8')


def code_only(source: str) -> str:
    '''剥掉 // 行注释与 javadoc 行：反向闸门只针对真实代码，历史说明允许留在注释里。'''
    kept = []
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith(('//', '*', '/*')):
            continue
        kept.append(line)
    return '\n'.join(kept)


class Batch55BMuxProtocolTests(unittest.TestCase):
    '''批次55-B 下行：手写最小 RFC6455 客户端接 /api/remote.mux，开 $events 逻辑流。'''

    def test_endpoint_constants(self) -> None:
        self.assertIn('private static final String MUX_PATH = "/api/remote.mux";', MUX_SRC)
        self.assertIn('private static final String EVENTS_ENDPOINT = "$events";', MUX_SRC)
        self.assertIn('private static final String RESULT_ENDPOINT = "$events/result";', MUX_SRC)
        self.assertIn('private static final String STREAM_ID = "overlay-events";', MUX_SRC)
        '''事件名出处：packages/api/remotes/src/remote-events.ts'''
        self.assertIn('private static final String EVENT_QUESTION = "user-questions/request";', MUX_SRC)
        self.assertIn('private static final String EVENT_APPROVAL = "approval/request";', MUX_SRC)

    def test_upgrade_request_headers_loopback_host_cookie_no_origin(self) -> None:
        '''升级请求：Host 必须是 loopback authority + dsh_prefs 里的 engine_cookie；带 Origin 会被拒。'''
        self.assertIn('request.append("GET ").append(MUX_PATH).append(" HTTP/1.1\\r\\n");', MUX_SRC)
        self.assertIn('request.append("Host: 127.0.0.1:").append(enginePort).append("\\r\\n");', MUX_SRC)
        self.assertIn('request.append("Upgrade: websocket\\r\\n");', MUX_SRC)
        self.assertIn('request.append("Connection: Upgrade\\r\\n");', MUX_SRC)
        self.assertIn('request.append("Sec-WebSocket-Key: ").append(key).append("\\r\\n");', MUX_SRC)
        self.assertIn('request.append("Sec-WebSocket-Version: 13\\r\\n");', MUX_SRC)
        self.assertIn('request.append("Cookie: ").append(cookie).append("\\r\\n");', MUX_SRC)
        self.assertIn('request.append("\\r\\n");', MUX_SRC)
        self.assertIn('private static final String PREFS = "dsh_prefs";', MUX_SRC)
        self.assertIn('private static final String KEY_COOKIE = "engine_cookie";', MUX_SRC)
        # 注释里保留「不带 Origin」的取证结论，但任何 request.append 行都不得写入 Origin
        header_lines = [line for line in MUX_SRC.splitlines() if 'request.append(' in line]
        self.assertTrue(header_lines)
        for line in header_lines:
            self.assertNotIn('Origin', line, '升级请求不得带 Origin：' + line.strip())

    def test_handshake_verifies_accept_and_key_is_16_random_bytes(self) -> None:
        self.assertIn('private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";', MUX_SRC)
        self.assertIn('byte[] nonce = new byte[16];', MUX_SRC)
        self.assertIn('return Base64.encodeToString(nonce, Base64.NO_WRAP);', MUX_SRC)
        self.assertIn('if (statusLine == null || statusLine.indexOf(" 101") < 0) {', MUX_SRC)
        self.assertIn('String expected = websocketAccept(key);', MUX_SRC)
        self.assertIn('if (accept == null || !expected.equalsIgnoreCase(accept)) {', MUX_SRC)

    def test_open_frame_payload_carries_args_only(self) -> None:
        '''开流帧外壳：{"type":"open","streamId":..,"endpoint":"$events","payload":{"args":{}}}。'''
        self.assertIn(r'sendText("{\"type\":\"open\",\"streamId\":\"" + STREAM_ID', MUX_SRC)
        self.assertIn(r'"\",\"endpoint\":\""', MUX_SRC)
        self.assertIn(r'+ EVENTS_ENDPOINT + "\",\"payload\":{\"args\":{}}}");', MUX_SRC)

    def test_result_rpc_envelope_args_is_the_outcome_itself(self) -> None:
        '''上行 RPC 与既有信封同构，唯一差别是 payload.args 直接是结果对象（没有 args.request 那层）。'''
        self.assertIn('new URL("http://127.0.0.1:" + enginePort + "/api/" + RESULT_ENDPOINT);', MUX_SRC)
        self.assertIn('connection.setRequestMethod("POST");', MUX_SRC)
        self.assertIn('envelope.put("type", "client-request");', MUX_SRC)
        self.assertIn('envelope.put("rpcId", rpcId);', MUX_SRC)
        self.assertIn('envelope.put("method", RESULT_ENDPOINT);', MUX_SRC)
        self.assertIn('payload.put("args", args);', MUX_SRC)
        self.assertIn('envelope.put("payload", payload);', MUX_SRC)
        self.assertIn('args.put("clientId", currentClientId);', MUX_SRC)
        self.assertIn('args.put("eventId", eventId);', MUX_SRC)
        self.assertIn('args.put("outcome", outcome);', MUX_SRC)
        # 批次82-N4 起 mux 里多了第二条逻辑流（session/follow）的 open 帧，它的 payload 恰恰是
        # args.request —— 因此这条「上行 result RPC 不能有 args.request 那层」的断言收窄到
        # rpcResult(...) 方法体，语义不变（该 RPC 的 args 直接就是结果对象）。
        rpc_start = MUX_SRC.index('private JSONObject rpcResult(JSONObject args)')
        rpc_body = MUX_SRC[rpc_start:]
        nxt = rpc_body.find('\n    private ', 10)
        if nxt > 0:
            rpc_body = rpc_body[:nxt]
        self.assertNotIn('put("request"', rpc_body)


class Batch55BFrameHandlingTests(unittest.TestCase):
    '''批次55-B 帧处理：必须回 pong（服务端每 2000ms ping），ready/waterfall/cancel 三种 item。'''

    def test_ping_is_answered_with_pong(self) -> None:
        self.assertIn('case 0x9:', MUX_SRC)
        self.assertIn('sendControl(0xA, frame.payload);', MUX_SRC)
        # 读超时兜底也发 ping，避免被服务端判死
        self.assertIn('sendControl(0x9, new byte[0]);', MUX_SRC)

    def test_text_frame_reaches_message_dispatch(self) -> None:
        self.assertIn('case 0x1:', MUX_SRC)
        self.assertIn('handleText(new String(frame.payload, "UTF-8"));', MUX_SRC)
        self.assertIn('if ("item".equals(type)) {', MUX_SRC)
        self.assertIn('JSONObject value = message.optJSONObject("value");', MUX_SRC)

    def test_ready_frame_captures_client_id(self) -> None:
        self.assertIn('if ("ready".equals(type)) {', MUX_SRC)
        self.assertIn('clientId = value.optString("clientId", "");', MUX_SRC)
        self.assertIn('setConnected(true, "已就绪");', MUX_SRC)

    def test_waterfall_split_question_and_approval(self) -> None:
        self.assertIn('if ("waterfall".equals(type)) {', MUX_SRC)
        self.assertIn('String event = value.optString("event", "");', MUX_SRC)
        self.assertIn('String eventId = value.optString("eventId", "");', MUX_SRC)
        self.assertIn('String agentId = value.optString("agentId", "");', MUX_SRC)
        self.assertIn('JSONObject request = value.optJSONObject("request");', MUX_SRC)
        self.assertIn('if (EVENT_QUESTION.equals(event)) {', MUX_SRC)
        self.assertIn('listener.onQuestion(eventId, agentId, request);', MUX_SRC)
        self.assertIn('} else if (EVENT_APPROVAL.equals(event)) {', MUX_SRC)
        self.assertIn('listener.onApproval(eventId, agentId, request);', MUX_SRC)

    def test_cancel_frame_clears_pending_card(self) -> None:
        '''引擎撤销 / 别的客户端先答了：本端必须清卡，否则用户对着死卡片点。'''
        self.assertIn('if ("cancel".equals(type)) {', MUX_SRC)
        self.assertIn('listener.onCleared(eventId);', MUX_SRC)
        self.assertIn('if (eventId.equals(pendingInteractionEventId)) {', OVERLAY_SRC)
        self.assertIn('clearInteractionCard("请求已结束");', OVERLAY_SRC)


class Batch55BOutcomeLiteralsTests(unittest.TestCase):
    '''批次55-B 回填三态字面量：result / rejected(ASK_CANCELLED) / approval 裸字符串。'''

    def test_answer_outcome_is_result_kind(self) -> None:
        self.assertIn('outcome.put("kind", "result");', MUX_SRC)
        self.assertIn('outcome.put("value", value);', MUX_SRC)
        self.assertIn('value.put("answers", answers == null ? new JSONArray() : answers);', MUX_SRC)
        self.assertIn('void answerQuestion(String eventId, JSONArray answers) {', MUX_SRC)

    def test_cancel_outcome_is_rejected_with_ask_cancelled(self) -> None:
        self.assertIn('outcome.put("kind", "rejected");', MUX_SRC)
        self.assertIn('outcome.put("error", error);', MUX_SRC)
        self.assertIn('error.put("name", "UserQuestionError");', MUX_SRC)
        self.assertIn('error.put("message", "the user cancelled ask_user_question");', MUX_SRC)
        self.assertIn('error.put("code", "ASK_CANCELLED");', MUX_SRC)

    def test_approval_outcome_is_bare_string(self) -> None:
        self.assertIn('void answerApproval(String eventId, String outcome) {', MUX_SRC)
        self.assertIn('submitResult(eventId, outcome == null ? "rejected" : outcome);', MUX_SRC)
        self.assertIn('eventMux.answerApproval(pendingInteractionEventId, "allowed-once");', OVERLAY_SRC)
        self.assertIn('eventMux.answerApproval(pendingInteractionEventId, "rejected");', OVERLAY_SRC)


class Batch55BCardTests(unittest.TestCase):
    '''批次55-B 卡片侧：三/四个动作文案、multiSelect 驼峰、答案字段、等待态文案。'''

    def test_card_symbol_contract(self) -> None:
        for needle in ('private void startEventMux() {',
                       'private void stopEventMux() {',
                       'private View buildInteractionCard() {',
                       'private void renderQuestion(JSONObject item, int index, int total) {',
                       'private TextView makeOptionChip(final QuestionUi ui, final String label) {',
                       'private void refreshOptionChips(QuestionUi ui) {',
                       'private void submitInteraction() {',
                       'private void rejectInteraction() {',
                       'private void clearInteractionCard(String note) {',
                       'private static final class QuestionUi {'):
            self.assertIn(needle, OVERLAY_SRC, '缺卡片方法：' + needle)
        self.assertIn('eventMux = new DshEventMux(this, new DshEventMux.Listener() {', OVERLAY_SRC)
        self.assertIn('startEventMux();', OVERLAY_SRC)
        self.assertIn('stopEventMux();', OVERLAY_SRC)
        self.assertIn('panelView.addView(buildInteractionCard());', OVERLAY_SRC)

    def test_card_action_labels_and_visibility(self) -> None:
        self.assertIn('questionSubmitButton = makeActionButton("提交回答", true);', OVERLAY_SRC)
        self.assertIn('questionRejectButton = makeActionButton("取消提问", false);', OVERLAY_SRC)
        self.assertIn('questionSubmitButton.setText("允许一次");', OVERLAY_SRC)
        self.assertIn('questionRejectButton.setText("拒绝");', OVERLAY_SRC)
        # 默认收起，引擎请求时展开；卡片出现必须把面板弹出来，否则用户不知道引擎在等回答
        self.assertIn('questionCard.setVisibility(View.GONE);', OVERLAY_SRC)
        self.assertIn('questionCard.setVisibility(View.VISIBLE);', OVERLAY_SRC)
        self.assertIn('showInteractionCard("question", eventId, request);', OVERLAY_SRC)
        self.assertIn('showInteractionCard("approval", eventId, request);', OVERLAY_SRC)

    def test_question_ui_uses_camel_case_multi_select(self) -> None:
        '''协议字段是 multiSelect（camelCase），写成 multi_select 会永远读成 false。'''
        self.assertIn('ui.multi = item.optBoolean("multiSelect", false);', OVERLAY_SRC)
        self.assertNotIn('"multi_select"', code_only(OVERLAY_SRC))

    def test_answer_fields_are_id_selected_custom(self) -> None:
        self.assertIn('JSONArray questions = request.optJSONArray("questions");', OVERLAY_SRC)
        self.assertIn('ui.id = item.optString("id", "");', OVERLAY_SRC)
        self.assertIn('answer.put("id", ui.id);', OVERLAY_SRC)
        self.assertIn('answer.put("selected", selected);', OVERLAY_SRC)
        self.assertIn('answer.put("custom", custom);', OVERLAY_SRC)
        self.assertIn('eventMux.answerQuestion(pendingInteractionEventId, answers);', OVERLAY_SRC)
        self.assertIn('eventMux.cancelQuestion(pendingInteractionEventId);', OVERLAY_SRC)

    def test_question_and_approval_request_fields(self) -> None:
        for needle in ('String label = option.optString("label", "");',
                       'String header = item.optString("header", "");',
                       'String question = item.optString("question", "");',
                       'String detail = item.optString("detail", "");'):
            self.assertIn(needle, OVERLAY_SRC, '缺提问字段：' + needle)
        self.assertIn('request.optString("toolName", "")', OVERLAY_SRC)
        self.assertIn('request.optString("reason", "")', OVERLAY_SRC)
        self.assertIn('questionCardTitle.setText("AI 请求高危操作授权");', OVERLAY_SRC)
        self.assertIn('Log.i(TAG, "interaction pending kind=" + kind + " count=" + questionUis.size()', OVERLAY_SRC)

    def test_waiting_state_copy_in_capsule_and_elapsed_line(self) -> None:
        self.assertIn('showCapsule("⏳ 等待您的回答", busy);', OVERLAY_SRC)
        self.assertIn('("等待您的回答 · 已 " + secs + "s")', OVERLAY_SRC)

    def test_ask_user_question_friendly_tool_mapping(self) -> None:
        self.assertIn('if (name.contains("ask_user_question") || name.contains("question")) '
                      'return "等待您回答提问";', AGENT_SRC)


class Batch55BReverseGateTests(unittest.TestCase):
    '''批次55-B 反向闸门：新文件不得再碰无障碍升层/硬编码 2032
    （OverlayService 的 TYPE_ACCESSIBILITY_OVERLAY 由 tests/test_batch53_overlay_layer.py 覆盖，此处不重复）。'''

    def test_no_accessibility_overlay_promotion_in_new_files(self) -> None:
        for name, source in (('DshEventMux.java', MUX_SRC), ('OverlayAgentClient.java', AGENT_SRC)):
            self.assertNotIn('TYPE_ACCESSIBILITY_OVERLAY', source, name)
            self.assertNotIn('2032', source, name)

    def test_overlay_service_code_has_no_hardcoded_2032(self) -> None:
        self.assertNotIn('2032', code_only(OVERLAY_SRC))


if __name__ == '__main__':
    unittest.main()
