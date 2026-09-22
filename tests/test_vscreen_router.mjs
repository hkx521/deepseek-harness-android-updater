/**
 * @file tests/test_vscreen_router.mjs
 * @description 虚拟屏后台模式开关（Virtual Screen Mode Switch）与透明路由（Transparent Router）离线单元测试
 *
 * 验证目标：
 *  1. 开关判定与解析：DSH_VSCREEN_MODE=1 / true 开启，0 / false 关闭，未配置默认关闭；
 *  2. 开关关闭状态：主屏工具（android_app launch, android_tap, android_see）保持原有主屏逻辑不变，不打扰虚拟屏；
 *  3. 开关开启状态与自愈生命周期：未建屏时首个自动化动作自动静默触发 /vscreen/create 建屏；
 *  4. android_app launch：自动透明转为 /vscreen/launch，主屏前台不被打扰，输出格式严格兼容 resultSchema；
 *  5. android_tap：自动透明转为向虚拟屏注入坐标触摸（/vscreen/tap），支持像素与分数坐标换算；
 *  6. android_see / android_screenshot：自动捕获当前虚拟屏画面（/vscreen/see）；
 *  7. android_swipe / android_type：自动转为虚拟屏滑动与文本注入。
 *  8. 开关开启时，系统提示词强制应用启动走 android_app，禁止 shell 绕过与主屏回退。
 */

import assert from "node:assert/strict";
import http from "node:http";
import { register } from "node:module";
import { resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";

// 1. 动态注册 ESM 解析钩子，解析 @deepseek-ai/dsh-tools
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

// 2. 启动 Mock 3081（App 本地桥）和 Mock 3181（无障碍服务）
// 1x1 最小合法透明 PNG
const MINIMAL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

class MockBridgeServer {
  constructor(name) {
    this.name = name;
    this.server = null;
    this.port = 0;
    this.requests = [];
    // 批次81-T2-3：按路径排队的一次性响应序列（默认空，不影响既有用例）
    this.scripted = new Map();
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

          const record = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body
          };
          this.requests.push(record);

          // 路由分发
          const urlPath = req.url.split("?")[0];

          // 批次81-T2-3：队列中若有该路径的脚本化响应则按序返回（用尽后固定复用最后一条）；
          // 用于构造「首次 NOT_CREATED、重试成功」这类真实桥时序：默认未排队即走下方正常路由。
          const scripted = this.scripted.get(urlPath);
          if (scripted && scripted.list.length > 0) {
            const payload = scripted.list[Math.min(scripted.index, scripted.list.length - 1)];
            scripted.index += 1;
            if (payload && payload.__binary) {
              res.writeHead(200, { "Content-Type": "image/png" });
              res.end(MINIMAL_PNG);
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
            return;
          }

          // 3081 /vscreen/*
          if (urlPath === "/vscreen/create") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, displayId: 99, strategy: "plain", channel: "root" }));
            return;
          }
          if (urlPath === "/vscreen/launch") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, packageName: body.packageName }));
            return;
          }
          if (urlPath === "/vscreen/tap") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (urlPath === "/vscreen/swipe") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (urlPath === "/vscreen/see") {
            res.writeHead(200, { "Content-Type": "image/png" });
            res.end(MINIMAL_PNG);
            return;
          }
          if (urlPath === "/vscreen/key") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (urlPath === "/vscreen/status") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, displayId: 99, channel: "root", strategy: "plain" }));
            return;
          }
          if (urlPath === "/vscreen/close") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, restoredOverlay: false }));
            return;
          }
          if (urlPath === "/clipboard") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          // 3181 无障碍主屏路由
          if (urlPath === "/tap") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, found: true, method: "a11y-action" }));
            return;
          }
          if (urlPath === "/swipe") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, durationMs: 300 }));
            return;
          }
          if (urlPath === "/screenshot") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, path: "/tmp/mock-a11y-shot.png" }));
            return;
          }
          if (urlPath === "/display-info") {
            const parsedDi = new URL(req.url, "http://127.0.0.1");
            const dId = Number(parsedDi.searchParams.get("displayId") || 0);
            // 真机实测尺寸：主屏 1256x2808，虚拟屏 1008x1792（两者不同是批次74 缺陷根因）
            const isV = dId === 99;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, displayId: dId, width: isV ? 1008 : 1256, height: isV ? 1792 : 2808 }));
            return;
          }
          if (urlPath === "/dump") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: true,
              package: "com.android.settings",
              version: 7,
              count: 1,
              truncated: false,
              nodes: [{ text: "搜索设置", desc: "", cls: "android.widget.EditText", vid: "android:id/search", x: 100, y: 100, w: 300, h: 60, clickable: true, input: true, checked: false, selected: false, scrollable: false, depth: 1 }]
            }));
            return;
          }
          if (urlPath === "/input") {
            const parsed = new URL(req.url, "http://127.0.0.1");
            const text = parsed.searchParams.get("text") || "";
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, focused: true, verified: true, method: "set", expected: text, actual: text, attempts: [{ method: "set", ok: true, readback: text }] }));
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
  }

  /** 批次81-T2-3：为某路径排队「按序返回」的响应；用尽后固定复用最后一条，{ __binary: true } 表示返回 PNG。 */
  queueResponses(urlPath, list) {
    this.scripted.set(urlPath, { list, index: 0 });
  }

  clearScript() {
    this.scripted.clear();
  }
}

const mockAppBridge = new MockBridgeServer("AppBridge-3081");
const mockA11yBridge = new MockBridgeServer("A11yBridge-3181");

await mockAppBridge.start();
await mockA11yBridge.start();

process.env.APP_NOTIFY_PORT = String(mockAppBridge.port);
process.env.APP_A11Y_PORT = String(mockA11yBridge.port);
process.env.ROOT_AVAILABLE = "1";
process.env.APP_LOCAL_TOKEN = "test-token";

// 3. 动态导入待测插件
const androidPlugin = await import("../plugins/dsh-tool-android/lib/index.js");
const a11yPlugin = await import("../plugins/dsh-tool-accessibility/lib/index.js");

// 4. 辅助函数：装配插件工具
function createMockContext() {
  const tools = new Map();
  const savedImages = [];
  const events = new Map();
  const mockCtx = {
    config: {},
    on: (name, handler) => events.set(name, handler),
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
              saveImage: async ({ data, mediaType, name }) => {
                const attId = "att-" + Math.random().toString(36).slice(2, 8);
                savedImages.push({ attId, data, mediaType, name });
                return {
                  attachmentId: attId,
                  mediaType: mediaType || "image/png",
                  bytes: data.length,
                  width: 1080,
                  height: 1920,
                  name: name || "image.png"
                };
              }
            };
          }
          return undefined;
        }
      };
      cb(subCtx);
    }
  };
  return { mockCtx, tools, savedImages, events };
}

console.log("=== 启动虚拟屏透明路由离线单元测试 ===");

// ----------------------------------------------------------------------------
// Test 1: isVscreenModeEnabled 开关判定
// ----------------------------------------------------------------------------
console.log("\n[Test 1] 验证 isVscreenModeEnabled 开关解析");
{
  delete process.env.DSH_VSCREEN_MODE;
  assert.strictEqual(androidPlugin.isVscreenModeEnabled(), true, "未配置时默认开启（与 App 设置对齐，保障主屏不被打扰）");
  assert.strictEqual(a11yPlugin.isVscreenModeEnabled(), true, "a11y 插件未配置时默认开启");

  process.env.DSH_VSCREEN_MODE = "1";
  assert.strictEqual(androidPlugin.isVscreenModeEnabled(), true, "DSH_VSCREEN_MODE=1 开启");
  assert.strictEqual(a11yPlugin.isVscreenModeEnabled(), true, "a11y DSH_VSCREEN_MODE=1 开启");

  process.env.DSH_VSCREEN_MODE = "true";
  assert.strictEqual(androidPlugin.isVscreenModeEnabled(), true, "DSH_VSCREEN_MODE=true 开启");

  process.env.DSH_VSCREEN_MODE = "0";
  assert.strictEqual(androidPlugin.isVscreenModeEnabled(), false, "DSH_VSCREEN_MODE=0 关闭");

  process.env.DSH_VSCREEN_MODE = "false";
  assert.strictEqual(androidPlugin.isVscreenModeEnabled(), false, "DSH_VSCREEN_MODE=false 关闭");

  delete process.env.DSH_VSCREEN_MODE;
  assert.strictEqual(androidPlugin.isVscreenModeEnabled({ config: { vscreenMode: true } }), true, "通过插件配置开启");
  const poisonedCtx = {};
  Object.defineProperty(poisonedCtx, "config", {
    get() { throw new Error("cannot get property 'config' without inject"); }
  });
  assert.strictEqual(androidPlugin.isVscreenModeEnabled(poisonedCtx), true, "Cordis 未注入 config 时必须安全回退默认开启");
  console.log("  ✓ 开关状态解析完全正确");
}

// ----------------------------------------------------------------------------
// Test 2: 开关关闭状态（DSH_VSCREEN_MODE=0）下的主屏行为
// ----------------------------------------------------------------------------
console.log("\n[Test 2] 验证开关关闭状态下原有主屏行为");
{
  process.env.DSH_VSCREEN_MODE = "0";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  mockAppBridge.clear();
  mockA11yBridge.clear();

  // 验证 android_tap 打到无障碍 3181，不打扰 3081 /vscreen/*
  const tapTool = tools.get("android_tap");
  assert.ok(tapTool, "android_tap 工具已注册");
  const tapRes = await tapTool.execute({ x: 100, y: 200 });
  assert.strictEqual(tapRes.ok, true);
  assert.strictEqual(tapRes.method, "a11y-action", "开关关闭时走原有无障碍服务");

  const vscreenCalls = mockAppBridge.requests.filter((r) => r.url.startsWith("/vscreen/"));
  assert.strictEqual(vscreenCalls.length, 0, "开关关闭时不得产生任何 /vscreen/* 请求");
  console.log("  ✓ 开关关闭时保持原有主屏逻辑");
}

// ----------------------------------------------------------------------------
// Test 3: 开关开启状态（DSH_VSCREEN_MODE=1）下的自愈建屏与 android_app launch 透明路由
// ----------------------------------------------------------------------------
console.log("\n[Test 3] 验证自愈建屏与 android_app launch 透明路由");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  mockAppBridge.clear();

  const appTool = tools.get("android_app");
  assert.ok(appTool, "android_app 工具已注册");

  // 此时虚拟屏尚未创建，调用 launch 应该：
  // 1. 静默触发 POST /vscreen/create（自愈）
  // 2. 紧接着触发 POST /vscreen/launch，包名为 com.tencent.mm
  const res = await appTool.execute({ action: "launch", package: "com.tencent.mm" });

  assert.strictEqual(res.ok, true, "启动结果 ok 必须为 true");
  assert.strictEqual(res.exit_code, 0, "exit_code 为 0");
  assert.ok(res.stdout.includes("[vscreen]"), "stdout 应标明虚拟屏启动");
  assert.ok(res.stdout.includes("com.tencent.mm"), "stdout 包含目标包名");

  const paths = mockAppBridge.requests.map((r) => r.url.split("?")[0]);
  assert.ok(paths.includes("/vscreen/create"), "首个动作必须自愈触发 /vscreen/create");
  assert.ok(paths.includes("/vscreen/launch"), "必须触发 /vscreen/launch");

  const createIdx = paths.indexOf("/vscreen/create");
  const launchIdx = paths.indexOf("/vscreen/launch");
  assert.ok(createIdx < launchIdx, "/vscreen/create 必须先于 /vscreen/launch 执行");

  const launchReq = mockAppBridge.requests[launchIdx];
  assert.strictEqual(launchReq.body.packageName, "com.tencent.mm", "packageName 透传正确");
  console.log("  ✓ 首个动作自愈创建虚拟屏并完成透明 launch 路由");
}

// ----------------------------------------------------------------------------
// Test 4: 开关开启状态下的 android_tap 透明路由（像素坐标与分数坐标）
// ----------------------------------------------------------------------------
console.log("\n[Test 4] 验证 android_tap 透明路由");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  mockAppBridge.clear();
  mockA11yBridge.clear();

  const tapTool = tools.get("android_tap");

  // 1. 绝对像素坐标
  const resPixel = await tapTool.execute({ x: 320, y: 640 });
  assert.strictEqual(resPixel.ok, true);
  assert.strictEqual(resPixel.found, true);
  assert.strictEqual(resPixel.method, "vscreen-tap");

  let tapReq = mockAppBridge.requests.find((r) => r.url === "/vscreen/tap");
  assert.ok(tapReq, "应向 3081 /vscreen/tap 注入点击");
  assert.strictEqual(tapReq.body.x, 320);
  assert.strictEqual(tapReq.body.y, 640);

  // 2. 分数坐标换算（0~1 比例换算为「目标屏真实尺寸」像素坐标；批次74 起不再硬编码 1080x1920）
  mockAppBridge.clear();
  const resFraction = await tapTool.execute({ fx: 0.5, fy: 0.25 });
  assert.strictEqual(resFraction.ok, true);
  assert.strictEqual(resFraction.method, "vscreen-tap");

  tapReq = mockAppBridge.requests.find((r) => r.url === "/vscreen/tap");
  assert.ok(tapReq, "分数坐标应向 3081 /vscreen/tap 注入点击");
  assert.strictEqual(tapReq.body.x, Math.round(0.5 * 1008), "0.5 * 虚拟屏宽 1008 = 504（批次74：按目标屏真实尺寸换算）");
  assert.strictEqual(tapReq.body.y, Math.round(0.25 * 1792), "0.25 * 虚拟屏高 1792 = 448（批次74：按目标屏真实尺寸换算）");

  // 批次74：虚拟屏模式下允许向 3181 查询 /display-info（拿目标屏尺寸）与 /dump（快照定位），
  // 但绝不允许把点击坐标交给主屏 /tap —— 那正是本批次修复的缺陷。
  const strayMainTap = mockA11yBridge.requests.find((r) => r.url.startsWith("/tap"));
  assert.strictEqual(strayMainTap, undefined, "虚拟屏模式下不得把点击交给主屏 /tap");
  const diCalls = mockA11yBridge.requests.filter((r) => r.url.startsWith("/display-info"));
  assert.ok(diCalls.length > 0, "换算必须查询目标屏尺寸");
  console.log("  ✓ android_tap 绝对与分数坐标透明路由验证通过");
}

// ----------------------------------------------------------------------------
// Test 5: 开关开启状态下的 android_see 透明路由（图像附件捕获）
// ----------------------------------------------------------------------------
console.log("\n[Test 5] 验证 android_see 透明路由与附件保存");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools, savedImages } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  mockAppBridge.clear();
  mockA11yBridge.clear();

  const seeTool = tools.get("android_see");
  assert.ok(seeTool, "android_see 工具已注册");

  const res = await seeTool.execute({});
  assert.strictEqual(res.ok, true, "see 必须返回 ok: true");
  assert.ok(res.image, "see 返回包含 image 字段");
  assert.ok(res.image.attachmentId, "包含 attachmentId");
  assert.strictEqual(res.image.mediaType, "image/png");

  const seeReq = mockAppBridge.requests.find((r) => r.url === "/vscreen/see");
  assert.ok(seeReq, "应向 3081 /vscreen/see 请求捕获画面");
  assert.strictEqual(mockA11yBridge.requests.length, 0, "主屏无障碍截图不被调用");
  assert.strictEqual(savedImages.length, 1, "图像已保存到 attachments 附件服务");
  console.log("  ✓ android_see 虚拟屏画面捕获与对话注入验证通过");

  // 验证特权版 android_screenshot 同样透明路由到 /vscreen/see
  mockAppBridge.clear();
  const shotTool = tools.get("android_screenshot");
  assert.ok(shotTool, "android_screenshot 工具已注册");
  const shotRes = await shotTool.execute({ save_path: "build/test-vscreen-shot.png" });
  assert.strictEqual(shotRes.ok, true);
  assert.strictEqual(shotRes.exit_code, 0);
  assert.ok(shotRes.stdout.includes("[vscreen]"));
  const shotSeeReq = mockAppBridge.requests.find((r) => r.url === "/vscreen/see");
  assert.ok(shotSeeReq, "android_screenshot 应当向 3081 /vscreen/see 获取画面");
  console.log("  ✓ android_screenshot 虚拟屏截图透明路由验证通过");
}

// ----------------------------------------------------------------------------
// Test 6: 开关开启状态下的 android_swipe、android_type 与 android_input 动作
// ----------------------------------------------------------------------------
console.log("\n[Test 6] 验证 android_swipe, android_type 与 android_input 动作路由");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  // 1. android_swipe
  mockAppBridge.clear();
  const swipeTool = tools.get("android_swipe");
  const swipeRes = await swipeTool.execute({ x1: 100, y1: 500, x2: 100, y2: 100, durationMs: 400 });
  assert.strictEqual(swipeRes.ok, true);
  const swipeReq = mockAppBridge.requests.find((r) => r.url === "/vscreen/swipe");
  assert.ok(swipeReq, "向 3081 /vscreen/swipe 注入滑动");
  assert.strictEqual(swipeReq.body.x1, 100);
  assert.strictEqual(swipeReq.body.y2, 100);

  // 2. android_screen：语义树必须显式携带 vscreen displayId
  mockAppBridge.clear();
  mockA11yBridge.clear();
  // 批次74 备注：android_screen 有 10s TTL 缓存，前一步（swipe/type）可能已把缓存刷成新鲜，
  // 导致此处不再发 /dump（时序敏感，与虚拟屏换算无关）。改用强制刷新的 refresh 变体，
  // 让断言只校验「读屏必须带 vscreen displayId」这一不变量。
  const screenTool = tools.get("android_screen_refresh");
  assert.ok(screenTool, "android_screen_refresh 工具已注册");
  const screenRes = await screenTool.execute({});
  assert.strictEqual(screenRes.ok, true);
  const dumpReq = mockA11yBridge.requests.find((r) => r.url.startsWith("/dump"));
  assert.ok(dumpReq, "android_screen 必须调用 A11y /dump");
  assert.strictEqual(new URL(dumpReq.url, "http://127.0.0.1").searchParams.get("displayId"), "99", "读屏必须指定虚拟屏 displayId");
  assert.strictEqual(screenRes.nodes[0].input, true);

  // 3. android_type：直接走虚拟屏语义输入并回读校验，不依赖可见软键盘
  mockAppBridge.clear();
  mockA11yBridge.clear();
  const typeTool = tools.get("android_type");
  const typeRes = await typeTool.execute({ text: "Hello虚拟屏" });
  assert.strictEqual(typeRes.ok, true);
  assert.strictEqual(typeRes.verified, true);
  assert.strictEqual(typeRes.method, "vscreen-set");
  const inputReq = mockA11yBridge.requests.find((r) => r.url.startsWith("/input"));
  assert.ok(inputReq, "android_type 必须调用 A11y /input");
  const inputUrl = new URL(inputReq.url, "http://127.0.0.1");
  assert.strictEqual(inputUrl.searchParams.get("displayId"), "99", "输入必须指定虚拟屏 displayId");
  assert.strictEqual(inputUrl.searchParams.get("text"), "Hello虚拟屏");
  assert.strictEqual(mockAppBridge.requests.filter((r) => r.url === "/clipboard").length, 0, "语义输入支持时无需剪贴板回退");
  assert.strictEqual(mockAppBridge.requests.filter((r) => r.url === "/vscreen/key").length, 0, "语义输入支持时无需模拟软键盘粘贴");

  // 4. android_input text
  mockAppBridge.clear();
  const inputTool = tools.get("android_input");
  const inputRes = await inputTool.execute({ action: "text", text: "测试输入" });
  assert.strictEqual(inputRes.ok, true);
  assert.strictEqual(inputRes.verified, true);
  assert.ok(inputRes.stdout.includes("[vscreen]"));
  console.log("  ✓ swipe, type, input 虚拟屏注入验证通过");
}

// ----------------------------------------------------------------------------
// Test 7: 虚拟屏会话重置与自愈恢复
// ----------------------------------------------------------------------------
console.log("\n[Test 7] 验证虚拟屏关闭后再次操作的自动自愈生命周期");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  // 显式关闭虚拟屏
  const closeTool = tools.get("android_vscreen_close");
  await closeTool.execute({});

  mockAppBridge.clear();

  // 再次调用 tap，应再次自动建屏（自愈生命周期）
  const tapTool = tools.get("android_tap");
  const res = await tapTool.execute({ x: 200, y: 400 });
  assert.strictEqual(res.ok, true);

  const paths = mockAppBridge.requests.map((r) => r.url.split("?")[0]);
  assert.ok(paths.includes("/vscreen/create"), "关闭后再次操作必须自动重新建屏");
  assert.ok(paths.includes("/vscreen/tap"), "建屏后执行 tap");
  console.log("  ✓ 虚拟屏关闭/异常后自愈重新建屏验证通过");
}

// ----------------------------------------------------------------------------
// Test 8: 开关开启时向系统提示词注入强制路由策略
// ----------------------------------------------------------------------------
console.log("\n[Test 8] 验证虚拟屏模式系统提示词策略");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, events } = createMockContext();
  androidPlugin.apply(mockCtx);
  const assemble = events.get("system-prompt/assemble");
  assert.ok(assemble, "已注册 system-prompt/assemble 监听器");
  const assembled = await assemble({}, {}, async () => ({
    sections: [{ name: "base", text: "base" }],
    contexts: [],
    tools: [{ name: "android_app" }, { name: "shizuku_shell" }],
    variables: {}
  }));
  const policy = assembled.sections.find((s) => s.name === "dsh-android:vscreen-mode-policy");
  assert.ok(policy, "虚拟屏模式策略必须注入系统提示词");
  assert.ok(policy.text.includes("android_app"), "策略必须要求使用 android_app");
  assert.ok(policy.text.includes("shizuku_shell"), "策略必须禁止 shizuku_shell 绕过");
  assert.ok(policy.text.includes("不得回退到主屏"), "策略必须禁止失败后回退主屏");
  assert.ok(policy.text.includes('scope="current"'), "策略必须为 M1 current scope 保留主屏直读例外");
  assert.ok(policy.text.includes("不得因虚拟屏模式改读虚拟屏"), "current scope 不得被虚拟屏模式覆盖");
  console.log("  ✓ 系统提示词已强制默认虚拟屏路由");
}


// ----------------------------------------------------------------------------
// Test 9: 批次74 —— android_act 事务内 tap 的坐标系必须与虚拟屏一致
// ----------------------------------------------------------------------------
console.log("\n[Test 9] 验证 android_act 事务内 tap 使用虚拟屏真实尺寸换算");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  const actTool = tools.get("android_act");
  assert.ok(actTool, "android_act 工具已注册");

  mockAppBridge.clear();
  mockA11yBridge.clear();
  // fx=0.496 / fy=0.17，虚拟屏 1008x1792 -> 期望 (500, 305)
  // 若按主屏 1256x2808 换算会得到 (623, 477)，即真机缺陷（点到账号卡片）
  const actRes = await actTool.execute({ actions: [{ action: "tap", fx: 0.496, fy: 0.17 }] }, {});
  assert.strictEqual(actRes.ok, true, "事务内 tap 必须成功");

  // 注：/display-info 有 3s 短路缓存，尺寸可能由前序用例填充——真正的不变量是
  // 「注入到虚拟屏」+「坐标按虚拟屏 1008x1792 换算」（下面两条断言）。
  const tapReq = mockAppBridge.requests.find((r) => r.url === "/vscreen/tap");
  assert.ok(tapReq, "事务内 tap 必须走 /vscreen/tap（而非主屏 /tap）");
  assert.strictEqual(tapReq.body.x, Math.round(0.496 * 1008), "x 必须按虚拟屏宽度 1008 换算");
  assert.strictEqual(tapReq.body.y, Math.round(0.17 * 1792), "y 必须按虚拟屏高度 1792 换算");

  const mainTap = mockA11yBridge.requests.find((r) => r.url.startsWith("/tap"));
  assert.strictEqual(mainTap, undefined, "虚拟屏模式下不得把坐标交给主屏 /tap");
  console.log("  ✓ 事务 tap 使用虚拟屏真实尺寸，且不落到主屏 /tap");
}

// ----------------------------------------------------------------------------
// Test 10: 批次74 —— 事务内 type 必须带虚拟屏 displayId 且跳过主屏 IME 预检
// ----------------------------------------------------------------------------
console.log("\n[Test 10] 验证 android_act 事务内 type 走虚拟屏语义输入");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  const actTool = tools.get("android_act");
  mockAppBridge.clear();
  mockA11yBridge.clear();
  const res = await actTool.execute({ actions: [{ action: "type", text: "护眼" }] }, {});
  assert.strictEqual(res.ok, true, "事务内 type 必须成功（虚拟屏没有软键盘，不能按主屏 IME 预检）");
  assert.strictEqual(res.results[0].verified, true, "type 必须回读校验通过");

  const inputReq = mockA11yBridge.requests.find((r) => r.url.startsWith("/input"));
  assert.ok(inputReq, "type 必须调用 A11y /input");
  const iu = new URL(inputReq.url, "http://127.0.0.1");
  assert.strictEqual(iu.searchParams.get("displayId"), "99", "输入必须指定虚拟屏 displayId");
  assert.strictEqual(iu.searchParams.get("text"), "护眼");
  console.log("  ✓ 事务 type 带虚拟屏 displayId 且跳过主屏 IME 预检");
}


// ----------------------------------------------------------------------------
// Test 11: 批次75 —— 虚拟屏内 android_tap 支持 text/desc/vid 语义定位
// ----------------------------------------------------------------------------
console.log("\n[Test 11] 验证虚拟屏内 android_tap 语义定位（且不做主屏兜底）");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  const tapTool = tools.get("android_tap");

  // 1. text 定位：必须在虚拟屏树内解析 -> /vscreen/tap，且不出现主屏 /tap
  mockAppBridge.clear();
  mockA11yBridge.clear();
  const resText = await tapTool.execute({ text: "搜索设置" });
  assert.strictEqual(resText.ok, true, "虚拟屏内 text 定位必须成功");
  assert.strictEqual(resText.found, true);
  assert.ok(/vscreen-tap/.test(resText.method), "语义定位后必须走虚拟屏注入，method=" + resText.method);

  const dockReq = mockA11yBridge.requests.find((r) => r.url.startsWith("/dump"));
  assert.ok(dockReq, "语义定位必须读快照树");
  assert.strictEqual(
    new URL(dockReq.url, "http://127.0.0.1").searchParams.get("displayId"),
    "99",
    "定位必须读虚拟屏的树（displayId=99）"
  );
  const tapReq = mockAppBridge.requests.find((r) => r.url === "/vscreen/tap");
  assert.ok(tapReq, "必须注入虚拟屏");
  // mock 节点 x=100 y=100 w=300 h=60 -> 中心 (250,130) 即虚拟屏像素
  assert.strictEqual(tapReq.body.x, 250, "x 取节点中心（虚拟屏像素）");
  assert.strictEqual(tapReq.body.y, 130, "y 取节点中心（虚拟屏像素）");
  assert.strictEqual(
    mockA11yBridge.requests.find((r) => r.url.startsWith("/tap")),
    undefined,
    "虚拟屏语义定位后不得再打主屏 /tap"
  );
  console.log("  ✓ 虚拟屏内 text 定位成功并注入虚拟屏");

  // 2. 定位不到时必须诚实失败，绝不退化成主屏坐标兜底
  mockAppBridge.clear();
  mockA11yBridge.clear();
  const resMiss = await tapTool.execute({ text: "这个文案在虚拟屏里不存在" });
  assert.strictEqual(resMiss.ok, false, "定位不到必须失败");
  assert.strictEqual(resMiss.found, false);
  assert.strictEqual(resMiss.reason, "TARGET_NOT_FOUND", "reason 必须是 TARGET_NOT_FOUND");
  assert.strictEqual(
    mockA11yBridge.requests.find((r) => r.url.startsWith("/tap")),
    undefined,
    "定位失败绝不能退化为主屏 /tap（否则会误点主屏）"
  );
  assert.strictEqual(
    mockAppBridge.requests.find((r) => r.url === "/vscreen/tap"),
    undefined,
    "定位失败不得盲点虚拟屏坐标"
  );
  console.log("  ✓ 虚拟屏语义定位失败诚实失败，不做主屏兜底");

  // 3. 纯坐标路径不受影响
  mockAppBridge.clear();
  const resCoord = await tapTool.execute({ fx: 0.5, fy: 0.25 });
  assert.strictEqual(resCoord.ok, true);
  const coordReq = mockAppBridge.requests.find((r) => r.url === "/vscreen/tap");
  assert.strictEqual(coordReq.body.x, Math.round(0.5 * 1008));
  assert.strictEqual(coordReq.body.y, Math.round(0.25 * 1792));
  console.log("  ✓ 纯坐标路径保持批次74 的目标屏换算");
}

// ----------------------------------------------------------------------------
// Test 12: 批次81 —— 虚拟屏直连工具在本地守卫态丢失后的自愈建屏
// ----------------------------------------------------------------------------
console.log("\n[Test 12] 验证虚拟屏直连工具在守卫态丢失后的自愈（批次81）");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  // 先建屏再关闭：稳定制造「本地守卫态 = false」（模拟引擎重启 / 会话被关 / App 进程重启后的插件进程）
  const createTool = tools.get("android_vscreen_create");
  const closeTool = tools.get("android_vscreen_close");
  assert.ok(createTool, "android_vscreen_create 工具已注册");
  assert.ok(closeTool, "android_vscreen_close 工具已注册");
  const createRes = await createTool.execute({});
  assert.strictEqual(createRes.ok, true, "前置条件：建屏成功");
  const closeRes = await closeTool.execute({});
  assert.strictEqual(closeRes.ok, true, "前置条件：关闭虚拟屏成功");

  // 守卫态必须已复位：此时再 close 只应本地返回 NOT_CREATED（不打桥）
  const guardRes = await closeTool.execute({});
  assert.strictEqual(guardRes.ok, false, "前置条件：会话态已复位时 close 应本地失败");
  assert.strictEqual(guardRes.reason, "NOT_CREATED", "前置条件：守卫态已复位（close 仍保留本地 NOT_CREATED）");

  const cases = [
    { name: "android_vscreen_see", args: {}, action: "/vscreen/see" },
    { name: "android_vscreen_tap", args: { x: 320, y: 640 }, action: "/vscreen/tap" },
    { name: "android_vscreen_swipe", args: { x1: 100, y1: 500, x2: 100, y2: 100, durationMs: 400 }, action: "/vscreen/swipe" },
    { name: "android_vscreen_key", args: { key: "BACK" }, action: "/vscreen/key" }
  ];

  for (const c of cases) {
    const tool = tools.get(c.name);
    assert.ok(tool, c.name + " 工具已注册");

    // 每轮独立复现「守卫态丢失」：已建屏时 close 打桥并复位本地态，未建屏时纯本地返回（不打桥）
    await closeTool.execute({});
    mockAppBridge.clear();
    const res = await tool.execute(c.args, {});
    assert.strictEqual(res.ok, true, c.name + " 在守卫态丢失后必须静默自愈建屏并成功");
    assert.notStrictEqual(res.reason, "NOT_CREATED", c.name + " 不得再返回本地 NOT_CREATED");
    if (c.name === "android_vscreen_see") {
      assert.ok(res.image && res.image.attachmentId, "see 自愈后仍返回图像附件");
    }

    const paths = mockAppBridge.requests.map((r) => r.url.split("?")[0]);
    const createIdx = paths.indexOf("/vscreen/create");
    const actionIdx = paths.indexOf(c.action);
    assert.ok(actionIdx >= 0, c.name + " 必须触发 " + c.action);
    assert.ok(createIdx >= 0, c.name + " 守卫态丢失时必须自愈触发 /vscreen/create");
    assert.ok(createIdx < actionIdx, c.name + " 的 /vscreen/create 必须先于 " + c.action);
    assert.strictEqual(
      paths.filter((p) => p === "/vscreen/create").length,
      1,
      c.name + " 每轮自愈只应建屏一次"
    );
  }
  console.log("  ✓ 直连 see/tap/swipe/key 在守卫态丢失后均静默自愈建屏，无本地 NOT_CREATED");
}

// ----------------------------------------------------------------------------
// Test 13: 批次81-T2-3 —— App 侧会话已回收、插件本地守卫态陈旧时，在一次桥调用内自愈重试
// ----------------------------------------------------------------------------
console.log("\n[Test 13] 验证陈旧守卫态下一次桥调用内的自愈重试（批次81-T2-3）");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  const createTool = tools.get("android_vscreen_create");
  const tapTool = tools.get("android_vscreen_tap");
  const seeTool = tools.get("android_vscreen_see");
  assert.ok(createTool && tapTool && seeTool, "android_vscreen_create / tap / see 工具已注册");

  // 真机场景（run 13:31）：App 收尾时已回收虚拟屏（桥会对动作回 NOT_CREATED），
  // 但插件进程内的本地守卫态仍是 true —— ensureVscreenCreated 因此早退，首个动作直接失败。
  const preRes = await createTool.execute({});
  assert.strictEqual(preRes.ok, true, "前置条件：建屏成功，本地守卫态 = true（陈旧守卫态）");

  // --- 正例 1：/vscreen/tap 首次 NOT_CREATED、之后成功 ---
  mockAppBridge.clear();
  mockAppBridge.queueResponses("/vscreen/tap", [
    { ok: false, reason: "NOT_CREATED", hint: "先 android_vscreen_create" },
    { ok: true }
  ]);
  const tapRes = await tapTool.execute({ x: 500, y: 500 });
  assert.strictEqual(tapRes.ok, true, "被 App 判 NOT_CREATED 时必须清位自愈建屏并重试成功");
  assert.strictEqual(tapRes.x, 500, "重试成功后返回与成功路径一致的字段 x");
  assert.strictEqual(tapRes.y, 500, "重试成功后返回与成功路径一致的字段 y");

  let paths = mockAppBridge.requests.map((r) => r.url.split("?")[0]);
  const tapIdxs = paths.map((p, i) => (p === "/vscreen/tap" ? i : -1)).filter((i) => i >= 0);
  const createIdx = paths.indexOf("/vscreen/create");
  assert.strictEqual(tapIdxs.length, 2, "/vscreen/tap 必须恰好请求 2 次（一次失败 + 一次重试成功）");
  assert.strictEqual(paths.filter((p) => p === "/vscreen/create").length, 1, "自愈建屏只应发生一次");
  assert.ok(createIdx > tapIdxs[0] && createIdx < tapIdxs[1],
    "/vscreen/create 必须发生在首次失败之后、第二次 /vscreen/tap 之前");

  // --- 正例 2：/vscreen/see（二进制路径）首次 SESSION_DEAD、之后返回 PNG ---
  mockAppBridge.clearScript();
  mockAppBridge.clear();
  mockAppBridge.queueResponses("/vscreen/see", [{ ok: false, reason: "SESSION_DEAD" }, { __binary: true }]);
  const seeRes = await seeTool.execute({});
  assert.strictEqual(seeRes.ok, true, "SEE 被 App 判 SESSION_DEAD 时必须自愈重试成功");
  assert.ok(seeRes.image && seeRes.image.attachmentId, "重试成功后仍返回与成功路径一致的 image 附件对象");
  paths = mockAppBridge.requests.map((r) => r.url.split("?")[0]);
  assert.strictEqual(paths.filter((p) => p === "/vscreen/see").length, 2, "/vscreen/see 必须恰好请求 2 次");
  assert.strictEqual(paths.filter((p) => p === "/vscreen/create").length, 1, "SEE 自愈建屏只应发生一次");

  // --- 负例：非会话类失败（INJECT_FAILED）不得重试，真实原因必须原样透出 ---
  mockAppBridge.clearScript();
  mockAppBridge.clear();
  const reRes = await createTool.execute({});
  assert.strictEqual(reRes.ok, true, "负例前置：守卫态回到 true（排除自愈建屏对计数的干扰）");
  mockAppBridge.clear();
  mockAppBridge.queueResponses("/vscreen/tap", [{ ok: false, reason: "INJECT_FAILED" }]);
  const negRes = await tapTool.execute({ x: 500, y: 500 });
  assert.strictEqual(negRes.ok, false, "INJECT_FAILED 必须如实失败");
  assert.strictEqual(negRes.reason, "INJECT_FAILED", "真实失败原因必须原样透出，不得被重试掩盖");
  paths = mockAppBridge.requests.map((r) => r.url.split("?")[0]);
  assert.strictEqual(paths.filter((p) => p === "/vscreen/tap").length, 1, "INJECT_FAILED 不得触发重试");
  assert.strictEqual(paths.filter((p) => p === "/vscreen/create").length, 0, "INJECT_FAILED 不得触发自愈建屏");
  mockAppBridge.clearScript();

  // --- 接入点复验：透明路由分支（android_input / android_app / android_screenshot）走同一重试 ---
  const routerCases = [
    { tool: "android_input", path: "/vscreen/tap", args: { action: "tap", x: 500, y: 500 } },
    { tool: "android_app", path: "/vscreen/launch", args: { action: "launch", package: "com.tencent.mm" } },
    { tool: "android_screenshot", path: "/vscreen/see", args: { save_path: "build/test-vscreen-shot.png" } }
  ];
  for (const c of routerCases) {
    mockAppBridge.clearScript();
    mockAppBridge.clear();
    const back = await createTool.execute({});
    assert.strictEqual(back.ok, true, c.tool + " 复验前置：守卫态回到 true");
    mockAppBridge.clear();
    mockAppBridge.queueResponses(c.path, [
      { ok: false, reason: "NOT_CREATED" },
      c.path === "/vscreen/see" ? { __binary: true } : { ok: true }
    ]);
    const v = await tools.get(c.tool).execute(c.args);
    assert.strictEqual(v.ok, true, c.tool + " 的 " + c.path + " 分支必须自愈重试成功");
    const rp = mockAppBridge.requests.map((r) => r.url.split("?")[0]);
    assert.strictEqual(rp.filter((p) => p === c.path).length, 2, c.tool + " 的 " + c.path + " 必须恰好请求 2 次");
    assert.strictEqual(rp.filter((p) => p === "/vscreen/create").length, 1, c.tool + " 自愈建屏只应发生一次");
  }

  console.log("  ✓ 陈旧守卫态（NOT_CREATED / SESSION_DEAD）自愈重试一次，非会话类失败不重试且原因原样透出");
  console.log("  ✓ 透明路由 android_input / android_app / android_screenshot 同样一次重试成功");
}

// ----------------------------------------------------------------------------
// Test 14: 批次82-N9 —— 自愈被只读闸门拒时，reason 必须是 READONLY_TASK（不再沿用 NOT_CREATED）
// ----------------------------------------------------------------------------
console.log("\n[Test 14] 验证自愈失败时的 reason 精度（批次82-N9）");
{
  process.env.DSH_VSCREEN_MODE = "1";
  const { mockCtx, tools } = createMockContext();
  androidPlugin.apply(mockCtx);
  a11yPlugin.apply(mockCtx);

  const createTool = tools.get("android_vscreen_create");
  const tapTool = tools.get("android_vscreen_tap");
  assert.ok(createTool && tapTool, "android_vscreen_create / tap 工具已注册");

  const pre = await createTool.execute({});
  assert.strictEqual(pre.ok, true, "前置条件：建屏成功（守卫态 = true，模拟陈旧守卫态现场）");

  // --- 正例：初次 NOT_CREATED → 自愈建屏被只读硬闸门拒（READONLY_TASK）→ 必须透出 READONLY_TASK ---
  mockAppBridge.clearScript();
  mockAppBridge.clear();
  mockAppBridge.queueResponses("/vscreen/tap", [
    { ok: false, reason: "NOT_CREATED", hint: "先 android_vscreen_create" }
  ]);
  mockAppBridge.queueResponses("/vscreen/create", [{
    ok: false,
    reason: "READONLY_TASK",
    hint: "本轮为只读任务（识别屏幕/提取文字/翻译/总结/划选问答），App 已禁用虚拟屏创建；" +
      "请改用主屏只读能力（android_screen 传 scope=current）继续，不要重试建屏。"
  }]);
  const res = await tapTool.execute({ x: 500, y: 500 });
  assert.strictEqual(res.ok, false, "自愈被拒时必须如实失败");
  assert.strictEqual(res.reason, "READONLY_TASK", "必须透出自愈的真实原因，而不是最初的 NOT_CREATED");
  assert.ok(/只读任务/.test(String(res.hint || "")),
    "必须带可操作提示（改用主屏只读能力），不再只说「先 android_vscreen_create」");
  let paths = mockAppBridge.requests.map((r) => r.url.split("?")[0]);
  assert.strictEqual(paths.filter((p) => p === "/vscreen/create").length, 1, "自愈建屏只应尝试一次");
  assert.strictEqual(paths.filter((p) => p === "/vscreen/tap").length, 1, "自愈失败后不得重放原动作");

  // --- 负例：自愈因瞬态失败（create 回了非 JSON）→ 仍沿用原有 NOT_CREATED，不得用瞬态替换结论 ---
  mockAppBridge.clearScript();
  mockAppBridge.clear();
  const back = await createTool.execute({});
  assert.strictEqual(back.ok, true, "负例前置：守卫态回到 true");
  mockAppBridge.clear();
  mockAppBridge.queueResponses("/vscreen/tap", [{ ok: false, reason: "NOT_CREATED" }]);
  mockAppBridge.queueResponses("/vscreen/create", [{ __binary: true }]);
  const negRes = await tapTool.execute({ x: 500, y: 500 });
  assert.strictEqual(negRes.ok, false, "瞬态失败时仍如实失败");
  assert.strictEqual(negRes.reason, "NOT_CREATED", "瞬态（非会话级）自愈失败不得替换原有 reason");
  mockAppBridge.clearScript();

  console.log("  ✓ 只读闸门拒绝 → READONLY_TASK + 可操作提示；瞬态失败 → 保留 NOT_CREATED");
}

await mockAppBridge.stop();
await mockA11yBridge.stop();

console.log("\n==================================================");
console.log("全部 14 组测试用例 100% 通过断言！");
console.log("==================================================");
