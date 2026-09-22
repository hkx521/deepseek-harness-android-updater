/**
 * @file tests/test_m1_current_scope.mjs
 * @description M1 current scope 读屏路由回归测试。
 */

import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { resolve as pathResolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const dshToolsPath = pathResolve("build/updater/devhome/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools/lib/index.js");
const dshToolsUrl = pathToFileURL(dshToolsPath).href;
const loaderCode = `
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "@deepseek-ai/dsh-tools") {
      return { shortCircuit: true, url: ${JSON.stringify(dshToolsUrl)} };
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loaderCode)}`);

class MockBridgeServer {
  constructor() {
    this.server = null;
    this.port = 0;
    this.requests = [];
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          this.requests.push({ method: req.method, url: req.url, body });
          const path = req.url.split("?")[0];
          if (path === "/vscreen/create") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, displayId: 99, strategy: "plain", channel: "root" }));
            return;
          }
          if (path === "/display-info") {
            const dId = Number(new URL(req.url, "http://127.0.0.1").searchParams.get("displayId") || 0);
            // 真机尺寸：主屏 1256x2808，虚拟屏（displayId=99）1008x1792
            const isV = dId === 99;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, displayId: dId, width: isV ? 1008 : 1256, height: isV ? 1792 : 2808 }));
            return;
          }
          if (path === "/dump") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: true,
              package: "com.android.settings",
              version: 7,
              truncated: false,
              nodes: [{
                text: "设置",
                desc: "",
                cls: "android.widget.TextView",
                vid: "settings",
                x: 0,
                y: 0,
                w: 100,
                h: 40,
                clickable: false,
                input: false,
                checked: false,
                selected: false,
                scrollable: false,
                depth: 0
              }]
            }));
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
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  clear() {
    this.requests = [];
  }
}

function createTools() {
  const tools = new Map();
  const ctx = {
    config: {},
    on() {},
    tools: { register: (tool) => tools.set(tool.name, tool) },
    inject(_deps, cb) {
      cb({ tools: { register: (tool) => tools.set(tool.name, tool) } });
    }
  };
  return { ctx, tools };
}

function requestUrl(record) {
  return new URL(record.url, "http://127.0.0.1");
}

const appBridge = new MockBridgeServer();
const a11yBridge = new MockBridgeServer();
await appBridge.start();
await a11yBridge.start();
process.env.APP_NOTIFY_PORT = String(appBridge.port);
process.env.APP_A11Y_PORT = String(a11yBridge.port);
process.env.APP_LOCAL_TOKEN = "test-token";
process.env.DSH_VSCREEN_MODE = "1";

const a11yPlugin = await import("../plugins/dsh-tool-accessibility/lib/index.js");

test("M1 current scope bypasses vscreen routing and cache", async (t) => {
  try {
    const { ctx, tools } = createTools();
    a11yPlugin.apply(ctx);

    await t.test("current screen never creates vscreen and sends main-display flags", async () => {
      appBridge.clear();
      a11yBridge.clear();
      const result = await tools.get("android_screen").execute({ scope: "current" });
      assert.equal(result.ok, true);
      assert.equal(appBridge.requests.filter((r) => r.url.startsWith("/vscreen/")).length, 0);
      // 批次74 起插件会额外查一次 /display-info（算 fx/fy 的真实基准），
      // 本不变量只约束「语义树只读一次且参数正确」，故按 /dump 计数。
      const dumps = a11yBridge.requests.filter((r) => r.url.startsWith("/dump"));
      assert.equal(dumps.length, 1);
      const params = requestUrl(dumps[0]).searchParams;
      assert.equal(params.get("displayId"), "0");
      assert.equal(params.get("exclude_self"), "1");
      assert.equal(params.get("if_version"), null);
    });

    await t.test("auto keeps existing vscreen routing", async () => {
      appBridge.clear();
      a11yBridge.clear();
      const result = await tools.get("android_screen").execute({ scope: "auto" });
      assert.equal(result.ok, true);
      assert.equal(appBridge.requests.filter((r) => r.url === "/vscreen/create").length, 1);
      // 批次74 起插件会额外查一次 /display-info（算 fx/fy 的真实基准），
      // 本不变量只约束「语义树只读一次且参数正确」，故按 /dump 计数。
      const dumps = a11yBridge.requests.filter((r) => r.url.startsWith("/dump"));
      assert.equal(dumps.length, 1);
      const params = requestUrl(dumps[0]).searchParams;
      assert.equal(params.get("displayId"), "99");
      assert.equal(params.get("exclude_self"), null);
    });

    await t.test("current refresh bypasses an existing vscreen", async () => {
      appBridge.clear();
      a11yBridge.clear();
      const result = await tools.get("android_screen_refresh").execute({ scope: "current", vid: "settings" });
      assert.equal(result.ok, true);
      assert.equal(appBridge.requests.length, 0);
      const params = requestUrl(a11yBridge.requests.find((r) => r.url.startsWith("/dump"))).searchParams;
      assert.equal(params.get("displayId"), "0");
      assert.equal(params.get("exclude_self"), "1");
      assert.equal(params.get("vid"), "settings");
    });

    await t.test("auto refresh keeps existing vscreen routing", async () => {
      appBridge.clear();
      a11yBridge.clear();
      const result = await tools.get("android_screen_refresh").execute({ scope: "auto" });
      assert.equal(result.ok, true);
      assert.equal(appBridge.requests.length, 0);
      assert.equal(requestUrl(a11yBridge.requests.find((r) => r.url.startsWith("/dump"))).searchParams.get("displayId"), "99");
    });

    await t.test("Java dump path reuses context selection and reports no readable window", async () => {
      const java = await readFile(new URL("../android-app/src/com/deepseek/harness/AccessibilityService.java", import.meta.url), "utf8");
      assert.match(java, /queryParam\(path, "exclude_self"\)/);
      assert.match(java, /ContextTarget target = readContextTarget\(\);/);
      assert.match(java, /o\.put\("error", REASON_NO_ACCESSIBILITY_READABLE_WINDOW\);/);
    });
  } finally {
    await appBridge.stop();
    await a11yBridge.stop();
  }
});
