# v1.9.0 原生模块 glibc 化方案（阶段 3 调研结论）

> 状态：调研完成（2026-09-11）。**未动 devhome**（等阶段 0-2 构建验证后统一换，见任务分工）。
> 现状核查基于 `build/updater/devhome/dshroot/lib/node_modules/` 实际文件，非推测。

## 〇、现状核查结论（与此前认知的偏差）

devhome 中三个包的实际状态（`dshroot/lib/node_modules/<pkg>/package.json`）：

| 包 | devhome 版本 | 原生产物现状 | 性质 |
|---|---|---|---|
| koffi | **3.2.1** | 无任何 `.node`/prebuild 子包 | 纯 JS 壳（`npm ci --ignore-scripts --omit=optional` 跳过了 install 脚本，optional 平台包未装） |
| node-pty | **1.2.0-beta.15** | **自带 `prebuilds/linux-arm64/pty.node`** | **上游 glibc 预编译，直接可用** |
| sharp | **0.35.4** | 无 `@img/sharp-linux-arm64` 子包 | 纯 JS 壳（optional deps 未装） |

⚠️ **compatibility/0.1.5-rc.1/overlay/node_modules/ 里的 koffi/sharp/node-pty 不是 bionic 预编译模块，而是 JS 替身（stub）**：
- `koffi/index.cjs` —— 全 API 抛 "The native koffi binding is unavailable on Android"
- `sharp/lib/index.js` —— 纯 JS 手写 PNG/JPEG 头解析
- `node-pty/lib/index.js` —— 用 `child_process.spawn` 模拟的 AndroidTerminal（无真 PTY）

即现状 = "原生模块在 bionic 下不可用，用 JS 降级替身"，不是"bionic 移植版"。因此 glibc 化的收益比方案文档预期的更大：不是"换一个预编译"，而是"从不可用变成可用"。

## 一、逐包方案

### 1. node-pty 1.2.0-beta.15 —— 无需任何编译（重要修订）

任务书假设"node-pty 无预编译、需交叉编译"——**已证伪**。实测 `prebuilds/linux-arm64/pty.node`：

```
interp:    None（dlopen 加载，无 PT_INTERP）
DT_NEEDED: libutil.so.1, libstdc++.so.6, libgcc_s.so.1, libpthread.so.0, libc.so.6
PT_LOAD max p_align: 0x10000（16KB 检查通过）
```

全部 NEEDED 都在 `build/updater/runtime-glibc/lib/` 集合内（libutil 在 fetch.py 白名单里）。
node-pty 用 node-gyp-build（prebuildify）加载，glibc node 下自动命中 `prebuilds/linux-arm64/`。

**落位步骤**（统一换批时执行）：
1. compatibility overlay 停止覆盖 `node-pty`（见下文「overlay 分支化」）。
2. devhome 的 dshroot/profile 内 node-pty 1.2.0-beta.15 原样保留即可。

### 2. koffi 3.2.1 —— 补装官方 glibc prebuild

上游 latest 3.2.1 的 optionalDependencies 含 **`@koromix/koffi-linux-arm64@3.2.1`**（glibc，
N-API 8，node>=16；npm registry 可查）。它不是独立安装名，而是 koffi 主包的平台子包。

**落位步骤**：
```bash
# 在 dshroot/lib 与 profile 两处执行（或改 workspace.py 后 refresh）
npm install --prefix <dir> --save-exact koffi@3.2.1   # 不带 --ignore-scripts/--omit=optional
# 装完后校验：node_modules/@koromix/koffi-linux-arm64/koffi/build/koffi/linux-arm64/*.so
# 用 tools/runtime_glibc/fetch.py 的 parse_elf 检查 16KB 对齐 + NEEDED 闭合
```
注意：npm install 会触发 koffi 的 cnoke install 脚本（--prebuild 只做下载不编译，但仍需
评估是否在 Windows 上安全执行；备选是 `npm pack @koromix/koffi-linux-arm64` 手动解包，
产物 sha256 记入 lock）。

### 3. sharp 0.35.4 —— 补装 @img/sharp-linux-arm64

sharp 0.33+ 的 glibc prebuild 由独立包 `@img/sharp-linux-arm64` 提供（内含打包好的
libvips 全家桶 .so）。上游对 linux-arm64 的 prebuild 是 glibc 构建。

**落位步骤**：
```bash
npm install --prefix <dir> --save-exact --ignore-scripts @img/sharp-linux-arm64@<与 sharp 0.35.4 匹配的版本>
```
（sharp 主包按 platform 侧 load 逻辑找 `@img/sharp-linux-arm64`；--ignore-scripts 对
@img/* 平台包安全，它们无 install 脚本。）装完同样过 ELF 检查。

## 二、overlay 分支化（给主代理的决策点）

`compatibility/0.1.5-rc.1/overlay/node_modules/{koffi,sharp,node-pty}` 三个 JS 替身是
**bionic 专属降级**。glibc 模式下它们会把可用的上游 glibc 模块盖回残废版。

建议（任选其一，倾向 A）：
- **A. per-runtime overlay**：`apply_compatibility()` 增加 runtime 维度（`overlay/bionic/`、
  `overlay/glibc/`），node-pty/koffi/sharp 的替身只进 bionic overlay；glibc overlay 只含
  与 libc 无关的补丁（dsh-fs-local link→copyFile、attachment durability、fs-search rg
  路径、subprocess-local——这四个 glibc 下仍然需要，见方案 D4 表）。
- **B. 换批时手动摘除**：统一换批那天直接从 overlay 目录删掉三个替身目录 +
  `apply.py` 里对应条目。简单但 bionic 回退期（v1.9.0~v1.9.1）内若触发降级，
  bionic node 加载不到替身 → sharp/koffi/node-pty 在 bionic 模式下从"降级可用"变
  "require 报错"。**方案 A 才能同时保住两条 runtime**，推荐 A。

## 三、安全网关系（重要）

在 glibc 模块补齐之前，v1.9.0 的 glibc 模式**不算完整可用**：koffi/sharp/node-pty 仍被
overlay 替身覆盖（行为与 bionic 现状一致，不会更差），真引擎/工具链不受影响。
阶段 2 的看门狗降级（连续 3 次启动失败 → `dsh_prefs/runtime_mode=bionic`）是模块未
就位期间的安全网：glibc runtime 本身起不来时自动回 bionic，不会把用户卡死。

## 四、遗留（明确不在本次范围）

- 真机验收：node-pty 真 PTY、koffi FFI、sharp 图片处理三条链路的 logcat/功能验证。
- `@koromix/koffi-linux-arm64` 与 `@img/sharp-linux-arm64` 的精确版本锁定与 sha256
  （等统一换批时随 lock 机制写入 `tools/runtime_glibc/lock.json`）。
- workspace.py 的 `--ignore-scripts --omit=optional` 参数按 per-runtime 分支改造。
