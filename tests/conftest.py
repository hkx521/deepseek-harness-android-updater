"""pytest 公共配置。

只做一件事：**依赖可选的用例在缺依赖时优雅跳过**，而不是让整轮收集报错。
目前唯一需要第三方库的用例是 `test_batch46_ui_diff.py`（用 Pillow 现场合成图，
再调 `tools/ui-diff.py` 比对）；CI（.github/workflows/ci.yml）会显式安装 pillow，
所以那边照常运行，本地没装 Pillow 的环境则直接跳过这个文件。
"""

from __future__ import annotations

import importlib.util

collect_ignore: list[str] = []
if importlib.util.find_spec("PIL") is None:
    collect_ignore = ["test_batch46_ui_diff.py"]
