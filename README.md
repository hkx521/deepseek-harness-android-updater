# DeepSeek Harness 手机版（Android）

> 把 DeepSeek Harness（DSH）打包成**可直接安装的 Android APK** —— 装上就能用，还能让 AI **免 Root 真正操作手机**。

![License](https://img.shields.io/github/license/hkx521/deepseek-harness-android-updater)
![Stars](https://img.shields.io/github/stars/hkx521/deepseek-harness-android-updater)
![Release](https://img.shields.io/github/v/release/hkx521/deepseek-harness-android-updater)

## ✨ 核心亮点

- 📦 **APK 一键安装**：不用 Termux、不用敲命令，下载安装即用（包名 `com.deepseek.harness`）
- 🔓 **免 Root 系统特权**：通过 Shizuku 打通系统 shell —— AI 能**装应用、点屏幕、改系统设置、截图、模拟输入**，这是"手机上的 AI Agent"，不只是聊天窗口
- 🟢 **可选特权，不授予也能正常用**（v1.4.0）：不装 Shizuku/无 root 也能用——文件读写、预览、编辑只需「所有文件访问」权限；未授权时 AI 不会反复尝试系统操作，需要时会**引导你授权**
- 🔀 **Root 优先，Shizuku 备用**（v1.4.0）：有 root 走 su 通道，无 root 走 Shizuku，自动选择
- 👁️ **无障碍屏幕助手**（v1.7.0）：系统设置开启「DeepSeek Harness 屏幕助手」后，AI 能**读屏、点击、输入、滚动、无障碍截图理解**——**不需要 root / Shizuku**，与特权通道互补
- 🐟 **任意应用内只读助手**：点击小鲸鱼命令面板即可识别、总结、提取或翻译当前页面；`scope="current"` 明确读取真实主屏应用，不会误读 Harness 自身或虚拟屏
- ⏰ **前台保活**（v1.4.0）：AI 干活时挂后台/锁屏不被杀，任务完成推送通知
- 🧹 **退出清理**（v1.9.x）：主动“退出”会停止保活服务并回收 Node 引擎，不再遗留孤儿进程；返回桌面仍按原逻辑保活后台任务
- 🔔 **AI 发通知**（v1.4.0）：只需通知权限，任务完成/需要关注时推送到通知栏
- 🧠 **完整 DSH 内核**：`@deepseek-ai/dsh` 0.1.5-rc.1，保留插件生态 + RPC API，前端用 DSH 原生界面
- 📱 **移动端适配**：触摸优化 + 软键盘适配 + 首次启动权限引导页（9 项权限一站式配置）
- 💾 **卸载不丢数据**：dshroot 外置到 `/sdcard/DeepSeekHarness`，重装/升级不清空 AI 的运行时改动
- 🐋 鲸鱼品牌图标，横竖屏自由旋转

## 📸 界面预览

> 界面截图未随本仓库发布（原截图含真实设备与个人环境信息，已移除）。
> 需要预览效果请见 Releases，或自行真机运行。

## 🛠️ 手机端插件（本项目的核心特色）

| 插件 | 能力 |
|---|---|
| `dsh-tool-shizuku` | 特权 shell：任意系统命令（pm/am/settings/dumpsys…），异步执行 + 环境消毒 + dex 只读自愈 |
| `dsh-tool-android` | 结构化系统操作：包管理 / 应用管理 / 系统设置 / 截图 / 模拟输入 |
| `dsh-tool-accessibility` | 无障碍读屏 + 模拟操作（v1.7.0）：读控件树 / 点击 / 输入 / 返回主页 / 滚动 / 无障碍截图理解 |

> 通过这三个插件，AI 不再只是"聊聊天"，而是能**真正控制你的手机**——特权通道（root/Shizuku）负责系统级操作，无障碍通道（无需授权）负责读屏与交互。

- **后台虚拟屏默认路由**：设置中的「后台虚拟屏模式」开启后，应用启动和屏幕操作会自动走虚拟屏；Agent 被明确要求使用 `android_app`，不会因创建失败或工具过滤改用 `shizuku_shell` 绕回主屏。

- **当前屏直读**：M1 悬浮助手提交只读任务时要求 `android_screen(scope="current")`；该路径跳过虚拟屏创建与 10 秒快照缓存，直接读取主屏外部应用。

- **M1 真机覆盖**：Android 17 设备已在桌面、音乐、浏览器、Google Photos、日历 5 个普通应用中验证当前应用包名识别；面板抢焦点时保留打开前的外部窗口快照。Honor 系统设置页会按 `mIsForceHiddenNonSystemOverlayWindow` 策略隐藏非系统悬浮窗，入口按系统限制 fail-closed。

## 👁️ 无障碍屏幕助手（v1.7.0）

让 AI **看着屏幕操作手机**：读屏、点击、输入、滚动、截图理解——**不需要 root / Shizuku**。

### 开启方式
1. 系统设置 → 无障碍 →（已下载的服务/服务）→ 开启「DeepSeek Harness 屏幕助手」
2. 在 App 里让 AI：先用 `android_screen` 读屏 → 用 `android_tap` / `android_type` / `android_scroll` 操作 → 需要看图时用 `android_see` 截图理解

### AI 可用工具
| 工具 | 能力 |
|---|---|
| `android_a11y_status` | 查询无障碍服务状态（未开启时返回引导文案） |
| `android_screen` | 读当前屏幕控件树（文字 / 坐标 / 可点击性 / 可输入性） |
| `android_screen(scope="current")` | 强制读取用户真实主屏当前应用，绕过虚拟屏透明路由 |
| `android_tap` | 按文字 / 描述 / 坐标点击 |
| `android_type` | 输入文本到输入框（WebView / 网页输入框用 `paste:true` 走剪贴板粘贴） |
| `android_back` / `android_home` | 系统返回键 / 回桌面 |
| `android_scroll` | 上 / 下 / 左 / 右滚动 |
| `android_see` | 无障碍截图并发送给视觉模型理解（需 Android 11+ 与支持图片的模型，如 `deepseek-v4-flash-vision-exp`） |

> 无障碍通道与特权通道互补：无障碍不依赖授权、擅长读屏与点击；Shizuku/root 通道擅长系统级操作（装应用 / 改设置 / 系统输入）。

## 📦 安装

下载 [Releases](https://github.com/hkx521/deepseek-harness-android-updater/releases) 里的 APK 安装即可：

- **`DeepSeekHarness-v1.7.0.apk`（正式版，推荐）**：包名 `com.deepseek.harness`，从旧版本同签名升级
- **`DeepSeekHarness-Lite-v1.7.0.apk`（Lite 共存版）**：包名 `com.deepseek.harness.beta`（端口 3082），与正式版完全独立、可同时安装；数据独立在 `/sdcard/DeepSeekHarnessLite/`，API Key 需单独填
- **`DeepSeekHarness-Compat-v1.7.0.apk`（兼容版）**：包名 `com.deepseek.harness.compat`（端口 3084），老 WebView 设备可用

要求：
- Android 7.0（API 24）及以上
- 系统操作能力需配合 [Shizuku](https://shizuku.rikka.app/)（免 Root 授权）或有 root；**都不授予也能正常使用**（文件操作只需「所有文件访问」权限）
- API Key 在 App 内页面填写，只存本机，绝不打包进 APK

> 🆘 **打不开 / 白屏 / 连接失败？** 先看 [启动排查](docs/启动排查.md)（常见问题都能自助解决）。

## 📁 目录结构

```
CHANGES.md              版本改动记录（含 @Suyi222 贡献的 v1.1.1 稳定基线）

android-app/             APK 构建工程
├── build.sh             一键打包脚本
├── env.sh               编译工具链环境（可 export PREFIX 覆盖）
├── AndroidManifest.xml  包名/targetSdk(28)/横竖屏自由旋转/Shizuku 声明
├── libs/                Shizuku 官方 aar（api/provider/aidl 13.1.5）
├── res/                 图标 + 字符串资源
├── sdk/                 放 platform android.jar（见 sdk/README.md）
└── src/.../MainActivity.java   Android 原生壳（权限引导页/加载页/引擎启动）

mobile-patch/            移动端适配（注入 DSH 前端，不覆盖原生代码）
├── inject.sh            注入脚本（mobile.css + mobile.js 到 dist）
├── mobile.css           触摸优化 + 竖屏适配 + 插件管理页 UI 适配
└── mobile.js            软键盘适配（VisualViewport 方案，横竖屏通用）

plugins/                 手机端自定义 DSH 工具插件
├── dsh-tool-shizuku/    特权 shell（Shizuku 通道）
├── dsh-tool-android/    结构化系统操作（包管理/应用/设置/截图/输入）
└── dsh-tool-accessibility/  无障碍读屏/模拟操作（v1.7.0）

dsh-patches/             DSH 源码补丁归档 + overlay
├── README.md            补丁说明（适配原因/升级 DSH/打包）
├── apply.sh             重新应用源码补丁
└── overlay/             改好后的源码文件

config/cordis.patch.yml  DSH 组合配置（禁原生模块 + 插入 bash-local/shizuku/android 插件）

docs/开发指南.md            项目开发指南（架构/常用命令/注意事项）
```

## 🔨 构建说明

详见 `docs/开发指南.md` 第六节「常用命令」与第七节「注意事项」。

本项目增加了可重复执行的 DSH 升级与打包流程，推荐使用：

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -e .
.\.venv\Scripts\python -m tools.dsh_updater doctor
.\.venv\Scripts\python -m tools.dsh_updater all `
  --base-apk .\input\DeepSeekHarness-official-v1.7.5.apk
```

流程会读取 `updater.lock.json` 锁定 DSH 版本与上游 commit，在 `build/updater/devhome` 中准备独立运行环境，然后输出：

```text
dist/DeepSeekHarness-1.9.0-dsh0.1.5rc1.apk
dist/DeepSeekHarness-1.9.0-dsh0.1.5rc1.apk.sha256
```

升级与签名细节见 `docs/DSH更新与打包.md`。

关键点：
- `targetSdk` 必须保持 **28**（≥29 会导致 node 二进制 EACCES 起不来）
- 需准备 `runtime/`（node v26 + 依赖库）和 `dshroot/`（DSH 内核）才能打完整 APK
- `build.sh` 会自动注入 mobile.css/mobile.js，并做 API Key 安全检查

### 从零构建：需要自备什么

本仓库**只有源码与配置**，下面这些都不入仓库，需要自己准备：

| 依赖 | 说明 |
|---|---|
| JDK 21+ | 编译 `android-app/src`。脚本默认找本机 Corretto 的固定路径；装在别处就设 `JAVAC=<javac 路径>` 或 `JAVA_HOME` |
| Android SDK | `ANDROID_HOME`（或 `ANDROID_SDK_ROOT`）＋ **build-tools**（提供 `aapt` / `d8` / `zipalign` / `apksigner`）。默认用 `build-tools/36.1.0`，装了别的版本就设 `ANDROID_BUILD_TOOLS=<sdk>\build-tools\<版本>` |
| Python 3.10+ | 构建脚本与测试（`pip install -e .`） |
| Node ≥ 22 + 网络 | 全量链路要下载 DSH 内核；锁定版本见 `updater.lock.json` |
| `runtime/`、`dshroot/` | node 运行时与 DSH 内核，从 Releases 的分块包合并 |
| 底包 `android-app/DeepSeekHarness.apk` | repack 阶段的基线 APK；缺失时 `tests/` 里依赖 payload 的用例会自动 skip |
| 签名密钥 `android-app/release.jks` | 自备；口令走 `KEYSTORE_PASS` 环境变量，或 `python -m tools.dsh_updater init-signing` 生成的 `.local/signing.env`。密钥与口令都不入仓库 |
| Git Bash | `android-app/build.sh` 需要 bash |

两条构建路径：

`
# A) 全量：从上游拉取并组装 runtime/dshroot，输出 dist/（需要 node + bash + 网络）
python -m tools.dsh_updater doctor
python -m tools.dsh_updater all --base-apk .\input\DeepSeekHarness-official-v1.7.5.apk

# B) 已有底包时的本地增量：r(资源) -> j(javac) -> d(d8) -> res(资源包) -> pack(repack) -> sign(签名)
python tools/b47_build.py all          # 也可单跑某阶段，如 python tools/b47_build.py j,pack
`

> `tools/b47_build.py` 是 **Windows 优先**的本地增量工具（调 `aapt.exe` / `d8.bat` / `zipalign.exe`，类路径用 `;` 分隔）；其他平台请走 A 路径。

> ⚠️ 这是源码与配置仓库，**不含 APK 二进制、签名密钥（release.jks）、node 运行时、payload.zip、凭证文件**。
> 📦 安装包（DeepSeekHarness.apk）、node 运行时与 DSH 内核分块包见 [Releases](https://github.com/hkx521/deepseek-harness-android-updater/releases)；构建源码前需准备 runtime/ 与 dshroot/（分块包合并方法见 Release 说明）。

## 💬 交流讨论

> 交流渠道二维码未随本仓库发布（含个人联系方式）。

> 也可以直接在 [Issues](https://github.com/hkx521/deepseek-harness-android-updater/issues) 反馈，我会尽快回复。

## 📄 许可证

本项目源码采用 [MIT](LICENSE) 许可证。

- 依赖的 DSH 内核（@deepseek-ai/dsh）为 MIT；Shizuku SDK 为 Apache-2.0；node 运行时为 MIT。
- 仓库不含签名密钥与凭证；安装包与运行时见 [Releases](https://github.com/hkx521/deepseek-harness-android-updater/releases)。

## 🙏 致谢 / Acknowledgments

虚拟屏（vscreen）功能的机制与代码源自开源社区，特此感谢：

- [Operit](https://github.com/AAswordman/Operit)（AAswordman）—— 虚拟屏机制源头，相关代码按 **LGPL-3.0** 分发（声明与义务履行详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，许可证全文见 [`licenses/`](licenses/)）
- [woaiys3/deepseek-harness-android-app](https://github.com/woaiys3/deepseek-harness-android-app)（v1.11）—— vscreen 服务端的移植基线
- [Shizuku](https://github.com/RikkaApps/Shizuku)（RikkaApps）—— 免 root 特权通道，SDK 按 **Apache-2.0** 使用
