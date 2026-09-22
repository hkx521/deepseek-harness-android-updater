# .githooks

## 为什么存在

本仓库要求「改动即落盘」：源码/测试/工具改动了，却没有对应的当日 journal 记录或 CHANGES.md 更新时，
提交会被拒绝。这防止了「打开新对话不知道做到哪」以及「未提交改动意外丢失」。

## 安装（每个克隆一次）

```sh
git config core.hooksPath .githooks
```

## 判定规则（tools/journal_sync.py --check）

1. 忽略无源码改动的情况；
2. 命中扫描前缀 `android-app/src`、`android-app/res`、`tools/`、`tests/` 的改动视为「源码改动」；
3. 若同时存在 `CHANGES.md` 改动，或 `docs/journal/<今日>.md` 处于改动状态 → 放行；
4. 否则 FAIL 并打印待记录文件清单。

## 修复动作

```sh
python tools/journal_sync.py           # 写当日 journal（含模型与额度 / 产出 / 决策 / 验证）
python tools/journal_sync.py --state   # 刷新 docs/STATE.md
python tools/journal_sync.py --check   # 自检
```

## 生命周期

- 每日 23:30 的自动化 `journal` 会兜底补记录并提交，所以即使某次被闸门拦住也不会丢。
