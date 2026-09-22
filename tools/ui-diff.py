# -*- coding: utf-8 -*-
"""批次46 · 底部灵动胶囊「像差」客观指标工具（UI diff）。

对比两张截图（原厂 YOYO vs 自研实现）底部区域的相似度、几何与配色差异，
输出可复核的 JSON 指标 + 人读摘要，替代肉眼比对。

用法::

    python tools/ui-diff.py --ref 原厂.png --test 自研.png [--out 结果.json]
    python tools/ui-diff.py 原厂.png 自研.png [--bottom-px 400] [--ssim-floor 0.90]

三组指标：

1. ``ssim_overall`` / ``ssim_dark``：底部区域灰度 SSIM。**自实现**盒窗
   （uniform window）SSIM，不依赖 scikit-image；装了 numpy 走 numpy 快路径，
   没 numpy 走纯 Python 路径，两条路径数学等价。``ssim_dark`` 只在 ref 暗带
   mask 的像素上取平均。
2. ``geometry``：暗带上沿/下沿、左右边缘、宽高、左右边距、圆角半径估计，
   以及 test-ref 的逐项 ``deltas``。
3. ``color``：胶囊内平均 RGB、上方背景平均 RGB、暗化系数（相对 ref 的亮度下降比例）。

定位规则（比 .local/b45_capsule.py 更保守，避免把壁纸 / 整屏同色面板当胶囊）：

* 行命中底色（默认目标 (31,34,42)、单通道 ±14）且「连续命中段」足够宽；
* 逐级放宽行填充率阈值 0.75 → 0.5 → 0.3 → 0.2；
* 暗带高度须 ≥ ``--min-band-px``（默认 40），且不能同时贴住裁剪区上下沿；
* 圆角胶囊左右必有边距：命中段横跨整幅宽度时判为「非胶囊」并拒绝
  （确需放宽用 ``--allow-full-width-band``）；
* 胶囊内控件会把整行填充率拉低，故**先按「已确认段的左右包络」向外扩张补齐、
  再判高度**（否则居中大图标会把整条胶囊切成两段、两段都不够 ``--min-band-px``）；
* 圆角半径用「行内缩量随 y 变化」的最小二乘拟合（模型 d(t)=r-sqrt(r²-(r-t)²)）；
  因 PIL 光栅化量化，估计值通常比设计值小约 1px，只做提示、不参与 pass 判定。

阈值：``--ssim-floor``（默认 0.90）判整幅 SSIM 与几何误差（>2px 即失败）；
``--dark-ssim-floor``（默认同 ``--ssim-floor``）单独判暗带 SSIM —— 暗带 SSIM 只在
ref 暗带 mask 上取平均，量纲比整幅敏感得多，真实样张常常远低于 0.90，需要时单独放宽。

已知限制：

1. 批次44/45 的真机截图中胶囊是半透明玻璃效果，实测底色可能是 ``(52,39,47)``
   这类被壁纸混色的值，此时要用 ``--band-color`` 指定实测底色（``--band-tol``
   收到 6 左右），否则底部裁剪区内命中不到默认底色，geometry 会是 null
   （判定里会明确说明原因）。
2. 检测器只能保证「找到一条有边距的圆角暗带」，不能证明它就是胶囊：
   底部 400px 内的卡片 / 抽屉 / 圆角面板也会被接受。请连同 ``band_height_px``、
   ``corner_radius_top/bottom_px_est``、``corner_radius_residual_px`` 一起看；
   实测中「高度远超胶囊（如 229px）」或「上下半径差 > 20px」基本可判为非胶囊。
3. 判定只认「几何误差 > 2px 或 SSIM 低于阈值」，圆角半径差异只做提示。

退出码：0 = 分析完成；``--strict`` 且 ``verdict.pass`` 为假时 1；
参数 / 文件 / PIL 等异常时 2（打印中文错误，不抛裸 traceback）。
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from array import array
from itertools import accumulate

# ---------------------------------------------------------------- 常量

DEFAULT_BAND_COLOR = (31, 34, 42)   # 批次45 复刻的胶囊底色
DEFAULT_BAND_TOL = 14               # 单通道容差（±14）
DEFAULT_BOTTOM_PX = 400
DEFAULT_SSIM_FLOOR = 0.90
DEFAULT_SSIM_WIN = 11               # 与 skimage/scipy 常用窗口一致（奇数）
GEOM_TOL_PX = 2.0                   # 「关键几何误差」阈值
MIN_BAND_PX = 40                    # 暗带最小高度（低于此值不认为是胶囊）
ROW_SAMPLE_STEP = 4                 # 行内 x 采样步长（定位用，精度足够且快）
RADIUS_NOTE_TOL_PX = 8.0            # 圆角半径仅做提示，不参与 pass 判定

# SSIM 稳定常数（数据范围 0-255，与 Wang 2004 论文一致）
_C1 = (0.01 * 255.0) ** 2
_C2 = (0.03 * 255.0) ** 2

_GEOM_KEYS = (
    "band_top",
    "band_bottom",
    "band_height_px",
    "band_left",
    "band_right",
    "band_width_px",
    "margin_left_px",
    "margin_right_px",
)


class UiDiffError(Exception):
    """可读的中文错误（统一走 exit 2，不抛裸 traceback）。"""


# ---------------------------------------------------------------- 基础工具

def _reconfigure_stdio() -> None:
    """Windows 控制台默认 GBK，强制 UTF-8 输出避免中文/符号编码炸掉。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _import_pil():
    try:
        from PIL import Image
    except Exception as exc:  # pragma: no cover - 环境相关
        raise UiDiffError(
            "未安装 Pillow（PIL），无法读图。请先安装：python -m pip install Pillow（原始错误：%s）" % exc
        )
    return Image


def _luma(r: float, g: float, b: float) -> float:
    """Rec.601 亮度（与 PIL convert("L") 一致）。"""
    return 0.299 * r + 0.587 * g + 0.114 * b


def _parse_color(text: str):
    parts = [p.strip() for p in str(text).replace("，", ",").split(",") if p.strip()]
    if len(parts) != 3:
        raise UiDiffError("--band-color 需要形如 31,34,42 的 RGB 三元组，收到：%r" % text)
    try:
        vals = tuple(int(p) for p in parts)
    except ValueError:
        raise UiDiffError("--band-color 的三个分量必须是整数，收到：%r" % text)
    for v in vals:
        if not 0 <= v <= 255:
            raise UiDiffError("--band-color 分量必须在 0-255，收到：%r" % text)
    return vals


def _round(value, ndigits=4):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return int(value)
    return round(float(value), ndigits)


# ---------------------------------------------------------------- 灰度 / 盒窗

def _gray_rows(img):
    """灰度图 → 按行的 0-255 整数二维列表。"""
    gray = img.convert("L")
    w, h = gray.size
    buf = array("B")
    buf.frombytes(gray.tobytes())
    flat = list(buf)
    return [flat[y * w:(y + 1) * w] for y in range(h)]


def _h_window(rows, r):
    """行方向盒窗和（半径 r，边界按复制延拓 ⇒ 等价于 clamp 索引）。"""
    out = []
    for row in rows:
        w = len(row)
        pref = [0]
        pref.extend(accumulate(row))
        out.append(
            [
                pref[i + r + 1 if i + r + 1 < w else w] - pref[i - r if i - r > 0 else 0]
                for i in range(w)
            ]
        )
    return out


def _transpose(rows):
    return [list(col) for col in zip(*rows)]


def _box_window(rows, r):
    """二维盒窗和（先横向、再纵向）。"""
    return _transpose(_h_window(_transpose(_h_window(rows, r)), r))


def _window_counts(w, h, r):
    cx = [min(i + r, w - 1) - max(i - r, 0) + 1 for i in range(w)]
    cy = [min(j + r, h - 1) - max(j - r, 0) + 1 for j in range(h)]
    return cx, cy


def _ssim_python(rows_a, rows_b, win, mask_rows):
    """纯 Python 盒窗 SSIM（mask_rows 为逐行布尔表，可选）。"""
    h = len(rows_a)
    w = len(rows_a[0]) if h else 0
    if not h or not w:
        return None
    r = win // 2
    aa = [[v * v for v in row] for row in rows_a]
    bb = [[v * v for v in row] for row in rows_b]
    ab = [[x * y for x, y in zip(ra, rb)] for ra, rb in zip(rows_a, rows_b)]

    sa = _box_window(rows_a, r)
    sb = _box_window(rows_b, r)
    sa2 = _box_window(aa, r)
    sb2 = _box_window(bb, r)
    sab = _box_window(ab, r)

    cx, cy = _window_counts(w, h, r)
    inv_cx = [1.0 / c for c in cx]

    total = 0.0
    n = 0
    for j in range(h):
        inv_cy = 1.0 / cy[j]
        mask_row = mask_rows[j] if mask_rows is not None else None
        for i, (sx, sy, sx2, sy2, sxy) in enumerate(zip(sa[j], sb[j], sa2[j], sb2[j], sab[j])):
            if mask_row is not None and not mask_row[i]:
                continue
            inv_n = inv_cx[i] * inv_cy
            mx = sx * inv_n
            my = sy * inv_n
            vx = sx2 * inv_n - mx * mx
            vy = sy2 * inv_n - my * my
            cxy = sxy * inv_n - mx * my
            if vx < 0.0:
                vx = 0.0
            if vy < 0.0:
                vy = 0.0
            den = (mx * mx + my * my + _C1) * (vx + vy + _C2)
            if den <= 1e-12:
                continue
            total += (2.0 * mx * my + _C1) * (2.0 * cxy + _C2) / den
            n += 1
    if n == 0:
        return None
    return total / n


def _ssim_numpy(np, a, b, win, mask):
    """numpy 快路径：与纯 Python 版同样的 clamp 延拓 + 盒窗统计。"""
    if a.size == 0:
        return None
    r = win // 2
    area = float(win * win)

    def box(x):
        pad = np.pad(x, r, mode="edge")
        pref = np.zeros((pad.shape[0] + 1, pad.shape[1] + 1), dtype=np.float64)
        pref[1:, 1:] = pad.cumsum(0).cumsum(1)
        h, w = x.shape
        return (
            pref[win:win + h, win:win + w]
            - pref[0:h, win:win + w]
            - pref[win:win + h, 0:w]
            + pref[0:h, 0:w]
        ) / area

    mx = box(a)
    my = box(b)
    vx = np.maximum(box(a * a) - mx * mx, 0.0)
    vy = np.maximum(box(b * b) - my * my, 0.0)
    cxy = box(a * b) - mx * my
    num = (2.0 * mx * my + _C1) * (2.0 * cxy + _C2)
    den = (mx * mx + my * my + _C1) * (vx + vy + _C2)
    if mask is not None:
        num = num[mask]
        den = den[mask]
    if num.size == 0:
        return None
    return float(np.mean(num / den))


def pick_engine(requested: str) -> str:
    """auto → 有 numpy 用 numpy，否则纯 Python。"""
    try:
        import numpy  # noqa: F401
    except Exception:
        numpy = None
    if requested == "numpy" and numpy is None:
        raise UiDiffError("--engine numpy 但当前解释器没有 numpy，请改用 --engine python")
    if requested == "python":
        return "python"
    if requested == "numpy":
        return "numpy"
    return "numpy" if numpy is not None else "python"


def compute_ssim(img_a, img_b, win, mask_rows, engine):
    """同尺寸灰度 PIL 图的 SSIM；mask_rows 为同尺寸逐行布尔表或 None。"""
    if engine == "numpy":
        import numpy as np
        a = np.asarray(img_a.convert("L"), dtype=np.float64)
        b = np.asarray(img_b.convert("L"), dtype=np.float64)
        mask = np.asarray(mask_rows, dtype=bool) if mask_rows is not None else None
        return _ssim_numpy(np, a, b, win, mask)
    return _ssim_python(_gray_rows(img_a), _gray_rows(img_b), win, mask_rows)


# ---------------------------------------------------------------- 几何定位

def _row_stats(rgb_bytes, w, h, target, tol, x_step=4):
    """逐行统计命中底色的情况，返回 [(fill, run_px, run_left, run_right, first_x, last_x), ...]。

    fill      —— 采样列中命中目标底色的比例
    run_px    —— 最长「连续命中段」的像素宽度（排除杂色散点）
    run_left  —— 该连续段的左端 x
    run_right —— 该连续段的右端 x
    first_x   —— 本行最左命中像素（胶囊左边缘；胶囊内控件不影响它）
    last_x    —— 本行最右命中像素（胶囊右边缘）
    """
    cols = range(0, w, x_step)
    n = float(len(cols))
    tr, tg, tb = target
    stats = []
    for y in range(h):
        base = y * w * 3
        hit = 0
        run = 0
        run_left = None
        first_x = None
        last_x = None
        best = (0, None, None)
        for x in cols:
            o = base + x * 3
            if (abs(rgb_bytes[o] - tr) <= tol and abs(rgb_bytes[o + 1] - tg) <= tol
                    and abs(rgb_bytes[o + 2] - tb) <= tol):
                hit += 1
                run += 1
                if run_left is None:
                    run_left = x
                if first_x is None:
                    first_x = x
                last_x = x
                if run > best[0]:
                    best = (run, run_left, x)
            else:
                run = 0
                run_left = None
        if best[1] is None:
            stats.append((hit / n, 0, None, None, None, None))
        else:
            stats.append((hit / n, best[2] - best[1] + x_step, best[1], best[2], first_x, last_x))
    return stats


def _row_span(rgb_bytes, w, y, target, tol):
    """单行内最左 / 最右命中像素（x 方向全分辨率扫描）。"""
    base = y * w * 3
    tr, tg, tb = target

    def hit(x):
        o = base + x * 3
        return (abs(rgb_bytes[o] - tr) <= tol and abs(rgb_bytes[o + 1] - tg) <= tol
                and abs(rgb_bytes[o + 2] - tb) <= tol)

    left = None
    for x in range(w):
        if hit(x):
            left = x
            break
    if left is None:
        return None
    right = left
    for x in range(w - 1, left - 1, -1):
        if hit(x):
            right = x
            break
    return left, right


_BAND_REJECT_TEXT = {
    "crop_saturated": "整个裁剪区都命中底色（多半截到纯色壁纸 / 整屏同色面板，边界不可信）",
    "band_too_short": "只有过短的暗带（低于 --min-band-px）",
    "band_touches_side_edges": "命中的暗带贴住了屏幕左/右边缘（圆角胶囊左右必有边距；可用 --allow-full-width-band 放宽）",
    "shape_not_capsule": "定位到的暗带边缘平直（估计圆角半径 ≤ 3px），像导航栏/面板而不是圆角胶囊",
    "band_fill_insufficient": "暗带内命中底色的行占比过低（控件占满整条暗带，暗带证据不足）",
    "no_dark_band": "没有任何行命中底色",
}


def _median(values):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    mid = len(vals) // 2
    if len(vals) % 2:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2.0


def _expand_group(stats, top, bottom, w, min_run_frac=0.25):
    """把被胶囊内控件打断的行补回来。

    真实胶囊内部有头像 / 图标 / 文稿，整行填充率会掉下来（批次44 原厂胶囊就是这样）。
    这里以「已确认段的左右包络」为界向外扩张：只要该行仍有足够长的连续底色、
    且整行命中范围不超出包络 ± 容差，就并入。胶囊是凸形状，这个约束足以穿过
    内部控件与圆角区，又不会吞掉旁边另一块暗区。
    """
    min_run = min_run_frac * w
    tol_px = 3 * ROW_SAMPLE_STEP

    def envelope(rows):
        lefts = [stats[y][4] for y in rows if stats[y][4] is not None]
        rights = [stats[y][5] for y in rows if stats[y][5] is not None]
        if not lefts or not rights:
            return None, None
        return min(lefts), max(rights)

    def fits(s, left, right):
        return (s[1] >= min_run and s[4] is not None and s[5] is not None
                and s[4] >= left - tol_px and s[5] <= right + tol_px)

    bottom_ext = bottom
    left_env, right_env = envelope(range(top, bottom + 1))
    while left_env is not None and bottom_ext + 1 < len(stats):
        s = stats[bottom_ext + 1]
        if not fits(s, left_env, right_env):
            break
        bottom_ext += 1
        left_env = min(left_env, s[4])
        right_env = max(right_env, s[5])

    top_ext = top
    while left_env is not None and top_ext - 1 >= 0:
        s = stats[top_ext - 1]
        if not fits(s, left_env, right_env):
            break
        top_ext -= 1
        left_env = min(left_env, s[4])
        right_env = max(right_env, s[5])

    return top_ext, bottom_ext


def _pick_band(stats, w, h, min_fill=0.75, min_height=40, gap=4, allow_full_width=False, x_step=4):
    """挑选最像胶囊的连续暗带，返回 (top, bottom, 实际阈值, meta)。

    比 .local/b45_capsule.py 的思路更保守，避免把壁纸 / 整屏同色面板误当胶囊：
    1. 行须命中底色，且「连续命中段」≥ 55% 图宽（排除杂色散点）；
    2. **先扩张再判高**：每个候选段先按左右包络向外补回「被胶囊内控件打断的行」，
       否则居中大图标会把整条胶囊切成两半、两半都不够 min_height（曾复现的缺陷）；
    3. 暗带高度须 ≥ min_height，且「确实命中底色的行」占比 ≥ 50%（防止把噪点连片）；
    4. 不能同时贴住裁剪区上下沿（那说明整屏同色）；
    5. 圆角胶囊左右必有边距 —— 命中段只要贴住左或右任一边缘即判为「非胶囊」；
    6. fill 阈值由 0.75 逐级放宽到 0.2，取第一个能给出可用暗带的档位。
    """
    meta = {"groups": [], "reject_reason": None, "min_fill_used": None}
    fallback_reason = None
    for floor in (min_fill, 0.5, 0.3, 0.2):
        rows = [y for y, s in enumerate(stats) if s[0] >= floor and s[1] >= 0.55 * w]
        if not rows:
            continue
        groups = []
        cur = [rows[0]]
        for y in rows[1:]:
            if y - cur[-1] <= gap:
                cur.append(y)
            else:
                groups.append(cur)
                cur = [y]
        groups.append(cur)
        cand = []
        for g in groups:
            top0, bottom0 = g[0], g[-1]
            top, bottom = _expand_group(stats, top0, bottom0, w)
            left = _median([stats[y][4] for y in range(top, bottom + 1) if stats[y][4] is not None])
            right = _median([stats[y][5] for y in range(top, bottom + 1) if stats[y][5] is not None])
            fill_rows = sum(1 for y in range(top, bottom + 1)
                            if stats[y][0] >= floor and stats[y][1] >= 0.55 * w)
            # 圆角胶囊左右一定有边距：任一侧贴住屏幕边缘就判为非胶囊
            touches_sides = (left is not None and right is not None
                             and (left <= x_step or right >= w - 1 - x_step))
            cand.append({
                "top": int(top),
                "bottom": int(bottom),
                "height": int(bottom - top + 1),
                "raw_height": int(bottom0 - top0 + 1),
                "expanded_px": int((bottom - top) - (bottom0 - top0)),
                "fill_rows": int(fill_rows),
                "run_left": None if left is None else int(left),
                "run_right": None if right is None else int(right),
                "touches_crop_top": top == 0,
                "touches_crop_bottom": bottom >= h - 1,
                "touches_side_edges": bool(touches_sides),
            })
        if not meta["groups"]:
            meta["groups"] = cand
        usable = [c for c in cand
                  if c["height"] >= min_height
                  and c["fill_rows"] >= 0.5 * c["height"]
                  and not (c["touches_crop_top"] and c["touches_crop_bottom"])
                  and (allow_full_width or not c["touches_side_edges"])]
        if usable:
            # 优先「上沿在裁剪区内有边界」的暗带；同分取更高、更靠下的（胶囊贴底）
            usable.sort(key=lambda c: (c["touches_crop_top"], -c["height"], -c["bottom"]))
            best = usable[0]
            meta["min_fill_used"] = floor
            meta["band_expanded_px"] = best["expanded_px"]
            meta["band_fill_rows"] = best["fill_rows"]
            meta["band_touches_crop_top"] = best["touches_crop_top"]
            meta["band_touches_crop_bottom"] = best["touches_crop_bottom"]
            meta["band_touches_side_edges"] = best["touches_side_edges"]
            meta["band_px"] = best["height"]
            meta["candidate_groups"] = len(cand)
            return best["top"], best["bottom"], floor, meta
        if fallback_reason is None:
            if all(c["touches_crop_top"] and c["touches_crop_bottom"] for c in cand):
                fallback_reason = "crop_saturated"
            elif all(c["touches_side_edges"] for c in cand):
                fallback_reason = "band_touches_side_edges"
            elif all(c["height"] < min_height for c in cand):
                fallback_reason = "band_too_short"
            else:
                fallback_reason = "band_fill_insufficient"
    meta["reject_reason"] = fallback_reason or "no_dark_band"
    return None, None, None, meta


def _estimate_radius(insets, band_height):
    """由「暗带行内缩量随 y 变化」拟合圆角半径（最小二乘格点搜索）。

    圆角模型：距上沿 t 行处的水平内缩 d(t) = r - sqrt(r^2 - (r-t)^2)，t <= r。
    """
    pts = [(t, d) for t, d in sorted(insets.items()) if t >= 1 and d is not None]
    if len(pts) < 4:
        return None, None
    r_max = int(min(max(band_height, 1), 160))
    best_r, best_err = None, None
    for r in range(1, r_max + 1):
        err = 0.0
        for t, d in pts:
            if t <= r:
                model = r - math.sqrt(max(r * r - (r - t) ** 2, 0.0))
            else:
                model = 0.0
            err += (model - d) ** 2
        if best_err is None or err < best_err:
            best_r, best_err = r, err
    residual = math.sqrt(best_err / len(pts)) if best_err is not None else None
    return best_r, residual


def analyze_geometry(img: object, target, tol, min_band_px=40, allow_full_width=False):
    """定位暗带胶囊；坐标均为「裁剪区域内的局部坐标」。"""
    w, h = img.size
    data = img.tobytes()
    stats = _row_stats(data, w, h, target, tol, x_step=ROW_SAMPLE_STEP)
    fills = [s[0] for s in stats]
    geom = {"band_found": False, "image_size": [w, h], "detect_target_rgb": list(target), "detect_tol": tol}
    for k in _GEOM_KEYS:
        geom[k] = None
    geom["corner_radius_px_est"] = None
    geom["corner_radius_residual_px"] = None
    geom["band_fill_peak"] = _round(max(fills) if fills else 0.0, 4)
    geom["band_reject_reason"] = None
    geom["band_candidate_groups"] = None
    top, bottom, floor, meta = _pick_band(stats, w, h, min_height=min_band_px,
                                          allow_full_width=allow_full_width, x_step=ROW_SAMPLE_STEP)
    geom["band_reject_reason"] = meta.get("reject_reason")
    geom["band_candidate_groups"] = meta.get("groups")
    geom["band_fill_floor_used"] = _round(meta.get("min_fill_used"), 2)
    if top is None:
        return geom
    spans = {}
    for y in range(top, bottom + 1):
        span = _row_span(data, w, y, target, tol)
        if span is not None:
            spans[y] = span
    if not spans:
        return geom

    mid_y = (top + bottom) // 2
    widest_y = max(spans, key=lambda y: (spans[y][1] - spans[y][0], -abs(y - mid_y)))
    band_left, band_right = spans[widest_y]
    geom.update(
        {
            "band_found": True,
            "band_top": int(top),
            "band_bottom": int(bottom),
            "band_height_px": int(bottom - top + 1),
            "band_left": int(band_left),
            "band_right": int(band_right),
            "band_width_px": int(band_right - band_left + 1),
            "margin_left_px": int(band_left),
            "margin_right_px": int(w - 1 - band_right),
            "widest_row_y": int(widest_y),
            "band_touches_crop_top": bool(meta.get("band_touches_crop_top")),
            "band_touches_crop_bottom": bool(meta.get("band_touches_crop_bottom")),
            "band_touches_side_edges": bool(meta.get("band_touches_side_edges")),
        }
    )

    def side_insets(anchor, direction, limit):
        out = {}
        for k in range(1, limit + 1):
            y = anchor + direction * k
            if y not in spans:
                break
            left, right = spans[y]
            out[k] = ((left - band_left) + (band_right - right)) / 2.0   # 该行相对最宽行的水平内缩量
        return out

    limit = max(2, min((bottom - top) // 2, 40))
    r_top, res_top = _estimate_radius(side_insets(top, 1, limit), bottom - top + 1)
    r_bot, res_bot = _estimate_radius(side_insets(bottom, -1, limit), bottom - top + 1)
    cands = [r for r in (r_top, r_bot) if r]
    if cands:
        geom["corner_radius_px_est"] = int(round(sum(cands) / len(cands)))
        geom["corner_radius_top_px_est"] = int(r_top) if r_top else None
        geom["corner_radius_bottom_px_est"] = int(r_bot) if r_bot else None
        res = [x for x in (res_top, res_bot) if x is not None]
        geom["corner_radius_residual_px"] = _round(sum(res) / len(res), 3) if res else None

    # 形状闸门：胶囊一定是圆角，估计半径过小说明是「平直暗条」（导航栏 / 面板 / 抽屉），
    # 此时宁可报「未定位」也不要给出一组会被误当成胶囊几何的数字。
    if geom["corner_radius_px_est"] is not None and geom["corner_radius_px_est"] <= 3:
        cand = {k: geom[k] for k in _GEOM_KEYS}
        cand["corner_radius_px_est"] = geom["corner_radius_px_est"]
        cand["corner_radius_residual_px"] = geom["corner_radius_residual_px"]
        for k in _GEOM_KEYS:
            geom[k] = None
        geom["corner_radius_px_est"] = None
        geom["corner_radius_top_px_est"] = None
        geom["corner_radius_bottom_px_est"] = None
        geom["band_found"] = False
        geom["band_reject_reason"] = "shape_not_capsule"
        geom["band_candidate"] = cand
        return geom
    return geom


def geometry_deltas(ref_geom, test_geom):
    """test - ref 的逐项差值（任一侧缺失记 null）。"""
    deltas = {}
    for k in _GEOM_KEYS:
        a, b = ref_geom.get(k), test_geom.get(k)
        deltas[k] = None if a is None or b is None else int(b - a)
    ra, rb = ref_geom.get("corner_radius_px_est"), test_geom.get("corner_radius_px_est")
    deltas["corner_radius_px_est"] = None if ra is None or rb is None else int(rb - ra)
    return deltas


# ---------------------------------------------------------------- 配色

def _mean_rgb(img, box):
    """区域平均 RGB（用 bytes 步长切片求和，比 getdata 遍历快得多）。"""
    region = img.crop(box)
    w, h = region.size
    if w <= 0 or h <= 0:
        return None
    data = region.tobytes()
    n = float(w * h)
    r = sum(data[0::3]) / n
    g = sum(data[1::3]) / n
    b = sum(data[2::3]) / n
    return [round(r, 2), round(g, 2), round(b, 2)], round(_luma(r, g, b), 2)


def _dark_mask_rows(img, target, tol):
    """逐行布尔表：像素是否命中胶囊底色。"""
    w, h = img.size
    data = img.tobytes()
    tr, tg, tb = target
    rows = []
    for y in range(h):
        base = y * w * 3
        row = bytearray(w)
        for x in range(w):
            o = base + x * 3
            if (abs(data[o] - tr) <= tol and abs(data[o + 1] - tg) <= tol
                    and abs(data[o + 2] - tb) <= tol):
                row[x] = 1
        rows.append(row)
    return rows


def analyze_color(img, geom, target, tol):
    """胶囊内 / 上方背景的配色统计。"""
    w, h = img.size
    out = {
        "capsule_mean_rgb": None,
        "capsule_mean_luma": None,
        "capsule_backdrop_mean_rgb": None,
        "capsule_dark_ratio": None,
        "above_bg_mean_rgb": None,
        "above_bg_luma": None,
        "above_bg_region": None,
        "crop_mean_luma": None,
    }
    whole = _mean_rgb(img, (0, 0, w, h))
    if whole:
        out["crop_mean_luma"] = whole[1]

    if not geom.get("band_found"):
        return out

    x0 = max(0, geom["band_left"])
    x1 = min(w, geom["band_right"] + 1)
    y0 = max(0, geom["band_top"])
    y1 = min(h, geom["band_bottom"] + 1)
    capsule = _mean_rgb(img, (x0, y0, x1, y1))
    if capsule:
        out["capsule_mean_rgb"] = capsule[0]
        out["capsule_mean_luma"] = capsule[1]

    # 只统计命中底色的像素（排除图标 / 文字），作为「纯底」参考
    region = img.crop((x0, y0, x1, y1))
    data = region.tobytes()
    tr, tg, tb = target
    tot = [0, 0, 0]
    cnt = 0
    for i in range(0, len(data), 3):
        r, g, b = data[i], data[i + 1], data[i + 2]
        if abs(r - tr) <= tol and abs(g - tg) <= tol and abs(b - tb) <= tol:
            tot[0] += r
            tot[1] += g
            tot[2] += b
            cnt += 1
    total_px = max((x1 - x0) * (y1 - y0), 1)
    out["capsule_dark_ratio"] = _round(cnt / total_px, 4)
    if cnt:
        out["capsule_backdrop_mean_rgb"] = [round(v / cnt, 2) for v in tot]

    # 胶囊「上方背景」：暗带之上 160px 内，去掉紧贴暗带的 8px 过渡区
    y_hi = max(0, geom["band_top"] - 8)
    y_lo = max(0, geom["band_top"] - 168)
    if y_hi - y_lo >= 4:
        bg = _mean_rgb(img, (0, y_lo, w, y_hi))
        out["above_bg_region"] = [0, y_lo, w, y_hi]
        if bg:
            out["above_bg_mean_rgb"] = bg[0]
            out["above_bg_luma"] = bg[1]
    return out


# ---------------------------------------------------------------- 判定与报告

def _verdict(ref_geom, test_geom, deltas, ssim_overall, ssim_dark, ssim_floor, align_notes,
             dark_ssim_floor=None):
    reasons = []
    checks = {}

    def ssim_check(name, value, floor):
        if value is None:
            reasons.append("%s 无法计算（未定位到可比较区域）" % name)
            return {"value": None, "floor": floor, "ok": False}
        ok = float(value) >= floor
        if not ok:
            reasons.append("%s %.4f 低于阈值 %.4f（像差偏大）" % (name, value, floor))
        return {"value": _round(value, 4), "floor": floor, "ok": bool(ok)}

    dark_floor = ssim_floor if dark_ssim_floor is None else dark_ssim_floor
    checks["ssim_overall"] = ssim_check("SSIM 整幅", ssim_overall, ssim_floor)
    checks["ssim_dark"] = ssim_check("SSIM 暗带", ssim_dark, dark_floor)

    geo_ok = True
    over = []
    missing = []
    for k in _GEOM_KEYS:
        d = deltas.get(k)
        if d is None:
            geo_ok = False
            missing.append(k)
            continue
        if abs(d) > GEOM_TOL_PX:
            geo_ok = False
            over.append("%s %+dpx" % (k, d))
    if over:
        reasons.append("关键几何误差超限（阈值 ±%.1fpx）：%s" % (GEOM_TOL_PX, "、".join(over)))
    if missing:
        reasons.append("几何项缺失：%s" % "、".join(missing))
    for tag, g in (("参考图", ref_geom), ("待测图", test_geom)):
        if not g.get("band_found"):
            why = _BAND_REJECT_TEXT.get(g.get("band_reject_reason"), g.get("band_reject_reason") or "未知原因")
            reasons.append("%s未定位到胶囊暗带（%s；fill peak=%s）" % (tag, why, g.get("band_fill_peak")))
    checks["geometry"] = {
        "tol_px": GEOM_TOL_PX,
        "ok": bool(geo_ok),
        "max_abs_delta_px": max([abs(d) for d in (deltas.get(k) for k in _GEOM_KEYS) if d is not None], default=None),
        "deltas": {k: deltas.get(k) for k in _GEOM_KEYS},
    }

    notes = list(align_notes)
    rd = deltas.get("corner_radius_px_est")
    if rd is not None and abs(rd) > RADIUS_NOTE_TOL_PX:
        notes.append("圆角半径估计差 %+dpx（仅供参考，不参与判定）" % rd)

    uniq = []
    for r in reasons:
        if r not in uniq:
            uniq.append(r)
    return {"pass": not uniq, "reasons": uniq, "checks": checks, "notes": notes}


def _fmt(value, width=8):
    if value is None:
        return "%*s" % (width, "null")
    return "%*s" % (width, value)


def _print_summary(report):
    ref = report["ref"]
    test = report["test"]
    geom = report["geometry"]
    color = report["color"]
    verdict = report["verdict"]

    print("=== 批次46 · 底部胶囊像差对比 ===")
    print("参考图 ref : %s  %dx%d → 底部裁剪 %dx%d（y0=%d%s）" % (
        ref["path"], ref["size"][0], ref["size"][1], ref["crop"][0], ref["crop"][1], ref["crop_y0"],
        "，图高不足取整图" if ref["crop_clamped"] else "",
    ))
    print("待测图 test: %s  %dx%d → 底部裁剪 %dx%d（y0=%d%s）" % (
        test["path"], test["size"][0], test["size"][1], test["crop"][0], test["crop"][1], test["crop_y0"],
        "，图高不足取整图" if test["crop_clamped"] else "",
    ))
    for note in report["align"]["notes"]:
        print("[对齐] %s" % note)

    print("")
    print("-- SSIM（自实现盒窗，win=%d，引擎=%s，比较区 %dx%d）--" % (
        report["ssim_window"], report["ssim_engine"], report["ssim_region"][0], report["ssim_region"][1],
    ))
    print("整幅 SSIM : %s   阈值 %.4f" % (_fmt(report["ssim_overall"]), report["ssim_floor"]))
    print("暗带 SSIM : %s   mask %s px" % (
        _fmt(report["ssim_dark"]),
        report["ssim_dark_pixels"] if report["ssim_dark_pixels"] else "null",
    ))

    print("")
    print("-- 几何（裁剪区局部坐标 / px）--")
    print("  %-16s %8s %8s %8s" % ("项", "ref", "test", "delta"))
    label = {
        "band_top": "暗带上沿 y",
        "band_bottom": "暗带下沿 y",
        "band_height_px": "暗带高",
        "band_left": "左边缘 x",
        "band_right": "右边缘 x",
        "band_width_px": "暗带宽",
        "margin_left_px": "左边距",
        "margin_right_px": "右边距",
        "corner_radius_px_est": "圆角半径估计",
    }
    rg, tg, dg = geom["ref"], geom["test"], geom["deltas"]
    for k in list(_GEOM_KEYS) + ["corner_radius_px_est"]:
        print("  %-16s %8s %8s %8s" % (label[k], _fmt(rg.get(k)).strip(), _fmt(tg.get(k)).strip(), _fmt(dg.get(k)).strip()))
    for tag, g in (("参考图", rg), ("待测图", tg)):
        if not g.get("band_found"):
            why = _BAND_REJECT_TEXT.get(g.get("band_reject_reason"), g.get("band_reject_reason") or "未知原因")
            print("  ! %s未定位到暗带：%s（fill peak=%s）" % (tag, why, g.get("band_fill_peak")))

    print("")
    print("-- 配色 --")
    print("  胶囊内平均 RGB   ref %-16s test %s" % (color["ref"]["capsule_mean_rgb"], color["test"]["capsule_mean_rgb"]))
    print("  胶囊纯底 RGB     ref %-16s test %s" % (color["ref"]["capsule_backdrop_mean_rgb"], color["test"]["capsule_backdrop_mean_rgb"]))
    print("  上方背景平均 RGB ref %-16s test %s" % (color["ref"]["above_bg_mean_rgb"], color["test"]["above_bg_mean_rgb"]))
    print("  上方背景亮度     ref %-16s test %s" % (color["ref"]["above_bg_luma"], color["test"]["above_bg_luma"]))
    print("  暗化系数         %s（待测相对参考的亮度下降比例）" % color["darkening_factor"])
    print("  整幅平均亮度     ref %-16s test %s" % (color["ref"]["crop_mean_luma"], color["test"]["crop_mean_luma"]))

    print("")
    print("-- 判定（ssim-floor=%.2f，dark-floor=%.2f，几何阈值 ±%.1fpx）--" % (
        report["ssim_floor"], report["dark_ssim_floor"], GEOM_TOL_PX))
    if verdict["pass"]:
        print("判定：通过 未发现超阈像差")
    else:
        print("判定：未通过，原因如下：")
        for reason in verdict["reasons"]:
            print("  - %s" % reason)
    for note in verdict["notes"]:
        print("  提示：%s" % note)


# ---------------------------------------------------------------- 主流程

def run(ref_path, test_path, bottom_px, ssim_floor, band_color, band_tol, engine_name,
        min_band_px=40, allow_full_width=False, dark_ssim_floor=None):
    Image = _import_pil()
    engine = pick_engine(engine_name)
    notes = []

    def load(path, tag):
        try:
            img = Image.open(path)
            img.load()
        except FileNotFoundError:
            raise UiDiffError("找不到%s图片：%s" % (tag, path))
        except Exception as exc:
            raise UiDiffError("打开%s图片失败：%s（%s）" % (tag, path, exc))
        img = img.convert("RGB")
        w, h = img.size
        crop_h = min(int(bottom_px), h)
        return img, img.crop((0, h - crop_h, w, h)), {
            "path": path,
            "size": [w, h],
            "crop": [w, crop_h],
            "crop_y0": h - crop_h,
            "crop_clamped": crop_h < int(bottom_px),
        }

    ref_img, ref_crop, ref_info = load(ref_path, "参考")
    test_img, test_crop, test_info = load(test_path, "待测")

    if ref_crop.size[0] != test_crop.size[0]:
        old = test_crop.size
        test_crop = test_crop.resize((ref_crop.size[0], test_crop.size[1]), Image.LANCZOS)
        notes.append("宽度不一致：待测裁剪 %dx%d 已 LANCZOS 缩放到参考宽度 %d" % (old[0], old[1], ref_crop.size[0]))
    if ref_crop.size[1] != test_crop.size[1]:
        notes.append("裁剪高度不一致：ref %dpx / test %dpx，SSIM 只比较底部公共 %dpx" % (
            ref_crop.size[1], test_crop.size[1], min(ref_crop.size[1], test_crop.size[1])))
    if ref_info["size"] != test_info["size"]:
        notes.append("原始分辨率不一致：ref %dx%d / test %dx%d" % (
            ref_info["size"][0], ref_info["size"][1], test_info["size"][0], test_info["size"][1]))

    common_h = min(ref_crop.size[1], test_crop.size[1])
    w = ref_crop.size[0]
    if common_h <= 0 or w <= 0:
        raise UiDiffError("裁剪区域为空（bottom-px=%s），无法比较" % bottom_px)
    off_y = ref_crop.size[1] - common_h
    ref_cmp = ref_crop.crop((0, off_y, w, ref_crop.size[1]))
    test_cmp = test_crop.crop((0, test_crop.size[1] - common_h, w, test_crop.size[1]))

    ssim_overall = compute_ssim(ref_cmp, test_cmp, DEFAULT_SSIM_WIN, None, engine)

    ref_geom = analyze_geometry(ref_crop, band_color, band_tol, min_band_px, allow_full_width)
    test_geom = analyze_geometry(test_crop, band_color, band_tol, min_band_px, allow_full_width)
    deltas = geometry_deltas(ref_geom, test_geom)

    # 暗带 SSIM：ref 暗带外扩 8px 的矩形，仅用 ref 暗带 mask 的像素取平均
    ssim_dark = None
    dark_pixels = 0
    if ref_geom.get("band_found"):
        pad = 8
        x0 = max(0, ref_geom["band_left"] - pad)
        x1 = min(w, ref_geom["band_right"] + 1 + pad)
        y0 = max(0, ref_geom["band_top"] - pad - off_y)
        y1 = min(common_h, ref_geom["band_bottom"] + 1 + pad - off_y)
        if x1 - x0 >= 3 and y1 - y0 >= 3:
            box = (x0, y0, x1, y1)
            sub_ref = ref_cmp.crop(box)
            sub_test = test_cmp.crop(box)
            mask_rows = _dark_mask_rows(sub_ref, band_color, band_tol)
            dark_pixels = sum(sum(1 for v in row if v) for row in mask_rows)
            if dark_pixels >= 50:
                ssim_dark = compute_ssim(sub_ref, sub_test, DEFAULT_SSIM_WIN, mask_rows, engine)
            else:
                notes.append("参考图暗带像素过少（%d px），暗带 SSIM 记 null" % dark_pixels)
        else:
            notes.append("暗带矩形过小，暗带 SSIM 记 null")
    else:
        notes.append("参考图未定位到暗带，暗带 SSIM 记 null")

    ref_color = analyze_color(ref_crop, ref_geom, band_color, band_tol)
    test_color = analyze_color(test_crop, test_geom, band_color, band_tol)
    ref_luma = ref_color["above_bg_luma"]
    test_luma = test_color["above_bg_luma"]
    darkening = None
    if ref_luma and test_luma is not None and ref_luma > 0:
        darkening = _round(1.0 - float(test_luma) / float(ref_luma), 4)
    capsule_luma_delta = None
    if ref_color["capsule_mean_luma"] is not None and test_color["capsule_mean_luma"] is not None:
        capsule_luma_delta = _round(test_color["capsule_mean_luma"] - ref_color["capsule_mean_luma"], 2)

    verdict = _verdict(ref_geom, test_geom, deltas, ssim_overall, ssim_dark, ssim_floor, notes,
                       dark_ssim_floor)

    return {
        "ref": ref_info,
        "test": test_info,
        "align": {
            "width_matched": ref_info["crop"][0] == test_info["crop"][0],
            "height_matched": ref_info["crop"][1] == test_info["crop"][1],
            "resolution_mismatch": ref_info["size"] != test_info["size"],
            "notes": notes,
        },
        "ssim_window": DEFAULT_SSIM_WIN,
        "ssim_engine": engine,
        "ssim_region": [ref_cmp.size[0], ref_cmp.size[1]],
        "ssim_overall": _round(ssim_overall, 4),
        "ssim_dark": _round(ssim_dark, 4),
        "ssim_dark_pixels": dark_pixels,
        "ssim_dark_definition": (
            "在 ref 暗带 bbox 外扩 %dpx 的矩形内，仅统计 ref 图命中胶囊底色(±band-tol) 的像素，取这些像素"
            "的逐像素 SSIM 均值（单侧 mask，非两图共同暗区）" % 8
        ),
        "ssim_floor": ssim_floor,
        "dark_ssim_floor": ssim_floor if dark_ssim_floor is None else dark_ssim_floor,
        "min_band_px": min_band_px,
        "band_color": list(band_color),
        "band_tol": band_tol,
        "geometry": {"ref": ref_geom, "test": test_geom, "deltas": deltas},
        "color": {
            "ref": ref_color,
            "test": test_color,
            "darkening_factor": darkening,
            "capsule_luma_delta": capsule_luma_delta,
        },
        "verdict": verdict,
    }


def build_parser():
    p = argparse.ArgumentParser(
        prog="ui-diff.py",
        description="批次46 底部胶囊像差客观指标：SSIM / 几何 / 配色",
    )
    p.add_argument("paths", nargs="*", help="位置参数形式：ref.png test.png")
    p.add_argument("--ref", help="参考图（原厂 YOYO 截图）")
    p.add_argument("--test", help="待测图（自研实现截图）")
    p.add_argument("--out", help="结果 JSON 输出路径")
    p.add_argument("--bottom-px", type=int, default=DEFAULT_BOTTOM_PX, help="各自裁剪的底部像素数（默认 400）")
    p.add_argument("--ssim-floor", type=float, default=DEFAULT_SSIM_FLOOR, help="整幅 SSIM 通过阈值（默认 0.90）")
    p.add_argument("--dark-ssim-floor", type=float, default=None,
                   help="暗带 SSIM 通过阈值（默认与 --ssim-floor 相同；暗带 SSIM 只在暗带像素上平均，量纲更敏感）")
    p.add_argument("--band-color", default="31,34,42", help="胶囊底色 RGB，默认 31,34,42")
    p.add_argument("--band-tol", type=int, default=DEFAULT_BAND_TOL, help="底色单通道容差（默认 14）")
    p.add_argument("--min-band-px", type=int, default=MIN_BAND_PX, help="暗带最小高度，低于此值不认胶囊（默认 %d）" % MIN_BAND_PX)
    p.add_argument("--allow-full-width-band", action="store_true",
                   help="允许暗带横跨整幅宽度（默认拒绝：圆角胶囊左右必有边距）")
    p.add_argument("--engine", choices=("auto", "python", "numpy"), default="auto", help="SSIM 计算引擎（默认 auto）")
    p.add_argument("--strict", action="store_true", help="verdict.pass 为假时以退出码 1 结束")
    return p


def main(argv=None):
    _reconfigure_stdio()
    args = build_parser().parse_args(argv)

    ref_path, test_path = args.ref, args.test
    extra = list(args.paths)
    if not ref_path or not test_path:
        if len(extra) == 2 and not ref_path and not test_path:
            ref_path, test_path = extra
        elif len(extra) == 1 and not ref_path:
            ref_path = extra[0]
        elif len(extra) == 1 and not test_path:
            test_path = extra[0]
        else:
            print("错误：需要恰好两张图（--ref/--test，或两个位置参数）", file=sys.stderr)
            return 2

    try:
        band_color = _parse_color(args.band_color)
        if args.bottom_px <= 0:
            raise UiDiffError("--bottom-px 必须为正整数")
        if not 0.0 <= args.ssim_floor <= 1.0:
            raise UiDiffError("--ssim-floor 必须在 0..1 之间")
        if args.dark_ssim_floor is not None and not 0.0 <= args.dark_ssim_floor <= 1.0:
            raise UiDiffError("--dark-ssim-floor 必须在 0..1 之间")
        if args.min_band_px <= 0:
            raise UiDiffError("--min-band-px 必须为正整数")
        report = run(ref_path, test_path, args.bottom_px, args.ssim_floor, band_color, args.band_tol,
                     args.engine, args.min_band_px, args.allow_full_width_band, args.dark_ssim_floor)
    except UiDiffError as exc:
        print("错误：%s" % exc, file=sys.stderr)
        return 2
    except Exception as exc:
        print("错误：分析失败（%s: %s）" % (type(exc).__name__, exc), file=sys.stderr)
        return 2

    if args.out:
        try:
            with open(args.out, "w", encoding="utf-8") as fh:
                json.dump(report, fh, ensure_ascii=False, indent=2)
                fh.write("\n")
        except OSError as exc:
            print("错误：无法写出 JSON（%s）：%s" % (args.out, exc), file=sys.stderr)
            return 2

    _print_summary(report)
    if args.out:
        print("")
        print("JSON 已写出：%s" % args.out)

    if args.strict and not report["verdict"]["pass"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
