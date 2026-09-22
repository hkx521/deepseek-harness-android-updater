#!/bin/sh
# =====================================================================
# diag-bundle.sh — DeepSeek Harness Android 诊断包一键导出（只读收集）
#
# 用法:  sh tools/diag-bundle.sh [输出目录]
#        缺省输出目录: .local/diag-<yyyyMMdd-HHmmss>/
#
# 说明:
#   - 收集类工具：单项失败写入 "[SKIP: 原因]" 后继续，不用 set -e。
#   - 无 root 自动降级：需要 su 的采集项标注 SKIP，其余照常。
#   - 红线: local_token / engine_cookie 等凭据一律脱敏（前4位+***），
#     收尾对全包做明文自检。
#   - 所有 adb 调用带超时；设备离线时开头即报错退出。
#   - 仅依赖: sh + adb(平台工具) + su(设备端，可选) + Git Bash 自带 coreutils。
# =====================================================================

export MSYS_NO_PATHCONV=1        # 防止 Git Bash 把 /data/... 转成 Windows 路径
export MSYS2_ARG_CONV_EXCL='*'
export LC_ALL=C

# ---------- 常量 ----------
PKG="com.deepseek.harness"
APP_ACT="com.deepseek.harness/.MainActivity"
DEV_FILES="/data/user/0/com.deepseek.harness/files"
DEV_PREFS="/data/user/0/com.deepseek.harness/shared_prefs/dsh_prefs.xml"
DEV_PLUGIN_BASE="$DEV_FILES/payload/dshhome/profiles/web/node_modules/@deepseek-ai"
DEVHOME_BASE_REL="build/updater/devhome/.dsh/profiles/web/node_modules/@deepseek-ai"
VSCREEN_LOG="/data/local/tmp/vscreen.log"

ADB_TIMEOUT="${DSH_DIAG_ADB_TIMEOUT:-20}"   # 单条 adb 超时（秒）

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)

# ---------- 参数 ----------
OUT="${1:-$ROOT_DIR/.local/diag-$(date +%Y%m%d-%H%M%S)}"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac
mkdir -p "$OUT" || { echo "ERROR: 无法创建输出目录 $OUT"; exit 1; }

SKIP_LIST="$OUT/.skips.txt"
: > "$SKIP_LIST"
TMPD=$(mktemp -d)

# ---------- 基础助手 ----------
log()  { echo "[diag] $*"; }

# 带超时执行命令；无 timeout 命令则直跑
run_to() {
    local _t=$1; shift
    if command -v timeout >/dev/null 2>&1; then
        timeout "$_t" "$@" 2>&1
    else
        "$@" 2>&1
    fi
}

# AC <adb 子命令...>: 指定序列号 + 超时，stderr 并入 stdout
AC() { run_to "$ADB_TIMEOUT" adb -s "$SERIAL" "$@"; }

# ASH <shell 命令...>: adb shell 文本输出（去掉可能的 \r）
ASH() { AC shell "$@" | tr -d '\r'; }

# ASU <单条命令>: 设备端 su -c 执行（payload 内不要含单引号）
ASU() { AC shell "su -c '$1'"; }

# skip <文件名> <原因>: 写 SKIP 标记并登记
skip() {
    echo "[SKIP: $2]（生成于 $(date '+%F %T')）" > "$OUT/$1"
    echo "$1|$2" >> "$SKIP_LIST"
    log "collect $1 ... SKIP（$2）"
}

# ---------- 设备预检（离线即退出） ----------
SERIAL="${DSH_ADB_SERIAL:-}"
if [ -z "$SERIAL" ]; then
    SERIAL=$(adb devices 2>/dev/null | awk '$2=="device"{print $1; exit}')
fi
if [ -z "$SERIAL" ]; then
    echo "ERROR: 未找到在线设备（adb devices 无 device 状态条目）。"
    echo "       可用 DSH_ADB_SERIAL=<序列号> 指定目标设备。"
    exit 1
fi
ST=$(run_to 10 adb -s "$SERIAL" get-state 2>&1)
if [ "$ST" != "device" ]; then
    echo "ERROR: 设备 $SERIAL 状态异常（get-state=$ST），中止。"
    exit 1
fi
log "设备: $SERIAL（在线）"

# ---------- root 能力探测（无 root 自动降级） ----------
SU_ID=$(ASU id 2>/dev/null | tr -d '\r')
case "$SU_ID" in
    *uid=0*) HAS_ROOT=yes ;;
    *)       HAS_ROOT=no  ;;
esac
log "root: $HAS_ROOT"

# 收集项计数
OK_N=0

# =====================================================================
# 1) device-info.txt — 设备基本信息（供 summary 引用）
# =====================================================================
collect_device_info() {
    local f="device-info.txt" raw
    raw=$(ASH "getprop ro.product.model; getprop ro.product.device; \
getprop ro.build.version.release; getprop ro.build.version.sdk; \
getprop ro.build.fingerprint; getprop ro.build.date.utc")
    if [ -z "$raw" ]; then skip "$f" "getprop 无输出（shell 不可用?）"; return; fi
    {
        echo "# getprop: model / device / release / sdk / fingerprint / build-date"
        printf '%s\n' "$raw"
    } > "$OUT/$f"
    DEV_MODEL=$(printf '%s\n' "$raw" | sed -n 1p)
    DEV_REL=$(printf '%s\n'   "$raw" | sed -n 3p)
    DEV_SDK=$(printf '%s\n'   "$raw" | sed -n 4p)
    OK_N=$((OK_N+1)); log "collect $f ... OK"
}

# =====================================================================
# 2) app-version.txt — versionName / 安装时间
# =====================================================================
collect_app_version() {
    local f="app-version.txt" raw
    raw=$(AC shell "dumpsys package $PKG")
    printf '%s\n' "$raw" | grep -E 'versionName|lastUpdateTime|firstInstallTime' \
        > "$OUT/$f" 2>/dev/null
    if [ ! -s "$OUT/$f" ]; then
        skip "$f" "dumpsys package 无版本信息（应用未安装?）"; return
    fi
    APP_VER=$(sed -n 's/.*versionName=//p' "$OUT/$f" | head -1)
    APP_UPD=$(sed -n 's/.*lastUpdateTime=//p' "$OUT/$f" | head -1)
    OK_N=$((OK_N+1)); log "collect $f ... OK"
}

# =====================================================================
# 3) startup-trace.jsonl — 冷启动埋点（App files 下，需 root）
# =====================================================================
collect_startup_trace() {
    local f="startup-trace.jsonl" raw
    if [ "$HAS_ROOT" != "yes" ]; then
        skip "$f" "无 root（需 su 读取应用私有目录 $DEV_FILES）"; return
    fi
    raw=$(ASU "cat $DEV_FILES/startup-trace.jsonl" 2>/dev/null)
    if [ -z "$raw" ]; then
        skip "$f" "设备上无 $DEV_FILES/startup-trace.jsonl 或读取失败"; return
    fi
    printf '%s\n' "$raw" > "$OUT/$f"
    ST_LINES=$(wc -l < "$OUT/$f")
    OK_N=$((OK_N+1)); log "collect $f ... OK（$ST_LINES 条）"
}

# =====================================================================
# 4) vscreen-log.txt — /data/local/tmp/vscreen.log（shell 可读，无需 root）
# =====================================================================
collect_vscreen_log() {
    local f="vscreen-log.txt" raw
    raw=$(ASH cat "$VSCREEN_LOG" 2>/dev/null)
    if [ -z "$raw" ]; then
        skip "$f" "设备上无 $VSCREEN_LOG 或为空"; return
    fi
    printf '%s\n' "$raw" > "$OUT/$f"
    OK_N=$((OK_N+1)); log "collect $f ... OK（$(wc -l < "$OUT/$f") 行）"
}

# =====================================================================
# 5) logcat-app.txt — logcat -d -s DeepSeekHarness（tail 800）
#    为空时允许 am start 把 App 拉前台后重采（只拉前台，不改任何状态）
# =====================================================================
collect_logcat_app() {
    local f="logcat-app.txt" raw n n2
    raw=$(ASH logcat -d -s DeepSeekHarness)
    n=$(printf '%s\n' "$raw" | grep -c "DeepSeekHarness")
    if [ "$n" -eq 0 ]; then
        AM_NOTE=$(AC shell am start -n "$APP_ACT")
        sleep 3
        raw=$(ASH logcat -d -s DeepSeekHarness)
        n2=$(printf '%s\n' "$raw" | grep -c "DeepSeekHarness")
        {
            echo "# [NOTE] 首次 logcat 为空，已执行 am start 拉前台后重采。am start 输出:"
            printf '%s\n' "$AM_NOTE" | sed 's/^/# /'
            [ "$n2" -eq 0 ] && echo "# [NOTE] 重采后仍为空（主缓冲区当前无 DeepSeekHarness 记录，可能已轮转清空）"
            printf '%s\n' "$raw"
        } > "$OUT/$f"
    else
        printf '%s\n' "$raw" > "$OUT/$f"
    fi
    tail -800 "$OUT/$f" > "$OUT/$f.t" && mv "$OUT/$f.t" "$OUT/$f"
    if [ "$n2" -eq 0 ] && [ "$n" -eq 0 ]; then
        log "collect $f ... OK（缓冲区空，已留 NOTE 与 am start 记录）"
        return
    fi
    if [ ! -s "$OUT/$f" ]; then skip "$f" "logcat 采集为空"; return; fi
    OK_N=$((OK_N+1)); log "collect $f ... OK（$(wc -l < "$OUT/$f") 行）"
}

# =====================================================================
# 6) logcat-crash.txt — crash 缓冲区（tail 200）
# =====================================================================
collect_logcat_crash() {
    local f="logcat-crash.txt" raw
    raw=$(ASH logcat -d -b crash)
    if [ -z "$raw" ]; then
        echo "[NOTE] crash 缓冲区为空（无崩溃记录），属正常现象。" > "$OUT/$f"
    else
        printf '%s\n' "$raw" | tail -200 > "$OUT/$f"
    fi
    OK_N=$((OK_N+1)); log "collect $f ... OK（$(wc -l < "$OUT/$f") 行）"
}

# =====================================================================
# 7) power-battery.txt — 电源/唤醒 + 电量/温度/充电
# =====================================================================
collect_power_battery() {
    local f="power-battery.txt"
    {
        echo "# dumpsys power（唤醒/显示相关过滤）"
        AC shell "dumpsys power" | grep -E 'mWakefulness|Display Power|mHoldingDisplaySuspendBlocker'
        echo
        echo "# dumpsys battery"
        AC shell "dumpsys battery"
    } > "$OUT/$f" 2>/dev/null
    if [ ! -s "$OUT/$f" ]; then skip "$f" "dumpsys power/battery 采集失败"; return; fi
    BATTERY_RAW=$(AC shell "dumpsys battery" | tr -d '\r')
    OK_N=$((OK_N+1)); log "collect $f ... OK"
}

# =====================================================================
# 8) display-summary.txt — 显示器概况
# =====================================================================
collect_display_summary() {
    local f="display-summary.txt"
    AC shell "dumpsys display" \
        | grep -E '^  mDisplayId|Display [0-9]+:|mScreenState' | head -40 > "$OUT/$f" 2>/dev/null
    if [ ! -s "$OUT/$f" ]; then skip "$f" "dumpsys display 过滤后无内容"; return; fi
    OK_N=$((OK_N+1)); log "collect $f ... OK"
}

# =====================================================================
# 9) prefs-state.txt — dsh_prefs.xml（需 root；凭据键脱敏为前4位+***）
# =====================================================================
collect_prefs_state() {
    local f="prefs-state.txt" raw
    if [ "$HAS_ROOT" != "yes" ]; then
        skip "$f" "无 root（需 su 读取 $DEV_PREFS）"; return
    fi
    raw=$(ASU "cat $DEV_PREFS" 2>/dev/null)
    if [ -z "$raw" ]; then
        skip "$f" "设备上无 $DEV_PREFS 或读取失败"; return
    fi
    # 提取明文凭据（仅驻留内存，供收尾全包清扫；不落盘）
    TOK=$(printf '%s\n' "$raw" | sed -n 's/.*name="local_token">\([^<]*\)<.*/\1/p')
    CK=$(printf '%s\n'  "$raw" | sed -n 's/.*name="engine_cookie">\([^<]*\)<.*/\1/p')
    # 脱敏: 键名含 token/cookie/secret/password/key → 短值整体打码，长值前4位+***
    {
        echo "# dsh_prefs.xml（已脱敏: 键名含 token/cookie/secret/password/key 的值 → 前4位+***）"
        printf '%s\n' "$raw" \
            | sed -E 's/(name="[^"]*(token|cookie|secret|password|key)[^"]*">)([^<]{1,4})<\/string>/\1***<\/string>/g' \
            | sed -E 's/(name="[^"]*(token|cookie|secret|password|key)[^"]*">)([^<]{4})[^<]*/\1\3***/g'
    } > "$OUT/$f"
    PREFS_N=$(grep -c '<string\|<boolean\|<int\|<long\|<float' "$OUT/$f")
    OK_N=$((OK_N+1)); log "collect $f ... OK（$PREFS_N 项，已脱敏）"
}

# =====================================================================
# 10) plugin-sha.txt — 三方 sha256 并排（repo / devhome / 设备）
# =====================================================================
collect_plugin_sha() {
    local f="plugin-sha.txt" tr="$TMPD/repo.sha" td="$TMPD/devhome.sha" tv="$TMPD/dev.sha"
    : > "$tr"; : > "$td"; : > "$tv"
    local d p
    # 仓库侧 plugins/*/lib/index.js
    for d in "$ROOT_DIR"/plugins/*/; do
        [ -f "$d/lib/index.js" ] || continue
        p=$(basename "$d")
        echo "$p $(sha256sum "$d/lib/index.js" | awk '{print $1}')" >> "$tr"
    done
    # devhome 侧 node_modules/@deepseek-ai/*/lib/index.js
    for d in "$ROOT_DIR"/$DEVHOME_BASE_REL/*/lib/index.js; do
        [ -f "$d" ] || continue
        p=$(basename "$(dirname "$(dirname "$d")")")
        echo "$p $(sha256sum "$d" | awk '{print $1}')" >> "$td"
    done
    # 设备侧（需 root）
    DEV_SHA_NOTE=""
    if [ "$HAS_ROOT" = "yes" ]; then
        ASU "sha256sum $DEV_PLUGIN_BASE/*/lib/index.js" 2>/dev/null \
            | tr -d '\r' | while read -r h path; do
                case "$path" in
                    */@deepseek-ai/*/lib/index.js)
                        pkg=$(printf '%s\n' "$path" | sed -E 's#.*/@deepseek-ai/([^/]+)/lib/index.js#\1#')
                        [ -n "$pkg" ] && echo "$pkg $h" >> "$tv"
                        ;;
                esac
            done
        [ -s "$tv" ] || DEV_SHA_NOTE="（设备侧读取失败）"
    else
        DEV_SHA_NOTE="（无 root，设备侧不可读）"
    fi

    {
        echo "# 三方 sha256 对比 — lib/index.js"
        echo "# repo    = $ROOT_DIR/plugins/<pkg>/lib/index.js"
        echo "# devhome = $ROOT_DIR/$DEVHOME_BASE_REL/<pkg>/lib/index.js"
        echo "# device  = $DEV_PLUGIN_BASE/<pkg>/lib/index.js  $DEV_SHA_NOTE"
        echo "# 状态: MATCH(n/3)=各方一致  MISMATCH=不一致  唯一方=仅一处有该文件"
        echo "#"
        echo "# 格式: <包名> repo=<哈希|-> devhome=<哈希|-> device=<哈希|-> => <状态>"
    } > "$OUT/$f"

    SHA_TOTAL=0; SHA_MATCH=0; SHA_BAD=""
    cat "$tr" "$td" "$tv" | awk '{print $1}' | sort -u > "$TMPD/pkgs"
    local rh dh vh hashes nd np st
    while read -r p; do
        [ -n "$p" ] || continue
        rh=$(awk -v q="$p" '$1==q{print $2; exit}' "$tr")
        dh=$(awk -v q="$p" '$1==q{print $2; exit}' "$td")
        vh=$(awk -v q="$p" '$1==q{print $2; exit}' "$tv")
        hashes=$(printf '%s\n%s\n%s\n' "$rh" "$dh" "$vh" | grep -c '^[0-9a-f]\{64\}$')
        nd=$(printf '%s\n%s\n%s\n' "$rh" "$dh" "$vh" | grep '^[0-9a-f]\{64\}$' | sort -u | wc -l)
        np=$hashes
        if   [ "$np" -eq 0 ]; then st="皆缺(异常)"
        elif [ "$nd" -gt 1 ]; then st="MISMATCH"; SHA_BAD="$SHA_BAD $p"
        elif [ "$np" -ge 2 ]; then st="MATCH($np/3)"
        else st="唯一方(无法对比)"
        fi
        echo "$p repo=${rh:--} devhome=${dh:--} device=${vh:--} => $st" >> "$OUT/$f"
        if [ -n "$vh" ]; then
            SHA_TOTAL=$((SHA_TOTAL+1))
            case "$st" in MATCH*) SHA_MATCH=$((SHA_MATCH+1));; esac
        fi
    done < "$TMPD/pkgs"
    OK_N=$((OK_N+1)); log "collect $f ... OK（设备参与对比 $SHA_TOTAL 包，MATCH $SHA_MATCH）"
}

# =====================================================================
# 全包凭据清扫 + 明文自检（红线）
# =====================================================================
sweep_secrets() {
    local fx
    for fx in "$OUT"/*; do
        [ -f "$fx" ] || continue
        case "$fx" in *.tmp1) continue;; esac
        # 1) 通用形态: dsh-auth-<长串> → 打码
        sed -E 's/dsh-auth-[A-Za-z0-9+\/=._-]{6,}/dsh-auth-[REDACTED]/g' "$fx" > "$fx.tmp1"
        # 2) 精确值: local_token / engine_cookie 全值 → [REDACTED]
        awk -v a="$TOK" -v b="$CK" '
            function rep(s, needle,   i) {
                if (needle == "") return s
                while ((i = index(s, needle)) > 0)
                    s = substr(s, 1, i-1) "[REDACTED]" substr(s, i+length(needle))
                return s
            }
            { print rep(rep($0, a), b) }' "$fx.tmp1" > "$fx"
        rm -f "$fx.tmp1"
    done
}

# =====================================================================
# summary.txt — 10 秒看懂体检结果
# （先写 body 到临时文件 → 过一遍凭据清扫 → 拼上自检行与页脚）
# =====================================================================
write_summary() {
    local f="$TMPD/summary.body" wl vp
    # 电量解析
    local lvl tmp stt
    lvl=$(printf '%s\n' "$BATTERY_RAW" | sed -n 's/.*level: //p' | head -1)
    tmp=$(printf '%s\n' "$BATTERY_RAW" | sed -n 's/.*temperature: //p' | head -1)
    stt=$(printf '%s\n' "$BATTERY_RAW" | sed -n 's/.*status: //p' | head -1)
    [ -n "$tmp" ] && tmp=$(awk -v t="$tmp" 'BEGIN{printf "%.1f", t/10}')
    # wakelock 快照（dsh 相关）——现采现用，随后随 body 一起过清扫
    wl=$(AC shell "dumpsys power" | grep -E 'Wake Locks:|dsh:' | head -6 | tr -d '\r')
    [ -z "$wl" ] && wl="(dumpsys power 中无 Wake Locks/dsh 行)"
    # vscreen 进程
    vp=$(AC shell "ps -A | grep dsh-vscreen" | tr -d '\r' | grep -v grep)
    if [ -n "$vp" ]; then
        VS_STATE="存活: $(printf '%s' "$vp" | head -2 | tr '\n' ' ')"
    else
        VS_STATE="未运行（无 dsh-vscreen 进程）"
    fi
    {
        echo "==================== DeepSeek Harness 诊断包摘要 ===================="
        echo "生成时间: $(date '+%F %T')    采集脚本: tools/diag-bundle.sh"
        echo "设备:     ${DEV_MODEL:-?}（$SERIAL）  Android ${DEV_REL:-?} (SDK ${DEV_SDK:-?})  root=$HAS_ROOT"
        echo "应用:     $PKG ${APP_VER:-?}  lastUpdateTime=${APP_UPD:-?}"
        echo "电池:     ${lvl:-?}% | ${tmp:-?}°C | status=${stt:-?} (2=充电中 3=放电 4=未充电 5=满)"
        echo "-------------------------------------------------------------------"
        echo "[启动] startup-trace.jsonl 最近 3 条（onCreate/payload/spawn/engine/ui/total ms）:"
        if [ -s "$OUT/startup-trace.jsonl" ] && ! head -1 "$OUT/startup-trace.jsonl" | grep -q '^\[SKIP'; then
            tail -3 "$OUT/startup-trace.jsonl" | sed 's/^/    /'
        else
            echo "    （不可得，见对应文件 SKIP 标注）"
        fi
        echo "[wakelock] dumpsys power 中 dsh / Wake Locks 行:"
        printf '%s\n' "$wl" | sed 's/^/    /'
        echo "[vscreen 进程] ps -A | grep dsh-vscreen:"
        echo "    $VS_STATE"
        echo "[vscreen 日志] $VSCREEN_LOG 最后 3 行:"
        if [ -s "$OUT/vscreen-log.txt" ] && ! head -1 "$OUT/vscreen-log.txt" | grep -q '^\[SKIP'; then
            tail -3 "$OUT/vscreen-log.txt" | sed 's/^/    /'
        else
            echo "    （不可得，见对应文件 SKIP 标注）"
        fi
        echo "[插件哈希] 设备侧参与对比 $SHA_TOTAL 包，一致 $SHA_MATCH 包:"
        if [ -n "$SHA_BAD" ]; then
            echo "    MISMATCH:$SHA_BAD"
        else
            echo "    全部一致（或设备侧不可读，见 plugin-sha.txt）"
        fi
        echo "[SKIP 清单]（共 $(grep -c . "$SKIP_LIST" 2>/dev/null) 项）:"
        if [ -s "$SKIP_LIST" ]; then
            while IFS='|' read -r nm rs; do
                [ -n "$nm" ] || continue
                echo "    $nm: $rs"
            done < "$SKIP_LIST"
        else
            echo "    （无）"
        fi
    } > "$f"
}

# 组装最终 summary.txt：body 已清扫 → 算全包明文自检 → 补自检行与页脚
assemble_summary() {
    local f="summary.txt"
    # 1) 已采文件清扫（含即将并入 summary 的内容源）
    sweep_secrets
    # 2) body 本身也过一遍同规则清扫
    sed -E 's/dsh-auth-[A-Za-z0-9+\/=._-]{6,}/dsh-auth-[REDACTED]/g' "$TMPD/summary.body" \
        | awk -v a="$TOK" -v b="$CK" '
            function rep(s, needle,   i) {
                if (needle == "") return s
                while ((i = index(s, needle)) > 0)
                    s = substr(s, 1, i-1) "[REDACTED]" substr(s, i+length(needle))
                return s
            }
            { print rep(rep($0, a), b) }' > "$OUT/$f"
    # 3) 全包明文自检（红线）
    LEAK=0
    local s n
    for s in "$TOK" "$CK"; do
        [ -n "$s" ] || continue
        n=$(grep -r -F -l -- "$s" "$OUT" 2>/dev/null | wc -l)
        LEAK=$((LEAK+n))
    done
    {
        echo "[凭据自检] 全包明文 token/cookie 扫描: $LEAK 处 $([ "$LEAK" -eq 0 ] && echo '（通过）' || echo '（!!! 违规，勿外传此包）')"
        echo "===================================================================="
    } >> "$OUT/$f"
    OK_N=$((OK_N+1)); log "collect $f ... OK"
}

# =====================================================================
# 执行
# =====================================================================
collect_device_info
collect_app_version
collect_startup_trace
collect_vscreen_log
collect_logcat_app
collect_logcat_crash
collect_power_battery
collect_display_summary
collect_prefs_state
collect_plugin_sha

write_summary
assemble_summary

SKIP_N=$(grep -c . "$SKIP_LIST" 2>/dev/null)
SKIP_N=${SKIP_N:-0}
N_FILES=$(ls "$OUT" | grep -c '\.txt$\|\.jsonl$')
log "完成: $OUT"
log "文件 $N_FILES 个（含 summary.txt），成功采集 $OK_N 项，SKIP $SKIP_N 项，凭据明文 $LEAK 处。"

# 清理临时目录
rm -rf "$TMPD"
