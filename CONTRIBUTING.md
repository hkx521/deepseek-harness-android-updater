# 贡献指南

感谢你愿意为 DeepSeek Harness 手机版（Android）做贡献！本指南覆盖如何报告问题与提交代码。

## 项目一句话

把 DeepSeek Harness（DSH 内核）打包成可直接安装的 Android APK，通过 Shizuku 免 Root 让 AI 真正操作手机。

## 报告问题（Issue）

### Bug 报告

请使用 [Bug 模板](.github/ISSUE_TEMPLATE/bug_report.md) 并尽量包含：

- **设备与系统**：机型、Android 版本、是否 ColorOS/MIUI 等定制系统
- **App 版本**：v1.x.x（或 versionCode）；是否最新 Release
- **Shizuku 状态**：服务是否运行、是否已授权
- **复现步骤** + 期望行为 + 实际行为
- **日志**：
  - 崩溃日志：`/sdcard/DeepSeekHarness/crash.log`
  - 引擎日志：App 内部 `files/dsh-web.log`（需 adb 或 Root 查看）
  - 启动失败排查见 [docs/开发指南.md](docs/开发指南.md) 第七节注意事项

### 功能建议

请说明使用场景与期望效果，方便评估。

## 提交代码（Pull Request）

1. **Fork** 本仓库，在 `main` 基础上开一个功能分支（如 `fix/sidebar-overlay`、`feat/xxx`）
2. 完成改动后提交，**PR 描述使用 [PR 模板](.github/pull_request_template.md)**
3. 若改动 UI，附截图；若改动构建脚本，附构建/自测结果
4. 等待维护者 review；涉及行为变更的建议先在 Discussion 讨论

### 改动范围速览

| 目录 | 内容 |
|---|---|
| `android-app/` | APK 构建工程（MainActivity 原生壳、build.sh） |
| `mobile-patch/` | 移动端适配（mobile.css / mobile.js / inject.sh） |
| `plugins/` | 手机端 DSH 插件（shizuku / android） |
| `dsh-patches/` | DSH 源码补丁 + overlay（升级 DSH 后需重新应用） |
| `config/` | DSH 组合配置 cordis.patch.yml |
| `docs/` | 开发指南 / 启动排查 / vscreen 使用说明 / 真机回归清单 |

## 开发与构建

- 完整开发环境（runtime / dshroot / build 工具链）**不在本仓库**，需自行准备：node 运行时、DSH 内核（`@deepseek-ai/dsh` 0.1.5-rc.1，锁定值见 `updater.lock.json`）、aapt/javac/d8/zipalign/apksigner
- 各依赖（JDK / Android build-tools / Python / Node / 签名）准备清单见 [README.md](README.md) 的「从零构建：需要自备什么」
- 打包：`cd android-app && sh build.sh`（需 `DSH_DEV_HOME`、`ANDROID_JAR`、`KEYSTORE_PASS` 等环境变量，详见 [android-app/README.md](android-app/README.md) 与 [docs/开发指南.md](docs/开发指南.md)）
- **安装包自测**：从 APK 抽出 payload 实测引擎 HTTP 200（防 ERR_CONNECTION_REFUSED），方法见 [docs/开发指南.md](docs/开发指南.md) 第四节
- 构建产物（APK、payload.zip、android.jar）与签名密钥不入仓库，见 [.gitignore](.gitignore)

## 硬性要求

1. **绝不提交密钥/凭证**：`release.jks`、API Key（`sk-` 开头）、`.credentials.yaml` 等严禁入仓库；提交前请自查
2. **targetSdk 保持 28**：≥29 会导致 node 二进制 EACCES 起不来（详见开发指南）
3. **保留署名**：合并社区贡献（如 @Suyi222 的 v1.1.1 稳定基线）时保留作者署名，并在 CHANGES.md 致谢
4. 大二进制（APK、tar 分块）走 GitHub Release，不进仓库

## 行为准则

参与本项目即表示同意 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
