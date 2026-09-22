/**
 * @file tests/test_batch86_p2_privileged_gate.mjs
 * @description 批次86-P2-1 行为型回归：chroot 工具面（android_chroot_exec / android_chroot_job /
 *   android_task_list / android_task_resume）改为**按设备能力注册**，且只收窄注册条件、不动实现。
 *
 * 判据（plugins/dsh-tool-android/lib/index.js → chrootToolsAvailable()）：
 *   ROOT_AVAILABLE=1（root 通道在位）**或** 设备上 rootfs 已在位（CHROOT_DIR/bin/busybox 存在）。
 * 本机（Honor BKQ-AN10 / MagicOS 11 / Android 17：无 su/root、rootfs 不存在）两条都不成立。
 *
 * 断言矩阵：
 *   A. 本机实况（托管 shell 在位 = DSH_HOSTED_DIR，ROOT_AVAILABLE 未设，rootfs 不存在）：
 *      chroot 4 件**不在**注册表；android_device_info / android_location / android_sms /
 *      android_calllog / android_contacts / android_screenshot / android_input **仍在**。
 *      （android_device_info 在表内同时是反面控制：证明特权门控确实通过、新闸门严格更窄。）
 *   B. ROOT_AVAILABLE=1（有 root 的机器）：chroot 4 件**全部在**注册表，其余工具不变。
 *   C. chrootToolsAvailable() 直测：未设 + rootfs 缺失 → false；仅托管 shell → false；ROOT_AVAILABLE=1 → true。
 *   D. 跨插件对照：dsh-tool-accessibility 的 android_tap / android_see / android_swipe / android_screen
 *      不受本闸门影响（android_tap 属该插件，非 dsh-tool-android 注册）。
 *
 * 运行：node tests/test_batch86_p2_privileged_gate.mjs（离线、默认全绿；失败打印 FAIL 并以 rc=1 退出）
 *
 * 最小假 ctx 说明：插件 apply() 实际用到 ctx.tools.register / ctx.on / ctx.get / ctx.config /
 *   ctx.permissionPresets / ctx.shell / ctx.inject(["attachments"], cb)。本用例按此逐个补最小实现——
 *   register 收集工具；on / get / config / permissionPresets / shell 为无副作用桩；
 *   inject 立即以同一 ctx 回调（等价于 attachments 服务已挂载，可多注册 android_vscreen_see）。
 *   apply() 不触碰真实进程/网络（工具只在 execute() 时才走特权通道与本地桥）。
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { register } from "node:module";
import { resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";

// 1) dsh-tools 解析钩子（与 tests/test_vscreen_router.mjs / test_batch61_readonly_fallback.mjs 同款）
const dshToolsPath = pathResolve("build/updater/devhome/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools/lib/index.js");
const dshToolsUrl = pathToFileURL(dshToolsPath).href;
const loaderCode = "export async function resolve(specifier, context, nextResolve) {" +
  "if (specifier === \"@deepseek-ai/dsh-tools\") { return { shortCircuit: true, url: " + JSON.stringify(dshToolsUrl) + " }; }" +
  "return nextResolve(specifier, context); }";
register("data:text/javascript," + encodeURIComponent(loaderCode));

// 2) 常量与被测插件
const CHROOT_DIR = "/data/local/dsh-chroot";
const ROOTFS_BUSYBOX = CHROOT_DIR + "/bin/busybox";
const CHROOT_TOOLS = ["android_chroot_exec", "android_chroot_job", "android_task_list", "android_task_resume"];
const BASIC_TOOLS = [
  "android_device_info", "android_location", "android_sms", "android_calllog",
  "android_contacts", "android_screenshot", "android_input"
];
const A11Y_TOOLS = ["android_tap", "android_see", "android_swipe", "android_screen"];

const androidPlugin = await import(pathToFileURL(pathResolve("plugins/dsh-tool-android/lib/index.js")).href);
const a11yPlugin = await import(pathToFileURL(pathResolve("plugins/dsh-tool-accessibility/lib/index.js")).href);

// 3) 最小假 ctx
function makeCtx() {
  const registered = [];
  const ctx = {
    tools: { register: (t) => registered.push(t) },
    on: () => {},
    get: () => undefined,
    config: {},
    permissionPresets: {},
    shell: {},
    inject: (_deps, cb) => cb(ctx)
  };
  return { ctx, registered };
}

const namesOf = (registered) => registered.map((t) => (t && t.name) || String(t));

function resetEnv() {
  delete process.env.ROOT_AVAILABLE;
  delete process.env.SHIZUKU_AVAILABLE;
  delete process.env.DSH_HOSTED_DIR;
}

/** 跑一次 apply()，返回注册表里的工具名数组。 */
function applyAndroid() {
  const { ctx, registered } = makeCtx();
  androidPlugin.apply(ctx);
  return namesOf(registered);
}

// 4) 用例执行器（每条独立断言，失败不中断，末尾汇总 PASS/FAIL）
const results = [];
function step(label, fn) {
  try {
    const detail = fn();
    results.push(true);
    console.log("  \u2713 " + label + (detail ? " —— " + detail : ""));
  } catch (e) {
    results.push(false);
    console.log("  \u2717 " + label + " —— " + ((e && e.message) || e));
  }
}

console.log("test_batch86_p2_privileged_gate：chroot 工具面按设备能力注册（离线行为型用例）");
console.log("host rootfs(" + ROOTFS_BUSYBOX + ") exists = " + existsSync(ROOTFS_BUSYBOX));

// P0 前提：本机/本主机 rootfs 不在位（用例 A/C 的预期基于此）
step("P0 前提：rootfs 不在位（若为 true 说明本主机上 rootfs 已落盘，A/C 的预期需重新判定）", () => {
  assert.equal(existsSync(ROOTFS_BUSYBOX), false,
    "本用例假定 " + ROOTFS_BUSYBOX + " 不存在（离线主机/本机无 root 且未铺 rootfs）");
});

// A. 本机实况：托管 shell 在位 + 无 root + rootfs 缺失
step("A 本机实况（DSH_HOSTED_DIR=1 / ROOT_AVAILABLE 未设 / rootfs 缺失）：chroot 4 件不进注册表", () => {
  resetEnv();
  process.env.DSH_HOSTED_DIR = "1"; // 托管引擎以 shell(uid=2000) 运行，本用例在 Windows 上用环境变量等价模拟
  const names = applyAndroid();

  // 反面控制：特权门控（privilegedAvailable)确实通过 —— 否则下面的「仍在」断言不能证明新闸门更窄
  assert.ok(names.includes("android_device_info"),
    "前置：托管 shell 下特权族应照常注册（含 android_device_info），实际注册=" + names.join(","));

  for (const n of CHROOT_TOOLS) {
    assert.ok(!names.includes(n), n + " 在本机恒不可用，不得注册；实际注册=" + names.join(","));
  }
  for (const n of BASIC_TOOLS) {
    assert.ok(names.includes(n), n + " 必须仍然注册（本次只收窄 chroot 族）；实际注册=" + names.join(","));
  }
  return "注册数=" + names.length + "，chroot 族 0/" + CHROOT_TOOLS.length + "，基础 " + BASIC_TOOLS.length + "/" + BASIC_TOOLS.length + " 在表";
});

// B. 有 root 的机器：判据第一条成立
step("B ROOT_AVAILABLE=1（有 root 的机器行为不变）：chroot 4 件全部注册", () => {
  resetEnv();
  process.env.ROOT_AVAILABLE = "1";
  const names = applyAndroid();
  for (const n of CHROOT_TOOLS) {
    assert.ok(names.includes(n), "root 设备必须照常注册 " + n + "；实际注册=" + names.join(","));
  }
  for (const n of BASIC_TOOLS) {
    assert.ok(names.includes(n), "root 设备同样必须有 " + n + "；实际注册=" + names.join(","));
  }
  return "注册数=" + names.length + "，chroot 族 " + CHROOT_TOOLS.length + "/" + CHROOT_TOOLS.length + " 在表";
});

// C. 判据函数直测（含「只收窄注册条件、不误用 privilegedAvailable」的反面控制）
step("C chrootToolsAvailable()：未设+rootfs 缺失→false；仅托管 shell→false；ROOT_AVAILABLE=1→true", () => {
  resetEnv();
  assert.equal(androidPlugin.chrootToolsAvailable(), false,
    "ROOT_AVAILABLE 未设且 rootfs 缺失时必须为 false（本机实况）");
  process.env.DSH_HOSTED_DIR = "1";
  assert.equal(androidPlugin.chrootToolsAvailable(), false,
    "托管 shell 不提供 mount/chroot 能力，不得打开 chroot 闸门（这正是不能用 privilegedAvailable() 的原因）");
  process.env.ROOT_AVAILABLE = "1";
  assert.equal(androidPlugin.chrootToolsAvailable(), true, "root 通道在位时必须为 true");
  resetEnv();
  assert.equal(androidPlugin.chrootToolsAvailable(), false, "复位后必须回到 false");
  return "三条判据均符合预期（rootfs 已在位这条分支需真机/带 rootfs 的主机才能直测，由 pytest 结构契约兜住）";
});

// D. 跨插件对照：基础工具（另一插件）不受影响
step("D 跨插件对照：dsh-tool-accessibility 的 android_tap/see/swipe/screen 不受本闸门影响", () => {
  resetEnv();
  const { ctx, registered } = makeCtx();
  a11yPlugin.apply(ctx);
  const names = namesOf(registered);
  for (const n of A11Y_TOOLS) {
    assert.ok(names.includes(n), n + " 必须仍在注册表；实际注册=" + names.join(","));
  }
  return "无障碍插件注册数=" + names.length;
});

const failed = results.filter((x) => !x).length;
console.log("==================================================");
if (failed === 0) {
  console.log("PASS " + results.length + "/" + results.length + " 组用例全部通过（chroot 族按能力注册，基础工具不受影响）");
} else {
  console.log("FAIL " + failed + "/" + results.length + " 组用例失败");
  process.exitCode = 1;
}
console.log("==================================================");

