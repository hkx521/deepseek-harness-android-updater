# 第三方组件与开源许可声明 · Third-Party Notices

本仓库**整体**采用 **MIT** 许可（见 [`LICENSE`](LICENSE)）。

但**虚拟屏（vscreen）功能**的特权服务端代码源自 **Operit**（经 [woaiys3/deepseek-harness-android-app](https://github.com/woaiys3/deepseek-harness-android-app) 移植引入），**该部分按 LGPL-3.0 分发**。
同一个仓库里同时存在两种许可，**请分别遵守**——尤其当你要复用/修改虚拟屏相关文件时。

此外，APK 还随包分发若干**第三方 DSH 插件与 npm 运行期依赖**（见 §3），其中包含本仓库的**第二处 LGPL 组件**
（libvips 预编译库，§3.3）。

---

## 1. Operit（机制源头）与 deepseek-harness-android-app（移植源）— LGPL-3.0（虚拟屏 vscreen）

| 项 | 内容 |
|---|---|
| 项目（机制源头） | **Operit** — Android 上能力强大的 AI Agent |
| 仓库 | <https://github.com/AAswordman/Operit> |
| 作者 | [AAswordman](https://github.com/AAswordman) |
| 项目（移植源） | **deepseek-harness-android-app**（v1.11）— 其虚拟屏模块移植/对齐 Operit 的 shower（虚拟屏）模块，并同样按 LGPL-3.0 分发 |
| 仓库 | <https://github.com/woaiys3/deepseek-harness-android-app> |
| 许可证 | **GNU Lesser General Public License v3.0（LGPL-3.0）** |
| 许可证全文 | [`licenses/LGPL-3.0.txt`](licenses/LGPL-3.0.txt)（LGPL-3.0 以 GPL-3.0 为基础，故同时提供 [`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt)） |

### 1.1 本项目中源自上述项目的部分

虚拟屏特权服务端位于独立目录 `android-app/src/com/deepseek/harness/vscreen/`（共 3 个 Java 文件）：

| 文件 | 与本项目的关系 |
|---|---|
| `android-app/src/com/deepseek/harness/vscreen/FakeContext.java` | **逐字节取自** deepseek-harness-android-app v1.11（其又逐字取自 Operit 的 shower shell 模块），**零改动**；最小 `Context` 实现，供 app_process 环境下构造 `DisplayManager` 使用 |
| `android-app/src/com/deepseek/harness/vscreen/Workarounds.java` | **逐字节取自** deepseek-harness-android-app v1.11（其又逐字取自 Operit 的 shower shell 模块），**零改动**；隐藏 API / 反射规避处理 |
| `android-app/src/com/deepseek/harness/vscreen/Main.java` | 虚拟屏特权服务端（app_process 独立进程，HTTP 127.0.0.1:8998）。以 deepseek-harness-android-app v1.11 的同名文件为基线，**本项目（批次 11）做了功能增量修改**（见 §1.2），其核心机制（反射 `DisplayManager.createVirtualDisplay()` 建屏、`InputManager` 反射定向注入、`ActivityOptions.setLaunchDisplayId` 启动到指定虚拟屏、ImageReader 帧泵、缩放 JPEG 预览等）**移植/对齐自 Operit** |

其中 `FakeContext.java` 与 `Workarounds.java` 在源码里**保留了原始许可声明头**：

```java
// android-app/src/com/deepseek/harness/vscreen/FakeContext.java
// android-app/src/com/deepseek/harness/vscreen/Workarounds.java
// 第 1 行： Licensed under LGPL-3.0; source: https://github.com/AAswordman/Operit (shower shell)
```

> **保险起见的口径**：尽管只有上表前两个文件带显式 LGPL 头，本声明**按最保守方式把整个虚拟屏服务端目录
> （`android-app/src/com/deepseek/harness/vscreen/`）视为 LGPL-3.0 覆盖范围**。
> 这样无论后续维护者把哪些文件判定为"衍生作品"，都不会出现许可缺口。
> App 层的通道管理（`VscreensManager.java`）、本地桥与插件工具（`plugins/dsh-tool-android/` 的 8 个
> `android_vscreen_*` 工具）为本项目自研封装（MIT），不写入任何 LGPL 文件。

### 1.2 本项目对 LGPL 文件做过的修改（如实声明）

- `FakeContext.java`、`Workarounds.java`：**未修改**（与 deepseek-harness-android-app v1.11 逐字节一致）；
- `Main.java`：在 v1.11 基线上有 **63 个 diff hunk（773 行 +/-）的功能增量**，主要包括：
  - **三级建屏阶梯**：S1 trusted 虚拟屏 → S2 plain（去 TRUSTED flag）→ S3 overlay 模拟副屏
    （`settings put global overlay_display_devices` 写入 + `dumpsys display` 轮询差分出新 displayId，
    失败/关闭时还原改前值）；
  - **token 鉴权**：`--token` 启动参数 + 所有请求头 `X-DSH-TOKEN` 校验；
  - **pidfile**：`--pidfile` 启动参数，启动即写单行 JSON `{"pid","uid","version"}`；
  - 结构化错误响应（`reason` 枚举）与 `/health` 形状调整。
  - 每处改动的逐行记录见本项目批次 11 移植报告与全量 diff 归档。

**上述修改后的文件及其衍生，仍按 LGPL-3.0 发布。**

### 1.3 如果你要继续修改这些文件

- **修改后的这些文件（及其衍生）必须继续以 LGPL-3.0 分发**，并保留原始版权与许可声明（LGPL-3.0 §2、§4）；
- 不得对本模块附加任何"禁止修改 / 禁止为调试而反向工程"的限制（LGPL-3.0 §4）；
- 本项目**不要求**你对仓库其余（MIT 部分）做任何开源——两部分的许可彼此独立。

### 1.4 本项目已履行的 LGPL-3.0 义务

| 义务（条款） | 履行方式 |
|---|---|
| 显著声明"使用了该 Library 且该 Library 及其使用受 LGPL-3.0 约束"（§4a） | 本文件 + `README.md` 的「致谢 / Acknowledgments」章节 |
| 随作品附带 GPL-3.0 与 LGPL-3.0 全文副本（§4b） | [`licenses/LGPL-3.0.txt`](licenses/LGPL-3.0.txt)、[`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt) |
| 提供可重新链接/重新编译的对应源码（§4d） | **本仓库即为完整对应源码**（含 `android-app/src/com/deepseek/harness/vscreen/`、服务端 jar 构建脚本 `android-app/build-vscreen-jar.sh`、App 层与插件封装），任何人可获取、修改、自行编译与重新链接；对 LGPL 文件的每一处修改（§1.2）也在本仓库内如实呈现 |
| 允许为调试修改而反向工程（§4） | 本项目未附加任何禁止条款 |

> 若发现归属有遗漏或希望调整声明方式，欢迎提 Issue 或直接联系维护者。

---

## 2. Shizuku — Apache-2.0

| 项 | 内容 |
|---|---|
| 项目 | **Shizuku** / **Shizuku-API**（免 Root 使用系统 API 的特权通道） |
| 仓库 | <https://github.com/RikkaApps/Shizuku> · <https://github.com/RikkaApps/Shizuku-API> |
| 许可证 | Apache License 2.0（<https://www.apache.org/licenses/LICENSE-2.0>） |

**使用方式**：本项目通过 Shizuku 提供的 SDK 建立特权通道（无 root 设备拉起虚拟屏服务端、执行特权操作）。

- `android-app/libs/shizuku-api.aar`、`android-app/libs/shizuku-provider.aar`、`android-app/libs/shizuku-aidl.aar`（13.1.5）
- APK assets 内置 `android-app/assets/rish_shizuku.dex`（Shizuku `rish` shell loader，运行时由 App 释放使用）

**事实核查说明**：以上 3 个 AAR 经 `unzip -l` 核查，包内**不含** LICENSE / NOTICE 文件（仅含编译产物与
`aar-metadata.properties`）；其许可依据为 Shizuku-API 上游仓库声明的 **Apache-2.0**。本项目未修改这些 AAR，
按原样分发。

---

## 3. 随包分发的第三方插件与运行期依赖（npm）

APK 的 `assets/payload.zip` 还会随包分发一组**第三方 DSH 插件**及其运行期依赖。其源码位于
`compatibility/<profile>/overlay/node_modules/`，在构建/落位期被物化进 `dshroot/lib/node_modules` 与
`dshhome/profiles/web/node_modules` 两棵树。**版权与许可归各自作者所有，本仓库不重新授权它们**。

### 3.1 第三方插件（各有独立上游仓库）

| 包（随包版本） | 上游仓库 | 许可证 |
|---|---|---|
| `@jiesou/dsh-commandcode-go-provider`（0.1.11） | <https://github.com/jiesou/dsh-commandcode-go-provider> | MIT |
| `dsh-agy`（0.2.6） | <https://github.com/chaos-03x/dsh-agy> | MIT |
| `dsh-codearts-auth`（0.1.0） | <https://github.com/solilk115-arch/dsh-codearts-auth> | MIT |
| `dsh-mnemon`（0.5.8）+ 20 个子包（`dsh-mnemon-provider-*` / `-source-*` / `-strategy-*`，0.5.4–0.5.6） | <https://github.com/omdsh-dev/dsh-mnemon> | MIT |

每个包目录内均保留了上游 `LICENSE`（`dsh-mnemon` 另自带 `THIRD_PARTY_NOTICES.md` 与 `SECURITY.md`，一并随包分发）。

### 3.2 上述插件的运行期依赖

| 包（随包版本） | 许可证 |
|---|---|
| `undici`（8.10.2）· `zod`（4.6.5）· `proper-lockfile`（4.1.2）· `fflate`（0.8.3）· `markdown-to-jsx`（7.7.17）· `scheduler`（0.23.2，React）· `js-tokens`（4.0.0）· `loose-envify`（1.4.0）· `cosmokit`（1.8.1）· `schemastery`（3.18.0）· `@standard-schema/spec`（1.1.0） | MIT |
| `graceful-fs`（4.2.11）· `signal-exit`（3.0.7）· `semver`（7.8.5） | ISC |
| `detect-libc`（2.1.2） | Apache-2.0 |

（`schemastery` 随包目录内未附带 LICENSE 文件——上游如此；许可依据为上游 `package.json` 声明的 MIT。）

### 3.3 DSH 内核侧运行期件（平台/原生件，由 overlay 补齐）

`npm ci --omit=optional` 在 x64 / 无网环境装不到的平台件与原生加速件由 overlay 补齐，随包分发：

| 包（随包版本） | 许可证 | 备注 |
|---|---|---|
| `sharp`（0.35.4）· `@img/sharp-linux-arm64`（0.35.4）· `@img/colour`（1.1.0） | Apache-2.0 · Apache-2.0 · MIT | 图像处理链 |
| `@img/sharp-libvips-linux-arm64`（1.3.3） | **LGPL-3.0-or-later** | libvips 预编译库（独立模块、未修改）。该包目录内未附带许可全文，按 §1.4 已随仓库提供的 [`licenses/LGPL-3.0.txt`](licenses/LGPL-3.0.txt) 一并适用 |
| `koffi`（3.2.1） | MIT | FFI；<https://github.com/Koromix/koffi> |
| `node-pty`（1.2.0-beta.15） | MIT | <https://github.com/microsoft/node-pty> |
| `@deepseek-ai/node-addon-system`（0.1.2）· `node-addon-require-builtin`（0.1.5）· `@deepseek-ai/dsh-win32-process` | MIT | DSH 内核侧平台原生件 |

> `@deepseek-ai/*` 的运行期件（`cosmokit` / `schemastery` / `dsh-client-connection` / `dsh-client-ui-primitives` /
> `dsh-native-command` 等）本就是 DSH 内核的组成部分，归入 §4 的「DSH 内核」条目。

### 3.4 本仓库对这些第三方文件的改动（如实声明）

1. **`dsh-agy`：公开副本移除了随包内嵌的第三方 OAuth client secret**（改为运行时读 `AGY_CLIENT_SECRET`，
   该环境变量开关上游 README 已记载）。除这一处外，该包与上游逐字节一致；行为影响 = 不设置该环境变量时
   agy 的该登录方式不可用（程序不会崩溃）。
2. **DSH 内核**（`@deepseek-ai/*`，属 §4，不在本节清单内）在构建/落位期会应用
   `compatibility/<profile>/apply.py` 的 Android 兼容补丁（硬链接改复制、目录 fsync 容错、闲置功耗治理等），
   补丁后的文件仍按上游各自许可分发。
3. 本节清单中的第三方插件本体**不做源码级修改**（唯一例外是第 1 条）。
4. 本仓库自研插件（`plugins/dsh-model-router`、`plugins/dsh-tool-{accessibility,android,shizuku}`）为 **MIT**，
   不属于第三方。其中 `plugins/dsh-model-router` 在运行时按本项目的命名空间约定以 `@jiesou/dsh-model-router`
   之名物化——**npm 上并不存在该包，它也不属于本节任何上游作者**。

---

## 4. 随包分发的运行时与内核

| 项 | 说明 |
|---|---|
| Node.js 运行时（APK `payload.zip` 内置） | **Node.js**（MIT 许可），随包分发 |
| DSH 内核（`@deepseek-ai/dsh`，当前 0.1.5-rc.1） | MIT 许可，随包分发 |
| DSH 内核的 npm 依赖闭包 | 来自 npm 的第三方包，**版权与许可归各自作者所有**，随包原样分发；本仓库不重新授权它们 |

> 以上内容的完整来源、版本与打包方式见 `README.md`、`docs/` 与 `updater.lock.json`。

---

## 5. 摘要

| 范围 | 许可证 |
|---|---|
| 本仓库其余全部内容（App 外壳、插件封装、补丁与升级工具、构建脚本、文档） | **MIT** |
| `android-app/src/com/deepseek/harness/vscreen/`（虚拟屏特权服务端） | **LGPL-3.0**（源自 Operit，经 deepseek-harness-android-app 移植；本项目有功能增量修改） |
| `android-app/libs/shizuku-*.aar`、`android-app/assets/rish_shizuku.dex`（Shizuku） | **Apache-2.0** |
| 随包第三方插件（§3.1：`@jiesou/dsh-commandcode-go-provider`、`dsh-agy`、`dsh-codearts-auth`、`dsh-mnemon*`） | **MIT**（版权归各自作者） |
| 上述插件与内核的运行期依赖（§3.2 / §3.3：`undici`、`zod`、`sharp`、`koffi`、`node-pty`、`semver` 等） | 各自原许可（多为 MIT；`graceful-fs` / `signal-exit` / `semver` 为 ISC，`sharp` / `detect-libc` 为 Apache-2.0） |
| `@img/sharp-libvips-linux-arm64`（libvips 预编译库，§3.3） | **LGPL-3.0-or-later**（本仓库第二处 LGPL 组件；许可全文见 [`licenses/LGPL-3.0.txt`](licenses/LGPL-3.0.txt)） |
| APK 内置 Node 运行时、DSH 内核、npm 依赖 | 各自原许可（Node.js / DSH 为 MIT，其余见各包声明） |
