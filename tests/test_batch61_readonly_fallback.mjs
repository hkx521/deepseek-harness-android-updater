/**
 * @file tests/test_batch61_readonly_fallback.mjs
 * @description 批次61 回归：只读任务进行中 App 拒绝 /vscreen/create（硬闸门）时，
 *   只读工具（android_screen / android_screen_refresh / android_see / android_screenshot）
 *   必须自动降级到主屏继续工作；写操作（android_tap 等）仍必须明确报错、不静默降级。
 *   同时验证「建屏成功 → 原虚拟屏路由不变」防止回归。
 *
 * 运行：node tests/test_batch61_readonly_fallback.mjs
 */

import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { resolve as pathResolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// 1) 与 test_vscreen_router.mjs / test_m1_current_scope.mjs 一致的 dsh-tools 解析钩子
const dshToolsPath = pathResolve("build/updater/devhome/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools/lib/index.js");
const dshToolsUrl = pathToFileURL(dshToolsPath).href;
const loaderCode = "export async function resolve(specifier, context, nextResolve) {" +
  "if (specifier === \"@deepseek-ai/dsh-tools\") { return { shortCircuit: true, url: " + JSON.stringify(dshToolsUrl) + " }; }" +
  "return nextResolve(specifier, context); }";
register("data:text/javascript," + encodeURIComponent(loaderCode));

// 1x1 最小合法透明 PNG
const MINIMAL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// android_see 主屏降级分支会 readFile(a11y /screenshot 返回的 path)，故需要真实落盘文件
const SHOT_PATH = pathResolve(".local/_pf_main_shot.png");
mkdirSync(pathResolve(".local"), { recursive: true });
writeFileSync(SHOT_PATH, MINIMAL_PNG);

class MockBridgeServer {
  constructor(name) {
    this.name = name;
    this.server = null;
    this.port = 0;
    this.requests = [];
    this.vscreenCreateOk = true;
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        let bodyStr = "";
        req.on("data", (chunk) => (bodyStr += chunk));
        req.on("end", () => {
          this.requests.push({ method: req.method, url: req.url, body: bodyStr });
          const urlPath = req.url.split("?")[0];

          // ---- 3081 App 本地桥 ----
          if (urlPath === "/vscreen/create") {
            res.writeHead(200, { "Content-Type": "application/json" });
            if (this.vscreenCreateOk) {
              res.end(JSON.stringify({ ok: true, displayId: 99, strategy: "plain", channel: "root" }));
            } else {
              // 复刻 App 侧只读任务硬闸门的拒绝体：ok:false + reason + hint + detail
              res.end(JSON.stringify({
                ok: false,
                reason: "READONLY_TASK",
                hint: "本轮不需要虚拟屏，请直接读取主屏",
                detail: "只读任务进行中，App 已拒绝创建虚拟屏"
              }));
            }
            return;
          }
          if (urlPath === "/vscreen/see") {
            res.writeHead(200, { "Content-Type": "image/png" });
            res.end(MINIMAL_PNG);
            return;
          }

          // ---- 3181 无障碍主屏路由 ----
          if (urlPath === "/dump") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: true,
              package: "com.android.settings",
              version: 7,
              truncated: false,
              nodes: [{
                text: "设置", desc: "", cls: "android.widget.TextView", vid: "settings",
                x: 0, y: 0, w: 100, h: 40,
                clickable: false, input: false, checked: false, selected: false, scrollable: false, depth: 0
              }]
            }));
            return;
          }
          if (urlPath === "/screenshot") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: true, path: SHOT_PATH,
              screenW: 1080, screenH: 1920, imageW: 1080, imageH: 1920,
              scaleX: 1, scaleY: 1, grid: 0
            }));
            return;
          }
          if (urlPath === "/tap") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, found: true, method: "a11y-action" }));
            return;
          }

          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "not found" }));
        });
      });
      this.server.listen(0, "127.0.0.1", () => {
        this.port = this.server.address().port;
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  clear() { this.requests = []; }
  paths() { return this.requests.map((r) => r.url.split("?")[0]); }
  count(path) { return this.paths().filter((p) => p === path).length; }
}

const appBridge = new MockBridgeServer("AppBridge-3081");
const a11yBridge = new MockBridgeServer("A11yBridge-3181");
await appBridge.start();
await a11yBridge.start();

process.env.APP_NOTIFY_PORT = String(appBridge.port);
process.env.APP_A11Y_PORT = String(a11yBridge.port);
process.env.APP_LOCAL_TOKEN = "test-token";
process.env.ROOT_AVAILABLE = "1";
process.env.DSH_VSCREEN_MODE = "1";

const a11yPlugin = await import("../plugins/dsh-tool-accessibility/lib/index.js");
const androidPlugin = await import("../plugins/dsh-tool-android/lib/index.js");

function createTools() {
  const tools = new Map();
  const savedImages = [];
  const attachments = {
    saveImage: async ({ data, mediaType, name }) => {
      const ref = {
        attachmentId: "att-" + (savedImages.length + 1),
        mediaType: mediaType || "image/png",
        bytes: data.length,
        width: 1,
        height: 1,
        name: name || "image.png"
      };
      savedImages.push(ref);
      return ref;
    }
  };
  const ctx = {
    config: {},
    on() {},
    tools: { register: (tool) => tools.set(tool.name, tool) },
    inject(_deps, cb) {
      cb({
        tools: { register: (tool) => tools.set(tool.name, tool) },
        get: (dep) => (dep === "attachments" ? attachments : undefined)
      });
    }
  };
  return { ctx, tools, savedImages };
}

function requestParams(record) {
  return new URL(record.url, "http://127.0.0.1").searchParams;
}

const { ctx, tools } = createTools();
androidPlugin.apply(ctx);
a11yPlugin.apply(ctx);

test("批次61：只读工具建屏被拒自动降级主屏，写操作不静默降级", async (t) => {
  try {
    await t.test("建屏被拒：android_screen 仍 ok 且走主屏 /dump，只尝试一次建屏", async () => {
      appBridge.vscreenCreateOk = false;
      appBridge.clear();
      a11yBridge.clear();

      const res = await tools.get("android_screen").execute({});

      assert.equal(res.ok, true, "只读任务建屏被拒时 android_screen 必须仍然成功");
      assert.equal(appBridge.count("/vscreen/create"), 1, "只允许一次建屏尝试，失败后不得重试");
      assert.equal(appBridge.count("/vscreen/see"), 0, "不得请求虚拟屏画面");
      const dumps = a11yBridge.requests.filter((r) => r.url.startsWith("/dump"));
      assert.equal(dumps.length, 1, "应通过一次主屏 /dump 取快照");
      const params = requestParams(dumps[0]);
      assert.equal(params.get("displayId"), "0", "降级必须读主屏 displayId=0");
      assert.equal(params.get("exclude_self"), "1", "降级必须带 exclude_self=1");
      assert.equal(params.get("if_version"), null, "降级分支不走向条件请求");
      assert.equal(res.nodes.length, 1, "主屏节点树照常返回");
      assert.ok(typeof res.hint === "string" && res.hint.includes("虚拟屏不可用") && res.hint.includes("主屏"),
        "降级成功路径必须附 hint 说明改用主屏");
    });

    await t.test("建屏被拒：android_screen_refresh 仍 ok 且沿用定向 dump 参数", async () => {
      appBridge.vscreenCreateOk = false;
      appBridge.clear();
      a11yBridge.clear();

      const res = await tools.get("android_screen_refresh").execute({ vid: "settings", depth: 5 });

      assert.equal(res.ok, true, "只读任务建屏被拒时 android_screen_refresh 必须仍然成功");
      assert.equal(appBridge.count("/vscreen/create"), 1, "只允许一次建屏尝试");
      const params = requestParams(a11yBridge.requests.filter((r) => r.url.startsWith("/dump"))[0]);
      assert.equal(params.get("displayId"), "0");
      assert.equal(params.get("exclude_self"), "1");
      assert.equal(params.get("vid"), "settings", "定向 dump 的 vid 参数必须保留");
      assert.equal(params.get("depth"), "5", "定向 dump 的 depth 参数必须保留");
      assert.ok(res.hint.includes("主屏"), "降级成功路径必须附 hint");
    });

    await t.test("建屏被拒：android_see 仍 ok 且走主屏 /screenshot，hint 不误导为虚拟屏", async () => {
      appBridge.vscreenCreateOk = false;
      appBridge.clear();
      a11yBridge.clear();

      const res = await tools.get("android_see").execute({});

      assert.equal(res.ok, true, "只读任务建屏被拒时 android_see 必须仍然成功");
      assert.equal(appBridge.count("/vscreen/create"), 1, "只允许一次建屏尝试");
      assert.equal(appBridge.count("/vscreen/see"), 0, "不得请求 /vscreen/see");
      assert.equal(a11yBridge.requests.filter((r) => r.url.startsWith("/screenshot")).length, 1,
        "必须走主屏 /screenshot");
      assert.ok(res.image && res.image.mediaType === "image/png", "截图仍应作为图片附件返回");
      assert.ok(typeof res.hint === "string" && res.hint.includes("主屏"), "降级必须说明改用主屏");
      assert.ok(!res.hint.includes("虚拟屏当前画面"), "hint 不得误导为虚拟屏画面");
    });

    await t.test("建屏被拒：写操作 android_tap 仍失败，不静默降级到主屏", async () => {
      appBridge.vscreenCreateOk = false;
      appBridge.clear();
      a11yBridge.clear();

      const res = await tools.get("android_tap").execute({ x: 100, y: 200 });

      assert.equal(res.ok, false, "写操作建屏被拒必须明确失败");
      assert.equal(res.reason, "READONLY_TASK", "必须原样透传建屏失败 reason");
      assert.equal(res.found, false, "不得声称已点击");
      assert.equal(a11yBridge.requests.filter((r) => r.url.startsWith("/tap")).length, 0,
        "绝不允许把写操作打到用户主屏");
    });

    await t.test("建屏被拒：android_screenshot（特权截图）降级主屏 screencap，不再报建屏错误", async () => {
      appBridge.vscreenCreateOk = false;
      appBridge.clear();
      a11yBridge.clear();

      const res = await tools.get("android_screenshot").execute({});

      assert.notEqual(res.error, "READONLY_TASK", "android_screenshot 不得因建屏被拒而失败");
      assert.equal(appBridge.count("/vscreen/create"), 1, "只允许一次建屏尝试");
      assert.equal(appBridge.count("/vscreen/see"), 0, "不得请求 /vscreen/see");
      assert.ok(String(res.stdout || "").includes("已改用主屏截图"),
        "降级说明必须落在 stdout（该工具 schema 无 hint 字段）");
    });

    await t.test("建屏成功：原虚拟屏路由不变（回归）", async () => {
      appBridge.vscreenCreateOk = true;
      appBridge.clear();
      a11yBridge.clear();

      const screenRes = await tools.get("android_screen").execute({});
      assert.equal(screenRes.ok, true);
      assert.equal(appBridge.count("/vscreen/create"), 1, "自愈建屏仍应发生一次");
      const params = requestParams(a11yBridge.requests.filter((r) => r.url.startsWith("/dump"))[0]);
      assert.equal(params.get("displayId"), "99", "建屏成功时必须读虚拟屏 displayId");
      assert.equal(params.get("exclude_self"), null, "虚拟屏路由不得带主屏专用参数");
      assert.equal(screenRes.hint, undefined, "虚拟屏成功路径不得新增降级 hint");

      appBridge.clear();
      a11yBridge.clear();
      const seeRes = await tools.get("android_see").execute({});
      assert.equal(seeRes.ok, true);
      assert.equal(appBridge.count("/vscreen/see"), 1, "建屏成功时 android_see 仍读虚拟屏画面");
      assert.equal(seeRes.hint, "虚拟屏当前画面（后台隔离模式）", "虚拟屏成功路径 hint 不变");
      assert.equal(a11yBridge.requests.length, 0, "建屏成功时不得触碰主屏 /screenshot");
    });
  } finally {
    await appBridge.stop();
    await a11yBridge.stop();
  }
});