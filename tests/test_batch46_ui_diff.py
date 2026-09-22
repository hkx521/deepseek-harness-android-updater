# -*- coding: utf-8 -*-
"""批次46 tools/ui-diff.py 的合成图回归测试。

全部用例都用 PIL 现场合成（不依赖仓库里的真实截图），通过 subprocess 调
``sys.executable tools/ui-diff.py ... --out xxx.json``，解析 JSON 断言：

* 用例1：test 与 ref 完全相同 → ssim ≈ 1、verdict.pass=True、几何 deltas 全 0；
* 用例2：胶囊整体上移 12px 且宽度收窄 20px → band_top/band_width delta 明显非 0、
  verdict.pass=False，stdout 里有中文未通过提示；
* 用例3：只加噪声 + 轻微模糊 → ssim 下降但仍 > 0.9（指标有区分度）；
* 用例4：文件不存在 → 中文报错 + 退出码 2（不抛裸 traceback）；
* 用例5：（回归）胶囊正中放大图标 → 暗带仍要被完整定位（不能被切成两段）。
"""

from __future__ import annotations

import json
import importlib.util
import random
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
_NUMPY = importlib.util.find_spec("numpy")
TOOL = ROOT / "tools" / "ui-diff.py"

W, H = 720, 1280                 # 合成整图尺寸（非真实分辨率，够用即可）
BOTTOM_PX = 400                  # 与工具默认一致
CAPSULE_RGB = (31, 34, 42)       # 工具默认目标底色
CAPSULE_H = 96                   # 胶囊高度
BOTTOM_GAP = 40                  # 胶囊下沿距屏幕底部
MARGIN_X = 24                    # 胶囊左右边距
BG_RGB = (198, 202, 210)         # 胶囊上方背景


def _make_screen(*, dy: int = 0, narrow: int = 0, noise_sigma: float = 0.0,
                 blur: float = 0.0, seed: int = 46, icon_big: bool = False) -> Image.Image:
    """合成一张「底部有暗色圆角胶囊」的屏幕图。

    dy     —— 胶囊整体上移的像素数（正数向上）
    narrow —— 胶囊左右各收窄的像素数（总宽度减少 2*narrow）
    noise_sigma / blur —— 叠加的高斯噪声与模糊
    icon_big —— True 时在胶囊正中放一块 61x41 图标（会把整行命中段切成两段）
    """
    img = Image.new("RGB", (W, H), BG_RGB)
    draw = ImageDraw.Draw(img)
    # 背景：竖向渐变 + 若干结构线条，避免 SSIM 在纯色上退化
    for y in range(H):
        k = y / float(H - 1)
        draw.line([(0, y), (W - 1, y)],
                  fill=(int(BG_RGB[0] - 26 * k), int(BG_RGB[1] - 28 * k), int(BG_RGB[2] - 32 * k)))
    for x in range(20, W - 20, 60):
        draw.line([(x, 180), (x + 24, 300)], fill=(148, 154, 166), width=3)
    draw.rectangle([60, 500, W - 60, 860], outline=(118, 124, 138), width=4)
    draw.rectangle([90, 540, 360, 700], outline=(140, 146, 158), width=3)

    # 胶囊：贴底 BOTTOM_GAP，高度 CAPSULE_H，(dy, narrow) 控制位移与收窄
    left = MARGIN_X + narrow
    right = W - 1 - MARGIN_X - narrow
    top = H - BOTTOM_GAP - CAPSULE_H - dy
    bottom = top + CAPSULE_H - 1
    draw.rounded_rectangle([left, top, right, bottom], radius=CAPSULE_H // 2, fill=CAPSULE_RGB)
    # 胶囊内画两个「图标」，模拟真实胶囊里的控件（不影响几何定位，但影响配色/SSIM）
    cy = (top + bottom) // 2
    draw.ellipse([left + 40, cy - 14, left + 68, cy + 14], fill=(196, 200, 208))
    if icon_big:
        draw.rectangle([W // 2 - 30, cy - 20, W // 2 + 30, cy + 20], fill=(120, 126, 138))
    else:
        draw.rectangle([W // 2 - 60, cy - 6, W // 2 + 60, cy + 6], fill=(120, 126, 138))

    if noise_sigma > 0:
        rnd = random.Random(seed)
        data = bytes(max(0, min(255, 128 + int(rnd.gauss(0.0, noise_sigma)))) for _ in range(W * H))
        noise = Image.frombytes("L", (W, H), data).convert("RGB")
        img = ImageChops.add(img, noise, 1.0, -128)
    if blur > 0:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return img


def _run_tool(*args: str, out: Path | None = None):
    """跑一次 CLI，返回 (CompletedProcess, 解析后的 JSON 或 None)。"""
    cmd = [sys.executable, str(TOOL), *args]
    if out is not None:
        cmd += ["--out", str(out)]
    proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=300)
    data = None
    if out is not None and out.exists():
        data = json.loads(out.read_text(encoding="utf-8"))
    return proc, data


@pytest.fixture(scope="module")
def screens(tmp_path_factory):
    """一次合成三张图（相同 / 位移收窄 / 噪声模糊），供各用例复用。"""
    d = tmp_path_factory.mktemp("b46_ui_diff")
    ref = d / "ref.png"
    _make_screen().save(ref)
    moved = d / "test_moved.png"
    _make_screen(dy=12, narrow=10).save(moved)
    noisy = d / "test_noisy.png"
    _make_screen(noise_sigma=6.0, blur=0.8).save(noisy)
    return {"dir": d, "ref": ref, "moved": moved, "noisy": noisy}
@pytest.fixture(scope="module")
def identical(screens, tmp_path_factory):
    """用例1 只跑一次：同一张图自比。"""
    out = tmp_path_factory.mktemp("b46_case1") / "identical.json"
    proc, data = _run_tool("--ref", str(screens["ref"]), "--test", str(screens["ref"]), out=out)
    return proc, data


def test_identical_images_pass(identical):
    """用例1：test 与 ref 完全相同 → ssim ≈ 1、pass=True、几何 deltas 全 0。"""
    proc, data = identical
    assert proc.returncode == 0, proc.stderr
    assert data is not None
    assert data["ssim_overall"] >= 0.999, data["ssim_overall"]
    assert data["ssim_dark"] is not None and data["ssim_dark"] >= 0.999
    assert data["verdict"]["pass"] is True, data["verdict"]["reasons"]
    for key, value in data["geometry"]["deltas"].items():
        assert value == 0, (key, value)

    # 几何定位本身要成功，并与合成参数吻合（胶囊高 96、左右边距 24）
    ref_geom = data["geometry"]["ref"]
    assert ref_geom["band_found"] is True
    assert ref_geom["band_height_px"] == pytest.approx(CAPSULE_H, abs=3)
    assert abs(ref_geom["margin_left_px"] - MARGIN_X) <= 6
    assert abs(ref_geom["margin_right_px"] - MARGIN_X) <= 6
    assert ref_geom["band_width_px"] == pytest.approx(W - 2 * MARGIN_X, abs=10)
    assert ref_geom["corner_radius_px_est"] is not None
    assert 24 <= ref_geom["corner_radius_px_est"] <= 72
    # 胶囊贴底：下沿到裁剪区底部的距离应接近 BOTTOM_GAP
    assert abs((BOTTOM_PX - 1 - ref_geom["band_bottom"]) - BOTTOM_GAP) <= 4
    assert "通过" in proc.stdout


def test_moved_and_narrowed_fails(screens, tmp_path):
    """用例2：整体上移 12px + 左右各收窄 10px → 几何 deltas 非 0、pass=False。"""
    out = tmp_path / "moved.json"
    proc, data = _run_tool(str(screens["ref"]), str(screens["moved"]), out=out)
    assert proc.returncode == 0, proc.stderr
    assert data is not None

    deltas = data["geometry"]["deltas"]
    assert abs(deltas["band_top"]) >= 10, deltas
    assert deltas["band_top"] < 0            # 待测胶囊上移 ⇒ 裁剪区局部坐标变小
    assert abs(deltas["band_width_px"]) >= 15, deltas
    assert deltas["band_width_px"] < 0       # 收窄
    assert abs(deltas["margin_left_px"]) >= 5

    assert data["verdict"]["pass"] is False
    assert data["verdict"]["reasons"], "未通过时必须给出中文原因"
    assert any("几何" in reason for reason in data["verdict"]["reasons"]), data["verdict"]["reasons"]
    assert data["ssim_overall"] < 0.99

    # stdout 人读摘要要出现中文提示
    assert "未通过" in proc.stdout
    assert "暗带上沿" in proc.stdout
    assert "几何误差超限" in proc.stdout


def test_strict_mode_exit_code(screens):
    """--strict 且未通过 → 退出码 1（不加 --strict 时始终 0）。"""
    proc, _ = _run_tool(str(screens["ref"]), str(screens["moved"]), "--strict")
    assert proc.returncode == 1
    ok_proc, _ = _run_tool(str(screens["ref"]), str(screens["ref"]), "--strict")
    assert ok_proc.returncode == 0


def test_noise_and_blur_lower_ssim_but_keep_discriminating_power(screens, identical, tmp_path):
    """用例3：只加噪声 + 轻微模糊 → ssim 下降但仍 > 0.9（指标有区分度）。"""
    out = tmp_path / "noisy.json"
    proc, data = _run_tool(str(screens["ref"]), str(screens["noisy"]), out=out)
    assert proc.returncode == 0, proc.stderr
    assert data is not None

    identical_ssim = identical[1]["ssim_overall"]
    ssim = data["ssim_overall"]
    assert ssim < identical_ssim, (ssim, identical_ssim)
    assert ssim > 0.90, ssim
    assert ssim < 0.9999, ssim
    assert data["ssim_dark"] is not None and data["ssim_dark"] != ssim

    # 纯噪声 / 轻微模糊不该把几何定位打散
    assert data["geometry"]["ref"]["band_found"] is True
    assert data["geometry"]["test"]["band_found"] is True
    assert abs(data["geometry"]["deltas"]["band_top"]) <= 3
    assert isinstance(data["verdict"]["pass"], bool)


def test_missing_file_reports_chinese_error_and_exit_2(tmp_path):
    """异常路径：文件不存在 → 中文报错 + exit 2，且不抛裸 traceback。"""
    missing = tmp_path / "not_exists.png"
    proc, _ = _run_tool("--ref", str(missing), "--test", str(missing))
    assert proc.returncode == 2
    assert "找不到" in proc.stderr
    assert "Traceback" not in proc.stderr


def test_centered_content_still_locates_capsule(tmp_path):
    """用例5（回归）：胶囊正中放 61x41 图标，暗带仍应被完整定位。

    居中图标会把整行命中段切成两段，若「先按 min-band-px 判高、再扩张」
    就会误报 band_too_short（独立复核曾发现该缺陷）。
    """
    ref = tmp_path / "ref_bigicon.png"
    _make_screen(icon_big=True).save(ref)
    out = tmp_path / "bigicon.json"
    proc, data = _run_tool("--ref", str(ref), "--test", str(ref), out=out)
    assert proc.returncode == 0, proc.stderr
    assert data is not None
    geom = data["geometry"]["ref"]
    assert geom["band_found"] is True, data["verdict"]["reasons"]
    assert geom["band_height_px"] == pytest.approx(CAPSULE_H, abs=3), geom
    assert abs(geom["margin_left_px"] - MARGIN_X) <= 6
    assert abs(geom["margin_right_px"] - MARGIN_X) <= 6
    assert abs(geom["corner_radius_px_est"] - CAPSULE_H // 2) <= 6
    assert data["verdict"]["pass"] is True, data["verdict"]["reasons"]


@pytest.mark.skipif(_NUMPY is None, reason="当前解释器没有 numpy，numpy 快路径用例跳过")
def test_numpy_engine_matches_python_engine(screens, tmp_path):
    """装了 numpy 时，两条 SSIM 引擎路径必须给出同一量级结果。"""
    out_np = tmp_path / "engine_np.json"
    out_py = tmp_path / "engine_py.json"
    _, np_data = _run_tool(str(screens["ref"]), str(screens["noisy"]), "--engine", "numpy", out=out_np)
    _, py_data = _run_tool(str(screens["ref"]), str(screens["noisy"]), "--engine", "python", out=out_py)
    assert abs(np_data["ssim_overall"] - py_data["ssim_overall"]) < 0.01
    assert abs(np_data["ssim_dark"] - py_data["ssim_dark"]) < 0.02
    assert np_data["geometry"]["deltas"] == py_data["geometry"]["deltas"]
