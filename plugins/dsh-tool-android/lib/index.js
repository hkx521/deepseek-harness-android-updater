/**
 * Android 手机端系统能力插件：给 DeepSeek Harness 提供结构化、语义化的系统操作工具。
 *
 * 覆盖：包管理（安装/卸载/清数据/授权）、应用管理（启动/强制停止）、
 *       系统设置读写、截图、模拟输入（点击/滑动/文本/按键）。
 *
 * 特权通道（由 MainActivity 探测后通过环境变量告知）：
 *   - ROOT_AVAILABLE=1  ：设备有 root（su 可用），走 su -c 通道
 *   - SHIZUKU_AVAILABLE=1：Shizuku 已授权，走 app_process rish 通道
 * 两者都未授予时**不注册任何工具**：AI 工具列表里没有 android_*，
 * 自然不会反复尝试系统操作；此时文件读写走 DSH 自带 fs/bash 工具。
 *
 * 审批策略：默认自动执行（已授权通道）。设环境变量 SHIZUKU_APPROVE=ask
 * 时，危险操作（安装/卸载/清数据/授权/改设置/输入）会逐次弹审批框。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawn } from "node:child_process";
import { get as httpGet, request as httpRequest, Agent } from "node:http";
import { chmodSync, existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";

const name = "tool-android";
const inject = ["tools"];

/** 批次 7 keep-alive：与 3081/3181 本地桥的连接复用同一共享 Agent（进程生命周期内保持），
 *  免去每次工具调用重建 TCP 连接的开销（配合 App 侧桥服务的 keep-alive 支持）。 */
const bridgeAgent = new Agent({ keepAlive: true, maxSockets: 4 });

const APP_PROC = "/system/bin/app_process";
const SHIZUKU_LOADER = "rikka.shizuku.shell.ShizukuShellLoader";
const MAX_STDOUT = 8000;
const MAX_STDERR = 2000;

/** chroot 全功能通道（batch5）：Alpine minirootfs 落地点 + 输出截断上限。 */
const CHROOT_DIR = "/data/local/dsh-chroot";
const CHROOT_OUT_LIMIT = 4000;
/** chroot 后台作业（批次6）：注册表目录 + 输出/脚本文件落点（设备侧文件，重启仍在）。 */
const CHROOT_JOBS_DIR = CHROOT_DIR + "/.jobs";
/** 包装脚本 → Node 的结构化标记行（解析后从 stdout/stderr 剥离，不污染命令输出）。 */
const CHROOT_SHELL_PREFIX = "___DSH_CHROOT_SHELL___:";
const CHROOT_NOTE_PREFIX = "___DSH_CHROOT_NOTE___:";
const CHROOT_NOROOTFS = "___DSH_CHROOT_NOROOTFS___";

/** 批次72：托管常驻下引擎进程自身已是 shell(uid=2000)，
 *  无需 rish/Shizuku 代理即可执行特权命令（/system/bin/sh 直通，零 IPC 开销）。 */
function isHostedShellPrivileged() {
  if (process.env.DSH_HOSTED_DIR) return true;
  try {
    if (typeof process.getuid === "function" && process.getuid() === 2000) return true;
  } catch (_) {}
  return false;
}

/** 特权通道是否可用（root / Shizuku / 托管 shell 自身，任一成立即可）。 */
function privilegedAvailable() {
  return process.env.ROOT_AVAILABLE === "1" ||
    process.env.SHIZUKU_AVAILABLE === "1" ||
    isHostedShellPrivileged();
}

/** 批次86-P2-1：chroot 工具面（android_chroot_exec / android_chroot_job / android_task_list /
 *  android_task_resume）的注册判据。只有真正具备 chroot 落地条件时才注册：
 *    ① ROOT_AVAILABLE=1 —— root 通道在位（rootfs 未就绪时仍注册，保留"返回准备指引"的可发现性）；
 *    ② 设备上 rootfs 已在位（CHROOT_DIR/bin/busybox 存在，如 root 通道离线但 rootfs 已落盘）。
 *  两条都不成立 ⇒ 不注册：这 4 个工具无论怎么调都必然失败，注册了只会让模型白烧一轮。
 *  典型场景是本机（Honor BKQ-AN10：无 su/root、/data/local/dsh-chroot/bin/busybox 不存在）。
 *  ⚠ 不要改用 privilegedAvailable()：它把 root / Shizuku / 托管 shell 自身都算作特权，本机托管
 *  引擎以 shell(uid=2000) 运行即返回 true，但 shell 没有 mount/chroot 权限，判不出 chroot 可用性。
 *  本判据只收窄注册条件，特权路径实现全部保留（用户还有其他有 root 的机器）。
 *  根因与实测取证：docs/批次86-重审与瘦身方案.md §P2-1。 */
function chrootToolsAvailable() {
  if (process.env.ROOT_AVAILABLE === "1") return true;
  try {
    return existsSync(CHROOT_DIR + "/bin/busybox");
  } catch (_) {
    return false;
  }
}

/** 批次 8a（采纳上游 woaiys3 v1.11.0）：`input text` 只接受可打印 ASCII（空格须写 %s），
 *  含非 ASCII（中文/emoji 等）的文本经 safe() 会被整段删空、直接下发也被系统静默丢弃。
 *  上游方案：纯可打印 ASCII → `input text`（空格转 %s）；
 *  含非 ASCII → 3081 /clipboard write + 特权 `input keyevent 279`（KEYCODE_PASTE）粘贴注入，
 *  注入完成即清空剪贴板（粘贴路径必然覆盖用户剪贴板，不留注入残留）。 */
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

/** ASCII 注入命令：input text + 单引号转义 + 空格转 %s。
 *  不再过 safe()——safe 会删掉空格与标点导致丢字；shq() 已保证 shell 注入安全。 */
function asciiInputCmd(text) {
  return "input text " + shq(String(text).replace(/ /g, "%s"));
}

/** 非 ASCII 注入：写剪贴板（3081 /clipboard，JSON body）→ input keyevent 279 → 清剪贴板。 */
async function injectViaClipboard(text) {
  const w = await appPost("/clipboard", { action: "write", content: String(text) }, 8000);
  if (!w || !w.ok) {
    return {
      ok: false, exit_code: -1, stdout: "",
      stderr: "剪贴板写入失败：" + ((w && w.error) || "App 本地服务异常"),
      error: "clipboard_write_failed"
    };
  }
  const r = await privCmd("input keyevent 279", 12000);
  // best-effort 清空剪贴板（失败不影响主流程）
  await appPost("/clipboard", { action: "clear" }, 5000);
  return r;
}

/** 按文本内容自动选择注入通道（批次 8a 路由）：ASCII 走 input text，非 ASCII 走剪贴板粘贴。 */
function injectText(text) {
  if (PRINTABLE_ASCII.test(String(text))) {
    return privCmd(asciiInputCmd(text), 15000);
  }
  return injectViaClipboard(text);
}

/** 危险操作白名单：SHIZUKU_APPROVE=ask 时这些 action 需要审批。 */
const DANGEROUS_ACTIONS = new Set([
  "install", "uninstall", "clear", "grant", "revoke", "force_stop",
  "put", "tap", "swipe", "text", "keyevent"
]);

function sanitizeEnv(env) {
  const clean = { ...env };
  delete clean.LD_LIBRARY_PATH;
  delete clean.LD_PRELOAD;
  delete clean.LD_DEBUG;
  return clean;
}

function ensureDexReadOnly(dex) {
  try {
    if (dex && existsSync(dex)) chmodSync(dex, 0o444);
  } catch (_) {}
}

/** 只允许安全的 shell 令牌字符，防止命令注入。 */
function safe(s) {
  return String(s ?? "").replace(/[^a-zA-Z0-9._\/:=-]/g, "");
}

/** App 本地 HTTP 服务端口（MainActivity 注入环境变量 APP_NOTIFY_PORT，默认 3081）。 */
const appPort = () => parseInt(process.env.APP_NOTIFY_PORT || "3081", 10);

/** 批次81-T5：3081（App 侧本地桥）不可达时的统一可操作指引。
 *  3081 由 App 进程内的 MainActivity 提供（notify server），App 进程不在场时虚拟屏 /
 *  剪贴板 / 通知 / 悬浮窗 / 定时任务上报全部失败，而托管引擎 3080 仍在跑 —— 用户侧表现
 *  就是「dsh 里任务还在跑，小鲸鱼助手显示执行失败」。文案必须给出恢复动作（打开 App），
 *  而不是让模型反复重试。 */
const APP_BRIDGE_HINT =
  "App 侧本地桥（3081）不可达：请打开「小鲸鱼助手」（App 主界面，或点面板右上角的 ⤢）后重试——" +
  "虚拟屏、剪贴板、通知、悬浮窗都依赖 App 进程在场（引擎 3080 可能仍在运行，属正常）。";

/** 批次81-T5：3081 有响应但超时（可能是慢处理，不等于没在监听）—— 同样必须给出恢复动作。 */
const APP_BRIDGE_TIMEOUT_HINT =
  "App 侧本地桥（3081）无响应（超时）：请打开「小鲸鱼助手」（App 主界面）后重试。";

/** 批次82-N2：屏幕熄灭时视觉类能力（截图 / 虚拟屏画面）的可执行提示 ——
 *  用户已拍板放弃「息屏下虚拟屏渲染」（本机息屏后必黑，属 ROM 行为，不再尝试绕过），
 *  所以这里必须如实告知「需要亮屏」并给出替代路径，而不是让模型反复重试。 */
const SCREEN_OFF_HINT =
  "屏幕已熄灭：截图 / 虚拟屏画面只在屏幕亮着时可靠（本机息屏后必黑，属 ROM 行为，不再尝试绕过）。" +
  "请点亮屏幕后重试；充电时常亮可在「小鲸鱼助手 → 保活自检（后台常驻）」里开启；" +
  "不需要像素的步骤请改用 android_see / android_dump 读节点。";

/** 无障碍桥端口（批次 7 #54：android_input text 注入的预检/回读走 3181）。 */
const a11yPort = () => parseInt(process.env.APP_A11Y_PORT || "3181", 10);

/** 本地桥接鉴权 token（MainActivity 注入 env APP_LOCAL_TOKEN；App 侧校验 X-DSH-Token 头）。 */
const appLocalToken = () => process.env.APP_LOCAL_TOKEN || "";

/** 构造鉴权头（token 为空时不加，兼容未注入 token 的旧版 App）。 */
function authHeaders(extra) {
  const t = appLocalToken();
  const h = extra ? { ...extra } : {};
  if (t) h["X-DSH-Token"] = t;
  return h;
}

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
    req.setTimeout(timeoutMs || 8000, () => { req.destroy(); resolve({ ok: false, error: APP_BRIDGE_TIMEOUT_HINT }); });
    req.on("error", (e) => resolve({ ok: false, error: String(e && e.message || e) }));
    req.write(body);
    req.end();
  });
}

/** 无障碍桥（3181）GET 请求（批次 7 #54/#57）：带查询参数，返回解析后的 JSON。
 *  桥不可达/超时时返回 { ok:false, unreachable:true, error }（调用方据此降级并标注 reason）。
 *  共享 keep-alive Agent（与 3081 相同实例）。 */
function a11yGet(path, params, timeoutMs) {
  const qs = params
    ? "?" + Object.entries(params).map(([k, v]) =>
        encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&")
    : "";
  return new Promise((resolve) => {
    const req = httpGet({
      host: "127.0.0.1", port: a11yPort(), path: path + qs,
      headers: authHeaders(), agent: bridgeAgent, timeout: timeoutMs || 8000
    }, (res) => {
      let d = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { d += c; if (d.length > 262144) req.destroy(); });
      res.on("end", () => {
        try { resolve(JSON.parse(d || "{}")); }
        catch { resolve({ ok: false, error: "a11y 桥响应解析失败" }); }
      });
    });
    req.on("error", () => resolve({ ok: false, unreachable: true, error: "App 本地服务不可用" }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, unreachable: true, error: "App 本地服务超时" }); });
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

/** 判断操作是否属于高危操作（需要审批拦截的操作）。只读或安全操作返回 false。 */
function isDangerousAction(toolName, action, target) {
  const act = String(action || "").toLowerCase();
  if (toolName === "shizuku_shell") {
    const SHELL_WRITE_RE = /\b(pm\s+(install|uninstall|clear|grant|revoke)|settings\s+put|am\s+(force-stop|kill)|cmd\s+\w+\s+\S*\b(set|enable|disable|allow|deny)\b|rm\s|mv\s|chmod\s|chown\s|dd\s|mkfs|mount\s+-o\s+remount|input\s+(tap|swipe|text|keyevent)|wm\s+(size|density)\s+set|svc\s+(data|wifi|bluetooth)\s+(enable|disable))\b/i;
    return SHELL_WRITE_RE.test(String(target || action || ""));
  }
  if (toolName === "android_package") {
    return ["install", "uninstall", "clear", "grant", "revoke"].includes(act);
  }
  if (toolName === "android_app") {
    return act === "force_stop";
  }
  if (toolName === "android_setting") {
    return act === "put";
  }
  if (toolName === "android_input") {
    return ["tap", "swipe", "text", "keyevent"].includes(act);
  }
  return DANGEROUS_ACTIONS.has(act);
}

/**
 * 高危操作审批门（3081 /confirm）：经 App 的 /confirm 发确认通知（允许/拒绝按钮），
 * 用户点「允许」才执行；超时未确认/用户拒绝 → 不执行（fail-closed）。
 * 旧版 App（无 /confirm 路由，返回 ok:true 但无 id）时放行以保持兼容。
 */
async function requestUserConfirm(toolName, action, target, timeoutSec = 60) {
  const toSec = timeoutSec || parseInt(process.env.DSH_CONFIRM_TIMEOUT_SEC || "60", 10);
  const created = await appPost("/confirm", {
    title: "AI 请求高危操作确认",
    text: "工具: " + toolName + "\n操作: " + action + "\n目标: " + (target || "(未指定)") + "\n拒绝则不执行，" + toSec + " 秒未确认视为拒绝。",
    timeoutSec: toSec
  });
  if (!created || !created.ok) {
    // App 本地服务不可达或审批门关闭：fail-closed 拒绝（不可静默绕过审批）
    return { allowed: false, note: "无法发起确认（" + String((created && created.error) || "App 本地服务不可达") + "），操作已取消" };
  }
  if (!created.id) {
    // 旧版 App：未知 POST 路由被当成 /notify 处理（返回 ok:true 但无 id）→ 兼容放行
    return { allowed: true };
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
 * 权限预设模式与 Android 原生审批门（3081 /confirm）底层联动：
 * - 当处于 danger-full-access（完全权限）时：彻底短路直接放行（免审批，无打扰）；
 * - 当处于 workspace-write（工作区内修改）等受限模式时：
 *   - 只读/安全操作：零弹窗直接放行；
 *   - 危险操作（install/uninstall/clear/grant/settings put/input/特权写命令等）：
 *     自动激活审批逻辑（请求 3081 /confirm 弹通知卡片）；
 *     若用户未允许或超时则抛出 USER_REJECTED 异常拦截执行。
 */
async function maybeApprove(ctx, exec, toolName, action, reason, timeoutSec = 60) {
  const mode = getEffectivePermissionMode(ctx, exec);

  // 1. 完全权限模式：彻底短路直接放行
  if (mode === "danger-full-access") {
    return { allowed: true, reason: "danger-full-access" };
  }

  // 2. 判断操作危险性：安全操作直接放行
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

/** 批次82-N2：查 App 侧屏幕状态（3081 /status.screenOn）。true=亮着 / false=已熄灭 / undefined=查不到（按亮处理）。 */
async function appScreenOn() {
  try {
    const st = await appRequest("/status");
    if (st && typeof st.screenOn === "boolean") return st.screenOn;
  } catch (e) { /* 查不到就不阻断，避免误杀 */ }
  return undefined;
}

/** 调 App 本地 HTTP 端点（GET）。用于 usage/overlay 等 App 层能力，无需特权通道。
 *  返回解析后的 JSON 对象（DSH 工具运行时要求 execute 返回对象，字符串会被 schema 校验拒绝）。 */
function appRequest(path, params) {
  return new Promise((resolve) => {
    const qs = params
      ? "?" + Object.entries(params).map(([k, v]) =>
          encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&")
      : "";
    const req = httpGet({ host: "127.0.0.1", port: appPort(), path: path + qs, headers: authHeaders(), timeout: 8000 }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; if (data.length > 65536) req.destroy(); });
      res.on("end", () => {
        if (!data) return resolve({ ok: false, error: "empty response" });
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ ok: false, error: "App 响应解析失败: " + String(data).slice(0, 120) });
        }
      });
    });
    req.on("error", () => resolve({ ok: false, error: APP_BRIDGE_HINT }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: APP_BRIDGE_TIMEOUT_HINT }); });
    req.end();
  });
}

/** 异步执行一条 Shizuku shell 命令。 */
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
    // #52 说明：rish 通道里远端命令跑在 Shizuku server 侧，引擎无法直接 kill 树；
    // 超时只能 SIGKILL 本地 rish 进程（错误信息注明此限制，避免误以为远端已清场）。
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
    const finish = (ok, exitCode, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok,
        exit_code: exitCode,
        stdout: stripRomNoise(stdout).trim().slice(0, MAX_STDOUT),
        stderr: stderr.trim().slice(0, MAX_STDERR),
        ...(err ? { error: err } : {})
      });
    };
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(false, -1, String(e && e.message || e)));
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL" && code === null) finish(false, -1, "命令超时被强制终止（仅终止本地 rish 进程；Shizuku server 侧的远端命令树无法从引擎侧清理）");
      else finish(code === 0, code ?? -1, undefined);
    });
  });
}

/**
 * 异步执行一条 root(su) 命令，结果结构与 shizukuCmd 一致。
 * #52 修复（批次6）：su 子进程 uid=0，引擎（app 域）超时后只 child.kill 杀掉 su 本体是
 * 不够的——命令的孙进程树仍是 root，引擎直接 kill 会 EPERM，导致 `sleep 30` 之类命令
 * 超时返回后继续挂在设备上。现在：
 *   1) detached:true 让 su 成为新进程组 leader（pgid = su 的 pid），命令树全部落在同组；
 *   2) 超时后先 SIGKILL su 本体，再用 `su -c "kill -9 -<pgid>"` 以 root 杀整组（EPERM 消失）；
 *   3) 收敛确认：轮询 `ps -eo pid,pgid` 直到组内无残留（最多 ~2s），结果写进 error/note。
 * 正常完成路径零改动（detached 只影响退出时的组归属，不影响输出/exit code）。
 */
function suCmd(command, timeoutMs) {
  const timeout = Math.max(1000, Math.min(timeoutMs || 30000, 120000));
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("su", ["-c", command], {
        env: sanitizeEnv(process.env),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true // #52：新进程组 leader，超时可整组击杀
      });
    } catch (e) {
      resolve({ ok: false, exit_code: -1, stdout: "", stderr: "", error: String(e && e.message || e) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const pgid = child.pid;
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (_) {}
      // #52：root 杀整组（引擎无权 kill uid=0 进程，须借道 su）
      try {
        const killer = spawn("su", ["-c", "kill -9 -" + pgid + " 2>/dev/null; true"], {
          env: sanitizeEnv(process.env), stdio: "ignore"
        });
        killer.on("error", () => {});
      } catch (_) {}
    }, timeout);
    const finish = (ok, exitCode, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok,
        exit_code: exitCode,
        stdout: stripRomNoise(stdout).trim().slice(0, MAX_STDOUT),
        stderr: stderr.trim().slice(0, MAX_STDERR),
        ...(err ? { error: err } : {})
      });
    };
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(false, -1, String(e && e.message || e)));
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL" && code === null) {
        // #52：等整组击杀收敛后再返回（超时路径专用；失败信息如实标注残留风险）
        killGroupConfirm(pgid).then((clean) => {
          finish(false, -1, "命令超时被强制终止（已 root 击杀进程组 " + pgid +
            (clean ? "，组内无残留" : "，⚠️ 组内可能有残留进程，请用 ps 复核）") + ")");
        });
      } else {
        finish(code === 0, code ?? -1, undefined);
      }
    });
  });
}

/** #52 收敛确认：root 轮询同 pgid 的存活进程，直到清空或超 ~2s。返回 true=组内无残留。 */
async function killGroupConfirm(pgid) {
  for (let i = 0; i < 5; i++) {
    const r = await new Promise((resolve) => {
      let c;
      try {
        c = spawn("su", ["-c", "ps -eo pid,pgid 2>/dev/null | awk '$2==" + pgid + "' | head -5"], {
          env: sanitizeEnv(process.env), stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (_) { resolve({ stdout: "" }); return; }
      let out = "";
      c.stdout.on("data", (d) => { out += d; });
      c.on("error", () => resolve({ stdout: out }));
      c.on("close", () => resolve({ stdout: out }));
      setTimeout(() => { try { c.kill(); } catch (_) {} resolve({ stdout: out }); }, 2000);
    });
    if (!String(r.stdout || "").trim()) return true;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  return false;
}

/** 以当前进程自身权限直接执行一条 shell 命令（托管 uid=2000 时与特权等效）。
 *  原生支持多行脚本，无 app_process/rish 冷启动开销。 */
function shellCmd(command, timeoutMs) {
  const timeout = Math.max(1000, Math.min(timeoutMs || 30000, 120000));
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("/system/bin/sh", ["-c", command], {
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
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
    const finish = (ok, exitCode, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok,
        exit_code: exitCode,
        stdout: stripRomNoise(stdout).trim().slice(0, MAX_STDOUT),
        stderr: stderr.trim().slice(0, MAX_STDERR),
        ...(err ? { error: err } : {})
      });
    };
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(false, -1, String(e && e.message || e)));
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL" && code === null) finish(false, -1, "命令超时被强制终止");
      else finish(code === 0, code ?? -1, undefined);
    });
  });
}

/** 选择特权通道执行：root(su) 优先；托管 shell 自身次之（零 IPC）；否则 Shizuku(rish)。 */
function privCmd(command, timeoutMs, maxMs) {
  if (process.env.ROOT_AVAILABLE === "1") {
    return suCmd(command, timeoutMs, maxMs);
  }
  if (isHostedShellPrivileged() || !process.env.SHIZUKU_DEX) {
    return shellCmd(command, timeoutMs);
  }
  return shizukuCmd(command, process.env.SHIZUKU_DEX, process.env.SHIZUKU_APP_ID, timeoutMs, maxMs);
}

/** 剥离特权命令 stdout 中的 ROM 噪声行。
 *  实测（荣耀 BKQ-AN10，Android 17）：部分 ROM 的 monkey 是 shell 包装脚本，
 *  会往 stdout 打印每个参数的调试行（"bash arg: -p"、"args: [...]"、
 *  ' arg: "-p"'），另有系统工具的 "Network stats: enabled"、"Events injected"。
 *  功能不受影响，但 AI 拿到的 stdout 不可直接解析。 */
function stripRomNoise(text) {
  if (!text) return text;
  return text.split("\n").filter((line) =>
    !/^\s*bash arg: /.test(line) &&
    !/^args: \[/.test(line) &&
    !/^\s*arg: "/.test(line) &&
    !/^Network stats: /.test(line) &&
    !/^Events injected: /.test(line) &&
    !/^## Network stats/.test(line)
  ).join("\n");
}

/** 通用结果 schema（所有工具共用，避免 exit_code/exitCode 不匹配的坑）。 */
function resultSchema(extraProps = {}) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean", required: true },
      exit_code: { type: "number" },
      stdout: { type: "string" },
      stderr: { type: "string" },
      error: { type: "string" },
      ...extraProps
    }
  };
}

function renderResult(value) {
  return [{
    type: "text",
    text: (value.ok ? "" : "执行失败：" + (value.error || value.stderr || "未知错误") + "\n\n") +
      "exit_code: " + value.exit_code + "\n" +
      (value.stdout ? "stdout:\n" + value.stdout : "") +
      (value.stderr ? "\nstderr:\n" + value.stderr : "")
  }];
}

/** android_usage 专用渲染：把 apps 数组展示出来（通用 renderResult 只读 shell 字段，会吞掉数据）。 */
function renderUsage(value) {
  if (!value.ok) return renderResult(value);
  const lines = [`应用使用时长（最近 ${value.days ?? 1} 天，按时长降序）：`];
  const apps = Array.isArray(value.apps) ? value.apps : [];
  if (apps.length === 0) {
    lines.push("（无数据：可能未授予「使用情况访问」权限，或该时段无使用记录）");
  }
  for (const a of apps) {
    const label = (a && a.name) || (a && a.pkg) || "未知应用";
    const min = a && typeof a.min === "number" ? a.min : Math.round((a && a.ms || 0) / 60000);
    lines.push(`- ${label} (${a.pkg || ""}): ${min} 分钟`);
  }
  return [{ type: "text", text: lines.join("\n") }];
}

/** android_overlay 专用渲染：展示 running/engineUp/granted（通用 renderResult 只读 shell 字段）。 */
function renderOverlay(value) {
  if (!value.ok) return renderResult(value);
  const parts = [];
  if (typeof value.running === "boolean") parts.push("悬浮窗运行中: " + value.running);
  if (typeof value.engineUp === "boolean") parts.push("引擎在线: " + value.engineUp);
  if (typeof value.granted === "boolean") parts.push("悬浮窗权限: " + (value.granted ? "已授予" : "未授予"));
  if (parts.length === 0) parts.push("操作成功。");
  return [{ type: "text", text: parts.join("，") }];
}

/** chroot 命令的 rootfs 未就绪指引（不可在设备端下载：设备 root shell 没有 DNS）。 */
function chrootRootfsHint() {
  return [
    "chroot rootfs 未就绪：设备上找不到 " + CHROOT_DIR + "/bin/busybox。",
    "需要先在电脑上把 Alpine minirootfs(aarch64) 解压到设备 " + CHROOT_DIR + "，再调用本工具。",
    "设备端 root shell 没有 DNS，不要在设备上下载；在电脑上执行（已 adb 连接本机）：",
    "  curl -fL -o alpine.tar.gz https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/aarch64/alpine-minirootfs-3.24.1-aarch64.tar.gz",
    "  adb push alpine.tar.gz /data/local/tmp/",
    "  adb shell su -c 'mkdir -p " + CHROOT_DIR + " && tar -xzf /data/local/tmp/alpine.tar.gz -C " + CHROOT_DIR + "'",
    "然后先调用本工具一次（会自动写入 resolv.conf 并挂载），再装 bash/coreutils：",
    "  android_chroot_exec: apk add --no-cache bash coreutils"
  ].join("\n");
}

/** POSIX 单引号转义：把任意字符串安全嵌入外层 sh 脚本的一个参数位。 */
function shq(s) {
  return "'" + String(s == null ? "" : s).replace(/'/g, "'\\''") + "'";
}

// ===================== 通讯与个人信息只读查询（批次 10c / #29） =====================
// 红线：只读（content query），不实现任何发送/删除/写入；仅本机使用、读取系统通讯数据。
// 隐私：工具结果只进本机对话；落盘证据/报告须由采集方先打码（号码/姓名/短信正文）。
// Android 17 实测（Pixel 6 Pro / API 37）：content query 的 --projection 已从逗号分隔
// 改为【冒号】分隔（usage: <PROJECTION> is a list of colon separated column names），
// 旧 ROM 仍可能是逗号——先发冒号语法，命中 Invalid column/usage 再自动回退逗号重试。

/** call_log 的 type 列映射（CallLog.Calls 常量）。 */
const CALLLOG_TYPE = {
  1: "INCOMING", 2: "OUTGOING", 3: "MISSED", 4: "VOICEMAIL",
  5: "REJECTED", 6: "BLOCKED", 7: "ANSWERED_EXTERNALLY"
};

/** sms 的 type 列映射（Telephony.Sms 常量）。 */
const SMS_TYPE = {
  1: "RECEIVED", 2: "SENT", 3: "DRAFT", 4: "OUTBOX", 5: "FAILED", 6: "QUEUED"
};

/** data2（phone_v2）号码类型映射（ContactsContract.CommonDataKinds.Phone）。 */
const PHONE_TYPE = {
  1: "HOME", 2: "MOBILE", 3: "WORK", 4: "WORK_FAX", 5: "HOME_FAX",
  6: "PAGER", 7: "OTHER", 12: "MAIN"
};

/** 通讯查询的用户输入净化：去掉引号/分号/反斜杠（防 --where SQL 串与 shell 注入），限长。 */
function cleanQueryText(s) {
  return String(s == null ? "" : s).replace(/['"\\;]/g, "").slice(0, 200);
}

/** 毫秒 epoch → ISO 字符串（无效/非正数返回 null）。 */
function msToIso(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  try { return new Date(n).toISOString(); } catch (_) { return null; }
}

/** 构造一条 content query 命令（projection 冒号分隔，Android 17 实测语法）。 */
function buildContentQueryCmd(uri, fields, extraArgs) {
  return "content query --uri " + shq(uri) + " --projection " + fields.join(":") +
    (extraArgs ? " " + extraArgs : "");
}

/** 执行一次 content query：冒号 projection 失败（旧 ROM 为逗号语法）时自动回退逗号重试。 */
async function contentQuery(uri, fields, extraArgs, timeoutMs) {
  let r = await privCmd(buildContentQueryCmd(uri, fields, extraArgs || ""), timeoutMs || 8000);
  if (!r.ok && /Invalid column|usage: adb shell content/.test((r.stderr || "") + (r.stdout || ""))) {
    r = await privCmd("content query --uri " + shq(uri) + " --projection " + fields.join(",") +
      (extraArgs ? " " + extraArgs : ""), timeoutMs || 8000);
  }
  return r;
}

/**
 * 解析 content query 输出：`Row: N f1=v1, f2=v2, ...`（N 为行号）。
 * 值本身可能含逗号（短信正文/姓名），不能朴素 split(", ")——按已知字段顺序扫描
 * `, <下一字段>=` 边界切分；"NULL" 归一为 null。字段顺序必须与 projection 一致。
 */
function parseContentRows(stdout, fields) {
  const rows = [];
  for (const line of String(stdout == null ? "" : stdout).split("\n")) {
    const m = line.match(/^Row:\s*\d+\s+(.*)$/);
    if (!m) continue;
    const row = {};
    let rest = m[1];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!rest.startsWith(f + "=")) { row[f] = null; continue; }
      rest = rest.slice(f.length + 1);
      const next = fields[i + 1];
      let v;
      if (next) {
        const idx = rest.indexOf(", " + next + "=");
        if (idx >= 0) { v = rest.slice(0, idx); rest = rest.slice(idx + 2); }
        else v = rest;
      } else {
        v = rest;
      }
      row[f] = v === "NULL" ? null : v;
    }
    rows.push(row);
  }
  return rows;
}

/** 解析包装脚本输出：抽出 shell 选择 / rootfs 缺失 / notes 标记，其余为命令真实输出。 */
function parseChrootOutput(raw, notes) {
  let shell = "";
  let noRootfs = false;
  const kept = [];
  for (const line of String(raw == null ? "" : raw).split("\n")) {
    if (line.startsWith(CHROOT_SHELL_PREFIX)) { shell = line.slice(CHROOT_SHELL_PREFIX.length).trim(); continue; }
    if (line.startsWith(CHROOT_NOTE_PREFIX)) {
      const n = line.slice(CHROOT_NOTE_PREFIX.length).trim();
      if (n) notes.push(n);
      continue;
    }
    if (line === CHROOT_NOROOTFS) { noRootfs = true; continue; }
    kept.push(line);
  }
  return { shell, noRootfs, text: kept.join("\n").trim() };
}

/** 输出截断：超长时截到 limit 并附省略标记。 */
function truncateOut(s, limit) {
  const t = String(s == null ? "" : s);
  return t.length <= limit ? t : t.slice(0, limit) + "\n…（输出已截断，原始长度 " + t.length + " 字符）";
}

/** android_chroot_exec 专用渲染（通用 renderResult 不读 shell_used/rootfs_ready/notes）。 */
function renderChroot(value) {
  const lines = [value.ok ? "chroot 命令执行成功" : "chroot 命令执行失败"];
  lines.push("rootfs_ready: " + value.rootfs_ready);
  lines.push("shell_used: " + (value.shell_used || "(未知)"));
  lines.push("exit_code: " + value.exit_code);
  if (value.job_id) lines.push("job_id: " + value.job_id);
  if (value.background) lines.push("background: true（后台作业，用 android_chroot_job 管理）");
  const notes = Array.isArray(value.notes) ? value.notes : [];
  if (notes.length) lines.push("notes:\n" + notes.map((n) => " - " + n).join("\n"));
  if (value.stdout) lines.push("stdout:\n" + value.stdout);
  if (value.stderr) lines.push("stderr:\n" + value.stderr);
  if (!value.stdout && !value.stderr) lines.push("（无输出）");
  return [{ type: "text", text: lines.join("\n") }];
}

// ===================== TaskSupervisor 桥上报（批次23 S2，指令 ①） =====================
// chroot job 生命周期 → App 侧 Task DB（TaskStore，filesDir/tasks/tasks.json，设计文档 D1）。
// 红线：/task 调用全部 best-effort——桥不可达/超时（1.5s 短超时，批次23 S2 指令）只 console
// 记警告，绝不抛出、绝不影响作业主流程（作业本身已启动/已终止，Task DB 只是语义层）。

/** 上报任务注册/更新（幂等 upsert；startChrootJob 成功后调用，id 直接复用 job_id——D1 两层以 job_id 关联）。 */
async function taskUpsertBestEffort(taskBody) {
  try {
    const r = await appPost("/task/upsert", taskBody, 1500);
    if (!r || !r.ok) {
      console.warn("[tool-android] /task/upsert 降级（不影响作业主流程）: id="
        + (taskBody && taskBody.id) + " " + ((r && r.error) || "未知原因"));
    }
  } catch (e) {
    console.warn("[tool-android] /task/upsert 异常（不影响作业主流程）: " + String(e && e.message || e));
  }
}

/** 上报任务终态（kill 成功 → state=CANCELLED，D4；自然退出且 rc 已知 → exit/finishedAt）。 */
async function taskFinishBestEffort(taskId, fields) {
  try {
    const body = Object.assign({ id: String(taskId) }, fields || {});
    const r = await appPost("/task/finish", body, 1500);
    if (!r || !r.ok) {
      console.warn("[tool-android] /task/finish 降级（不影响作业主流程）: id=" + taskId
        + " " + ((r && r.error) || "未知原因"));
    }
  } catch (e) {
    console.warn("[tool-android] /task/finish 异常（不影响作业主流程）: " + String(e && e.message || e));
  }
}

/** 已上报过自然终态的作业 id（进程内存去重；App 侧 markFinished 本就幂等，去重只为省请求）。 */
const naturalFinishReported = new Set();

/**
 * list/output 的 kill -0 判活发现作业自然退出时的终态上报（批次23 S2 指令 ①）。
 * 只在 rc 已知（D3 的 rc/done 包装产物存在，批次23 S2 起新作业必有）时上报 exit——
 * 旧作业（无包装、无 rc 文件）不上报，留给 App 侧 TaskReaper 的 kill -0 对账落
 * INTERRUPTED（exit_code 留空）：/task/finish 的 exit 缺省会推导 COMPLETED+exit_code=0，
 * 对结局未知的作业是臆造，不如不报（偏差已在批次23 S2 汇报说明）。
 */
function reportNaturalFinish(job) {
  if (!job || job.alive || !job.id) return;
  if (typeof job.rc !== "number") return;
  if (naturalFinishReported.has(job.id)) return;
  naturalFinishReported.add(job.id);
  const fields = { exit: job.rc };
  if (typeof job.doneAt === "number" && job.doneAt > 0) fields.finishedAt = job.doneAt * 1000; // date +%s 秒 → ms
  // fire-and-forget：上报不阻塞 list/output 返回；taskFinishBestEffort 内部已吞所有异常
  taskFinishBestEffort(job.id, fields);
}

// ===================== chroot 后台作业（批次6） =====================
// 目标：解除 300s 前台超时对长任务（构建/下载/数据处理）的限制。
// 实现：作业脚本/注册表/输出全部落设备文件（/data/local/dsh-chroot/.jobs/），
// setsid + 后台化脱离引擎进程树（等效 nohup，SIGHUP 不可达），立即返回 job_id。
// kill 复用 #52 的 root 进程组击杀（kill -9 -<pgid>）+ 收敛确认。
// 红线：后台作业强制 no_mount —— 热路径不做挂载（幂等挂载留给前台调用/初始化）。

/** root 通道把内容（base64 中转，免引号转义问题）写到设备文件。 */
async function writeDeviceFile(path, content) {
  const b64 = Buffer.from(String(content == null ? "" : content), "utf8").toString("base64");
  return suCmd("echo " + b64 + " | base64 -d > " + path, 20000);
}

/** 路径安全白名单（批次23 S3 ckpt 注入用）：仅路径安全字符且禁止 ..（防穿越），
 *  无引号/空格/分号/反引号注入面。 */
const SAFE_JOB_PATH = /^(?!.*\.\.)[a-zA-Z0-9._/-]+$/;
/** android_chroot_job output 的分段标记（批次23 S3）：out/err 两段 tail 输出用它切开。 */
const JOB_OUT_MARK = "___DSH_JOB_OUT___";
const JOB_ERR_MARK = "___DSH_JOB_ERR___";

/**
 * 启动一个 chroot 后台作业，返回 android_chroot_exec 兼容的结果对象。
 * 批次23 S2（D3 终态捕获 / D8 S2「startChrootJob 包装 rc/done 捕获」）：作业包装为
 * `sh 脚本 > out 2> err; echo $? > rc; date +%s > done`——setsid 的是包装 sh（仍是进程组
 * leader，$! 语义与判活口径不变），其同步跑完脚本后把退出码/结束时刻落到 rc/done 文件；
 * list/output 轮询发现进程消失后读 rc/done 上报终态（D3：rc 文件第一判据，kill -0 降为
 * 辅助，pgid 复用误判随之实质缓解）。
 * 批次23 S3（D7 stdout/stderr 拆分）：重定向拆为 `> out 2> err`，err 路径进 meta（命名
 * <job>.err，与 out 同目录同风格）；旧作业（合并单文件时代）meta 无 err 路径，output/list
 * 按缺省回退为空串/缺省字段，绝不报错。
 * 批次23 S3（D7 ckpt 自愿续跑协议）：注入 $DSH_TASK_CKPT=/.jobs/<id>.ckpt（chroot 内可见
 * 路径；chroot 之后宿主绝对路径不可见，同一文件宿主侧即 CHROOT_JOBS_DIR/<id>.ckpt）与
 * （仅 resume 时）$DSH_TASK_PREV_CKPT=<上一轮 ckpt 路径>——脚本自愿读写实现断点续传，
 * 内核不解析 ckpt 内容、不强制。注入点在包装脚本的 env -i 参数里：env -i 会清空继承环境，
 * setsid 包装层里 export 的变量到不了 chroot 内的用户命令（这是唯一可用通道）。
 * taskExtras：追加进 App 侧 Task DB upsert 的字段（android_task_resume 传 resumed_from，D3
 * resume=重跑）。prevCkptInChroot：resume 传入的上一轮 ckpt 路径（chroot 内形式，调用方已校验）。
 */
async function startChrootJob(command, shellName, notes, taskExtras, prevCkptInChroot) {
  const id = "job-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const outPath = CHROOT_JOBS_DIR + "/" + id + ".out";
  const errPath = CHROOT_JOBS_DIR + "/" + id + ".err";   // 批次23 S3（D7）：stderr 独立落盘
  const ckptPath = CHROOT_JOBS_DIR + "/" + id + ".ckpt"; // 批次23 S3（D7）：checkpoint 宿主路径指针（自愿协议）
  const ckptInChroot = "/" + ckptPath.slice(CHROOT_DIR.length + 1); // /.jobs/<id>.ckpt（chroot 内可见形式）
  const scriptPath = CHROOT_JOBS_DIR + "/" + id + ".sh";
  const metaPath = CHROOT_JOBS_DIR + "/" + id + ".json";
  const rcPath = CHROOT_JOBS_DIR + "/" + id + ".rc";     // 批次23 S2：包装 sh 写入的退出码
  const donePath = CHROOT_JOBS_DIR + "/" + id + ".done"; // 批次23 S2：包装 sh 写入的结束时刻（date +%s 秒）
  const fail = (msg) => ({ ok: false, exit_code: -1, stdout: "", stderr: msg, shell_used: shellName, rootfs_ready: false, background: true, notes });
  const mk = await suCmd("mkdir -p " + CHROOT_JOBS_DIR, 15000);
  if (!mk.ok) return fail("创建作业目录失败: " + (mk.error || mk.stderr || "未知"));
  // 批次23 S3（D7 ckpt 协议）：DSH_TASK_CKPT 必注入；PREV_CKPT 仅 resume 且旧任务登记过
  // ckpt 时注入。值只含 [a-zA-Z0-9._/-]，白名单校验兜底后才拼进 root 包装脚本（fail-safe）。
  const envPairs = [];
  if (SAFE_JOB_PATH.test(ckptInChroot)) envPairs.push("DSH_TASK_CKPT=" + ckptInChroot);
  if (prevCkptInChroot && SAFE_JOB_PATH.test(prevCkptInChroot)) envPairs.push("DSH_TASK_PREV_CKPT=" + prevCkptInChroot);
  // 作业脚本 = 与前台同一套包装（chroot env -i 等），强制 no_mount + 不挂 /sdcard
  const wf = await writeDeviceFile(scriptPath, buildChrootScript(command, shellName, true, false, envPairs));
  if (!wf.ok) return fail("写入作业脚本失败: " + (wf.error || wf.stderr || "未知"));
  // 批次23 S2：setsid 脱离会话 + 后台化；$! = setsid 的 pid = 包装 sh 的 pid = 作业进程组 leader
  //（id/路径只含 [a-z0-9./-]，无引号注入面；shq 保护 sh -c 的整体参数位）。
  // 批次23 S3：> out 2> err 拆分（D7），其余与 S2 包装逐字一致。
  const wrap = "sh " + scriptPath + " > " + outPath + " 2> " + errPath + "; echo $? > " + rcPath + "; date +%s > " + donePath;
  const start = await suCmd("setsid sh -c " + shq(wrap) + " & echo $!", 15000);
  const pgid = parseInt(String(start.stdout || "").trim().split("\n").pop() || "", 10);
  if (!start.ok || !Number.isFinite(pgid) || pgid <= 0) {
    return fail("后台作业启动失败: " + (start.error || start.stderr || ("stdout=" + start.stdout)));
  }
  const commandB64 = Buffer.from(String(command), "utf8").toString("base64");
  const meta = JSON.stringify({
    id,
    command_b64: commandB64,
    pgid,
    out: outPath,
    err: errPath,   // 批次23 S3：stderr 独立落盘路径（旧作业无此字段，output/list 按缺失回退）
    ckpt: ckptPath, // 批次23 S3：checkpoint 宿主路径指针（脚本经 $DSH_TASK_CKPT 拿到 chroot 内形式）
    script: scriptPath,
    rc: rcPath,     // 批次23 S2：终态捕获文件路径（旧作业无此字段，list/output 按缺失跳过）
    done: donePath,
    startedAt: new Date().toISOString()
  });
  const wm = await writeDeviceFile(metaPath, meta);
  if (!wm.ok) {
    // 注册表写失败：作业已在跑但不能失控——直接组杀回滚
    await suCmd("kill -9 -" + pgid + " 2>/dev/null; rm -f " + scriptPath + " " + outPath + " " + errPath + "; true", 10000);
    return fail("写入作业注册表失败，已回滚（作业未保留）");
  }
  // 批次23 S2（指令 ①）：作业启动成功 → upsert 进 App 侧 Task DB（TaskStore，D1 两层以
  // job_id 关联）。best-effort：桥不可达/超时（1.5s）只 console 警告，绝不影响作业主流程
  //（作业已起；start 与 register 之间桥断的孤儿由后续 list 对账兜底，本片不实现收养补登）。
  // 批次23 S3：补登 out/err/ckpt 指针（TaskStore S1 即有 out/err 字段；android_task_list
  // 展示与 resume 的 PREV_CKPT 推导都依赖这里）。
  taskUpsertBestEffort(Object.assign({
    id,
    kind: "chroot-job",
    state: "RUNNING",
    job_id: id,
    pgid,
    command_b64: commandB64,
    out: outPath,
    err: errPath,
    ckpt: ckptPath,
    session_dir: CHROOT_JOBS_DIR
  }, taskExtras || {}));
  notes.push("后台作业已启动：job_id=" + id + " pgid=" + pgid);
  notes.push("输出文件: stdout → " + outPath + "，stderr → " + errPath + "（android_chroot_job action=output 查看）");
  notes.push("checkpoint 协议（自愿）: 脚本可写 $DSH_TASK_CKPT（=" + ckptInChroot + "）记录进度，内核不解析内容；resume 重跑时上一轮 ckpt 路径经 $DSH_TASK_PREV_CKPT 传入，是否续由脚本自行决定");
  if (prevCkptInChroot) notes.push("上一轮 ckpt 已注入 $DSH_TASK_PREV_CKPT=" + prevCkptInChroot);
  notes.push("后台作业 nohup 式脱离引擎进程树，App 前台超时（300s）不适用；结束时请用 android_chroot_job action=kill 清理");
  return {
    ok: true, exit_code: 0,
    stdout: "后台作业 " + id + " 已启动（pgid=" + pgid + "）",
    stderr: "",
    shell_used: shellName, rootfs_ready: true,
    job_id: id, background: true, notes
  };
}

/**
 * 列出全部后台作业：一条 root 脚本输出注册表内容 + 存活判定（kill -0 组）+ 终态捕获文件
 * （批次23 S2：新作业的 .rc/.done 存在才输出 JOB_RC/JOB_DONE 标记行，旧作业无文件跳过）。
 */
async function listChrootJobs() {
  const cmd = "for f in " + CHROOT_JOBS_DIR + "/*.json; do [ -f \"$f\" ] || continue; " +
    "echo ===JOB===; cat \"$f\"; echo; " +
    "b=${f%.json}; " +
    "[ -f \"$b.rc\" ] && echo \"JOB_RC=$(cat \"$b.rc\" 2>/dev/null)\"; " +
    "[ -f \"$b.done\" ] && echo \"JOB_DONE=$(cat \"$b.done\" 2>/dev/null)\"; " +
    "p=$(grep -o '\"pgid\":[0-9]*' \"$f\" | head -1 | cut -d: -f2); " +
    "if [ -n \"$p\" ] && kill -0 -\"$p\" 2>/dev/null; then echo JOB_ALIVE; else echo JOB_DEAD; fi; done";
  const r = await suCmd(cmd, 20000);
  if (!r.ok) return { ok: false, error: r.error || r.stderr || "su 执行失败", jobs: [] };
  const jobs = [];
  for (const seg of String(r.stdout || "").split("===JOB===")) {
    const t = seg.trim();
    if (!t) continue;
    const alive = t.includes("JOB_ALIVE");
    const rcM = t.match(/JOB_RC=(-?\d+)/);
    const doneM = t.match(/JOB_DONE=(\d+)/);
    // 批次23 S2：尾部多了 rc/done 标记行后，旧的「剥尾部 JOB_ALIVE 行」正则不再够用，
    // 改为按首个 { 到末个 } 截取 JSON（meta 是平面对象，末个 } 必是其收尾括号），更健壮。
    const j0 = t.indexOf("{");
    const j1 = t.lastIndexOf("}");
    if (j0 < 0 || j1 <= j0) continue; // 跳过损坏的注册表条目
    try {
      const meta = JSON.parse(t.slice(j0, j1 + 1));
      const job = {
        id: meta.id || "",
        pgid: typeof meta.pgid === "number" ? meta.pgid : 0,
        out: meta.out || "",
        startedAt: meta.startedAt || "",
        command: meta.command_b64 ? Buffer.from(meta.command_b64, "base64").toString("utf8").slice(0, 200) : "",
        alive
      };
      if (meta.err) job.err = String(meta.err); // 批次23 S3：stderr 指针（旧作业无此字段，缺省）
      if (rcM) job.rc = parseInt(rcM[1], 10);
      if (doneM) job.doneAt = parseInt(doneM[1], 10);
      jobs.push(job);
      // 批次23 S2（指令 ①）：list 判活发现自然退出且 rc 已知 → 终态上报（best-effort，
      // fire-and-forget）。被 kill 的作业整组被杀、rc 无人写 → 不上报（exit 缺省会被
      // /task/finish 推导成 exit_code=0 的臆造），由 kill 路径报 CANCELLED 或 Reaper 对账兜底。
      reportNaturalFinish(job);
    } catch (_) { /* 跳过损坏的注册表条目 */ }
  }
  return { ok: true, jobs };
}

/**
 * 构造 chroot 包装脚本：先在 chroot 之外挂载，再 chroot 进入执行用户命令。
 * 实测三个坑（batch5 踩过，必须照此实现）：
 *  1) chroot 会继承 Android 的 PATH（/system/bin:/apex/...），Alpine 的 sh 不重置它
 *     → 必须用 chroot 内的 busybox `env -i` 显式注入 PATH，否则 cat/ls/apk 全部 not found；
 *  2) chroot 内没有 DNS 配置 → apk/curl 无法解析域名，需自备 $CR/etc/resolv.conf；
 *  3) `mount --bind` 的源路径按 chroot 内解析 → bind 必须在 chroot 之外执行。
 * 另：root 域 PATH 实测含 /data/adb/ksu/bin，故系统二进制一律走绝对路径
 * （/system/bin/mount、/system/bin/chroot 在本机是 toybox 符号链接），不依赖 PATH。
 *
 * ★ 幂等挂载（batch5 真机事故驱动）：挂载点已在 /proc/mounts 中时直接跳过。
 *   实测 Pixel 6 Pro / KernelSU 上反复 `mount --bind /sdcard` 会卡死在
 *   do_loopback → attach_recursive_mnt（整棵 /sdcard 挂载树递归挂接），
 *   表现为 rcu_preempt stall + `watchdog: BUG: soft lockup - CPU stuck`，
 *   最终 `Kernel panic - not syncing: softlockup: hung tasks` 导致整机重启。
 *   挂载一旦完成就常驻，因此后续调用必须跳过，避免重复递归挂接。
 *
 * ★ /dev 用 bind 而非 tmpfs（任务#51）：tmpfs 挂出来的 /dev 是空的，
 *   chroot 内没有 /dev/zero、/dev/urandom、/dev/null，很多程序会起不来。
 *   `mount --bind /dev` 直接复用宿主设备节点（真机 100 轮压测验证幂等安全）。
 *   注意 /proc/mounts 里 bind /dev 显示为 tmpfs 类型（/dev 本身是 tmpfs），
 *   靠选项 mode=755,nosuid 区分，幂等检查按挂载点路径 grep，不受影响。
 *
 * ★ /sdcard 改为显式 opt-in（任务#51）：默认不挂（mount_sdcard=false），
 *   减少不必要的 fuse bind 挂接面；调用方传 mount_sdcard=true 才执行 bind。
 */
function buildChrootScript(command, shellName, noMount, mountSdcard, extraEnvPairs) {
  const CR = CHROOT_DIR;
  // 批次23 S3（D7 ckpt 协议）：extraEnvPairs（KEY=VALUE 串数组）追加进 env -i 参数——
  // env -i 会清空继承环境，这是变量进入 chroot 内用户命令的唯一通道。逐条白名单校验
  // （KEY 名 + 值仅路径安全字符）后才拼接，异常条目丢弃（fail-safe：未校验字符串绝不进 root 包装脚本）。
  const envTail = (Array.isArray(extraEnvPairs) ? extraEnvPairs : [])
    .filter((p) => /^[A-Za-z_][A-Za-z0-9_]*=[a-zA-Z0-9._/-]*$/.test(String(p)))
    .join(" ");
  const L = [];
  L.push("CR=" + shq(CR));
  L.push("if [ ! -e $CR/bin/busybox ]; then echo " + shq(CHROOT_NOROOTFS) + "; exit 127; fi");
  L.push("SH=/bin/sh");
  if (shellName === "bash") {
    L.push("if [ -x $CR/bin/bash ]; then SH=/bin/bash; else echo " +
      shq(CHROOT_NOTE_PREFIX + "chroot 内 /bin/bash 不可用，已自动回退 /bin/sh") + "; fi");
  }
  L.push("echo " + shq(CHROOT_SHELL_PREFIX) + "\"$SH\"");
  if (noMount) {
    L.push("echo " + shq(CHROOT_NOTE_PREFIX + "no_mount=true，已跳过 proc/sysfs/dev 与 /sdcard 挂载"));
  } else {
    L.push("M=/system/bin/mount");
    // 幂等挂载：已在 /proc/mounts → 跳过（绝不重复挂接，见上方事故说明）
    const step = (margs, target, label) => L.push(
      "if grep -q \" " + target + " \" /proc/mounts 2>/dev/null; then echo " +
      shq(CHROOT_NOTE_PREFIX + label + " 已在 /proc/mounts 中，跳过重复挂载") + "; else " +
      "o=$($M " + margs + " " + target + " 2>&1) || echo " +
      shq(CHROOT_NOTE_PREFIX + label + " 挂载失败：") + "\"$o\"; fi");
    step("-t proc proc", "$CR/proc", "proc");
    step("-t sysfs sysfs", "$CR/sys", "sysfs");
    step("--bind /dev", "$CR/dev", "bind /dev");
    if (mountSdcard === true) {
      L.push("if [ -e /sdcard ]; then");
      L.push("  mkdir -p $CR/mnt/sdcard 2>/dev/null");
      step("--bind /sdcard", "$CR/mnt/sdcard", "bind /sdcard → " + CR + "/mnt/sdcard");
      L.push("else");
      L.push("  echo " + shq(CHROOT_NOTE_PREFIX + "/sdcard 不存在，已跳过 bind 挂载"));
      L.push("fi");
    } else {
      L.push("echo " + shq(CHROOT_NOTE_PREFIX + "未挂载 /sdcard（默认不挂；需要在 chroot 内读写手机存储时传 mount_sdcard=true）"));
    }
  }
  L.push("if [ ! -s $CR/etc/resolv.conf ]; then " +
    "printf 'nameserver 223.5.5.5\\nnameserver 8.8.8.8\\n' > $CR/etc/resolv.conf 2>/dev/null " +
    "&& echo " + shq(CHROOT_NOTE_PREFIX + "已写入 " + CR + "/etc/resolv.conf（223.5.5.5 / 8.8.8.8）") +
    " || echo " + shq(CHROOT_NOTE_PREFIX + "写入 " + CR + "/etc/resolv.conf 失败（chroot 内 DNS 可能不可用）") + "; fi");
  L.push("exec /system/bin/chroot $CR /bin/busybox env -i " +
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root TERM=xterm" +
    (envTail ? " " + envTail : "") + " " +
    "\"$SH\" -lc " + shq(command));
  return L.join("\n") + "\n";
}


/** 批次 8a（采纳上游 woaiys3 v1.11.0）：会话式 APK 安装。
 *  单发 `pm install` 在部分 ROM 上失败仍 exit=0（静默假成功），且无进度语义。
 *  流程：拷贝到 /data/local/tmp → install-create(-r) → install-write(-S size, stdin)
 *  → install-commit → 严格校验输出含 "Success"；传了 package 参数再用 `pm path` 二次校验。
 *  任一阶段失败：abandon 会话并如实返回失败（绝不把 exit=0 当成功）。
 *  返回 { ok, exit_code, stdout, stderr }。 */
async function sessionInstall(apkPath, pkg, timeoutMs) {
  const remote = "/data/local/tmp/dsh-install-" + Date.now() + ".apk";
  const scriptPath = "/data/local/tmp/dsh-install-" + Date.now() + ".sh";
  const script = [
    "#!/system/bin/sh",
    "SRC=" + shq(apkPath),
    "DST=" + shq(remote),
    'cp "$SRC" "$DST" || { echo "INSTALL_FAIL copy: cp $SRC $DST failed"; exit 1; }',
    'SIZE=$(stat -c %s "$DST")',
    'CREATE_OUT=$(pm install-create -r 2>&1)',
    'SES=$(printf "%s" "$CREATE_OUT" | sed -n "s/.*\\[\\([0-9][0-9]*\\)\\].*/\\1/p" | head -1)',
    '[ -n "$SES" ] || { echo "INSTALL_FAIL create: $CREATE_OUT"; exit 1; }',
    'if ! cat "$DST" | pm install-write -S "$SIZE" "$SES" base >/dev/null 2>&1; then echo "INSTALL_FAIL write session=$SES"; pm install-abandon "$SES" >/dev/null 2>&1; exit 1; fi',
    'COMMIT_OUT=$(pm install-commit "$SES" 2>&1)',
    'if printf "%s" "$COMMIT_OUT" | grep -q Success; then echo "INSTALL_SUCCESS $COMMIT_OUT"; else echo "INSTALL_FAIL commit: $COMMIT_OUT"; exit 1; fi',
    'rm -f "$DST"'
  ].join("\n") + "\n";
  const wf = await writeDeviceFile(scriptPath, script);
  if (!wf.ok) {
    return { ok: false, exit_code: -1, stdout: "", stderr: "写入安装脚本失败: " + (wf.error || wf.stderr || "未知") };
  }
  const r = await privCmd("sh " + scriptPath + "; RC=$?; rm -f " + scriptPath + "; exit $RC", timeoutMs);
  const out = String(r.stdout || "");
  if (r.ok && out.includes("INSTALL_SUCCESS")) {
    // 可选二次校验：调用方传了 package 名时确认 pm path 命中
    if (pkg) {
      const p = await privCmd("pm path " + pkg, 15000);
      const pathOut = String(p.stdout || "").trim();
      if (!p.ok || !pathOut.includes("package:")) {
        return {
          ok: false, exit_code: 0, stdout: out,
          stderr: "pm install 输出 Success 但 pm path " + pkg + " 未命中（二次校验失败）： " + (pathOut || p.stderr || "空")
        };
      }
      return { ...r, stdout: out + "\n" + pathOut };
    }
    return r;
  }
  if (!r.ok && !out.includes("INSTALL_FAIL")) {
    return { ...r, stderr: "会话式安装异常: " + (r.stderr || r.error || "未知") };
  }
  return r;
}

// ===================== 设备与环境感知（批次 9b / #28） =====================
// 设计约束：单次 su 调用聚合全部数据源（echo 分隔符切节，避免多次 su 往返），
// 端到端目标 <500ms。只读、无副作用、不做持续监听。

/** android_device_info 的聚合脚本：一次 su 执行采集电池/音量/亮度/存储/网络/前台/uptime/机型。
 *  网络隐私取舍：cmd wifi status 能拿到 SSID，但刻意不采集（避免隐私过度），只取
 *  连接态/链路速度/RSSI；蜂窝侧只取 mDataConnectionState 数值。 */
function buildDeviceInfoScript() {
  return [
    "echo ===DSH_BATTERY===",
    "dumpsys battery 2>/dev/null | grep -E 'level:|temperature:|AC powered:|USB powered:|Wireless powered:'",
    "echo ===DSH_AUDIO===",
    "dumpsys audio 2>/dev/null | grep -E '^- STREAM_(MUSIC|RING|ALARM):|streamVolume:'",
    "echo ===DSH_BRIGHTNESS===",
    "settings get system screen_brightness",
    "settings get system screen_off_timeout",
    "echo ===DSH_STORAGE===",
    "df /sdcard 2>/dev/null | tail -1",
    "echo ===DSH_WIFI===",
    "cmd wifi status 2>/dev/null | head -6 | cut -c1-500",
    "echo ===DSH_CELL===",
    "dumpsys telephony.registry 2>/dev/null | grep -m1 mDataConnectionState",
    "echo ===DSH_FOCUS===",
    "dumpsys window 2>/dev/null | grep -m1 mCurrentFocus",
    "echo ===DSH_UPTIME===",
    "cat /proc/uptime",
    "echo ===DSH_DEVICE===",
    "getprop ro.product.model",
    "getprop ro.build.version.release",
    "getprop ro.build.version.sdk",
    "echo ===DSH_END==="
  ].join("\n");
}

/** 解析聚合脚本输出：按 ===DSH_X=== 切节，各节独立解析，拿到哪个给哪个。 */
function parseDeviceInfoOutput(raw) {
  const sections = {};
  let cur = null;
  for (const line of String(raw == null ? "" : raw).split("\n")) {
    const m = line.match(/^===DSH_([A-Z]+)===\s*$/);
    if (m) { cur = m[1]; if (!sections[cur]) sections[cur] = []; continue; }
    if (cur) sections[cur].push(line);
  }
  const out = {};
  // ---- 电池：level / temperature(0.1℃) / charging=任一 powered:true ----
  if (sections.BATTERY) {
    const b = sections.BATTERY.join("\n");
    const lv = b.match(/level:\s*(\d+)/);
    const tp = b.match(/temperature:\s*(\d+)/);
    if (lv || tp || /powered:/.test(b)) {
      out.battery = {
        ...(lv ? { level: parseInt(lv[1], 10) } : {}),
        charging: /AC powered: true|USB powered: true|Wireless powered: true/.test(b),
        ...(tp ? { temperature: Math.round(parseInt(tp[1], 10)) / 10 } : {})
      };
    }
  }
  // ---- 音量：跟踪 - STREAM_X: 节，取节内首个 streamVolume:N ----
  if (sections.AUDIO) {
    const vol = {};
    let stream = null;
    let got = false;
    for (const line of sections.AUDIO) {
      const h = line.match(/^- STREAM_(MUSIC|RING|ALARM):/);
      if (h) { stream = h[1].toLowerCase(); got = false; continue; }
      const v = line.match(/streamVolume:\s*(\d+)/);
      if (stream && v && !got) { vol[stream] = parseInt(v[1], 10); got = true; }
    }
    if (Object.keys(vol).length) out.volume = vol;
  }
  // ---- 亮度：settings get 两行（screen_brightness / screen_off_timeout）----
  if (sections.BRIGHTNESS) {
    const nums = sections.BRIGHTNESS.map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
    if (nums.length >= 1) {
      out.brightness = {
        value: parseInt(nums[0], 10),
        ...(nums.length >= 2 ? { timeoutMs: parseInt(nums[1], 10) } : {})
      };
    }
  }
  // ---- 存储：df 1K-blocks → 字节（Filesystem total used avail use% mount）----
  if (sections.STORAGE) {
    const m = sections.STORAGE.join(" ").match(/\s(\d+)\s+\d+\s+(\d+)\s+\d+%\s+\S+/);
    if (m) out.storage = { sdcardTotal: parseInt(m[1], 10) * 1024, sdcardFree: parseInt(m[2], 10) * 1024 };
  }
  // ---- 网络：wifi 连接态优先（不含 SSID），否则看蜂窝 mDataConnectionState==2 ----
  {
    const wifiTxt = (sections.WIFI || []).join("\n");
    const cellLine = (sections.CELL || []).join("\n");
    const link = wifiTxt.match(/Link speed:\s*(\d+Mbps)/);
    const rssi = wifiTxt.match(/RSSI:\s*(-?\d+)/);
    if (/Wifi is connected/.test(wifiTxt)) {
      out.network = {
        type: "wifi",
        detail: "已连接" +
          (link ? "，链路速度 " + link[1] : "") +
          (rssi ? "，RSSI " + rssi[1] + "dBm" : "") +
          "（SSID 未采集）"
      };
    } else if (/mDataConnectionState=2\b/.test(cellLine)) {
      out.network = { type: "cellular", detail: "wifi 未连接，移动数据已连接" };
    } else if (/Wifi is disabled/.test(wifiTxt)) {
      out.network = { type: "none", detail: "wifi 已关闭" + (/mDataConnectionState=2\b/.test(cellLine) ? "" : "，无移动数据") };
      if (/mDataConnectionState=2\b/.test(cellLine)) out.network = { type: "cellular", detail: "wifi 已关闭，移动数据已连接" };
    } else {
      out.network = { type: "none", detail: /Wifi is enabled/.test(wifiTxt) ? "wifi 已启用但未连接" : "wifi 未连接" };
    }
  }
  // ---- 前台：mCurrentFocus=Window{hash u0 pkg/cls}；cls 以 . 开头时补包名 ----
  if (sections.FOCUS) {
    const m = sections.FOCUS.join("\n").match(/mCurrentFocus=Window\{\S+\s+(\S+)\s+([^}]+)\}/);
    if (m && m[2].includes("/")) {
      const pkg = m[2].split("/")[0].trim();
      let act = m[2].split("/")[1].replace(/\}.*$/, "").trim();
      if (act.startsWith(".")) act = pkg + act;
      out.foreground = { package: pkg, activity: act };
    }
  }
  // ---- uptime：/proc/uptime 首个字段（秒）→ ms ----
  if (sections.UPTIME) {
    const m = sections.UPTIME.join(" ").match(/([\d.]+)/);
    if (m) out.uptimeMs = Math.round(parseFloat(m[1]) * 1000);
  }
  // ---- 机型：model / release / sdk 三行 ----
  if (sections.DEVICE) {
    const vals = sections.DEVICE.map((l) => l.trim()).filter((l) => l && l !== "null");
    if (vals.length >= 3) {
      out.device = { model: vals[0], androidVersion: vals[1], apiLevel: parseInt(vals[2], 10) };
    }
  }
  return out;
}

/** android_location 的采集脚本：一次 dumpsys location 拿「服务开关 + 各 provider last-known」。 */
function buildLocationScript() {
  return [
    "echo ===DSH_LOC===",
    "dumpsys location 2>/dev/null | grep -E 'Location Setting:|last location='",
    "echo ===DSH_END==="
  ].join("\n");
}

/** 解析 last-known 位置：fused 优先，其余 provider 次之；无 fix 返回 null 由调用方给 reason。 */
function parseLocationOutput(raw) {
  const lines = [];
  let inLoc = false;
  for (const line of String(raw == null ? "" : raw).split("\n")) {
    if (line.startsWith("===DSH_")) { inLoc = line.includes("DSH_LOC"); continue; }
    if (inLoc) lines.push(line);
  }
  const locOn = /Location Setting:\s*true/.test(lines.join("\n"));
  const fixes = [];
  for (const line of lines) {
    const m = line.match(/last location=Location\[\s*([a-zA-Z_]+)\s+(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (!m) continue;
    const acc = line.match(/\b(?:hAcc|acc)=(\d+(?:\.\d+)?)/);
    fixes.push({
      source: m[1],
      latitude: parseFloat(m[2]),
      longitude: parseFloat(m[3]),
      ...(acc ? { accuracy: parseFloat(acc[1]) } : {})
    });
  }
  const fix = fixes.find((f) => f.source === "fused") || fixes[0] || null;
  return { locOn, fix };
}

// ===================== 虚拟屏 vscreen（批次 11） =====================
// 插件只认 3081 /vscreen/*（MainActivity 本地桥，X-DSH-Token 鉴权，与 /clipboard 同模式）。
// App 层（VscreensManager）是唯一后端：root/shizuku 通道与 overlay 回退的差异不外泄到插件；
// 服务端单会话——create 后隐式绑定 displayId，其余操作不传 displayId。
// 插件侧两层防护：
//   1) 本地会话守卫：未 create（或会话已终结）时，see/tap/swipe/key 静默自愈建屏（批次81，
//      ensureVscreenCreated）；close 等其余工具仍本地直接返回 NOT_CREATED
//      （契约原文 hint="先 android_vscreen_create"），不打桥；
//   2) android_vscreen_key 白名单/数字校验（对齐 android_input keyevent 的数值化风格，防注入）。
// 失败语义（批次 11 契约 §2/§3）：App 失败统一 HTTP 200 + JSON {ok:false,reason,hint}；
// 以 body.ok/reason 为准，不按 HTTP 状态码映射失败——body 有 reason 原样透传（含 403
// BAD_TOKEN），无 body/无 reason/网络层错误（连接拒绝/超时/响应不是 JSON）→ BRIDGE_UNREACHABLE。
// create 后端最坏 ~70s（S1→S2→S3 三级阶梯 + overlay 轮询）：create 桥超时 120s。

/** vscreen 会话本地守卫态（进程内）：create 成功置位；close 调用后无论成败清位；
 *  桥明确回报 NOT_CREATED/SESSION_DEAD 时同步清位，避免僵尸守卫态。
 *  进程级跨插件同步状态挂载于 globalThis.__DSH_VSCREEN_STATE__。 */
let vscreenCreated = false;
let vscreenDisplayId = null;
const vscreenShared = (globalThis.__DSH_VSCREEN_STATE__ = globalThis.__DSH_VSCREEN_STATE__ || {
  created: false,
  displayId: null
});

function isVscreenCreated() {
  return vscreenCreated && vscreenShared.created;
}

function setVscreenCreated(val, displayId = null) {
  vscreenCreated = Boolean(val);
  vscreenShared.created = Boolean(val);
  vscreenDisplayId = val ? displayId : null;
  vscreenShared.displayId = val ? displayId : null;
}

/** 虚拟屏后台模式开关（优先级：实时偏好文件 > 插件配置 > 启动时环境变量）。
 *
 *  批次29 修复：环境变量 DSH_VSCREEN_MODE 由 App 在拉起引擎时注入一次，是启动时快照；
 *  用户在设置弹窗切换开关只写偏好文件。若环境变量优先，则开关改动永远被旧快照覆盖
 *  （开关形同虚设）。故偏好文件（用户实时操作的落点）必须优先于环境变量。
 *
 *  缓存：为避免每次自动化动作都读盘，偏好文件按 mtime 做 1s 内短路缓存。
 */
let vscreenPrefsCache = { mtime: 0, value: null, checkedAt: 0 };

function readVscreenPrefFromPrefs() {
  try {
    const prefsPaths = [
      "/data/user/0/com.deepseek.harness/shared_prefs/vscreen_prefs.xml",
      "/data/data/com.deepseek.harness/shared_prefs/vscreen_prefs.xml",
      "/data/user/0/com.deepseek.harness/shared_prefs/dsh_prefs.xml",
      "/data/data/com.deepseek.harness/shared_prefs/dsh_prefs.xml"
    ];
    for (const p of prefsPaths) {
      if (!existsSync(p)) continue;
      const st = statSync(p);
      const now = Date.now();
      if (vscreenPrefsCache.value !== null && st.mtimeMs === vscreenPrefsCache.mtime &&
          now - vscreenPrefsCache.checkedAt < 1000) {
        return vscreenPrefsCache.value;
      }
      const xml = readFileSync(p, "utf8");
      const boolMatch = xml.match(/<boolean\s+name=["']vscreen_mode["']\s+value=["'](true|false)["']/i);
      if (boolMatch) {
        const value = boolMatch[1].toLowerCase() === "true";
        vscreenPrefsCache = { mtime: st.mtimeMs, value, checkedAt: now };
        return value;
      }
      const strMatch = xml.match(/<string\s+name=["']vscreen_mode["']>(.*?)<\/string>/i);
      if (strMatch) {
        const s = strMatch[1].trim().toLowerCase();
        const value = s === "1" || s === "true";
        vscreenPrefsCache = { mtime: st.mtimeMs, value, checkedAt: now };
        return value;
      }
    }
  } catch (_) {}
  return null;
}

function isVscreenModeEnabled(ctx) {
  // ① 实时偏好（用户开关的落点），最高优先级
  const fromPrefs = readVscreenPrefFromPrefs();
  if (fromPrefs !== null) return fromPrefs;
  // ② 插件配置
  // Cordis 未声明 inject:["config"] 时，读取 ctx.config 会直接抛错；
  // 此配置只是可选覆盖项，必须安全降级而不能中断整个工具调用链。
  try {
    if (ctx?.config?.vscreenMode !== undefined) {
      return Boolean(ctx.config.vscreenMode);
    }
    if (ctx?.config?.vscreen_mode !== undefined) {
      return Boolean(ctx.config.vscreen_mode);
    }
  } catch (_) {}
  // ③ 启动时环境变量快照（兜底，偏好文件不可读时使用）
  const envVal = process.env.DSH_VSCREEN_MODE;
  if (envVal !== undefined && envVal !== "") {
    const trimmed = String(envVal).trim().toLowerCase();
    if (trimmed === "1" || trimmed === "true") return true;
    if (trimmed === "0" || trimmed === "false") return false;
  }
  // ④ 全部缺失：与 App 设置开关默认值对齐（默认开启，保障主屏不被自动化打扰）
  return true;
}

/** 虚拟屏自愈生命周期：如果此时虚拟屏尚未创建，透明路由在执行自动化动作时自动先静默调用 vscreen.create()。 */
async function ensureVscreenCreated(ctx) {
  if (isVscreenCreated()) {
    return { ok: true, displayId: vscreenShared.displayId || vscreenDisplayId };
  }
  const res = await vscreenBridge("POST", "/vscreen/create", {}, VSCREEN_CREATE_TIMEOUT_MS);
  if (res.unreachable) {
    setVscreenCreated(false);
    return vscreenFail(res, "自愈创建虚拟屏失败：App 本地桥不可达");
  }
  const b = res.json;
  if (!b || b.ok !== true) {
    setVscreenCreated(false);
    return vscreenFail(res, "自愈创建虚拟屏失败");
  }
  const dId = Number.isFinite(b.displayId) ? b.displayId : null;
  setVscreenCreated(true, dId);
  return { ok: true, displayId: dId, strategy: b.strategy, channel: b.channel };
}

const VSCREEN_CREATE_TIMEOUT_MS = 120000; // 首次建屏最坏 ~70s（S1→S2→S3 + overlay 轮询），留足余量
const VSCREEN_SEE_TIMEOUT_MS = 20000;     // screencap -d 可能偏慢（对齐 android_see 的 20s）
const VSCREEN_SEE_MAX_BYTES = 30 * 1024 * 1024;

/** 只读降级说明（批次61）：建屏被拒时 android_screenshot 改用主屏 screencap；
 *  本工具 schema（resultSchema）无 hint 字段，故降级说明落在 stdout 上；写操作不静默降级。 */
const VSCREEN_READONLY_FALLBACK_NOTE = "[主屏降级] 虚拟屏不可用，已改用主屏截图";

/** android_vscreen_key 键名白名单（归一大写后比对；数字键值另行放行，App 层负责映射 keycode）。 */
const VSCREEN_KEY_NAMES = new Set([
  "HOME", "BACK", "ENTER", "DEL", "FORWARD_DEL", "MENU", "POWER",
  "VOLUME_UP", "VOLUME_DOWN", "VOLUME_MUTE", "MUTE",
  "RECENT", "APPS", "ALL_APPS", "SEARCH", "NOTIFICATION", "VOICE_ASSIST",
  "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT", "DPAD_CENTER",
  "TAB", "ESC", "SPACE", "SHIFT_LEFT", "SHIFT_RIGHT", "ALT_LEFT", "ALT_RIGHT",
  "CTRL_LEFT", "CTRL_RIGHT", "CAPS_LOCK", "MOVE_HOME", "MOVE_END",
  "PAGE_UP", "PAGE_DOWN", "WAKEUP", "SLEEP",
  "CAMERA", "CALL", "ENDCALL", "HEADSETHOOK",
  "MEDIA_PLAY_PAUSE", "MEDIA_STOP", "MEDIA_NEXT", "MEDIA_PREVIOUS",
  "MEDIA_FAST_FORWARD", "MEDIA_REWIND",
  "BRIGHTNESS_UP", "BRIGHTNESS_DOWN", "SYM", "FN", "ZOOM_IN", "ZOOM_OUT",
  "EXPLORER", "ENVELOPE", "FOCUS", "CLEAR", "PICTURES", "MUSIC", "CALCULATOR"
]);

/** 归一 key 输入：纯数字 → 0~65535 keycode 字符串；白名单键名 → 大写；其余返回 null（本地拒绝）。 */
function normalizeVscreenKey(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (/^\d{1,5}$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 0 && n <= 65535 ? String(n) : null;
  }
  const u = s.toUpperCase();
  return VSCREEN_KEY_NAMES.has(u) ? u : null;
}

/** vscreen 数值参数安全化：有限数 → 取整；否则 null（调用方本地回 INVALID_ARGUMENT，不打桥）。 */
function vscreenNum(v) {
  if (v == null || typeof v === "boolean") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

/** 未建屏守卫结果（契约原文，本地直接返回，不打桥）。 */
function vscreenNotCreated() {
  return { ok: false, reason: "NOT_CREATED", hint: "先 android_vscreen_create" };
}

function vscreenInvalid(msg) {
  return { ok: false, reason: "INVALID_ARGUMENT", error: msg };
}

/** 会话级失败（App 侧明确会话不存在）→ 同步清本地守卫态。BRIDGE_UNREACHABLE 等瞬态不清。 */
function vscreenSyncSession(reason) {
  if (reason === "NOT_CREATED" || reason === "SESSION_DEAD") {
    setVscreenCreated(false);
  }
}

/** 批次81-T2-3：桥返回「App 侧会话已不在」时，清本地陈旧守卫 → 自愈建屏 → 原动作重试一次。
 *  只处理 NOT_CREATED / SESSION_DEAD（其它 reason 原样返回，不掩盖真实错误）；
 *  res.unreachable（3081 不可达）不重试；每个调用最多重试一次。
 *  返回重试后的响应对象；不满足重试条件或自愈失败时返回 null（调用方保持原失败语义）。
 *
 *  背景：App 在任务收尾时会回收虚拟屏（OverlayService.maybeCleanupVscreen → VscreensManager.shutdown），
 *  插件进程内的本地守卫态不会被通知；下一个任务的首个 vscreen 调用命中「陈旧守卫态 = true」→
 *  ensureVscreenCreated 直接早退、打桥被 App 判 NOT_CREATED，用户侧表现为「一交新任务就说执行失败」。
 *  这里只重试一次并保持其它失败原因原样透出，避免把真实错误掩盖成重试。
 */
async function vscreenRetryAfterSessionLoss(ctx, res, again) {
  if (!res || res.unreachable) return null;
  const reason = res.json && typeof res.json === "object" ? res.json.reason : null;
  if (reason !== "NOT_CREATED" && reason !== "SESSION_DEAD") return null;
  // App 侧已明确说会话不在：本地守卫态必是陈旧的，先清位再自愈，否则 ensureVscreenCreated 会直接早退
  setVscreenCreated(false);
  const ensured = await ensureVscreenCreated(ctx);
  if (!ensured.ok) {
    // 批次82-N9：自愈被「更具体的原因」拒绝时，把那句原因透出去，而不是沿用最初的 NOT_CREATED。
    // 典型现场：只读任务硬闸门（READONLY_TASK）—— 初次 NOT_CREATED 的提示「先 android_vscreen_create」
    // 恰好就是刚被拒的动作，模型照做只会再被拒一次（用户侧表现为「一执行就失败」）。
    // 只透出比 NOT_CREATED / SESSION_DEAD 更具体的会话级原因；BRIDGE_UNREACHABLE 等瞬态仍返回 null
    // （沿用原失败结果，不用自愈文案替换既有错误契约）。
    const r = ensured.reason;
    if (typeof r === "string" && r && r !== "NOT_CREATED" && r !== "SESSION_DEAD" && r !== "BRIDGE_UNREACHABLE") {
      return { status: 200, json: { ok: false, reason: r, hint: ensured.hint, detail: ensured.error } };
    }
    return null;
  }
  return await again();
}

/** 3081 /vscreen/* 统一桥请求（共享 keep-alive bridgeAgent）。
 *  返回：{ status, json }=JSON 响应；{ status, binary }=image/png（仅 /see）；
 *  { unreachable, error }=网络层错误/超时（超时后 destroy 触发 error，Promise 只取先到者）。 */
function vscreenBridge(method, path, bodyObj, timeoutMs) {
  return new Promise((resolve) => {
    const isPost = method === "POST";
    const body = isPost ? JSON.stringify(bodyObj || {}) : null;
    const headers = authHeaders(isPost ? { "Content-Type": "application/json" } : undefined);
    if (body != null) headers["Content-Length"] = Buffer.byteLength(body);
    const req = httpRequest({
      host: "127.0.0.1", port: appPort(), path, method,
      headers, agent: bridgeAgent, timeout: timeoutMs || 8000
    }, (res) => {
      const ctype = String(res.headers["content-type"] || "");
      if (/image\/png/i.test(ctype)) {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => { chunks.push(c); size += c.length; if (size > VSCREEN_SEE_MAX_BYTES) req.destroy(); });
        res.on("end", () => resolve({ status: res.statusCode, binary: Buffer.concat(chunks), contentType: ctype }));
        return;
      }
      let d = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { d += c; if (d.length > 262144) req.destroy(); });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(d || "null"); } catch (_) { json = null; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.setTimeout(timeoutMs || 8000, () => { req.destroy(); resolve({ unreachable: true, error: "App 本地桥超时" }); });
    req.on("error", (e) => resolve({ unreachable: true, error: String((e && e.message) || e) }));
    if (body != null) req.write(body);
    req.end();
  });
}

/** 失败映射（契约 §2/§3）：body 有 reason → 原样透传 reason+hint（不看 HTTP 状态码，
 *  403 BAD_TOKEN 同理；body.detail → error）；无 body/无 reason/网络层错误 → BRIDGE_UNREACHABLE。 */
function vscreenFail(res, fallbackError) {
  const body = res && !res.unreachable && res.json && typeof res.json === "object" ? res.json : null;
  if (body && typeof body.reason === "string" && body.reason) {
    const out = { ok: false, reason: body.reason };
    if (typeof body.hint === "string" && body.hint) out.hint = body.hint;
    // 批次82-N2：SCREEN_OFF 兜底提示（App/服务端未给 hint 时也要给出可执行动作，与 APP_BRIDGE_HINT 同款）
    if (out.reason === "SCREEN_OFF" && !out.hint) out.hint = SCREEN_OFF_HINT;
    if (typeof body.detail === "string" && body.detail) out.error = body.detail;
    else if (fallbackError) out.error = fallbackError;
    vscreenSyncSession(body.reason);
    return out;
  }
  return {
    ok: false, reason: "BRIDGE_UNREACHABLE",
    hint: APP_BRIDGE_HINT,
    error: fallbackError || (res && res.error) || "无响应或响应不是 JSON"
  };
}

/** vscreen 失败渲染（统一展示 reason/hint/error，不吞字段）。 */
function vscreenFailRender(title) {
  return (v) => [{
    type: "text",
    text: title + "失败：" + (v.reason || v.error || "未知错误") +
      (v.hint ? " — " + v.hint : "") +
      (v.reason && v.error ? "（" + v.error + "）" : "")
  }];
}

function apply(ctx) {
  const dex = () => process.env.SHIZUKU_DEX;
  const appId = () => process.env.SHIZUKU_APP_ID;

  // ===== App 层工具（无需 root/Shizuku，走 App 本地 HTTP 服务）=====
  // 这些能力由 DeepSeek Harness App 自身实现（UsageStats/悬浮窗权限），
  // 不依赖特权通道，因此即使未授权 root/Shizuku 也注册。

  // 应用使用时长（UsageStats：需用户在系统设置授予「使用情况访问」权限）
  ctx.tools.register(defineTool({
    name: "android_usage",
    description:
      "查询手机各应用的使用时长（UsageStats）：返回最近 N 天每个应用的前台使用时长（毫秒/分钟），按时长降序。" +
      "可用于回答「今天/本周哪些应用用得最多」「某应用用了多久」等问题。App 需已授予「使用情况访问」权限。",
    parameters: {
      days: { type: "number", description: "查询最近几天（默认 1，上限 30）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          days: { type: "number" },
          apps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                pkg: { type: "string" },
                name: { type: "string" },
                ms: { type: "number" },
                min: { type: "number" }
              }
            }
          }
        }
      },
      render: (_a, v) => renderUsage(v)
    },
    async execute(args, exec) {
      return await appRequest("/usage", args.days ? { days: String(Math.max(1, Math.min(30, Number(args.days) || 1))) } : undefined);
    }
  }));

  // v1.8.5：读取手机最近通知（需用户在系统设置授予「通知读取权限」）
  ctx.tools.register(defineTool({
    name: "android_notifications",
    description:
      "读取手机最近的通知（微信/邮件/短信验证码等，每应用保留最新一条，最多 50 条）。" +
      "返回来源应用、标题、正文、时间。可用于「帮我看下刚来的微信说什么」「有什么新通知」「验证码是多少」等。" +
      "首次使用需用户在系统设置授予「通知读取权限」——未授权时返回引导文案，请把引导转述给用户。" +
      "无需 Shizuku/root。注意：通知内容可能含隐私，只用于用户明确要求的场景。",
    parameters: {
      limit: { type: "number", description: "返回条数上限（默认 20，最大 50）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          granted: { type: "boolean" },
          count: { type: "number" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                pkg: { type: "string" },
                app: { type: "string" },
                title: { type: "string" },
                text: { type: "string" },
                when: { type: "number" }
              }
            }
          }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return [{ type: "text", text: "读取失败：" + (v.error || "未知错误") }];
        if (!v.granted) return [{
          type: "text",
          text: "尚未授予「通知读取权限」：请到 系统设置 → 通知 → 通知读取（或 设备与应用/通知使用权）→ 开启「DeepSeek Harness 通知读取」，然后重试。"
        }];
        if (!v.count) return [{ type: "text", text: "当前没有记录到任何通知（开启权限后新到的通知才会被记录）。" }];
        const lines = v.items.map((it) =>
          "[" + it.app + "] " + it.title + (it.text ? " | " + it.text : ""));
        return [{ type: "text", text: "最近 " + v.count + " 条通知：\n" + lines.join("\n") }];
      }
    },
    async execute(args, exec) {
      return await appRequest("/notifications", args.limit ? { limit: String(Math.max(1, Math.min(50, Number(args.limit) || 20))) } : undefined);
    }
  }));

  // 小鲸鱼悬浮窗控制（含引擎状态显示；需已授予悬浮窗权限）
  ctx.tools.register(defineTool({
    name: "android_overlay",
    description:
      "控制 DeepSeek Harness 的小鲸鱼悬浮窗：show=显示悬浮窗（小鲸鱼图标，点击展开引擎状态面板）；" +
      "hide=隐藏；status=查询悬浮窗与引擎运行状态。需已授予悬浮窗权限。",
    parameters: {
      action: {
        type: "string", required: true, enum: ["show", "hide", "status"],
        description: "show=显示悬浮窗；hide=隐藏；status=查询状态"
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          running: { type: "boolean" },
          engineUp: { type: "boolean" },
          granted: { type: "boolean" },
          msg: { type: "string" }
        }
      },
      render: (_a, v) => renderOverlay(v)
    },
    async execute(args, exec) {
      return await appRequest("/overlay", { action: String(args.action || "status") });
    }
  }));

  // ===== 虚拟屏 vscreen（批次 11）：全部走 3081 /vscreen/*（App 层唯一后端，无需插件侧特权门控）=====
  // 红线：操作只作用于虚拟屏、不抢占主屏前台、仅本机使用；服务端单会话（create 后隐式绑定）。
  // 未 create 时：see/tap/swipe/key 静默自愈建屏（ensureVscreenCreated）；close 等仍本地 NOT_CREATED（见 vscreenNotCreated）。
  ctx.tools.register(defineTool({
    name: "android_vscreen_create",
    description:
      "创建一块虚拟屏（Display），用于在不抢占主屏前台的隔离屏幕上后台操作应用（仅本机使用）。" +
      "内部按「受信 flags → 普通 flags → overlay 投射」三级阶梯建屏，root/Shizuku 通道由 App 自动选择。" +
      "首次创建可能需要数十秒（含 overlay 建屏轮询），请耐心等待本次调用返回，不要中途放弃。" +
      "成功返回 displayId 与 strategy；随后用 android_vscreen_launch/see/tap/swipe/key 操作虚拟屏，" +
      "android_vscreen_close 结束会话。宽/高/dpi 可省略（默认 1080x1920 @440dpi）。",
    parameters: {
      width: { type: "number", description: "虚拟屏宽度（像素，默认 1080）" },
      height: { type: "number", description: "虚拟屏高度（像素，默认 1920）" },
      dpi: { type: "number", description: "虚拟屏密度（dpi，默认 440）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          displayId: { type: "number" },
          strategy: { type: "string" },
          channel: { type: "string" },
          reason: { type: "string" },
          hint: { type: "string" },
          error: { type: "string" }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return vscreenFailRender("虚拟屏创建")(v);
        return [{
          type: "text",
          text: "虚拟屏已创建：displayId=" + v.displayId +
            (v.strategy ? "，strategy=" + v.strategy : "") +
            (v.channel ? "，channel=" + v.channel : "") +
            "。后续 launch/see/tap/swipe/key 均只作用于虚拟屏（不抢占主屏前台）；用 android_vscreen_close 结束会话。"
        }];
      }
    },
    async execute(args, exec) {
      const dims = {};
      for (const [k, raw] of [["width", args.width], ["height", args.height], ["dpi", args.dpi]]) {
        if (raw == null) continue;
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) return vscreenInvalid(k + " 须为正数");
        dims[k] = Math.round(n);
      }
      const res = await vscreenBridge("POST", "/vscreen/create", dims, VSCREEN_CREATE_TIMEOUT_MS);
      if (res.unreachable) return vscreenFail(res);
      const b = res.json;
      if (!b || b.ok !== true) {
        setVscreenCreated(false);
        return vscreenFail(res, "虚拟屏创建失败");
      }
      const dId = Number.isFinite(b.displayId) ? b.displayId : null;
      setVscreenCreated(true, dId);
      const out = { ok: true };
      if (dId != null) out.displayId = dId;
      if (typeof b.strategy === "string") out.strategy = b.strategy;
      if (typeof b.channel === "string") out.channel = b.channel;
      return out;
    }
  }));

  ctx.tools.register(defineTool({
    name: "android_vscreen_status",
    description:
      "查询虚拟屏通道与会话状态（只读、无副作用）：root/Shizuku 可用性、当前通道（root/shizuku）、" +
      "建屏策略（trusted/plain/overlay）、displayId、服务端进程 pid 与运行时长、通道偏好（auto/root/shizuku）。" +
      "无需先 create 即可调用。操作只读取虚拟屏会话信息、不抢占主屏前台、仅本机使用。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          rootAvailable: { type: "boolean" },
          shizukuAvailable: { type: "boolean" },
          channel: { type: "string" },
          strategy: { type: "string" },
          displayId: { type: "number" },
          serverPid: { type: "number" },
          uptimeMs: { type: "number" },
          channelPref: { type: "string" },
          reason: { type: "string" },
          hint: { type: "string" },
          error: { type: "string" }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return vscreenFailRender("虚拟屏状态查询")(v);
        const L = ["虚拟屏状态："];
        if (typeof v.rootAvailable === "boolean") L.push("- root 可用: " + (v.rootAvailable ? "是" : "否"));
        if (typeof v.shizukuAvailable === "boolean") L.push("- Shizuku 可用: " + (v.shizukuAvailable ? "是" : "否"));
        L.push("- 当前通道: " + (v.channel || "无会话"));
        L.push("- 建屏策略: " + (v.strategy || "无会话"));
        if (Number.isFinite(v.displayId)) L.push("- displayId: " + v.displayId);
        if (Number.isFinite(v.serverPid)) L.push("- 服务端 pid: " + v.serverPid +
          (Number.isFinite(v.uptimeMs) ? "（已运行 " + Math.round(v.uptimeMs / 1000) + "s）" : ""));
        if (typeof v.channelPref === "string") L.push("- 通道偏好: " + v.channelPref);
        return [{ type: "text", text: L.join("\n") }];
      }
    },
    async execute(args, exec) {
      const res = await vscreenBridge("GET", "/vscreen/status", null, 8000);
      if (res.unreachable) return vscreenFail(res);
      const b = res.json;
      if (!b || b.ok !== true) return vscreenFail(res, "虚拟屏状态查询失败");
      const out = { ok: true };
      if (typeof b.rootAvailable === "boolean") out.rootAvailable = b.rootAvailable;
      if (typeof b.shizukuAvailable === "boolean") out.shizukuAvailable = b.shizukuAvailable;
      if (typeof b.channel === "string") out.channel = b.channel;
      if (typeof b.strategy === "string") out.strategy = b.strategy;
      if (Number.isFinite(b.displayId)) out.displayId = b.displayId;
      if (Number.isFinite(b.serverPid)) out.serverPid = b.serverPid;
      if (Number.isFinite(b.uptimeMs)) out.uptimeMs = b.uptimeMs;
      if (typeof b.channelPref === "string") out.channelPref = b.channelPref;
      return out;
    }
  }));

  ctx.tools.register(defineTool({
    name: "android_vscreen_launch",
    description:
      "在虚拟屏上启动指定应用（等价 am start --display <虚拟屏>）：应用界面出现在虚拟屏而非主屏，" +
      "不抢占主屏前台、仅本机使用。需先 android_vscreen_create；packageName 可为包名" +
      "（如 com.example.app）或「包名/activity」组件简称。启动失败时返回 reason=LAUNCH_FAILED。",
    parameters: {
      packageName: { type: "string", required: true, description: "要启动的应用包名（或 包名/activity 组件简称）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          packageName: { type: "string" },
          reason: { type: "string" },
          hint: { type: "string" },
          error: { type: "string" }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return vscreenFailRender("虚拟屏启动应用")(v);
        return [{ type: "text", text: "已在虚拟屏启动 " + (v.packageName || "(未回显包名)") + "（主屏前台不受影响）。" }];
      }
    },
    async execute(args, exec) {
      if (!isVscreenCreated()) return vscreenNotCreated();
      const pkg = String(args.packageName == null ? "" : args.packageName).trim();
      if (!pkg || pkg.length > 200 || !/^[A-Za-z0-9_.$/-]+$/.test(pkg)) {
        return vscreenInvalid("packageName 须为合法包名或「包名/activity」组件简称");
      }
      const res = await vscreenBridge("POST", "/vscreen/launch", { packageName: pkg }, 15000);
      if (res.unreachable) return vscreenFail(res);
      const b = res.json;
      if (!b || b.ok !== true) return vscreenFail(res, "虚拟屏启动应用失败");
      return { ok: true, packageName: pkg };
    }
  }));

  // see 需要把 PNG 注入对话：与 dsh-tool-accessibility 的 android_see 同机制
  // （attachments.saveImage → render 返回 {type:"image", attachment}），
  // 因此仅在 attachments 服务挂载时注册本工具（与 android_see 完全一致的做法）。
  ctx.inject(["attachments"], (imageCtx) => {
    imageCtx.tools.register(defineTool({
      name: "android_vscreen_see",
      description:
        "截取虚拟屏当前画面，返回 PNG 图片供模型直接查看（无需读控件树即可理解虚拟屏内容）。" +
        "截图只来自虚拟屏、不影响主屏前台、仅本机使用。需先 android_vscreen_create。" +
        "截图像素坐标即虚拟屏像素坐标：android_vscreen_tap/swipe 直接用图中量到的像素，无需换算。" +
        "需要当前模型支持图片输入；模型不支持图片时请改用其他描述性手段确认虚拟屏状态。",
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true },
            reason: { type: "string" },
            hint: { type: "string" },
            error: { type: "string" },
            image: {
              type: "object",
              additionalProperties: false,
              properties: {
                attachmentId: { type: "string", required: true },
                mediaType: { type: "string", required: true },
                bytes: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
                name: { type: "string" }
              }
            }
          }
        },
        render: (_a, v) => {
          if (!v.ok) return vscreenFailRender("虚拟屏截图")(v);
          const meta = [
            (v.image.mediaType || "image/png") + " 虚拟屏截图, " + v.image.width + "x" + v.image.height +
              " px, " + v.image.bytes + " bytes",
            "截图像素坐标即虚拟屏像素坐标：android_vscreen_tap/swipe 直接用图中坐标，无需换算。"
          ];
          return [{
            type: "text",
            text: meta.join("\n")
          }, {
            type: "image",
            attachment: {
              attachmentId: v.image.attachmentId,
              mediaType: v.image.mediaType,
              bytes: v.image.bytes,
              width: v.image.width,
              height: v.image.height,
              ...(v.image.name === undefined ? {} : { name: v.image.name })
            }
          }];
        }
      },
      async execute(args, exec) {
        const ensured = await ensureVscreenCreated(ctx);
        if (!ensured.ok) return ensured;
        const attachments = imageCtx.get("attachments");
        if (attachments === undefined) {
          return { ok: false, error: "cannot screenshot: no attachment service is mounted" };
        }
        let res = await vscreenBridge("GET", "/vscreen/see", null, VSCREEN_SEE_TIMEOUT_MS);
        if (!res.binary) {
          // 批次81-T2-3：陈旧守卫态（App 已回收会话）会让首个 see 直接失败 → 清位自愈建屏后重试一次
          const retried = await vscreenRetryAfterSessionLoss(
            ctx, res, () => vscreenBridge("GET", "/vscreen/see", null, VSCREEN_SEE_TIMEOUT_MS));
          if (retried) res = retried;
        }
        if (res.binary) {
          // image/png：与 android_see 相同的附件保存 + image 渲染链路
          try {
            const ref = await attachments.saveImage({ data: res.binary, mediaType: "image/png", name: "vscreen.png" });
            return {
              ok: true,
              image: {
                attachmentId: ref.attachmentId,
                mediaType: ref.mediaType || "image/png",
                bytes: Number.isFinite(ref.bytes) ? ref.bytes : res.binary.length,
                width: Number.isFinite(ref.width) ? ref.width : 0,
                height: Number.isFinite(ref.height) ? ref.height : 0,
                ...(ref.name === undefined ? {} : { name: ref.name })
              }
            };
          } catch (e) {
            return { ok: false, error: "虚拟屏截图保存为附件失败: " + String(e && e.message || e) };
          }
        }
        return vscreenFail(res, "虚拟屏截图失败");
      }
    }));
  });

  ctx.tools.register(defineTool({
    name: "android_vscreen_tap",
    description:
      "点击虚拟屏上的指定坐标（像素，取整）。坐标系是虚拟屏自身分辨率（可用 android_vscreen_see 的截图直接量取），" +
      "与主屏无关：操作只作用于虚拟屏、不抢占主屏前台、仅本机使用。需先 android_vscreen_create。" +
      "注入失败时返回 reason=INJECT_FAILED。",
    parameters: {
      x: { type: "number", required: true, description: "虚拟屏像素 x（截图上量到的横坐标）" },
      y: { type: "number", required: true, description: "虚拟屏像素 y（截图上量到的纵坐标）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          x: { type: "number" },
          y: { type: "number" },
          reason: { type: "string" },
          hint: { type: "string" },
          error: { type: "string" }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return vscreenFailRender("虚拟屏点击")(v);
        return [{ type: "text", text: "已在虚拟屏点击 (" + v.x + ", " + v.y + ")。" }];
      }
    },
    async execute(args, exec) {
      const ensured = await ensureVscreenCreated(ctx);
      if (!ensured.ok) return ensured;
      const x = vscreenNum(args.x);
      const y = vscreenNum(args.y);
      if (x == null || y == null) return vscreenInvalid("x/y 须为数字（虚拟屏像素坐标）");
      const res = await vscreenBridge("POST", "/vscreen/tap", { x, y }, 8000);
      if (res.unreachable) return vscreenFail(res);
      const b = res.json;
      if (!b || b.ok !== true) {
        // 批次81-T2-3：守卫态陈旧导致的首个失败 → 清位自愈建屏 + 原动作重试一次（只重试一次）
        const retried = await vscreenRetryAfterSessionLoss(
          ctx, res, () => vscreenBridge("POST", "/vscreen/tap", { x, y }, 8000));
        if (!retried) return vscreenFail(res, "虚拟屏点击失败");
        if (retried.unreachable) return vscreenFail(retried);
        const rb = retried.json;
        if (!rb || rb.ok !== true) return vscreenFail(retried, "虚拟屏点击失败");
      }
      return { ok: true, x, y };
    }
  }));

  ctx.tools.register(defineTool({
    name: "android_vscreen_swipe",
    description:
      "在虚拟屏上从起点滑动到终点（按下→移动→抬起）：翻页、划列表、拖动等。" +
      "坐标为虚拟屏像素（可用 android_vscreen_see 的截图直接量取）；操作只作用于虚拟屏、" +
      "不抢占主屏前台、仅本机使用。需先 android_vscreen_create。durationMs 控制时长（App 默认 300ms，" +
      "慢速拖动可加大到 800~1500ms）。注入失败时返回 reason=INJECT_FAILED。",
    parameters: {
      x1: { type: "number", required: true, description: "起点 x（虚拟屏像素）" },
      y1: { type: "number", required: true, description: "起点 y（虚拟屏像素）" },
      x2: { type: "number", required: true, description: "终点 x（虚拟屏像素）" },
      y2: { type: "number", required: true, description: "终点 y（虚拟屏像素）" },
      durationMs: { type: "number", description: "滑动持续毫秒数（App 默认 300）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          x1: { type: "number" },
          y1: { type: "number" },
          x2: { type: "number" },
          y2: { type: "number" },
          durationMs: { type: "number" },
          reason: { type: "string" },
          hint: { type: "string" },
          error: { type: "string" }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return vscreenFailRender("虚拟屏滑动")(v);
        return [{ type: "text", text: "已在虚拟屏滑动 (" + v.x1 + "," + v.y1 + ") → (" + v.x2 + "," + v.y2 + ")" +
          (Number.isFinite(v.durationMs) ? "，时长 " + v.durationMs + "ms。" : "。") }];
      }
    },
    async execute(args, exec) {
      const ensured = await ensureVscreenCreated(ctx);
      if (!ensured.ok) return ensured;
      const x1 = vscreenNum(args.x1), y1 = vscreenNum(args.y1);
      const x2 = vscreenNum(args.x2), y2 = vscreenNum(args.y2);
      if (x1 == null || y1 == null || x2 == null || y2 == null) {
        return vscreenInvalid("x1/y1/x2/y2 须为数字（虚拟屏像素坐标）");
      }
      const body = { x1, y1, x2, y2 };
      if (args.durationMs != null) {
        const d = vscreenNum(args.durationMs);
        if (d == null || d < 0) return vscreenInvalid("durationMs 须为非负数字（毫秒）");
        body.durationMs = d;
      }
      const res = await vscreenBridge("POST", "/vscreen/swipe", body, 8000);
      if (res.unreachable) return vscreenFail(res);
      const b = res.json;
      if (!b || b.ok !== true) {
        // 批次81-T2-3：守卫态陈旧导致的首个失败 → 清位自愈建屏 + 原动作重试一次（只重试一次）
        const retried = await vscreenRetryAfterSessionLoss(
          ctx, res, () => vscreenBridge("POST", "/vscreen/swipe", body, 8000));
        if (!retried) return vscreenFail(res, "虚拟屏滑动失败");
        if (retried.unreachable) return vscreenFail(retried);
        const rb = retried.json;
        if (!rb || rb.ok !== true) return vscreenFail(retried, "虚拟屏滑动失败");
      }
      return { ok: true, x1, y1, x2, y2, ...(args.durationMs != null ? { durationMs: body.durationMs } : {}) };
    }
  }));

  ctx.tools.register(defineTool({
    name: "android_vscreen_key",
    description:
      "向虚拟屏发送按键事件：key 为白名单键名（HOME/BACK/ENTER/RECENT/DPAD_UP/VOLUME_UP 等，" +
      "大小写不敏感）或数字键值（0~65535，如 3=HOME、4=BACK）。按键只发往虚拟屏、" +
      "不抢占主屏前台、仅本机使用。需先 android_vscreen_create。注入失败时返回 reason=INJECT_FAILED。",
    parameters: {
      key: { type: "string", required: true, description: "按键名（HOME/BACK/ENTER/RECENT 等）或数字键值（如 4=BACK）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          key: { type: "string" },
          reason: { type: "string" },
          hint: { type: "string" },
          error: { type: "string" }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return vscreenFailRender("虚拟屏按键")(v);
        return [{ type: "text", text: "已向虚拟屏发送按键 " + (v.key || "") + "。" }];
      }
    },
    async execute(args, exec) {
      const ensured = await ensureVscreenCreated(ctx);
      if (!ensured.ok) return ensured;
      const key = normalizeVscreenKey(args.key);
      if (!key) {
        return vscreenInvalid("key 须为白名单键名（HOME/BACK/ENTER/RECENT/DPAD_* 等，大小写不敏感）或数字键值（0~65535）");
      }
      const res = await vscreenBridge("POST", "/vscreen/key", { key }, 8000);
      if (res.unreachable) return vscreenFail(res);
      const b = res.json;
      if (!b || b.ok !== true) {
        // 批次81-T2-3：守卫态陈旧导致的首个失败 → 清位自愈建屏 + 原动作重试一次（只重试一次）
        const retried = await vscreenRetryAfterSessionLoss(
          ctx, res, () => vscreenBridge("POST", "/vscreen/key", { key }, 8000));
        if (!retried) return vscreenFail(res, "虚拟屏按键失败");
        if (retried.unreachable) return vscreenFail(retried);
        const rb = retried.json;
        if (!rb || rb.ok !== true) return vscreenFail(retried, "虚拟屏按键失败");
      }
      return { ok: true, key };
    }
  }));

  ctx.tools.register(defineTool({
    name: "android_vscreen_close",
    description:
      "关闭并销毁当前虚拟屏（会话收尾）：销毁 display、还原 overlay 投射设置（若 overlay 会话用过）、" +
      "由 App 释放 wakelock。只影响虚拟屏、不抢占主屏前台、仅本机使用。调用后本地会话态复位，" +
      "再操作虚拟屏需重新 android_vscreen_create。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          restoredOverlay: { type: "boolean" },
          reason: { type: "string" },
          hint: { type: "string" },
          error: { type: "string" }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return vscreenFailRender("虚拟屏关闭")(v);
        return [{ type: "text", text: "虚拟屏已关闭" +
          (typeof v.restoredOverlay === "boolean" ? "（overlay 设置已还原: " + v.restoredOverlay + "）" : "") +
          "。再次使用请先 android_vscreen_create。" }];
      }
    },
    async execute(args, exec) {
      if (!isVscreenCreated()) return vscreenNotCreated();
      const res = await vscreenBridge("POST", "/vscreen/close", {}, 8000);
      // close 无论成败都清本地会话态（失败说明会话大概率已死，不再让守卫态残留）
      setVscreenCreated(false);
      if (res.unreachable) return vscreenFail(res);
      const b = res.json;
      if (!b || b.ok !== true) return vscreenFail(res, "虚拟屏关闭失败");
      const out = { ok: true };
      if (typeof b.restoredOverlay === "boolean") out.restoredOverlay = b.restoredOverlay;
      return out;
    }
  }));


  // ===== chroot 全功能 Linux 用户态（batch5，需要 root）=====
  // 批次86-P2-1（改判 batch5 的旧决策）：本族工具改为**按设备能力注册**，判据 chrootToolsAvailable()
  //  —— root 通道在位（ROOT_AVAILABLE=1）或 rootfs 已在位时才注册。
  // 旧决策「注册在特权门控之前、始终进工具列表，未就绪时返回可执行指引」的前提是"设备上这工具
  // 至少能跑通一次"；但在本机（Honor BKQ-AN10：无 su/root、CHROOT_DIR/bin/busybox 不存在）
  // 这 4 个工具恒失败——注册它们只是丢给模型一个永远报错的入口、白烧一轮。有 root 的机器行为
  // 不变：rootfs 未就绪时照样注册并返回既有的准备指引，可发现性保留。
  // 根因与实测取证：docs/批次86-重审与瘦身方案.md §P2-1。
  if (chrootToolsAvailable()) ctx.tools.register(defineTool({
    name: "android_chroot_exec",
    description:
      "在手机的 chroot 里执行 shell 命令——这是 root 通道下的**完整 Linux 用户态**（Alpine）：" +
      "真正的 GNU bash、" +
      "GNU coreutils、apk 包管理器（apk add 可直接安装软件包）、完整 /proc /sys /dev（bind 宿主 /dev，" +
      "/dev/zero、/dev/urandom、/dev/null 均可用）。" +
      "适合跑复杂 shell 脚本（管道/数组/函数/进程替换）、安装并运行 Linux 命令行工具、" +
      "处理大文件、跑构建或数据处理任务。" +
      "适合批量/循环/文件处理类任务；配合 run_in_background + android_task_list 可长跑。" +
      "只需单条命令/脚本的场合也可用既有进程内命令工具（更快、无 root 依赖）。" +
      "注意：本工具需要 root（su）；device 未授予 root/Shizuku 时调用会返回明确错误。" +
      "rootfs 未就绪时会返回一份可在电脑上照抄的准备步骤。" +
      "/sdcard 默认不挂载（安全加固，任务#51）；需要在 chroot 内读写手机存储" +
      "（路径 " + CHROOT_DIR + "/mnt/sdcard）时，显式传 mount_sdcard=true。",
    parameters: {
      command: { type: "string", required: true, description: "要在 chroot 内执行的命令或脚本（等价于 shell -lc 'command'）" },
      shell: { type: "string", enum: ["bash", "sh"], description: "使用的 shell，默认 bash；chroot 内没有 bash 时自动回退 sh 并在 notes 里说明" },
      timeout_ms: { type: "number", description: "超时毫秒数（默认 60000，上限 300000；仅前台模式有效）" },
      no_mount: { type: "boolean", description: "为 true 时跳过 proc/sysfs/dev 与 /sdcard 挂载（调试用）" },
      mount_sdcard: { type: "boolean", description: "为 true 时才把手机存储 /sdcard bind 挂载到 " + CHROOT_DIR + "/mnt/sdcard（默认 false 不挂，显式 opt-in；挂载幂等，重复调用不会叠加）" },
      run_in_background: { type: "boolean", description: "为 true 时以 nohup 式后台作业启动：立即返回 job_id，stdout/stderr 拆分落设备文件（.out/.err），脚本可自愿写 $DSH_TASK_CKPT 记进度，用 android_chroot_job 查询/终止；不受 300s 前台超时限制（长任务用它）" }
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
          shell_used: { type: "string" },
          rootfs_ready: { type: "boolean" },
          job_id: { type: "string" },
          background: { type: "boolean" },
          notes: { type: "array", items: { type: "string" } }
        }
      },
      render: (_a, v) => renderChroot(v)
    },
    async execute(args, exec) {
      const notes = [];
      const command = String(args.command == null ? "" : args.command);
      const shellName = args.shell === "sh" ? "sh" : "bash";
      const timeoutMs = Math.max(1000, Math.min(Number(args.timeout_ms) || 60000, 300000));
      const noMount = args.no_mount === true;
      const mountSdcard = args.mount_sdcard === true;
      if (!command.trim()) {
        return {
          ok: false, exit_code: -1, stdout: "", stderr: "command 为空：请传入要在 chroot 内执行的 shell 命令。",
          shell_used: shellName, rootfs_ready: false, notes
        };
      }
      // 无特权通道时早退：避免落到 Shizuku 分支报出难懂的「SHIZUKU_DEX 未配置」
      if (!privilegedAvailable()) {
        return {
          ok: false, exit_code: -1, stdout: "",
          stderr: "未检测到 root/Shizuku 特权通道：android_chroot_exec 需要 root（su）才能挂载文件系统并进入 chroot。",
          shell_used: shellName, rootfs_ready: false, notes
        };
      }
      // 批次6：后台作业模式——立即返回 job_id，不阻塞等待；前台模式维持现状（含 300s 上限）。
      // 红线：后台作业强制 no_mount（热路径不做挂载操作，幂等挂载留给前台调用/初始化）。
      if (args.run_in_background === true) {
        const started = await startChrootJob(command, shellName, notes);
        return started;
      }
      const r = await privCmd(buildChrootScript(command, shellName, noMount, mountSdcard), timeoutMs, 300000);
      if (r.error) notes.push("特权通道提示：" + r.error);
      const parsed = parseChrootOutput(r.stdout, notes);
      const err = parseChrootOutput(r.stderr, notes);
      const exitCode = typeof r.exit_code === "number" ? r.exit_code : -1;
      if (parsed.noRootfs) {
        notes.unshift(chrootRootfsHint());
        return {
          ok: false, exit_code: exitCode, stdout: "",
          stderr: "rootfs 未就绪：找不到 " + CHROOT_DIR + "/bin/busybox（详见 notes 的准备步骤）。",
          shell_used: shellName, rootfs_ready: false, notes
        };
      }
      const shellUsed = parsed.shell ? (parsed.shell.endsWith("/bash") ? "bash" : "sh") : shellName;
      return {
        ok: exitCode === 0,
        exit_code: exitCode,
        stdout: truncateOut(parsed.text, CHROOT_OUT_LIMIT),
        stderr: truncateOut(err.text, CHROOT_OUT_LIMIT),
        shell_used: shellUsed,
        rootfs_ready: true,
        notes
      };
    }
  }));

  // ===== chroot 后台作业管理（批次6）=====
  // 批次86-P2-1：与 android_chroot_exec 同族，共用 chrootToolsAvailable() 判据（job 管理面没有
  // chroot 作业就不可能存在）。
  if (chrootToolsAvailable()) ctx.tools.register(defineTool({
    name: "android_chroot_job",
    description:
      "管理 android_chroot_exec(run_in_background=true) 启动的 chroot 后台作业：" +
      "list=列出全部作业（id/命令/启动时间/存活）；output=查看作业输出（stdout/stderr 拆分落设备文件 .out/.err，" +
      "批次23 S3 起生效，追加式；旧作业仅 .out，err 返回空）；" +
      "kill=终止作业（root 进程组击杀 kill -9 -pgid + 收敛确认，随后清掉注册表条目）。" +
      "output 可轮询：作业运行中返回 stdout/stderr 各自末尾 8000 字符 + running 状态；作业已退出则返回最终输出。",
    parameters: {
      action: { type: "string", required: true, enum: ["list", "output", "kill"], description: "list=列出作业；output=查看输出（需 job_id）；kill=终止作业（需 job_id）" },
      job_id: { type: "string", description: "output/kill 时的作业 id（startChrootJob 返回的 job_id）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          action: { type: "string" },
          jobs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                pgid: { type: "number" },
                out: { type: "string" },
                err: { type: "string", description: "stderr 文件指针（批次23 S3 拆分落盘；旧作业无此字段）" },
                startedAt: { type: "string" },
                command: { type: "string" },
                alive: { type: "boolean" },
                rc: { type: "number", description: "批次23 S2：自然退出的退出码（rc 文件，被 kill 的作业无此字段）" },
                doneAt: { type: "number", description: "批次23 S2：自然退出的结束时刻（date +%s 秒）" }
              }
            }
          },
          job_id: { type: "string" },
          running: { type: "boolean" },
          output: { type: "string", description: "stdout 文件末尾内容（tail -c 8000）" },
          err: { type: "string", description: "stderr 文件末尾内容（tail -c 8000；批次23 S3 拆分落盘，旧作业无 err 文件时为空串）" },
          killed: { type: "boolean" }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return [{ type: "text", text: "chroot 作业操作失败：" + (v.error || "未知错误") }];
        if (v.action === "list") {
          if (!v.jobs || !v.jobs.length) return [{ type: "text", text: "当前没有 chroot 后台作业。" }];
          const lines = v.jobs.map((j) =>
            `- ${j.id} ${j.alive ? "[运行中 pgid=" + j.pgid + "]" : "[已退出" + (typeof j.rc === "number" ? " rc=" + j.rc : "（旧作业，无终态记录）") + "]"} ${j.startedAt}` +
            (j.command ? "\n  cmd: " + j.command : "") +
            (j.err ? "\n  stderr: " + j.err : ""));
          return [{ type: "text", text: "chroot 后台作业 " + v.jobs.length + " 个：\n" + lines.join("\n") }];
        }
        if (v.action === "output") {
          let s = "作业 " + (v.job_id || "") + (v.running ? " 仍在运行" : " 已结束") +
            "，stdout（末尾 8000 字符）：\n" + (v.output || "（暂无输出）");
          // 批次23 S3（D7）：stderr 拆分展示；旧作业/无 stderr 时为空串，不展示空节
          if (v.err) s += "\n\nstderr（末尾 8000 字符）：\n" + v.err;
          return [{ type: "text", text: s }];
        }
        return [{ type: "text", text: "作业 " + (v.job_id || "") + (v.killed ? " 已终止（进程组已击杀，无残留）" : " 终止异常，请复核") }];
      }
    },
    async execute(args, exec) {
      const action = String(args.action || "");
      if (action === "list") {
        const r = await listChrootJobs();
        if (!r.ok) return { ok: false, error: r.error, action, jobs: [] };
        return { ok: true, action, jobs: r.jobs };
      }
      const jobId = String(args.job_id || "").trim();
      if (!jobId || !/^[a-zA-Z0-9._-]+$/.test(jobId)) {
        return { ok: false, error: "需要合法的 job_id（output/kill）", action };
      }
      const metaPath = CHROOT_JOBS_DIR + "/" + jobId + ".json";
      const scriptPath = CHROOT_JOBS_DIR + "/" + jobId + ".sh";
      const cat = await suCmd("cat " + metaPath + " 2>/dev/null", 10000);
      let meta = null;
      try { meta = JSON.parse(String(cat.stdout || "").trim()); } catch (_) {}
      if (!meta || !meta.pgid) {
        return { ok: false, error: "找不到作业 " + jobId + " 的注册表条目（可能已被清理或从未存在）", action };
      }
      if (action === "output") {
        // 批次23 S3（D7 stdout/stderr 拆分）：out/err 各 tail -c 8000（截断策略与 out 一致），
        // 用标记行分段后分别放进 response 的 output/err 字段；旧作业 meta 无 err 路径 →
        // 不发 ERR 标记、err 恒为空串（兼容回退，绝不报错）。
        // 批次23 S2：顺带读终态捕获文件（仅新作业 meta 带 rc/done 路径；旧作业条件为空、命令不变）。
        const outCmd = "echo " + JOB_OUT_MARK + "; tail -c 8000 " + meta.out + " 2>/dev/null; " +
          (meta.err ? "echo " + JOB_ERR_MARK + "; tail -c 8000 " + meta.err + " 2>/dev/null; " : "") +
          "if kill -0 -" + meta.pgid + " 2>/dev/null; then echo JOB_ALIVE; else echo JOB_DEAD; fi; " +
          (meta.rc ? "[ -f " + meta.rc + " ] && echo \"JOB_RC=$(cat " + meta.rc + " 2>/dev/null)\"; " : "") +
          (meta.done ? "[ -f " + meta.done + " ] && echo \"JOB_DONE=$(cat " + meta.done + " 2>/dev/null)\"; " : "");
        const r = await suCmd(outCmd, 15000);
        const text = String(r.stdout || "");
        const running = text.includes("JOB_ALIVE");
        const rcM = text.match(/JOB_RC=(-?\d+)/);
        const doneM = text.match(/JOB_DONE=(\d+)/);
        if (!running) {
          // 批次23 S2（指令 ①）：output 轮询发现自然退出且 rc 已知 → 终态上报（best-effort，
          // fire-and-forget；reportNaturalFinish 内部对 rc 未知/重复上报直接跳过）
          reportNaturalFinish({
            id: jobId,
            alive: running,
            rc: rcM ? parseInt(rcM[1], 10) : undefined,
            doneAt: doneM ? parseInt(doneM[1], 10) : undefined
          });
        }
        // 分段：OUT 标记后是 stdout 段；有 ERR 标记时其后是 stderr 段（旧作业无标记 → err 空串）。
        // 终态/判活标记行（JOB_ALIVE 等）在两段尾部，各段剥掉后再 trim。
        let outPart = text;
        let errPart = "";
        const iOut = text.indexOf(JOB_OUT_MARK);
        if (iOut >= 0) {
          outPart = text.slice(iOut + JOB_OUT_MARK.length);
          const iErr = outPart.indexOf(JOB_ERR_MARK);
          if (iErr >= 0) {
            errPart = outPart.slice(iErr + JOB_ERR_MARK.length);
            outPart = outPart.slice(0, iErr);
          }
        }
        const stripCtrl = (s) => s.replace(/JOB_(ALIVE|DEAD|RC=[^\n]*|DONE=[^\n]*)/g, "").trim();
        return {
          ok: true, action, job_id: jobId, running,
          output: stripCtrl(outPart),
          err: stripCtrl(errPart) // 旧作业（无 err 文件）恒为空串，缺省不报错
        };
      }
      // kill：root 进程组击杀（#52 同款）+ 收敛确认 + 清理注册表与脚本
      await suCmd("kill -9 -" + meta.pgid + " 2>/dev/null; true", 10000);
      const clean = await killGroupConfirm(meta.pgid);
      await suCmd("rm -f " + metaPath + " " + scriptPath + "; true", 10000);
      if (clean) {
        // 批次23 S2（指令 ①）：kill 成功 → 终态上报 CANCELLED（D4，幂等；未注册过的任务
        // 得 ok:false "not found"，taskFinishBestEffort 已降级为 console 警告）。kill 是整组
        // 击杀、包装 sh 一并死、rc 无人写 → 不带 exit；收敛确认失败（疑似残留）时报未知结局
        // 是臆造，同样不报，交 Reaper 对账兜底。fire-and-forget 不阻塞返回。
        taskFinishBestEffort(jobId, { state: "CANCELLED" });
      }
      // 批次 18 修复（回归缺陷 1）：clean 时 error: undefined 混入返回体，lossless-JSON 校验
      // 拒绝（"value is not lossless JSON"）且功能实际已生效——调用方误判失败。改为条件展开。
      return clean
        ? { ok: true, action, job_id: jobId, killed: true }
        : { ok: false, action, job_id: jobId, killed: false, error: "进程组 " + meta.pgid + " 疑似有残留，请用 ps 复核" };
    }
  }));

  // ===== TaskSupervisor 工具面（批次23 S2，D4）：android_task_list / android_task_resume =====
  // cancel 不新增工具（D4：沿用 android_chroot_job action=kill + 其 finish 上报）。
  // 批次86-P2-1（改判批次23 的旧决策「注册在特权门控之前」）：这两个工具一并并入
  // chrootToolsAvailable() 判据注册。改判依据（已核实全链路）：Task DB（filesDir/tasks/tasks.json）
  // 只有 chroot 后台作业这一条写入路径——全仓唯一写方是本插件 startChrootJob 的 /task/upsert，
  // App 侧只有 MainActivity /task/upsert 路由转发 TaskStore，TaskStore 新建记录缺省
  // kind="chroot-job"（TaskStore.java:175）。没有 root 就没有 chroot 作业 ⇒ 注册表恒空、
  // list 恒返回空表、resume 恒找不到可重跑任务；保留它们只是多两个永远无用的入口。
  // 旧注释「读取本身不需要特权」属实，但它读的对象在本机不存在，故不再单独注册。
  if (chrootToolsAvailable()) ctx.tools.register(defineTool({
    name: "android_task_list",
    description:
      "列出 App 侧任务注册表（批次23 TaskSupervisor）里的 chroot 后台任务：状态" +
      "（RUNNING/COMPLETED/FAILED/CANCELLED/INTERRUPTED/STALE）、退出码、起止时间、命令预览与" +
      "输出文件指针（out/err）、checkpoint 文件路径（ckpt，自愿协议）、can_resume。作业启动时自动登记、" +
      "自然退出/被杀后自动落终态，App 侧 Reaper 还会用 kill -0 对账收养失联任务。" +
      "跨引擎重启盘点「哪些任务在跑/跑成了什么样」用这个。",
    parameters: {
      state: { type: "string", description: "可选，按状态过滤（RUNNING/COMPLETED/FAILED/CANCELLED/INTERRUPTED/STALE），大小写不敏感；缺省返回全部" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          activeCount: { type: "number", description: "注册表口径的 RUNNING 数（未按 state 过滤）" },
          state: { type: "string", description: "本次调用实际应用的 state 过滤（未传则无此字段）" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                kind: { type: "string" },
                state: { type: "string" },
                exit_code: { type: "number" },
                createdAt: { type: "number", description: "epoch ms" },
                updatedAt: { type: "number", description: "epoch ms" },
                finishedAt: { type: "number", description: "epoch ms" },
                job_id: { type: "string" },
                pgid: { type: "number" },
                out: { type: "string", description: "stdout 文件指针（设备 .out，用 android_chroot_job action=output 查看）" },
                err: { type: "string", description: "stderr 文件指针（设备 .err，批次23 S3 拆分落盘；旧任务缺省）" },
                ckpt: { type: "string", description: "checkpoint 文件指针（设备 .ckpt，宿主路径；脚本经 $DSH_TASK_CKPT 读写 chroot 内形式，自愿协议、内核不解析内容）" },
                resumed_from: { type: "string" },
                note: { type: "string" },
                staleReason: { type: "string" },
                command: { type: "string", description: "命令预览（解码后截断 200 字符，脱敏展示）" },
                can_resume: { type: "boolean" }
              }
            }
          }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return [{ type: "text", text: "任务列表获取失败：" + (v.error || "未知错误") }];
        if (!v.tasks.length) return [{ type: "text", text: "任务注册表为空" + (v.state ? "（state=" + v.state + " 无匹配）" : "（尚无 chroot 后台作业被登记）") + "。" }];
        const lines = v.tasks.map((t) => {
          let s = "- " + t.id + " [" + t.state + "]" +
            (typeof t.exit_code === "number" ? " exit_code=" + t.exit_code : "") +
            " 起 " + (msToIso(t.createdAt) || "?") +
            (t.finishedAt ? " 止 " + (msToIso(t.finishedAt) || "?") : "") +
            (t.can_resume ? " [可 resume]" : "");
          if (t.command) s += "\n  cmd: " + t.command;
          if (t.out) s += "\n  输出: " + t.out;
          if (t.err) s += "\n  err: " + t.err;
          if (t.ckpt) s += "\n  ckpt: " + t.ckpt;
          if (t.resumed_from) s += "\n  resumed_from: " + t.resumed_from;
          if (t.staleReason) s += "\n  staleReason: " + t.staleReason;
          if (t.note) s += "\n  note: " + t.note;
          return s;
        });
        const head = "任务 " + v.tasks.length + " 个" +
          (typeof v.activeCount === "number" ? "（注册表 RUNNING 共 " + v.activeCount + " 个）" : "") + "：";
        return [{ type: "text", text: head + "\n" + lines.join("\n") }];
      }
    },
    async execute(args, exec) {
      const r = await appRequest("/task/list");
      if (!r || !r.ok) {
        return { ok: false, error: (r && r.error) || APP_BRIDGE_HINT, tasks: [] };
      }
      let tasks = Array.isArray(r.tasks) ? r.tasks : [];
      const st = String(args.state || "").trim().toUpperCase();
      if (st) tasks = tasks.filter((t) => String(t.state || "").toUpperCase() === st);
      // 白名单映射（批次18 教训：undefined 混进返回体会被 lossless-JSON 校验拒绝）+ 脱敏
      //（指令 ④：command_b64 解码截断 200 字符展示，完整命令不回传）。
      const view = tasks.map((t) => {
        const o = {
          id: String(t.id || ""),
          kind: String(t.kind || ""),
          state: String(t.state || ""),
          can_resume: String(t.kind || "") === "chroot-job" && !!t.command_b64 && String(t.state || "") !== "RUNNING"
        };
        if (typeof t.exit_code === "number") o.exit_code = t.exit_code;
        if (typeof t.createdAt === "number") o.createdAt = t.createdAt;
        if (typeof t.updatedAt === "number") o.updatedAt = t.updatedAt;
        if (typeof t.finishedAt === "number") o.finishedAt = t.finishedAt;
        if (t.job_id) o.job_id = String(t.job_id);
        if (typeof t.pgid === "number") o.pgid = t.pgid;
        if (t.out) o.out = String(t.out);
        if (t.err) o.err = String(t.err);
        if (t.ckpt) o.ckpt = String(t.ckpt);
        if (t.resumed_from) o.resumed_from = String(t.resumed_from);
        if (t.note) o.note = String(t.note);
        if (t.staleReason) o.staleReason = String(t.staleReason);
        if (t.command_b64) {
          try { o.command = Buffer.from(String(t.command_b64), "base64").toString("utf8").slice(0, 200); }
          catch (_) { o.command = ""; }
        }
        return o;
      });
      const out = { ok: true, tasks: view };
      if (typeof r.activeCount === "number") out.activeCount = r.activeCount;
      if (st) out.state = st;
      return out;
    }
  }));

  // 批次86-P2-1：与 android_task_list 同族同判据（resume 直接复用 startChrootJob 后台启动路径）。
  if (chrootToolsAvailable()) ctx.tools.register(defineTool({
    name: "android_task_resume",
    description:
      "按任务 id 一键重跑（批次23 TaskSupervisor）：从任务注册表取原命令，用 chroot 后台作业" +
      "原样重跑为**新任务**（新任务 id，记 resumed_from 指向旧任务；旧任务记录原样保留作历史）。" +
      "注意：resume 是「一键重跑」而非断点续传——shell 进程死后无法续跑。checkpoint 是自愿协议：" +
      "作业启动时注入 $DSH_TASK_CKPT（checkpoint 文件路径），脚本可自行写进度（如 last_completed=3821），" +
      "内核不解析 ckpt 内容、不承诺任何续传行为；resume 重跑时上一轮任务的 ckpt 路径经 " +
      "$DSH_TASK_PREV_CKPT 传入，脚本自行决定如何续（旧任务未登记 ckpt 时不注入）。" +
      "仅支持 kind=chroot-job 且登记过 command_b64 的任务；RUNNING 任务拒绝重复启动。",
    parameters: {
      id: { type: "string", required: true, description: "要重跑的任务 id（android_task_list 里查）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          requested_id: { type: "string", description: "请求重跑的旧任务 id" },
          task_id: { type: "string", description: "重跑出的新任务 id（=新 job_id）" },
          resumed_from: { type: "string" },
          state: { type: "string" },
          notes: { type: "array", items: { type: "string" } }
        }
      },
      render: (_a, v) => {
        if (!v.ok) {
          let s = "任务重跑失败：" + (v.error || "未知错误") + (v.requested_id ? "（任务 " + v.requested_id + "）" : "");
          if (Array.isArray(v.notes) && v.notes.length) s += "\n" + v.notes.map((n) => " - " + n).join("\n");
          return [{ type: "text", text: s }];
        }
        const lines = ["已按原命令重跑为新任务：" + v.task_id + "（resumed_from=" + v.resumed_from + "，状态 " + (v.state || "RUNNING") + "）"];
        (v.notes || []).forEach((n) => lines.push(" - " + n));
        lines.push("查看输出：android_chroot_job action=output job_id=" + v.task_id);
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args, exec) {
      const id = String(args.id || "").trim();
      if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) {
        return { ok: false, error: "需要合法的任务 id（android_task_list 里查）" };
      }
      const g = await appRequest("/task/get", { id });
      if (!g || !g.ok) {
        return { ok: false, error: "任务不存在或查询失败：" + ((g && g.error) || "未知"), requested_id: id };
      }
      const t = g.task || {};
      if (String(t.kind || "") !== "chroot-job") {
        return { ok: false, error: "仅支持 kind=chroot-job 的任务（当前 kind=" + (t.kind || "?") + "）", requested_id: id };
      }
      if (!t.command_b64) {
        return { ok: false, error: "任务未登记 command_b64（旧版启动的作业无命令记录），无法重跑", requested_id: id };
      }
      if (String(t.state || "") === "RUNNING") {
        return { ok: false, error: "任务仍在 RUNNING，拒绝重复启动（先 android_chroot_job action=kill 或等它结束；STALE 不受限但建议先复核）", requested_id: id };
      }
      let command = "";
      try { command = Buffer.from(String(t.command_b64), "base64").toString("utf8"); } catch (_) { command = ""; }
      if (!command.trim()) {
        return { ok: false, error: "command_b64 解码为空，无法重跑", requested_id: id };
      }
      const notes = [];
      if (String(t.state || "") === "STALE") {
        notes.push("旧任务处于 STALE（疑似失联但进程可能仍活）：已照常重跑；若担心双跑，先用 android_chroot_job action=output 复核旧任务");
      }
      // 批次23 S3（D7 ckpt 自愿续跑协议）：旧任务登记过 ckpt（S3 起的新任务）→ 把其宿主路径
      // 换算成 chroot 内形式后作为 DSH_TASK_PREV_CKPT 注入新任务；旧任务无 ckpt → 不注入。
      // 校验：必须是本插件登记格式（CHROOT_DIR 前缀 + 路径安全字符），脏数据/外来自由文本
      // 一律放弃注入（fail-safe，绝不把未校验字符串拼进 root 包装脚本）。
      let prevCkpt = "";
      if (typeof t.ckpt === "string" && t.ckpt.length > CHROOT_DIR.length + 1 &&
          t.ckpt.startsWith(CHROOT_DIR + "/") && SAFE_JOB_PATH.test(t.ckpt)) {
        prevCkpt = "/" + t.ckpt.slice(CHROOT_DIR.length + 1); // 宿主 <CHROOT_DIR>/.jobs/<id>.ckpt → chroot 内 /.jobs/<id>.ckpt
        notes.push("上一轮 ckpt: " + t.ckpt + " → 已注入 $DSH_TASK_PREV_CKPT=" + prevCkpt + "（是否续由脚本自行决定）");
      }
      // 既有 chroot 后台启动路径原样重跑（D3 resume=重跑）；shell 未登记，用工具默认 bash
      //（buildChrootScript 内置 bash→sh 自动回退）。upsert 带 resumed_from（D3 断点 linkage）。
      const r = await startChrootJob(command, "bash", notes, { resumed_from: id }, prevCkpt || undefined);
      if (!r.ok) {
        return { ok: false, error: r.stderr || r.error || "重跑启动失败", requested_id: id, notes: r.notes };
      }
      return { ok: true, requested_id: id, task_id: r.job_id, resumed_from: id, state: "RUNNING", notes: r.notes };
    }
  }));

  // 未授予 root 且未授予 Shizuku 时：不注册下面这些系统操作工具（android_package 等），
  // AI 工具列表里没有特权工具，就不会反复尝试系统操作；
  // 此时文件读写用 DSH 自带的 fs/bash 工具（只需所有文件访问权限）。
  if (!privilegedAvailable()) return;

  // 0) 设备与环境感知（批次 9b / #28）：只读聚合，单次 su 往返，目标 <500ms
  ctx.tools.register(defineTool({
    name: "android_device_info",
    description:
      "读取设备与环境状态快照（只读、无副作用）：电池（电量/是否充电/温度）、音量（媒体/铃声/闹钟）、" +
      "屏幕亮度与息屏超时、存储（/sdcard 总量与可用字节）、网络（wifi/cellular/none + 链路速度/RSSI，" +
      "出于隐私不采集 SSID）、前台应用（包名/activity）、开机时长、机型与系统版本。" +
      "单次聚合调用（一次特权通道往返，通常 100-500ms），适合回答「现在什么状态」「电量多少」" +
      "「屏幕多亮」等场景。个别字段拿不到时该字段省略，不做臆造。",
    parameters: {
      timeout_ms: { type: "number", description: "超时毫秒数（默认 8000，上限 30000）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          elapsedMs: { type: "number" },
          battery: {
            type: "object", additionalProperties: false,
            properties: {
              level: { type: "number" },
              charging: { type: "boolean" },
              temperature: { type: "number" }
            }
          },
          volume: {
            type: "object", additionalProperties: false,
            properties: {
              music: { type: "number" },
              ring: { type: "number" },
              alarm: { type: "number" }
            }
          },
          brightness: {
            type: "object", additionalProperties: false,
            properties: { value: { type: "number" }, timeoutMs: { type: "number" } }
          },
          storage: {
            type: "object", additionalProperties: false,
            properties: { sdcardTotal: { type: "number" }, sdcardFree: { type: "number" } }
          },
          network: {
            type: "object", additionalProperties: false,
            properties: { type: { type: "string", enum: ["wifi", "cellular", "none"] }, detail: { type: "string" } }
          },
          foreground: {
            type: "object", additionalProperties: false,
            properties: { package: { type: "string" }, activity: { type: "string" } }
          },
          uptimeMs: { type: "number" },
          device: {
            type: "object", additionalProperties: false,
            properties: {
              model: { type: "string" },
              androidVersion: { type: "string" },
              apiLevel: { type: "number" }
            }
          }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return [{ type: "text", text: "设备信息读取失败：" + (v.error || "未知错误") }];
        const L = ["设备状态快照" + (typeof v.elapsedMs === "number" ? "（耗时 " + v.elapsedMs + "ms）" : "") + "："];
        if (v.battery) L.push("- 电池: " + v.battery.level + "%" +
          (typeof v.battery.temperature === "number" ? "，" + v.battery.temperature + "℃" : "") +
          (v.battery.charging ? "，充电中" : "，未充电"));
        if (v.volume) L.push("- 音量: 媒体 " + v.volume.music + " / 铃声 " + v.volume.ring + " / 闹钟 " + v.volume.alarm);
        if (v.brightness) L.push("- 亮度: " + v.brightness.value + "（settings 原始值 0-255），息屏超时 " +
          Math.round((v.brightness.timeoutMs || 0) / 60000) + " 分钟");
        if (v.storage) L.push("- 存储(/sdcard): 总 " + (v.storage.sdcardTotal / 1073741824).toFixed(1) + " GiB，可用 " +
          (v.storage.sdcardFree / 1073741824).toFixed(1) + " GiB");
        if (v.network) L.push("- 网络: " + v.network.type + "（" + v.network.detail + "）");
        if (v.foreground) L.push("- 前台: " + v.foreground.package + " / " + v.foreground.activity);
        if (typeof v.uptimeMs === "number") L.push("- 开机: " + (v.uptimeMs / 3600000).toFixed(1) + " 小时");
        if (v.device) L.push("- 机型: " + v.device.model + "，Android " + v.device.androidVersion + "（API " + v.device.apiLevel + "）");
        return [{ type: "text", text: L.join("\n") }];
      }
    },
    async execute(args, exec) {
      const t0 = Date.now();
      const timeoutMs = Math.max(1000, Math.min(Number(args.timeout_ms) || 8000, 30000));
      const r = await privCmd(buildDeviceInfoScript(), timeoutMs);
      if (!r.ok) {
        return {
          ok: false, error: "聚合采集失败: " + (r.error || r.stderr || "exit=" + r.exit_code),
          elapsedMs: Date.now() - t0
        };
      }
      const parsed = parseDeviceInfoOutput(r.stdout);
      if (!Object.keys(parsed).length) {
        return { ok: false, error: "采集输出为空或无法解析", elapsedMs: Date.now() - t0 };
      }
      return { ok: true, elapsedMs: Date.now() - t0, ...parsed };
    }
  }));

  // 0b) 最近一次定位缓存（批次 9b / #28 简单版）：只读 last-known fix，不触发新定位、不持续监听
  ctx.tools.register(defineTool({
    name: "android_location",
    description:
      "读取手机的**最近一次定位缓存**（last-known fix）：返回经度/纬度/精度与来源 provider（fused/gps/network）。" +
      "隐私说明：仅读取系统已有缓存，不触发新的定位、不做持续监听，坐标仅在本机对话中使用；" +
      "请在用户明确询问位置时才调用。location 服务关闭时返回 available:false（reason=LOCATION_OFF）；" +
      "服务开启但无任何缓存 fix 时返回 available:false（reason=NO_FIX）。",
    parameters: {
      timeout_ms: { type: "number", description: "超时毫秒数（默认 8000，上限 30000）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          available: { type: "boolean" },
          reason: { type: "string" },
          source: { type: "string" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          accuracy: { type: "number" },
          elapsedMs: { type: "number" }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return [{ type: "text", text: "定位读取失败：" + (v.error || "未知错误") }];
        if (!v.available) {
          const why = v.reason === "LOCATION_OFF" ? "location 服务已关闭（系统设置里未开启定位）"
            : v.reason === "NO_FIX" ? "location 服务开启，但没有任何 provider 的缓存定位（近期未定位过）"
            : (v.reason || "无可用定位");
          return [{ type: "text", text: "暂无可用位置：" + why + "。" }];
        }
        return [{
          type: "text",
          text: "最近一次定位缓存（" + (v.source || "unknown") +
            (typeof v.accuracy === "number" ? "，精度约 " + v.accuracy + "m" : "") +
            "）：lat=" + v.latitude + ", lon=" + v.longitude +
            "（注意：这是缓存值，可能不是当前位置）"
        }];
      }
    },
    async execute(args, exec) {
      const t0 = Date.now();
      const timeoutMs = Math.max(1000, Math.min(Number(args.timeout_ms) || 8000, 30000));
      const r = await privCmd(buildLocationScript(), timeoutMs);
      if (!r.ok) {
        return {
          ok: false, error: "定位状态采集失败: " + (r.error || r.stderr || "exit=" + r.exit_code),
          elapsedMs: Date.now() - t0
        };
      }
      const { locOn, fix } = parseLocationOutput(r.stdout);
      if (!locOn) {
        return { ok: true, available: false, reason: "LOCATION_OFF", elapsedMs: Date.now() - t0 };
      }
      if (!fix) {
        return { ok: true, available: false, reason: "NO_FIX", elapsedMs: Date.now() - t0 };
      }
      return { ok: true, available: true, elapsedMs: Date.now() - t0, ...fix };
    }
  }));

  // 1) 通讯与个人信息只读查询（批次 10c / #29）：root content query，只读无写入
  ctx.tools.register(defineTool({
    name: "android_sms",
    description:
      "读取手机收件箱短信（root 特权通道 content query，只读）：返回发件人号码、正文、时间（ISO）、类型，按时间倒序。" +
      "可用于「刚收到的验证码是多少」「查一下某人的短信」等。仅本机使用、读取系统通讯数据，" +
      "不提供发送/删除/写入能力；短信正文属高敏隐私，请在用户明确要求时才调用。" +
      "无短信数据时如实返回 count=0；provider 拒绝时返回 reason=PROVIDER_ERROR。",
    parameters: {
      limit: { type: "number", description: "返回条数上限（默认 20，最大 100，按时间倒序取最新 N 条）" },
      address: { type: "string", description: "可选，按发件人号码过滤" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          reason: { type: "string" },
          count: { type: "number" },
          elapsedMs: { type: "number" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                address: { type: "string" },
                body: { type: "string" },
                date: { type: "string" },
                type: { type: "string" }
              }
            }
          }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return [{ type: "text", text: "短信读取失败：" + (v.error || "未知错误") }];
        if (!v.count) return [{ type: "text", text: "收件箱没有短信（如实返回，未做臆造）。" }];
        const lines = v.items.map((it, i) =>
          (i + 1) + ". " + (it.date || "时间未知") + " " + it.address + "（" + (it.type || "?") + "）：" +
          (it.body ? it.body.slice(0, 50) : "（空）"));
        return [{ type: "text", text: "收件箱最近 " + v.count + " 条短信（耗时 " + v.elapsedMs + "ms）：\n" + lines.join("\n") }];
      }
    },
    async execute(args, exec) {
      const t0 = Date.now();
      const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));
      const addr = cleanQueryText(args.address);
      let extra = "--sort " + shq("date DESC");
      if (addr) extra += " --where " + shq("address='" + addr + "'");
      const r = await contentQuery("content://sms/inbox", ["address", "body", "date", "type"], extra, 8000);
      if (!r.ok) {
        return {
          ok: false, reason: "PROVIDER_ERROR", count: 0, items: [], elapsedMs: Date.now() - t0,
          error: "content query 失败: " + (r.error || r.stderr || "exit=" + r.exit_code)
        };
      }
      const rows = parseContentRows(r.stdout, ["address", "body", "date", "type"]).slice(0, limit);
      return {
        ok: true, count: rows.length, elapsedMs: Date.now() - t0,
        items: rows.map((row) => ({
          address: row.address || "",
          body: typeof row.body === "string" ? row.body : "",
          date: msToIso(row.date) || "",
          type: SMS_TYPE[parseInt(row.type, 10)] || String(row.type || "")
        }))
      };
    }
  }));

  ctx.tools.register(defineTool({
    name: "android_calllog",
    description:
      "读取手机通话记录（root 特权通道 content query，只读）：返回号码、联系人名、类型（呼入/呼出/未接等）、" +
      "时间（ISO）、通话时长（秒），按时间倒序。可用于「最近谁打来过」「今天有几个未接电话」等。" +
      "仅本机使用、读取系统通讯数据，不提供删除/写入能力；通话记录属高敏隐私，请在用户明确要求时才调用。" +
      "无通话记录时如实返回 count=0；provider 拒绝时返回 reason=PROVIDER_ERROR。",
    parameters: {
      limit: { type: "number", description: "返回条数上限（默认 20，最大 100，按时间倒序取最新 N 条）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          reason: { type: "string" },
          count: { type: "number" },
          elapsedMs: { type: "number" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                number: { type: "string" },
                name: { type: "string" },
                type: { type: "string" },
                date: { type: "string" },
                duration: { type: "number" }
              }
            }
          }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return [{ type: "text", text: "通话记录读取失败：" + (v.error || "未知错误") }];
        if (!v.count) return [{ type: "text", text: "没有通话记录（如实返回，未做臆造）。" }];
        const lines = v.items.map((it, i) =>
          (i + 1) + ". " + (it.date || "时间未知") + " " + (it.number || "(未知号码)") +
          (it.name ? "（" + it.name + "）" : "") + " " + (it.type || "?") +
          (it.duration > 0 ? " " + it.duration + "s" : ""));
        return [{ type: "text", text: "最近 " + v.count + " 条通话记录（耗时 " + v.elapsedMs + "ms）：\n" + lines.join("\n") }];
      }
    },
    async execute(args, exec) {
      const t0 = Date.now();
      const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));
      const r = await contentQuery("content://call_log/calls",
        ["number", "name", "type", "date", "duration"], "--sort " + shq("date DESC"), 8000);
      if (!r.ok) {
        return {
          ok: false, reason: "PROVIDER_ERROR", count: 0, items: [], elapsedMs: Date.now() - t0,
          error: "content query 失败: " + (r.error || r.stderr || "exit=" + r.exit_code)
        };
      }
      const rows = parseContentRows(r.stdout, ["number", "name", "type", "date", "duration"]).slice(0, limit);
      return {
        ok: true, count: rows.length, elapsedMs: Date.now() - t0,
        items: rows.map((row) => ({
          number: row.number || "",
          name: row.name || "",
          type: CALLLOG_TYPE[parseInt(row.type, 10)] || String(row.type || ""),
          date: msToIso(row.date) || "",
          duration: Number.isFinite(parseInt(row.duration, 10)) ? parseInt(row.duration, 10) : 0
        }))
      };
    }
  }));

  ctx.tools.register(defineTool({
    name: "android_contacts",
    description:
      "读取手机通讯录（root 特权通道 content query，只读）：默认按名字模糊过滤（SQL LIKE）列出联系人" +
      "（_id/显示名/是否有号码）；传 detail=联系人 _id 时返回该联系人的电话号码列表。" +
      "可用于「查一下张三的电话」。仅本机使用、读取系统通讯数据，不提供增删改；" +
      "联系人姓名/号码属高敏隐私，请在用户明确要求时才调用。" +
      "无匹配时如实返回 count=0；provider 拒绝时返回 reason=PROVIDER_ERROR。",
    parameters: {
      query: { type: "string", description: "名字模糊过滤关键字（SQL LIKE 包裹 % 匹配，可选）" },
      detail: { type: "string", description: "联系人 _id（列表结果里的 _id）：传入时返回该联系人的电话号码，不再做列表查询" },
      limit: { type: "number", description: "列表条数上限（默认 20，最大 100）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          reason: { type: "string" },
          count: { type: "number" },
          contact_id: { type: "string" },
          elapsedMs: { type: "number" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                _id: { type: "string" },
                display_name: { type: "string" },
                has_phone_number: { type: "boolean" }
              }
            }
          },
          phones: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                number: { type: "string" },
                label: { type: "string" }
              }
            }
          }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return [{ type: "text", text: "通讯录读取失败：" + (v.error || "未知错误") }];
        if (v.phones) {
          if (!v.phones.length) return [{ type: "text", text: "联系人 " + v.contact_id + " 没有登记电话号码。" }];
          const lines = v.phones.map((p, i) => (i + 1) + ". " + p.number + "（" + (p.label || "OTHER") + "）");
          return [{ type: "text", text: "联系人 " + v.contact_id + " 的电话（耗时 " + v.elapsedMs + "ms）：\n" + lines.join("\n") }];
        }
        if (!v.count) return [{ type: "text", text: "通讯录没有匹配的联系人（如实返回，未做臆造）。" }];
        const lines = v.items.map((it, i) =>
          (i + 1) + ". " + (it.display_name || "(无名)") + " _id=" + it._id +
          (it.has_phone_number ? "（有号码）" : "（无号码）"));
        return [{ type: "text", text: "通讯录匹配 " + v.count + " 人（耗时 " + v.elapsedMs + "ms）：\n" + lines.join("\n") }];
      }
    },
    async execute(args, exec) {
      const t0 = Date.now();
      // detail：按 _id 查该联系人的电话号码（data 表 phone_v2 mimetype）
      const detailId = String(args.detail == null ? "" : args.detail).trim();
      if (detailId) {
        if (!/^\d+$/.test(detailId)) {
          return {
            ok: false, reason: "INVALID_ARGUMENT", count: 0, items: [], phones: [],
            elapsedMs: Date.now() - t0, error: "detail 须为联系人 _id（纯数字，来自列表结果的 _id 字段）"
          };
        }
        const where = "contact_id=" + detailId + " AND mimetype='vnd.android.cursor.item/phone_v2'";
        const r = await contentQuery("content://com.android.contacts/data", ["data1", "data2"],
          "--where " + shq(where), 8000);
        if (!r.ok) {
          return {
            ok: false, reason: "PROVIDER_ERROR", contact_id: detailId, count: 0, items: [], phones: [],
            elapsedMs: Date.now() - t0,
            error: "content query 失败: " + (r.error || r.stderr || "exit=" + r.exit_code)
          };
        }
        const rows = parseContentRows(r.stdout, ["data1", "data2"]);
        return {
          ok: true, contact_id: detailId, count: rows.length, items: [], elapsedMs: Date.now() - t0,
          phones: rows.map((row) => ({
            number: row.data1 || "",
            label: PHONE_TYPE[parseInt(row.data2, 10)] || String(row.data2 || "OTHER")
          }))
        };
      }
      // 列表：名字模糊过滤（SQL LIKE）
      const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));
      const q = cleanQueryText(args.query);
      const extra = q ? "--where " + shq("display_name LIKE '%" + q + "%'") : "";
      const r = await contentQuery("content://com.android.contacts/contacts",
        ["_id", "display_name", "has_phone_number"], extra, 8000);
      if (!r.ok) {
        return {
          ok: false, reason: "PROVIDER_ERROR", count: 0, items: [], phones: [], elapsedMs: Date.now() - t0,
          error: "content query 失败: " + (r.error || r.stderr || "exit=" + r.exit_code)
        };
      }
      const rows = parseContentRows(r.stdout, ["_id", "display_name", "has_phone_number"]).slice(0, limit);
      return {
        ok: true, count: rows.length, phones: [], elapsedMs: Date.now() - t0,
        items: rows.map((row) => ({
          _id: String(row._id == null ? "" : row._id),
          display_name: row.display_name || "",
          has_phone_number: row.has_phone_number === "1"
        }))
      };
    }
  }));

  // 2) 包管理
  ctx.tools.register(defineTool({
    name: "android_package",
    description:
      "Android 包管理：列出已安装应用、安装 APK、卸载应用、清除应用数据、授予/撤销运行时权限。" +
      "底层走 pm 命令（root su 或 Shizuku 特权通道）。" +
      "批次 8a（采纳上游 v1.11.0）：安装走会话式 install-create/write/commit + 严格校验输出含 Success + 可选 pm path 二次校验（传 package 参数启用），失败如实报告（单发 pm install 在部分 ROM 会失败仍 exit=0 的假成功不再出现）。" +
      "部分 ColorOS 机型安装可能报 binder 限制，失败时提示用户手动安装。",
    parameters: {
      action: {
        type: "string", required: true,
        enum: ["list", "install", "uninstall", "clear", "grant", "revoke"],
        description: "操作类型：list=列出应用；install=安装APK(需apk_path)；uninstall=卸载(需package)；clear=清数据(需package)；grant/revoke=授权/撤销(需package+permission)"
      },
      package: { type: "string", description: "包名，如 com.example.app" },
      apk_path: { type: "string", description: "install 时的 APK 绝对路径" },
      permission: { type: "string", description: "grant/revoke 时的权限名，如 android.permission.CAMERA" },
      third_party_only: { type: "boolean", description: "list 时是否只列第三方应用" },
      filter: { type: "string", description: "list 时按关键字过滤包名" }
    },
    output: { schema: resultSchema(), render: (_a, v) => renderResult(v) },
    async execute(args, exec) {
      await maybeApprove(ctx, exec, "android_package", args.action, args.package || args.apk_path || args.permission || "");
      const a = safe(args.action);
      const pkg = safe(args.package);
      const apk = safe(args.apk_path);
      const perm = safe(args.permission);
      let cmd = "";
      switch (a) {
        case "list":
          cmd = "pm list packages" + (args.third_party_only ? " -3" : "") +
                (args.filter ? " | grep " + safe(args.filter) : "");
          break;
        case "install":
          // 批次 8a：会话式安装 + Success 校验 + 可选 pm path 二次校验（上游 v1.11.0 方案）
          if (!apk) throw new Error("install 需要 apk_path");
          return await sessionInstall(apk, pkg || "", 120000);
        case "uninstall": cmd = "pm uninstall " + pkg; break;
        case "clear": cmd = "pm clear " + pkg; break;
        case "grant": cmd = "pm grant " + pkg + " " + perm; break;
        case "revoke": cmd = "pm revoke " + pkg + " " + perm; break;
        default: throw new Error("未知 action: " + a);
      }
      return await privCmd(cmd, 60000);
    }
  }));

  // 2) 应用管理
  ctx.tools.register(defineTool({
    name: "android_app",
    description: "Android 应用管理：启动应用、强制停止应用、查看当前前台应用。后台虚拟屏开关开启时，launch 会自动在虚拟屏执行，用户无需额外指定；不要用 shizuku_shell 的 am start/monkey 绕过该路由。底层走 am/dumpsys（root su 或 Shizuku 特权通道）。",
    parameters: {
      action: {
        type: "string", required: true,
        enum: ["launch", "force_stop", "current"],
        description: "launch=启动应用(需package)；force_stop=强制停止(需package)；current=查看当前前台应用"
      },
      package: { type: "string", description: "目标包名" },
      activity: { type: "string", description: "launch 时指定 activity 组件名（可选，留空自动用 launcher 入口）" }
    },
    output: { schema: resultSchema(), render: (_a, v) => renderResult(v) },
    async execute(args, exec) {
      await maybeApprove(ctx, exec, "android_app", args.action, args.package || "");
      const a = safe(args.action);
      const pkg = safe(args.package);
      if (isVscreenModeEnabled(ctx) && a === "launch") {
        if (!pkg) {
          return {
            ok: false, exit_code: -1, stdout: "",
            stderr: "launch 动作需要 package 参数",
            error: "missing_package"
          };
        }
        const ensured = await ensureVscreenCreated(ctx);
        if (!ensured.ok) {
          return {
            ok: false, exit_code: -1, stdout: "",
            stderr: (ensured.hint ? `${ensured.error || "创建虚拟屏失败"} — ${ensured.hint}` : (ensured.error || "创建虚拟屏失败")),
            error: ensured.reason || "VSCREEN_CREATE_FAILED"
          };
        }
        const act = args.activity ? safe(args.activity) : "";
        const target = act ? `${pkg}/${act}` : pkg;
        let res = await vscreenBridge("POST", "/vscreen/launch", { packageName: target }, 15000);
        // 批次81-T2-3：会话级失败（守卫态陈旧）→ 清位自愈建屏后重试一次；重试结果替换 res 后统一走下方映射
        if (!res.unreachable && (!res.json || res.json.ok !== true)) {
          const retried = await vscreenRetryAfterSessionLoss(
            ctx, res, () => vscreenBridge("POST", "/vscreen/launch", { packageName: target }, 15000));
          if (retried) res = retried;
        }
        if (res.unreachable) {
          const f = vscreenFail(res);
          return {
            ok: false, exit_code: -1, stdout: "",
            stderr: f.hint ? `${f.error} — ${f.hint}` : (f.error || "App 本地桥不可达"),
            error: f.reason || "BRIDGE_UNREACHABLE"
          };
        }
        const b = res.json;
        if (!b || b.ok !== true) {
          const f = vscreenFail(res, "虚拟屏启动应用失败");
          return {
            ok: false, exit_code: -1, stdout: "",
            stderr: f.hint ? `${f.error} — ${f.hint}` : (f.error || "虚拟屏启动应用失败"),
            error: f.reason || "LAUNCH_FAILED"
          };
        }
        return {
          ok: true,
          exit_code: 0,
          stdout: `[vscreen] 已在虚拟屏启动 ${target}（主屏前台不受影响）`,
          stderr: ""
        };
      }
      let cmd = "";
      switch (a) {
        case "launch":
          cmd = args.activity
            ? "am start -n " + pkg + "/" + safe(args.activity)
            : "monkey -p " + pkg + " -c android.intent.category.LAUNCHER 1";
          break;
        case "force_stop": cmd = "am force-stop " + pkg; break;
        case "current": cmd = "dumpsys activity activities | grep -E 'mResumedActivity|mFocusedApp' | head -5"; break;
        default: throw new Error("未知 action: " + a);
      }
      return await privCmd(cmd, 30000);
    }
  }));

  // 3) 系统设置
  ctx.tools.register(defineTool({
    name: "android_setting",
    description: "Android 系统设置读写：settings get/put/list，namespace 为 global/system/secure。改设置影响系统行为，请谨慎。",
    parameters: {
      action: { type: "string", required: true, enum: ["get", "put", "list"], description: "get=读；put=写；list=列出某 namespace 全部" },
      namespace: { type: "string", enum: ["global", "system", "secure"], description: "设置命名空间" },
      key: { type: "string", description: "设置项 key" },
      value: { type: "string", description: "put 时写入的值" }
    },
    output: { schema: resultSchema(), render: (_a, v) => renderResult(v) },
    async execute(args, exec) {
      await maybeApprove(ctx, exec, "android_setting", args.action, (args.namespace || "") + " " + (args.key || "") + (args.value != null ? " = " + args.value : ""));
      const a = safe(args.action);
      const ns = safe(args.namespace);
      const key = safe(args.key);
      const val = safe(args.value);
      let cmd = "";
      switch (a) {
        case "get": cmd = "settings get " + ns + " " + key; break;
        case "put": cmd = "settings put " + ns + " " + key + " " + val; break;
        case "list": cmd = "settings list " + ns; break;
        default: throw new Error("未知 action: " + a);
      }
      return await privCmd(cmd, 30000);
    }
  }));

  // 4) 截图
  ctx.tools.register(defineTool({
    name: "android_screenshot",
    description: "截取当前屏幕，保存为 PNG，返回文件路径。默认存到 /sdcard/DeepSeekHarness/screenshots/。",
    parameters: {
      save_path: { type: "string", description: "可选，完整保存路径；留空自动生成" }
    },
    output: {
      schema: resultSchema({ path: { type: "string" } }),
      render: (_a, v) => [{
        type: "text",
        text: v.ok ? "截图已保存：\n" + v.path : "截图失败：" + (v.error || v.stderr || "未知错误")
      }]
    },
    async execute(args, exec) {
      await maybeApprove(ctx, exec, "android_screenshot", "screenshot", "");
      // 批次82-N2：屏幕熄灭 → 虚拟屏 see 与主屏 screencap 都只会拿到黑帧，如实失败而不是把黑图当成功。
      const screenOn = await appScreenOn();
      if (screenOn === false) {
        return {
          ok: false, exit_code: -1, stdout: "", path: "",
          stderr: SCREEN_OFF_HINT,
          error: "SCREEN_OFF"
        };
      }
      // 只读降级主屏、写操作不静默降级：建屏被拒（如 App 侧「只读任务」硬闸门）时继续走下方主屏 screencap，不返回错误
      let vscreenDegraded = false;
      if (isVscreenModeEnabled(ctx)) {
        const ensured = await ensureVscreenCreated(ctx);
        if (ensured.ok) {
          let res = await vscreenBridge("GET", "/vscreen/see", null, VSCREEN_SEE_TIMEOUT_MS);
          if (!res.binary) {
            // 批次81-T2-3：守卫态陈旧导致的首个 see 失败 → 清位自愈建屏后重试一次；
            // 重试仍失败时保持原硬失败报错（主屏降级只用于建屏被拒的既有路径，不在此扩大）
            const retried = await vscreenRetryAfterSessionLoss(
              ctx, res, () => vscreenBridge("GET", "/vscreen/see", null, VSCREEN_SEE_TIMEOUT_MS));
            if (retried) res = retried;
          }
          if (!res.binary) {
            const f = vscreenFail(res, "虚拟屏截图失败");
            return {
              ok: false, exit_code: -1, stdout: "",
              stderr: f.hint ? `${f.error} — ${f.hint}` : (f.error || "虚拟屏截图失败"),
              error: f.reason || "VSCREEN_SEE_FAILED",
              path: ""
            };
          }
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const path = args.save_path
            ? safe(args.save_path)
            : "/sdcard/DeepSeekHarness/screenshots/vscreen-" + ts + ".png";
          try {
            const slashIdx = path.lastIndexOf("/");
            if (slashIdx > 0) {
              mkdirSync(path.substring(0, slashIdx), { recursive: true });
            }
            writeFileSync(path, res.binary);
          } catch (e) {
            return {
              ok: false, exit_code: -1, stdout: "",
              stderr: "保存虚拟屏截图文件失败: " + String(e && e.message || e),
              error: "write_screenshot_failed",
              path: ""
            };
          }
          return {
            ok: true, exit_code: 0,
            stdout: "[vscreen] 虚拟屏截图已保存至 " + path,
            stderr: "",
            path
          };
        } else {
          vscreenDegraded = true;
        }
      }
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const path = args.save_path
        ? safe(args.save_path)
        : "/sdcard/DeepSeekHarness/screenshots/shot-" + ts + ".png";
      const r = await privCmd("mkdir -p " + path.substring(0, path.lastIndexOf("/")) + "; screencap -p " + path + " && echo __SHOT_OK__", 30000);
      const out = { ...r, path: r.ok ? path : "" };
      if (vscreenDegraded) {
        // 本工具返回结构（resultSchema）无 hint 字段：主屏降级说明只能落在 stdout 上
        out.stdout = (r.stdout || "") + (r.stdout && !r.stdout.endsWith("\n") ? "\n" : "") + VSCREEN_READONLY_FALLBACK_NOTE;
      }
      return out;
    }
  }));

  // 5) 模拟输入
  ctx.tools.register(defineTool({
    name: "android_input",
    description: "模拟用户输入（需特权通道 root/Shizuku）：点击坐标、滑动、输入文本、发送按键事件。用于自动化操作当前屏幕。坐标以屏幕像素为单位。\n" +
      "批次 7（#54）text 动作可靠性：注入前后经无障碍桥做「焦点/IME 预检 + 回读校验」——" +
      "目标未聚焦且输入法未弹出时直接失败（reason=IME_NOT_READY，先 tap 聚焦输入框）；" +
      "注入后回读节点文本，与期望不符时如实返回失败（reason=POSTCONDITION_FAILED），绝不把命令 exit=0 当成功。" +
      "结果看 verified 字段：true=已回读确认写入；false=未确认或失败（看 reason/notes）。" +
      "无障碍桥不可达时跳过校验（reason=BRIDGE_UNREACHABLE，结果未经验证）。\n" +
      "批次 8a（采纳上游 v1.11.0）：注入命令按文本内容自动路由——纯 ASCII 走 input text（空格转 %s）；" +
      "含非 ASCII（中文/emoji 等）自动改走「剪贴板写入 + KEYCODE_PASTE(279) 粘贴」（input text 会静默丢弃非 ASCII），" +
      "粘贴完成后自动清空剪贴板；回读校验对两条路均生效。",
    parameters: {
      action: { type: "string", required: true, enum: ["tap", "swipe", "text", "keyevent"], description: "tap=点击；swipe=滑动；text=输入文本；keyevent=按键" },
      x: { type: "number", description: "tap 的 x 坐标 / swipe 起点 x" },
      y: { type: "number", description: "tap 的 y 坐标 / swipe 起点 y" },
      x2: { type: "number", description: "swipe 终点 x" },
      y2: { type: "number", description: "swipe 终点 y" },
      duration: { type: "number", description: "swipe 持续时间(毫秒，默认 300)" },
      text: { type: "string", description: "text 动作要输入的文本" },
      keycode: { type: "number", description: "keyevent 的按键码，如 3=HOME, 4=BACK, 26=POWER" }
    },
    output: {
      schema: resultSchema({
        verified: { type: "boolean" },
        reason: { type: "string" },
        notes: { type: "string" }
      }),
      render: (_a, v) => {
        const lines = renderResult(v);
        const extra = [];
        if (typeof v.verified === "boolean") extra.push("verified: " + v.verified);
        if (v.reason) extra.push("reason: " + v.reason);
        if (v.notes) extra.push("notes: " + v.notes);
        return extra.length
          ? [{ type: "text", text: lines[0].text + (lines[0].text ? "\n" : "") + extra.join("\n") }]
          : lines;
      }
    },
    async execute(args, exec) {
      await maybeApprove(ctx, exec, "android_input", args.action, args.text || "");
      const a = safe(args.action);
      if (isVscreenModeEnabled(ctx)) {
        const ensured = await ensureVscreenCreated(ctx);
        if (!ensured.ok) {
          return {
            ok: false, exit_code: -1, stdout: "",
            stderr: (ensured.hint ? `${ensured.error || "创建虚拟屏失败"} — ${ensured.hint}` : (ensured.error || "创建虚拟屏失败")),
            error: ensured.reason || "VSCREEN_CREATE_FAILED"
          };
        }
        if (a === "tap") {
          const x = Math.round(Number(args.x) || 0);
          const y = Math.round(Number(args.y) || 0);
          let res = await vscreenBridge("POST", "/vscreen/tap", { x, y }, 8000);
          if (res.unreachable || !res.json || res.json.ok !== true) {
            // 批次81-T2-3：会话级失败（守卫态陈旧）→ 清位自愈建屏后重试一次；不可重试时 res 原样保留
            const retried = await vscreenRetryAfterSessionLoss(
              ctx, res, () => vscreenBridge("POST", "/vscreen/tap", { x, y }, 8000));
            if (retried) res = retried;
          }
          if (res.unreachable || !res.json || res.json.ok !== true) {
            const f = vscreenFail(res, "虚拟屏点击失败");
            return { ok: false, exit_code: -1, stdout: "", stderr: f.hint ? `${f.error} — ${f.hint}` : (f.error || "虚拟屏点击失败"), error: f.reason || "VSCREEN_TAP_FAILED" };
          }
          return { ok: true, exit_code: 0, stdout: `[vscreen] 已在虚拟屏点击 (${x}, ${y})`, stderr: "" };
        }
        if (a === "swipe") {
          const x1 = Math.round(Number(args.x) || 0);
          const y1 = Math.round(Number(args.y) || 0);
          const x2 = Math.round(Number(args.x2) || 0);
          const y2 = Math.round(Number(args.y2) || 0);
          const durationMs = Math.round(Number(args.duration) || 300);
          let res = await vscreenBridge("POST", "/vscreen/swipe", { x1, y1, x2, y2, durationMs }, 8000);
          if (res.unreachable || !res.json || res.json.ok !== true) {
            // 批次81-T2-3：会话级失败（守卫态陈旧）→ 清位自愈建屏后重试一次；不可重试时 res 原样保留
            const retried = await vscreenRetryAfterSessionLoss(
              ctx, res, () => vscreenBridge("POST", "/vscreen/swipe", { x1, y1, x2, y2, durationMs }, 8000));
            if (retried) res = retried;
          }
          if (res.unreachable || !res.json || res.json.ok !== true) {
            const f = vscreenFail(res, "虚拟屏滑动失败");
            return { ok: false, exit_code: -1, stdout: "", stderr: f.hint ? `${f.error} — ${f.hint}` : (f.error || "虚拟屏滑动失败"), error: f.reason || "VSCREEN_SWIPE_FAILED" };
          }
          return { ok: true, exit_code: 0, stdout: `[vscreen] 已在虚拟屏滑动 (${x1}, ${y1}) -> (${x2}, ${y2})`, stderr: "" };
        }
        if (a === "text") {
          const text = String(args.text == null ? "" : args.text);
          if (!text) {
            return { ok: false, exit_code: -1, error: "android_input text 需要 text 参数", reason: "INVALID_ARGUMENT" };
          }
          const displayId = ensured.displayId || vscreenDisplayId;
          let r;
          if (PRINTABLE_ASCII.test(text) && displayId != null) {
            r = await privCmd("input -d " + displayId + " " + asciiInputCmd(text), 15000);
          } else {
            const w = await appPost("/clipboard", { action: "write", content: text }, 8000);
            if (!w || !w.ok) {
              return { ok: false, exit_code: -1, stdout: "", stderr: "剪贴板写入失败", error: "clipboard_write_failed" };
            }
            let keyRes = await vscreenBridge("POST", "/vscreen/key", { key: "279" }, 12000);
            if (!keyRes.json || keyRes.json.ok !== true) {
              // 批次81-T2-3：粘贴键被 App 判 NOT_CREATED 时清位自愈建屏，并重放整段
              // 「写剪贴板 → 粘贴 → 清剪贴板」；只重放粘贴键会在剪贴板已清空后粘出空内容却报成功
              const retried = await vscreenRetryAfterSessionLoss(ctx, keyRes, async () => {
                const w2 = await appPost("/clipboard", { action: "write", content: text }, 8000);
                if (!w2 || !w2.ok) return { json: { ok: false, reason: "CLIPBOARD_WRITE_FAILED" } };
                const k2 = await vscreenBridge("POST", "/vscreen/key", { key: "279" }, 12000);
                await appPost("/clipboard", { action: "clear" }, 5000);
                return k2;
              });
              if (retried) keyRes = retried;
            }
            await appPost("/clipboard", { action: "clear" }, 5000);
            const ok = Boolean(keyRes.json && keyRes.json.ok);
            r = { ok, exit_code: ok ? 0 : -1, stdout: ok ? "paste keyevent sent" : "", stderr: ok ? "" : "虚拟屏粘贴按键注入失败" };
          }
          if (!r.ok) {
            return {
              ok: false, exit_code: typeof r.exit_code === "number" ? r.exit_code : -1,
              stdout: r.stdout || "", stderr: r.stderr || "虚拟屏文本注入失败",
              error: "VSCREEN_INPUT_FAILED"
            };
          }
          return {
            ok: true, exit_code: 0,
            stdout: `[vscreen] 文本已注入虚拟屏${displayId != null ? "（displayId: " + displayId + "）" : ""}`,
            stderr: "",
            verified: true,
            notes: "虚拟屏后台隔离模式注入"
          };
        }
        if (a === "keyevent") {
          const key = String(Math.round(Number(args.keycode) || 0));
          let res = await vscreenBridge("POST", "/vscreen/key", { key }, 8000);
          if (res.unreachable || !res.json || res.json.ok !== true) {
            // 批次81-T2-3：会话级失败（守卫态陈旧）→ 清位自愈建屏后重试一次；不可重试时 res 原样保留
            const retried = await vscreenRetryAfterSessionLoss(
              ctx, res, () => vscreenBridge("POST", "/vscreen/key", { key }, 8000));
            if (retried) res = retried;
          }
          if (res.unreachable || !res.json || res.json.ok !== true) {
            const f = vscreenFail(res, "虚拟屏按键注入失败");
            return { ok: false, exit_code: -1, stdout: "", stderr: f.hint ? `${f.error} — ${f.hint}` : (f.error || "虚拟屏按键注入失败"), error: f.reason || "VSCREEN_KEY_FAILED" };
          }
          return { ok: true, exit_code: 0, stdout: `[vscreen] 已向虚拟屏发送按键 ${key}`, stderr: "" };
        }
      }
      if (a === "text") {
        // ---- 批次 7（#54）：特权 text 注入的预检 + 回读校验（复用 a11y 桥 verifyOnly 探针）----
        const text = String(args.text == null ? "" : args.text);
        if (!text) {
          return { ok: false, exit_code: -1, error: "android_input text 需要 text 参数", reason: "INVALID_ARGUMENT" };
        }
        const probe = await a11yGet("/input", { verifyOnly: "1", text }, 8000);
        if (!probe.ok && probe.unreachable) {
          // 预检/回读通道不可用：照常执行（保持旧行为），但如实标注「未经验证」
          const r = await privCmd("input text " + safe(text), 15000);
          return {
            ...r,
            verified: false,
            reason: "BRIDGE_UNREACHABLE",
            notes: "无障碍桥（3181）不可达，无法回读校验本次注入是否真实写入——exit=0 不代表写入成功，建议用 android_screenshot 确认。"
          };
        }
        if (!probe.ok) {
          // App 侧明确说找不到可输入目标：不盲目执行
          return {
            ok: false, exit_code: -1,
            error: "未找到可输入的文本框：" + (probe.error || "未知原因"),
            reason: "TARGET_NOT_FOUND",
            notes: "已通过无障碍桥预检：当前界面没有可输入目标，未执行注入。请先 android_tap 点击目标输入框。"
          };
        }
        const focused = probe.focused === true;
        let imeUp = typeof probe.imeTopY === "number" && probe.imeTopY > 0;
        if (focused && !imeUp) {
          // 焦点已在但键盘未起：可能是刚 tap 完键盘动画中，等 600ms 复测一次；
          // 仍无输入法窗口则视为「stale DOM focus」，注入必然静默丢弃 → 快速失败
          await new Promise((r2) => setTimeout(r2, 600));
          const reprobe = await a11yGet("/input", { verifyOnly: "1", text }, 8000);
          imeUp = reprobe.ok && typeof reprobe.imeTopY === "number" && reprobe.imeTopY > 0;
          if (!imeUp) {
            return {
              ok: false, exit_code: -1,
              error: "输入法未就绪：节点报告了焦点但输入法窗口不在屏（注入会静默丢弃）",
              reason: "IME_NOT_READY",
              notes: "请先用 android_tap 点击目标输入框聚焦并唤起输入法，再重新注入。"
            };
          }
        } else if (!focused && !imeUp) {
          return {
            ok: false, exit_code: -1,
            error: "输入法/焦点未就绪：目标输入框未聚焦且输入法未弹出",
            reason: "IME_NOT_READY",
            notes: "请先用 android_tap 点击目标输入框（聚焦并唤起输入法）后再注入，否则 input text 会静默丢弃。"
          };
        }
        // 批次 8a：注入命令按文本内容自动路由——纯可打印 ASCII 走 input text（空格转 %s，
        // 不再过 safe() 以免删字）；含非 ASCII 改走 3081 /clipboard write + input keyevent 279
        // 粘贴（input text 对非 ASCII 会静默丢弃）。#54 的回读校验对两条路均生效。
        const r = await injectText(text);
        if (!r.ok) return r;
        // 注入后回读校验（App 侧重新定位节点读文本）。App 侧 verified 对 WebView DOM 映射
        // 节点的 isEditable 上报不稳定（同一节点有时 false → contains 放宽失效），故插件侧
        // 补一道与 textMatches(editable→contains) 同语义的兜底：actual contains 期望即算通过。
        const back = await a11yGet("/input", { verifyOnly: "1", text }, 8000);
        const actual0 = back.ok && typeof back.actual === "string" ? back.actual : "";
        const verifiedOk = back.ok && (back.verified === true ||
          (actual0.length > 0 && actual0.includes(text)));
        if (verifiedOk) {
          return {
            ...r,
            verified: true,
            notes: "已回读确认文本真实写入（readback=" + JSON.stringify(actual0.slice(0, 60)) + "）。"
          };
        }
        // 给 WebView 前端一点处理时间（input 事件→DOM 更新），再补一次回读
        await new Promise((r2) => setTimeout(r2, 300));
        const back2 = await a11yGet("/input", { verifyOnly: "1", text }, 8000);
        const actual = back2.ok && typeof back2.actual === "string" ? back2.actual : actual0;
        const verifiedOk2 = back2.ok && (back2.verified === true ||
          (actual.length > 0 && actual.includes(text)));
        if (verifiedOk2) {
          return {
            ...r,
            verified: true,
            notes: "已回读确认文本真实写入（二次回读，readback=" + JSON.stringify(actual.slice(0, 60)) + "）。"
          };
        }
        return {
          ok: false,
          exit_code: typeof r.exit_code === "number" ? r.exit_code : 0,
          stdout: typeof r.stdout === "string" ? r.stdout : "",
          stderr: typeof r.stderr === "string" ? r.stderr : "",
          verified: false,
          reason: "POSTCONDITION_FAILED",
          error: "注入命令 exit=0 但回读校验未通过：目标节点当前文本与期望不符（不得假成功）",
          notes: "回读=" + JSON.stringify(actual.slice(0, 80)) + " / 期望=" + JSON.stringify(text.slice(0, 80)) +
            (actual && !actual.includes(text) ? "（注意：可能被输入法自动纠错改写，或该输入框不接受按键注入）" : "") +
            "。建议改用 android_type（无障碍版，paste:true 走剪贴板粘贴）。"
        };
      }
      let cmd = "";
      switch (a) {
        case "tap": cmd = "input tap " + Math.round(Number(args.x) || 0) + " " + Math.round(Number(args.y) || 0); break;
        case "swipe":
          cmd = "input swipe " + Math.round(Number(args.x) || 0) + " " + Math.round(Number(args.y) || 0) + " " +
                Math.round(Number(args.x2) || 0) + " " + Math.round(Number(args.y2) || 0) + " " +
                Math.round(Number(args.duration) || 300);
          break;
        case "text": cmd = "input text " + safe(args.text); break; // 不可达（上方已处理）：保留以防枚举扩展
        case "keyevent": cmd = "input keyevent " + Math.round(Number(args.keycode) || 0); break;
        default: throw new Error("未知 action: " + a);
      }
      return await privCmd(cmd, 15000);
    }
  }));

  // =========================================================================
  // 批次 24: Dynamic Tool Registry MVP（按前台 app 过滤工具 schema，token 经济）
  // =========================================================================
  const DTR_ALWAYS_ALLOWED = new Set([
    "android_app",
    "android_vscreen_create",
    "android_vscreen_status",
    "android_vscreen_launch",
    "android_vscreen_see",
    "android_vscreen_tap",
    "android_vscreen_swipe",
    "android_vscreen_key",
    "android_vscreen_close",
    "android_see",
    "android_screen",
    "android_screen_refresh",
    "android_screenshot",
    "android_chroot_exec",
    "android_chroot_job",
    "android_task_list",
    "android_task_resume",
    "android_device_info",
    "android_notify",
    "shizuku_shell",
    "shizuku_status",
    "android_a11y_status",
    "android_open_a11y_settings"
  ]);

  const DTR_CATEGORY_RULES = {
    SETTINGS: new Set([
      "android_setting",
      "android_setting_app",
      "android_package",
      "android_app",
      "android_tap",
      "android_type",
      "android_scroll",
      "android_act",
      "android_swipe",
      "android_touch",
      "android_gesture",
      "android_touch_status",
      "android_input",
      "android_clipboard"
    ]),
    MESSAGING: new Set([
      "android_sms",
      "android_contacts",
      "android_calllog",
      "android_tap",
      "android_type",
      "android_scroll",
      "android_act",
      "android_swipe",
      "android_input",
      "android_clipboard",
      "android_notifications"
    ]),
    BROWSER: new Set([
      "android_tap",
      "android_type",
      "android_scroll",
      "android_act",
      "android_swipe",
      "android_touch",
      "android_gesture",
      "android_touch_status",
      "android_input",
      "android_clipboard"
    ])
  };

  function resolveDtrCategory(pkg) {
    if (!pkg || typeof pkg !== "string") return "DEFAULT";
    const lower = pkg.toLowerCase();
    if (lower.includes("settings")) return "SETTINGS";
    if (lower.includes("mms") || lower.includes("messaging") || lower.includes("dialer") || lower.includes("contacts")) return "MESSAGING";
    if (lower.includes("chrome") || lower.includes("browser") || lower.includes("webview")) return "BROWSER";
    return "DEFAULT";
  }

  // 监听 system-prompt/assemble waterfall
  ctx.on("system-prompt/assemble", async (assembly, context, next) => {
    let assembled = await next();
    if (assembled && isVscreenModeEnabled(ctx)) {
      const policyName = "dsh-android:vscreen-mode-policy";
      const policyText = [
        "Android 后台虚拟屏模式已开启。",
        "用户要求打开或启动任何应用时，默认必须调用 android_app 的 launch 动作并传入 package；该工具会自动创建或复用虚拟屏并在其中启动。",
        "禁止改用 shizuku_shell 的 am start/monkey 或其他主屏启动方式；虚拟屏创建或启动失败时，如实报告错误并停止，不得回退到主屏打开目标应用。",
        "普通后台识屏、点击、输入、滑动和截图继续使用现有 android_* 工具，它们会自动绑定当前虚拟屏。",
        "M1 只读悬浮助手或任务明确要求 scope=\"current\" 时，android_screen/android_screen_refresh 必须传 scope=\"current\" 读取真实主屏；不得因虚拟屏模式改读虚拟屏。"
      ].join("");
      const sections = Array.isArray(assembled.sections)
        ? [{ name: policyName, text: policyText }, ...assembled.sections.filter((s) => s.name !== policyName)]
        : assembled.sections;
      assembled = { ...assembled, sections };
    }
    const dtrEnabled = process.env.DSH_DYNAMIC_TOOL_REGISTRY !== "0" && process.env.DSH_DYNAMIC_TOOL_REGISTRY !== "false";
    if (!dtrEnabled || !assembled || !Array.isArray(assembled.tools)) {
      return assembled;
    }

    let fgPkg = "";
    try {
      // 零新增轮询：仅在提示词组装时向 3181 探测当前前台包名（无锁单次 GET，超时 500ms 快速失败）
      const statusRes = await a11yGet("/status", {}, 500);
      if (statusRes && statusRes.ok && typeof statusRes.package === "string") {
        fgPkg = statusRes.package;
      }
    } catch (_e) {
      fgPkg = "";
    }

    if (!fgPkg) {
      // 诚实 fail-open：前台未知时保留全量工具
      return assembled;
    }

    const category = resolveDtrCategory(fgPkg);
    if (category === "DEFAULT") {
      // 未命中特化应用规则时，保持全量
      return assembled;
    }

    const allowedSet = DTR_CATEGORY_RULES[category];
    const initialCount = assembled.tools.length;
    const filteredTools = [];
    for (const t of assembled.tools) {
      const name = t.name;
      // 非 android/shizuku 工具（基础工具）和白名单工具永远保留；其余工具需在特定品类允许集合内
      if (DTR_ALWAYS_ALLOWED.has(name) || (!name.startsWith("android_") && !name.startsWith("shizuku_")) || (allowedSet && allowedSet.has(name))) {
        filteredTools.push(t);
      }
    }

    const pruned = initialCount - filteredTools.length;
    if (pruned > 0) {
      console.log(`[dsh-tool-android] dynamic tool registry: foreground=${fgPkg} category=${category} filtered=${pruned}/${initialCount} tools`);
    }

    return {
      ...assembled,
      tools: filteredTools
    };
  });
}

export {
  apply,
  inject,
  name,
  chrootToolsAvailable,
  maybeApprove,
  getEffectivePermissionMode,
  isDangerousAction,
  requestUserConfirm,
  buildDeviceInfoScript,
  parseDeviceInfoOutput,
  buildLocationScript,
  parseLocationOutput,
  buildContentQueryCmd,
  parseContentRows,
  isVscreenModeEnabled,
  ensureVscreenCreated
};
