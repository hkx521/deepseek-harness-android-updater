# DeepSeek Harness 手机版（Android）

> 把 DeepSeek Harness（DSH）打包成**可直接安装的 Android APK** —— 装上就能用，还能让 AI **免 Root 真正操作手机**。

![License](https://img.shields.io/github/license/hkx521/deepseek-harness-android-updater)
![Stars](https://img.shields.io/github/stars/hkx521/deepseek-harness-android-updater)
![Release](https://img.shields.io/github/v/release/hkx521/deepseek-harness-android-updater)

## ✨ 核心亮点

- 📦 **APK 一键安装**（包名 `com.deepseek.harness`，当前版本 **1.9.0-dsh0.1.5rc1**）：不用 Termux、不用敲命令，下载安装即用
- 🔓 **免 Root 系统特权**：通过 Shizuku（或设备已有 root）打通系统 shell —— AI 能**装应用、点屏幕、改系统设置、截图、模拟输入**
- 🟢 **可选特权，不授予也能正常用**：不装 Shizuku / 无 root 也能用——文件读写、预览、编辑只需「所有文件访问」权限；未授权时 AI 不会反复尝试系统操作，需要时会引导你授权
- 🔀 **Root 优先，Shizuku 备用**：有 root 走 `su` 通道，无 root 走 Shizuku，自动选择
- 👁️ **无障碍屏幕助手**：系统设置开启「DeepSeek Harness 屏幕助手」后，AI 能**读屏、点击、输入、滚动、多指手势、无障碍截图理解**——**不需要 root / Shizuku**
- ⏰ **定时任务**：新建 / 编辑 / 启停 / 删除，到点自动执行并回填结果；失败可见、可重试
- 🗂 **多任务管理**：任务互不覆盖，可查看 / 续跟 / 批量清理；任务状态以引擎为准（不再误报失败）
- 🧠 **托管常驻引擎**：root 或 Shizuku 下引擎脱离 App 进程常驻（`/data/local/tmp/dsh`），App 被杀、清后台、锁屏都不中断，并有看护自愈
- 🪟 **后台虚拟屏**：AI 在独立虚拟屏上操作 App，不抢你的主屏；预览小窗可随时显隐，任务结束自动销毁回收
- 🧭 **多入口唤起**：AI 键 / 快捷磁贴 / 划词处理 / 系统分享 / 助手面板
- 🔔 **灵动胶囊 / 实况窗**：AI 干活时在系统胶囊显示状态，点一下直达助手面板
- 🌐 **高可用模型路由**：内置 `dsh-model-router` 插件 —— 首字超时（TTFT）哨兵 + 不可恢复错误自动降级到备用 provider
- 📱 **移动端适配**：触摸优化、软键盘适配、首次启动**一站式权限引导页**（11 项，含无障碍 / 通知使用权 / 悬浮窗 / 电池优化 / 自启动管理等）
- 💾 **卸载不丢数据**：DSH 根目录外置到 `/sdcard/DeepSeekHarness`，重装 / 升级不清空 AI 的运行时改动
- 🧹 **退出清理**：主动「退出」会停止保活服务并回收 App 内引擎；托管引擎可一键停止
- 🔔 **AI 发通知**：只需通知权限，任务完成 / 需要关注时推送到通知栏
- 🧠 **完整 DSH 内核**：`@deepseek-ai/dsh` 0.1.5-rc.1，保留插件生态 + RPC API，前端用 DSH 原生界面
- 🐋 鲸鱼品牌图标、横竖屏自由旋转

## 🛠️ 手机端插件（本项目的核心特色）

| 插件 | 能力 |
|---|---|
| `dsh-tool-shizuku` | 免 root 特权通道 + 调度类工具：`shizuku_shell` / `shizuku_status` / `android_schedule`（定时任务）/ `android_trigger` / `android_notify` / `android_clipboard` … |
| `dsh-tool-android` | 结构化系统操作：包管理 / 应用 / 设备信息 / 截图 / 输入 / 通知 / 联系人 / 短信 / 通话记录 / 定位 / 用量 / 覆盖层，以及虚拟屏全家（建屏 / 查看 / 启动 / 截图 / 点击 / 滑动 / 按键 / 关闭） |
| `dsh-tool-accessibility` | 无障碍读屏与模拟操作（见下节） |
| `dsh-model-router` | 模型路由与降级：首字超时哨兵、不可恢复错误透明切换备用 provider（`DSH_ROUTER_DISABLE=1` 可关闭） |

> 三条通路互补：**特权通道**（root / Shizuku）负责系统级操作；**无障碍通道**（无需授权）负责读屏与交互；**虚拟屏**让自动化不抢你的主屏。可用工具以 `plugins/*/lib/index.js` 为准（合计 40+）。

## 👁️ 无障碍屏幕助手

让 AI **看着屏幕操作手机**：读屏、点击、输入、滚动、截图理解——**不需要 root / Shizuku**。

### 开启方式

1. 系统设置 → 无障碍 → 已下载的服务 → 开启「DeepSeek Harness 屏幕助手」
2. 在 App 里让 AI：先用 `android_screen` 读屏 → 用 `android_tap` / `android_type` / `android_scroll` 操作 → 需要看图时用 `android_see` 截图理解

| 工具 | 能力 |
|---|---|
| `android_a11y_status` | 查询无障碍服务状态（未开启时返回引导文案） |
| `android_screen` | 读当前屏幕控件树（文字 / 坐标 / 可点击性 / 可输入性） |
| `android_screen(scope="current")` | 强制读取用户真实主屏当前应用，绕过虚拟屏透明路由、跳过快照缓存 |
| `android_tap` | 按文字 / 描述 / 坐标点击 |
| `android_type` | 输入文本到输入框（WebView / 网页输入框用 `paste:true` 走剪贴板粘贴） |
| `android_scroll` / `android_gesture` / `android_hold` / `android_swipe` | 滚动、多指组合手势、按住、滑动 |
| `android_see` | 无障碍截图并发送给视觉模型理解（需 Android 11+ 与支持图片的模型） |
| `android_open_a11y_settings` / `android_screen_refresh` / `android_act` | 打开无障碍设置 / 强制刷新快照 / 通用动作 |

## 🪟 后台虚拟屏（vscreen）

让 AI 在**独立虚拟屏**上运行目标 App，主屏不被打断；预览小窗可一键显隐，任务结束自动销毁并回收。
通道策略（trusted / overlay）、隐私行为与排错见 [docs/vscreen-使用说明.md](docs/vscreen-使用说明.md)。

## 📦 安装

从 [Releases](https://github.com/hkx521/deepseek-harness-android-updater/releases) 下载 APK 安装即可（当前 **`DeepSeekHarness-1.9.0-dsh0.1.5rc1.apk`**，同目录附 `.sha256` 校验文件）。

要求：

- **Android 7.0（API 24）及以上**；实测运行在 Android 10 ~ Android 17
- 系统操作能力需配合 [Shizuku](https://shizuku.rikka.app/)（免 Root 授权）或设备已 root；**都不授予也能正常使用**（文件操作只需「所有文件访问」权限）
- API Key 在 App 内页面填写，只存本机，绝不打包进 APK
- 首次启动会解压内置运行资产（2 万+ 文件，视机型约 1-3 分钟），期间建议不要切后台

> ⚠️ **签名**：本 APK 为自签名，与官方 / 上游签名的同包名 APK **不能互相覆盖安装**；切换来源前请先卸载。

> 🆘 **打不开 / 白屏 / 连接失败？** 先看 [启动排查](docs/启动排查.md)（常见问题都能自助解决）。

## 📁 目录结构

```
android-app/             APK 构建工程
├── build.sh             一键打包脚本（bash）；env.sh 编译工具链环境（可 export PREFIX 覆盖）
├── AndroidManifest.xml  包名 / targetSdk(28) / 横竖屏自由旋转 / Shizuku 与无障碍声明
├── src/                 33 个 Java（30 个应用侧 + vscreen/ 3 个 LGPL 特权服务端）
├── res/                 图标 + 字符串资源
├── libs/                Shizuku 官方 aar（api / provider / aidl）
├── sdk/                 放 platform android.jar（见 sdk/README.md）
mobile-patch/            移动端适配（注入 DSH 前端，不覆盖原生代码）
├── inject.sh            注入脚本（mobile.css + mobile.js 到 dist）
├── mobile.css           触摸优化 + 竖屏适配 + 插件管理页 UI 适配
└── mobile.js            软键盘适配（VisualViewport 方案，横竖屏通用）
plugins/                 手机端 DSH 插件（4 个）
├── dsh-tool-shizuku/    免 root 特权 shell + 调度（定时任务等）
├── dsh-tool-android/    结构化系统操作（包管理 / 应用 / 设置 / 截图 / 输入 / 虚拟屏）
├── dsh-tool-accessibility/  无障碍读屏 / 模拟操作
└── dsh-model-router/    模型路由与降级
dsh-patches/             DSH 源码补丁归档 + overlay（升级 DSH 后需重新应用）
compatibility/           版本化 Android 兼容层（按 DSH 版本分目录）
config/cordis.patch.yml  DSH 组合配置（禁原生模块 + 插入手机端插件）
tools/                   构建与打包工具链（dsh_updater / b47_build / e2e 回归脚本）
tests/                   契约测试（pytest，62 个文件）
licenses/                第三方许可证全文（LGPL-3.0 / GPL-3.0）
docs/                    开发指南 / 启动排查 / 虚拟屏使用说明 / DSH 更新与打包 / 回归清单
.github/                 CI（ci.yml / compat-probe.yml）与 Issue / PR 模板
scripts/                 真机联调脚本（模型路由 / 虚拟屏抢占）
```

## 🔨 构建说明

**A) 全量链路（推荐）** —— 可重复执行的 DSH 升级 + 打包流程，读取 `updater.lock.json` 锁定内核版本：

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -e .
.\.venv\Scripts\python -m tools.dsh_updater doctor
.\.venv\Scripts\python -m tools.dsh_updater all `
  --base-apk .\input\DeepSeekHarness-official-v1.7.5.apk   # 底包需自己准备（input/ 默认不存在）
```

（上面那个反引号是 PowerShell 的续行符。）输出 `dist/DeepSeekHarness-<版本>.apk` 与同名 `.sha256`。

**B) 本地增量（Windows 优先，需已有底包）**：

```powershell
python tools/b47_build.py all    # r(资源) → j(javac) → d(d8) → res(资源包) → pack(repack) → sign(签名)
```

产物 `.local/b47_out/DeepSeekHarness-b47.apk`。

关键点：

- `targetSdk` 必须保持 **28**（≥29 会导致 node 二进制 EACCES 起不来）
- 运行资产由全量链路准备到 `build/updater/devhome/`（node v26 + DSH 内核）；离线环境可由 Releases 的分块包合并
- 签名密钥 `android-app/release.jks` 与口令**不入仓库**：口令走 `KEYSTORE_PASS` 环境变量，或 `python -m tools.dsh_updater init-signing` 生成的 `.local/signing.env`
- 全量链路读 `JAVA_BIN` / 自动选最新 build-tools；`tools/b47_build.py` 默认找本机 Corretto（`JAVAC` / `JAVA_HOME` 可覆盖）与 `build-tools/36.1.0`（`ANDROID_BUILD_TOOLS` 可覆盖）
- 升级与签名细节见 `docs/DSH更新与打包.md`；开发命令见 `docs/开发指南.md` 第六节「常用命令」

## 🧪 质量与回归

- `python -m pytest tests/ -q` —— 当前基线 **599 passed**
- 真机回归脚本 `tools/e2e_*.py`（装机冒烟 / 保活自愈 / 锁屏挂机 / 虚拟屏 / 助手长任务等），清单见 [docs/test-flows/regression-checklist.md](docs/test-flows/regression-checklist.md)
- CI：`.github/workflows/ci.yml`（ruff + pytest + CLI 冒烟）；`compat-probe.yml` 巡检上游内核升级是否让 Android 兼容补丁失配

## 💬 交流讨论

遇到问题、想提建议，请直接开 [Issue](https://github.com/hkx521/deepseek-harness-android-updater/issues)（按模板附机型 / Android 版本 / App 版本 / 复现步骤）。

## 📄 许可证

- 本项目源码采用 [MIT](LICENSE) 许可证（版权归属见 `LICENSE` 首行）。
- **例外**：虚拟屏（vscreen）特权服务端按 **LGPL-3.0** 分发（源自 Operit / 上游移植基线），声明与义务履行见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，许可证全文见 `licenses/`。
- 依赖许可：DSH 内核（`@deepseek-ai/dsh`）与 Node 运行时为 MIT；Shizuku SDK 为 Apache-2.0。

## 🙏 致谢 / Acknowledgments

虚拟屏（vscreen）功能的机制与代码源自开源社区，特此感谢：

- [Operit](https://github.com/AAswordman/Operit)（AAswordman）—— 虚拟屏机制源头，相关代码按 **LGPL-3.0** 分发
- [woaiys3/deepseek-harness-android-app](https://github.com/woaiys3/deepseek-harness-android-app)（移植基线 v1.11）—— 本项目的上游来源
- [RikkaApps/Shizuku](https://github.com/RikkaApps/Shizuku) —— 免 root 特权通道，SDK 按 **Apache-2.0** 使用
