"""批次 55-B：悬浮窗内回答引擎提问（ask_user_question）的端到端可复跑脚本。

批次出处：批次55-B「引擎问询回填实施与验证」——引擎发出 user-questions/request 后，
悬浮窗弹出选项卡片，用户点选 + 提交，App 经 /api/$events/result 回填，引擎继续执行。
本脚本把人工标定过的最短路径固化为一条可复跑命令，并用「日志证据 + 截图证据」双重判定每一步。

真机现状（已标定，勿随意改）：Honor SN-HONOR-XXXX，原始分辨率 1256x2808。

>>> 警告：本脚本会真的在真机上点击 / 输入 / 启动 Activity。
>>> 运行前请确认该设备空闲（没有别的代理或人工在占用），运行中不要碰手机。
>>> 只做离线算法自测时用 --analyze-card <png>，该入口完全不碰 adb。

离线自测（硬验收）：
    python tools/e2e_user_question.py --analyze-card .local/repro/b55b/s06_question.png
    python tools/e2e_user_question.py --analyze-card .local/repro/b55b/s07_picked.png

真机复跑：
    python tools/e2e_user_question.py
    python tools/e2e_user_question.py --serial <新序列号>

产物：.local/repro/b55b/e2e_<YYYYmmdd-HHMMSS>.txt（摘要）+ 同 stem 目录（各步截图）。
退出码：0 = 全链路成功；非 0 = 某一步判定失败（并打印最后 20 行 dsh-overlay 相关日志）。
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from io import BytesIO
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from PIL import Image, ImageStat

# ---------------------------------------------------------------- 常量（标定值）

# 批次97：真机序列号已脱敏；用 ANDROID_SERIAL=<serial> 指定目标设备。
SERIAL_DEFAULT = os.environ.get("ANDROID_SERIAL", "SN-HONOR-XXXX")

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = REPO_ROOT / ".local" / "repro" / "b55b"

#: 引擎提问提示词（ASCII；真机 input text 只吃 ASCII，空格需换成 %s —— 见 _encode_input_text）
PROMPT_TEXT = (
    "Please call the ask_user_question tool now: ask me exactly one single select "
    "question about favorite color with two options Red and Blue"
)

ACTIVITY = "com.deepseek.harness/.AssistActivity"

#: 探针框 (x0, y0, x1, y1)：面板弹起时平均亮度 43~68，桌面 236
PANEL_PROBE_BOX = (200, 500, 1050, 1250)
PANEL_LUMA_MAX = 110.0
PANEL_TIMEOUT_S = 30.0

#: 悬浮窗面板内的固定坐标（人工标定）
INPUT_BOX_TAP = (500, 1690)
SEND_TAP = (1085, 1690)

QUESTION_TIMEOUT_S = 120.0
BACKFILL_TIMEOUT_S = 30.0
TASK_DONE_TIMEOUT_S = 90.0

#: accent 蓝 #4D6BFE
ACCENT_BLUE = (77, 107, 254)
BLUE_TOL = 26
BAND_Y_GAP = 6            # y 间隙 > 6 → 新蓝带
SUBMIT_MIN_HEIGHT = 40    # 提交回答按钮蓝底高约 95px
SUBMIT_X_LIMIT = 800      # x0 < 800：排除右下角「发送」按钮（x1012-1159）

#: chip 检测窗口：submit 中心往上 180~320 之间（实测 chip 行 y≈1067..1163）
CHIP_WINDOW_NEAR = 180
CHIP_WINDOW_FAR = 320
CARD_REGION_ABOVE = 560
CARD_REGION_BELOW = 60
CARD_REGION_X = (60, 1100)

CHIP_LUMA_MAX = 190       # 排除白字
CHIP_DELTA_MIN = 14       # 与卡片底色亮度差 >= 14（chip 白 15% 叠底，实测差 ≈ 29）
CHIP_SEARCH_X = (60, 1150)  # 卡片内部：排除卡片外的桌面亮色与卡片左缘暗色阴影
CHIP_ROW_MIN_PIXELS = 30
CHIP_MIN_ROWS = 30        # chip 高约 96px
CHIP_ROW_GAP = 3
CHIP_SEG_MIN_WIDTH = 60
CHIP_SEG_MAX_WIDTH = 500  # 排除整行输入框
CHIP_COL_FILL = 0.35      # chip 列投影占比阈值（chip 内文字行被排除，留白仍占比 > 0.5）
CHIP_COL_GAP = 10
CHIP_CANDIDATE_ROWS = 3   # 校验失败时依次尝试的候选行数

LOG_TAG_FILTER = ("dsh-overlay", "dsh-overlay-mux")
FAIL_LOG_TAIL = 20

RE_PENDING = re.compile(r"interaction pending kind=question")
RE_BACKFILL = re.compile(r"回填成功\s+eventId=(\S+)")
RE_RUNNING_FALSE = re.compile(r"running=false")
RE_PANEL_SHOWN = re.compile(r"overlay context resumed \(panel shown\)")


# ---------------------------------------------------------------- 图像检测（纯函数，可离线自测）


def _rgb(img: Image.Image) -> Image.Image:
    return img.convert("RGB")


def mean_luma(img: Image.Image, box: Tuple[int, int, int, int]) -> float:
    """探针框平均亮度（Pillow 的 L 转换 = 0.299R+0.587G+0.114B）。"""
    return float(ImageStat.Stat(_rgb(img).crop(box).convert("L")).mean[0])


def _is_accent_blue(r: int, g: int, b: int, tol: int = BLUE_TOL) -> bool:
    return (
        abs(r - ACCENT_BLUE[0]) <= tol
        and abs(g - ACCENT_BLUE[1]) <= tol
        and abs(b - ACCENT_BLUE[2]) <= tol
    )


def _luma(r: int, g: int, b: int) -> int:
    return (r * 299 + g * 587 + b * 114) // 1000


def blue_bands(
    img: Image.Image, tol: int = BLUE_TOL, y_gap: int = BAND_Y_GAP
) -> List[Dict[str, int]]:
    """逐像素找 accent 蓝，按 y 聚成连续带（y 间隙 > y_gap 视为新带）。

    返回按 y 升序的带列表，每项：y0/y1/x0/x1/height/count/cy/cx。
    """
    im = _rgb(img)
    w, h = im.size
    data = im.tobytes()
    rows: Dict[int, List[int]] = {}
    stride = w * 3
    for i in range(0, len(data), 3):
        r = data[i]
        g = data[i + 1]
        b = data[i + 2]
        if not _is_accent_blue(r, g, b, tol):
            continue
        y = i // stride
        x = (i - y * stride) // 3
        cur = rows.get(y)
        if cur is None:
            rows[y] = [x, x, 1]
        else:
            if x < cur[0]:
                cur[0] = x
            if x > cur[1]:
                cur[1] = x
            cur[2] += 1
    bands: List[Dict[str, int]] = []
    for y in sorted(rows):
        x0, x1, n = rows[y]
        if bands and y - bands[-1]["y1"] <= y_gap:
            band = bands[-1]
            band["y1"] = y
            band["x0"] = min(band["x0"], x0)
            band["x1"] = max(band["x1"], x1)
            band["count"] += n
        else:
            bands.append({"y0": y, "y1": y, "x0": x0, "x1": x1, "count": n})
    for band in bands:
        band["height"] = band["y1"] - band["y0"] + 1
        band["cy"] = (band["y0"] + band["y1"]) // 2
        band["cx"] = (band["x0"] + band["x1"]) // 2
    return bands


def find_submit_center(
    img: Image.Image, bands: Optional[Sequence[Dict[str, int]]] = None
) -> Optional[Tuple[int, int]]:
    """提交回答按钮中心：x0 < 800 且高度 >= 40 的蓝带里最下面一条。"""
    if bands is None:
        bands = blue_bands(img)
    cands = [
        b
        for b in bands
        if b["x0"] < SUBMIT_X_LIMIT and b["height"] >= SUBMIT_MIN_HEIGHT
    ]
    if not cands:
        return None
    best = max(cands, key=lambda b: b["y1"])
    return (best["cx"], best["cy"])


def card_baseline_luma(img: Image.Image, submit_cy: int) -> int:
    """卡片底色基准亮度：卡片区域（submit 上下）的中位亮度。"""
    im = _rgb(img)
    w, h = im.size
    top = max(0, submit_cy - CARD_REGION_ABOVE)
    bottom = min(h, submit_cy + CARD_REGION_BELOW)
    left, right = CARD_REGION_X
    region = im.crop((left, top, min(w, right), bottom)).convert("L")
    return int(ImageStat.Stat(region).median[0])


def _is_chip_pixel(r: int, g: int, b: int, baseline: int) -> bool:
    """chip 底色：比卡片底更亮 >= 14，且不是白字、也不是 accent 蓝。

    只认「更亮」方向：卡片外的暗色边缘/阴影比底色暗，不能被误判成 chip。
    """
    if _is_accent_blue(r, g, b):
        return False
    luma = _luma(r, g, b)
    if luma >= CHIP_LUMA_MAX:
        return False
    return luma - baseline >= CHIP_DELTA_MIN


def chip_rows(
    img: Image.Image,
    submit_center: Tuple[int, int],
    baseline: Optional[int] = None,
) -> Tuple[Dict[int, int], int, Tuple[int, int]]:
    """窗口 [sy-320, sy-180] 内逐行的 chip 像素计数。返回 (counts, baseline, (y0, y1))。"""
    sy = submit_center[1]
    im = _rgb(img)
    w, h = im.size
    win_top = max(0, sy - CHIP_WINDOW_FAR)
    win_bottom = min(h - 1, sy - CHIP_WINDOW_NEAR)
    if baseline is None:
        baseline = card_baseline_luma(img, sy)
    data = im.tobytes()
    stride = w * 3
    x_start, x_end = CHIP_SEARCH_X
    x_start = max(0, x_start)
    x_end = min(w - 1, x_end)
    counts: Dict[int, int] = {}
    for y in range(win_top, win_bottom + 1):
        base = y * stride
        n = 0
        for x in range(x_start, x_end + 1):
            i = base + x * 3
            if _is_chip_pixel(data[i], data[i + 1], data[i + 2], baseline):
                n += 1
        counts[y] = n
    return counts, baseline, (win_top, win_bottom)


def _row_runs(counts: Dict[int, int]) -> List[Tuple[int, int]]:
    """chip 像素数 >= CHIP_ROW_MIN_PIXELS 的连续行段（行间隙 <= CHIP_ROW_GAP 视为同一段）。"""
    runs: List[Tuple[int, int]] = []
    start: Optional[int] = None
    prev: Optional[int] = None
    for y in sorted(counts):
        if counts[y] < CHIP_ROW_MIN_PIXELS:
            continue
        if start is not None and prev is not None and y - prev <= CHIP_ROW_GAP:
            prev = y
            runs[-1] = (start, y)
            continue
        start = y
        prev = y
        runs.append((y, y))
    return runs


def _chip_segments(
    img: Image.Image, y0: int, y1: int, baseline: int
) -> List[Tuple[int, int]]:
    """在行段 y0..y1 上做列投影，返回候选 chip 的 x 段（左起）。"""
    im = _rgb(img)
    w, h = im.size
    y0 = max(0, y0)
    y1 = min(h - 1, y1)
    data = im.tobytes()
    stride = w * 3
    x_start, x_end = CHIP_SEARCH_X
    x_start = max(0, x_start)
    x_end = min(w - 1, x_end)
    cols = [0] * (x_end - x_start + 1)
    for y in range(y0, y1 + 1):
        base = y * stride
        for x in range(x_start, x_end + 1):
            i = base + x * 3
            if _is_chip_pixel(data[i], data[i + 1], data[i + 2], baseline):
                cols[x - x_start] += 1
    thr = max(1, int((y1 - y0 + 1) * CHIP_COL_FILL))
    hits: List[List[int]] = []
    start: Optional[int] = None
    for idx, count in enumerate(cols):
        x = idx + x_start
        if count >= thr:
            if start is None:
                start = x
        elif start is not None:
            hits.append([start, x - 1])
            start = None
    if start is not None:
        hits.append([start, x_end])
    merged: List[List[int]] = []
    for seg in hits:
        if merged and seg[0] - merged[-1][1] <= CHIP_COL_GAP:
            merged[-1][1] = seg[1]
        else:
            merged.append(list(seg))
    return [
        (a, b)
        for a, b in merged
        if CHIP_SEG_MIN_WIDTH <= (b - a + 1) <= CHIP_SEG_MAX_WIDTH
    ]


def find_chip_candidates(
    img: Image.Image,
    submit_center: Tuple[int, int],
    baseline: Optional[int] = None,
) -> Tuple[List[Tuple[int, int]], Dict[str, object]]:
    """候选「第一个选项 chip」中心：最上面那条行段的最左一段优先。"""
    counts, baseline, window = chip_rows(img, submit_center, baseline)
    runs = [r for r in _row_runs(counts) if (r[1] - r[0] + 1) >= CHIP_MIN_ROWS]
    info: Dict[str, object] = {
        "baseline": baseline,
        "window": window,
        "row_runs": runs,
        "detected": [],
    }
    candidates: List[Tuple[int, int]] = []
    detected: List[Dict[str, object]] = []
    for y0, y1 in runs:
        peak = max(range(y0, y1 + 1), key=lambda y: counts[y])
        segments = _chip_segments(img, y0, y1, baseline)
        detected.append({"run": (y0, y1), "peak_row": peak, "segments": segments})
        if not segments:
            continue
        seg = segments[0]  # 最左边那一段 = 第一颗 chip
        candidates.append(((seg[0] + seg[1]) // 2, (y0 + y1) // 2))
    info["detected"] = detected
    return candidates[:CHIP_CANDIDATE_ROWS], info


def find_chip_center(
    img: Image.Image, submit_center: Tuple[int, int]
) -> Optional[Tuple[int, int]]:
    cands, _ = find_chip_candidates(img, submit_center)
    return cands[0] if cands else None


def detect_card(img: Image.Image) -> Dict[str, object]:
    """一次算出卡片上的 submit / chip 坐标与命中带（离线自测与真机流程共用）。"""
    bands = blue_bands(img)
    submit = find_submit_center(img, bands)
    result: Dict[str, object] = {"bands": bands, "submit": submit, "chip": None}
    if submit is None:
        return result
    cands, info = find_chip_candidates(img, submit)
    result["chip"] = cands[0] if cands else None
    result["chip_candidates"] = cands
    result["chip_info"] = info
    result["submit_band"] = max(
        (
            b
            for b in bands
            if b["x0"] < SUBMIT_X_LIMIT and b["height"] >= SUBMIT_MIN_HEIGHT
        ),
        key=lambda b: b["y1"],
        default=None,
    )
    return result


def _format_bands(bands: Iterable[Dict[str, int]]) -> List[str]:
    return [
        "y{}-{} x{}-{} h{} center=({},{})".format(
            b["y0"], b["y1"], b["x0"], b["x1"], b["height"], b["cx"], b["cy"]
        )
        for b in bands
    ]


# ---------------------------------------------------------------- 离线自测入口


def analyze_card(path: Path) -> int:
    """只读 PNG，打印检测坐标与命中带。完全不碰 adb。"""
    if not path.exists():
        print("ERROR: 截图不存在: {}".format(path))
        return 2
    with Image.open(path) as raw:
        img = raw.convert("RGB")
    det = detect_card(img)
    print("== analyze-card {} ({})".format(path, "x".join(str(v) for v in img.size)))
    for line in _format_bands(det["bands"]):
        print("  blue band {}".format(line))
    submit = det["submit"]
    print("submit: {}".format(submit))
    info = det.get("chip_info") or {}
    if info:
        print("chip baseline luma: {}".format(info.get("baseline")))
        print("chip window y: {}".format(info.get("window")))
        for item in info.get("detected", []):
            print(
                "  chip row-run y{}..{} peak_row={} segments={}".format(
                    item["run"][0], item["run"][1], item["peak_row"], item["segments"]
                )
            )
    print("chip: {}".format(det["chip"]))
    print("chip candidates: {}".format(det.get("chip_candidates")))
    if submit is None:
        print("RESULT: FAIL (submit button not detected)")
        return 1
    if det["chip"] is None:
        print("RESULT: FAIL (option chip not detected)")
        return 1
    print("RESULT: OK")
    return 0


# ---------------------------------------------------------------- 真机执行


class E2EFailure(RuntimeError):
    """某一步判定失败（非 0 退出的原因）。"""


def resolve_adb() -> str:
    exe = shutil.which("adb")
    if exe:
        return exe
    for env in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        root = os.environ.get(env)
        if not root:
            continue
        cand = Path(root) / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb")
        if cand.exists():
            return str(cand)
    raise E2EFailure("adb 未找到：PATH 与 %ANDROID_HOME% 下都没有 adb")


class Device:
    def __init__(self, adb: str, serial: str) -> None:
        self.base = [adb, "-s", serial]
        self.serial = serial

    def _run(
        self, args: Sequence[str], timeout: float = 60.0
    ) -> subprocess.CompletedProcess:
        return subprocess.run(
            list(args), capture_output=True, timeout=timeout, check=False
        )

    def shell(self, *args: str, timeout: float = 60.0) -> bytes:
        return self._run(self.base + ["shell", *args], timeout=timeout).stdout

    def screencap(self) -> Image.Image:
        cp = self._run(self.base + ["exec-out", "screencap", "-p"], timeout=60.0)
        data = cp.stdout
        if not data:
            raise E2EFailure("screencap 返回空（设备掉线？）")
        try:
            im = Image.open(BytesIO(data))
            im.load()
        except Exception:
            im = Image.open(BytesIO(data.replace(b"\r\n", b"\n")))
            im.load()
        return im

    def logcat_text(self) -> str:
        return self.shell("logcat", "-d", timeout=90.0).decode("utf-8", "replace")


def _encode_input_text(text: str) -> str:
    """真机 input text 只接受 ASCII，空格必须写成 %s（否则 adb shell 会截断参数）。"""
    assert text.isascii(), "prompt 必须是 ASCII"
    return text.replace(" ", "%s")


def _save_shot(img: Image.Image, shot_dir: Path, name: str) -> str:
    shot_dir.mkdir(parents=True, exist_ok=True)
    path = shot_dir / (name + ".png")
    img.convert("RGB").save(path)
    return str(path)


def _tail_overlay_logs(lines: Sequence[str], n: int = FAIL_LOG_TAIL) -> List[str]:
    hits = [ln for ln in lines if any(tag in ln for tag in LOG_TAG_FILTER)]
    return hits[-n:]


def _first_match(lines: Sequence[str], pattern: "re.Pattern[str]") -> Optional[str]:
    for ln in lines:
        if pattern.search(ln):
            return ln.strip()
    return None


def run_e2e(serial: str) -> int:
    adb = resolve_adb()
    ts = time.strftime("%Y%m%d-%H%M%S")
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    summary_path = OUT_ROOT / "e2e_{}.txt".format(ts)
    shot_dir = OUT_ROOT / "e2e_{}".format(ts)
    shot_dir.mkdir(parents=True, exist_ok=True)

    dev = Device(adb, serial)
    evidence: List[str] = []
    failure: Optional[str] = None
    log_lines: List[str] = []
    started = time.strftime("%Y-%m-%d %H:%M:%S")
    step = "init"

    def say(msg: str) -> None:
        print(msg, flush=True)
        evidence.append(msg)

    def wait_for_log(
        pattern: "re.Pattern[str]", timeout: float, label: str, step_name: str
    ) -> str:
        nonlocal log_lines
        deadline = time.time() + timeout
        while True:
            log_lines = dev.logcat_text().splitlines()
            hit = _first_match(log_lines, pattern)
            if hit:
                say("[{}] 命中 {}: {}".format(step_name, label, hit))
                return hit
            if time.time() >= deadline:
                msg = "[{}] 超时 {}s 未等到 {}".format(step_name, int(timeout), label)
                say(msg)
                raise E2EFailure(msg)
            time.sleep(2.0)

    try:
        step = "logcat-clear"
        dev.shell("logcat", "-c")
        say("[1] adb -s {} shell logcat -c".format(serial))

        step = "home"
        dev.shell("input", "keyevent", "KEYCODE_HOME")
        time.sleep(2.0)
        say("[2] KEYCODE_HOME 完成（等 2s）")

        step = "assist"
        dev.shell("am", "start", "-n", ACTIVITY)

        step = "panel"
        deadline = time.time() + PANEL_TIMEOUT_S
        panel_line: Optional[str] = None
        panel_probe = -1.0
        img: Optional[Image.Image] = None
        while True:
            log_lines = dev.logcat_text().splitlines()
            hit = _first_match(log_lines, RE_PANEL_SHOWN)
            if hit:  # 面板日志是辅助证据：一旦出现就固定下来，别被后续轮询覆盖
                panel_line = hit
            img = dev.screencap()
            panel_probe = mean_luma(img, PANEL_PROBE_BOX)
            if panel_probe < PANEL_LUMA_MAX:
                break
            if time.time() >= deadline:
                shot = _save_shot(img, shot_dir, "panel")
                raise E2EFailure(
                    "[3] 面板未出现：探针 mean_luma={:.1f} >= {} 超过 {}s（截图 {}；panel 日志 {}）".format(
                        panel_probe,
                        PANEL_LUMA_MAX,
                        int(PANEL_TIMEOUT_S),
                        shot,
                        panel_line or "(未捕获)",
                    )
                )
            time.sleep(1.5)
        assert img is not None
        _save_shot(img, shot_dir, "panel")
        say(
            "[3] 面板已出现：探针框 {} mean_luma={:.1f} < {}（像素判据）；"
            "日志 overlay context resumed (panel shown): {}".format(
                PANEL_PROBE_BOX, panel_probe, PANEL_LUMA_MAX, panel_line or "(未捕获)"
            )
        )

        step = "typed"
        dev.shell("input", "tap", *[str(v) for v in INPUT_BOX_TAP])
        time.sleep(1.0)
        dev.shell("input", "text", _encode_input_text(PROMPT_TEXT))
        time.sleep(1.0)
        typed_shot = _save_shot(dev.screencap(), shot_dir, "typed")
        say("[4] 已 tap 输入框 {} 并 input text（ASCII，空格用 %s）: {}".format(INPUT_BOX_TAP, typed_shot))

        step = "sent"
        dev.shell("input", "tap", *[str(v) for v in SEND_TAP])
        time.sleep(2.0)
        sent_shot = _save_shot(dev.screencap(), shot_dir, "sent")
        say("[5] 已 tap 发送 {}: {}".format(SEND_TAP, sent_shot))

        step = "question"
        wait_for_log(RE_PENDING, QUESTION_TIMEOUT_S, "interaction pending kind=question", step)
        time.sleep(1.0)  # 卡片入场动画收尾，避免检测到半透明中间态
        question_img = dev.screencap()
        question_shot = _save_shot(question_img, shot_dir, "question")
        det = detect_card(question_img)
        submit = det["submit"]
        candidates = det.get("chip_candidates") or []
        if submit is None:
            raise E2EFailure("[6] 提问卡片上未检测到提交回答按钮（截图 {}）".format(question_shot))
        if not candidates:
            raise E2EFailure("[6] 提问卡片上未检测到选项 chip（截图 {}）".format(question_shot))
        say(
            "[6] 提问卡片检测：submit={} band={}；chip 候选={}（baseline luma={}）；截图 {}".format(
                submit,
                det["submit_band"],
                candidates,
                (det.get("chip_info") or {}).get("baseline"),
                question_shot,
            )
        )

        step = "chip"
        chip_ok: Optional[Tuple[int, int]] = None
        last_after: Optional[Image.Image] = None
        for idx, cand in enumerate(candidates):
            sy = submit[1]
            dev.shell("input", "tap", str(cand[0]), str(cand[1]))
            time.sleep(1.2)
            last_after = dev.screencap()
            selected = [
                b
                for b in blue_bands(last_after)
                if b["height"] >= SUBMIT_MIN_HEIGHT
                and b["y0"] >= sy - CHIP_WINDOW_FAR - 10
                and b["y1"] <= sy - CHIP_WINDOW_NEAR + 10
            ]
            say(
                "[7] chip 候选#{} tap={} → 选中蓝带 {}（{}）".format(
                    idx + 1,
                    cand,
                    [
                        "y{}-{} x{}-{}".format(b["y0"], b["y1"], b["x0"], b["x1"])
                        for b in selected
                    ],
                    "命中" if selected else "未命中",
                )
            )
            if selected:
                chip_ok = cand
                break
        after_chip_shot = (
            _save_shot(last_after, shot_dir, "after_chip") if last_after is not None else "(无)"
        )
        if chip_ok is None:
            raise E2EFailure(
                "[7] 选项 chip 点选失败：{} 个候选行都未出现「chip 变蓝」证据（截图 {}）".format(
                    len(candidates), after_chip_shot
                )
            )
        say("[7] chip 选中确认：tap={}；截图 {}".format(chip_ok, after_chip_shot))

        step = "submit"
        dev.shell("input", "tap", str(submit[0]), str(submit[1]))
        time.sleep(2.0)
        after_submit_shot = _save_shot(dev.screencap(), shot_dir, "after_submit")
        say("[8] 已 tap 提交回答 {}: {}".format(submit, after_submit_shot))

        step = "backfill"
        wait_for_log(RE_BACKFILL, BACKFILL_TIMEOUT_S, "回填成功 eventId=", step)

        step = "running-false"
        wait_for_log(RE_RUNNING_FALSE, TASK_DONE_TIMEOUT_S, "diag: running=false", step)
        final_shot = _save_shot(dev.screencap(), shot_dir, "final")
        say("[9] 最终截图: {}".format(final_shot))
        say("PASS: 全链路（提问 → 点选 chip → 提交 → 回填 → 任务继续并结束）判定成功")
    except E2EFailure as exc:
        failure = str(exc)
    except subprocess.TimeoutExpired as exc:
        failure = "[{}] adb 命令超时: {}".format(step, exc)
    except Exception as exc:  # noqa: BLE001 - 任何异常都要落盘摘要
        failure = "[{}] {}: {}".format(step, type(exc).__name__, exc)

    try:
        log_lines = dev.logcat_text().splitlines()
    except Exception:  # noqa: BLE001
        pass
    tail = _tail_overlay_logs(log_lines)

    header = [
        "批次55-B 悬浮窗回答引擎提问 E2E",
        "设备: {} (adb: {})".format(serial, adb),
        "开始: {}  结束: {}".format(started, time.strftime("%Y-%m-%d %H:%M:%S")),
        "截图目录: {}".format(shot_dir),
        "结果: {}".format("PASS" if failure is None else "FAIL"),
    ]
    body = ["", "== 步骤证据 =="] + evidence
    if failure is not None:
        body += [
            "",
            "== 失败 ==",
            failure,
            "",
            "== 最后 {} 行 dsh-overlay 日志 ==".format(FAIL_LOG_TAIL),
        ]
        body += tail or ["(无 dsh-overlay / dsh-overlay-mux 日志)"]
    summary_path.write_text("\n".join(header + body) + "\n", encoding="utf-8")

    print("\n".join(header), flush=True)
    print("摘要: {}".format(summary_path), flush=True)
    if failure is not None:
        print("FAIL: {}".format(failure), flush=True)
        print("最后 {} 行 dsh-overlay 日志:".format(FAIL_LOG_TAIL), flush=True)
        for ln in tail:
            print("  " + ln, flush=True)
        return 1
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="批次55-B：悬浮窗回答引擎提问的端到端复跑（会在真机点击，慎用）"
    )
    parser.add_argument(
        "--serial",
        default=SERIAL_DEFAULT,
        help="设备序列号（默认 {}）".format(SERIAL_DEFAULT),
    )
    parser.add_argument(
        "--analyze-card",
        metavar="PNG",
        help="离线自测：只读该截图，打印检测到的 submit/chip 坐标与命中带（不碰 adb）",
    )
    args = parser.parse_args(argv)
    if args.analyze_card:
        return analyze_card(Path(args.analyze_card))
    return run_e2e(args.serial)


if __name__ == "__main__":
    sys.exit(main())
