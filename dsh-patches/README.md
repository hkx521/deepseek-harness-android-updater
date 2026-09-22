# DSH 源码补丁说明

> ⚠️ **本目录自 2026-09-11 起归档，`apply.sh` 已废弃、请勿运行**（原因见脚本头部注释：
> 它按已不存在的「嵌套」布局自检，且 overlay 源码未随上游更新，强行覆盖会把已修复的包盖回未修复版本）。
>
> **Android 适配补丁的 live 机制是 `compatibility/<dsh 版本>/`：**
> - `apply.py` —— 精确字符串替换，**整体幂等**（2026-09-11 起：替换结果已存在即跳过，重跑为 no-op；
>   上游漂移仍会在回落 `replace_once` 时因 `count != 1` 报错，不会静默失配）
> - `overlay/` —— 整文件替换（koffi / sharp / node-pty / node-addon-* …）
> - 由 `python -m tools.dsh_updater prepare`（首次）或 `refresh`（已准备好后）自动应用
>
> 本目录的 `overlay/` 仅作历史存档。

## 目录结构

```
dsh-patches/
├── README.md              本文件
├── apply.sh               重新应用源码补丁（带语法自检）
└── overlay/               改好后的源码文件
    └── lib/node_modules/@deepseek-ai/dsh/node_modules/
        ├── dsh-subprocess-local/          子进程模拟（适配 Android）
        ├── dsh-attachment-local/          附件处理（适配 Android）
        ├── dsh-bash-local/                bash 沙箱兼容
        ├── dsh-session-persistence-jsonl/ 会话持久化（适配 Android）
        ├── dsh-tool-shizuku/              Shizuku 特权插件（三层修复版）
        └── dsh-tool-android/              系统能力插件
```

## 架构

```
APK (com.deepseek.harness)
├── Android 壳（MainActivity：权限引导页 + WebView + 解压 payload + 拉起 node）
├── payload（首次解压到 files/）
│   ├── runtime/               node 二进制 + .so
│   ├── dshroot/               DSH 内核（含本补丁）
│   ├── dshhome/               DSH 配置（无凭证）
│   └── bin/bash               shim（/system/bin/sh）
└── 前端 = DSH 原生界面 + mobile-patch 移动端适配
    ├── 页面加载 http://127.0.0.1:3080
    ├── 发消息：POST /api/session.prompt
    └── 收流式回复：WebSocket ws://127.0.0.1:3080/api/events.mux
```

## Android 源码补丁

DSH 有 4 处需要适配 Android 的源码改动，更新 DSH 后需重新应用：

| 补丁 | 原因 | 改动 |
|---|---|---|
| dsh-subprocess-local | node-pty 原生模块 Android 无法编译 | 用 child_process 模拟 |
| dsh-attachment-local | sharp 原生模块 + Android 禁硬链接 | 纯 JS 头解析 + link→rename |
| dsh-bash-local | 原生沙箱禁用后需兼容 | 补 sandboxMode getter |
| dsh-session-persistence-jsonl | Android SELinux 禁硬链接 | link→rename |

## 如何升级 DSH 版本

```sh
# 1. 更新 DSH 包（开发环境，需 npm）
source $DEV_HOME/runtime/env.sh
cd $DEV_HOME/dshroot/lib/node_modules/@deepseek-ai/dsh
npm install @deepseek-ai/dsh@latest

# 2. 重新应用 Android 源码补丁（带语法自检，源码变了会报错提醒）
sh dsh-patches/apply.sh

# 3. 重新打包 APK（会自动注入 mobile-patch 移动端适配）
cd android-app && bash build.sh
```

## 如何打包 APK

```sh
cd android-app && bash build.sh
# 产物：android-app/DeepSeekHarness.apk
```

build.sh 会自动：

1. 组装 payload（runtime + dshroot + dshhome + bin）
2. 注入移动端适配（`mobile-patch/inject.sh`，mobile.css + mobile.js 到 DSH 前端 dist）
3. 安全检查（payload 里禁止出现 API Key / .credentials.yaml）
4. aapt/javac/d8/zipalign/apksigner 全流程

## 移动端适配（mobile-patch/）

- 纯 CSS/JS 注入，不覆盖 DSH 原生页面
- `mobile.css`：触摸优化 + 插件管理页 UI 适配
- `mobile.js`：软键盘适配（VisualViewport 方案）
- 改适配 = 改 `mobile-patch/` 里的文件，重新 `build.sh` 即可，不碰 DSH 源码

## 插件管理

DSH 插件系统（cordis）通过 `dsh plugin`（内部转 pnpm）安装：

```sh
source $DEV_HOME/runtime/env.sh
export DSH_HOME=$DEV_HOME/.dsh
node --expose-internals $DEV_HOME/dshroot/lib/node_modules/@deepseek-ai/dsh/lib/bin.js \
  plugin --profile web add <插件包名>
```

装完重新 `build.sh` 打进 APK。注意：插件若依赖原生模块，需像上面 4 个补丁一样做 Android 适配。

## 关键注意事项

- node 运行需要 `LD_LIBRARY_PATH=runtime/lib`（libz/libicu 等软链由 APK 首次解压后按 LINKS.txt 重建）
- DSH 启动必须 `--expose-internals`（否则 HMR 报错）
- Android 无 `/usr/bin/env`，所有 wrapper 用 `#!/system/bin/sh`
- API Key 通过页面 `credentials.set` 写入本机，**绝不打包进 APK**
