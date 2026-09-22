/**
 * Android Shizuku / Root 特权工具插件：给 DeepSeek Harness 提供特权 shell 能力。
 *
 * 特权通道（二选一，由 MainActivity 探测后通过环境变量告知）：
 *   - ROOT_AVAILABLE=1  ：设备有 root（su 可用），走 su -c 通道
 *   - SHIZUKU_AVAILABLE=1：Shizuku 已授权，走 app_process rish 通道
 * 两者都未授予时（ROOT_AVAILABLE != 1 且 SHIZUKU_AVAILABLE != 1），
 * **不注册特权工具** —— AI 的工具列表里没有 shizuku_shell，自然不会反复尝试调用；
 * 此时文件读写走 DSH 自带的 fs/bash 工具（只需"所有文件访问权限"，无需特权）。
 *
 * 默认在已授权的通道下自动执行（无需逐次审批）。
 * 如需恢复"每次确认"，在 MainActivity 里给 node 设置环境变量 SHIZUKU_APPROVE=ask。
 *
 * 注意：使用异步 spawn 而非 spawnSync，避免同步阻塞 node 事件循环，
 * 否则命令执行期间整个 DSH 后端（HTTP/WebSocket）会卡死，前端报 "Failed to fetch"。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawn } from "node:child_process";
import { Agent } from "node:http";
import { chmodSync, existsSync } from "node:fs";

const name = "tool-shizuku";
const inject = ["tools"];

/** 批次 7 keep-alive：与 3081/3181 本地桥的连接复用同一共享 Agent（进程生命周期内保持），
 *  免去每次工具调用重建 TCP 连接的开销（配合 App 侧桥服务的 keep-alive 支持）。 */
const bridgeAgent = new Agent({ keepAlive: true, maxSockets: 4 });

const APP_PROC = "/system/bin/app_process";
const SHIZUKU_LOADER = "rikka.shizuku.shell.ShizukuShellLoader";
const MAX_STDOUT = 8000;
const MAX_STDERR = 2000;

/** 特权通道是否可用（root 或 Shizuku 任一授予即可）。 */
function privilegedAvailable() {
  return process.env.ROOT_AVAILABLE === "1" || process.env.SHIZUKU_AVAILABLE === "1";
}

/** 本地桥接鉴权 token（MainActivity 注入 env APP_LOCAL_TOKEN；App 侧校验 X-DSH-Token 头）。
 *  token 为空时不加头，兼容未注入 token 的旧版 App。 */
function authHeaders(extra) {
  const t = process.env.APP_LOCAL_TOKEN || "";
  const h = extra ? { ...extra } : {};
  if (t) h["X-DSH-Token"] = t;
  return h;
}

const appPort = () => parseInt(process.env.APP_NOTIFY_PORT || "3081", 10);

/** App 本地 HTTP 请求（POST JSON），供审批门使用。 */
async function appPost(path, bodyObj, timeoutMs) {
  const http = await import("node:http");
  return new Promise((resolve) => {
    const body = JSON.stringify(bodyObj || {});
    const req = http.request({
      host: "127.0.0.1", port: appPort(), path, method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
      agent: bridgeAgent,
      timeout: timeoutMs || 8000
    }, (res) => {
      let d = "";
      res.setEncoding("utf8");
      res.on("data", (c) => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d || "{}")); }
        catch { resolve({ ok: false, error: "响应解析失败" }); }
      });
    });
    req.setTimeout(timeoutMs || 8000, () => { req.destroy(); resolve({ ok: false, error: "App 本地服务超时" }); });
    req.on("error", (e) => resolve({ ok: false, error: String(e && e.message || e) }));
    req.write(body);
    req.end();
  });
}

/**
 * 权限预设与审批门联动：解析当前执行上下文生效的权限预设模式。
 * 优先级与 fail-safe 规则：
 * 1. 优先从 exec.agent.session 结合 ctx.permissionPresets 或 sessionProjections 读取当前会话的生效预设（如 "danger-full-access" 或 "workspace-write"）；
 * 2. 环境变量 DSH_PERMISSION_MODE（显式配置/单测覆盖）；
 * 3. ctx.shell.sandboxMode（bash-local 批次 26 注入的响应式属性）；
 * 4. ctx.permissionPresets.defaultPreset；
 * 5. fail-safe 兜底：若 SHIZUKU_APPROVE=ask 或 APP_CONFIRM_DANGEROUS=1 则判定为 workspace-write，否则默认 danger-full-access。
 */
function getEffectivePermissionMode(ctx, exec) {
  const session = exec?.agent?.session;

  // 1. permissionPresets 服务
  try {
    const presets = ctx?.get ? ctx.get("permissionPresets") : ctx?.permissionPresets;
    if (presets) {
      if (session && typeof presets.current === "function") {
        const cur = presets.current(session);
        if (cur && cur !== "custom") return cur;
      }
    }
  } catch (_) {}

  // 2. sessionProjections 投影
  try {
    const projections = ctx?.get ? ctx.get("sessionProjections") : ctx?.sessionProjections;
    if (projections && session && typeof projections.stateOf === "function") {
      const state = projections.stateOf(session, "permissions");
      if (state?.preset && state.preset !== "custom") return state.preset;
      if (state?.sandbox) return state.sandbox;
    }
  } catch (_) {}

  // 3. 环境变量显式指定（测试桩/运维配置）
  if (process.env.DSH_PERMISSION_MODE) {
    return process.env.DSH_PERMISSION_MODE.trim();
  }

  // 4. shell.sandboxMode（批次 26 为 LocalBashExecutor 注入的 sandboxMode 响应式属性）
  try {
    const shell = ctx?.get ? ctx.get("shell") : ctx?.shell;
    if (shell?.sandboxMode) return shell.sandboxMode;
  } catch (_) {}

  // 5. permissionPresets.defaultPreset
  try {
    const presets = ctx?.get ? ctx.get("permissionPresets") : ctx?.permissionPresets;
    if (presets?.defaultPreset) return presets.defaultPreset;
  } catch (_) {}

  // 6. fail-safe 兜底
  if (process.env.SHIZUKU_APPROVE === "ask" || process.env.APP_CONFIRM_DANGEROUS === "1") {
    return "workspace-write";
  }

  return "danger-full-access";
}

/** 审批门：经 App 的 /confirm 发确认通知并轮询结果（与 dsh-tool-android 同机制）。 */
async function requestUserConfirm(toolName, action, target, timeoutSec = 60) {
  const toSec = timeoutSec || parseInt(process.env.DSH_CONFIRM_TIMEOUT_SEC || "60", 10);
  const created = await appPost("/confirm", {
    title: "AI 请求高危操作确认",
    text: "工具: " + toolName + "\n操作: " + action + "\n目标: " + (target || "(未指定)") + "\n拒绝则不执行，" + toSec + " 秒未确认视为拒绝。",
    timeoutSec: toSec
  });
  if (!created || !created.ok) {
    return { allowed: false, note: "无法发起确认（" + String((created && created.error) || "App 本地服务不可达") + "），操作已取消" };
  }
  if (!created.id) {
    return { allowed: true }; // 旧版 App：无 /confirm 路由 → 兼容放行
  }
  const pollIntervalMs = parseInt(process.env.DSH_CONFIRM_POLL_MS || "1000", 10);
  const deadline = Date.now() + (created.timeoutSec || toSec) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const st = await appPost("/confirm/result", { id: created.id });
    if (st.status === "allowed") return { allowed: true };
    if (st.status === "denied") return { allowed: false, note: "用户在通知中点了「拒绝」" };
    if (st.status === "expired") return { allowed: false, note: "确认通知已过期，操作已取消" };
  }
  return { allowed: false, note: "用户未在时限内确认（视为拒绝）" };
}

/**
 * 剥离会污染系统 app_process 链接的环境变量。
 * DSH 运行时为了加载 Node 自带的 .so 会设置 LD_LIBRARY_PATH（内含自定义 libz.so，
 * SONAME=libz.so.1），而 /system/bin/app_process 是系统二进制，必须用系统库
 * （/apex 的 libunwindstack.so 需要 SONAME=libz.so）。原样继承 process.env 会让
 * 系统链接器报 "cannot find libz.so from verneed[1]"。
 */
function sanitizeEnv(env) {
  const clean = { ...env };
  delete clean.LD_LIBRARY_PATH;
  delete clean.LD_PRELOAD;
  delete clean.LD_DEBUG;
  return clean;
}

/**
 * 确保 rish dex 只读。Android 15 的 ART 拒绝加载"当前 uid 可写"的 dex
 * （logcat: Writable dex file ... is not allowed → Abort）。MainActivity 从 assets
 * 提取的 dex 默认是 600（属主可写），所以每次执行前强制 chmod 444。
 */
function ensureDexReadOnly(dex) {
  try {
    if (dex && existsSync(dex)) chmodSync(dex, 0o444);
  } catch (_) {
    // 尽力而为：chmod 失败不阻断，让 app_process 的报错自然暴露。
  }
}

/** 异步调用 rish 执行一条 shell 命令（不阻塞事件循环，内部函数）。 */
function shizukuCmd(command, dex, appId, timeoutMs) {
  if (!dex) {
    return Promise.resolve({ ok: false, exit_code: -1, stdout: "", stderr: "", error: "SHIZUKU_DEX 未配置" });
  }
  ensureDexReadOnly(dex);
  const timeout = Math.max(1000, Math.min(timeoutMs || 30000, 120000));
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(APP_PROC, [
        `-Djava.class.path=${dex}`,
        "/system/bin",
        "--nice-name=rish",
        SHIZUKU_LOADER,
        "-c", command
      ], {
        env: { ...sanitizeEnv(process.env), RISH_APPLICATION_ID: appId || "com.deepseek.harness" },
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (e) {
      resolve({ ok: false, exit_code: -1, stdout: "", stderr: "", error: String(e && e.message || e) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (_) {}
    }, timeout);

    const finish = (ok, exitCode, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok,
        exit_code: exitCode,
        stdout: stdout.trim().slice(0, MAX_STDOUT),
        stderr: stderr.trim().slice(0, MAX_STDERR),
        ...(err ? { error: err } : {})
      });
    };

    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(false, -1, String(e && e.message || e)));
    child.on("close", (code, signal) => {
      const killed = signal === "SIGKILL" && code === null;
      if (killed) {
        finish(false, -1, "命令超时（" + timeout + "ms）被强制终止");
      } else {
        finish(code === 0, code ?? -1, undefined);
      }
    });
  });
}

/** 异步调用 su 执行一条 shell 命令（root 通道，与 shizukuCmd 相同的结果结构）。 */
function suCmd(command, timeoutMs) {
  const timeout = Math.max(1000, Math.min(timeoutMs || 30000, 120000));
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("su", ["-c", command], {
        env: sanitizeEnv(process.env),
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (e) {
      resolve({ ok: false, exit_code: -1, stdout: "", stderr: "", error: String(e && e.message || e) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (_) {}
    }, timeout);

    const finish = (ok, exitCode, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok,
        exit_code: exitCode,
        stdout: stdout.trim().slice(0, MAX_STDOUT),
        stderr: stderr.trim().slice(0, MAX_STDERR),
        ...(err ? { error: err } : {})
      });
    };

    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(false, -1, String(e && e.message || e)));
    child.on("close", (code, signal) => {
      const killed = signal === "SIGKILL" && code === null;
      if (killed) {
        finish(false, -1, "命令超时（" + timeout + "ms）被强制终止");
      } else {
        finish(code === 0, code ?? -1, undefined);
      }
    });
  });
}

/** 选择特权通道执行：root(su) 优先，否则 Shizuku。 */
function privCmd(command, timeoutMs) {
  if (process.env.ROOT_AVAILABLE === "1") {
    return suCmd(command, timeoutMs);
  }
  return shizukuCmd(command, process.env.SHIZUKU_DEX, process.env.SHIZUKU_APP_ID, timeoutMs);
}

/** 特权 shell 写操作特征（v1.8.4 审批门）：命中才需要用户确认；只读命令（dumpsys/getprop/
 *  pm list/settings get/logcat -d 等）不打扰。按命令段匹配，管道后的写命令也算。 */
const SHELL_WRITE_RE = /\b(pm\s+(install|uninstall|clear|grant|revoke)|settings\s+put|am\s+(force-stop|kill)|cmd\s+\w+\s+\S*\b(set|enable|disable|allow|deny)\b|rm\s|mv\s|chmod\s|chown\s|dd\s|mkfs|mount\s+-o\s+remount|input\s+(tap|swipe|text|keyevent)|wm\s+(size|density)\s+set|svc\s+(data|wifi|bluetooth)\s+(enable|disable))\b/i;

function needsConfirm(command) {
  return SHELL_WRITE_RE.test(String(command || ""));
}

/** 判断操作是否属于高危操作（需要审批拦截的操作）。只读或安全操作返回 false。 */
function isDangerousAction(toolName, action, target) {
  if (toolName === "shizuku_shell") {
    return needsConfirm(target || action);
  }
  return false;
}

/**
 * 权限预设模式与 Android 原生审批门（3081 /confirm）底层联动：
 * - 当处于 danger-full-access（完全权限）时：彻底短路直接放行（免审批，无打扰）；
 * - 当处于 workspace-write（工作区内修改）等受限模式时：
 *   - 只读/安全操作（如 dumpsys、getprop、pm list、settings get 等）：零弹窗直接放行；
 *   - 危险写操作（pm install/uninstall/clear/grant/settings put/rm/mv/chmod/input 等）：
 *     自动激活审批逻辑（请求 3081 /confirm 弹通知卡片）；
 *     若用户未允许或超时则抛出 USER_REJECTED 异常拦截执行。
 */
async function maybeApprove(ctx, exec, toolName, action, reason, timeoutSec = 60) {
  const mode = getEffectivePermissionMode(ctx, exec);

  // 1. 完全权限模式：彻底短路直接放行
  if (mode === "danger-full-access") {
    return { allowed: true, reason: "danger-full-access" };
  }

  // 2. 检查是否属于高危操作：只读/安全操作直接放行
  if (!isDangerousAction(toolName, action, reason)) {
    return { allowed: true, reason: "safe-action" };
  }

  // 3. 工作区或受限模式下的高危操作：激活 3081 原生审批门
  const c = await requestUserConfirm(toolName, action, reason, timeoutSec);
  if (!c.allowed) {
    const msg = c.note || "用户未在系统通知中确认该高危操作";
    const err = new Error(`[USER_REJECTED] ${msg}`);
    err.code = "USER_REJECTED";
    throw err;
  }

  return { allowed: true, reason: "user-allowed" };
}

/** 动态实时探测特权通道（在开机未授予但在运行中授予时自愈恢复） */
async function probePrivilegeLive() {
  if (process.env.ROOT_AVAILABLE === "1") return { available: true, channel: "root(su)", detail: "已授予 root 权限" };
  if (process.env.SHIZUKU_AVAILABLE === "1") return { available: true, channel: "shizuku", detail: "Shizuku 已授权" };
  try {
    const rRoot = await suCmd("id", 3000);
    if (rRoot.ok && rRoot.stdout.includes("uid=0")) {
      process.env.ROOT_AVAILABLE = "1";
      return { available: true, channel: "root(su)", detail: "已动态检测到 root 权限" };
    }
  } catch (_) {}
  const dex = process.env.SHIZUKU_DEX;
  if (dex) {
    try {
      const rShizuku = await shizukuCmd("echo __SHIZUKU_OK__", dex, process.env.SHIZUKU_APP_ID, 5000);
      if (rShizuku.ok && rShizuku.stdout.includes("__SHIZUKU_OK__")) {
        process.env.SHIZUKU_AVAILABLE = "1";
        return { available: true, channel: "shizuku", detail: "已动态检测到 Shizuku 授权" };
      }
    } catch (_) {}
  }
  return { available: false, channel: "none", detail: "root 与 Shizuku 均未就绪" };
}

function apply(ctx) {
  const approval = () => ctx.get("approval");

  // 1) 特权 shell（始终注册，未预置环境变量时调用期自愈探测）
  ctx.tools.register(defineTool({
    name: "shizuku_shell",
      description:
        "通过特权通道（root su 或 Shizuku，二选一，自动选择可用者）以系统 shell 权限执行一条命令，用于普通 bash 工具做不到的、需要系统/root 级权限的操作（例如 pm install/uninstall、am 停止应用、settings 修改系统设置、dumpsys 查询系统状态、grant/revoke 运行时权限等）。" +
        "启动应用必须使用 android_app launch，后台虚拟屏开关开启时它会自动路由；不要用 am start/monkey 绕过。" +
        "命令会在已授权的通道下自动执行（默认无需逐次确认）；仅当环境变量 SHIZUKU_APPROVE=ask 时才需要逐次审批。优先用普通 `bash` 工具，只有确实需要系统特权时才用本工具。",
      parameters: {
        command: {
          type: "string",
          required: true,
          description: "要执行的 shell 命令。会以系统/root 权限运行，请写清楚、可审计。"
        },
        timeout_ms: {
          type: "number",
          description: "超时毫秒，默认 30000，最大 120000。"
        }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true },
            exit_code: { type: "number" },
            stdout: { type: "string" },
            stderr: { type: "string" },
            error: { type: "string" }
          }
        },
        render: (_args, value) => [{
          type: "text",
          text: (value.ok ? "" : "执行失败：" + (value.error || value.stderr || "未知错误") + "\n\n") +
            "exit_code: " + value.exit_code + "\n" +
            (value.stdout ? "stdout:\n" + value.stdout : "") +
            (value.stderr ? "\nstderr:\n" + value.stderr : "")
        }]
      },
      async execute(args, exec) {
        if (process.env.ROOT_AVAILABLE !== "1" && process.env.SHIZUKU_AVAILABLE !== "1") {
          const live = await probePrivilegeLive();
          if (!live.available) {
            return {
              ok: false,
              exit_code: -1,
              stdout: "",
              stderr: "特权通道不可用（" + (live.detail || "未检测到 root 或 Shizuku 授权") + "）。请在系统或 Shizuku 中授权；常规文件操作请优先使用普通 bash / fs 工具。",
              error: "NO_PRIVILEGE"
            };
          }
        }
        await maybeApprove(ctx, exec, "shizuku_shell", "shell", args.command);
        return await privCmd(args.command, args.timeout_ms);
      }
    }));

  // 2) 授权状态探测（只读，不审批）。未授权时仍注册：AI 能自查"为什么没有特权工具"，
  //    得到"未授权"后就不会反复尝试特权命令；此时文件操作用 fs/bash 工具。
  ctx.tools.register(defineTool({
    name: "shizuku_status",
    description: "检查特权通道（root/Shizuku）是否可用且已授权。返回是否可用，以及失败时的原因。未授权时文件读写请使用 fs/bash 工具（只需所有文件访问权限），无需特权。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          available: { type: "boolean", required: true },
          channel: { type: "string" },
          detail: { type: "string" }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: value.available
          ? "特权通道可用（" + value.channel + "）"
          : "特权通道不可用：" + (value.detail || "未知原因") + "；文件读写请用 fs/bash 工具"
      }]
    },
    async execute() {
      return await probePrivilegeLive();
    }
  }));

  // 3) AI 发通知（**不依赖特权**：只需 App 通知权限，走本地 127.0.0.1:3081）
  // 始终注册：即使没有 root/Shizuku，只要用户在系统设置里给了通知权限就能发。
  ctx.tools.register(defineTool({
    name: "android_notify",
    description: "向用户手机发送一条系统通知（标题 + 正文）。**只需要通知权限（POST_NOTIFICATIONS），不需要 Shizuku/root**。用于：后台任务完成、需要用户关注、长时间任务的进度提醒等。如果返回 ok:false 且提示通知权限未授予，请让用户在系统设置里为本应用开启通知权限后重试。",
    parameters: {
      title: {
        type: "string",
        required: true,
        description: "通知标题，简短（建议不超过 20 字）。"
      },
      text: {
        type: "string",
        required: true,
        description: "通知正文，说明发生了什么或需要用户做什么。"
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: value.ok ? "通知已发送 ✅" : "通知发送失败：" + (value.error || "未知错误")
      }]
    },
    async execute(args) {
      try {
        const http = await import("node:http");
        const port = Number(process.env.APP_NOTIFY_PORT) || 3081;
        const body = JSON.stringify({ title: String(args.title || ""), text: String(args.text || "") });
        const result = await new Promise((resolve) => {
          const req = http.request({
            host: "127.0.0.1",
            port,
            path: "/notify",
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
            agent: bridgeAgent
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              try { resolve(JSON.parse(d || "{}")); }
              catch (e) { resolve({ ok: false, error: "响应解析失败" }); }
            });
          });
          req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, error: "通知服务超时" }); });
          req.on("error", (e) => resolve({ ok: false, error: String(e && e.message || e) }));
          req.write(body);
          req.end();
        });
        return result;
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }
  }));

  // 4) 本地设置（**不依赖特权**：只需 App 的「修改系统设置」WRITE_SETTINGS 权限，改 Settings.System 各项）
  ctx.tools.register(defineTool({
    name: "android_setting_app",
    description:
      "通过 App 自身的 WRITE_SETTINGS 权限修改系统设置（Settings.System 命名空间）。**不需要 Shizuku/root**，但需要用户在权限引导页或系统设置里授予「修改系统设置」权限。" +
      "常用 key：screen_brightness（亮度 0-255）、screen_brightness_mode（0=手动 1=自动）、screen_off_timeout（屏幕超时毫秒，如 60000）、" +
      "accelerometer_rotation（自动旋转 0/1）、font_scale（字体大小，如 1.0/1.3）、volume_music/volume_ring/volume_alarm/volume_notification（音量 0-15）、" +
      "sound_effects_enabled（触摸音 0/1）、haptic_feedback_enabled（震动反馈 0/1）、notification_light_pulse（通知灯 0/1）、ringtone（铃声 Uri）。" +
      "改全局设置（Global/Secure 命名空间）请用 shizuku_shell 的 settings 命令（需要特权）。",
    parameters: {
      key: {
        type: "string", required: true,
        description: "Settings.System 的 key（见工具描述常用清单）"
      },
      value: {
        type: "string", required: true,
        description: "要写入的值（数字或字符串）"
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          stream: { type: "string" },
          level: { type: "number" },
          max: { type: "number" }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: value.ok
          ? (value.stream ? "已设置 " + value.stream + " = " + value.level + "（最大 " + value.max + "）✅" : "系统设置已修改 ✅")
          : "修改失败：" + (value.error || "未知错误")
      }]
    },
    async execute(args) {
      try {
        const http = await import("node:http");
        const port = Number(process.env.APP_NOTIFY_PORT) || 3081;
        const body = JSON.stringify({ key: String(args.key || ""), value: String(args.value == null ? "" : args.value) });
        const result = await new Promise((resolve) => {
          const req = http.request({
            host: "127.0.0.1", port, path: "/setting", method: "POST",
            headers: authHeaders({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
            agent: bridgeAgent
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              try { resolve(JSON.parse(d || "{}")); }
              catch (e) { resolve({ ok: false, error: "响应解析失败" }); }
            });
          });
          req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, error: "本地服务超时" }); });
          req.on("error", (e) => resolve({ ok: false, error: String(e && e.message || e) }));
          req.write(body);
          req.end();
        });
        return result;
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }
  }));

  // 5) 剪贴板（**不依赖特权**：读写系统剪贴板，无需任何特殊权限）
  ctx.tools.register(defineTool({
    name: "android_clipboard",
    description: "读写手机剪贴板。**不需要 Shizuku/root 和任何特殊权限**。action=read 读取当前剪贴板内容；action=write 把 content 写入剪贴板（如 AI 生成代码/文本后让用户粘贴）；action=clear 清空剪贴板（批次 10c：App 侧 3081 /clipboard 已支持，用于注入后清理、不留敏感内容残留）。",
    parameters: {
      action: {
        type: "string", required: true,
        enum: ["read", "write", "clear"],
        description: "read=读取剪贴板内容；write=写入剪贴板（需带 content）；clear=清空剪贴板"
      },
      content: { type: "string", description: "write 时要写入的文本内容" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          content: { type: "string" },
          error: { type: "string" }
        }
      },
      render: (args, value) => [{
        type: "text",
        text: value.ok
          ? (value.content !== undefined ? "剪贴板内容：\n" + value.content
            : (args && args.action === "clear" ? "剪贴板已清空 ✅" : "已写入剪贴板 ✅"))
          : "剪贴板操作失败：" + (value.error || "未知错误")
      }]
    },
    async execute(args) {
      try {
        const http = await import("node:http");
        const port = Number(process.env.APP_NOTIFY_PORT) || 3081;
        const body = JSON.stringify({
          action: String(args.action || "read"),
          content: String(args.content == null ? "" : args.content)
        });
        const result = await new Promise((resolve) => {
          const req = http.request({
            host: "127.0.0.1", port, path: "/clipboard", method: "POST",
            headers: authHeaders({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
            agent: bridgeAgent
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              try { resolve(JSON.parse(d || "{}")); }
              catch (e) { resolve({ ok: false, error: "响应解析失败" }); }
            });
          });
          req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, error: "本地服务超时" }); });
          req.on("error", (e) => resolve({ ok: false, error: String(e && e.message || e) }));
          req.write(body);
          req.end();
        });
        return result;
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }
  }));

  // 6) 定时任务（**不依赖特权**：走系统 AlarmManager，到点自动拉起引擎执行任务，无需用户操作）
  ctx.tools.register(defineTool({
    name: "android_schedule",
    description:
      "设置一个定时任务：到点后**自动执行**（使用 Android AlarmManager + 自动拉起引擎，即使 App 不在前台也会执行，无需用户操作）。" +
      "适用：'10 分钟后帮我整理 /sdcard/Download 文件夹'、'明早 8 点提醒我打卡' 等。" +
      "执行方式：到点时 App 自动启动引擎，把任务文本作为消息发送给 AI 自动执行（需要 App 内已配置 API Key），完成后可配合 android_notify 通知用户。" +
                "参数：text=任务内容（要 AI 做的事，如 '整理下载文件夹'）；when=触发时间，支持相对秒数（如 600=10分钟后）或时间字符串（如 '08:00'=今天/明天8点、'2026-08-21 08:00:00'）。" +
                "重复：repeat=once|daily|interval（默认 once）；repeat=interval 时另给 intervalMin=间隔分钟数。",
    parameters: {
      text: {
        type: "string", required: true,
        description: "提醒内容，例如 '10 分钟后提醒我喝水' 的 '喝水'"
      },
        when: {
            type: "string", required: true,
            description: "触发时间：纯数字=相对秒数（600=10分钟后）；'HH:mm'=今天/明天该时刻；'yyyy-MM-dd HH:mm:ss'=具体时间"
        },
        // 批次85-R2：补齐重复语义 —— 此前工具只传 text/when，App 侧的 daily/interval 支持
        // 在工具面上完全不可达（用户说「每天 8 点」实际只会建一次性任务）。
        repeat: {
            type: "string",
            description: "重复方式：once=一次性（默认）；daily=每天；interval=每隔 intervalMin 分钟"
        },
        intervalMin: {
            type: "number",
            description: "仅 repeat=interval 时必填：间隔分钟数（>=1）"
        }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          at: { type: "string" },
          repeat: { type: "string" },
          hint: { type: "string" },
          error: { type: "string" }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: value.ok ? "定时已设置（" + (value.at || "") + (value.repeat ? "，" + value.repeat : "") + "）\n" + (value.hint || "") : "设置失败：" + (value.error || "未知错误")
      }]
    },
    async execute(args) {
      try {
        const http = await import("node:http");
        const port = Number(process.env.APP_NOTIFY_PORT) || 3081;
                const body = JSON.stringify({
                    text: String(args.text || ""),
                    when: String(args.when || ""),
                    repeat: String(args.repeat || ""),
                    intervalMin: Number(args.intervalMin || 0)
                });
        const raw = await new Promise((resolve) => {
          const req = http.request({
            host: "127.0.0.1", port, path: "/schedule", method: "POST",
            headers: authHeaders({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
            agent: bridgeAgent
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              try { resolve(JSON.parse(d || "{}")); }
              catch (e) { resolve({ ok: false, error: "响应解析失败" }); }
            });
          });
          req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, error: "本地服务超时" }); });
          req.on("error", (e) => resolve({ ok: false, error: String(e && e.message || e) }));
          req.write(body);
          req.end();
        });
        // #53 修复（批次6）：3081 /schedule 返回体含 repeat 等额外字段，而本工具 output
        // schema 是 additionalProperties:false——直接透传会被判 invalid output（曾坐实）。
        // 白名单挑字段，schema 显式声明 repeat:{type:"string"}。
        return {
          ok: raw.ok === true,
          at: typeof raw.at === "string" ? raw.at : "",
          repeat: typeof raw.repeat === "string" ? raw.repeat : "",
          hint: typeof raw.hint === "string" ? raw.hint : "",
          error: typeof raw.error === "string" ? raw.error : ""
        };
      } catch (e) {
        return { ok: false, at: "", repeat: "", hint: "", error: String(e && e.message || e) };
      }
    }
  }));


  // 7) 事件触发器（批次85-R4：不依赖特权 —— 走系统广播 + AlarmManager 同款执行链）
  ctx.tools.register(defineTool({
    name: "android_trigger",
    description:
      "事件触发器：在指定系统事件发生时**自动执行**一段任务（交给 AI 执行，App 不在前台也会跑）。" +
      "支持事件：接通/断开电源、电量低/恢复、屏幕亮/灭、插入/拔出耳机、网络连通/断开、安装/卸载/更新应用。" +
      "适合：手机接上充电器就静音、晚上熄屏就归档下载、连上 WiFi 就同步笔记、装上某个 App 就给它做初始配置。" +
      "注意：1) 事件触发有冷却时间（默认 60 秒，防抖防环）；2) 安装/卸载类事件可填 match 指定包名（留空=任意）；" +
      "3) 事件由系统广播驱动，可能比真实事件晚几秒。",
    parameters: {
      action: {
        type: "string", required: true,
        description: "list=列出触发器；events=列出支持的事件名；add=新增；remove=删除；enable/disable=启停；fire=手动测试某条；test=模拟某事件（验证用）"
      },
      event: { type: "string", description: "事件名（add/test 用）：如 power_connected / screen_off / net_connected / package_added" },
      match: { type: "string", description: "仅 package_* 与网络事件有意义：包名（留空或 * = 任意）" },
      text: { type: "string", description: "事件发生时交给 AI 执行的任务文本（add 用）" },
      cooldownSec: { type: "number", description: "冷却秒数，默认 60（add 用）" },
      id: { type: "string", description: "触发器 id（remove/enable/disable/fire 用）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          id: { type: "string" },
          count: { type: "number" },
          hits: { type: "number" },
          events: { type: "array" },
          triggers: { type: "array" },
          error: { type: "string" }
        }
      }
    },
    render: (_args, value) => [{
      type: "text",
      text: value.ok
        ? (value.id ? "触发器已创建：id=" + value.id
           : value.hits !== undefined ? "已模拟事件，命中 " + value.hits + " 条触发器"
           : value.count !== undefined ? "当前触发器 " + value.count + " 条\n" + JSON.stringify(value.triggers || [], null, 0)
           : "ok")
        : "失败：" + (value.error || "未知错误")
    }],
    async execute(args) {
      try {
        const http = await import("node:http");
        const port = Number(process.env.APP_NOTIFY_PORT) || 3081;
        const body = JSON.stringify({
          action: String(args.action || "list"),
          event: String(args.event || ""),
          match: String(args.match || ""),
          text: String(args.text || ""),
          cooldownSec: Number(args.cooldownSec || 0),
          id: String(args.id || "")
        });
        const raw = await new Promise((resolve) => {
          const req = http.request({
            host: "127.0.0.1",
            port,
            path: "/trigger",
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
            agent: bridgeAgent
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              try { resolve(JSON.parse(d)); } catch (e) { resolve({ ok: false, error: "bad json: " + d.slice(0, 120) }); }
            });
          });
          req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, error: "本地服务超时" }); });
          req.on("error", (e) => resolve({ ok: false, error: String(e && e.message || e) }));
          req.write(body);
          req.end();
        });
        return {
          ok: raw.ok === true,
          id: typeof raw.id === "string" ? raw.id : "",
          count: typeof raw.count === "number" ? raw.count : 0,
          hits: typeof raw.hits === "number" ? raw.hits : 0,
          events: Array.isArray(raw.events) ? raw.events : [],
          triggers: Array.isArray(raw.triggers) ? raw.triggers : [],
          error: typeof raw.error === "string" ? raw.error : ""
        };
      } catch (e) {
        return { ok: false, id: "", count: 0, hits: 0, events: [], triggers: [], error: String(e && e.message || e) };
      }
    }
  }));
}

export {
  apply,
  inject,
  name,
  maybeApprove,
  getEffectivePermissionMode,
  isDangerousAction,
  requestUserConfirm,
  needsConfirm
};
