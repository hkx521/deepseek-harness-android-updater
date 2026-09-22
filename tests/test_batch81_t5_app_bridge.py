from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "android-app" / "src" / "com" / "deepseek" / "harness"
OVERLAY_SRC = (HARNESS / "OverlayService.java").read_text(encoding="utf-8")
MAIN_SRC = (HARNESS / "MainActivity.java").read_text(encoding="utf-8")
ANDROID_PLUGIN = (ROOT / "plugins" / "dsh-tool-android" / "lib" / "index.js").read_text(encoding="utf-8")
A11Y_PLUGIN = (ROOT / "plugins" / "dsh-tool-accessibility" / "lib" / "index.js").read_text(encoding="utf-8")


class Batch81T5BridgeVisibilityTests(unittest.TestCase):
    """批次81-T5：3081（App 侧本地桥）不自动拉起，但必须「可见 + 可操作」。

    真机事实（2026-09-19 取证）：3081 只在 `MainActivity.startEngine()` 路径 bind；App 进程
    不在场（覆盖安装后未开主界面、只走了 AssistActivity 入口）时 3081 一直不监听，而托管引擎
    3080 照常在跑 —— 用户侧表现是「dsh 里任务还在跑，小鲸鱼助手显示执行失败」。

    本批次拍板：**不做自动拉起**（避免破坏批次67「App 可被杀、引擎不受影响」的设计，且牵涉
    Honor 后台/自启策略），改为面板/设置页显式呈现该中间态 + 工具侧统一可操作指引 + 记档边界。
    """

    # ---- ① App 侧能力可见：悬浮面板 + 设置页卡片 ----

    def test_overlay_probes_app_bridge_each_round(self) -> None:
        self.assertIn("public static volatile boolean appBridgeUp = false;", OVERLAY_SRC)
        self.assertIn("public static volatile long lastAppBridgeProbeAt = 0L;", OVERLAY_SRC)
        self.assertIn("final boolean appUp = appBridgeAlive();", OVERLAY_SRC)
        self.assertIn("appBridgeUp = appUp;", OVERLAY_SRC)

    def test_probe_accepts_any_http_response(self) -> None:
        """3081 的鉴权前置会对无 token 探测回 401 —— 有响应即证明在监听（与 3080 口径一致）。"""
        body = OVERLAY_SRC.split("static boolean appBridgeAlive(int port) {")[1].split("\n    }")[0]
        self.assertIn("getResponseCode()", body)
        self.assertIn("return code > 0;", body)
        self.assertNotIn("code == 200", body)
        self.assertIn("/status", body)

    def test_bridge_port_matches_main_activity(self) -> None:
        """端口口径必须与 MainActivity.notifyPort()（enginePort+1）一致，否则探错端口恒报不可用。"""
        self.assertIn("private int notifyPort() { return enginePort + 1; }", MAIN_SRC)
        self.assertIn("private int appBridgePort() {", OVERLAY_SRC)
        self.assertIn("return enginePort + 1;", OVERLAY_SRC)

    def test_overlay_renders_actionable_row(self) -> None:
        self.assertIn("private TextView appBridgeText;", OVERLAY_SRC)
        self.assertIn("detailBox.addView(appBridgeText);", OVERLAY_SRC)
        self.assertIn("App 侧能力：不可用（3081 未监听", OVERLAY_SRC)
        self.assertIn("点此打开小鲸鱼助手后重试", OVERLAY_SRC)
        # 不可用时允许点一下直接打开主应用（恢复动作就在手边）
        self.assertIn("appBridgeText.setOnClickListener(", OVERLAY_SRC)

    def test_settings_card_line_uses_cached_probe(self) -> None:
        """设置页不在主线程发 HTTP（避免 ANR），只读悬浮面板探测缓存并如实标注新鲜度。"""
        self.assertIn("private String appSideCapabilityLine() {", MAIN_SRC)
        self.assertIn("OverlayService.lastAppBridgeProbeAt", MAIN_SRC)
        self.assertIn("OverlayService.appBridgeUp", MAIN_SRC)
        self.assertIn('sb.append("App 侧能力（3081）：")', MAIN_SRC)
        self.assertIn("未探测（悬浮窗未运行", MAIN_SRC)
        body = MAIN_SRC.split("private String appSideCapabilityLine() {")[1].split("\n    }")[0]
        for forbidden in ("HttpURLConnection", "openConnection"):
            self.assertNotIn(forbidden, body, "设置页文案不得在主线程发 HTTP")

    def test_status_label_distinguishes_assistant_offline(self) -> None:
        """引擎在线但 3081 不在场时不得只报「就绪」（会把助手失败误判成任务失败）。"""
        self.assertIn('boolean appSideDown = engineUp && lastAppBridgeProbeAt > 0L && !appBridgeUp;', OVERLAY_SRC)
        self.assertIn('(appSideDown ? "助手离线" : "就绪")', OVERLAY_SRC)

    # ---- ② 工具侧统一可操作指引（两插件同文案） ----

    def test_both_plugins_share_app_bridge_hint(self) -> None:
        for name, src in (("dsh-tool-android", ANDROID_PLUGIN), ("dsh-tool-accessibility", A11Y_PLUGIN)):
            self.assertIn("const APP_BRIDGE_HINT =", src, name + " 缺统一指引常量")
            self.assertIn("请打开「小鲸鱼助手」", src, name + " 指引必须给出恢复动作")
            self.assertIn("3081", src, name + " 指引必须点明是 App 侧桥")

    def test_android_plugin_uses_hint_at_all_3081_sites(self) -> None:
        self.assertIn('req.on("error", () => resolve({ ok: false, error: APP_BRIDGE_HINT }));', ANDROID_PLUGIN)
        self.assertIn("hint: APP_BRIDGE_HINT,", ANDROID_PLUGIN)
        self.assertIn('(r && r.error) || APP_BRIDGE_HINT', ANDROID_PLUGIN)
        self.assertNotIn("请先启动 DeepSeek Harness", ANDROID_PLUGIN)

    def test_accessibility_plugin_uses_hint(self) -> None:
        self.assertIn('resolve(JSON.stringify({ ok: false, error: APP_BRIDGE_HINT }))', A11Y_PLUGIN)
        self.assertIn("hint: APP_BRIDGE_HINT,", A11Y_PLUGIN)
        self.assertNotIn("App 原生桥不可达", A11Y_PLUGIN)
        self.assertNotIn("App 原生桥无响应", A11Y_PLUGIN)

    def test_3081_timeout_paths_are_actionable_too(self) -> None:
        """3081 的超时腿也必须给恢复动作；3181（无障碍桥）的超时文案不动 —— 两者是不同通道。

        旧文案是裸「App 本地服务超时」/「App 原生桥无响应」，用户/模型看不出该做什么。
        """
        def app_bridge_timeout_bodies(src: str) -> list[str]:
            """取只走 3081 的请求函数体（appPost / appRequest / vscreenBridge），排除 3181 的 a11yGet/a11yRequest。"""
            out = []
            for fn in ("function appPost(", "function appRequest(", "function vscreenBridge("):
                if fn not in src:
                    continue
                out.append(src.split(fn)[1].split("\n}\n")[0])
            return out

        for name, src in (("dsh-tool-android", ANDROID_PLUGIN), ("dsh-tool-accessibility", A11Y_PLUGIN)):
            self.assertIn("const APP_BRIDGE_TIMEOUT_HINT =", src, name + " 缺超时指引常量")
            bodies = app_bridge_timeout_bodies(src)
            self.assertTrue(bodies, name + " 未找到 3081 请求函数")
            for body in bodies:
                if 'timeout' not in body:
                    continue
                self.assertNotIn('error: "App 本地服务超时"', body,
                                 name + " 的 3081 超时腿仍是裸文案（无恢复动作）")
            # 3181 的无障碍桥文案必须保持原样（它的 reason 由 failReason 归一到 BRIDGE_UNREACHABLE）
            self.assertIn("本地服务超时", src, name + " 不应把 3181 的文案一起改掉")

    # ---- ③ 不自动拉起（拍板边界，防日后被「顺手修好」） ----


    def test_no_auto_start_of_app_process(self) -> None:
        """3081 只在 MainActivity.startEngine() bind；本批次明确不新增「自动拉起 App」的通路。"""
        self.assertEqual(MAIN_SRC.count("startNotifyServer();"), 2,
                         "startNotifyServer 调用点数量变化 —— 若新增自动拉起入口请先更新本批次决策记录")
        for forbidden in ("HostedEngineManager", "Runtime.getRuntime().exec"):
            self.assertNotIn(forbidden, A11Y_PLUGIN, "插件侧不得自行拉起 App 进程")


if __name__ == "__main__":
    unittest.main()
