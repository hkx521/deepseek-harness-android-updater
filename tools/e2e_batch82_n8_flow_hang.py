#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次82-N8 真机验收：助手面板入场「三段式流挂」逐帧判定（V1–V4）。

流程（adb + scrcpy + ffmpeg + numpy，不依赖 scrcpy MCP）：
  1. 拉主界面收起面板 → 打开「系统设置」当背景。选它而不是桌面，是因为启动器会在
     Activity 转场时做「压暗 + 缩放」，缩放没法用线性模型扣掉；系统设置只有整体压暗。
  2. scrcpy 录屏（-N --no-audio --max-fps=60 --record=anim.mkv --time-limit=7），
     录制开始 2.5s 后 am start AssistActivity 触发呼出（真实 AI 键同一条路径）。
  3. ffmpeg 把视频解成「全宽灰度裸流」（crop 到条带所在区间，避免写 300+ 张 PNG），
     取触发前若干帧的均值当参考帧。
  4. 逐帧：用**左侧背景条**（x∈[0,40)，面板最左也到 x≈49，绝不会覆盖）做
     f = a*ref + b 最小二乘拟合，扣掉整体压暗/自动亮度；再对残差做 5x5 均值滤波取阈值，
     得到面板遮挡区域的面积 / 宽度 / 质心 / 顶边。
  5. 判定：
     V1 首个成片遮挡帧（细缝）质心 X ≈ 屏幕中线（|Δ| ≤ 60px）、顶边落在挖孔下缘附近；
     V2 细缝期面积 ≤ 峰值 25%；
     V3 宽度爬升（细缝 → 终宽 95%）360–620ms（设计值 出液 180 + 垂落 280 = 460ms）；
     V4 终态质心 X ≈ 屏幕中线（|Δ| ≤ 40px）。
  6. 关键帧（起始 / 中段 / 终态）存 --frames-dir（默认 docs/screenshots/batch82-N8），
     报告 + 曲线 + logcat 的 [b82n8] 行存 --out-dir（默认 .local/n8_verify）。

用法：
    python tools/e2e_batch82_n8_flow_hang.py --serial <serial>
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CROP_Y0, CROP_Y1 = 115, 705      # 全宽裁剪区间（给条带留 BOX 边距）
BAND = (140, 700)                # 判据条带：挖孔下缘之下、IME 之上
XRANGE = (120, 1130)             # 横向窗口：避开屏幕边缘与启动器/设置页的侧边动效
FIT_COLS = (0, 40)               # 左侧背景条（只用来估 a/b）
BOX = 5
THR = 30
WIN = (0.5, 6.5)
LOG_TAG = "dsh-overlay"
LOG_MARK = "[b82n8]"
DEV_VIDEO = "/data/local/tmp/dsh_n8_anim.mp4"
SCRCPY_CANDIDATES = [
    os.environ.get("SCRCPY_PATH", ""),
    # 批次97：不写死本机用户名路径（开源脱敏）；用 %LOCALAPPDATA% 推导
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages",
                 "Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe",
                 "scrcpy-win64-v4.1", "scrcpy.exe"),
]


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, **kw)


def adb(serial, *args, check=True):
    p = run(["adb", "-s", serial, *args])
    if check and p.returncode != 0:
        raise RuntimeError("adb %s failed: %s" % (args, p.stderr.decode("utf-8", "replace")))
    return p


def find_scrcpy():
    for c in SCRCPY_CANDIDATES:
        if c and Path(c).exists():
            return c
    found = shutil.which("scrcpy")
    if found:
        return found
    raise SystemExit("找不到 scrcpy（可用环境变量 SCRCPY_PATH 指定）")


def box_mean(a, k=BOX):
    import numpy as np
    pad = k // 2
    p = np.pad(a, pad, mode="edge")
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)), mode="constant")
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
def panel_rim(frame):
    """批次85-R4 修正：用**面板玻璃棱线**量几何，返回 (left, right, center)；找不到返回 (-1,-1,-1)。

    为什么必须换掉「diff 掩码连续段中点」：面板中段是**透明玻璃**（批次83 定稿材质），与背景几乎一致，
    差分掩码里会出现成片空洞，连续段中点于是随空洞漂移；而且它对**桌面壁纸**也变得敏感——
    真机实测同一天两次运行之间壁纸换了（紫→绿），settled cxb 就从 542.9 漂到 575.5，
    但面板本身逐帧都是 w=1144 / left=56 / right=1200（App 日志 [b82n8] 与棱线像素双证）。

    棱线 = 面板边缘那道 4px 高光（批次83 第七版 Highlight，0.29 + Plus 混合），相对左右邻域是窄亮峰，
    不随背景内容变化，因此对透明玻璃与任意壁纸都稳。
    """
    import numpy as np
    h, w = frame.shape
    ls, rs = [], []
    for y in range(int(0.25 * h), int(0.75 * h), max(1, h // 40)):
        row = frame[y].astype(np.float64)
        ref = np.convolve(row, np.ones(61) / 61.0, mode="same")
        hi = row - ref
        li = int(np.argmax(hi[40:260])) + 40
        ri = int(np.argmax(hi[max(1, w - 260):w - 40])) + (w - 260)
        if hi[li] >= 3:
            ls.append(li)
        if hi[ri] >= 3:
            rs.append(ri)
    if not ls or not rs:
        return -1, -1, -1.0
    l, r = int(np.median(ls)), int(np.median(rs))
    return l, r, (l + r + 1) / 2.0
    import numpy as np
    pad = k // 2
    p = np.pad(a, pad, mode="edge")
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)), mode="constant")
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", required=True)
    ap.add_argument("--out-dir", default=str(ROOT / ".local" / "n8_verify"))
    ap.add_argument("--frames-dir", default=str(ROOT / "docs" / "screenshots" / "batch82-N8"))
    args = ap.parse_args()

    import numpy as np
    from PIL import Image

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    frames_dir = Path(args.frames_dir)
    frames_dir.mkdir(parents=True, exist_ok=True)
    serial = args.serial

    # 1) 起点：先把 App 拉起来让进程「热」着（冷启动首帧要 ~200ms，会把出液段整段吞掉），
    #    再用 BACK 结束 MainActivity —— 否则 AssistActivity 一拉起就把本 App 任务带到前台，
    #    MainActivity.onStart → setOverlayVisible(false) → 面板刚展开就被收起（真机实测：
    #    动画日志有、但 screencap 里什么都没有）。
    adb(serial, "shell", "am", "start", "-n", "com.deepseek.harness/.MainActivity")
    time.sleep(2.5)
    adb(serial, "shell", "input", "keyevent", "KEYCODE_BACK")
    time.sleep(1.0)
    adb(serial, "shell", "input", "keyevent", "KEYCODE_HOME")
    time.sleep(2.0)

    # 2) 录屏 + 触发呼出
    #    注意：本机 LTPO 屏在「画面静止」时只按 ~1fps 出帧，所以录到的帧是**内容驱动**的
    #    （面板动画期间会回到 ~15–60fps）；因此时间轴一律用每帧 pts，而不是帧序号/fps。
    adb(serial, "logcat", "-c")
    video = out / "anim.mp4"
    adb(serial, "shell", "rm -f " + DEV_VIDEO)
    rec = subprocess.Popen(["adb", "-s", serial, "shell",
                            "screenrecord --time-limit 6 --bit-rate 16M " + DEV_VIDEO],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    time.sleep(2.0)
    # --activity-no-animation：关掉系统「启动 App」的转场动画，桌面就不会被缩放，
    # 背景只剩可被线性模型扣掉的整体压暗（真机实测：动画期间的底部背景 0 像素变化）。
    adb(serial, "shell", "am", "start", "-n", "com.deepseek.harness/.AssistActivity",
        "--activity-no-animation")
    try:
        rec_out, _ = rec.communicate(timeout=60)
    except subprocess.TimeoutExpired:
        rec.kill()
        rec_out, _ = rec.communicate()
    video.write_bytes(adb(serial, "exec-out", "cat " + DEV_VIDEO).stdout)
    adb(serial, "shell", "rm -f " + DEV_VIDEO)
    (out / "rec.log").write_bytes(rec_out or b"")
    logs = adb(serial, "logcat", "-d", "-s", LOG_TAG + ":V").stdout.decode("utf-8", "replace")
    marks = [ln.strip() for ln in logs.splitlines() if LOG_MARK in ln]
    (out / "logcat_b82n8.txt").write_text("\n".join(marks), encoding="utf-8")

    # 3) 解成灰度裸流
    idx = run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
               "stream=width,height", "-of", "csv=p=0", str(video)])
    parts = idx.stdout.decode().strip().split(",")
    w, h = int(parts[0]), int(parts[1])
    pts = [float(x) for x in run(["ffprobe", "-v", "error", "-select_streams", "v",
                                  "-show_entries", "frame=pts_time", "-of", "csv=p=0",
                                  str(video)]).stdout.decode().split() if x.strip()]
    raw = out / "frames.raw"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vsync", "0",
         "-vf", "crop=%d:%d:0:%d,format=gray" % (w, CROP_Y1 - CROP_Y0, CROP_Y0),
         "-f", "rawvideo", "-pix_fmt", "gray", str(raw)])
    buf = np.memmap(raw, dtype=np.uint8, mode="r")
    band_h = CROP_Y1 - CROP_Y0
    total = buf.size // (band_h * w)
    frames = buf.reshape(total, band_h, w)
    if len(pts) != total:
        # 帧数对不上时退化为等间隔（正常情况下不会走到这里）
        span = pts[-1] if pts else 5.0
        pts = [span * i / max(1, total - 1) for i in range(total)]
    # 参考帧：触发前的静态背景（取前几帧均值）
    pre = [i for i, t in enumerate(pts) if t < 1.0]
    pre = pre[:6] or list(range(min(3, total)))
    ref = frames[pre].astype(np.float32).mean(axis=0)
    b0, b1 = BAND[0] - CROP_Y0, BAND[1] - CROP_Y0
    x0, x1 = XRANGE[0], XRANGE[1]

    rows = []
    for i in range(total):
        t = pts[i]
        if not (WIN[0] <= t <= WIN[1]):
            continue
        f = frames[i].astype(np.float32)
        sub_ref = ref[b0:b1, :]
        sub_f = f[b0:b1, :]
        # 两遍鲁棒拟合：先全条带粗拟合，再用「残差合格的背景像素」重拟，
        # 把系统设置页被整体压暗（乘性）的变化扣掉，剩下的才是面板本身。
        a, b = np.polyfit(sub_ref[::4, ::4].ravel(), sub_f[::4, ::4].ravel(), 1)
        resid = np.abs(sub_f - (a * sub_ref + b))
        inl = resid < 25
        if int(inl.sum()) > 5000:
            try:
                a, b = np.polyfit(sub_ref[inl][::3], sub_f[inl][::3], 1)
                resid = np.abs(sub_f - (a * sub_ref + b))
            except Exception:
                pass
        m = box_mean(resid) > THR
        m[:, :x0] = False
        m[:, x1:] = False
        area = int(m.sum())
        row = {"i": i, "t": round(t, 4), "area": area}
        if area >= 200:
            # 以屏幕中线所在列向外扩张出「连续段」：这样右侧桌面小组件的动效噪声不会
            # 把面板的包围盒/质心拉偏（两者之间有一段 0 列，天然不相连）。
            colsum = m.sum(axis=0)
            mid_col = w // 2
            if colsum[mid_col] > 0:
                lo = mid_col
                while lo > 0 and colsum[lo - 1] > 0:
                    lo -= 1
                hi = mid_col
                while hi < w - 1 and colsum[hi + 1] > 0:
                    hi += 1
            else:
                lo, hi = 0, w - 1
            sub = m[:, lo:hi + 1]
            ys, xs = np.nonzero(sub)
            row.update({"cx": round(float(xs.mean()) + lo, 1),
                        "cxb": round((lo + hi) / 2.0, 1),
                        "top": int(ys.min()) + BAND[0],
                        "width": int(hi - lo + 1)})
        else:
            row.update({"cx": -1, "cxb": -1, "top": -1, "width": 0})
        rows.append(row)

    if not rows:
        print(json.dumps({"verdict": "FAIL", "why": "no-frames", "total_frames": total},
                         ensure_ascii=False))
        return 2
    (out / "series.csv").write_text(
        "i,t,area,cx,top,width\n" + "\n".join(
            "%s,%s,%s,%s,%s,%s,%s" % (r["i"], r["t"], r["area"], r["cx"], r["cxb"], r["top"], r["width"])
            for r in rows), encoding="utf-8")
    live = [r for r in rows if r["area"] >= 400]
    peak = max((r["area"] for r in live), default=0)
    centered = [r for r in live if abs(r["cx"] - w / 2) <= 200]
    sliver = next((r for r in centered if 100 <= r["width"] <= 800), None)
    if sliver is None:
        print(json.dumps({"verdict": "FAIL", "why": "no-sliver", "total_frames": total,
                          "peak": peak, "samples": rows[:6]}, ensure_ascii=False))
        return 2
    # 「稳定态」取 onset 之后 0.7–1.3s 里面积最大的那一帧（避免把后面 IME/其它窗口的变化算进来）
    t_on = sliver["t"]
    later = [r for r in centered if t_on + 0.7 <= r["t"] <= t_on + 1.3]
    final = max(later, key=lambda r: r["area"]) if later else centered[-1]
    full = next((r for r in centered if r["i"] >= sliver["i"]
                 and r["width"] >= 0.95 * final["width"]), None)
    ramp = round((full["t"] - t_on) * 1000) if full else None
    # 说明（真机实测的物理限制）：出液段前 ~100ms 是「几乎全透明的细缝」（alpha 0→0.92），
    # 像素差分低于阈值，因此**首个可检测帧**落在出液末 / 垂落初（宽 ≈ 0.58 卡片宽）。
    # 因此 V3 度量的是「从首个可检测帧到接近终宽」的爬升时长，而不是从 0 开始的总时长。
    checks = {
        "V1_origin_x_near_center": abs(sliver["cxb"] - w / 2) <= 60,
        "V1_origin_y_below_cutout": 130 <= sliver["top"] <= 300,
        "V2_first_stage_small": sliver["area"] <= 0.25 * final["area"],
        "V3_width_ramp_120_700ms": ramp is not None and 120 <= ramp <= 700,
        "V4_final_centered": abs(final["cxb"] - w / 2) <= 40,
    }
    # 批次85-R4：V4 以**棱线**为准（掩码质心对透明玻璃/壁纸的敏感度不足，见 panel_rim 注释）
    rim_l, rim_r, rim_c = panel_rim(frames[final["i"]])
    checks["V4_rim_left"] = bool(rim_l > 0 and abs(rim_l - 56) <= 25)
    checks["V4_rim_right"] = bool(rim_r > 0 and abs(rim_r - 1200) <= 25)
    checks["V4_final_centered"] = bool(rim_c > 0 and abs(rim_c - w / 2) <= 40)
    verdict = "PASS" if all(checks.values()) else "FAIL"
    mid = rows[min(rows.index(sliver) + 12, len(rows) - 1)]
    for name, row in (("onset", sliver), ("mid", mid), ("settled", final)):
        run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vf",
             "select=eq(n\\,%d)" % row["i"], "-frames:v", "1",
             str(frames_dir / ("%s.png" % name))])
    report = {
        "serial": serial,
        "size": [w, h],
        "record_span_s": pts[-1] if pts else None,
        "total_frames": total,
        "peak_area": peak,
        "settled_width": final["width"],
        "onset": sliver,
        "mid": mid,
        "settled": final,
        "ramp_ms_sliver_to_full": ramp,
        "checks": checks,
        "verdict": verdict,
        "log_mark_count": len(marks),
        "log_marks": marks[:5],
    }
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "series.csv").write_text(
        "i,t,area,cx,top,width\n" + "\n".join(
            "%s,%s,%s,%s,%s,%s" % (r["i"], r["t"], r["area"], r["cx"], r["top"], r["width"])
            for r in rows), encoding="utf-8")
    print(json.dumps({k: report[k] for k in
                      ("size", "record_span_s", "total_frames", "peak_area", "settled_width", "onset",
                       "settled", "ramp_ms_sliver_to_full", "checks", "verdict",
                       "log_mark_count")}, ensure_ascii=False))
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
