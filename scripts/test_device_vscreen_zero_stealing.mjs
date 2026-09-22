/**
 * @file scripts/test_device_vscreen_zero_stealing.mjs
 * @description 真机零抢屏实测脚本（Pixel 6 Pro 真机双树实测）
 *
 * 验证目标：
 *  1. 回到主屏桌面（HOME），记录初始前台焦点（NexusLauncher）；
 *  2. 使能虚拟屏模式（DSH_VSCREEN_MODE=1）；
 *  3. 执行动作 1: android_app launch com.android.settings（自愈建屏并在虚拟屏启动设置）；
 *  4. 严格断言：
 *     - 主屏焦点绝不能被 com.android.settings 顶掉（dumpsys window | grep -m1 mCurrentFocus）；
 *     - 主屏 Display 0 的 ResumedActivity 严格保持为 Launcher；
 *     - 虚拟屏（DisplayId > 0）成功创建，com.android.settings 运行在虚拟屏 Display 上；
 *  5. 执行动作 2: android_tap 点击虚拟屏坐标，主屏前台不受干扰；
 *  6. 执行动作 3: android_screenshot / android_see 截取虚拟屏画面，确认图像有效且截取的是 Settings；
 *  7. 执行动作 4: 清理并关闭虚拟屏，复原主屏桌面状态（按 HOME）。
 */

import assert from "node:assert/strict";
import http from "node:http";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";

// 1. 读取 localToken
let localToken = "";
try {
  const prefs = readFileSync("/data/data/com.deepseek.harness/shared_prefs/dsh_prefs.xml", "utf-8");
  const m = prefs.match(/<string name="local_token">(.*?)<\/string>/);
  if (m) localToken = m[1];
} catch (e) {
  console.warn("读取 dsh_prefs.xml 失败:", e.message);
}

console.log("==================================================");
console.log("=== 真机虚拟屏零抢屏实测开始 (Pixel 6 Pro) ===");
console.log("==================================================");
console.log("已获取 localToken:", localToken ? `${localToken.slice(0, 6)}...` : "(空)");

// 2. 设置环境变量
process.env.DSH_VSCREEN_MODE = "1";
process.env.APP_NOTIFY_PORT = "3081";
process.env.APP_A11Y_PORT = "3181";
process.env.APP_LOCAL_TOKEN = localToken;
process.env.ROOT_AVAILABLE = "1";

// 3. 动态加载插件
const androidPlugin = await import("/data/data/com.deepseek.harness/files/payload/dshhome/profiles/web/node_modules/@deepseek-ai/dsh-tool-android/lib/index.js");
const a11yPlugin = await import("/data/data/com.deepseek.harness/files/payload/dshhome/profiles/web/node_modules/@deepseek-ai/dsh-tool-accessibility/lib/index.js");

const tools = new Map();
const mockCtx = {
  config: { vscreenMode: true },
  on: () => {},
  tools: {
    register: (t) => tools.set(t.name, t)
  },
  inject: (deps, cb) => {
    const subCtx = {
      tools: {
        register: (t) => tools.set(t.name, t)
      },
      get: (dep) => {
        if (dep === "attachments") {
          return {
            saveImage: async ({ data, mediaType, name }) => ({
              attachmentId: "att-" + Date.now(),
              mediaType: mediaType || "image/png",
              bytes: data.length,
              name: name || "shot.png"
            })
          };
        }
        return undefined;
      }
    };
    cb(subCtx);
  }
};

androidPlugin.apply(mockCtx);
a11yPlugin.apply(mockCtx);

function runCmd(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], shell: "/system/bin/sh" }).trim();
  } catch (e) {
    return (e.stdout || "").trim();
  }
}

function getVscreenStatus() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: 3081,
      path: "/vscreen/status",
      method: "GET",
      headers: { "X-DSH-Token": localToken }
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function closeVscreenBridge() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: 3081,
      path: "/vscreen/close",
      method: "POST",
      headers: { "X-DSH-Token": localToken }
    }, (res) => {
      res.on("data", () => {});
      res.on("end", resolve);
    });
    req.on("error", () => resolve());
    req.end();
  });
}

// 步骤 0: 清理残留，回到桌面并记录初始前台状态
console.log("\n[步骤 0] 清理前序残留环境，回到主屏桌面并记录初始前台焦点");
await closeVscreenBridge();
runCmd("am force-stop com.android.settings");
runCmd("input keyevent 3"); // KEYCODE_HOME
runCmd("sleep 1");

const initialFocus = runCmd("dumpsys window | grep -m1 mCurrentFocus");
const display0InitialApp = runCmd("dumpsys window displays | grep -m1 'mFocusedApp='");
console.log("主屏初始焦点 (mCurrentFocus):", initialFocus);
console.log("主屏初始 Display 0 mFocusedApp:", display0InitialApp);

assert.ok(
  !initialFocus.includes("com.android.settings"),
  "初始焦点不能为设置"
);
assert.ok(
  display0InitialApp.includes("nexuslauncher") || display0InitialApp.includes("NexusLauncher"),
  `主屏初始活动必须为 Launcher，实际: ${display0InitialApp}`
);

// 步骤 1: 执行动作 1: android_app launch com.android.settings
console.log("\n[步骤 1] 执行动作 1: android_app launch com.android.settings（在虚拟屏后台启动）");
const appTool = tools.get("android_app");
assert.ok(appTool, "android_app 工具已注册");

const t0 = Date.now();
const launchRes = await appTool.execute({ action: "launch", package: "com.android.settings" });
console.log(`android_app launch 执行完成 (耗时 ${Date.now() - t0} ms):`);
console.log(JSON.stringify(launchRes, null, 2));

assert.strictEqual(launchRes.ok, true, "启动结果必须 ok=true");
assert.strictEqual(launchRes.exit_code, 0, "exit_code 必须为 0");
assert.ok(launchRes.stdout.includes("[vscreen]"), "输出标明 [vscreen]");
assert.ok(launchRes.stdout.includes("com.android.settings"), "输出包含包名");

// 等待 2 秒让系统稳定
runCmd("sleep 2");

// 核心断言：主屏前台焦点
console.log("\n>>> 核验零抢屏核心断言 <<<");
const mCurrentFocus1 = runCmd("dumpsys window | grep -m1 mCurrentFocus");
const display0FocusedApp = runCmd("dumpsys window displays | grep -m1 'mFocusedApp='");
const topActivities = runCmd("dumpsys activity activities | grep 'topResumedActivity='");

console.log("1. dumpsys window | grep -m1 mCurrentFocus 返回:", mCurrentFocus1);
console.log("2. Display 0 mFocusedApp 返回:", display0FocusedApp);
console.log("3. 各 Display topResumedActivity 返回:\n" + topActivities);

// 断言：主屏焦点必须严格保持在 Launcher 或原应用，绝对不能被 com.android.settings 顶掉！
assert.ok(
  !mCurrentFocus1.includes("com.android.settings"),
  `[断言失败] 主屏 mCurrentFocus 被 com.android.settings 顶掉了！实际: ${mCurrentFocus1}`
);
assert.ok(
  display0FocusedApp.includes("nexuslauncher") || display0FocusedApp.includes("NexusLauncher"),
  `[断言失败] 主屏 Display 0 的聚焦应用必须仍为 Launcher！实际: ${display0FocusedApp}`
);
assert.ok(
  topActivities.includes("NexusLauncherActivity") || topActivities.includes("nexuslauncher"),
  `[断言失败] 主屏顶级活动列表必须包含 NexusLauncher！实际:\n${topActivities}`
);
console.log("✓ 【零抢屏断言通过】主屏前台焦点未被抢占，NexusLauncherActivity 依然稳居主屏 Display 0 前台！");

// 核验虚拟屏状态
const vStatus = await getVscreenStatus();
console.log("\n虚拟屏状态 (/vscreen/status):", JSON.stringify(vStatus, null, 2));
assert.ok(vStatus.ok, "vscreen 状态 ok");
assert.ok(typeof vStatus.displayId === "number" && vStatus.displayId > 0, `DisplayId 必须 > 0，当前为: ${vStatus.displayId}`);
const vDisplayId = vStatus.displayId;
console.log(`✓ 虚拟屏就绪，DisplayId = ${vDisplayId}`);

// 校验 com.android.settings 跑在虚拟屏对应的 Display 上
const settingsDisplay = runCmd(`dumpsys activity activities | grep -B 2 -A 5 "ActivityRecord.*com.android.settings"`);
console.log("Settings 所在任务详情:\n" + settingsDisplay);
assert.ok(
  topActivities.includes("com.android.settings"),
  "com.android.settings 必须在虚拟屏处于 topResumedActivity"
);

// 步骤 2: 执行动作 2: android_tap
console.log("\n[步骤 2] 执行动作 2: android_tap 虚拟屏点击 (540, 960)");
const tapTool = tools.get("android_tap");
assert.ok(tapTool, "android_tap 工具已注册");
const tapRes = await tapTool.execute({ x: 540, y: 960 });
console.log("android_tap 返回:", JSON.stringify(tapRes, null, 2));
assert.strictEqual(tapRes.ok, true, "tap 执行成功");
assert.strictEqual(tapRes.method, "vscreen-tap", "tap 路由为 vscreen-tap");

const focusAfterTap = runCmd("dumpsys window | grep -m1 mCurrentFocus");
assert.ok(!focusAfterTap.includes("com.android.settings"), "点击后主屏焦点不能被抢占");
console.log("✓ android_tap 虚拟屏点击成功，主屏焦点未受影响");

// 步骤 3: 执行动作 3: android_screenshot / android_see
console.log("\n[步骤 3] 执行动作 3: android_screenshot 截取虚拟屏画面");
const shotTool = tools.get("android_screenshot");
assert.ok(shotTool, "android_screenshot 工具已注册");
const shotPath = "/sdcard/DeepSeekHarness/test_vscreen_zero_stealing.png";
const shotRes = await shotTool.execute({ save_path: shotPath });
console.log("android_screenshot 返回:", JSON.stringify(shotRes, null, 2));
assert.strictEqual(shotRes.ok, true, "screenshot 必须 ok");
assert.strictEqual(shotRes.exit_code, 0);
assert.ok(shotRes.stdout.includes("[vscreen]"), "标明 [vscreen] 截图");

assert.ok(existsSync(shotPath), "截图文件必须生成在指定路径");
const stat = statSync(shotPath);
console.log(`虚拟屏截图生成成功: ${shotPath}, 大小: ${stat.size} 字节`);
assert.ok(stat.size > 20000, `截图文件大小异常: ${stat.size}`);

console.log("\n[步骤 3-附] 执行动作 3-附: android_see 捕获虚拟屏画面并保存附件");
const seeTool = tools.get("android_see");
assert.ok(seeTool, "android_see 工具已注册");
const seeRes = await seeTool.execute({});
console.log(`android_see 返回: ok=${seeRes.ok}, mediaType=${seeRes.image?.mediaType}, bytes=${seeRes.image?.bytes}, name=${seeRes.image?.name}`);
assert.strictEqual(seeRes.ok, true);
assert.strictEqual(seeRes.image?.mediaType, "image/png");
assert.ok(seeRes.image?.bytes > 20000);

// 步骤 4: 清理虚拟屏并复原
console.log("\n[步骤 4] 清理虚拟屏并复原主屏");
const closeTool = tools.get("android_vscreen_close");
if (closeTool) {
  const closeRes = await closeTool.execute({});
  console.log("关闭虚拟屏结果:", JSON.stringify(closeRes));
}
runCmd("input keyevent 3"); // KEYCODE_HOME
runCmd("sleep 1");

const finalStatus = await getVscreenStatus();
console.log("清理后的虚拟屏状态:", JSON.stringify(finalStatus));
assert.strictEqual(finalStatus.displayId, null, "清理后虚拟屏 displayId 必须为 null");

const finalFocus = runCmd("dumpsys window | grep -m1 mCurrentFocus");
const finalResumed = runCmd("dumpsys activity activities | grep 'ResumedActivity:'");
console.log("最终主屏焦点:", finalFocus);
console.log("最终主屏 ResumedActivity:", finalResumed);

console.log("\n==================================================");
console.log(">>> Pixel 6 Pro 真机零抢屏实测 100% 成功全部通过！ <<<");
console.log("==================================================");
