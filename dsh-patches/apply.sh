#!/system/bin/sh
# ⚠️ 已废弃（2026-09-11 起）—— 请勿运行本脚本。
#
# 废弃原因（实测）：
#   1. 布局不匹配：本脚本按「嵌套」布局
#        dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>
#      自检并覆盖；而 DSH 0.1.5-rc.1 起是「扁平」布局
#        dshroot/lib/node_modules/@deepseek-ai/<pkg>（共 240 个包）
#      上面那个嵌套目录根本不存在。
#   2. 源码过期：dsh-patches/overlay 里的补丁文件未随上游更新
#      （如 dsh-attachment-local 为 15 KB，现网已是 46 KB）。
#   3. 危害：若强行运行，会在 dsh 包下新建一层 node_modules；Node 解析该层优先，
#      会把 compatibility 层已打好的修复「盖回」未修复版本（例如 link 又回来 → EACCES）。
#
# 正确机制（live）：
#   tools/dsh_updater/compatibility.py
#     └─ compatibility/<dsh 版本>/apply.py     # 精确字符串替换补丁
#     └─ compatibility/<dsh 版本>/overlay/     # 整文件替换（koffi / sharp / node-pty …）
#   由 `python -m tools.dsh_updater prepare`（首次）或 `refresh`（已准备好后）自动应用。
#
# 本脚本保留仅为归档说明；dsh-patches/overlay 同样只作历史存档。
set -e

echo "!! dsh-patches/apply.sh 已废弃，本次未执行任何操作。" >&2
echo "   请改用: python -m tools.dsh_updater prepare   # 或 refresh" >&2
echo "   补丁现在位于 compatibility/<版本>/apply.py 与 compatibility/<版本>/overlay/" >&2
exit 1
