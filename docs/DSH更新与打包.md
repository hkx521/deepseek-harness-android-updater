# DSH 更新与 APK 打包

本项目把 DSH 版本、Node 运行时、Android 兼容补丁和签名流程放在同一条可重复执行的构建链路中。

## 版本锁定

版本定义在仓库根目录的 `updater.lock.json`：

- Android 基线：`v1.7.5`
- DSH npm 包：`@deepseek-ai/dsh@0.1.5-rc.1`
- 官方 tag：`dsh-v0.1.5-rc.1`
- 官方 commit：`183f08e9c6dde7e36cd2318eaee70b0da08fb35e`
- 兼容配置：`compatibility/0.1.5-rc.1`

不要直接修改安装目录里的 `package.json`。升级版本时同时更新 lock 文件并新增对应兼容配置。

## 首次准备

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -e .
.\.venv\Scripts\python -m tools.dsh_updater doctor
.\.venv\Scripts\python -m tools.dsh_updater init-signing
```

把官方基础 APK 放到：

```text
input/DeepSeekHarness-official-v1.7.5.apk
```

## 构建

```powershell
.\.venv\Scripts\python -m tools.dsh_updater all
```

也可以分步执行：

```powershell
.\.venv\Scripts\python -m tools.dsh_updater prepare --force
.\.venv\Scripts\python -m tools.dsh_updater verify
.\.venv\Scripts\python -m tools.dsh_updater build
```

`prepare` 会完成：

1. 从基础 APK 提取 `assets/payload.zip`。
2. 分离 `runtime`、`dshroot`、`.dsh` 和 `rish`。
3. 用 npm 安装锁定的 DSH 版本。
4. 复制 Shizuku、Android 系统和无障碍工具插件。
5. 应用 Android 兼容层并删除构建环境中的凭证文件。
6. 生成 Android SDK、JDK 和 Git Bash 使用的构建环境。

最终的 Android payload 必须在 `.dsh/profiles/web/node_modules` 中提供三个自定义插件。不要整包复制 profile 依赖，否则会带入第二套 DSH 核心并造成 persona/服务重复注册；构建脚本只复制插件，并用 shim 复用宿主 `dsh-tools`。

## Android 兼容层

`compatibility/0.1.5-rc.1` 包含以下替换：

- `node-addon-require-builtin`：使用 `--expose-internals`，不再依赖没有 Android 预构建的 N-API 模块。
- `koffi` 和 `dsh-win32-process`：在 Android 上禁用 Windows/Linux 原生进程范围探测。
- `node-pty`：使用 `child_process` 兼容终端接口。
- `sharp`：使用 PNG/JPEG/WebP/GIF 头部解析，图片默认按原字节保存，不调用 libvips。
- `node-addon-system/flock`：使用 DSH 进程内写入 claim，Android 上不加载原生 flock。
- session 与 attachment：硬链接改为带排他标志的复制。

`permission` preset 插件在 Android 上禁用，因为当前 Bash 执行器没有 Landlock 沙箱。

## 验证

`verify` 会检查：

- 所有包版本与 lock 文件一致。
- Android 兼容文件全部存在。
- 插件配置包含三个手机工具插件。
- DSH CLI 能报告正确版本。
- 构建环境里没有 `.credentials.yaml` 或 `credentials.yaml`。

发布前还需在真机验证：

1. 首次启动与运行时解压。
2. 聊天、流式回复和会话恢复。
3. 文件读写与 Bash。
4. Shizuku/root 工具。
5. 无障碍读屏、点击和截图。
6. 旧会话从 V2 迁移到 V3。

## 签名限制

项目的 `release.jks` 默认由本机生成，与上游作者的签名不同。Android 不允许不同签名的同包名 APK 覆盖安装。

因此有两种安装方式：

- 卸载上游正式版，再安装本项目 APK。
- 修改包名构建独立测试版，保留上游正式版。

不能直接把本项目 APK 当作上游正式版的原地升级包。
