/**
 * @file tests/device_test_permission_gate.mjs
 * @description 真机实测：双树模块下权限预设模式与 Android 3081 /confirm 系统通知审批门全链路验证
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";

// 动态引入已推送到双树的插件模块
const androidModule = await import("/data/data/com.deepseek.harness/files/payload/dshroot/lib/node_modules/@deepseek-ai/dsh-tool-android/lib/index.js");
const shizukuModule = await import("/data/data/com.deepseek.harness/files/payload/dshroot/lib/node_modules/@deepseek-ai/dsh-tool-shizuku/lib/index.js");

const {
  maybeApprove: maybeApproveAndroid,
  getEffectivePermissionMode: getEffectiveModeAndroid,
  isDangerousAction: isDangerousAndroid
} = androidModule;

const {
  maybeApprove: maybeApproveShizuku,
  getEffectivePermissionMode: getEffectiveModeShizuku,
  isDangerousAction: isDangerousShizuku
} = shizukuModule;

const APP_PORT = parseInt(process.env.APP_NOTIFY_PORT || "3081", 10);
let token = process.env.APP_LOCAL_TOKEN;
if (!token) {
  try {
    const prefs = execSync("cat /data/data/com.deepseek.harness/shared_prefs/dsh_prefs.xml", { encoding: "utf8", shell: "/system/bin/sh" });
    const m = prefs.match(/<string name="local_token">(.*?)<\/string>/);
    if (m) token = m[1];
  } catch (_) {}
}
const APP_TOKEN = token || "1bf8a7d6549577e8118f522c6e6b9256";
process.env.APP_LOCAL_TOKEN = APP_TOKEN;

function runCmd(cmd, options = {}) {
  return execSync(cmd, { shell: "/system/bin/sh", ...options });
}

function getNotificationRecords() {
  try {
    const out = runCmd("dumpsys notification", { encoding: "utf8" });
    const lines = out.split("\n");
    return lines.filter(l => l.includes("pkg=com.deepseek.harness") && l.includes("channel=dsh_confirm"));
  } catch (e) {
    return [];
  }
}

function sendBroadcast(action, id) {
  try {
    const cmd = `su -c 'am broadcast --user 0 -a com.deepseek.harness.${action} --es id "${id}" -n com.deepseek.harness/.ConfirmReceiver'`;
    return runCmd(cmd, { encoding: "utf8" });
  } catch (e) {
    return e.message;
  }
}

async function runDeviceTests() {
  console.log("=====================================================================");
  console.log("       Pixel 6 Pro 真机实测：权限模式与 3081 原生通知审批门联动");
  console.log("=====================================================================");
  console.log(`[Config] APP_NOTIFY_PORT=${APP_PORT}, Token=${APP_TOKEN.slice(0, 6)}...`);

  let passCount = 0;

  // -------------------------------------------------------------------------
  // 场景 A: 默认预设 danger-full-access（完全权限）零弹窗直接放行
  // -------------------------------------------------------------------------
  console.log("\n>>> [场景 A] 测试 danger-full-access（完全权限免审）");
  process.env.DSH_PERMISSION_MODE = "danger-full-access";
  process.env.DSH_CONFIRM_TIMEOUT_SEC = "3";

  const notifsBeforeA = getNotificationRecords();

  // A.1 android_setting put 高危操作
  const resA1 = await maybeApproveAndroid(null, {}, "android_setting", "put", "global device_test 1");
  console.log("  A.1 android_setting put:", JSON.stringify(resA1));
  assert.equal(resA1.allowed, true, "danger-full-access 下高危设置写入必须放行");
  assert.equal(resA1.reason, "danger-full-access", "放行 reason 应为 danger-full-access");
  passCount++;

  // A.2 android_package install 高危操作
  const resA2 = await maybeApproveAndroid(null, {}, "android_package", "install", "/sdcard/test.apk");
  console.log("  A.2 android_package install:", JSON.stringify(resA2));
  assert.equal(resA2.allowed, true, "danger-full-access 下包安装必须放行");
  assert.equal(resA2.reason, "danger-full-access");
  passCount++;

  // A.3 shizuku_shell 高危写命令
  const resA3 = await maybeApproveShizuku(null, {}, "shizuku_shell", "shell", "settings put global test 1");
  console.log("  A.3 shizuku_shell write:", JSON.stringify(resA3));
  assert.equal(resA3.allowed, true, "danger-full-access 下特权写命令必须放行");
  assert.equal(resA3.reason, "danger-full-access");
  passCount++;

  const notifsAfterA = getNotificationRecords();
  assert.equal(notifsAfterA.length, notifsBeforeA.length, "danger-full-access 下绝不发起任何确认通知（零弹窗打扰）");
  console.log("  ✓ 场景 A 验证通过：高危操作全部短路放行，无任何通知弹窗！");

  // -------------------------------------------------------------------------
  // 场景 B: workspace-write（工作区修改模式）触发审批门与通知拦截
  // -------------------------------------------------------------------------
  console.log("\n>>> [场景 B] 测试 workspace-write（系统通知审批门与拦截）");
  process.env.DSH_PERMISSION_MODE = "workspace-write";
  process.env.DSH_CONFIRM_POLL_MS = "100";

  // 清理 logcat 缓存以确保准确定位本次生成的 confirm ID
  runCmd("logcat -c");

  // B.1 拒绝拦截测试：发起审批通知 -> 模拟用户点击「拒绝」-> 抛出 USER_REJECTED
  {
    console.log("  [B.1] 验证用户在通知中点击「拒绝」-> USER_REJECTED 拦截");
    let rejectedError = null;

    process.env.DSH_CONFIRM_TIMEOUT_SEC = "10";

    const denyWatcher = (async () => {
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 100));
        try {
          const log = runCmd("logcat -d -s DeepSeekHarness:I", { encoding: "utf8" });
          const m = log.match(/confirm requested: id=([0-9a-fA-F]+)/g);
          if (m && m.length > 0) {
            const last = m[m.length - 1];
            const id = last.split("id=")[1];
            console.log(`    [Watcher] 捕获到审批通知已弹出！通知 ID=${id}`);

            // 核验证查 dumpsys notification 中存在该通知
            const notifs = getNotificationRecords();
            console.log(`    [Dumpsys] 当前系统通知栏中的 dsh_confirm 记录数: ${notifs.length}`);
            assert.ok(notifs.length > 0, "系统通知栏中必须存在 dsh_confirm 渠道通知");

            await new Promise(r => setTimeout(r, 150));
            console.log(`    [Watcher] 模拟用户点击通知卡片上的「拒绝」按钮...`);
            sendBroadcast("CONFIRM_DENY", id);
            return id;
          }
        } catch (_) {}
      }
    })();

    try {
      await maybeApproveAndroid(null, {}, "android_setting", "put", "global secure_test 1");
    } catch (err) {
      rejectedError = err;
    }
    await denyWatcher;

    console.log("    捕获的拒绝结果：", rejectedError ? `${rejectedError.code}: ${rejectedError.message}` : "未抛出异常");
    assert.ok(rejectedError, "用户拒绝时必须抛出异常");
    assert.equal(rejectedError.code, "USER_REJECTED", "异常 code 必须为 USER_REJECTED");
    assert.ok(rejectedError.message.includes("USER_REJECTED"), "message 必须包含 USER_REJECTED 标记");
    assert.ok(rejectedError.message.includes("拒绝"), "message 应提示用户拒绝说明");
    passCount++;
    console.log("  ✓ [B.1] 拒绝测试通过：通知成功弹出，用户点击拒绝后精准拦截抛出 USER_REJECTED！");
  }

  // B.2 超时未确认拦截测试：发起审批通知 -> 超时未处理 -> fail-closed 拦截并抛出 USER_REJECTED
  {
    console.log("\n  [B.2] 验证超时未确认 -> fail-closed 拦截");
    let timeoutError = null;

    // 清理 logcat
    runCmd("logcat -c");
    // 设置 3 秒短超时验证
    process.env.DSH_CONFIRM_TIMEOUT_SEC = "3";
    const t0 = Date.now();

    const checkWatcher = (async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 100));
        try {
          const log = runCmd("logcat -d -s DeepSeekHarness:I", { encoding: "utf8" });
          if (log.includes("confirm requested: id=")) {
            const notifs = getNotificationRecords();
            console.log(`    [Watcher] 审批通知已弹出并在通知栏展示（系统记录数: ${notifs.length}），等待超时自动关闭...`);
            break;
          }
        } catch (_) {}
      }
    })();

    try {
      await maybeApproveShizuku(null, {}, "shizuku_shell", "shell", "pm uninstall com.fake.app", 3);
    } catch (err) {
      timeoutError = err;
    }
    await checkWatcher;

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`    耗时 ${elapsed}s，捕获的结果：`, timeoutError ? `${timeoutError.code}: ${timeoutError.message}` : "未抛出异常");
    assert.ok(timeoutError, "超时必须抛出异常");
    assert.equal(timeoutError.code, "USER_REJECTED", "超时异常 code 必须为 USER_REJECTED");
    assert.ok(timeoutError.message.includes("USER_REJECTED"));
    passCount++;
    console.log("  ✓ [B.2] 超时测试通过：超时自动判定为拒绝，fail-closed 拦截生效！");
  }

  // B.3 用户允许放行测试：发起审批通知 -> 模拟用户点击「允许」-> 审批通过正常放行
  {
    console.log("\n  [B.3] 验证用户在通知中点击「允许」-> 放行");
    let allowResult = null;

    runCmd("logcat -c");
    process.env.DSH_CONFIRM_TIMEOUT_SEC = "10";

    const allowWatcher = (async () => {
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 100));
        try {
          const log = runCmd("logcat -d -s DeepSeekHarness:I", { encoding: "utf8" });
          const m = log.match(/confirm requested: id=([0-9a-fA-F]+)/g);
          if (m && m.length > 0) {
            const last = m[m.length - 1];
            const id = last.split("id=")[1];
            console.log(`    [Watcher] 捕获到审批通知已弹出！通知 ID=${id}`);
            await new Promise(r => setTimeout(r, 150));
            console.log(`    [Watcher] 模拟用户点击通知卡片上的「允许」按钮...`);
            sendBroadcast("CONFIRM_ALLOW", id);
            return id;
          }
        } catch (_) {}
      }
    })();

    allowResult = await maybeApproveAndroid(null, {}, "android_package", "install", "/sdcard/safe.apk");
    await allowWatcher;

    console.log("    放行结果：", JSON.stringify(allowResult));
    assert.equal(allowResult.allowed, true, "用户点击允许后必须放行");
    assert.equal(allowResult.reason, "user-allowed", "放行 reason 应为 user-allowed");
    passCount++;
    console.log("  ✓ [B.3] 允许放行测试通过：通知卡片点击允许后，成功放行！");
  }

  // -------------------------------------------------------------------------
  // 场景 C: workspace-write 下只读/安全操作直接放行
  // -------------------------------------------------------------------------
  console.log("\n>>> [场景 C] 测试 workspace-write 下执行只读/安全操作");
  process.env.DSH_PERMISSION_MODE = "workspace-write";

  const readCases = [
    { name: "android_setting get", tool: "android_setting", action: "get", target: "system screen_brightness", fn: maybeApproveAndroid },
    { name: "android_setting list", tool: "android_setting", action: "list", target: "system", fn: maybeApproveAndroid },
    { name: "android_app current", tool: "android_app", action: "current", target: "", fn: maybeApproveAndroid },
    { name: "android_app launch", tool: "android_app", action: "launch", target: "com.android.settings", fn: maybeApproveAndroid },
    { name: "android_package list", tool: "android_package", action: "list", target: "", fn: maybeApproveAndroid },
    { name: "android_screenshot screenshot", tool: "android_screenshot", action: "screenshot", target: "", fn: maybeApproveAndroid },
    { name: "shizuku_shell dumpsys battery", tool: "shizuku_shell", action: "shell", target: "dumpsys battery", fn: maybeApproveShizuku },
    { name: "shizuku_shell settings get", tool: "shizuku_shell", action: "shell", target: "settings get global airplane_mode_on", fn: maybeApproveShizuku },
    { name: "shizuku_shell pm list packages", tool: "shizuku_shell", action: "shell", target: "pm list packages -3", fn: maybeApproveShizuku },
  ];

  const notifsBeforeC = getNotificationRecords();
  for (const rc of readCases) {
    const res = await rc.fn(null, {}, rc.tool, rc.action, rc.target);
    console.log(`  C. ${rc.name}: allowed=${res.allowed}, reason=${res.reason}`);
    assert.equal(res.allowed, true, `${rc.name} 应该直接放行`);
    assert.equal(res.reason, "safe-action", `${rc.name} 放行原因应为 safe-action`);
    passCount++;
  }
  const notifsAfterC = getNotificationRecords();
  assert.equal(notifsAfterC.length, notifsBeforeC.length, "只读操作不应产生任何通知弹窗！");
  console.log(`  ✓ 场景 C 验证通过：全部 ${readCases.length} 项只读/安全操作直接零弹窗放行！`);

  console.log("\n=====================================================================");
  console.log(`  🎉 真机全部实测用例通过！累计通过用例：${passCount} 项`);
  console.log("=====================================================================");
}

runDeviceTests().catch((err) => {
  console.error("\n❌ 真机实测失败：", err);
  process.exit(1);
});
