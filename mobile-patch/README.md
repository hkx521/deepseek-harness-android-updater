# mobile-patch/ —— 移动端适配补丁

DSH 原生前端是桌面端设计，本目录的补丁把它适配到手机屏幕（竖屏 + 触摸）。**不覆盖原生代码**，只注入样式与脚本，DSH 内核升级后仍可自动重新注入。

| 文件 | 作用 |
|---|---|
| `inject.sh` | 注入脚本：把 `mobile.css` / `mobile.js` 复制进 DSH 前端 dist，并在 `index.html` 的 `</head>` 前加 `<link href="/mobile.css">`、`</body>` 前加 `<script src="/mobile.js">`（幂等，重复执行安全） |
| `mobile.css` | 移动端布局与触摸优化（v1.1.1 起） |
| `mobile.js` | 软键盘适配 + 键盘防自动聚焦（v1.1.1 / v1.3.1） |

## 注入机制

- **打 APK 时**：`android-app/build.sh` 第 0 步自动调用 `sh mobile-patch/inject.sh`（注入到构建用的 dist），并随 payload 打包
- **运行目录**：外部 `/sdcard/DeepSeekHarness/dshroot/.../dsh-web-frontend/dist/` 里的 `mobile.css/js/index.html` 在 `FORCE_OVERWRITE_PREFIXES` 白名单内，随 APK 强制覆盖
- **手动同步**：`sh mobile-patch/inject.sh <dist目录>` 可指定任意 dist

## 当前适配内容（v1.3.1）

- **消息操作条多行换行**（复制/赞踩/分支/时间/耗时/token），窄屏不再一行溢出
- **标题栏让位三条杠**（`padding-left:52px`），聊天区全宽
- **正文/输入框扩宽**：消息区 padding 32→8px；composer 边距 16/8→4px
- **滚动条不占位**（`scrollbar-gutter:auto`），修复有会话时输入栏按钮重叠
- **Bash 工具卡片防横向溢出**（命令/输出 `pre-wrap` + `word-break`）
- **后台任务菜单右对齐防溢出**
- **设置页单栏适配**（导航横排可滚动 + 内容区可滚动）
- **键盘防自动聚焦**：切换话题/新会话不弹键盘，只有点击输入框才弹（`pointerdown` 位置判断，mobile.js）

> 窄屏**侧栏改造**（三条杠按钮 + 浮层侧栏 + 聊天区全宽）是**直接改核心源码** `dsh-client-ui-layout/lib/client.js`（AppFrame 组件），不在本目录——见 `docs/开发指南.md` 与 `CHANGES.md` v1.3.0/v1.3.1。

## 注意

1. 前端 CSS 类名（`.p-xYUq_actions`、`.wSkVaW_header` 等）是运行时插件**动态注入**的 CSS module 类名，不在预构建 bundle 里；改样式前先用 DevTools/源码确认真实类名
2. 改完运行目录里的 `mobile.css/js` 后，需**彻底杀掉 App 重开**（node 进程内存缓存旧模块），仅刷新页面不生效
3. 不要用 JS 把 DOM 移到 `#root` 外（React 事件委托挂 #root，移出后 onClick 全失效）；改位置用 CSS `position:fixed`
