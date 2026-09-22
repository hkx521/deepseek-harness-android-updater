#!/usr/bin/env bash
# tools/power-baseline.sh —— 批次21 功耗基线测量
# 用法: sh tools/power-baseline.sh [设备序列号] [每场景秒数,默认900]
# 说明: 设备经 USB 连接=持续供电, 电池%读数无效; 本脚本用「进程 CPU 时间代理」+
#       batterystats 明细量化闲置功耗 (jiffy 通常=10ms; %单核 = cpu_ms/(period_s*1000)*100)。
#       8h 熄屏掉电百分比红线需拔线夜间实测(挂账, 由用户执行一次)。
# 场景: S1 熄屏+引擎闲置(含 overlay 探测循环) / S2 熄屏+force-stop(环境对照) / S3 亮屏+引擎闲置
set -u
SERIAL="${1:-}"; PERIOD="${2:-900}"
A="adb"; [ -n "$SERIAL" ] && A="adb -s $SERIAL"
OUT=".local/power-baseline-$(date +%Y%m%d-%H%M).txt"
PCT() { awk -v m="$1" -v p="$PERIOD" 'BEGIN{printf "%.2f", m/(p*10)}'; }  # cpu_ms/(period_s*1000)*100

ticks() { $A shell "cat /proc/$1/stat 2>/dev/null" | awk '{print $14+$15}' | tr -d '\r'; }
# node 进程检测：pgrep 的 su/sh 包装壳会自匹配（批次22 实踩，pid 3928 瞬态）——
# 对候选逐一验证 cmdline 含 dsh/lib/bin.js（真实引擎特征），无效则轮空。
find_node_pid() {
  local p c
  for p in $($A shell "su -c 'pgrep -f runtime-glibc'" 2>/dev/null | tr -d '\r'); do
    [ -n "$p" ] || continue
    c=$($A shell "su -c 'tr \"\\000\" \" \" < /proc/$p/cmdline 2>/dev/null'" 2>/dev/null | tr -d '\r')
    case "$c" in
      *dsh/lib/bin.js*) echo "$p"; return 0;;
    esac
  done
  echo ""
}
snap() { # snap <标签> —— 记录两进程当前 CPU ticks
  echo "[$(date +%H:%M:%S)] $label APP_PID=${APP_PID:-none}(${APP_PID:+$(ticks $APP_PID)}) NODE_PID=${NODE_PID:-none}(${NODE_PID:+$(ticks $NODE_PID)})"
}

{
echo "== DSH 功耗基线 $(date '+%F %T') serial=${SERIAL:-default} period=${PERIOD}s =="
B0=$($A shell dumpsys battery | grep -E "level| powered|status" | head -4 | tr -d '\r'); echo "battery: $B0"
$A shell dumpsys batterystats --reset >/dev/null 2>&1

# ---- S1 熄屏+引擎闲置 ----
$A shell am start -n com.deepseek.harness/.MainActivity >/dev/null 2>&1; sleep 12
$A shell input keyevent 26 >/dev/null 2>&1; sleep 5
echo "S1 wakefulness: $($A shell dumpsys power | grep -m1 mWakefulness | tr -d '\r')"
APP_PID=$($A shell pidof com.deepseek.harness | tr -d '\r' | awk '{print $1}')
NODE_PID=$($A shell "su -c 'pgrep -f runtime-glibc'" 2>/dev/null | head -1 | tr -d '\r')
label=S1-start; snap
A0=$(ticks "$APP_PID"); N0=$(ticks "$NODE_PID")
sleep "$PERIOD"
A1=$(ticks "$APP_PID"); N1=$(ticks "$NODE_PID")
AM=$(( (A1-A0)*10 )); NM=$(( (N1-N0)*10 ))
echo "S1 RESULT: app_cpu=${AM}ms ($(PCT $AM)%单核) node_cpu=${NM}ms ($(PCT $NM)%单核) period=${PERIOD}s"
label=S1-end; snap

# ---- S2 熄屏+force-stop(环境对照) ----
$A shell am force-stop com.deepseek.harness >/dev/null 2>&1; sleep 5
echo "S2 wakefulness: $($A shell dumpsys power | grep -m1 mWakefulness | tr -d '\r')"
echo "S2 RESULT: 应用已停止, 本场景仅取环境本底; wakelock 快照:"
$A shell "dumpsys power | grep -A2 'Wake Locks'" | head -6
sleep "$PERIOD"
echo "S2 RESULT: done (app_cpu=0 基线)"

# ---- S3 亮屏+引擎闲置 ----
$A shell svc power stayon usb >/dev/null 2>&1
$A shell am start -n com.deepseek.harness/.MainActivity >/dev/null 2>&1; sleep 12
$A shell input keyevent 26 >/dev/null 2>&1; sleep 3  # 先亮屏(stayon 保持)
echo "S3 wakefulness: $($A shell dumpsys power | grep -m1 mWakefulness | tr -d '\r')"
APP_PID=$($A shell pidof com.deepseek.harness | tr -d '\r' | awk '{print $1}')
NODE_PID=$($A shell "su -c 'pgrep -f runtime-glibc'" 2>/dev/null | head -1 | tr -d '\r')
label=S3-start; snap
A0=$(ticks "$APP_PID"); N0=$(ticks "$NODE_PID")
sleep "$PERIOD"
A1=$(ticks "$APP_PID"); N1=$(ticks "$NODE_PID")
AM=$(( (A1-A0)*10 )); NM=$(( (N1-N0)*10 ))
echo "S3 RESULT: app_cpu=${AM}ms ($(PCT $AM)%单核) node_cpu=${NM}ms ($(PCT $NM)%单核) period=${PERIOD}s"
label=S3-end; snap

$A shell dumpsys batterystats --charged com.deepseek.harness > .local/power-batterystats-charged.txt 2>&1
$A shell svc power stayon false >/dev/null 2>&1
echo "== 完成 $(date '+%F %T')，明细: .local/power-batterystats-charged.txt =="
} 2>&1 | tee "$OUT"
