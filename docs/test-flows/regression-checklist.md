# 真机回归清单（test-flows）

> 目的：把「真机验证后才算完成」红线制度化——每批次构建装机后，按本清单执行并输出 pass/fail/skip 表，
> 不再依赖人工回忆。**自动化部分请跑 python -m pytest tests/ -q + 本批次相关的 tools/e2e_*.py**；
> 原 tools/regression.sh 已于批次86 移入 tools/attic/（依赖 su，本机无 root 必失败，见该目录 README），
> 下表 T0-T7 保留为**判据口径**（不再是某一条命令的输出）。人工部分为本表 T8-T10。
> 纪律：**校验/注入类逻辑必须高噪 + 静置双状态各跑一轮**（批次 19 教训：静置全绿≠高噪不假成功）。

## 自动化（regression.sh 覆盖）

| # | 场景 | 判据 | 风险覆盖 |
|---|---|---|---|
| T0 | 冷启就绪 | force-stop→启动→/dump 就绪 ≤15s（基线 730-1000ms） | 启动链回退 |
| T1 | /status 诊断字段 | clickEvents/windowEvents 存在 | 事件投递配置回退 |
| T2 | DocumentsUI 行点击 | found:true 且窗口焦点实际切换 | 原生 View 点击（最小可点击子节点） |
| T3 | 空白区点击 | ok:false + INJECT_NO_EFFECT，焦点不变 | 诚实失败（不假成功） |
| T4 | DSH 页签 text 切换 | found:true 且 selected 翻转 | WebView 抗噪证据链 |
| T5 | 特权通道对照 | su input tap 后 selected 翻转 | 特权通道可用性 |
| T6 | /input 探针 | ok:true | 输入链路 |
| T7 | 无 token 请求 | 401 unauthorized | fail-closed（批次20） |

## 人工/半自动（每批次按改动面选做）

| # | 场景 | 步骤 | 判据 |
|---|---|---|---|
| T8 | 事务内 back/tap 竞态 | android_act 事务 `[tap行, back, tap行, back]`（第三方复测同款） | 每步验证通过且终态落位正确；观察 3 轮 |
| T9 | 高噪 WebView 全链 | 流式对话进行中：页签切换×2、侧边栏开合、tap 后 uiHint 出现 | 全部真实生效，无 found:true 无效果 |
| T10 | 熄屏挂机 | trusted 会话 + 熄屏 **10min** 任务推进（vscreen 或 chroot 长任务）；deep doze 边角用 `dumpsys deviceidle force-idle` 秒级强制模拟（2026-09-14 起：趋势判据不等长跑） | 任务持续推进、亮屏无状态错乱（V4 判据） |

## 排障速查

- T0 超时：logcat 查 `engine start timeout`/`EADDRINUSE`（#26 治理后应为 0）。
- T2/T4 found:true 但无效果：先看 method（node-*/gesture-after-click-noop/gesture-*/gesture-verified-noop），
  再 `/status` 对比 clickEvents 增量判断 VIEW_CLICKED 投递；必要时截屏留证。
- T7 失败（无 token 也能访问）：确认装的是批次20 后构建（versionCode 28+）。
- token 全部 401：引擎可能运行中 token 被重生成（fail-closed 代价）——重启 App/引擎即恢复。
