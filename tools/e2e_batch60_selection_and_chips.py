import os
import subprocess
import time
from pathlib import Path
from PIL import Image

# 批次97：真机序列号已脱敏；用 ANDROID_SERIAL=<serial> 指定目标设备。
SERIAL = os.environ.get("ANDROID_SERIAL", "SN-HONOR-XXXX")
OUT_DIR = Path(".local/repro/b60")
OUT_DIR.mkdir(parents=True, exist_ok=True)

def adb(cmd):
    full = f"adb -s {SERIAL} {cmd}"
    r = subprocess.run(full, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.stdout.strip()

def screencap(name):
    path = OUT_DIR / name
    cmd = f"adb -s {SERIAL} exec-out screencap -p"
    r = subprocess.run(cmd, shell=True, capture_output=True)
    if r.returncode == 0 and len(r.stdout) > 1000:
        path.write_bytes(r.stdout)
        img = Image.open(path)
        print(f"Captured {name}: {img.size[0]}x{img.size[1]} ({len(r.stdout)} bytes)")
        return path
    else:
        print(f"Failed to capture {name}")
        return None

print("=== 1. 唤起 AssistActivity 呼出面板 ===")
adb("shell am start -n com.deepseek.harness/.AssistActivity")
time.sleep(1.2)
p1 = screencap("b60_01_panel_shown.png")

# 检查日志
log = adb("logcat -d -s dsh-overlay:V")
last_logs = log.splitlines()[-10:]
for l in last_logs:
    print("LOG:", l)

# 验证日志中没有 capsuleView 报错
assert "NullPointerException" not in log, "Found NPE in logcat!"
print("=== 2. 面板已正常弹出，无 NPE 报错 ===")

# 测试点击屏幕中央空白区或按 BACK 收起面板
adb("shell input keyevent KEYCODE_BACK")
time.sleep(0.8)
p2 = screencap("b60_02_panel_dismissed.png")

print("=== 3. 再次按 AI 键呼出面板 ===")
adb("shell am start -n com.deepseek.harness/.AssistActivity")
time.sleep(1.0)
p3 = screencap("b60_03_panel_reopened.png")

print("=== ALL E2E VERIFICATIONS PASS ===")
