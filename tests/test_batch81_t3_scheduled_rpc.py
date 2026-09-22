from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
SCHED = (HARNESS / "ScheduleExecutor.java").read_text(encoding="utf-8")
MAIN = (HARNESS / "MainActivity.java").read_text(encoding="utf-8")
AGENT = (HARNESS / "OverlayAgentClient.java").read_text(encoding="utf-8")


class Batch81T3ScheduledRpcContractTests(unittest.TestCase):
    """批次81-T3：定时任务到点执行的 RPC 契约（真机取证坐实的三条独立缺陷）。

    真机现场（2026-09-19，`tools/e2e_batch70_live_wait.py scheduled`）：闹钟触发、
    `engineReady` 通过（批次79 修好的 401 判据生效），但下一步恒失败于
    `创建会话失败（可能未配置 API Key）`。用 curl 逐条复现坐实三条：

      1. 端点：`/api/session.create` → 404 not found；`/api/session/create` → 200；
      2. 信封：request 体直接放 `payload` 下 → `gateway/input-invalid`；
         `payload.args.request` → 200 ok；
      3. 鉴权：无 Cookie → 401 unauthorized；带 `dsh_prefs/engine_cookie` → 200 ok。

    另有第 4 条：`session.prompt` 的 request 必须带 `requestId`，否则同样
    `gateway/input-invalid`（探针实测）。

    旧实现三条全错，且错误文案把契约缺陷误导成「用户没配 API Key」。
    """

    def _rpc_body(self, src: str, marker: str) -> str:
        return src.split(marker)[1].split("\n    }")[0]

    def test_endpoint_uses_slash_not_dot(self) -> None:
        for name, src, marker in (("ScheduleExecutor", SCHED, "private static String rpc("),
                                  ("MainActivity", MAIN, "private String rpcCall(")):
            body = self._rpc_body(src, marker)
            self.assertIn("method.replace('.', '/')", body, name + " 未把方法名的点换成斜杠")
            self.assertIn('"/api/" + endpoint', body, name + " URL 必须用 endpoint（点已换斜杠）")

    def test_payload_wrapped_in_args_request(self) -> None:
        for name, src, marker in (("ScheduleExecutor", SCHED, "private static String rpc("),
                                  ("MainActivity", MAIN, "private String rpcCall(")):
            body = self._rpc_body(src, marker)
            self.assertIn('argumentName = "session.list".equals(method) ? "_request" : "request"', body,
                          name + " 的 args 参数名分支缺失")
            self.assertIn('\\"args\\":{\\"', body, name + " 的 payload 未包在 args 下")

    def test_cookie_is_sent(self) -> None:
        body = self._rpc_body(SCHED, "private static String rpc(")
        self.assertIn('c.setRequestProperty("Cookie", cookie)', body,
                      "ScheduleExecutor 必须带引擎 Cookie（dsh 0.1.5 /api 全在门禁之后）")
        self.assertIn('getString("engine_cookie", null)', SCHED,
                      "Cookie 必须取自 dsh_prefs/engine_cookie（与 MainActivity/OverlayAgentClient 同源）")
        self.assertIn("private static String engineCookie(Context ctx)", SCHED)
        # 对照：可用实现也带 Cookie（本测试锚定「三处同口径」）
        self.assertIn('connection.setRequestProperty("Cookie", cookie)', AGENT)

    def test_prompt_request_has_request_id(self) -> None:
        self.assertIn("private static String promptRequestJson(String sessionId, String text)", SCHED)
        prompt = SCHED.split("private static String promptRequestJson(")[1].split("\n    }")[0]
        self.assertIn('\\"requestId\\":', prompt, "ScheduleExecutor 的 prompt 缺 requestId")
        self.assertIn("promptRequestJson(sessionId, text)", SCHED,
                      "sendPrompt/sendPromptRaw 必须共用同一 request 构造（防两处再次分叉）")
        main_send = MAIN.split("private boolean sendPrompt(String sessionId, String text)")[1].split("\n    }")[0]
        self.assertIn('\\"requestId\\":', main_send, "MainActivity 的 prompt 缺 requestId")

    def test_failure_message_is_not_misleading(self) -> None:
        """错误文案不得再把契约缺陷说成「未配置 API Key」（真机取证显示与 API Key 无关）。"""
        self.assertNotIn("创建会话失败（可能未配置 API Key）", SCHED)
        self.assertNotIn("无法创建会话（引擎未就绪或无 API Key？）", MAIN)
        self.assertIn("检查 engine_cookie 是否在位", SCHED)


if __name__ == "__main__":
    unittest.main()
