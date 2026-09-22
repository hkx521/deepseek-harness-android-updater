# 第三方组件与开源许可声明 · Third-Party Notices

本仓库**整体**采用 **MIT** 许可（见 [`LICENSE`](LICENSE)）。

但**虚拟屏（vscreen）功能**的特权服务端代码源自 **Operit**（经 [woaiys3/deepseek-harness-android-app](https://github.com/woaiys3/deepseek-harness-android-app) 移植引入），**该部分按 LGPL-3.0 分发**。
同一个仓库里同时存在两种许可，**请分别遵守**——尤其当你要复用/修改虚拟屏相关文件时。

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

## 3. 随包分发的运行时与内核

| 项 | 说明 |
|---|---|
| Node.js 运行时（APK `payload.zip` 内置） | **Node.js**（MIT 许可），随包分发 |
| DSH 内核（`@deepseek-ai/dsh`，当前 0.1.5-rc.1） | MIT 许可，随包分发 |
| DSH 内核的 npm 依赖闭包 | 来自 npm 的第三方包，**版权与许可归各自作者所有**，随包原样分发；本仓库不重新授权它们 |

> 以上内容的完整来源、版本与打包方式见 `README.md`、`docs/` 与 `updater.lock.json`。

---

## 4. 摘要

| 范围 | 许可证 |
|---|---|
| 本仓库其余全部内容（App 外壳、插件封装、补丁与升级工具、构建脚本、文档） | **MIT** |
| `android-app/src/com/deepseek/harness/vscreen/`（虚拟屏特权服务端） | **LGPL-3.0**（源自 Operit，经 deepseek-harness-android-app 移植；本项目有功能增量修改） |
| `android-app/libs/shizuku-*.aar`、`android-app/assets/rish_shizuku.dex`（Shizuku） | **Apache-2.0** |
| APK 内置 Node 运行时、DSH 内核、npm 依赖 | 各自原许可（Node.js / DSH 为 MIT，其余见各包声明） |
