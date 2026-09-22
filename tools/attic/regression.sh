#!/usr/bin/env bash
# tools/regression.sh —— DSH 真机回归脚本（批次20 固化，源自批次19 三轮复测判据）
# 用法：设备连 adb、DSH 已装并开启无障碍；sh tools/regression.sh [设备序列号]
# 依赖：adb、curl、python（JSON 解析）；Pixel 等已 root 设备用 su 读 token（无 root 需 TOKEN 环境变量）。
# 输出：逐项 PASS/FAIL/SKIP + 汇总表；任何 FAIL 即退出码 1。
# 覆盖：冷启 / /status 诊断计数 / DocumentsUI 行点击(生效) / 间隙诚实失败 / DSH 页签 text+coord /
#       特权通道对照 / 输入探针。判据细节见 docs/test-flows/regression-checklist.md。
set -u
SERIAL="${1:-}"
ADB="adb"
[ -n "$SERIAL" ] && ADB="adb -s $SERIAL"
TOKEN="${TOKEN:-$($ADB shell "su -c 'cat /data/data/com.deepseek.harness/shared_prefs/dsh_prefs.xml 2>/dev/null'" | grep -o 'local_token">[a-f0-9]*' | head -1 | cut -d'>' -f2)}"
PORT=3181
$ADB forward tcp:$PORT tcp:$PORT >/dev/null
PASS=0; FAIL=0; SKIP=0
note() { printf '%s\n' "$*"; }
result() { # result PASS|FAIL|SKIP "名称" "详情"
  case "$1" in
    PASS) PASS=$((PASS+1));;
    FAIL) FAIL=$((FAIL+1));;
    *)    SKIP=$((SKIP+1));;
  esac
  printf '[%s] %s — %s\n' "$1" "$2" "$3"
}
api() { curl -s -m "${3:-15}" -H "X-DSH-Token: $TOKEN" "http://127.0.0.1:$PORT$1"; }
focus() { $ADB shell "dumpsys window | grep mCurrentFocus" | head -1; }

note "== DSH 真机回归 (token=${TOKEN:+已读取}${TOKEN:-未取到}) =="

# T0 冷启：force-stop → 启动 → /dump 返回包名即就绪
$ADB shell am force-stop com.deepseek.harness >/dev/null 2>&1; sleep 2
T0=$(date +%s%3N); $ADB shell am start -n com.deepseek.harness/.MainActivity >/dev/null 2>&1
COLD=SKIP
for i in $(seq 1 120); do
  R=$(api "/dump" 1 2>/dev/null)
  if echo "$R" | grep -q '"package":"com.deepseek.harness"'; then
    COLD=$(( $(date +%s%3N)-T0 )); break
  fi; sleep 0.25
done
if [ "$COLD" = "SKIP" ]; then result FAIL "T0 冷启就绪" "120×250ms 内 /dump 未就绪"
else
  if [ "$COLD" -le 15000 ]; then result PASS "T0 冷启就绪" "${COLD}ms（基线 730-1000ms，上限 15s）"
  else result FAIL "T0 冷启就绪" "${COLD}ms 超上限"; fi
fi
sleep 3  # WebView 渲染稳定

# T1 /status 诊断计数器
ST=$(api "/status")
if echo "$ST" | grep -q '"clickEvents"'; then result PASS "T1 /status 诊断字段" "$(echo "$ST" | head -c 160)"
else result FAIL "T1 /status 诊断字段" "缺 clickEvents/windowEvents: $ST"; fi

# T2 DocumentsUI 行点击：卡片/行中心 → found:true 且 dump version 递增（原地导航也算生效）
$ADB shell "am start -n com.google.android.documentsui/com.android.documentsui.files.FilesActivity" >/dev/null 2>&1
sleep 2
D0=$(api "/dump")
ROW=$(echo "$D0" | python -c "
import json,sys
d=json.load(sys.stdin)
rows=[(n['x']+n['w']//2,n['y']+n['h']//2) for n in d['nodes'] if n.get('clickable') and n['w']>400 and n['h']>120 and n['y']>700]
print(f'{rows[0][0]} {rows[0][1]}' if rows else '')")
VER0=$(echo "$D0" | python -c "import json,sys;print(json.load(sys.stdin).get('version',''))")
if [ -z "$ROW" ]; then result SKIP "T2 DocumentsUI 行点击" "未找到可点行（列表空？）"
else
  RX=${ROW% *}; RY=${ROW#* }
  RESP=$(api "/tap?x=$RX&y=$RY")
  sleep 1.5
  VER1=$(api "/dump" | python -c "import json,sys;print(json.load(sys.stdin).get('version',''))")
  if echo "$RESP" | grep -q '"found":true' && [ -n "$VER0" ] && [ "$VER0" != "$VER1" ]; then
    result PASS "T2 DocumentsUI 行点击生效" "method=$(echo "$RESP"|python -c 'import json,sys;print(json.load(sys.stdin).get("method","?"))') version $VER0->$VER1"
  else result FAIL "T2 DocumentsUI 行点击生效" "resp=$RESP version: $VER0 -> $VER1"; fi
  $ADB shell input keyevent KEYCODE_BACK >/dev/null; sleep 1.5
fi

# T3 空白区诚实失败：滚到列表底部，取末行下方空隙 → ok:false + INJECT_NO_EFFECT，焦点不变
$ADB shell input swipe 720 2600 720 800 300 >/dev/null 2>&1; sleep 1
GAPY=$(api "/dump" | python -c "
import json,sys
d=json.load(sys.stdin)
bots=[n['y']+n['h'] for n in d['nodes'] if n.get('clickable') and n['w']>400 and n['h']>120]
usable=d['nodes'][0]['y']+d['nodes'][0]['h'] if d['nodes'] else 3000
if not bots: print('')
else:
    bottom=max(bots); gap=bottom+180
    print(gap if gap<usable-120 else '')")
if [ -z "$GAPY" ]; then result SKIP "T3 空白区诚实失败" "末行下方无足够空隙"
else
  F0=$(focus)
  RESP=$(api "/tap?x=720&y=$GAPY")
  F1=$(focus)
  if echo "$RESP" | grep -q 'INJECT_NO_EFFECT' && [ "$F0" = "$F1" ]; then
    result PASS "T3 空白区诚实失败" "y=$GAPY reason=INJECT_NO_EFFECT 焦点不变"
  else result FAIL "T3 空白区诚实失败" "resp=$RESP"; fi
fi

# T4 DSH 页签 text 点击（WebView 抗噪链）：found:true 且 selected 翻转
$ADB shell "am start -n com.deepseek.harness/.MainActivity" >/dev/null 2>&1; sleep 2
TAB=$(api "/dump" | python -c "
import json,sys
d=json.load(sys.stdin)
tabs={str(n.get('text','')):n for n in d['nodes'] if str(n.get('text','')) in ('对话','轨迹')}
idle=[t for t,n in tabs.items() if not n.get('selected')]
print(idle[0] if idle else '')")
if [ -z "$TAB" ]; then result SKIP "T4 DSH 页签切换" "未找到非激活页签"
else
  ENC=$(python -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$TAB")
  RESP=$(api "/tap?text=$ENC" 20)
  sleep 1.5
  SEL=$(api "/dump" | python -c "
import json,sys
d=json.load(sys.stdin)
for n in d['nodes']:
    if str(n.get('text',''))==sys.argv[1]: print(int(bool(n.get('selected')))); break" "$TAB")
  if echo "$RESP" | grep -q '"found":true' && [ "$SEL" = "1" ]; then
    result PASS "T4 DSH 页签切换($TAB)" "method=$(echo "$RESP"|python -c 'import json,sys;print(json.load(sys.stdin).get("method","?"))')"
  else result FAIL "T4 DSH 页签切换($TAB)" "resp=$RESP selected=$SEL"; fi
fi

# T5 特权通道对照（root 机）：su input tap 点非激活页签 → selected 翻转
PTAB=$(api "/dump" | python -c "
import json,sys
d=json.load(sys.stdin)
tabs={str(n.get('text','')):(n,n2) for n in d['nodes'] for n2 in [n] if str(n.get('text','')) in ('对话','轨迹') and not n.get('selected')}
for t,(n,_) in tabs.items(): print(t, n['x']+n['w']//2, n['y']+n['h']//2); break" 2>/dev/null)
if [ -z "$PTAB" ]; then result SKIP "T5 特权通道对照" "无非激活页签"
else
  PNAME=$(echo "$PTAB" | cut -d' ' -f1); PX=$(echo "$PTAB" | cut -d' ' -f2); PY=$(echo "$PTAB" | cut -d' ' -f3)
  $ADB shell "su -c 'input -d 0 tap $PX $PY'" >/dev/null 2>&1
  sleep 1.5
  SEL=$(api "/dump" | python -c "
import json,sys
d=json.load(sys.stdin)
for n in d['nodes']:
    if str(n.get('text',''))==sys.argv[1]: print(int(bool(n.get('selected')))); break" "$PNAME")
  if [ "$SEL" = "1" ]; then result PASS "T5 特权通道对照($PNAME)" "su input tap 生效"
  else result FAIL "T5 特权通道对照($PNAME)" "selected=$SEL"; fi
fi

# T6 输入探针
IR=$(api "/input?verifyOnly=1&text=probe")
if echo "$IR" | grep -q '"ok":true'; then result PASS "T6 /input 探针" "$(echo "$IR" | head -c 120)"
else result FAIL "T6 /input 探针" "$IR"; fi

# T7 无 token 必须被拒（fail-closed，批次20）
NOTOK=$(curl -s -m 5 "http://127.0.0.1:$PORT/status")
if echo "$NOTOK" | grep -q 'unauthorized'; then result PASS "T7 无 token 401" "fail-closed 生效"
else result FAIL "T7 无 token 401" "resp=$NOTOK"; fi

note "=============================="
note "汇总: PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" -eq 0 ]
