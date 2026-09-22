# plugins/ —— 手机端自定义 DSH 工具插件

本项目给 DeepSeek Harness 增加的两个 Android 专属能力插件，**全部通过 Shizuku 特权通道执行**（免 Root）。

| 插件 | 包名 | 能力 |
|---|---|---|
| `dsh-tool-shizuku` | `@deepseek-ai/dsh-tool-shizuku` | **特权 shell**：任意系统命令（`pm` / `am` / `settings` / `dumpsys` / `input` / `screencap`…），异步执行 + 环境消毒 + dex 只读自愈 |
| `dsh-tool-android` | `@deepseek-ai/dsh-tool-android` | **结构化系统操作**：包管理（安装/卸载/清数据/授权）、应用管理（启动/强制停止）、系统设置读写、截图、模拟输入（点击/滑动/文本/按键） |

> 有了这两个插件，AI 不再只是"聊天"，而是能**真正操作你的手机**——这也是本项目和纯聊天 App 的核心区别。

## 如何启用

插件本身是 npm 包（`defineTool` 注册），由 DSH 组合配置 `config/cordis.patch.yml` 的 `insert:` 注入：

```yaml
- insert:
    - id: tool-shizuku
      name: '@deepseek-ai/dsh-tool-shizuku'
    - id: tool-android
      name: '@deepseek-ai/dsh-tool-android'
```

- 开发时：包放在 `dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下，并在 dsh 的 `package.json` dependencies 里声明
- 打包时：随 `dsh-patches/overlay/` + `apply.sh` 归档进源码，build.sh 打进 APK

## 审批策略

- 默认：在用户已授权的 Shizuku 通道下**自动执行**（无需逐次审批）
- 恢复逐次确认：给 node 进程设环境变量 `SHIZUKU_APPROVE=ask`，此时 `dsh-tool-android` 的**危险操作**（install/uninstall/clear/grant/revoke/force_stop/put/tap/swipe/text/keyevent）会弹审批框

## Android 兼容三修复（踩坑沉淀）

1. **异步 `spawn` 而非 `spawnSync`**：同步执行会阻塞 node 事件循环，命令期间整个 DSH 后端（HTTP/WebSocket）卡死，前端报 `Failed to fetch`
2. **`sanitizeEnv()`**：剥离 `LD_LIBRARY_PATH / LD_PRELOAD / LD_DEBUG`——DSH 运行时的自定义 `libz.so` 会污染系统 `app_process` 的链接，不剥离报 `cannot find libz.so from verneed[1]`
3. **`ensureDexReadOnly()`**：每次执行前 `chmod 444` rish dex——Android 15 ART 拒绝加载"当前 uid 可写"的 dex（`Writable dex file is not allowed` → Abort）

## 已知限制

- **ColorOS 上 `pm install` 报 binder 限制**：安装 APK 需用户手动点装；`pm clear / uninstall` 可用
- Shizuku shell 权限上限（uid=2000）：不能读其他 App 私有数据、不能改 /system 分区（详见 `docs/开发指南.md` 第九节）

## 开发提示

- peerDependencies：`@deepseek-ai/dsh-tools`、`@deepseek-ai/cordis`（版本见各 package.json）
- 调试 rish：`app_process -Djava.class.path=<rish dex> /system/bin --nice-name=rish rikka.shizuku.shell.ShizukuShellLoader -c "<命令>"`，环境变量 `RISH_APPLICATION_ID=com.deepseek.harness`
