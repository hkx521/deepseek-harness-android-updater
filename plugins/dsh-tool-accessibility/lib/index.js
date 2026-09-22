/**
 * 无障碍屏幕助手插件（v1.7）：给 AI 提供「读屏 + 操作屏幕 + 屏幕截图理解」能力。
 * 与 App 侧 AccessibilityService 通过本地 HTTP（APP_A11Y_PORT，默认 3181）通信。
 * 用户需在系统设置 → 无障碍开启「DeepSeek Harness 屏幕助手」，未开启时返回引导文案。
 *
 * 注意：DSH 工具输出校验为 additionalProperties:false——execute 返回的每个字段
 * 都必须在 output.schema 中显式声明，否则结果会被判定为非法输出（历史踩坑）。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { get as httpGet, request as httpRequest, Agent } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";

const name = "tool-accessibility";
const inject = ["tools"];

/** 批次 7 keep-alive：与 3081/3181 本地桥的连接复用同一共享 Agent（进程生命周期内保持），
 *  免去每次工具调用重建 TCP 连接的开销（配合 App 侧桥服务的 keep-alive 支持）。 */
const bridgeAgent = new Agent({ keepAlive: true, maxSockets: 4 });

const a11yPort = () => parseInt(process.env.APP_A11Y_PORT || "3181", 10);

/** 本地桥接鉴权 token（MainActivity 注入 env APP_LOCAL_TOKEN；App 侧校验 X-DSH-Token 头）。
 *  token 为空时不加头，兼容未注入 token 的旧版 App。 */
const appLocalToken = () => process.env.APP_LOCAL_TOKEN || "";

function authHeaders(extra) {
  const t = appLocalToken();
  const h = extra ? { ...extra } : {};
  if (t) h["X-DSH-Token"] = t;
  return h;
}

// ---------------------------------------------------------------------------
// 屏幕快照缓存（v1.8.4 阶段 3，借鉴 DroidRun「感知一次、多次使用」）：
// android_screen 的 /dump 结果缓存 10 秒，android_tap 按文字/描述点击时优先用缓存
// 解析坐标直接点，不再让 App 端每次都重新 dump 整棵控件树 ——「读屏→点→读屏→点」
// 压缩为「读屏→点→点」，显著减少感知轮次。stale 超过 DUMP_CACHE_TTL_MS 后自动刷新。
// ---------------------------------------------------------------------------
const DUMP_CACHE_TTL_MS = 10000;
let dumpCache = { at: 0, ok: false, value: null, version: 0, displayId: null };

function validDisplayId(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function sameDisplayId(a, b) {
  return validDisplayId(a) === validDisplayId(b);
}

/** 屏幕读取范围：缺省 auto 保持既有虚拟屏透明路由；current 固定用户主屏。 */
function normalizeScreenScope(value) {
  return value === "current" ? "current" : "auto";
}

/** 批次10a B9-②：仅接受有限数字。DSH 内核按 lossless JSON 校验工具输出
 *  （dsh-util-values：Number.isFinite 且非 -0，NaN/Infinity 一律判非法），
 *  而 JSON 解析 `1e999` 会得到 Infinity、计算可能产生 NaN——所有从 App 侧
 *  透传/计算的数值字段必须过这道护栏：非法值兜底为 fallback（通常 0 或省略）。 */
function finiteNum(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 归一化 /dump 返回（与 android_screen 的输出字段一致，另加 fx/fy 分数坐标）。 */
function normalizeDump(v) {
  const nodes = Array.isArray(v.nodes) ? v.nodes.map((n) => ({
    text: typeof n.text === "string" ? n.text : "",
    desc: typeof n.desc === "string" ? n.desc : "",
    cls: typeof n.cls === "string" ? n.cls : "",
    // 批次6：viewId 资源名（复合定位最高优先级；旧版 App 无此字段时为空串）
    vid: typeof n.vid === "string" ? n.vid : "",
    x: finiteNum(n.x, 0),
    y: finiteNum(n.y, 0),
    w: finiteNum(n.w, 0),
    h: finiteNum(n.h, 0),
    clickable: n.clickable === true,
    input: n.input === true,
    checked: n.checked === true,
    selected: n.selected === true,
    scrollable: n.scrollable === true,
    depth: finiteNum(n.depth, 0)
  })) : [];
  return {
    ok: true,
    package: v.package || "",
    count: nodes.length,
    truncated: v.truncated === true,
    ...(typeof v.hint === "string" && v.hint ? { hint: v.hint } : {}),
    nodes
  };
}

/** #55 条件 /dump：带 if_version 请求 App 侧 ScreenState——屏幕未变化时 App 免全量遍历，
 *  直接返回 {changed:false, version, cached:true, nodes:[]}，此处优先复用本地快照（含 fx/fy）；
 *  有变化时取回全量新快照（changed:true, cached:false, version=N）并更新本地缓存。
 *  旧版 App 不认识 if_version，会当普通全量 dump 返回（无 changed 字段 → 按 changed:true 处理，
 *  version 缺失 → version 记 0，后续不再发条件请求）。 */
async function conditionalDump(ifVersion, displayId = null) {
  const params = { if_version: String(Math.floor(ifVersion)) };
  const dId = validDisplayId(displayId);
  if (dId !== null) params.displayId = String(dId);
  const raw = await a11yRequest("/dump", params, 8000);
  const v = parseResult(raw);
  if (!v.ok) {
    const reason = failReason(raw, v) || "BRIDGE_UNREACHABLE";
    return { ok: false, error: typeof v.error === "string" && v.error ? v.error : GUIDE_TEXT, reason };
  }
  const ver = finiteNum(v.version, 0);
  if (v.changed === false && v.cached === true) {
    // App 侧确认屏幕未变：优先复用本地快照，否则按规范返回占位空集（nodes:[] + version）
    if (dumpCache.ok && dumpCache.version === ver && sameDisplayId(dumpCache.displayId, dId)) {
      dumpCache.at = Date.now();
      return { ...dumpCache.value, cached: true, changed: false };
    }
    return {
      ok: true,
      changed: false,
      cached: true,
      version: ver,
      package: v.package || "",
      count: 0,
      truncated: false,
      nodes: []
    };
  }
  const value = normalizeDump(v);
  if (ver > 0) value.version = ver;
  dumpCache = { at: Date.now(), ok: true, value, version: ver, displayId: dId };
  return { ...value, changed: true, cached: false };
}

/** fx/fy：相对屏幕分数坐标（以最大 x+w 为屏宽估计，免疫截图缩放误差）。
 *  批次10a B9-②：所有进入输出的节点都必须带有限 fx/fy——条件 dump 取回的新快照
 *  以前不算 fx/fy，uiHint 会写出 undefined 属性，被内核 lossless 校验拒绝。 */
function attachFractionalCoords(value, metrics) {
  // 批次75：分数基准优先用「目标屏真实尺寸」（/display-info）。
  // 旧实现用「最大的 x+w / y+h」当屏幕尺寸——当树里没有铺满全屏的节点时，
  // 基准会小于真实屏幕，fx/fy 被整体放大，语义定位换算出的坐标随之偏移。
  let screenW = 0, screenH = 0;
  const realW = metrics && metrics.width > 0 ? metrics.width : 0;
  const realH = metrics && metrics.height > 0 ? metrics.height : 0;
  if (realW > 0) screenW = realW;
  if (realH > 0) screenH = realH;
  for (const n of value.nodes) {
    if (screenW <= 0 && n.x + n.w > screenW) screenW = n.x + n.w;
    if (screenH <= 0 && n.y + n.h > screenH) screenH = n.y + n.h;
  }
  for (const n of value.nodes) {
    n.fx = screenW > 0 ? Math.round(((n.x + n.w / 2) / screenW) * 1000) / 1000 : 0;
    n.fy = screenH > 0 ? Math.round(((n.y + n.h / 2) / screenH) * 1000) / 1000 : 0;
  }
  return value;
}

/** 取屏幕快照：缓存新鲜（<TTL）直接复用；force 或过期时重新 /dump。
 *  #55：重新 /dump 时带上次 version 做条件请求（if_version），App 侧确认屏幕未变时
 *  免全量遍历直接复用本地快照；有变化则取回新快照并更新 version。 */
async function getScreenSnapshot(force, displayId = null) {
  const dId = validDisplayId(displayId);
  if (!force && dumpCache.ok && Date.now() - dumpCache.at < DUMP_CACHE_TTL_MS) {
    if (sameDisplayId(dumpCache.displayId, dId)) {
      return { ...dumpCache.value, cached: true };
    }
  }
  if (dumpCache.ok && dumpCache.version > 0) {
    const cv = await conditionalDump(dumpCache.version, dId);
    if (cv.ok) {
      // changed:false → 已复用快照（带 fx/fy，重算幂等）；changed:true → 新快照需补算 fx/fy
      attachFractionalCoords(cv, await displayMetrics(dId));
      return cv;
    }
    // 条件请求失败（桥不可达等）→ 清缓存，落到普通 /dump 重试
  }
  const params = dId === null ? undefined : { displayId: String(dId) };
  const raw = await a11yRequest("/dump", params, 8000);
  const v = parseResult(raw);
  if (!v.ok) {
    dumpCache = { at: 0, ok: false, value: null, version: 0, displayId: dId };
    // #57：读屏失败标注 reason（桥不可达 → BRIDGE_UNREACHABLE）
    const reason = failReason(raw, v) || "BRIDGE_UNREACHABLE";
    return { ok: false, error: typeof v.error === "string" && v.error ? v.error : GUIDE_TEXT, reason };
  }
  const value = normalizeDump(v);
  const ver = finiteNum(v.version, 0);
  if (ver > 0) value.version = ver;
  attachFractionalCoords(value, await displayMetrics(dId));
  dumpCache = { at: Date.now(), ok: true, value, version: ver, displayId: dId };
  return value;
}

/** 强制读取用户主屏真实前台窗口，不创建/读取虚拟屏，也不读写插件快照缓存。 */
async function getCurrentScreenSnapshot(extraParams = {}) {
  const params = { ...extraParams, displayId: "0", exclude_self: "1" };
  const raw = await a11yRequest("/dump", params, 8000);
  const v = parseResult(raw);
  if (!v.ok) {
    const reason = typeof v.reason === "string" && v.reason
      ? v.reason
      : (v.error === "NO_ACCESSIBILITY_READABLE_WINDOW" ? v.error : (failReason(raw, v) || "BRIDGE_UNREACHABLE"));
    return { ok: false, error: typeof v.error === "string" && v.error ? v.error : GUIDE_TEXT, reason };
  }
  const value = normalizeDump(v);
  const ver = finiteNum(v.version, 0);
  if (ver > 0) value.version = ver;
  attachFractionalCoords(value, await displayMetrics(0));
  return value;
}

/** 从快照里按 viewId/文字/描述找控件（批次6 复合定位打分）：
 *  优先级 viewId（精确匹配）> text(contains) > desc(contains)，同优先级内可点击项胜出，
 *  多候选时「在屏幕内且尺寸为正」者加权。命中返回中心坐标（像素 + 分数）。 */
function findNodeInSnapshot(snap, text, desc, vid) {
  if (!snap || !snap.ok) return null;
  const wantText = (text || "").toLowerCase();
  const wantDesc = (desc || "").toLowerCase();
  const wantVid = (vid || "").trim().toLowerCase();
  if (!wantText && !wantDesc && !wantVid) return null;
  let best = null;
  let bestRank = -1;
  for (const n of snap.nodes) {
    const hay = (n.text + " " + n.desc).toLowerCase();
    let rank = -1;
    if (wantVid && typeof n.vid === "string" &&
        (n.vid.toLowerCase() === wantVid || n.vid.toLowerCase().endsWith(":" + wantVid) ||
         n.vid.toLowerCase().endsWith("/" + wantVid))) {
      rank = 3; // viewId 精确匹配：最高优先
    } else if (wantText && hay.includes(wantText)) {
      rank = 2;
    } else if (wantDesc && hay.includes(wantDesc)) {
      rank = 1;
    }
    if (rank < 0) continue;
    // 加权：可点击 +2；在屏幕内且尺寸为正 +1（可见性加权）
    if (n.clickable) rank += 2;
    if (n.w > 0 && n.h > 0) rank += 1;
    if (!best || rank > bestRank) {
      best = n;
      bestRank = rank;
    }
  }
  if (!best) return null;
  const cx = Math.round(best.x + best.w / 2);
  const cy = Math.round(best.y + best.h / 2);
  // 批次75：优先沿用快照阶段按「目标屏真实尺寸」算好的 fx/fy——两处各算一套会引入偏差。
  const hasFx = typeof best.fx === "number" && Number.isFinite(best.fx);
  const hasFy = typeof best.fy === "number" && Number.isFinite(best.fy);
  const sw = Math.max(...snap.nodes.map((n) => n.x + n.w), 1);
  const sh = Math.max(...snap.nodes.map((n) => n.y + n.h), 1);
  return {
    node: best,
    cx,
    cy,
    fx: hasFx ? best.fx : Math.round((cx / sw) * 1000) / 1000,
    fy: hasFy ? best.fy : Math.round((cy / sh) * 1000) / 1000
  };
}

// ---------------------------------------------------------------------------
// 循环防护（v1.8.4 阶段 4，借鉴 DroidRun 的 stuck-loop 检测）：
// 记录最近 8 次动作签名，连续重复 ≥3 次时在返回体加 warning，提示模型换策略。
// ---------------------------------------------------------------------------
const ACTION_HISTORY_MAX = 8;
const actionHistory = [];

function recordAction(signature) {
  if (!signature) return "";
  actionHistory.push(signature);
  if (actionHistory.length > ACTION_HISTORY_MAX) actionHistory.shift();
  const n = actionHistory.length;
  if (n >= 3 && actionHistory[n - 1] === actionHistory[n - 2] && actionHistory[n - 2] === actionHistory[n - 3]) {
    return "检测到连续 " + n + " 次相同操作且屏幕无变化迹象——很可能是死循环。" +
      "建议：改用 android_see 截图确认屏幕实际状态，或更换操作策略（如先 android_screen 刷新快照、用文字匹配代替坐标）。";
  }
  return "";
}

// ---------------------------------------------------------------------------
// 操作后自动附界面摘要（v1.8.5，插件层实现「感知随动作走」）：
// tap/scroll 成功后短暂等待界面稳定，刷新快照并把变化后界面的可点击项（前 10 条，
// 含 fx/fy）作为 uiHint 附在工具返回里 —— AI 大多数情况下无需再显式调用
// android_screen，每轮省一次感知调用。读不到时静默省略，不影响主结果。
// ---------------------------------------------------------------------------
async function uiHintAfterAction() {
  try {
    await new Promise((r) => setTimeout(r, 350));
    const snap = await getScreenSnapshot(true, currentVscreenDisplayId());
    if (!snap.ok) return undefined;
    const nodes = snap.nodes
      .filter((n) => n.clickable && (n.text || n.desc))
      .slice(0, 10);
    if (!nodes.length) return undefined;
    // B9-②：fx/fy 非有限数一律省略（undefined 属性会被内核 lossless 校验拒绝）
    return nodes.map((n) => ({
      text: (n.text || n.desc || "").slice(0, 30),
      ...(Number.isFinite(n.fx) ? { fx: n.fx } : {}),
      ...(Number.isFinite(n.fy) ? { fy: n.fy } : {})
    }));
  } catch {
    return undefined;
  }
}

const GUIDE_TEXT =
  "无障碍服务未开启或不可用：请在手机系统设置 → 无障碍 →（已下载的服务/服务）→ 开启「DeepSeek Harness 屏幕助手」，然后打开 App 后重试。" +
  "不确定是「开关被系统关闭」还是「服务崩溃」时，可先调 android_a11y_status 判断" +
  "（它会降级询问 App 原生桥并给出 a11yRunning/a11ySource）；" +
  "若返回 a11yRunning=false（无障碍已被关闭），用 android_open_a11y_settings 打开系统无障碍设置页引导用户重开，不要反复重试点击/读屏。";

function a11yRequest(path, params, timeoutMs) {
  return new Promise((resolve) => {
    const qs = params
      ? "?" + Object.entries(params).map(([k, v]) =>
          encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&")
      : "";
    const req = httpGet({
      host: "127.0.0.1",
      port: a11yPort(),
      path: path + qs,
      headers: authHeaders(),
      agent: bridgeAgent,
      timeout: timeoutMs || 8000
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; if (data.length > 262144) req.destroy(); });
      res.on("end", () => resolve(data || "{\"ok\":false,\"error\":\"empty response\"}"));
    });
    req.on("error", () => resolve("{\"ok\":false,\"error\":\"App 本地服务不可用\"}"));
    req.on("timeout", () => { req.destroy(); resolve("{\"ok\":false,\"error\":\"App 本地服务超时\"}"); });
    req.end();
  });
}

/** POST JSON（/gesture 用）。 */
function a11yPost(path, body, timeoutMs) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = httpRequest({
      host: "127.0.0.1",
      port: a11yPort(),
      path,
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }),
      agent: bridgeAgent,
      timeout: timeoutMs || 8000
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; if (data.length > 262144) req.destroy(); });
      res.on("end", () => resolve(data || "{\"ok\":false,\"error\":\"empty response\"}"));
    });
    req.on("error", () => resolve("{\"ok\":false,\"error\":\"App 本地服务不可用\"}"));
    req.on("timeout", () => { req.destroy(); resolve("{\"ok\":false,\"error\":\"App 本地服务超时\"}"); });
    req.end(payload);
  });
}

// ---------------------------------------------------------------------------
// App 原生桥（3081）极简客户端（v1.9.x 批次 4）：
// 无障碍开关被 ROM 重置后，3181 整体不可达，只有 3081 还能回答「无障碍开关态」
// 并拉起系统无障碍设置页——这是 AI 区分「开关被关」与「服务崩了」的唯一信息源。
// 注意：3081 会剥掉 query，参数只能放 JSON body。因此 params === undefined 走无参 GET，
// 否则把 params 作为 JSON body 发 POST（空对象 {} 即「POST + 空 body」）。
// ---------------------------------------------------------------------------
const appPort = () => parseInt(process.env.APP_NOTIFY_PORT || "3081", 10);

/** 批次81-T5：3081（App 侧本地桥）不可达时的统一可操作指引 —— 与 dsh-tool-android 同文案。
 *  3081 由 App 进程内的 MainActivity 提供，App 进程不在场时虚拟屏/剪贴板/通知/悬浮窗全失败，
 *  而托管引擎 3080 仍在跑；引导动作是「打开小鲸鱼助手后重试」，不是反复重试工具。 */
const APP_BRIDGE_HINT =
  "App 侧本地桥（3081）不可达：请打开「小鲸鱼助手」（App 主界面，或点面板右上角的 ⤢）后重试——" +
  "虚拟屏、剪贴板、通知、悬浮窗都依赖 App 进程在场（引擎 3080 可能仍在运行，属正常）。";

/** 批次81-T5：3081 有响应但超时（可能是慢处理，不等于没在监听）—— 同样必须给出恢复动作。 */
const APP_BRIDGE_TIMEOUT_HINT =
  "App 侧本地桥（3081）无响应（超时）：请打开「小鲸鱼助手」（App 主界面）后重试。";

function appRequest(path, params, timeoutMs) {
  return new Promise((resolve) => {
    const payload = params === undefined ? undefined : JSON.stringify(params);
    const opts = {
      host: "127.0.0.1",
      port: appPort(),
      path,
      headers: authHeaders(payload === undefined ? {} : {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }),
      agent: bridgeAgent,
      timeout: timeoutMs || 4000
    };
    if (payload !== undefined) opts.method = "POST";
    const req = httpRequest(opts, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; if (data.length > 262144) req.destroy(); });
      res.on("end", () => resolve(data || "{\"ok\":false,\"error\":\"empty response\"}"));
    });
    req.on("error", () => resolve(JSON.stringify({ ok: false, error: APP_BRIDGE_HINT })));
    req.on("timeout", () => { req.destroy(); resolve(JSON.stringify({ ok: false, error: APP_BRIDGE_TIMEOUT_HINT })); });
    if (payload !== undefined) req.end(payload); else req.end();
  });
}

/** 解析 3081 响应：不做 GUIDE_TEXT 替换（这里需要原样判断 a11yRunning/a11ySource）。 */
function parseAppJson(raw) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch (_) {
    return null;
  }
}

// ===================== 虚拟屏 vscreen 透明路由 =====================
let vscreenCreated = false;
let vscreenDisplayId = null;
const vscreenShared = (globalThis.__DSH_VSCREEN_STATE__ = globalThis.__DSH_VSCREEN_STATE__ || {
  created: false,
  displayId: null
});

function isVscreenCreated() {
  return vscreenShared.created;
}

function setVscreenCreated(val, displayId = null) {
  vscreenCreated = Boolean(val);
  vscreenShared.created = Boolean(val);
  vscreenDisplayId = val ? displayId : null;
  vscreenShared.displayId = val ? displayId : null;
}

function currentVscreenDisplayId() {
  return vscreenShared.created ? validDisplayId(vscreenShared.displayId) : null;
}

const VSCREEN_CREATE_TIMEOUT_MS = 120000;
const VSCREEN_SEE_TIMEOUT_MS = 20000;
const VSCREEN_SEE_MAX_BYTES = 30 * 1024 * 1024;

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

function vscreenFail(res, fallbackError) {
  const body = res && !res.unreachable && res.json && typeof res.json === "object" ? res.json : null;
  if (body && typeof body.reason === "string" && body.reason) {
    const out = { ok: false, reason: body.reason };
    if (typeof body.hint === "string" && body.hint) out.hint = body.hint;
    if (typeof body.detail === "string" && body.detail) out.error = body.detail;
    else if (fallbackError) out.error = fallbackError;
    if (body.reason === "NOT_CREATED" || body.reason === "SESSION_DEAD") {
      setVscreenCreated(false);
    }
    return out;
  }
  return {
    ok: false, reason: "BRIDGE_UNREACHABLE",
    hint: APP_BRIDGE_HINT,
    error: fallbackError || (res && res.error) || "无响应或响应不是 JSON"
  };
}

async function ensureVscreenCreated(ctx) {
  if (isVscreenCreated()) {
    return { ok: true, displayId: vscreenShared.displayId };
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

/** 只读工具降级提示（批次61）：虚拟屏不可用（如 App 侧「只读任务」硬闸门拒绝建屏）时，只读工具改用主屏继续工作。 */
const VSCREEN_READONLY_FALLBACK_HINT =
  "虚拟屏不可用，已自动降级使用用户主屏（只读降级；点击/输入等写操作仍会明确报错）。";

/** 目标 display 的真实像素尺寸（批次74）。
 *
 *  根因：虚拟屏（1008x1792 实测；8998 服务端默认 1008x1792）与主屏（本机 1256x2808）
 *  尺寸不同。此前只有单工具 android_tap 自带按「硬编码 1080x1920」的换算，事务内
 *  tap（tapCore -> /tap）完全没有换算，fx/fy 落到 App 侧仍按主屏尺寸算 →
 *  虚拟屏上纵向点偏约 1.57 倍（真机实测：fx=0.496/fy=0.17 单工具命中搜索框，
 *  事务 tap 却落到账号卡片并跳转荣耀账号中心）。
 *
 *  这里改为向 App 查询目标 display 的真实尺寸，不再硬编码。
 */
let displayInfoCache = { at: 0, displayId: null, value: null };

async function displayMetrics(displayId = null) {
  const dId = validDisplayId(displayId);
  if (displayInfoCache.value !== null &&
      sameDisplayId(displayInfoCache.displayId, dId) &&
      Date.now() - displayInfoCache.at < 3000) {
    return displayInfoCache.value;
  }
  const params = dId === null ? undefined : { displayId: String(dId) };
  let value = null;
  try {
    const raw = await a11yRequest("/display-info", params, 5000);
    const v = parseResult(raw);
    const w = finiteNum(v.width, 0);
    const h = finiteNum(v.height, 0);
    if (v.ok !== false && w > 0 && h > 0) {
      value = { width: w, height: h, displayId: finiteNum(v.displayId, 0) };
    }
  } catch (_) {
    value = null;
  }
  displayInfoCache = { at: Date.now(), displayId: dId, value };
  return value;
}

/** 只读降级主屏：读用户主屏真实前台窗口（复用 scope=current 的 displayId=0&exclude_self=1 路径），
 *  成功时补一条降级 hint（原有字段与 scaleX/scaleY 语义不变）；写操作不调用本函数，建屏失败仍明确报错。 */
async function readMainScreenFallback(extraParams) {
  const snap = await getCurrentScreenSnapshot(extraParams || {});
  if (!snap.ok) return snap;
  return { ...snap, hint: VSCREEN_READONLY_FALLBACK_HINT };
}

/** 无障碍开关已被关闭时的统一引导（3181 不可达 + 3081 报 a11yRunning=false）。 */
const A11Y_OFF_HINT =
  "无障碍服务当前处于「已关闭」状态（a11ySource 表明系统侧开关未生效）。" +
  "常见原因：App 被 force-stop 或系统重启后，ROM 重置了无障碍开关。" +
  "请调用 android_open_a11y_settings 打开系统无障碍设置页，让用户手动重新开启「DeepSeek Harness 屏幕助手」；" +
  "在重新开启之前，android_screen / android_tap / android_type / android_scroll / android_see 等全部不可用——" +
  "不要反复重试这些工具（重试必然失败），先引导用户开启。开启后再次调用 android_a11y_status 确认 running=true。";

function parseResult(raw, hint) {
  try {
    const v = JSON.parse(raw);
    if (!v.ok && v.error && /服务不可用|超时|empty response/.test(v.error)) {
      return { ok: false, error: (hint || GUIDE_TEXT) };
    }
    return v;
  } catch (e) {
    return { ok: false, error: "无障碍服务响应解析失败: " + String(raw).slice(0, 120) };
  }
}

// ---------------------------------------------------------------------------
// 失败语义（#57，批次 7）：把失败路径归纳为机器可读 reason 枚举，AI 不再解析中文
// error 文案判断失败类型。枚举集：TARGET_NOT_FOUND / TARGET_NOT_CLICKABLE /
// IME_NOT_READY / POSTCONDITION_FAILED / SCREEN_CHANGED / APP_SWITCHED / TIMEOUT /
// PERMISSION_DENIED / BRIDGE_UNREACHABLE / INVALID_ARGUMENT。
// 现有 verified/method/notes(=error/warning) 字段全部原样保留，reason 只是附加。
// ---------------------------------------------------------------------------
function failReason(raw, v) {
  const s = String(raw || "") + " " + String((v && v.error) || "");
  if (/本地服务不可用|本地服务超时|empty response|不可达|unauthorized/i.test(s)) return "BRIDGE_UNREACHABLE";
  if (/未找到可输入|未找到可滚动|没有活动窗口|未匹配/.test(s)) return "TARGET_NOT_FOUND";
  if (/静默无效|界面无变化|亦失败/.test(s)) return "POSTCONDITION_FAILED";
  if (/不可点击/.test(s)) return "TARGET_NOT_CLICKABLE";
  if (/输入法|IME/i.test(s)) return "IME_NOT_READY";
  return "";
}

// ---------------------------------------------------------------------------
// L3 特权粘贴回退（v1.9.x 批次 1；批次 2 复核并订正措辞）：
// android_type 的 L1 ACTION_SET_TEXT / L2 ACTION_PASTE 对 WebView/contenteditable 输入框
// 可能「返回成功但界面不刷新」，App 进程内拿不到特权，因此在这里补最后一级兜底：
// 系统级 `input keyevent 279`（KEYCODE_PASTE）。
//
// 批次 2 真机复测（2026-09-12，Pixel 6 Pro / Android 17）：键盘弹出且输入框已聚焦时，
// `input keyevent 279` 确实生效 —— 剪贴板置为 C279 后执行该命令，
// /input?verifyOnly=1&text=C279 回读 {"verified":true,"actual":"C279"}，截图一致；
// 但先按 BACK 收起键盘、再用同一命令则无效（回读为空，此时 a11y 仍报 focused=true）。
// 即生效前提是输入法已连接（IME up），仅「a11y 认为已聚焦」不够；上批次测到的「无变化」
// 应是焦点/IME 丢失所致，而非该路径不可靠。
// 故这一级保留为末级兜底，但不再宣称是「唯一被证实可靠的路径」——可靠性的唯一判据始终是回读校验。
//
// 权威副本：plugins/dsh-tool-android/lib/index.js 的 privCmd/suCmd/shizukuCmd/sanitizeEnv。
// 这里只保留最小必要实现；命令是常量（"input keyevent 279"），无外部输入拼接，注入面为零。
// 环境变量由 MainActivity 启动引擎时注入：
//   ROOT_AVAILABLE=1（su 通道）/ SHIZUKU_AVAILABLE=1（app_process rish 通道）
//   SHIZUKU_DEX / SHIZUKU_APP_ID。两者都不可用时跳过 L3（不注册也不报错）。
// ---------------------------------------------------------------------------
const APP_PROC = "/system/bin/app_process";
const SHIZUKU_LOADER = "rikka.shizuku.shell.ShizukuShellLoader";

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

/** 清理会污染子进程的动态链接环境（与权威副本一致）。 */
function sanitizeEnv(env) {
  const clean = { ...env };
  delete clean.LD_LIBRARY_PATH;
  delete clean.LD_PRELOAD;
  delete clean.LD_DEBUG;
  return clean;
}

/** Shizuku 的 rish dex 必须只读，否则 Shizuku 拒绝加载。 */
function ensureDexReadOnly(dex) {
  try {
    if (dex && existsSync(dex)) chmodSync(dex, 0o444);
  } catch (_) {}
}

/** 执行一条特权命令，返回 {ok, exit_code, stdout, stderr, error?}。 */
function runPrivCmd(bin, args, env, timeoutMs) {
  const timeout = Math.max(1000, Math.min(timeoutMs || 15000, 120000));
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
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
        stdout: String(stdout).trim().slice(0, 2000),
        stderr: String(stderr).trim().slice(0, 1000),
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

/** 选择特权通道执行：root(su) 优先；托管 shell 自身次之（零 IPC）；否则 Shizuku（app_process rish）。 */
function privCmd(command, timeoutMs, displayId = null) {
  const dId = validDisplayId(displayId);
  const scoped = dId !== null && command.startsWith("input ")
    ? "input -d " + dId + " " + command.slice(6)
    : command;
  if (process.env.ROOT_AVAILABLE === "1") {
    return runPrivCmd("su", ["-c", scoped], sanitizeEnv(process.env), timeoutMs);
  }
  if (isHostedShellPrivileged() || !process.env.SHIZUKU_DEX) {
    return runPrivCmd("/system/bin/sh", ["-c", scoped], sanitizeEnv(process.env), timeoutMs);
  }
  const dex = process.env.SHIZUKU_DEX;
  ensureDexReadOnly(dex);
  return runPrivCmd(
    APP_PROC,
    [`-Djava.class.path=${dex}`, "/system/bin", "--nice-name=rish", SHIZUKU_LOADER, "-c", scoped],
    { ...sanitizeEnv(process.env), RISH_APPLICATION_ID: process.env.SHIZUKU_APP_ID || "com.deepseek.harness" },
    timeoutMs
  );
}

function renderResult(value) {
  if (!value) return [{ type: "text", text: "执行失败：未知错误" }];
  const head = value.ok
    ? "操作成功。"
    : "执行失败：" + (value.error || "未知错误") + "。";
  // v1.8.2：此前 ok 时只渲染「操作成功。」，把 running/package/nodeCount 等状态字段
  // 全部丢弃（AI 看不到任何字段）。这里把常见状态字段拼成可读文本透出。
  const kv = [];
  if ("running" in value) kv.push("running=" + (value.running ? "true" : "false"));
  // v1.9.x（批次 4）：无障碍自诊断字段——不渲染等于没返回（AI 只看 render 文本）
  if ("a11yRunning" in value) kv.push("a11yRunning=" + (value.a11yRunning ? "true" : "false"));
  if (typeof value.a11ySource === "string" && value.a11ySource) kv.push("a11ySource=" + value.a11ySource);
  if (value.package) kv.push("package=" + value.package);
  if (typeof value.nodeCount === "number") kv.push("nodeCount=" + value.nodeCount);
  if ("canScreenshot" in value) kv.push("canScreenshot=" + (value.canScreenshot ? "true" : "false"));
  if (value.apiLevel) kv.push("apiLevel=" + value.apiLevel);
  if (typeof value.screenW === "number" && value.screenW > 0) kv.push("screen=" + value.screenW + "x" + value.screenH);
  if (typeof value.maxFingers === "number" && value.maxFingers > 0) kv.push("maxFingers=" + value.maxFingers);
  if (typeof value.holdTimeoutMs === "number" && value.holdTimeoutMs > 0) kv.push("holdTimeoutMs=" + value.holdTimeoutMs);
  if (Array.isArray(value.held)) kv.push("held=" + value.held.length + "根");
  // v1.9.x（批次 1）：tap / type 的可靠性字段——不渲染等于没返回（AI 只看 render 文本）
  if ("found" in value) kv.push("found=" + (value.found ? "true" : "false"));
  if (value.method) kv.push("method=" + value.method);
  if ("degraded" in value) kv.push("degraded=" + (value.degraded ? "true" : "false"));
  if (typeof value.imeTopY === "number" && value.imeTopY > 0) kv.push("imeTopY=" + value.imeTopY);
  if ("focused" in value) kv.push("focused=" + (value.focused ? "true" : "false"));
  if ("verified" in value) kv.push("verified=" + (value.verified ? "true" : "false"));
  if (typeof value.expected === "string" && value.expected)
    kv.push("expected=" + JSON.stringify(value.expected.slice(0, 120)));
  if (typeof value.actual === "string")
    kv.push("actual=" + JSON.stringify(value.actual.slice(0, 120)));
  if (Array.isArray(value.attempts) && value.attempts.length) {
    kv.push("attempts=" + value.attempts.map((a) =>
      `${a && a.method || "?"}:${a && a.ok ? "ok" : "fail"}` +
      `${a && a.readback ? "(readback=" + JSON.stringify(String(a.readback).slice(0, 60)) + ")" : ""}`
    ).join(" → "));
  }
  const warn = typeof value.warning === "string" && value.warning ? "\n⚠️ " + value.warning : "";
  // v1.9.x（批次 4）：hint 是给 AI 的行动指引（如「无障碍已被关闭 → 调 android_open_a11y_settings」），
  // 必须渲染出来，否则 AI 看不到补救路径。
  const hint = typeof value.hint === "string" && value.hint ? "\n提示: " + value.hint : "";
  return [{ type: "text", text: head + (kv.length ? " " + kv.join("，") : "") + warn + hint }];
}

/** 屏幕节点树渲染成 AI 可读文本列表（带索引，方便 android_tap 引用坐标）。 */
function renderScreen(_args, value) {
  if (!value.ok) return renderResult(value);
  const lines = [];
  lines.push("当前前台应用: " + (value.package || "未知"));
  lines.push("节点数: " + value.count + (value.truncated ? "（已截断，仅显示部分）" : ""));
  if (value.hint) lines.push("提示: " + value.hint);
  lines.push("");
    const nodes = value.nodes || [];
    nodes.forEach((n, i) => {
      const flags = [];
      if (n.clickable) flags.push("可点击");
      if (n.input) flags.push("可输入");
      if (n.checked) flags.push("已选中");
      if (n.scrollable) flags.push("可滚动");
      const label = n.text || n.desc || "(无文字)";
      const short = label.length > 120 ? label.slice(0, 120) + "…" : label;
      // 批次6：viewId 有值时显示（AI 可用 vid 参数精确点击）
      const vidPart = n.vid ? " vid=" + n.vid : "";
      lines.push(`[${i}] ${short}  (${n.x},${n.y} ${n.w}x${n.h})${vidPart}${flags.length ? " " + flags.join("/") : ""}`);
    });
  return [{ type: "text", text: lines.join("\n") }];
}

// ---------------------------------------------------------------------------
// #56 android_act 事务：单工具 execute 核心抽出复用（改动最小方案——
// android_tap/android_type/android_scroll 的 execute 委托到这些核心函数，
// 单工具行为不变；android_act 逐步调用同一套参数处理与验证链路）。
// opts.uiHint === false 时跳过操作后自动读屏摘要（事务内逐步附 uiHint 太慢且无意义）。
// ---------------------------------------------------------------------------
async function tapCore(args, opts = {}) {
  const params = {};
  if (args.vid !== undefined && String(args.vid).trim().length > 0) params.vid = String(args.vid).trim();
  if (args.text !== undefined && String(args.text).length > 0) params.text = String(args.text);
  if (args.desc !== undefined && String(args.desc).length > 0) params.desc = String(args.desc);
  if (args.x !== undefined) params.x = String(Number(args.x));
  if (args.y !== undefined) params.y = String(Number(args.y));
  if (args.fx !== undefined) params.fx = String(Number(args.fx));
  if (args.fy !== undefined) params.fy = String(Number(args.fy));
  if (Object.keys(params).length === 0) {
    return { ok: false, error: "android_tap 需要至少一个参数：vid / text / desc / x / y / fx / fy", reason: "INVALID_ARGUMENT" };
  }
  let viaCache = false;
  // 批次75：快照命中的「像素中心 + 所属屏幕」——避免 像素→分数→像素 的二次取整漂移。
  let hitPoint = null;
  let hitDisplayId = null;
  // 批次74：解析「目标屏幕」——虚拟屏模式下所有坐标语义都必须相对虚拟屏。
  // 此前 /tap 端 App 侧用 screenSize()（主屏 1256x2808）换算 fx/fy，
  // 而虚拟屏是 1008x1792 → 纵向点偏约 1.57 倍（真机确证缺陷）。
  const coreCtx = opts.ctx;
  const vscreenModeOn = coreCtx ? isVscreenModeEnabled(coreCtx) : false;
  const vscreenActive = vscreenModeOn && currentVscreenDisplayId() !== null;
  const targetDisplayId = vscreenActive ? currentVscreenDisplayId() : null;
  const targetMetrics = (vscreenModeOn || vscreenActive) ? await displayMetrics(targetDisplayId) : null;
  // 定位用的 displayId：虚拟屏已建 -> 虚拟屏；仅开启模式但未建屏 -> 主屏（建屏后改走虚拟屏注入）
  const lookupDisplayId = vscreenActive ? targetDisplayId : null;
  // 快照查找条件：原行为（有定位词且没给坐标）不变；事务内（strictLocator）即使带了
  // 坐标也强制走快照定位——定位不到节点就直接失败，不允许「text 未命中退盲点坐标」。
  // 批次75：虚拟屏模式下只要给了定位词就必须先解析——此前会被下面的 vscreen 分支
  // 直接挡成「需要坐标」，导致 android_screen 能读到文字、android_tap 却点不了。
  // 现在是「读虚拟屏的树 → 得到虚拟屏坐标 → 注入虚拟屏」，两端同一坐标系。
  const hasLocator = !!(params.text || params.desc || params.vid);
  const consultSnapshot = hasLocator &&
    (vscreenModeOn || opts.strictLocator || (!params.x && !params.y && !params.fx && !params.fy));
  if (consultSnapshot) {
    // 批次74：定位必须针对「目标屏幕」——虚拟屏模式下若仍读主屏快照，
    // 事务内 tap 会把主屏坐标交给虚拟屏注入（批次72 的 display 隔离同样要求显式传 displayId）。
    const snap = await getScreenSnapshot(false, lookupDisplayId);
    const hit = findNodeInSnapshot(snap, params.text, params.desc, params.vid);
    if (hit) {
      params.fx = String(hit.fx);
      params.fy = String(hit.fy);
      delete params.vid;
      delete params.text;
      delete params.desc;
      viaCache = true;
      if (Number.isFinite(hit.cx) && Number.isFinite(hit.cy)) {
        hitPoint = { x: hit.cx, y: hit.cy };
        hitDisplayId = lookupDisplayId;
      }
    } else if (vscreenModeOn || opts.strictLocator) {
      // 批次10a B9-④（事务内）/ 批次75（虚拟屏单工具）：一律不做盲坐标兜底。
      // 虚拟屏模式下尤其危险——把定位词交给主屏 /tap 会用主屏坐标 dispatchGesture，
      // 等于「以为在点虚拟屏、实际动了主屏」，直接破坏主屏零抢屏承诺。
      const needle = params.vid || params.text || params.desc || "";
      if (vscreenModeOn) {
        return {
          ok: false,
          found: false,
          error: "虚拟屏内未定位到目标节点（" + needle + "）——已停止，不做主屏坐标兜底。" +
            "请先用 android_screen / android_screen_refresh 确认文案与当前界面，或改用 android_vscreen_tap 的 fx/fy。",
          reason: "TARGET_NOT_FOUND"
        };
      }
      return {
        ok: false,
        error: "事务内 tap 未在当前屏幕定位到目标节点（" + needle + "），已停止（事务内不做坐标兜底）",
        reason: "TARGET_NOT_FOUND"
      };
    }
  }
  if (vscreenModeOn) {
    // 虚拟屏模式：把最终坐标归一成「虚拟屏像素」并交给 3081 /vscreen/tap。
    // 不能走 /tap——App 侧注入针对主屏，且其 fx/fy 按主屏尺寸换算（本缺陷根因）。
    let px = null;
    let py = null;
    // 快照命中的像素中心：精度最高，且当它来自虚拟屏时直接可用（不再回退成 fx/fy 二次换算）
    const hitUsable = hitPoint !== null && vscreenActive && sameDisplayId(hitDisplayId, targetDisplayId);
    if (hitUsable) {
      px = Math.round(hitPoint.x);
      py = Math.round(hitPoint.y);
    } else if (params.x !== undefined && params.y !== undefined) {
      // 显式像素坐标：约定为「目标屏像素」（与 android_vscreen_tap / 截图像素一致）
      px = Math.round(Number(params.x));
      py = Math.round(Number(params.y));
    } else if (params.fx !== undefined && params.fy !== undefined) {
      // 尺寸来源优先级：建屏后查到的真实尺寸 > 建屏前缓存 > 8998 服务端默认 1008x1792
      let m = targetMetrics;
      if (!m || !(m.width > 0) || !(m.height > 0)) {
        m = await displayMetrics(currentVscreenDisplayId());
      }
      const w = m && m.width > 0 ? m.width : 1008;
      const h = m && m.height > 0 ? m.height : 1792;
      px = Math.round(Number(params.fx) * w);
      py = Math.round(Number(params.fy) * h);
    }
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      return {
        ok: false,
        found: false,
        error: "虚拟屏模式点击需要坐标或可解析的定位词：请传 text/desc/vid（在虚拟屏语义树内定位），" +
          "或 x/y、fx/fy；若只有截图，可用 android_screen / android_vscreen_see 读出节点坐标后再点。",
        reason: "INVALID_ARGUMENT"
      };
    }
    const ensured = await ensureVscreenCreated(coreCtx);
    if (!ensured.ok) {
      return {
        ok: false,
        found: false,
        error: ensured.hint ? String(ensured.error || "创建虚拟屏失败") + " — " + ensured.hint : (ensured.error || "创建虚拟屏失败"),
        reason: ensured.reason || "VSCREEN_CREATE_FAILED"
      };
    }
    const res = await vscreenBridge("POST", "/vscreen/tap", { x: px, y: py }, 8000);
    if (res.unreachable || !res.json || res.json.ok !== true) {
      const f = vscreenFail(res, "虚拟屏点击失败");
      return {
        ok: false,
        found: false,
        error: f.hint ? String(f.error || "虚拟屏点击失败") + " — " + f.hint : (f.error || "虚拟屏点击失败"),
        reason: f.reason || "VSCREEN_TAP_FAILED"
      };
    }
    const sigV = ["tap", String(px), String(py), viaCache ? "cache" : ""].join("|");
    const warningV = recordAction(sigV);
    const uiHintV = opts.uiHint !== false ? await uiHintAfterAction() : undefined;
    return {
      ok: true,
      found: true,
      method: viaCache ? "vscreen-tap-snapshot" : "vscreen-tap",
      degraded: false,
      ...(warningV ? { warning: warningV } : {}),
      ...(uiHintV ? { uiHint: uiHintV } : {})
    };
  }
  const raw = await a11yRequest("/tap", params, 8000);
  const v = parseResult(raw);
  if (!v.ok) {
    const reason = failReason(raw, v);
    return {
      ok: false,
      error: typeof v.error === "string" && v.error ? v.error : GUIDE_TEXT,
      ...(reason ? { reason } : {})
    };
  }
  const sigParts = ["tap", params.text || "", params.desc || "",
    params.fx !== undefined ? params.fx : (params.x !== undefined ? params.x : ""),
    params.fy !== undefined ? params.fy : (params.y !== undefined ? params.y : "")];
  const warning = recordAction(sigParts.join("|") + (viaCache ? "|cache" : ""));
  const uiHint = (v.found !== false && opts.uiHint !== false) ? await uiHintAfterAction() : undefined;
  const failReasonFound = v.found === false
    ? (failReason(raw, v) || "TARGET_NOT_FOUND")
    : "";
  return {
    ok: v.found !== false,
    found: v.found === true,
    method: typeof v.method === "string" ? v.method : (viaCache ? "snapshot-coords" : ""),
    degraded: v.degraded === true,
    // B9-②：imeTopY 是唯一透传 App 数值——Infinity（JSON 1e999 可解析出）会被
    // 内核 lossless 校验拒绝，非有限数一律省略字段
    ...(finiteNum(v.imeTopY, 0) > 0 ? { imeTopY: v.imeTopY } : {}),
    ...(v.found === false && typeof v.error === "string" && v.error ? { error: v.error } : {}),
    ...(failReasonFound ? { reason: failReasonFound } : {}),
    ...(warning ? { warning } : {}),
    ...(uiHint ? { uiHint } : {})
  };
}

// ---------------------------------------------------------------------------
// 批次10a B9-①：IME/焦点预检（对齐 dsh-tool-android android_input 批次7 的探针）。
// GET /input?verifyOnly=1 只探不写，响应含 focused / imeTopY（>0 = 输入法窗口在屏）。
// 无聚焦节点且无 IME 窗口时注入必然静默丢弃 → 快速失败 IME_NOT_READY，不再空转
// setText/paste/279 三级链路。桥不可达时跳过预检（保持旧行为，由 /input 自己报错）。
// ---------------------------------------------------------------------------
const IME_PRECHECK_HINT = "先 tap 聚焦输入框（并等待键盘弹出）后再执行输入。";

function imeNotReadyResult(error, focused, hint) {
  return {
    ok: false,
    focused: focused === true,
    error,
    reason: "IME_NOT_READY",
    hint: hint || IME_PRECHECK_HINT
  };
}

/** verifyOnly 探针：返回 {unreachable} 或 {focused, imeUp, actual}（含 B9-② 有限性护栏）。 */
async function imeProbe(expected, displayId = null) {
  const params = { verifyOnly: "1", text: expected };
  const dId = validDisplayId(displayId);
  if (dId !== null) params.displayId = String(dId);
  const raw = await a11yRequest("/input", params, 8000);
  const v = parseResult(raw);
  if (!v.ok && /本地服务不可用|本地服务超时|empty response/.test(String(raw))) {
    return { unreachable: true };
  }
  return {
    unreachable: false,
    focused: v.focused === true,
    imeUp: finiteNum(v.imeTopY, 0) > 0,
    actual: typeof v.actual === "string" ? v.actual : ""
  };
}

/** IME/焦点预检。返回 null = 放行；返回对象 = 快速失败（IME_NOT_READY 等）。
 *  clearing=true（清空语义）时允许自动聚焦一次：找可输入节点点其中心（B9-③）。 */
async function imePrecheck(clearing, displayId = null) {
  // 焦点已在但键盘未起：可能刚 tap 完键盘动画中（Gboard 冷启动可 >1s）——
  // 轮询 3×600ms；仍无输入法窗口则视为 stale DOM focus，注入必然静默丢弃 → 快速失败
  const pollImeUp = async (rounds) => {
    for (let i = 0; i < rounds; i++) {
      await new Promise((r) => setTimeout(r, 600));
      const p = await imeProbe("", displayId);
      if (p.unreachable || p.imeUp) return p;
    }
    return null;
  };
  let probe = await imeProbe("", displayId);
  if (probe.unreachable) return null;
  if (probe.focused && probe.imeUp) return null;
  if (probe.focused) {
    const up = await pollImeUp(3);
    if (up) return null;
    // 焦点在但键盘不在屏：Gboard 冷启动慢之外，实测（批次10a 设备）「焦点已存在的
    // 输入框再 tap 一次」会 toggle 收起键盘——此处对聚焦节点中心补一次 tap 重新
    // 唤起键盘（模拟人工点击输入框），再轮询一次；仍不起才判 IME_NOT_READY
    const snap = await getScreenSnapshot(true, displayId);
    const box = snap.ok
      ? snap.nodes.find((n) => (n.input || n.cls === "android.widget.EditText") && n.w > 0 && n.h > 0)
      : null;
    if (box) {
      await tapCore(
        { x: box.x + Math.round(box.w / 2), y: box.y + Math.round(box.h / 2) },
        { uiHint: false }
      );
      const up2 = await pollImeUp(2);
      if (up2) return null;
    }
    if (!clearing) {
      return imeNotReadyResult("输入法未就绪：节点报告了焦点但输入法窗口不在屏（注入会静默丢弃）", probe.focused);
    }
  } else if (!clearing) {
    return imeNotReadyResult("输入法/焦点未就绪：目标输入框未聚焦且输入法未弹出", probe.focused);
  }
  // ---- 清空语义（B9-③）：焦点/IME 不就绪时允许自动聚焦一次 ----
  if (!probe.focused) {
    const snap = await getScreenSnapshot(true, displayId);
    if (!snap.ok) {
      return {
        ok: false,
        error: typeof snap.error === "string" && snap.error ? snap.error : GUIDE_TEXT,
        reason: snap.reason || "BRIDGE_UNREACHABLE"
      };
    }
    const box = snap.nodes.find((n) => (n.input || n.cls === "android.widget.EditText") && n.w > 0 && n.h > 0);
    if (!box) {
      return imeNotReadyResult(
        "清空失败：当前没有聚焦的输入框，屏幕上也找不到可输入节点",
        false,
        "先 android_tap 点击目标输入框聚焦（并等待键盘弹出）后再清空。"
      );
    }
    const tap = await tapCore(
      { x: box.x + Math.round(box.w / 2), y: box.y + Math.round(box.h / 2) },
      { uiHint: false }
    );
    if (tap.ok === false) {
      return imeNotReadyResult(
        "清空失败：输入框不可聚焦（" + (typeof tap.error === "string" ? tap.error : "点击聚焦失败") + "）",
        false,
        "先手动 tap 聚焦输入框（并确认键盘弹出）后再清空。"
      );
    }
    probe = await imeProbe("", displayId);
    if (probe.unreachable) return null;
    if (probe.imeUp) return null;
  }
  const up = probe.imeUp ? probe : await pollImeUp(2);
  if (up) return null;
  return imeNotReadyResult(
    "清空失败：已尝试聚焦但输入法/焦点仍未就绪",
    probe.focused,
    "先手动 tap 聚焦输入框并等待键盘弹出，再执行清空。"
  );
}

/** 批次10a B9-③：keyevent 清空链——WebView 输入框上 SET_TEXT("")/ACTION_PASTE("")
 *  均为 no-op（既有实证），退化系统级按键清空：ESC（收粘贴条，如需）→ MOVE_END →
 *  DEL 逐发（每轮 5 键、至多 12 轮共 60 键，足以覆盖 50+ 字长文本；轮间回读早停）→
 *  最终回读判定。前提：预检已确保聚焦 + IME 在屏。
 *  实证（批次10a 设备验证）：WebView 上 `input keyevent 67 67 67 67 67` 单条多键
 *  不可靠（5 键仅删 1-5 字），故改为每键单独一条 `input keyevent 67`。
 *  attempts 直接追加明细（{method, ok, readback}）。返回 {cleared, readback}。 */
async function keyeventClearChain(attempts, pasteMode, displayId = null) {
  if (pasteMode) {
    // paste 路径失败后 IME 常挂着剪贴板建议条/粘贴条 → ESC 收掉再删
    const esc = await privCmd("input keyevent 111", 8000, displayId);
    attempts.push({ method: "keyevent-esc", ok: esc.ok === true, readback: "" });
    await new Promise((r) => setTimeout(r, 150));
  }
  const mv = await privCmd("input keyevent 123", 8000, displayId); // KEYCODE_MOVE_END：从尾部删
  attempts.push({ method: "keyevent-move-end", ok: mv.ok === true, readback: "" });
  await new Promise((r) => setTimeout(r, 150));
  let rb = "";
  let total = 0;
  const MAX_DEL = 60; // 12 轮 × 5 键：覆盖长文本（实测 WebView 每键至少删 1 字）
  for (let round = 1; total < MAX_DEL; round++) {
    // 每轮 5 个 KEYCODE_DEL(67)，逐键单独发送（WebView 对单条多 keycode 支持差）
    for (let i = 0; i < 5 && total < MAX_DEL; i++) {
      await privCmd("input keyevent 67", 8000, displayId);
      total++;
      await new Promise((res) => setTimeout(res, 120));
    }
    await new Promise((res) => setTimeout(res, 200));
    const probe = await imeProbe("", displayId);
    if (!probe.unreachable) rb = probe.actual;
    attempts.push({ method: "keyevent-del-x" + total, ok: rb === "", readback: rb });
    if (rb === "") break; // 回读早停
  }
  return { cleared: rb === "", readback: rb };
}

/** 批次72：可打印 ASCII 判定与 shell 单引号转义（与 android_input 通道同规则：
 *  `input text` 只接受可打印 ASCII，空格须写 %s；含非 ASCII 走剪贴板粘贴）。 */
const PRINTABLE_ASCII = /^[\u0020-\u007E]+$/;

function shq(s) {
  return "'" + String(s == null ? "" : s).replace(/'/g, "'\\''") + "'";
}

/** ASCII 注入命令：input text + 单引号转义 + 空格转 %s。 */
function asciiInputCmd(text) {
  return "input text " + shq(String(text).replace(/ /g, "%s"));
}

/** 批次72：特权通道直接注入（虚拟屏无软键盘 / 主屏 IME 未就绪时的兜底）。
 *  ASCII 走 `input [-d N] text`，非 ASCII 走剪贴板 + `input [-d N] keyevent 279`；
 *  注入后一律经 A11y verifyOnly 回读确认，只有回读一致才返回 verified:true。 */
async function privilegedType(args, displayId = null) {
  if (!privilegedAvailable()) {
    return {
      ok: false, verified: false, reason: "PERMISSION_DENIED",
      error: "无可用特权通道（root / Shizuku / 托管 shell 均不可用），无法按 displayId 直接注入"
    };
  }
  const text = String(args.text == null ? "" : args.text);
  const dId = validDisplayId(displayId);
  const verifyParams = { text, verifyOnly: "1" };
  if (dId !== null) verifyParams.displayId = String(dId);

  let method;
  let injected;
  if (text !== "" && PRINTABLE_ASCII.test(text)) {
    method = "priv-input-text";
    injected = await privCmd(asciiInputCmd(text), 15000, dId);
  } else if (text === "") {
    method = "priv-keyevent-clear";
    injected = await privCmd("input keyevent 123", 15000, dId);
  } else {
    method = "priv-key-paste";
    const w = parseAppJson(await appRequest("/clipboard", { action: "write", content: text }, 8000));
    if (!w || w.ok !== true) {
      return {
        ok: false, verified: false, reason: "POSTCONDITION_FAILED",
        error: "剪贴板写入失败，非 ASCII 文本无法经特权通道粘贴注入"
      };
    }
    injected = await privCmd("input keyevent 279", 15000, dId);
  }
  await new Promise((r) => setTimeout(r, 350));
  const back = parseResult(await a11yRequest("/input", verifyParams, 8000));
  const rbActual = typeof back.actual === "string" ? back.actual : "";
  if (method === "priv-key-paste" && args.clear_clipboard !== false) {
    await appRequest("/clipboard", { action: "clear" }, 5000);
  }
  if (back.ok !== false && back.verified === true) {
    return {
      ok: true,
      focused: back.focused === true,
      method,
      verified: true,
      actual: rbActual,
      ...(method === "priv-key-paste"
        ? { warning: "文本经系统剪贴板注入（已尝试清空剪贴板）。" }
        : {})
    };
  }
  return {
    ok: false,
    verified: false,
    reason: "POSTCONDITION_FAILED",
    focused: back.focused === true,
    expected: text,
    actual: rbActual,
    error: "特权通道注入未通过回读校验（" +
      (injected.error || injected.stderr || ("exit=" + injected.exit_code)) + "）",
    attempts: [{ method, ok: injected.ok === true, readback: rbActual }]
  };
}

async function typeCore(args, opts = {}) {
  const displayId = validDisplayId(opts.displayId);
  if (args.text === undefined || args.text === null) {
    return { ok: false, error: "android_type 需要 text 参数", reason: "INVALID_ARGUMENT" };
  }
  const text = String(args.text);
  const clearing = text === "";
  // 批次10a B9-①：注入前 IME/焦点预检——无聚焦节点且无 IME 窗口时快速失败
  const pre = opts.skipImePrecheck ? null : await imePrecheck(clearing, displayId);
  if (pre) return pre;
  const params = { text };
  if (displayId !== null) params.displayId = String(displayId);
  const pasteMode = args.paste === true;
  if (pasteMode) params.mode = "paste";
  const raw = await a11yRequest("/input", params, 12000);
  const v = parseResult(raw);
  if (!v.ok && !Array.isArray(v.attempts)) {
    const reason = failReason(raw, v) || "TARGET_NOT_FOUND";
    return {
      ok: false,
      error: typeof v.error === "string" && v.error ? v.error : GUIDE_TEXT,
      reason
    };
  }

  let ok = v.ok !== false;
  let verified = v.verified === true;
  let method = typeof v.method === "string" ? v.method : "";
  let actual = typeof v.actual === "string" ? v.actual : "";
  let warning = typeof v.warning === "string" ? v.warning : "";
  let error = typeof v.error === "string" ? v.error : "";
  const expected = typeof v.expected === "string" ? v.expected : text;
  const attempts = (Array.isArray(v.attempts) ? v.attempts : []).map((a) => ({
    method: String((a && a.method) || ""),
    ok: !!(a && a.ok === true),
    readback: typeof (a && a.readback) === "string" ? a.readback : ""
  }));

  if (!verified) {
    if (clearing) {
      // 批次10a B9-③：清空在 WebView 输入框上 SET_TEXT/paste 均 no-op（回读不变），
      // 且 279 粘贴对清空无意义 → 退化 keyevent 清空链
      if (!privilegedAvailable()) {
        ok = false;
        error = error || "清空失败：setText 未生效且无 root/Shizuku 特权通道执行 keyevent 清空链";
        warning = (warning ? warning + " " : "") +
          "清空 WebView 输入框需要 keyevent 特权通道（root/Shizuku）。";
      } else {
        const chain = await keyeventClearChain(attempts, pasteMode, displayId);
        const finalProbe = await imeProbe("", displayId);
        const rbActual = finalProbe.unreachable ? chain.readback : finalProbe.actual;
        attempts.push({ method: "keyevent-clear-verify", ok: rbActual === "", readback: rbActual });
        if (rbActual === "") {
          ok = true;
          verified = true;
          method = "keyevent-clear";
          actual = "";
          error = "";
          warning = "";
        } else {
          ok = false;
          verified = false;
          actual = rbActual;
          error = "清空失败：keyevent 清空链执行完毕但回读仍非空";
          warning = "回读=" + rbActual + "。请用 android_screenshot 确认界面，必要时手动清空。";
        }
      }
    } else if (privilegedAvailable()) {
      const r = await privCmd("input keyevent 279", 12000, displayId);
      await new Promise((r2) => setTimeout(r2, 250));
      const verifyParams = { text, verifyOnly: "1" };
      if (displayId !== null) verifyParams.displayId = String(displayId);
      const back = parseResult(await a11yRequest("/input", verifyParams, 8000));
      const rbActual = typeof back.actual === "string" ? back.actual : "";
      const matched = back.ok !== false && back.verified === true;
      attempts.push({ method: "keyevent-paste", ok: r.ok === true, readback: rbActual });
      if (matched) {
        ok = true;
        verified = true;
        method = "keyevent-paste";
        actual = rbActual;
        error = "";
        warning = "";
      } else {
        actual = rbActual;
        ok = false;
        if (r.ok !== true) {
          error = "输入失败：特权通道执行 `input keyevent 279` 失败（" +
            (r.error || r.stderr || ("exit=" + r.exit_code)) + "）";
          warning = "无障碍 setText/paste 与特权粘贴均未通过回读校验，文本没有被写入。";
        } else {
          error = "输入未生效：setText / paste / keyevent-279 三级回读均与期望不符";
          warning = "回读=" + rbActual + " / 期望=" + expected + "。建议先用 android_tap 点击目标输入框确认焦点，再用 android_screenshot 确认界面。";
        }
      }
    } else if (ok) {
      warning = (warning ? warning + " " : "") +
        "无 root/Shizuku 特权通道可回退（input keyevent 279 不可用）：已按未知处理，请用 android_screenshot 确认。";
    } else {
      error = error || "输入未生效（setText/paste 均失败）";
      warning = (warning ? warning + " " : "") +
        "无 root/Shizuku 特权通道可回退（input keyevent 279 不可用）。";
    }
  }

  let reason = "";
  if (ok && !verified) {
    reason = "";
  } else if (!ok) {
    reason = "POSTCONDITION_FAILED";
  }
  if (ok && verified && (method === "paste" || method === "keyevent-paste")) {
    let clipNote = "剪贴板提示：粘贴写入依赖系统剪贴板，注入文本仍残留在剪贴板中（含敏感内容时建议清理）。";
    if (args.clear_clipboard === true) {
      const clr = parseAppJson(await appRequest("/clipboard", { action: "clear" }, 5000));
      clipNote = clr && clr.ok
        ? "剪贴板已按要求清空（clear_clipboard=true）。"
        : "剪贴板清理失败（" + String((clr && clr.error) || "未知错误") + "），注入文本仍残留在剪贴板中。";
    }
    warning = (warning ? warning + " " : "") + clipNote;
  }

  return {
    ok,
    ...(error ? { error } : {}),
    ...(typeof v.focused === "boolean" ? { focused: v.focused } : {}),
    method,
    verified,
    ...(reason ? { reason } : {}),
    ...(attempts.length ? { attempts } : {}),
    ...(warning ? { warning } : {}),
    ...(expected ? { expected } : {}),
    ...(actual ? { actual } : {})
  };
}

/**
 * 批次80：type 的「特权兜底」链路（从单工具 android_type 抽出，供 android_act 事务复用）。
 *
 * 分工：typeCore = 无障碍 setText/paste + 回读校验（两条路径共用）；本函数 = 回读未通过时的兜底：
 *   1) 虚拟屏（displayId 非空）先试「写剪贴板 + /vscreen/key 279 粘贴」再 A11y 回读；
 *   2) 仍不通过则走 privilegedType（按 displayId 直注 `input [-d N] text`，自带回读校验）；
 *   3) displayId 为空时只做第 2 步（主屏）。
 * 返回值语义与原单工具内联分支一致（未 verified 时可能返回 unverified 结果）。
 */
async function typePrivilegedFallback(args, displayId, direct) {
  const scoped = displayId !== null && displayId !== undefined;
  const text = String(args.text == null ? "" : args.text);
  if (scoped) {
    // 语义 setText/paste 不可回读时，保留剪贴板 + 虚拟屏粘贴兼容链路，并再次通过 A11y 回读。
    const w = await appRequest("/clipboard", { action: "write", content: text }, 8000);
    const parseW = parseAppJson(w);
    if (parseW && parseW.ok === true) {
      await vscreenBridge("POST", "/vscreen/key", { key: "279" }, 12000);
      await new Promise((r) => setTimeout(r, 200));
      const verifyParams = { text, verifyOnly: "1", displayId: String(displayId) };
      const verified = parseResult(await a11yRequest("/input", verifyParams, 8000));
      if (args.clear_clipboard !== false) {
        await appRequest("/clipboard", { action: "clear" }, 5000);
      }
      if (verified.verified === true) {
        return { ok: true, focused: verified.focused === true, method: "vscreen-key-paste", verified: true };
      }
    }
  }
  // 批次72：虚拟屏内软键盘不会弹出（IME_NOT_READY），改用特权通道按 displayId 直接注入。
  const priv = await privilegedType(args, scoped ? displayId : null);
  if (priv.verified === true) {
    return scoped ? { ...priv, method: "vscreen-" + (priv.method || "priv") } : priv;
  }
  if (direct && (direct.ok === false || direct.reason === "IME_NOT_READY")) {
    return { ...direct, ...(priv.warning ? { warning: priv.warning } : {}) };
  }
  return priv;
}

async function scrollCore(args, opts = {}) {
  const raw = await a11yRequest("/scroll", { direction: String(args.direction || "down") }, 8000);
  const v = parseResult(raw);
  if (!v.ok) {
    const reason = failReason(raw, v);
    return { ok: false, error: v.error || GUIDE_TEXT, ...(reason ? { reason } : {}) };
  }
  dumpCache = { at: 0, ok: false, value: null, version: 0, displayId: null };
  const warning = recordAction("scroll:" + String(args.direction || "down"));
  const uiHint = opts.uiHint !== false ? await uiHintAfterAction() : undefined;
  return {
    ok: v.ok !== false,
    ...(v.method ? { method: String(v.method) } : {}),
    ...(v.error ? { error: v.error } : {}),
    ...(warning ? { warning } : {}),
    ...(uiHint ? { uiHint } : {})
  };
}

// ---------------------------------------------------------------------------
// #56 android_act 事务辅助：
// scroll/back/home 无 App 侧事件回执，用 /dump?if_version 条件请求做局部验证——
// 动作前取一次权威 version（强制快照，changed:false 时即当前版本），动作后带同一
// version 条件请求：changed:false（version 未递增）即判定动作未生效。
// App 侧 version 只增不减（批次8b ScreenState），事件驱动打脏，语义可靠。
// ---------------------------------------------------------------------------
const ACT_ACTIONS = ["tap", "type", "scroll", "back", "home"];
const ACT_SCROLL_DIRS = ["up", "down", "left", "right"];

async function actVerifyBySSE(beforeVersion) {
  if (!(beforeVersion > 0)) return { ok: true, unverifiable: true };
  await new Promise((r) => setTimeout(r, 450));
  const cv = await conditionalDump(beforeVersion);
  if (!cv.ok) {
    return { ok: false, reason: cv.reason || "BRIDGE_UNREACHABLE", error: cv.error || GUIDE_TEXT };
  }
  if (cv.changed === false) {
    return { ok: false, reason: "POSTCONDITION_FAILED", error: "SSE 验证未通过：界面无变化（version 未递增），动作可能未生效" };
  }
  return { ok: true, version: typeof cv.version === "number" ? cv.version : 0 };
}

/** android_act 输出渲染：逐步列出动作与验证结果。 */
function renderAct(_a, v) {
  if (!v) return [{ type: "text", text: "执行失败：未知错误" }];
  const lines = [];
  if (v.ok) {
    lines.push("事务完成：全部 " + (Array.isArray(v.results) ? v.results.length : 0) + " 步验证通过。");
  } else {
    lines.push("事务在第 " + v.step + " 步失败停止（reason=" + (v.reason || "POSTCONDITION_FAILED") + "）" +
      (v.error ? "：" + v.error : ""));
  }
  (Array.isArray(v.results) ? v.results : []).forEach((r, i) => {
    const parts = ["step" + (i + 1) + " " + (r && r.action || "?") + " " + (r && r.ok ? "OK" : "FAIL")];
    if (r && r.method) parts.push("method=" + r.method);
    if (r && "verified" in r) parts.push("verified=" + r.verified);
    if (r && r.error) parts.push("error=" + r.error);
    lines.push("- " + parts.join("，"));
  });
  if (typeof v.version === "number" && v.version > 0) lines.push("version=" + v.version);
  if (v.notes) lines.push(v.notes);
  return [{ type: "text", text: lines.join("\n") }];
}

function apply(ctx) {
  // 状态查询（始终注册：AI 先查状态，未开启时引导用户去系统设置开启）
  ctx.tools.register(defineTool({
    name: "android_a11y_status",
    description:
      "查询 DeepSeek Harness 无障碍服务（屏幕助手）是否已开启，以及当前屏幕焦点应用。" +
      "无障碍服务开启后，AI 才能读取屏幕内容并替你点击/输入/滚动（android_screen/android_tap 等）。" +
      "若未开启（running=false），请引导用户：系统设置 → 无障碍 →（已下载的服务/服务）→ 开启「DeepSeek Harness 屏幕助手」。" +
      "本工具在无障碍桥 3181 不可达时会自动降级询问 App 原生桥（3081），据此区分两种情况：" +
      "① a11yRunning=false —— 无障碍开关被系统/ROM 关闭（force-stop 后常见），此时应调用 android_open_a11y_settings " +
      "打开设置页让用户重新开启，不要反复重试读屏/点击；" +
      "② a11yRunning=true 但桥不可达 —— 服务可能正在启动或已崩溃，稍后重试或重启 App。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          running: { type: "boolean" },
          a11yRunning: { type: "boolean" },
          a11ySource: { type: "string" },
          hint: { type: "string" },
          package: { type: "string" },
          nodeCount: { type: "number" },
          canScreenshot: { type: "boolean" },
          apiLevel: { type: "number" }
        }
      },
      render: (_a, v) => renderResult(v)
    },
    async execute(args, exec) {
      const v = parseResult(await a11yRequest("/status", undefined, 4000));
      if (v.ok) {
        // 3181 可用：保持原有字段（向后兼容）+ 明确 a11yRunning=true
        return {
          ok: true,
          running: v.running === true,
          a11yRunning: true,
          package: v.package || "",
          nodeCount: typeof v.nodeCount === "number" ? v.nodeCount : 0,
          canScreenshot: v.canScreenshot === true,
          apiLevel: typeof v.apiLevel === "number" ? v.apiLevel : 0
        };
      }
      // 3181 不可达（连接失败/超时）：降级问 3081，避免只丢一个裸连接错误让 AI 反复重试
      const app = parseAppJson(await appRequest("/status", undefined, 4000));
      if (app && app.a11yRunning === false) {
        // 批次6 自愈（阶段1实验结论：可行）：root 写回 secure 设置后服务立即重绑。
        // 尝试一次 /a11y-selfheal，成功则直接回到可用状态；失败回落到现有引导文案。
        const heal = parseAppJson(await appRequest("/a11y-selfheal", {}, 15000));
        if (heal && heal.ok === true && heal.running === true) {
          // 重绑成功：再问一次 3181 拿 package/nodeCount（拿不到也按可用返回）
          const again = parseResult(await a11yRequest("/status", undefined, 4000));
          return {
            ok: true,
            running: true,
            a11yRunning: true,
            package: again.ok ? (again.package || "") : "",
            nodeCount: again.ok && typeof again.nodeCount === "number" ? again.nodeCount : 0,
            canScreenshot: again.ok ? again.canScreenshot === true : false,
            apiLevel: again.ok && typeof again.apiLevel === "number" ? again.apiLevel : 0
          };
        }
        return {
          ok: true,
          running: false,
          a11yRunning: false,
          a11ySource: typeof app.a11ySource === "string" ? app.a11ySource : "none",
          hint: A11Y_OFF_HINT
        };
      }
      if (app && app.a11yRunning === true) {
        return {
          ok: false,
          running: false,
          a11yRunning: true,
          a11ySource: typeof app.a11ySource === "string" ? app.a11ySource : "",
          error: "无障碍开关本身是开启的（a11yRunning=true），但无障碍桥（3181）不可达——" +
            "服务可能正在启动或已崩溃。请稍等几秒后重试本工具；若持续不可达，引导用户重启 App。"
        };
      }
      return {
        ok: false,
        running: false,
        error: "无障碍桥（3181）与 " + APP_BRIDGE_HINT + " 3181 侧详情：" +
          (v.error || "未知")
      };
    }
  }));

  // 打开系统「无障碍」设置页（无障碍被系统关闭时，引导用户手动重新开启）
  ctx.tools.register(defineTool({
    name: "android_open_a11y_settings",
    description:
      "打开手机系统「设置 → 无障碍」页面（真实跳转到系统界面）。" +
      "用途：当 android_a11y_status 返回 a11yRunning=false（无障碍服务被 force-stop/系统重启关掉了开关）时，" +
      "用它把用户直接送到无障碍设置页，让用户手动重新开启「DeepSeek Harness 屏幕助手」。" +
      "本工具只负责打开设置页并提示用户开启，无法代替用户点击开关；" +
      "用户开启后请再次调用 android_a11y_status 确认 running=true，再继续读屏/点击操作。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" }
        }
      },
      render: (_a, v) => [{
        type: "text",
        text: v && v.ok
          ? "已打开无障碍设置页，请开启 DeepSeek Harness 的无障碍服务（系统设置 → 无障碍 →（已下载的服务/服务）→ 「DeepSeek Harness 屏幕助手」）。" +
            "开启后请再次调用 android_a11y_status 确认 running=true。"
          : "打开无障碍设置页失败：" + ((v && v.error) || "未知错误")
      }]
    },
    async execute(args, exec) {
      const app = parseAppJson(await appRequest("/a11y-open-settings", {}, 6000));
      if (app && app.ok === true) return { ok: true };
      return {
        ok: false,
        error: "无法打开无障碍设置页。" + APP_BRIDGE_HINT +
          (app && app.error ? "（3081 报错：" + String(app.error) + "）" : "") +
          " 也可改为口头引导用户手动进入：系统设置 → 无障碍 → 开启「DeepSeek Harness 屏幕助手」。"
      };
    }
  }));

  // 读屏（控件树）
  ctx.tools.register(defineTool({
    name: "android_screen",
    description:
      "读取当前屏幕的控件树（无障碍）：返回前台应用包名、屏幕可见控件的文字/描述/坐标/可点击性。" +
      "坐标是屏幕绝对像素坐标，可直接用于 android_tap 的 x/y；fx/fy 是 0~1 分数坐标（推荐，免疫截图缩放）。" +
      "结果缓存 10 秒：连续操作同一界面时 android_tap 会复用本快照，无需重复调用本工具；界面切换后请重新调用（或用 android_screen_refresh 强制刷新）。需要已开启无障碍服务。" +
      "同类重复操作 ≥3 次（批量点击/逐项填写/列表遍历）时，优先改用 android_chroot_exec 写脚本批处理（uiautomator/输入注入/文件操作），更快更稳。",
    parameters: {
      if_version: { type: "number", description: "可选：带上一次返回的 version 做条件请求（ScreenState 比对）——屏幕未变化时 App 侧不重遍历控件树，秒回 changed:false；有变化时返回全量新快照与新 version" },
      scope: { type: "string", enum: ["auto", "current"], description: "可选：auto（默认）沿用虚拟屏透明路由；current 强制读取用户主屏真实前台应用，不创建或读取虚拟屏" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          package: { type: "string" },
          count: { type: "number" },
          truncated: { type: "boolean" },
          hint: { type: "string" },
          reason: { type: "string" },
          version: { type: "number" },
          changed: { type: "boolean" },
          cached: { type: "boolean" },
          nodes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                desc: { type: "string" },
                cls: { type: "string" },
                vid: { type: "string" },
                x: { type: "number" },
                y: { type: "number" },
                w: { type: "number" },
                h: { type: "number" },
                clickable: { type: "boolean" },
                input: { type: "boolean" },
                checked: { type: "boolean" },
                selected: { type: "boolean" },
                scrollable: { type: "boolean" },
                depth: { type: "number" },
                fx: { type: "number" },
                fy: { type: "number" }
              }
            }
          }
        }
      },
      render: renderScreen
    },
    async execute(args, exec) {
      if (normalizeScreenScope(args.scope) === "current") {
        return getCurrentScreenSnapshot();
      }
      let displayId = null;
      if (isVscreenModeEnabled(ctx)) {
        const ensured = await ensureVscreenCreated(ctx);
        if (!ensured.ok) {
          // 只读降级主屏、写操作不静默降级：建屏被拒（如 App 侧「只读任务」硬闸门）时改读用户主屏，不返回错误
          return readMainScreenFallback();
        }
        displayId = ensured.displayId;
      }
      // #55：调用方带 if_version 时直接走 App 侧条件请求（绕过插件层 10s TTL）
      if (typeof args.if_version === "number" && Number.isFinite(args.if_version) && args.if_version >= 0) {
        return conditionalDump(Math.floor(args.if_version), displayId);
      }
      const v = await getScreenSnapshot(false, displayId);
      if (!v.ok) return v;
      const { cached, ...rest } = v;
      return { ...rest, cached: cached === true };
    }
  }));

  // 强制刷新屏幕快照（界面切换后使用，绕过 10 秒缓存）
  ctx.tools.register(defineTool({
    name: "android_screen_refresh",
    description:
      "强制刷新并返回当前屏幕控件树快照（绕过 android_screen 的 10 秒缓存）。" +
      "在点击/滚动导致界面切换后，若 android_screen 返回的仍是旧界面，用本工具强制重新读屏。",
    parameters: {
      vid: { type: "string", description: "可选：只读该 viewId（viewIdResourceName，如 com.x:id/name 或裸名 name）为根的子树（定向 dump）" },
      depth: { type: "number", description: "可选：遍历深度上限（默认 40）" },
      if_version: { type: "number", description: "可选：带上一次返回的 version 做条件请求（ScreenState 比对）——屏幕未变化时 App 侧不重遍历控件树，秒回 changed:false；有变化时返回全量新快照与新 version（与 vid/depth 互斥，定向 dump 不参与条件请求）" },
      scope: { type: "string", enum: ["auto", "current"], description: "可选：auto（默认）沿用虚拟屏透明路由；current 强制读取用户主屏真实前台应用，不创建或读取虚拟屏" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          package: { type: "string" },
          count: { type: "number" },
          truncated: { type: "boolean" },
          hint: { type: "string" },
          reason: { type: "string" },
          version: { type: "number" },
          changed: { type: "boolean" },
          cached: { type: "boolean" },
          nodes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                desc: { type: "string" },
                cls: { type: "string" },
                vid: { type: "string" },
                x: { type: "number" },
                y: { type: "number" },
                w: { type: "number" },
                h: { type: "number" },
                clickable: { type: "boolean" },
                input: { type: "boolean" },
                checked: { type: "boolean" },
                selected: { type: "boolean" },
                scrollable: { type: "boolean" },
                depth: { type: "number" },
                fx: { type: "number" },
                fy: { type: "number" }
              }
            }
          }
        }
      },
      render: renderScreen
    },
    async execute(args, exec) {
      if (normalizeScreenScope(args.scope) === "current") {
        const params = {};
        if (args.vid !== undefined && String(args.vid).trim()) params.vid = String(args.vid).trim();
        if (args.depth !== undefined) params.depth = String(Math.max(1, Math.min(40, Number(args.depth) || 40)));
        return getCurrentScreenSnapshot(params);
      }
      let displayId = null;
      if (isVscreenModeEnabled(ctx)) {
        const ensured = await ensureVscreenCreated(ctx);
        if (!ensured.ok) {
          // 只读降级主屏、写操作不静默降级：建屏被拒（如 App 侧「只读任务」硬闸门）时改读用户主屏（沿用 scope=current 的定向 dump 参数），不返回错误
          const params = {};
          if (args.vid !== undefined && String(args.vid).trim()) params.vid = String(args.vid).trim();
          if (args.depth !== undefined) params.depth = String(Math.max(1, Math.min(40, Number(args.depth) || 40)));
          return readMainScreenFallback(params);
        }
        displayId = ensured.displayId;
      }
      // 批次6：带 vid/depth 时走定向 dump（App 端 /dump 可选参数，默认行为不变；绕过缓存）
      if ((args.vid !== undefined && String(args.vid).trim()) || args.depth !== undefined) {
        const params = {};
        if (displayId !== null && displayId !== undefined) params.displayId = String(displayId);
        if (args.vid !== undefined && String(args.vid).trim()) params.vid = String(args.vid).trim();
        if (args.depth !== undefined) params.depth = String(Math.max(1, Math.min(40, Number(args.depth) || 40)));
        const raw = await a11yRequest("/dump", params, 8000);
        const v = parseResult(raw);
        if (!v.ok) {
          const reason = failReason(raw, v) || "BRIDGE_UNREACHABLE";
          return { ok: false, error: v.error || GUIDE_TEXT, reason };
        }
        return normalizeDump(v);
      }
      // #55：带 if_version 时走 App 侧条件请求（强制刷新语义下 App 确认未变时同样秒回）
      if (typeof args.if_version === "number" && Number.isFinite(args.if_version) && args.if_version >= 0) {
        return conditionalDump(Math.floor(args.if_version), displayId);
      }
      const v = await getScreenSnapshot(true, displayId);
      if (!v.ok) return v;
      const { cached, ...rest } = v;
      return { ...rest, cached: cached === true };
    }
  }));

  // 点击
  ctx.tools.register(defineTool({
    name: "android_tap",
    description:
      "点击屏幕上的控件。传 text（控件文字，模糊包含匹配，优先可点击项）、desc（内容描述）、x/y（屏幕绝对像素坐标）或 fx/fy（0~1 分数坐标）。" +
      "优先用 fx/fy 分数坐标（相对屏幕比例）：截图会被模型查看器缩放，用绝对像素容易点偏，分数坐标免疫缩放。" +
      "至少给一个；同时给了 text 与坐标时按 text 查找优先，找不到再按坐标点。需要已开启无障碍服务。\n" +
      "批次75（虚拟屏）：text/desc/vid 会在**虚拟屏语义树内**定位后注入虚拟屏，与坐标路径同一坐标系；" +
      "但定位不到时**不会退化为主屏坐标兜底**，而是诚实失败 TARGET_NOT_FOUND（避免误点主屏）——" +
      "此时先用 android_screen / android_screen_refresh 核对文案，或改用 fx/fy。\n" +
      "可靠性说明：命中 WebView/网页内部节点时无障碍 ACTION_CLICK 常静默无效，本工具会自动降级为坐标手势（method=gesture-webview）；" +
      "若目标坐标落在软键盘区域内，会先收起输入法再点（method 带 -after-ime-dismiss，degraded=true）。" +
      "返回的 found=false 表示本次点击没有真正执行，不能当作成功。\n" +
      "批次19：返回 reason=INJECT_NO_EFFECT（method=gesture-verified-noop）表示点击已注入但界面无变化" +
      "（目标未响应无障碍注入，部分列表行/触控驱动控件如此）——此时改用特权通道 android_input(action=tap) 点同一坐标。",
    parameters: {
      vid: { type: "string", description: "控件 viewId（viewIdResourceName，如 com.example:id/btn 或裸名 btn；精确匹配，优先级最高）" },
      text: { type: "string", description: "控件文字（模糊包含匹配）" },
      desc: { type: "string", description: "控件内容描述（模糊包含匹配）" },
      x: { type: "number", description: "屏幕绝对 x 坐标（像素）" },
      y: { type: "number", description: "屏幕绝对 y 坐标（像素）" },
      fx: { type: "number", description: "分数 x 坐标（0~1，相对屏幕宽度比例；推荐，避免截图缩放误差）" },
      fy: { type: "number", description: "分数 y 坐标（0~1，相对屏幕高度比例；推荐，避免截图缩放误差）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          found: { type: "boolean" },
          method: { type: "string" },
          warning: { type: "string" },
          degraded: { type: "boolean" },
          imeTopY: { type: "number" },
          reason: { type: "string" },
          uiHint: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                fx: { type: "number" },
                fy: { type: "number" }
              }
            }
          }
        }
      },
      render: (_a, v) => renderResult(v)
    },
    async execute(args, exec) {
      // 批次74：不再自带一份硬编码 1080x1920 的虚拟屏换算——统一交给 tapCore，
      // 由它按目标屏真实尺寸（经 /display-info 查询）换算并路由到 /vscreen/tap。
      // 这样单工具与 android_act 事务共用同一坐标语义，杜绝「同一 fx/fy 两套结果」。
      return tapCore(args, { ctx });
    }
  }));

  // 输入文本（无障碍版；与特权版 android_input 区分，避免工具名冲突）
  ctx.tools.register(defineTool({
    name: "android_type",
    description:
      "在当前聚焦的输入框中输入文本（通过无障碍服务）。输入前通常先用 android_tap 点击目标输入框使其聚焦。需要已开启无障碍服务。\n" +
      "可靠性（v1.9.x）：写入后会回读校验，绝不再「静默成功」。结果看 verified 字段——" +
      "verified=true 表示已回读确认文本确实写进去了；verified=false 且 ok=true 表示节点不暴露文本、无法回读，**必须用 android_screenshot 或 android_screen 确认界面是否真的有内容**；" +
      "ok=false 表示各级写入均失败（会带 expected/actual 与 attempts 明细）。\n" +
      "回退链：setText → 剪贴板粘贴 → （已授权 root/Shizuku 时）特权 input keyevent 279 末级兜底。" +
      "网页/WebView/contenteditable 输入框建议 paste:true。末级兜底需要输入法处于连接状态（键盘已弹出）才有效，" +
      "键盘收起或输入框未真正聚焦时会无效——始终以 verified 与回读结果为准。\n" +
      "批次10a：输入前做 IME/焦点预检（verifyOnly 探针）——目标未聚焦且输入法未弹出时直接快速失败" +
      "（reason=IME_NOT_READY，hint 给出补救路径），不再空转三级回退链；\n" +
      "清空输入框（批次10a 升级）：text 传空字符串 \"\" 即清空当前输入框。WebView 输入框上 setText(\"\") " +
      "无效应时自动退化 keyevent 清空链（ESC 收粘贴条 → MOVE_END → DEL×20 分轮回读早停），" +
      "以最终回读为空判定 verified；焦点/IME 不就绪时允许自动点输入框中心聚焦一次，失败则如实报错。\n" +
      "注：本工具是无障碍版输入（不需要 root/Shizuku）；已授权 Shizuku/root 时另有系统级 android_input（input text/tap/swipe/keyevent），两者能力不同。\n" +
      "剪贴板（批次 7 #54）：paste 写入依赖系统剪贴板，注入文本会残留在剪贴板中——返回时会提示；" +
      "clear_clipboard:true 可在写入成功后立即清空剪贴板（经 App 原生桥）。",    parameters: {
      text: { type: "string", required: true, description: "要输入的文本；传空字符串 \"\" 表示清空当前输入框" },
      paste: { type: "boolean", description: "是否优先用剪贴板粘贴方式输入（WebView/网页输入框建议 true；默认 false 先试 setText）" },
      clear_clipboard: { type: "boolean", description: "粘贴写入成功后是否清空剪贴板（默认 false；处理敏感内容时建议 true）" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          focused: { type: "boolean" },
          method: { type: "string" },
          verified: { type: "boolean" },
          warning: { type: "string" },
          reason: { type: "string" },
          hint: { type: "string" },
          expected: { type: "string" },
          actual: { type: "string" },
          attempts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                method: { type: "string" },
                ok: { type: "boolean" },
                readback: { type: "string" }
              }
            }
          }
        }
      },
      render: (_a, v) => renderResult(v)
    },
    async execute(args, exec) {
      if (isVscreenModeEnabled(ctx)) {
        const ensured = await ensureVscreenCreated(ctx);
        if (!ensured.ok) {
          return { ok: false, error: (ensured.hint ? `${ensured.error || "创建虚拟屏失败"} — ${ensured.hint}` : (ensured.error || "创建虚拟屏失败")), reason: ensured.reason || "VSCREEN_CREATE_FAILED" };
        }
        const displayId = ensured.displayId;
        const direct = await typeCore(args, { displayId, skipImePrecheck: true });
        if (direct.verified === true) return { ...direct, method: "vscreen-" + (direct.method || "a11y") };

        // 批次80：兜底链路抽到 typePrivilegedFallback（与 android_act 事务共用，避免两条路再分叉）。
        return typePrivilegedFallback(args, displayId, direct);
      }
      // #56：核心逻辑抽至模块级 typeCore（android_act 事务复用同一验证链路）
      const direct = await typeCore(args);
      if (direct.verified === true) return direct;
      // 批次72：主屏 IME 未就绪/写入未生效时，同样回退特权通道注入（默认屏，无 -d 作用域）。
      if (direct.reason === "IME_NOT_READY" || direct.reason === "POSTCONDITION_FAILED") {
        const priv = await privilegedType(args, null);
        if (priv.verified === true) return priv;
      }
      return direct;
    }
  }));

  // 返回 / 回桌面
  const globalAction = (toolName, actionPath, description) => {
    ctx.tools.register(defineTool({
      name: toolName,
      description,
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true },
            error: { type: "string" }
          }
        },
        render: (_a, v) => renderResult(v)
      },
      async execute(args, exec) {
        const raw = await a11yRequest(actionPath, undefined, 6000);
        const v = parseResult(raw);
        if (!v.ok) return { ok: false, error: v.error || GUIDE_TEXT };
        return { ok: v.ok !== false, ...(v.error ? { error: v.error } : {}) };
      }
    }));
  };
  globalAction("android_back", "/back", "模拟按下系统返回键（回到上一界面）。需要已开启无障碍服务。");
  globalAction("android_home", "/home", "模拟按下系统 Home 键（回到桌面）。需要已开启无障碍服务。");

  // 滚动
  ctx.tools.register(defineTool({
    name: "android_scroll",
    description:
      "在当前可滚动区域滚动屏幕：direction 为 up（向上滚动看更上面内容）/ down / left / right。" +
      "用于翻页、浏览长列表。需要已开启无障碍服务。",
    parameters: {
      direction: {
        type: "string", required: true, enum: ["up", "down", "left", "right"],
        description: "滚动方向"
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          method: { type: "string" },
          warning: { type: "string" },
          reason: { type: "string" },
          uiHint: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                fx: { type: "number" },
                fy: { type: "number" }
              }
            }
          }
        }
      },
      render: (_a, v) => renderResult(v)
    },
    async execute(args, exec) {
      // #56：核心逻辑抽至模块级 scrollCore（android_act 事务复用同一链路）
      return scrollCore(args);
    }
  }));

  // #56 事务式连续执行（android_act）：一次调用安全连续执行一组动作，
  // 每步局部验证通过才走下一步，失败立即停止并返回结构化结果。
  ctx.tools.register(defineTool({
    name: "android_act",
    description:
      "事务式连续执行一组屏幕动作（1~8 步）：每步执行后立即做局部验证，验证通过才执行下一步；" +
      "任一步失败立即停止（后续动作不执行），返回 {ok:false, step, reason, results, notes}；全部通过返回 {ok:true, results, version}。" +
      "**只保证「逐步验证+失败即停」，不保证原子回滚**——失败后界面可能停留在中间状态，" +
      "请用 android_screen / android_see 确认现状后再决定补救（事务结果里每步明细已给出失败步与原因）。\n" +
      "动作白名单（封闭，非法类型整单拒绝且一步都不执行，reason=INVALID_ARGUMENT）：\n" +
      "- tap：点击（参数 vid/text/desc/x,y/fx,fy，与 android_tap 相同的复合定位与点击验证；" +
      "与单工具的差异：事务内 text/desc/vid 定位不到节点时直接 TARGET_NOT_FOUND 停止，" +
      "**不做单工具「找不到再按坐标点」的盲坐标兜底**——防止界面已切换时盲点坐标造成非预期跳转；" +
      "已定位到节点时的 bounds 手势降级不变）\n" +
      "- type：向当前聚焦输入框输入文本（参数 text 必填、空串=清空输入框，可选 paste/clear_clipboard，" +
      "与 android_type 相同的 setText→粘贴→回读校验链路）\n" +
      "- scroll：滚动（参数 direction=up/down/left/right）\n" +
      "- back / home：系统返回键 / Home 键（无参数）\n" +
      "每步验证方式：tap 用 App 侧点击事件验证（found）；type 用回读校验（verified，verified=false 视为未确认、同样停止）；" +
      "scroll/back/home 用屏幕 version 条件请求（/dump if_version，动作前后界面无变化=未生效）。\n" +
      "适合把「点输入框→输入→点发送」这类确定性序列从多次工具往返压缩为一次调用；" +
      "含探索、需看图决策或 EXPENSIVE/有副作用的操作（截图/读屏/发短信/改设置等）不要放入事务。" +
      "需要已开启无障碍服务。",
    parameters: {
      actions: {
        type: "array",
        required: true,
        // 注：DSH value schema DSL 不支持 maxItems（真机 defineTool 抛 UNSUPPORTED_SCHEMA），
        // 8 步上限由 execute 内整单校验强制（超出返回 INVALID_ARGUMENT，不执行任何一步）
        description: "按顺序执行的动作列表（1~8 步，逐步验证、失败即停）",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", required: true, enum: ["tap", "type", "scroll", "back", "home"], description: "动作类型（白名单封闭）" },
            vid: { type: "string", description: "tap：控件 viewId（viewIdResourceName，精确匹配，优先级最高）" },
            text: { type: "string", description: "tap：控件文字（模糊包含）；type：要输入的文本（空串=清空输入框）" },
            desc: { type: "string", description: "tap：控件内容描述（模糊包含）" },
            x: { type: "number", description: "tap：屏幕绝对 x（像素）" },
            y: { type: "number", description: "tap：屏幕绝对 y（像素）" },
            fx: { type: "number", description: "tap：分数 x（0~1，推荐）" },
            fy: { type: "number", description: "tap：分数 y（0~1，推荐）" },
            paste: { type: "boolean", description: "type：是否优先剪贴板粘贴（WebView 输入框建议 true）" },
            clear_clipboard: { type: "boolean", description: "type：写入成功后清空剪贴板（默认 false）" },
            direction: { type: "string", enum: ["up", "down", "left", "right"], description: "scroll：滚动方向" }
          }
        }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          step: { type: "number" },
          reason: { type: "string" },
          version: { type: "number" },
          notes: { type: "string" },
          results: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                action: { type: "string", required: true },
                ok: { type: "boolean", required: true },
                method: { type: "string" },
                verified: { type: "boolean" },
                error: { type: "string" }
              }
            }
          }
        }
      },
      render: (_a, v) => renderAct(_a, v)
    },
    async execute(args, exec) {
      const actions = args && args.actions;
      // 整单预校验：任何非法动作（含未知类型、缺参）都在执行任何一步之前整单拒绝
      if (!Array.isArray(actions) || actions.length === 0) {
        return { ok: false, error: "android_act 需要 actions 数组（1~8 个动作）", reason: "INVALID_ARGUMENT" };
      }
      if (actions.length > 8) {
        return { ok: false, error: "android_act 最多支持 8 步（收到 " + actions.length + " 步）", reason: "INVALID_ARGUMENT" };
      }
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (!a || typeof a !== "object" || Array.isArray(a)) {
          return { ok: false, error: "actions[" + i + "] 必须是对象", reason: "INVALID_ARGUMENT" };
        }
        if (!ACT_ACTIONS.includes(a.action)) {
          return { ok: false, error: "actions[" + i + "].action 非法: " + JSON.stringify(a.action) +
            "（白名单封闭: tap/type/scroll/back/home）", reason: "INVALID_ARGUMENT" };
        }
        if (a.action === "tap") {
          const hasLocator = [a.vid, a.text, a.desc, a.x, a.y, a.fx, a.fy]
            .some((v) => v !== undefined && String(v).length > 0);
          if (!hasLocator) {
            return { ok: false, error: "actions[" + i + "]（tap）需要 vid/text/desc/x/y/fx/fy 至少一个", reason: "INVALID_ARGUMENT" };
          }
        } else if (a.action === "type") {
          if (typeof a.text !== "string") {
            return { ok: false, error: "actions[" + i + "]（type）需要 text 字符串（空串=清空输入框）", reason: "INVALID_ARGUMENT" };
          }
        } else if (a.action === "scroll") {
          if (!ACT_SCROLL_DIRS.includes(a.direction)) {
            return { ok: false, error: "actions[" + i + "]（scroll）direction 必须是 up/down/left/right", reason: "INVALID_ARGUMENT" };
          }
        }
      }
      // 批次74：本事务的目标屏幕——虚拟屏模式取 vscreen displayId（未建屏则为 null=主屏）。
      // 读屏/校验/注入三处必须同一 displayId，否则会出现「读主屏、点虚拟屏」的错配。
      const txVscreenOn = isVscreenModeEnabled(ctx);
      const txDisplayId = txVscreenOn ? currentVscreenDisplayId() : null;
      // 逐步执行：上一步验证通过（verified 不为 false）才走下一步
      const results = [];
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        // 步间稳定间隔：上一步（tap 聚焦/动画、scroll 惯性）触发的界面/焦点变化需要
        // 落定，否则下一步的定位/输入会在过渡态上扑空（真机实测：tap→type 零间隔时
        // 焦点未注册，setText/paste/keyevent 三级回读全失败）
        if (i > 0) await new Promise((res) => setTimeout(res, 500));
        let r;
        if (a.action === "tap") {
          // 事务内 tap 定位必须基于当前屏幕：单工具靠 10 秒 TTL 缓存加速没问题，
          // 但事务的上一步往往刚改变界面（开抽屉/切页），stale 缓存会把定位引到
          // 旧布局上（真机实测：开抽屉后按 stale 缓存找不到「收起侧边栏」）。
          // 这里主动失效缓存，让 tapCore 走新鲜快照的复合定位（text+desc 合并匹配、
          // 可点击加权——比 App 侧 text 单字段匹配更可靠）。
          if (a.text || a.desc || a.vid) {
            dumpCache = { at: 0, ok: false, value: null, version: 0, displayId: null };
          }
          r = await tapCore(a, { uiHint: false, strictLocator: true, ctx });
          // 事务级动画容忍：text/desc/vid 定位未命中时，常因上一步触发的界面过渡
          // （抽屉/弹窗动画）尚未完成——等 600ms 重试一次；仍失败才判步失败。
          // 只重试这一种失败（不改失败语义），坐标 tap 不重试。
          if (r.ok === false && r.reason === "TARGET_NOT_FOUND" && (a.text || a.desc || a.vid)) {
            await new Promise((res) => setTimeout(res, 600));
            const r2 = await tapCore(a, { uiHint: false, strictLocator: true, ctx });
            if (r2.ok === true) r = r2;
          }
        } else if (a.action === "type") {
          // 批次74：事务内 type 必须与单工具 android_type 同语义——
          // 虚拟屏模式下显式带 vscreen displayId 且跳过主屏 IME 预检
          // （虚拟屏内没有可弹出的软键盘，按主屏 IME 状态预检必然 IME_NOT_READY）。
          // 批次80：补齐「回读未通过 → 特权兜底」—— 旧实现只调 typeCore，事务在 WebView / 虚拟屏里
          // 写入失败就整条事务中断，而单工具同场景会自动走 privilegedType。
          if (isVscreenModeEnabled(ctx)) {
            const ensured = await ensureVscreenCreated(ctx);
            if (!ensured.ok) {
              r = {
                ok: false,
                error: ensured.hint ? String(ensured.error || "创建虚拟屏失败") + " — " + ensured.hint : (ensured.error || "创建虚拟屏失败"),
                reason: ensured.reason || "VSCREEN_CREATE_FAILED"
              };
            } else {
              const direct = await typeCore(a, { displayId: ensured.displayId, skipImePrecheck: true });
              r = direct.verified === true
                ? { ...direct, method: "vscreen-" + (direct.method || "a11y") }
                : await typePrivilegedFallback(a, ensured.displayId, direct);
            }
          } else {
            const direct = await typeCore(a);
            if (direct.verified === true) {
              r = direct;
            } else if (direct.reason === "IME_NOT_READY" || direct.reason === "POSTCONDITION_FAILED") {
              const priv = await privilegedType(a, null);
              r = priv.verified === true ? priv : direct;
            } else {
              r = direct;
            }
          }
        } else {
          // scroll / back / home：动作前取权威基线 version，动作后 SSE 条件请求验证
          // 批次74：必须针对目标屏——虚拟屏模式下用 vscreen displayId（主屏 version 与虚拟屏无关）
          const before = await getScreenSnapshot(true, txDisplayId);
          if (!before.ok) {
            r = { ok: false, error: before.error || GUIDE_TEXT, reason: before.reason || "BRIDGE_UNREACHABLE" };
          } else {
            const bv = typeof before.version === "number" ? before.version : 0;
            let base;
            if (a.action === "scroll") {
              base = await scrollCore(a, { uiHint: false });
            } else {
              const path = a.action === "back" ? "/back" : "/home";
              const raw = await a11yRequest(path, undefined, 6000);
              const v = parseResult(raw);
              base = v.ok
                ? { ok: v.ok !== false, ...(v.error ? { error: v.error } : {}) }
                : { ok: false, error: v.error || GUIDE_TEXT, ...(failReason(raw, v) ? { reason: failReason(raw, v) } : {}) };
            }
            if (!base.ok) {
              r = base;
            } else {
              const vr = await actVerifyBySSE(bv);
              r = vr.ok
                ? { ok: true, method: base.method || a.action }
                : { ok: false, method: base.method || a.action, reason: vr.reason, error: vr.error };
            }
          }
        }
        const stepOk = !!(r && r.ok === true && r.verified !== false && r.found !== false);
        results.push({
          action: a.action,
          ok: !!(r && r.ok === true),
          ...(r && r.method ? { method: String(r.method) } : {}),
          ...(r && typeof r.verified === "boolean" ? { verified: r.verified } : {}),
          ...(r && r.error ? { error: String(r.error).slice(0, 300) } : {})
        });
        if (!stepOk) {
          const reason = (r && r.reason) || "POSTCONDITION_FAILED";
          const remaining = actions.length - i - 1;
          return {
            ok: false,
            step: i + 1,
            reason,
            results,
            notes: "第 " + (i + 1) + " 步（" + a.action + "）验证未通过，事务停止：后续 " + remaining + " 步未执行。" +
              "事务不保证原子回滚，界面可能处于中间状态——请用 android_screen/android_see 确认现状后再决定补救。" +
              (r && r.ok === true && r.verified === false
                ? "（type 返回 verified=false：节点不暴露文本、无法回读确认，可用 android_screenshot 查看是否真的写入）"
                : "")
          };
        }
      }
      // 全部通过：返回最终屏幕版本（scroll/back/home 收尾时缓存已是最新，免二次遍历）
      const last = actions[actions.length - 1];
      let version = 0;
      if ((last.action === "scroll" || last.action === "back" || last.action === "home") &&
          dumpCache.ok && dumpCache.version > 0) {
        version = dumpCache.version;
      } else {
        const snap = await getScreenSnapshot(true, txDisplayId);
        if (snap.ok && finiteNum(snap.version, 0) > 0) version = snap.version;
      }
      return { ok: true, results, ...(version > 0 ? { version } : {}) };
    }
  }));

  // 截图（需要 attachments 服务 + 视觉模型）
  ctx.inject(["attachments"], (imageCtx) => {
    imageCtx.tools.register(defineTool({
      name: "android_see",
      description:
        "截取当前屏幕（无障碍截图，无需 MediaProjection 弹窗）并把截图作为图片发送给模型查看。" +
        "适合需要看图理解布局/图片内容、或控件树（android_screen）信息不足时（尤其 Unity/游戏等无控件界面）。" +
        "**截图会被模型查看器缩放，绝对像素坐标会点偏——请优先用分数坐标（fx/fy，0~1）配合 android_tap/android_swipe/android_hold/android_gesture 操作**。" +
        "换算：截图上量到的像素 (px,py) → 屏幕坐标 = (px×scaleX, py×scaleY)（scaleX=screenW/imageW，截图原生分辨率≈屏幕，通常≈1）。" +
        "游戏/无控件界面建议 grid:true 叠加 4×4 网格，按「第几行第几列」定位更准。" +
        "需要当前模型支持图片输入；模型不支持图片时请改用 android_screen 读控件文字。" +
        "需要已开启无障碍服务且设备 Android 11+（截图能力），低版本可用 android_screen。" +
        "同类重复操作 ≥3 次（批量点击/逐项填写/列表遍历）时，优先改用 android_chroot_exec 写脚本批处理（uiautomator/输入注入/文件操作），更快更稳。",
      parameters: {
        grid: { type: "boolean", description: "true 时在截图上叠加 4×4 网格线，方便按行列定位（游戏/无控件界面推荐）" }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true },
            error: { type: "string" },
            path: { type: "string" },
            screenW: { type: "number" },
            screenH: { type: "number" },
            imageW: { type: "number" },
            imageH: { type: "number" },
            scaleX: { type: "number" },
            scaleY: { type: "number" },
            grid: { type: "number" },
            hint: { type: "string" },
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
        render: (_args, value) => {
          if (!value.ok) return renderResult(value);
          const meta = [
            `${value.image.mediaType} 屏幕截图, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes`,
            `屏幕尺寸 ${value.screenW}x${value.screenH}, 截图尺寸 ${value.imageW}x${value.imageH}, 换算系数 scaleX=${value.scaleX} scaleY=${value.scaleY}${value.grid ? `, 已叠加 ${value.grid}x${value.grid} 网格` : ""}`,
            "操作优先用分数坐标 fx/fy（0~1）：图中位置 (ix,iy) → fx=ix/imageW, fy=iy/imageH；用绝对像素 = 图中像素 × scaleX/Y"
          ].join("\n");
          return [{
            type: "text",
            text: `<path>${value.path}</path>\n<type>image</type>\n<content>\n${meta}\n</content>`
          }, {
            type: "image",
            attachment: {
              attachmentId: value.image.attachmentId,
              mediaType: value.image.mediaType,
              bytes: value.image.bytes,
              width: value.image.width,
              height: value.image.height,
              ...(value.image.name === void 0 ? {} : { name: value.image.name })
            }
          }];
        }
      },
      async execute(args, exec) {
        const attachments = imageCtx.get("attachments");
        if (attachments === void 0) {
          return { ok: false, error: "cannot screenshot: no attachment service is mounted" };
        }
        // 只读降级主屏、写操作不静默降级：建屏被拒（如 App 侧「只读任务」硬闸门）时落到下方主屏截图分支，不返回错误
        let vscreenDegraded = false;
        if (isVscreenModeEnabled(ctx)) {
          const ensured = await ensureVscreenCreated(ctx);
          if (ensured.ok) {
            const res = await vscreenBridge("GET", "/vscreen/see", null, VSCREEN_SEE_TIMEOUT_MS);
            if (!res.binary) {
              const f = vscreenFail(res, "虚拟屏截图失败");
              return { ok: false, error: f.hint ? `${f.error} — ${f.hint}` : (f.error || "虚拟屏截图失败") };
            }
            try {
              const ref = await attachments.saveImage({
                data: res.binary,
                mediaType: "image/png",
                name: "vscreen.png"
              });
              const w = Number.isFinite(ref.width) ? ref.width : 1080;
              const h = Number.isFinite(ref.height) ? ref.height : 1920;
              return {
                ok: true,
                path: "",
                screenW: w,
                screenH: h,
                imageW: w,
                imageH: h,
                scaleX: 1,
                scaleY: 1,
                hint: "虚拟屏当前画面（后台隔离模式）",
                image: {
                  attachmentId: ref.attachmentId,
                  mediaType: ref.mediaType || "image/png",
                  bytes: Number.isFinite(ref.bytes) ? ref.bytes : res.binary.length,
                  width: w,
                  height: h,
                  ...(ref.name === void 0 ? {} : { name: ref.name })
                }
              };
            } catch (e) {
              return { ok: false, error: "虚拟屏截图保存为附件失败: " + String(e && e.message || e) };
            }
          } else {
            vscreenDegraded = true;
          }
        }
        const params = args.grid === true ? { grid: "4" } : undefined;
        const raw = await a11yRequest("/screenshot", params, 20000);
        const v = parseResult(raw);
        if (!v.ok || !v.path) {
          // v1.8.4 阶段 4：降级链——给模型明确的后备路径，避免在同一路径上反复撞墙
          const base = v.error || "截图失败（可能设备低于 Android 11，或当前页面禁止截图）";
          return {
            ok: false,
            error: base + "。降级建议：" +
              "① 调 android_a11y_status 确认无障碍服务仍开启（若返回 a11yRunning=false 说明开关已被关闭，" +
              "用 android_open_a11y_settings 打开系统无障碍设置页引导用户重新开启，不要反复重试）；" +
              "② 截图不可用时改用 android_screen 读控件树（文字/坐标），按返回的 fx/fy 操作；" +
              "③ 若控件树也为空（游戏/自绘界面），按截图比例估计 fx/fy 用 android_tap 试探并观察返回。"
          };
        }
        let data;
        try {
          data = await readFile(v.path);
        } catch (e) {
          let fallbackOk = false;
          if (e && (e.code === "EACCES" || e.code === "EPERM")) {
            try {
              const b64 = await privCmd("base64 -w 0 '" + v.path + "' 2>/dev/null || base64 '" + v.path + "'", 10000);
              if (b64.ok && b64.stdout) {
                const clean = b64.stdout.replace(/[\r\n\s]+/g, "");
                if (clean.length > 0) {
                  data = Buffer.from(clean, "base64");
                  if (data && data.length > 0) fallbackOk = true;
                }
              }
            } catch {}
          }
          if (!fallbackOk) {
          return { ok: false, error: "读取截图失败: " + String(e && e.message || e) };
          }
        }
        try {
          const ref = await attachments.saveImage({
            data,
            mediaType: "image/png",
            name: "screen.png"
          });
          return {
            ok: true,
            path: v.path,
            screenW: typeof v.screenW === "number" ? v.screenW : 0,
            screenH: typeof v.screenH === "number" ? v.screenH : 0,
            imageW: typeof v.imageW === "number" ? v.imageW : 0,
            imageH: typeof v.imageH === "number" ? v.imageH : 0,
            scaleX: typeof v.scaleX === "number" ? v.scaleX : 1,
            scaleY: typeof v.scaleY === "number" ? v.scaleY : 1,
            grid: typeof v.grid === "number" ? v.grid : 0,
            ...(vscreenDegraded
              ? { hint: VSCREEN_READONLY_FALLBACK_HINT + (typeof v.hint === "string" && v.hint ? "；" + v.hint : "") }
              : (typeof v.hint === "string" && v.hint ? { hint: v.hint } : {})),
            image: {
              attachmentId: ref.attachmentId,
              mediaType: ref.mediaType,
              bytes: ref.bytes,
              width: ref.width,
              height: ref.height,
              name: ref.name
            }
          };
        } catch (e) {
          return { ok: false, error: "截图保存为附件失败: " + String(e && e.message || e) };
        }
      }
    }));
  });

  // ===================== v1.7.3 通用触摸手势工具 =====================
  // 底层：无障碍 dispatchGesture 多笔时间轴（真多指）+ willContinue 按住保持。
  // 一套原语覆盖所有触摸操作（点击/滑动/长按/按住拖动/多指同时），不绑定任何具体 App/游戏。
  // 坐标统一支持 x/y（屏幕绝对像素）或 fx/fy（0~1 分数，推荐——截图会被查看器缩放）。

  const heldSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      finger: { type: "number" },
      x: { type: "number" },
      y: { type: "number" },
      fx: { type: "number" },
      fy: { type: "number" },
      elapsedMs: { type: "number" }
    }
  };
  const touchOutput = {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ok: { type: "boolean", required: true },
        error: { type: "string" },
        durationMs: { type: "number" },
        held: { type: "array", items: heldSchema }
      }
    },
    render: (_a, v) => renderResult(v)
  };

  // 滑动
  ctx.tools.register(defineTool({
    name: "android_swipe",
    description:
      "在屏幕上从起点滑动到终点（按下→移动→抬起，单指）。" +
      "参数可用屏幕绝对像素（x1/y1→x2/y2）或分数坐标（fx1/fy1→fx2/fy2，0~1，推荐）。" +
      "durationMs 控制滑动时长（默认 300ms；慢速拖动可加大到 800~1500ms）。" +
      "适合翻页、划动列表、游戏内转向/拖动。需要已开启无障碍服务。",
    parameters: {
      x1: { type: "number", description: "起点 x（像素）" },
      y1: { type: "number", description: "起点 y（像素）" },
      x2: { type: "number", description: "终点 x（像素）" },
      y2: { type: "number", description: "终点 y（像素）" },
      fx1: { type: "number", description: "起点分数 x（0~1，推荐）" },
      fy1: { type: "number", description: "起点分数 y（0~1，推荐）" },
      fx2: { type: "number", description: "终点分数 x（0~1，推荐）" },
      fy2: { type: "number", description: "终点分数 y（0~1，推荐）" },
      durationMs: { type: "number", description: "滑动时长毫秒（默认 300）" },
      finger: { type: "number", description: "可选：指定手指（0~7）；若该手指正按住则从当前位置滑到终点并抬起" }
    },
    output: touchOutput,
    async execute(args, exec) {
      if (isVscreenModeEnabled(ctx)) {
        let x1 = args.x1 != null ? Math.round(Number(args.x1)) : null;
        let y1 = args.y1 != null ? Math.round(Number(args.y1)) : null;
        let x2 = args.x2 != null ? Math.round(Number(args.x2)) : null;
        let y2 = args.y2 != null ? Math.round(Number(args.y2)) : null;
        // 批次74：虚拟屏换算改用目标屏真实尺寸（此前硬编码 1080x1920，与主屏 1256x2808 不一致）
        if ((x1 == null || y1 == null) && args.fx1 != null && args.fy1 != null) {
          const m1 = await displayMetrics(currentVscreenDisplayId());
          const w1 = m1 && m1.width > 0 ? m1.width : 1008;
          const h1 = m1 && m1.height > 0 ? m1.height : 1792;
          x1 = Math.round(Number(args.fx1) * w1);
          y1 = Math.round(Number(args.fy1) * h1);
        }
        if ((x2 == null || y2 == null) && args.fx2 != null && args.fy2 != null) {
          const m2 = await displayMetrics(currentVscreenDisplayId());
          const w2 = m2 && m2.width > 0 ? m2.width : 1008;
          const h2 = m2 && m2.height > 0 ? m2.height : 1792;
          x2 = Math.round(Number(args.fx2) * w2);
          y2 = Math.round(Number(args.fy2) * h2);
        }
        if (x1 == null || y1 == null || x2 == null || y2 == null ||
            !Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
          return { ok: false, error: "虚拟屏模式滑动需要起点与终点坐标", reason: "INVALID_ARGUMENT" };
        }
        const durationMs = args.durationMs != null ? Math.round(Number(args.durationMs)) : 300;
        const ensured = await ensureVscreenCreated(ctx);
        if (!ensured.ok) {
          return { ok: false, error: (ensured.hint ? `${ensured.error || "创建虚拟屏失败"} — ${ensured.hint}` : (ensured.error || "创建虚拟屏失败")) };
        }
        const res = await vscreenBridge("POST", "/vscreen/swipe", { x1, y1, x2, y2, durationMs }, 8000);
        if (res.unreachable || !res.json || res.json.ok !== true) {
          const f = vscreenFail(res, "虚拟屏滑动失败");
          return { ok: false, error: f.hint ? `${f.error} — ${f.hint}` : (f.error || "虚拟屏滑动失败") };
        }
        return { ok: true, durationMs };
      }
      const params = {};
      for (const k of ["x1", "y1", "x2", "y2", "fx1", "fy1", "fx2", "fy2"]) {
        if (args[k] !== undefined) params[k] = String(Number(args[k]));
      }
      if (args.durationMs !== undefined) params.duration = String(Number(args.durationMs));
      if (args.finger !== undefined) params.finger = String(Number(args.finger));
      if (!(("x1" in params || "fx1" in params) && ("y1" in params || "fy1" in params) &&
            ("x2" in params || "fx2" in params) && ("y2" in params || "fy2" in params))) {
        return { ok: false, error: "android_swipe 需要起点(x1/y1 或 fx1/fy1)和终点(x2/y2 或 fx2/fy2)", reason: "INVALID_ARGUMENT" };
      }
      const raw = await a11yRequest("/swipe", params, 12000);
      const v = parseResult(raw);
      if (!v.ok) {
        const reason = failReason(raw, v);
        return { ok: false, error: v.error || GUIDE_TEXT, ...(reason ? { reason } : {}) };
      }
      return {
        ok: true,
        ...(typeof v.durationMs === "number" ? { durationMs: v.durationMs } : {}),
        ...(Array.isArray(v.held) ? { held: v.held } : {})
      };
    }
  }));

  // 长按 / 按住指定时长后自动抬起
  ctx.tools.register(defineTool({
    name: "android_hold",
    description:
      "在指定位置按住（长按）durationMs 毫秒后自动抬起，也可用 finger 指定手指。" +
      "**需要一直按住不放（延续到后续操作）时，不要用本工具，改用 android_touch action=down**（down 后手指保持按住，可跨调用延续）。" +
      "适合长按图标、游戏蓄力、按住等待等。需要已开启无障碍服务。",
    parameters: {
      x: { type: "number", description: "按住 x（像素）" },
      y: { type: "number", description: "按住 y（像素）" },
      fx: { type: "number", description: "分数 x（0~1，推荐）" },
      fy: { type: "number", description: "分数 y（0~1，推荐）" },
      durationMs: { type: "number", description: "按住时长毫秒（默认 500）" },
      finger: { type: "number", description: "可选：指定手指（0~7）" }
    },
    output: touchOutput,
    async execute(args, exec) {
      const params = {};
      for (const k of ["x", "y", "fx", "fy"]) {
        if (args[k] !== undefined) params[k] = String(Number(args[k]));
      }
      if (args.durationMs !== undefined) params.duration = String(Number(args.durationMs));
      if (args.finger !== undefined) params.finger = String(Number(args.finger));
      if (!(("x" in params || "fx" in params) && ("y" in params || "fy" in params))) {
        return { ok: false, error: "android_hold 需要 x/y 或 fx/fy" };
      }
      const raw = await a11yRequest("/hold", params, 12000);
      const v = parseResult(raw);
      if (!v.ok) return { ok: false, error: v.error || GUIDE_TEXT };
      return { ok: true, ...(Array.isArray(v.held) ? { held: v.held } : {}) };
    }
  }));

  // 状态式虚拟触摸屏（多指核心）
  ctx.tools.register(defineTool({
    name: "android_touch",
    description:
      "虚拟触摸屏状态式控制：action=down（按下并保持）/ move（按住的手指滑到新位置）/ up（抬起）。" +
      "每根手指用 finger 编号（0~7）区分，多根手指可同时按住——多指操作的基础。" +
      "**典型用法：按住摇杆 = down(0) 在摇杆位置，然后 move(0) 拖动控制方向，松开 = up(0)**。" +
      "down 之后手指一直按住，直到你 up / android_touch_status 确认 / 超时（30s）自动抬起。" +
      "跨调用延续：down(0) 后可直接调 android_tap/android_gesture 等，按住的手指不会被松开（自动并入后续手势）。" +
      "坐标支持 x/y 或 fx/fy（0~1，推荐）。需要已开启无障碍服务。",
    parameters: {
      action: { type: "string", required: true, enum: ["down", "move", "up"], description: "down=按下保持 / move=按住移动 / up=抬起" },
      finger: { type: "number", required: true, description: "手指编号 0~7（多指的关键：每根手指一个编号）" },
      x: { type: "number", description: "目标 x（像素）" },
      y: { type: "number", description: "目标 y（像素）" },
      fx: { type: "number", description: "分数 x（0~1，推荐）" },
      fy: { type: "number", description: "分数 y（0~1，推荐）" }
    },
    output: touchOutput,
    async execute(args, exec) {
      if (!args.action) return { ok: false, error: "android_touch 需要 action=down|move|up" };
      if (args.finger === undefined) return { ok: false, error: "android_touch 需要 finger=0~7" };
      const params = { action: String(args.action), finger: String(Number(args.finger)) };
      for (const k of ["x", "y", "fx", "fy"]) {
        if (args[k] !== undefined) params[k] = String(Number(args[k]));
      }
      const raw = await a11yRequest("/touch", params, 12000);
      const v = parseResult(raw);
      if (!v.ok) return { ok: false, error: v.error || GUIDE_TEXT };
      return { ok: true, ...(Array.isArray(v.held) ? { held: v.held } : {}) };
    }
  }));

  // 组合手势（多笔时间轴，一次全部注入）
  ctx.tools.register(defineTool({
    name: "android_gesture",
    description:
      "一次执行一组多指手势（底层多笔时间轴，全部同时注入，真多指）。strokes 数组按顺序在时间轴上执行，支持：\n" +
      "- down: 按下并保持 {kind:'down', finger, x/y 或 fx/fy}\n" +
      "- move: 按住的手指滑到新位置 {kind:'move', finger, x/y 或 fx/fy}\n" +
      "- up: 抬起 {kind:'up', finger}\n" +
      "- tap: 点按 {kind:'tap', x/y 或 fx/fy, [finger], [durationMs]}\n" +
      "- swipe: 滑动 {kind:'swipe', x/y 或 fx/fy → x2/y2 或 fx2/fy2, [durationMs]}\n" +
      "- hold: 按下→保持 durationMs→抬起 {kind:'hold', x/y 或 fx/fy, [durationMs], [finger]}\n" +
      "- wait: 等待 {kind:'wait', ms}\n" +
      "**典型游戏场景：左手按住摇杆同时右手点击 = [down(0, 摇杆), tap(1, 按钮)]**；按住摇杆拖动 = [down(0, 摇杆中心), move(0, 目标方向)]。" +
      "down 的手指在请求结束后继续保持（可跨请求延续），直到 up / 超时自动抬起。" +
      "坐标全部支持 fx/fy（0~1，推荐）。需要已开启无障碍服务。",
    parameters: {
      strokes: {
        type: "array",
        required: true,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", required: true, enum: ["down", "move", "up", "tap", "swipe", "hold", "wait"], description: "笔类型" },
            finger: { type: "number", description: "手指编号 0~7" },
            x: { type: "number", description: "目标 x（像素）" },
            y: { type: "number", description: "目标 y（像素）" },
            fx: { type: "number", description: "分数 x（0~1，推荐）" },
            fy: { type: "number", description: "分数 y（0~1，推荐）" },
            x2: { type: "number", description: "swipe 终点 x（像素）" },
            y2: { type: "number", description: "swipe 终点 y（像素）" },
            fx2: { type: "number", description: "swipe 终点分数 x（0~1）" },
            fy2: { type: "number", description: "swipe 终点分数 y（0~1）" },
            durationMs: { type: "number", description: "时长（wait=等待毫秒；tap 默认60；swipe 默认300；hold 默认500；move/up 默认100）" },
            ms: { type: "number", description: "wait 的等待毫秒" }
          }
        },
        description: "手势笔列表（按顺序在时间轴上执行）"
      }
    },
    output: touchOutput,
    async execute(args, exec) {
      const strokes = args.strokes;
      if (!Array.isArray(strokes) || strokes.length === 0) {
        return { ok: false, error: "android_gesture 需要 strokes 数组" };
      }
      const ALLOWED = ["kind", "finger", "x", "y", "fx", "fy", "x2", "y2", "fx2", "fy2", "durationMs", "ms"];
      const clean = [];
      let total = 0;
      for (const s of strokes) {
        if (!s || typeof s !== "object") return { ok: false, error: "strokes 元素必须是对象" };
        const kind = s.kind;
        const dur = typeof s.durationMs === "number" ? s.durationMs : 0;
        if (kind === "wait") total += typeof s.ms === "number" && s.ms > 0 ? s.ms : 0;
        else if (kind === "tap") total += dur > 0 ? dur : 60;
        else if (kind === "swipe") total += dur > 0 ? dur : 300;
        else if (kind === "hold") total += dur > 0 ? dur : 500;
        else if (kind === "move") total += dur > 0 ? dur : 100;
        else if (kind === "up") total += dur > 0 ? dur : 100;
        else if (kind !== "down") return { ok: false, error: "未知 kind: " + String(kind) };
        const o = {};
        for (const k of Object.keys(s)) {
          if (ALLOWED.includes(k)) o[k] = s[k];
        }
        clean.push(o);
      }
      const raw = await a11yPost("/gesture", clean, total + 15000);
      const v = parseResult(raw);
      if (!v.ok) return { ok: false, error: v.error || GUIDE_TEXT };
      return {
        ok: true,
        ...(typeof v.durationMs === "number" ? { durationMs: v.durationMs } : {}),
        ...(Array.isArray(v.held) ? { held: v.held } : {})
      };
    }
  }));

  // 触摸状态查询
  ctx.tools.register(defineTool({
    name: "android_touch_status",
    description:
      "查询当前按住的手指（虚拟触摸屏状态）。用于确认之前 down 的手指是否还在按住、坐标在哪、按住多久。" +
      "手指按住超过 30 秒会被自动抬起（安全机制）。需要已开启无障碍服务。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          error: { type: "string" },
          screenW: { type: "number" },
          screenH: { type: "number" },
          maxFingers: { type: "number" },
          holdTimeoutMs: { type: "number" },
          held: { type: "array", items: heldSchema }
        }
      },
      render: (_a, v) => renderResult(v)
    },
    async execute(args, exec) {
      const raw = await a11yRequest("/touch-status", undefined, 6000);
      const v = parseResult(raw);
      if (!v.ok) return { ok: false, error: v.error || GUIDE_TEXT };
      return {
        ok: true,
        screenW: typeof v.screenW === "number" ? v.screenW : 0,
        screenH: typeof v.screenH === "number" ? v.screenH : 0,
        maxFingers: typeof v.maxFingers === "number" ? v.maxFingers : 0,
        holdTimeoutMs: typeof v.holdTimeoutMs === "number" ? v.holdTimeoutMs : 0,
        held: Array.isArray(v.held) ? v.held : []
      };
    }
  }));
}

export { apply, inject, name, isVscreenModeEnabled, ensureVscreenCreated };
