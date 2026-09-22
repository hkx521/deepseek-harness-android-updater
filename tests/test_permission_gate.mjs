/**
 * @file tests/test_permission_gate.mjs
 * @description 权限预设模式（permission preset）与 Android 原生审批门（3081 /confirm）底层联动测试
 *
 * 验证目标：
 *  1. danger-full-access 下执行高危操作 -> 彻底短路，零弹窗直接放行；
 *  2. workspace-write 下执行高危操作 -> 正确触发 3081 原生审批逻辑（允许放行、拒绝/超时拦截并抛出 USER_REJECTED）；
 *  3. workspace-write 下执行只读/安全操作 -> 无需弹窗直接放行；
 *  4. 权限模式解析与 fail-safe 兜底机制正确性（Session Projections > DSH_PERMISSION_MODE > shell sandboxMode > defaultPreset）。
 */

import assert from "node:assert/strict";
import http from "node:http";
import { register } from "node:module";
import { resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";

// ============================================================================
// 动态注册 ESM 解析钩子，将 peerDependencies @deepseek-ai/dsh-tools 指向本地副本
// ============================================================================

const dshToolsPath = pathResolve("build/updater/devhome/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools/lib/index.js");
const dshToolsUrl = pathToFileURL(dshToolsPath).href;
const loaderCode = `
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "@deepseek-ai/dsh-tools") {
      return {
        shortCircuit: true,
        url: ${JSON.stringify(dshToolsUrl)}
      };
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loaderCode)}`);

// 动态导入待测模块
const {
  maybeApprove: maybeApproveAndroid,
  getEffectivePermissionMode: getEffectiveModeAndroid,
  isDangerousAction: isDangerousAndroid
} = await import("../plugins/dsh-tool-android/lib/index.js");

const {
  maybeApprove: maybeApproveShizuku,
  getEffectivePermissionMode: getEffectiveModeShizuku,
  isDangerousAction: isDangerousShizuku
} = await import("../plugins/dsh-tool-shizuku/lib/index.js");

// ============================================================================
// 1. Mock 3081 本地 HTTP 审批服务器
// ============================================================================

class MockConfirmServer {
  constructor() {
    this.server = null;
    this.port = 0;
    this.requests = [];
    this.confirmHandler = null;
    this.resultHandler = null;
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        let bodyStr = "";
        req.on("data", (chunk) => (bodyStr += chunk));
        req.on("end", () => {
          let body = {};
          try {
            if (bodyStr) body = JSON.parse(bodyStr);
          } catch (_) {}

          this.requests.push({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body
          });

          if (req.method === "POST" && req.url === "/confirm") {
            const resp = this.confirmHandler ? this.confirmHandler(body) : { ok: true, id: "test-cid-1", timeoutSec: 5 };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(resp));
            return;
          }

          if (req.method === "POST" && req.url === "/confirm/result") {
            const resp = this.resultHandler ? this.resultHandler(body) : { ok: true, status: "allowed" };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(resp));
            return;
          }

          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "not found" }));
        });
      });

      this.server.listen(0, "127.0.0.1", () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  clear() {
    this.requests = [];
    this.confirmHandler = null;
    this.resultHandler = null;
  }
}

// ============================================================================
// 测试主体
// ============================================================================

async function runTests() {
  console.log("=====================================================================");
  console.log("  Task 1: 权限预设模式与 Android 原生审批门（3081 /confirm）底层联动自测");
  console.log("=====================================================================");

  const mockServer = new MockConfirmServer();
  const port = await mockServer.start();

  // 配置环境变量指向本地 Mock 审批服务，并将轮询防抖时间缩至 10ms 提升单测性能
  process.env.APP_NOTIFY_PORT = String(port);
  process.env.DSH_CONFIRM_POLL_MS = "10";
  process.env.DSH_CONFIRM_TIMEOUT_SEC = "1";

  let passCount = 0;

  try {
    // ------------------------------------------------------------------------
    // 测试套件 1: danger-full-access 下执行高危操作 -> 零弹窗直接放行
    // ------------------------------------------------------------------------
    console.log("\n[Suite 1] 验证 danger-full-access 下执行高危操作 -> 零弹窗直接放行");

    const dangerCases = [
      { name: "android_package install", tool: "android_package", action: "install", target: "/sdcard/test.apk", fn: maybeApproveAndroid },
      { name: "android_package uninstall", tool: "android_package", action: "uninstall", target: "com.example.app", fn: maybeApproveAndroid },
      { name: "android_app force_stop", tool: "android_app", action: "force_stop", target: "com.example.app", fn: maybeApproveAndroid },
      { name: "android_setting put", tool: "android_setting", action: "put", target: "global test 1", fn: maybeApproveAndroid },
      { name: "android_input tap", tool: "android_input", action: "tap", target: "500,500", fn: maybeApproveAndroid },
      { name: "android_input text", tool: "android_input", action: "text", target: "hello", fn: maybeApproveAndroid },
      { name: "shizuku_shell pm install", tool: "shizuku_shell", action: "shell", target: "pm install /data/local/tmp/demo.apk", fn: maybeApproveShizuku },
      { name: "shizuku_shell settings put", tool: "shizuku_shell", action: "shell", target: "settings put global test 1", fn: maybeApproveShizuku },
      { name: "shizuku_shell am force-stop", tool: "shizuku_shell", action: "shell", target: "am force-stop com.example.demo", fn: maybeApproveShizuku },
      { name: "shizuku_shell rm -rf", tool: "shizuku_shell", action: "shell", target: "rm -rf /data/local/tmp/junk", fn: maybeApproveShizuku },
    ];

    // 1.1 环境变量生效路径 (DSH_PERMISSION_MODE = danger-full-access)
    process.env.DSH_PERMISSION_MODE = "danger-full-access";
    for (const tc of dangerCases) {
      mockServer.clear();
      const res = await tc.fn(null, {}, tc.tool, tc.action, tc.target);
      assert.equal(res.allowed, true, `${tc.name} 应被放行`);
      assert.equal(res.reason, "danger-full-access", `${tc.name} 放行原因应为 danger-full-access`);
      assert.equal(mockServer.requests.length, 0, `${tc.name} 不应发起任何 /confirm 请求（零弹窗）`);
      passCount++;
    }
    console.log(`  ✓ 1.1 通过环境变量指定 danger-full-access：${dangerCases.length} 项高危操作全部零弹窗放行`);

    // 1.2 会话状态生效路径 (通过 context.permissionPresets.current(session))
    delete process.env.DSH_PERMISSION_MODE;
    const sessionDangerCtx = {
      get: (id) => {
        if (id === "permissionPresets") {
          return { current: (_session) => "danger-full-access" };
        }
        return undefined;
      }
    };
    const mockDangerExec = { agent: { session: { id: "sess_danger_1" } } };

    for (const tc of dangerCases) {
      mockServer.clear();
      const res = await tc.fn(sessionDangerCtx, mockDangerExec, tc.tool, tc.action, tc.target);
      assert.equal(res.allowed, true, `${tc.name} 会话模式应被放行`);
      assert.equal(mockServer.requests.length, 0, `${tc.name} 会话模式下不应发起任何 /confirm 请求`);
      passCount++;
    }
    console.log(`  ✓ 1.2 通过会话上下文指定 danger-full-access：${dangerCases.length} 项高危操作全部零弹窗放行`);

    // ------------------------------------------------------------------------
    // 测试套件 2: workspace-write 下执行高危操作 -> 正确触发审批逻辑
    // ------------------------------------------------------------------------
    console.log("\n[Suite 2] 验证 workspace-write 下执行高危操作 -> 正确触发审批逻辑");
    process.env.DSH_PERMISSION_MODE = "workspace-write";

    // 2.1 用户在通知中点击「允许」-> 放行
    {
      mockServer.clear();
      mockServer.confirmHandler = (body) => {
        assert.equal(body.title, "AI 请求高危操作确认");
        assert.ok(body.text.includes("android_package"));
        assert.ok(body.text.includes("install"));
        return { ok: true, id: "cid_allow_1", timeoutSec: 2 };
      };
      mockServer.resultHandler = (body) => {
        assert.equal(body.id, "cid_allow_1");
        return { ok: true, status: "allowed" };
      };

      const res = await maybeApproveAndroid(null, {}, "android_package", "install", "/sdcard/safe.apk");
      assert.equal(res.allowed, true, "用户允许后应放行");
      assert.equal(res.reason, "user-allowed", "放行原因应为 user-allowed");
      assert.ok(mockServer.requests.some((r) => r.url === "/confirm"), "应向 3081 发送 /confirm 请求");
      assert.ok(mockServer.requests.some((r) => r.url === "/confirm/result"), "应向 3081 轮询 /confirm/result");
      passCount++;
      console.log("  ✓ 2.1 用户点击「允许」：成功触发 /confirm 通知并放行");
    }

    // 2.2 用户在通知中点击「拒绝」-> 抛出 USER_REJECTED
    {
      mockServer.clear();
      mockServer.confirmHandler = () => ({ ok: true, id: "cid_deny_1", timeoutSec: 2 });
      mockServer.resultHandler = () => ({ ok: true, status: "denied" });

      let rejectedErr = null;
      try {
        await maybeApproveAndroid(null, {}, "android_setting", "put", "global adb_enabled 1");
      } catch (e) {
        rejectedErr = e;
      }

      assert.ok(rejectedErr, "用户拒绝时必须抛出异常");
      assert.equal(rejectedErr.code, "USER_REJECTED", "异常 code 必须为 USER_REJECTED");
      assert.ok(rejectedErr.message.includes("USER_REJECTED"), "异常 message 必须包含 USER_REJECTED 标记");
      assert.ok(rejectedErr.message.includes("拒绝"), "异常信息应包含用户拒绝说明");
      passCount++;
      console.log("  ✓ 2.2 用户点击「拒绝」：精准拦截并抛出 USER_REJECTED 异常");
    }

    // 2.3 通知过期 / 超时未确认 -> 视为拒绝，抛出 USER_REJECTED
    {
      mockServer.clear();
      mockServer.confirmHandler = () => ({ ok: true, id: "cid_expired_1", timeoutSec: 1 });
      mockServer.resultHandler = () => ({ ok: true, status: "expired" });

      let expiredErr = null;
      try {
        await maybeApproveShizuku(null, {}, "shizuku_shell", "shell", "pm uninstall com.example.app");
      } catch (e) {
        expiredErr = e;
      }

      assert.ok(expiredErr, "通知过期时必须抛出异常");
      assert.equal(expiredErr.code, "USER_REJECTED", "异常 code 必须为 USER_REJECTED");
      assert.ok(expiredErr.message.includes("USER_REJECTED"));
      passCount++;
      console.log("  ✓ 2.3 通知过期：视为拒绝并抛出 USER_REJECTED 异常");
    }

    // 2.4 App 审批门关闭或本地服务不可达 -> fail-closed 拦截，抛出 USER_REJECTED
    {
      mockServer.clear();
      mockServer.confirmHandler = () => ({
        ok: false,
        error: "审批门已关闭（dsh_prefs/confirm_gate=false），/confirm 不受理"
      });

      let failClosedErr = null;
      try {
        await maybeApproveAndroid(null, {}, "android_input", "tap", "100,200");
      } catch (e) {
        failClosedErr = e;
      }

      assert.ok(failClosedErr, "服务不可达或审批门关闭必须 fail-closed 拦截");
      assert.equal(failClosedErr.code, "USER_REJECTED", "异常 code 必须为 USER_REJECTED");
      assert.ok(failClosedErr.message.includes("USER_REJECTED"));
      passCount++;
      console.log("  ✓ 2.4 审批门关闭/服务不可达：fail-closed 严格拦截并抛出 USER_REJECTED");
    }

    // 2.5 覆盖 shizuku_shell 在 workspace-write 下触发特权写命令审批
    {
      mockServer.clear();
      mockServer.confirmHandler = (body) => {
        assert.ok(body.text.includes("shizuku_shell"));
        return { ok: true, id: "cid_shizuku_write_1", timeoutSec: 2 };
      };
      mockServer.resultHandler = () => ({ ok: true, status: "allowed" });

      const res = await maybeApproveShizuku(null, {}, "shizuku_shell", "shell", "settings put secure location_mode 3");
      assert.equal(res.allowed, true);
      assert.ok(mockServer.requests.length >= 2, "shizuku 写命令应触发 /confirm 交互");
      passCount++;
      console.log("  ✓ 2.5 shizuku_shell 特权写命令：成功在 workspace-write 下触发审批门");
    }

    // ------------------------------------------------------------------------
    // 测试套件 3: workspace-write 下执行只读/安全操作 -> 无需弹窗直接放行
    // ------------------------------------------------------------------------
    console.log("\n[Suite 3] 验证 workspace-write 下执行只读/安全操作 -> 无需弹窗直接放行");
    process.env.DSH_PERMISSION_MODE = "workspace-write";

    const safeCases = [
      { name: "android_package list", tool: "android_package", action: "list", target: "", fn: maybeApproveAndroid },
      { name: "android_app current", tool: "android_app", action: "current", target: "", fn: maybeApproveAndroid },
      { name: "android_app launch", tool: "android_app", action: "launch", target: "com.example.app", fn: maybeApproveAndroid },
      { name: "android_setting get", tool: "android_setting", action: "get", target: "system screen_brightness", fn: maybeApproveAndroid },
      { name: "android_setting list", tool: "android_setting", action: "list", target: "system", fn: maybeApproveAndroid },
      { name: "android_screenshot screenshot", tool: "android_screenshot", action: "screenshot", target: "", fn: maybeApproveAndroid },
      { name: "shizuku_shell dumpsys battery", tool: "shizuku_shell", action: "shell", target: "dumpsys battery", fn: maybeApproveShizuku },
      { name: "shizuku_shell getprop", tool: "shizuku_shell", action: "shell", target: "getprop ro.build.version.release", fn: maybeApproveShizuku },
      { name: "shizuku_shell pm list packages", tool: "shizuku_shell", action: "shell", target: "pm list packages -3", fn: maybeApproveShizuku },
      { name: "shizuku_shell settings get", tool: "shizuku_shell", action: "shell", target: "settings get global airplane_mode_on", fn: maybeApproveShizuku },
      { name: "shizuku_shell logcat -d", tool: "shizuku_shell", action: "shell", target: "logcat -d -t 50", fn: maybeApproveShizuku },
    ];

    for (const tc of safeCases) {
      mockServer.clear();
      const res = await tc.fn(null, {}, tc.tool, tc.action, tc.target);
      assert.equal(res.allowed, true, `${tc.name} 应直接放行`);
      assert.equal(res.reason, "safe-action", `${tc.name} 放行原因应为 safe-action`);
      assert.equal(mockServer.requests.length, 0, `${tc.name} 不得发起任何 /confirm 请求（零弹窗打扰）`);
      passCount++;
    }
    console.log(`  ✓ 3.1 在 workspace-write 下测试 ${safeCases.length} 项只读/安全操作：全部零弹窗直接放行`);

    // ------------------------------------------------------------------------
    // 测试套件 4: 权限模式优先级与 Fail-safe 兜底机制验证
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4] 验证权限模式解析优先级与 Fail-safe 机制");

    delete process.env.DSH_PERMISSION_MODE;
    delete process.env.SHIZUKU_APPROVE;
    delete process.env.APP_CONFIRM_DANGEROUS;

    // 4.1 会话级 permissionPresets 存在时，优先级最高
    const mockCtxSession = {
      get: (id) => id === "permissionPresets" ? { current: () => "workspace-write" } : undefined
    };
    process.env.DSH_PERMISSION_MODE = "danger-full-access"; // 环境变量与会话冲突
    const mode1 = getEffectiveModeAndroid(mockCtxSession, { agent: { session: {} } });
    assert.equal(mode1, "workspace-write", "会话的 preset 决策必须优先于环境变量");
    passCount++;

    // 4.2 sessionProjections 投影回退
    delete process.env.DSH_PERMISSION_MODE;
    const mockCtxProj = {
      get: (id) => id === "sessionProjections" ? { stateOf: () => ({ preset: "workspace-write" }) } : undefined
    };
    const mode2 = getEffectiveModeAndroid(mockCtxProj, { agent: { session: {} } });
    assert.equal(mode2, "workspace-write", "可从 sessionProjections 读取状态");
    passCount++;

    // 4.3 shell sandboxMode 回退（对应批次 26 为 bash-local 注入的属性）
    const mockCtxShell = {
      get: (id) => id === "shell" ? { sandboxMode: "workspace-write" } : undefined
    };
    const mode3 = getEffectiveModeAndroid(mockCtxShell, {});
    assert.equal(mode3, "workspace-write", "可从 shell.sandboxMode 读取");
    passCount++;

    // 4.4 环境变量 DSH_PERMISSION_MODE 回退
    process.env.DSH_PERMISSION_MODE = "workspace-write";
    const mode4 = getEffectiveModeAndroid(null, {});
    assert.equal(mode4, "workspace-write", "无上下文时从环境变量读取");
    delete process.env.DSH_PERMISSION_MODE;
    passCount++;

    // 4.5 环境变量 SHIZUKU_APPROVE=ask 兜底
    process.env.SHIZUKU_APPROVE = "ask";
    const mode5 = getEffectiveModeAndroid(null, {});
    assert.equal(mode5, "workspace-write", "SHIZUKU_APPROVE=ask 时 fail-safe 回退为 workspace-write");
    delete process.env.SHIZUKU_APPROVE;
    passCount++;

    // 4.6 平台默认兜底（无任何配置时默认锁定 danger-full-access，对齐 defaultPreset）
    const mode6 = getEffectiveModeAndroid(null, {});
    assert.equal(mode6, "danger-full-access", "完全缺省时默认锁定 danger-full-access");
    const mode7 = getEffectiveModeShizuku(null, {});
    assert.equal(mode7, "danger-full-access", "Shizuku 完全缺省时默认锁定 danger-full-access");
    passCount += 2;
    console.log("  ✓ 4.1-4.6 权限模式 6 级解析阶梯与 fail-safe 机制校验全部通过");

    // ------------------------------------------------------------------------
    // 测试套件 5: 危险动作特征识别函数 isDangerousAction
    // ------------------------------------------------------------------------
    console.log("\n[Suite 5] 验证 isDangerousAction 动作特征识别");
    assert.equal(isDangerousAndroid("android_package", "install", ""), true);
    assert.equal(isDangerousAndroid("android_package", "uninstall", ""), true);
    assert.equal(isDangerousAndroid("android_package", "clear", ""), true);
    assert.equal(isDangerousAndroid("android_package", "grant", ""), true);
    assert.equal(isDangerousAndroid("android_package", "revoke", ""), true);
    assert.equal(isDangerousAndroid("android_package", "list", ""), false);
    assert.equal(isDangerousAndroid("android_app", "force_stop", ""), true);
    assert.equal(isDangerousAndroid("android_app", "launch", ""), false);
    assert.equal(isDangerousAndroid("android_app", "current", ""), false);
    assert.equal(isDangerousAndroid("android_setting", "put", ""), true);
    assert.equal(isDangerousAndroid("android_setting", "get", ""), false);
    assert.equal(isDangerousAndroid("android_setting", "list", ""), false);
    assert.equal(isDangerousAndroid("android_input", "tap", ""), true);
    assert.equal(isDangerousAndroid("android_input", "swipe", ""), true);
    assert.equal(isDangerousAndroid("android_input", "text", ""), true);
    assert.equal(isDangerousAndroid("android_screenshot", "screenshot", ""), false);
    assert.equal(isDangerousShizuku("shizuku_shell", "shell", "pm install foo.apk"), true);
    assert.equal(isDangerousShizuku("shizuku_shell", "shell", "dumpsys meminfo"), false);
    passCount++;
    console.log("  ✓ 5.1 危险与安全动作白名单精准识别");

    console.log("\n=====================================================================");
    console.log(`  🎉 全部自测断言通过！累计通过断言用例组：${passCount} 项`);
    console.log("=====================================================================");
  } finally {
    await mockServer.stop();
    // 清理测试环境变量
    delete process.env.APP_NOTIFY_PORT;
    delete process.env.DSH_CONFIRM_POLL_MS;
    delete process.env.DSH_CONFIRM_TIMEOUT_SEC;
    delete process.env.DSH_PERMISSION_MODE;
    delete process.env.SHIZUKU_APPROVE;
    delete process.env.APP_CONFIRM_DANGEROUS;
  }
}

runTests().catch((err) => {
  console.error("\n❌ 测试执行失败：", err);
  process.exit(1);
});
