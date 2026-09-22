#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次67「托管引擎」—— 真机端到端验证脚手架（只取证 + 判定，不做任何修复动作）。

被测契约（冻结，见工单）
----------------------
引擎由 Shizuku（shell uid=2000）托管、**脱离 App 进程树**：App 被杀 / 被覆盖安装都不影响它；
只有 Shizuku 不可用时才回落成 App 内引擎。六个阶段分别验证：
  hosted-boot  拉起 App → 引擎由 shell 托管（PPID=1）+ 3080 LISTEN + 关键文件齐备
  force-stop   am force-stop App → 引擎 pid 不变；再拉起 → reused（不重复 spawn）
  reinstall    adb install -r → 引擎 pid 不变；再拉起 → reused
  watchdog     kill -9 引擎 → ≤150s 内看门狗拉起**新 pid** + 3080 恢复（全程 App 不在前台）
  fallback     停 Shizuku → App 内引擎回落（3080 以 App uid 监听）+ 尝试恢复 Shizuku
  cleanup      hosted stop（无 dshroot 残留）→ hosted cleanup（/data/local/tmp/dsh 消失、DSH_HOME 保留）

用法
----
    python tools/e2e_batch67_residency.py --help
    python tools/e2e_batch67_residency.py hosted-boot
    python tools/e2e_batch67_residency.py force-stop
    python tools/e2e_batch67_residency.py reinstall --apk .local/b47_out/DeepSeekHarness-b47.apk
    python tools/e2e_batch67_residency.py watchdog --watchdog-timeout 150
    python tools/e2e_batch67_residency.py fallback
    python tools/e2e_batch67_residency.py cleanup
    python tools/e2e_batch67_residency.py all
    python tools/e2e_batch67_residency.py selftest      # 只读：管道自检，不改设备状态

前置条件（脚本不替你补，缺一条先修环境）
--------------------------------------
1. 真机已连接：序列号自动检测（优先 $ANDROID_SERIAL，其次 adb devices 里第一个 device 状态）。
2. 设备上装的是批次67 产物：默认 .local/b47_out/DeepSeekHarness-b47.apk（reinstall 阶段要用）。
3. Shizuku 已激活（hosted-boot 前提；fallback 阶段会**故意**把它停掉）。
4. 阶段顺序建议 hosted-boot → force-stop → reinstall → watchdog → fallback → cleanup。
   单独跑某阶段时基线会从设备实时重取（engine.pid / ps / /proc/net/tcp），
   跨阶段上下文额外落到 .local/b67_evidence/b67_state.json（可用 --out-dir 改目录）。

结构
----
* 基础设施：adb / adb_shell / fetch_ps / listen_state / read_pid_file / remote_size /
  remote_exists / launch_app / logcat_clear / LogCollector（设备侧 grep '[b67'）。
* 判据：每个判据一个 check_<阶段>_<判据>() 小函数，返回 (name, status, detail)；
  阶段函数只负责取数 + rep.add(*check_xxx(...))，保证「一判据一行」。
* 证据：Report 收集判据行与 ps / /proc/net/tcp / logcat / engine.log 摘录，统一脱敏后写入报告。
* 状态：PASS / FAIL / INFO / MANUAL 四种；MANUAL = 需要人工处理的步骤，不计入退出码。

安全红线
--------
* **绝不打印引擎 token**：logs/engine.log 里含 ?token=<32hex>，本脚本所有输出出口
  （stdout + 报告文件）统一过 redact()：token=<值> → token=[redacted]，
  另外把任何 32 位 hex 串兜底打成 <TOKEN>；报告落盘前还会再做一次泄漏扫描。
* 设备写操作只有工单列出的这些：logcat -G/-c（取证缓冲）、am start（App 的四个入口）、
  am force-stop（App / Shizuku）、install -r（APK）、kill -9（引擎 pid，watchdog 阶段有意制造真死），
  以及**可选**开关（默认关闭）：--stop-shizuku-server（额外停掉 shell uid 的 shizuku_server）、
  --fallback-kill-engine（fallback 前先 kill -9 托管引擎，强制走回落）。
  不执行 adb root / settings put / appops set / 卸载 / 清数据。

与工单的两处显式偏差（判据名与报告都会写明）
------------------------------------------
1. 进程识别没有真的跑 ps -A -o PID,PPID,USER,NAME | grep -E 'dsh/dshroot'：改为取
   ps -A -o PID,PPID,USER,NAME,ARGS 后在 Python 侧做等价过滤（toybox ps 的 NAME 列会被截断，
   只有 ARGS 列能看到完整路径 /data/local/tmp/dsh/dshroot），顺带避开 adb shell 的引号/管道问题。
2. hosted-boot 阶段「等 hosted engine ready」在**幂等重跑**时会走 reused 分支（引擎已在托管中），
   因此等待条件放宽为 ready|reused；命中 reused 时判据详情会写明走的是复用路径。
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import time

# =============================================================================================
# 常量与全局配置
# =============================================================================================

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT_DIR = os.path.join(REPO_ROOT, '.local', 'b67_evidence')
DEFAULT_APK = os.path.join(REPO_ROOT, '.local', 'b47_out', 'DeepSeekHarness-b47.apk')

APP_PKG = 'com.deepseek.harness'
APP_ACTIVITY = 'com.deepseek.harness/.MainActivity'
SHIZUKU_PKG = 'moe.shizuku.privileged.api'
SHIZUKU_START_SH = '/storage/emulated/0/Android/data/moe.shizuku.privileged.api/start.sh'

DSH_DIR = '/data/local/tmp/dsh'                      # 托管引擎私有目录（cleanup 阶段应被删除）
ENGINE_PID_FILE = DSH_DIR + '/engine.pid'
WATCHDOG_PID_FILE = DSH_DIR + '/watchdog.pid'
STAMP_FILE = DSH_DIR + '/.stamp'
WATCHDOG_STATE_FILE = DSH_DIR + '/watchdog.state'
ENGINE_LOG_FILE = DSH_DIR + '/logs/engine.log'        # 含 ?token=<32hex>，读它必须打码
DSH_HOME = '/sdcard/DeepSeekHarness/home'             # DSH_HOME（cleanup 阶段应保留）

ENGINE_PORT = 3080
ENGINE_PORT_HEX = '%04X' % ENGINE_PORT               # 3080 -> 0C08
LOOPBACK_HEX = '0100007F'                            # 127.0.0.1（/proc/net/tcp 的小端表示）
V4MAPPED_PREFIX = '0000000000000000FFFF0000'         # /proc/net/tcp6 里 v4 映射地址前缀
LISTEN_ST = '0A'                                     # /proc/net/tcp 状态列：LISTEN
SHELL_UID = 2000                                     # shell（Shizuku 通道）
APP_UID_MIN = 10000                                  # u0_a*（App 域）

DEFAULT_POLL_SECONDS = 5.0
DEFAULT_BOOT_TIMEOUT = 180.0                         # 等 ready/reused 标记
DEFAULT_WATCHDOG_TIMEOUT = 150.0                     # 等看门狗拉起新引擎
DEFAULT_FORCE_STOP_WAIT = 5.0                        # force-stop 后静置（工单要求 5s）
DEFAULT_CLEANUP_TIMEOUT = 60.0                       # 收尾轮询窗口
DEFAULT_LISTEN_TIMEOUT = 60.0                        # 等 3080 恢复 LISTEN
INSTALL_TIMEOUT = 300.0                              # adb install -r
MARKER_EXTRA_TIMEOUT = 45.0                          # staged / watchdog started 等可能晚到的标记

# App 侧 logcat 标记（批次67 契约）
MARK_READY = '[b67] hosted engine ready uid=2000 pid='
MARK_REUSED = '[b67] hosted engine reused pid='
MARK_STAGED = '[b67] hosted staged fp='
MARK_WATCHDOG = '[b67] watchdog started pid='
MARK_FALLBACK = '[b67] fallback to in-app engine (reason='
MARK_STOP = '[b67] hosted stop -> engine killed pid='
MARK_CLEANUP = '[b67] hosted cleanup done'
LOG_NEEDLE = '[b67'                                  # 设备侧 grep 的固定串

PID_RE = re.compile(r'pid=(\d+)')
TOKEN_KV_RE = re.compile(r'(?i)((?:x-dsh-)?token\s*[:=]\s*["\']?)([A-Za-z0-9_=+~./-]{8,})')
TOKEN_HEX_RE = re.compile(r'[0-9a-fA-F]{32}')
LEAK_RE = re.compile(r'(?i)token\s*[:=]\s*["\']?(?![\[<])[A-Za-z0-9_=+~./-]{8,}')
FENCE = chr(96) * 3                                  # markdown 围栏（避免源码里出现反引号）

# 运行期由 main() 赋值
SERIAL = ''
SERIAL_SOURCE = ''
POLL_SECONDS = DEFAULT_POLL_SECONDS
OUT_DIR = DEFAULT_OUT_DIR
APK_PATH = DEFAULT_APK
RELAX_TCP6 = False
DEVICE_INFO = ''
AM_START_EVENTS = []                                 # [(epoch, 说明)]：证明某些阶段「没有启动 App」


# =============================================================================================
# 输出安全与文本工具
# =============================================================================================

def redact(text):
    """脱敏：token=<值> → token=[redacted]，任何 32 位 hex 串 → <TOKEN>。

    token 明文绝不能出现在 stdout 或报告里；本脚本所有输出出口都必须先过这里。
    """
    if text is None:
        return ''
    s = str(text)
    s = TOKEN_KV_RE.sub(r'\1[redacted]', s)
    s = TOKEN_HEX_RE.sub('<TOKEN>', s)
    return s


def leak_scan(text):
    """落盘前兜底扫描：还有没有未打码的 token= / token: 片段。"""
    return bool(LEAK_RE.search(text or ''))


def compact(obj):
    """把 dict/list 压成单行 JSON 摘录（用于判据行）。"""
    if obj is None:
        return 'null'
    try:
        return json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        return str(obj)


def oneline(text):
    """多行文本压成单行（判据行必须一行）。"""
    return ' '.join(str(text).split())


def now_str():
    return datetime.datetime.now().strftime('%H:%M:%S')


def fmt_epoch(epoch):
    if epoch is None:
        return '(未知)'
    try:
        return datetime.datetime.fromtimestamp(float(epoch)).strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        return str(epoch)


def iso_now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# =============================================================================================
# 判据收集 / 报告落盘
# =============================================================================================

class Report(object):
    """判据结果 + 原始证据收集；落盘前统一脱敏 + 泄漏扫描。"""

    STATUSES = ('PASS', 'FAIL', 'INFO', 'MANUAL')

    def __init__(self, phase):
        self.phase = phase
        self.rows = []       # [(name, status, detail)]
        self.sections = []   # [(title, body_text)]
        self.notes = []      # 报告尾部的放宽 / 注意事项
        self.started = datetime.datetime.now(datetime.timezone.utc)

    # ---- 判据输出（PASS/FAIL/INFO/MANUAL  <判据名>  <证据摘要>）----
    def add(self, name, status, detail):
        status = str(status).upper()
        if status not in self.STATUSES:
            status = 'INFO'
        detail = oneline(redact(detail))
        print('%s  %s  %s' % (status, name, detail), flush=True)
        self.rows.append((name, status, detail))

    def pass_(self, name, detail):
        self.add(name, 'PASS', detail)

    def fail(self, name, detail):
        self.add(name, 'FAIL', detail)

    def info(self, name, detail):
        self.add(name, 'INFO', detail)

    def manual(self, name, detail):
        self.add(name, 'MANUAL', detail)

    def note(self, text):
        self.notes.append(oneline(redact(text)))

    # ---- 原始证据摘录 ----
    def excerpt(self, title, body):
        if body is None:
            body = '(空)'
        if not isinstance(body, str):
            body = json.dumps(body, ensure_ascii=False, indent=2, default=str)
        self.sections.append((title, redact(body)))

    def counts(self):
        n = {k: 0 for k in self.STATUSES}
        for _name, status, _detail in self.rows:
            n[status] = n.get(status, 0) + 1
        return n

    def save(self, path):
        """写 markdown 报告：头部元信息 + 判据表 + 原始证据摘录 + 放宽说明。"""
        n = self.counts()
        out = []
        out.append('# 批次67 托管引擎（Shizuku 拉起 / 脱离 App 进程树）—— 真机 e2e 验证报告')
        out.append('')
        out.append('- UTC 开始: %s' % self.started.strftime('%Y-%m-%dT%H:%M:%SZ'))
        out.append('- UTC 结束: %s' % iso_now())
        out.append('- 设备序列号: %s（来源: %s）' % (SERIAL, SERIAL_SOURCE))
        out.append('- 设备信息: %s' % DEVICE_INFO)
        out.append('- 阶段: %s（poll_seconds=%s）' % (self.phase, POLL_SECONDS))
        out.append('- APK: %s' % APK_PATH)
        out.append('- 汇总: PASS %d / FAIL %d / INFO %d / MANUAL %d'
                   % (n.get('PASS', 0), n.get('FAIL', 0), n.get('INFO', 0), n.get('MANUAL', 0)))
        out.append('- 结论: %s' % ('PASS（无 FAIL）' if n.get('FAIL', 0) == 0 else 'FAIL（见下 FAIL 行）'))
        out.append('- 脱敏: 所有输出出口统一打码成 token=[redacted]，engine.log 摘录同样已处理')
        out.append('')
        out.append('## 判据结果')
        out.append('')
        out.append('| 状态 | 判据 | 证据摘要 |')
        out.append('|---|---|---|')
        for name, status, detail in self.rows:
            out.append('| %s | %s | %s |' % (status, name, detail.replace('|', '/')))
        out.append('')
        out.append('## 原始证据摘录')
        for title, body in self.sections:
            out.append('')
            out.append('### %s' % title)
            out.append('')
            out.append(FENCE + 'text')
            out.append(body)
            out.append(FENCE)
        if self.notes:
            out.append('')
            out.append('## 放宽 / 注意事项')
            for note in self.notes:
                out.append('- %s' % note)
        out.append('')

        body = redact('\n'.join(out))
        if leak_scan(body):                   # 理论上到不了这里；到了就强制再打码一次并告警
            body = TOKEN_KV_RE.sub(lambda m: m.group(1) + '[redacted]', body)
            body += '\n\n### 脱敏告警\n\n落盘前扫描到未打码的 token= 片段，已强制打码为 token=[redacted]。\n'
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(body)
            return True
        except Exception as exc:
            print('INFO  report.write  ERROR: 报告落盘失败: %s' % exc, flush=True)
            return False


# =============================================================================================
# adb 与设备侧基础能力（全部走 subprocess 列表参数，避开 PowerShell / adb shell 的引号地狱）
# =============================================================================================

def adb(args, timeout=30):
    """执行 adb [-s <serial>] <args...>；返回 (rc, 文本)。永不抛异常。"""
    cmd = ['adb'] + (['-s', SERIAL] if SERIAL else []) + [str(a) for a in args]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
        raw = (proc.stdout or b'') + (proc.stderr or b'')
        return proc.returncode, redact(raw.decode('utf-8', 'replace')).strip()
    except subprocess.TimeoutExpired:
        return 124, 'ERROR: adb 超时(%ss): adb %s' % (timeout, ' '.join(cmd[1:]))
    except FileNotFoundError:
        return 127, 'ERROR: 找不到 adb（请把 platform-tools 加进 PATH）'
    except Exception as exc:
        return -1, 'ERROR: %s: %s' % (type(exc).__name__, exc)


def adb_shell(cmd, timeout=30):
    return adb(['shell', cmd], timeout=timeout)


def resolve_serial(cli_serial):
    """序列号解析：--serial > $ANDROID_SERIAL > adb devices 第一个 device。返回 (serial, 来源|错误)。"""
    if cli_serial:
        return cli_serial, 'cli:--serial'
    env = (os.environ.get('ANDROID_SERIAL') or '').strip()
    if env:
        return env, 'env:ANDROID_SERIAL'
    try:
        proc = subprocess.run(['adb', 'devices'], capture_output=True, timeout=20)
    except FileNotFoundError:
        return None, 'ERROR: 找不到 adb（请把 platform-tools 加进 PATH）'
    except Exception as exc:
        return None, 'ERROR: %s: %s' % (type(exc).__name__, exc)
    out = (proc.stdout or b'').decode('utf-8', 'replace')
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == 'device':
            return parts[0], 'auto:adb devices 第一个 device'
    return None, 'ERROR: adb devices 里没有 device 状态的设备:\n%s' % out.strip()


def launch_app():
    """App 启动命令（工单给定）：拉起 MainActivity 并触发引擎启动。返回 (ok, detail)。"""
    rc, out = adb(['shell', 'am', 'start', '-n', APP_ACTIVITY, '--ez', 'action_launch_engine', 'true',
                   '--ez', 'silent', 'true'], timeout=60)
    AM_START_EVENTS.append((time.time(), 'launch_engine'))
    bad = ('Error' in out) or ('ERROR:' in out)
    return (rc == 0 and not bad), 'am start … action_launch_engine rc=%s %s' % (rc, oneline(out) or '(空)')


def am_start_action(extra_key, label):
    """触发 MainActivity 的托管入口（hosted stop / hosted cleanup）。返回 (rc, out, detail)。"""
    rc, out = adb(['shell', 'am', 'start', '-n', APP_ACTIVITY, '--ez', extra_key, 'true'], timeout=60)
    AM_START_EVENTS.append((time.time(), label))
    return rc, out, 'am start … %s rc=%s %s' % (extra_key, rc, oneline(out) or '(空)')


def logcat_buffer_bump():
    """取证前扩大环形缓冲（本机缓冲很小，关键行几秒即滚动）。"""
    return adb_shell('logcat -G 8M', timeout=25)


def logcat_clear():
    return adb_shell('logcat -c', timeout=25)


class LogCollector(object):
    """按轮次抓取 App 侧 [b67 相关行（设备侧 grep，避免整份几十 MB 缓冲回传）。

    逐轮去重、保持首次出现顺序；轮次之间的新增行会被累积，便于阶段末统一出证据。
    """

    def __init__(self, needle=LOG_NEEDLE):
        self.needle = needle
        self.lines = []
        self._seen = set()
        self.polls = 0
        self.last_rc = None
        self.last_out = ''

    def poll(self):
        self.polls += 1
        cmd = "logcat -d -v time | grep -F '%s'" % self.needle
        rc, out = adb_shell(cmd, timeout=30)
        self.last_rc, self.last_out = rc, out
        if rc not in (0, 1) and ('ERROR' in out or 'not found' in out):
            return self.lines
        for line in out.splitlines():
            line = line.rstrip()
            if not line or line in self._seen:
                continue
            self._seen.add(line)
            self.lines.append(line)
        return self.lines

    def has(self, *needles):
        return any(any(n in ln for n in needles) for ln in self.lines)

    def match(self, *needles):
        return [ln for ln in self.lines if any(n in ln for n in needles)]

    def dump(self, limit=300):
        if not self.lines:
            return '(窗口内无 [b67] 行；设备侧 grep rc=%s)' % self.last_rc
        return '\n'.join(self.lines[-limit:])


def wait_marker(logs, needles, timeout):
    """轮询等待任一标记出现；返回命中的最后一行，超时返回 None。"""
    deadline = time.time() + max(0.0, timeout)
    while True:
        logs.poll()
        hits = logs.match(*needles)
        if hits:
            return hits[-1]
        if time.time() >= deadline:
            return None
        time.sleep(min(POLL_SECONDS, max(0.3, deadline - time.time())))


def wait_until(predicate, timeout, interval=None):
    """轮询等待谓词为真；返回 True/False。谓词异常一律吞掉（取证不能崩）。"""
    interval = POLL_SECONDS if interval is None else interval
    deadline = time.time() + max(0.0, timeout)
    while True:
        try:
            if predicate():
                return True
        except Exception:
            pass
        if time.time() >= deadline:
            return False
        time.sleep(min(max(0.3, interval), max(0.3, deadline - time.time())))


def sleep_until(deadline, chunk=None):
    """分段睡眠到指定时刻（长窗口下便于日志滚动采集）。"""
    chunk = POLL_SECONDS if chunk is None else chunk
    while True:
        remain = deadline - time.time()
        if remain <= 0:
            return
        time.sleep(min(chunk, remain))


def pid_from_marker(line, marker=MARK_REUSED):
    """从 'hosted engine ready uid=2000 pid=1234' / 'reused pid=1234' 里取 pid。"""
    if not line:
        return None
    idx = line.find(marker)
    tail = line[idx + len(marker):] if idx >= 0 else line
    m = re.match(r'\s*(\d+)', tail)
    if m:
        return int(m.group(1))
    m2 = PID_RE.search(line)
    return int(m2.group(1)) if m2 else None


# =============================================================================================
# 设备侧探针：进程表 / 端口 / 关键文件
# =============================================================================================

def parse_ps_columns(out):
    """解析 ps -A -o PID,PPID,USER,NAME,ARGS：PID PPID USER NAME ARGS…"""
    rows = []
    for line in out.splitlines():
        if not line.strip() or line.strip().upper().startswith('PID'):
            continue
        parts = line.split(None, 4)
        if len(parts) < 4 or not parts[0].isdigit():
            continue
        rows.append({'pid': int(parts[0]), 'ppid': parts[1], 'user': parts[2], 'name': parts[3],
                     'args': parts[4] if len(parts) > 4 else parts[3]})
    return rows


def parse_ps_default(out):
    """兜底解析 ps -A（USER PID PPID … S NAME）—— 某些 ROM 不支持 -o。"""
    rows = []
    for line in out.splitlines():
        if not line.strip() or line.strip().upper().startswith('USER'):
            continue
        parts = line.split()
        if len(parts) < 3 or not parts[1].isdigit():
            continue
        name = parts[8] if len(parts) > 8 else parts[-1]
        rows.append({'pid': int(parts[1]), 'ppid': parts[2], 'user': parts[0], 'name': name,
                     'args': ' '.join(parts[8:]) if len(parts) > 8 else name})
    return rows


def fetch_ps():
    """返回 (rc, rows, ps 原文, 解析模式)。"""
    rc, out = adb_shell('ps -A -o PID,PPID,USER,NAME,ARGS', timeout=25)
    rows = parse_ps_columns(out)
    mode = 'ps -A -o PID,PPID,USER,NAME,ARGS'
    if not rows:
        rc2, out2 = adb_shell('ps -A', timeout=25)
        rows2 = parse_ps_default(out2)
        if rows2:
            return rc2, rows2, out2, 'ps -A（-o 不可用的兜底解析）'
        return rc, rows, out, mode + '（解析失败）'
    return rc, rows, out, mode


def engine_kind(row):
    """识别引擎进程：等价于契约里的 grep -E 'dsh/dshroot'，但基于 ARGS 列。

    返回 'hosted' / 'inapp' / 'unknown' / None（非引擎进程）。
    """
    blob = '%s %s' % (row.get('name') or '', row.get('args') or '')
    if 'dshroot' not in blob and 'lib/bin.js' not in blob:
        return None
    low = blob.lower()
    if 'grep' in low or 'ps -a' in low or 'ps -o' in low:
        return None
    if DSH_DIR in blob:                                   # /data/local/tmp/dsh/... = 托管路径
        return 'hosted'
    if '/payload/' in blob:                               # App 私有目录里的 payload = App 内引擎
        return 'inapp'
    if row.get('user') == 'shell':
        return 'hosted'
    if (row.get('user') or '').startswith('u0_a'):
        return 'inapp'
    return 'unknown'


def engine_rows(rows):
    out = []
    for row in rows:
        kind = engine_kind(row)
        if kind:
            item = dict(row)
            item['kind'] = kind
            out.append(item)
    return out


def app_pid_of(rows):
    """App 进程 pid（comm=包名；引擎子进程 ARGS 里也含包名，所以只认 name / ARGS 起始匹配）。"""
    for row in rows:
        if row.get('name') == APP_PKG or (row.get('args') or '').startswith(APP_PKG):
            return row['pid']
    return None


def find_row(rows, pid):
    for row in rows:
        if row['pid'] == pid:
            return row
    return None


def engine_procs_brief(engines):
    if not engines:
        return ''
    return '; '.join('pid=%s/user=%s/ppid=%s/kind=%s'
                     % (r['pid'], r.get('user'), r.get('ppid'), r.get('kind')) for r in engines)


def ps_brief(snap, limit=12):
    """ps 证据摘录：表头 + 引擎行 + App 行（全文太吵）。"""
    lines = []
    lines.append('解析模式: %s（rc=%s，解析到 %d 行）'
                 % (snap.get('ps_mode'), snap.get('ps_rc'), len(snap.get('rows') or [])))
    lines.append('PID   PPID  USER       NAME                          ARGS')
    picked = list(snap.get('engines') or [])
    app_pid = snap.get('app_pid')
    if app_pid:
        app_row = find_row(snap.get('rows') or [], app_pid)
        if app_row:
            picked.append(app_row)
    if not picked:
        lines.append('(没有 dshroot / App 进程命中)')
    for row in picked[:limit]:
        lines.append('%s  %s  %s  %s  %s'
                     % (row['pid'], row.get('ppid'), row.get('user'), row.get('name'),
                        (row.get('args') or '')[:200]))
    return '\n'.join(lines)


def proc_uid_numeric(pid):
    """读 pid 的属主 uid 数字（ps 的 USER 列只是名字，这里拿数字做硬证据）。

    优先 stat -c %u（干净，App uid 也读得到）；兜底解析 ls -ln /proc/<pid>。
    注意 ls 会因为 /proc/<pid>/cwd 之类权限不足而返回非 0，所以不能拿 rc 当判据。
    """
    rc, out = adb_shell('stat -c %u /proc/' + str(pid), timeout=15)
    if rc == 0 and out.strip().isdigit():
        return int(out.strip())
    _rc2, out2 = adb_shell('ls -ln /proc/%d' % pid, timeout=15)
    dirs = []
    others = []
    for line in out2.splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[2].isdigit():
            if parts[0][:1] == 'd':
                dirs.append(int(parts[2]))
            elif parts[0][:1] == '-':
                others.append(int(parts[2]))
    if dirs:
        return dirs[0]
    if others:
        return others[0]
    return None


def proc_start_epoch(pid):
    """引擎启动时刻：/proc/<pid>/stat 第22字段（starttime，单位 tick）+ /proc/uptime 换算。

    返回 (epoch|None, 说明)。用于证明「pid 没变就是同一个进程」「新 pid 真的是新起的」。
    """
    rc1, stat = adb_shell('cat /proc/%d/stat' % pid, timeout=15)
    rc2, up = adb_shell('cat /proc/uptime', timeout=15)
    if rc1 != 0 or rc2 != 0:
        return None, 'rc=%s/%s %s' % (rc1, rc2, oneline(stat)[:120])
    try:
        close = stat.rindex(')')
        fields = stat[close + 2:].split()      # fields[0] = state（原第3字段）
        ticks = int(fields[19])                # 原第22字段 = starttime
        uptime = float(up.split()[0])
        clk = 100
        try:
            clk = int(os.sysconf('SC_CLK_TCK'))
        except Exception:
            clk = 100
        return time.time() - (uptime - ticks / float(clk)), 'starttime=%s ticks（clk=%s）' % (ticks, clk)
    except Exception as exc:
        return None, '解析失败: %s: %s' % (type(exc).__name__, exc)


def listen_state():
    """读 /proc/net/tcp(/tcp6)：3080 是否 LISTEN、socket 属主 uid。"""
    rc, tcp = adb_shell('cat /proc/net/tcp', timeout=20)
    rc6, tcp6 = adb_shell('cat /proc/net/tcp6', timeout=20)
    tcp_lines = [ln for ln in tcp.splitlines() if ln.strip()]
    want = LOOPBACK_HEX + ':' + ENGINE_PORT_HEX
    hit = None
    for ln in tcp_lines:
        parts = ln.split()
        if len(parts) < 8:
            continue
        if parts[1].upper() == want and parts[3].upper() == LISTEN_ST:
            hit = parts
            break
    hit6 = None
    for ln in tcp6.splitlines():
        parts = ln.split()
        if len(parts) < 8:
            continue
        local = parts[1].upper()
        if local.endswith(':' + ENGINE_PORT_HEX) and local.startswith(V4MAPPED_PREFIX + LOOPBACK_HEX) \
                and parts[3].upper() == LISTEN_ST:
            hit6 = parts
            break

    def _uid(fields):
        try:
            return int(fields[7])
        except Exception:
            return None

    tcp6_lines = [x for x in tcp6.splitlines() if x.strip()]
    ev = ['/proc/net/tcp 行数=%d（rc=%s）；/proc/net/tcp6 行数=%d（rc=%s）'
          % (len(tcp_lines), rc, len(tcp6_lines), rc6)]
    ev.append('tcp 命中: %s' % ' '.join(hit[:9]) if hit else 'tcp 未命中 %s st=%s' % (want, LISTEN_ST))
    ev.append('tcp6 命中: %s' % ' '.join(hit6[:9]) if hit6 else 'tcp6 未命中 v4 映射 :%s' % ENGINE_PORT_HEX)
    for ln in [x.strip() for x in tcp_lines if (':' + ENGINE_PORT_HEX) in x.upper()][:3]:
        ev.append('tcp 含该端口行: %s' % ln)
    return {'tcp_listen': hit is not None, 'tcp_uid': _uid(hit) if hit else None,
            'tcp6_listen': hit6 is not None, 'tcp6_uid': _uid(hit6) if hit6 else None,
            'tcp_lines': len(tcp_lines), 'rc': rc, 'rc6': rc6, 'evidence': '\n'.join(ev)}


def engine_snapshot():
    """一次采集：ps 引擎行 + engine.pid + 监听状态 + App pid。"""
    rc, rows, _raw, mode = fetch_ps()
    pid_pid, pid_raw, pid_err = read_pid_file(ENGINE_PID_FILE)
    return {'ps_rc': rc, 'ps_mode': mode, 'rows': rows, 'engines': engine_rows(rows),
            'app_pid': app_pid_of(rows), 'pid_file_pid': pid_pid, 'pid_raw': pid_raw, 'pid_err': pid_err,
            'listen': listen_state()}


def resolve_engine_pid(snap):
    """引擎 pid：优先 engine.pid 且能被 ps 证实；否则退到 ps 里的托管行 / 任意引擎行。"""
    engines = snap.get('engines') or []
    file_pid = snap.get('pid_file_pid')
    if file_pid is not None and any(r['pid'] == file_pid for r in engines):
        return file_pid, 'engine.pid（ps 已证实）'
    hosted = [r for r in engines if r.get('kind') == 'hosted']
    pool = hosted or engines
    if pool:
        return pool[0]['pid'], 'ps（engine.pid 不可用: %s）' % (snap.get('pid_err') or '未写入')
    if file_pid is not None:
        return file_pid, 'engine.pid（ps 里没有该进程 —— 可能已退出）'
    return None, None


def read_pid_file(path):
    """读 pid 文件；返回 (pid|None, 原文, 错误说明)。文件不存在 → 明确原因，不抛栈。"""
    rc, out = adb_shell('cat %s' % path, timeout=20)
    raw = out.strip()
    if out.startswith('ERROR:'):
        return None, raw, out
    if rc != 0 or 'No such file' in out or 'Permission denied' in out:
        return None, raw, '不可读（rc=%s: %s）' % (rc, oneline(raw) or '空')
    m = re.search(r'\d+', raw)
    if not m:
        return None, raw, '内容里没有 pid 数字（原文=%s）' % (oneline(raw) or '空')
    return int(m.group(0)), raw, None


def read_file_text(path):
    rc, out = adb_shell('cat %s' % path, timeout=20)
    if rc != 0 or 'No such file' in out:
        return None, 'rc=%s %s' % (rc, oneline(out) or '(空)')
    return out, None


def remote_exists(path):
    """路径是否存在（ls -d）；返回 (ok, rc, 输出)。"""
    rc, out = adb_shell('ls -d %s' % path, timeout=20)
    if out.startswith('ERROR:'):
        return False, rc, out
    ok = (rc == 0) and ('No such file' not in out) and ('Not a directory' not in out)
    return ok, rc, out


def remote_size(path):
    """文件字节数：stat -c %s 优先，ls -ln 兜底；拿不到返回 None。"""
    rc, out = adb_shell('stat -c %s ' + path, timeout=20)
    if rc == 0 and out.strip().isdigit():
        return int(out.strip())
    rc2, out2 = adb_shell('ls -ln ' + path, timeout=20)
    if rc2 == 0:
        for line in out2.splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[0][:1] == '-':
                try:
                    return int(parts[4])
                except ValueError:
                    return None
    return None


def tail_engine_log(lines=20):
    """engine.log 末尾若干行（含 ?token=<32hex>，返回前已打码）。"""
    rc, out = adb_shell('tail -n %d %s' % (lines, ENGINE_LOG_FILE), timeout=20)
    if rc != 0 or 'No such file' in out:
        return '(engine.log 不可读 rc=%s: %s)' % (rc, oneline(out) or '空')
    return redact(out)


def shizuku_rows():
    """所有跟 Shizuku 有关的进程行（含 shell uid 的 shizuku_server 与管理器 App）。"""
    _rc, rows, _raw, _mode = fetch_ps()
    out = []
    for row in rows:
        blob = ('%s %s' % (row.get('name') or '', row.get('args') or '')).lower()
        if 'shizuku' in blob and 'grep' not in blob:
            out.append(row)
    return out


def foreground_probe():
    """当前前台窗口（watchdog 阶段「App 不在前台」的旁证）。"""
    rc, out = adb_shell("dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | head -2", timeout=25)
    if rc != 0 or not out.strip():
        rc2, out2 = adb_shell('dumpsys activity activities | grep -m2 ResumedActivity', timeout=25)
        return oneline(out2) or '(未取到前台信息)'
    return oneline(out)


def device_info():
    _rc, out = adb_shell('getprop ro.product.model; getprop ro.build.version.sdk; getprop ro.build.display.id',
                         timeout=20)
    return oneline(out)


# =============================================================================================
# 状态文件（跨阶段上下文；不含任何敏感信息）
# =============================================================================================

def load_state():
    path = os.path.join(OUT_DIR, 'b67_state.json')
    try:
        if os.path.isfile(path):
            with open(path, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def save_state(ctx):
    path = os.path.join(OUT_DIR, 'b67_state.json')
    try:
        os.makedirs(OUT_DIR, exist_ok=True)
        data = dict(ctx)
        data['updated_utc'] = iso_now()
        data['serial'] = SERIAL
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2, sort_keys=True)
        return True
    except Exception:
        return False


# =============================================================================================
# 判据（每个函数只做判定；阶段函数只负责取数 + rep.add(*check_xxx(...))）
# =============================================================================================

# ---- hosted-boot ----

def check_boot_launch(ok, detail):
    name = 'boot.am_start'
    if ok:
        return name, 'PASS', detail
    return name, 'FAIL', 'App 拉起失败: %s' % detail


def check_boot_marker_ready(hit, logs):
    """判据：点火后出现 hosted engine ready（幂等重跑走 reused 分支时同样算过）。"""
    name = 'boot.marker_ready'
    if not hit:
        fb = logs.match(MARK_FALLBACK)
        if fb:
            return name, 'FAIL', ('未见 ready/reused，却出现 fallback 标记'
                                  '（Shizuku 托管通道没走通）: %s' % oneline(fb[0]))
        tail = logs.lines[-3:] if logs.lines else ['(窗口内无 [b67] 行)']
        return name, 'FAIL', ('超时未见 %s 或 %s（窗口内 [b67] 行 %d 条；尾部: %s）'
                              % (MARK_READY, MARK_REUSED, len(logs.lines), oneline(' | '.join(tail))))
    if MARK_READY in hit:
        return name, 'PASS', '命中: %s' % oneline(hit)
    return name, 'PASS', '复用路径（未见 ready，见 reused）: %s' % oneline(hit)


def check_boot_marker_pid_match(hit, engine_pid):
    """判据：ready/reused 标记里的 pid 必须等于 engine.pid / ps 里的引擎 pid。"""
    name = 'boot.marker_pid_match'
    marker = MARK_READY if (hit and MARK_READY in hit) else MARK_REUSED
    got = pid_from_marker(hit, marker) if hit else None
    if got is None:
        return name, 'FAIL', '没能从标记里解析出 pid（标记=%s）' % (oneline(hit) if hit else '无')
    if engine_pid is None:
        return name, 'FAIL', '标记 pid=%s，但 engine.pid/ps 里拿不到引擎 pid' % got
    if got == engine_pid:
        return name, 'PASS', '标记 pid=%s == engine.pid/ps 的 %s' % (got, engine_pid)
    return name, 'FAIL', '标记 pid=%s != engine.pid/ps 的 %s（标记与磁盘状态不一致）' % (got, engine_pid)


def check_boot_engine_pid_file(pid, raw, err):
    """判据：engine.pid 存在且内容是可解析的 pid。"""
    name = 'boot.engine_pid_file'
    if pid is None:
        return name, 'FAIL', '%s 不可用: %s（原文=%s）' % (ENGINE_PID_FILE, err, oneline(raw) or '空')
    return name, 'PASS', '%s = %s' % (ENGINE_PID_FILE, pid)


def check_engine_proc_alive(name, row, pid):
    """判据：引擎进程存活（ps 里能找到该 pid）。"""
    if pid is None:
        return name, 'FAIL', '没有 pid 可查（engine.pid 缺失且 ps 无 dshroot 进程）'
    if row is None:
        return name, 'FAIL', 'pid=%s 不在 ps 结果里（进程已退出）' % pid
    return name, 'PASS', 'pid=%s 存活（NAME=%s USER=%s PPID=%s）' \
        % (pid, row.get('name'), row.get('user'), row.get('ppid'))


def check_boot_engine_uid_shell(row, uid_numeric, pid):
    """判据：引擎 USER=shell（uid=2000），证明由 Shizuku 托管。"""
    name = 'boot.engine_uid_shell'
    if row is None:
        return name, 'FAIL', 'pid=%s 不在 ps 结果里，无法判定属主' % pid
    user = row.get('user')
    if user == 'shell' and (uid_numeric is None or uid_numeric == SHELL_UID):
        return name, 'PASS', 'pid=%s USER=%s（/proc 属主 uid=%s）' \
            % (pid, user, uid_numeric if uid_numeric is not None else '未取到')
    if uid_numeric is not None and uid_numeric >= APP_UID_MIN:
        return name, 'FAIL', 'pid=%s USER=%s uid=%s（App 域，引擎没被 Shizuku 托管）' % (pid, user, uid_numeric)
    return name, 'FAIL', 'pid=%s USER=%s uid=%s（期望 shell/2000）' % (pid, user, uid_numeric)


def check_boot_engine_ppid_1(row, app_pid, pid):
    """判据：PPID=1 —— 引擎已脱离 App 进程树。"""
    name = 'boot.engine_ppid_1'
    if row is None:
        return name, 'FAIL', 'pid=%s 不在 ps 结果里，无法判定父子关系' % pid
    ppid = row.get('ppid')
    if str(ppid) == '1':
        return name, 'PASS', 'pid=%s PPID=1（已脱离 App 进程树；App pid=%s）' % (pid, app_pid)
    if app_pid is not None and str(ppid) == str(app_pid):
        return name, 'FAIL', 'pid=%s PPID=%s 就是 App pid —— 引擎仍挂在 App 进程树下' % (pid, ppid)
    return name, 'FAIL', 'pid=%s PPID=%s（期望 1；App pid=%s）' % (pid, ppid, app_pid)


def check_listen(listen, name, relax_tcp6):
    """通用监听判据：/proc/net/tcp 出现 0100007F:0C08 且状态列 0A（LISTEN）。"""
    if listen.get('tcp_listen'):
        return name, 'PASS', '/proc/net/tcp 命中 %s:%s st=%s（socket uid=%s）' \
            % (LOOPBACK_HEX, ENGINE_PORT_HEX, LISTEN_ST, listen.get('tcp_uid'))
    if listen.get('tcp6_listen'):
        if relax_tcp6:
            return name, 'PASS', '放宽(--relax-listen-tcp6)：仅 /proc/net/tcp6 命中 v4 映射 :%s（uid=%s）' \
                % (ENGINE_PORT_HEX, listen.get('tcp6_uid'))
        return name, 'FAIL', ('/proc/net/tcp 未命中 %s:%s st=%s；tcp6 有 v4 映射命中（uid=%s）'
                              ' —— 如属 ROM 行为可用 --relax-listen-tcp6 放宽'
                              % (LOOPBACK_HEX, ENGINE_PORT_HEX, LISTEN_ST, listen.get('tcp6_uid')))
    return name, 'FAIL', '/proc/net/tcp 未命中 %s:%s st=%s（tcp6 也没有 v4 映射命中）' \
        % (LOOPBACK_HEX, ENGINE_PORT_HEX, LISTEN_ST)


def check_boot_listen(listen, relax_tcp6):
    return check_listen(listen, 'boot.listen_3080', relax_tcp6)


def check_boot_listen_uid_shell(listen):
    """判据：3080 socket 的属主 uid 必须是 2000（shell/Shizuku）。"""
    name = 'boot.listen_uid_shell'
    uid = listen.get('tcp_uid')
    if uid is None and listen.get('tcp6_listen'):
        uid = listen.get('tcp6_uid')
    if uid is None:
        return name, 'FAIL', '拿不到 socket 属主（/proc/net/tcp 与 tcp6 都没命中）'
    if uid == SHELL_UID:
        return name, 'PASS', 'socket uid=%s（shell / Shizuku 通道）' % uid
    if uid >= APP_UID_MIN:
        return name, 'FAIL', 'socket uid=%s（App 域）—— 在监听的是 App 自己的引擎，不是托管引擎' % uid
    return name, 'FAIL', 'socket uid=%s（期望 %s）' % (uid, SHELL_UID)


def check_boot_stamp(size):
    """判据：.stamp 非空。"""
    name = 'boot.stamp_nonempty'
    if size is None:
        return name, 'FAIL', '%s 不存在或不可读' % STAMP_FILE
    if size > 0:
        return name, 'PASS', '%s 非空（%d 字节）' % (STAMP_FILE, size)
    return name, 'FAIL', '%s 存在但为空（0 字节）' % STAMP_FILE


def check_boot_watchdog(pid, err, rows, engine_pid):
    """判据：watchdog.pid 存在、进程存活，且与引擎不是同一个进程。"""
    name = 'boot.watchdog_pid'
    if pid is None:
        return name, 'FAIL', '%s 不可用: %s' % (WATCHDOG_PID_FILE, err)
    row = find_row(rows, pid)
    if row is None:
        return name, 'FAIL', 'watchdog.pid=%s 但该进程不在 ps（看门狗没起来）' % pid
    if engine_pid is not None and pid == engine_pid:
        return name, 'FAIL', 'watchdog.pid 与 engine.pid 相同（%s），看门狗和引擎不是两个进程' % pid
    return name, 'PASS', 'watchdog.pid=%s 存活（USER=%s PPID=%s），engine.pid=%s' \
        % (pid, row.get('user'), row.get('ppid'), engine_pid)


def check_boot_home(ok, rc, out):
    """判据：DSH_HOME 共享目录存在。"""
    name = 'boot.dsh_home_dir'
    if ok:
        return name, 'PASS', '%s 存在（ls -d: %s）' % (DSH_HOME, oneline(out))
    return name, 'FAIL', '%s 不存在（DSH_HOME 共享目录没建起来；rc=%s，ls 输出=%s）' \
        % (DSH_HOME, rc, oneline(out))


def check_optional_marker(name, label, hit):
    """可选标记（staged / watchdog started）：见到记 PASS，没见记 INFO + 说明。"""
    if hit:
        return name, 'PASS', '命中: %s' % oneline(hit)
    return name, 'INFO', '窗口内未见 %s —— 可能是复用路径（未重新 staged）或标记晚于本阶段窗口；不作为硬判据' % label


# ---- force-stop / reinstall / watchdog 共用 ----

def check_engine_pid_unchanged(name, base_pid, row, file_pid):
    """判据：引擎 pid 不变（ps 与 engine.pid 双证）。"""
    if row is None:
        return name, 'FAIL', '基线 pid=%s 已不在 ps（引擎被杀死/被替换）' % base_pid
    if row['pid'] != base_pid:
        return name, 'FAIL', 'pid 变成 %s（基线 %s）' % (row['pid'], base_pid)
    if file_pid is not None and file_pid != base_pid:
        return name, 'FAIL', 'engine.pid 变成 %s（基线 %s）' % (file_pid, base_pid)
    return name, 'PASS', 'pid=%s 不变（engine.pid=%s，USER=%s PPID=%s）' \
        % (base_pid, file_pid, row.get('user'), row.get('ppid'))


def check_marker_expect(name, hit, expect_marker, not_expect_marker, timeout):
    """期望命中 expect_marker；若命中 not_expect_marker 说明走了错误分支。"""
    if hit and expect_marker in hit:
        return name, 'PASS', '命中: %s' % oneline(hit)
    if hit and not_expect_marker and not_expect_marker in hit:
        return name, 'FAIL', '命中 %s（不是期望的 %s）：引擎被重新拉起/换道' % (not_expect_marker, expect_marker)
    if hit:
        return name, 'FAIL', '命中了别的标记（期望 %s）: %s' % (expect_marker, oneline(hit))
    return name, 'FAIL', '%ss 内未出现 %s' % (int(timeout), expect_marker)


def check_reuse_pid_match(name, hit, base_pid):
    got = pid_from_marker(hit, MARK_REUSED) if hit else None
    if got is None:
        return name, 'FAIL', '没能从 reused 标记解析出 pid（命中的行: %s）' % (oneline(hit) if hit else '无')
    if got == base_pid:
        return name, 'PASS', 'reused pid=%s == 基线 pid=%s（没有重复 spawn）' % (got, base_pid)
    return name, 'FAIL', 'reused pid=%s != 基线 pid=%s（重复 spawn / 引擎被换掉）' % (got, base_pid)


def check_no_respawn(name, snap, base_pid):
    """判据：引擎唯一且仍是基线 pid，engine.pid 也不能被改写。"""
    engines = snap.get('engines') or []
    others = [r for r in engines if r['pid'] != base_pid]
    if others:
        return name, 'FAIL', '出现额外引擎进程: %s（基线 pid=%s）' % (engine_procs_brief(others), base_pid)
    if not any(r['pid'] == base_pid for r in engines):
        return name, 'FAIL', '基线引擎 pid=%s 已不在 ps（引擎被换/被杀）' % base_pid
    file_pid = snap.get('pid_file_pid')
    if file_pid is not None and file_pid != base_pid:
        return name, 'FAIL', 'engine.pid 被改写成 %s（基线 %s）—— 疑似重新 spawn' % (file_pid, base_pid)
    return name, 'PASS', '引擎进程唯一且 pid=%s 不变（engine.pid=%s）' % (base_pid, file_pid)


def check_app_process_gone(app_pid):
    name = 'forced.app_process_gone'
    if app_pid is None:
        return name, 'PASS', 'App 进程已不在 ps（force-stop 生效）'
    return name, 'FAIL', 'force-stop 后 App 进程仍在（pid=%s）—— 本阶段结论不可信' % app_pid


def check_kill_done(pid, rc, out, gone):
    name = 'wd.kill'
    if rc != 0 or out.startswith('ERROR:'):
        return name, 'FAIL', 'kill -9 %s 执行失败 rc=%s %s' % (pid, rc, oneline(out))
    if gone:
        return name, 'PASS', 'kill -9 %s 后旧引擎已消失（真死注入成功）' % pid
    return name, 'FAIL', 'kill -9 %s 后旧引擎仍在 ps —— 本阶段后续判据不可信' % pid


def check_respawn_pid(old_pid, new_pid, new_row, waited, newer_than):
    """判据：出现**新的**引擎 pid，且其启动时刻晚于 kill 时刻。"""
    name = 'wd.respawn_pid'
    if new_pid is None:
        return name, 'FAIL', '%ss 内没有出现新的 dshroot 进程（旧 pid=%s 已被杀）' % (int(waited), old_pid)
    if new_pid == old_pid:
        return name, 'FAIL', '新引擎 pid=%s 与旧 pid 相同（不可能是重启出来的）' % new_pid
    epoch, note = proc_start_epoch(new_pid)
    if epoch is None:
        return name, 'PASS', '新引擎 pid=%s（旧 %s）耗时≈%ss；启动时刻解析失败: %s' \
            % (new_pid, old_pid, waited, note)
    if epoch < newer_than - 10.0:
        return name, 'FAIL', '新引擎 pid=%s 的启动时刻 %s 早于 kill 时刻 —— 不是本次拉起的新进程' \
            % (new_pid, fmt_epoch(epoch))
    return name, 'PASS', '新引擎 pid=%s（旧 %s）耗时≈%ss，启动时刻≈%s，USER=%s PPID=%s' \
        % (new_pid, old_pid, waited, fmt_epoch(epoch),
           (new_row or {}).get('user'), (new_row or {}).get('ppid'))


def check_respawn_detached(new_row, new_pid, app_pid):
    name = 'wd.respawn_detached'
    if new_row is None:
        return name, 'FAIL', '没有新引擎进程可判定（未出现新 pid）'
    user, ppid = new_row.get('user'), str(new_row.get('ppid'))
    if user == 'shell' and ppid == '1':
        return name, 'PASS', '新引擎 pid=%s USER=shell PPID=1（仍由 Shizuku 托管）' % new_pid
    return name, 'FAIL', '新引擎 pid=%s USER=%s PPID=%s（期望 shell/1；App pid=%s）' \
        % (new_pid, user, ppid, app_pid)


def check_watchdog_state_restart(text, err):
    name = 'wd.state_restart'
    if text is None:
        return name, 'FAIL', '%s 不可读: %s' % (WATCHDOG_STATE_FILE, err)
    body = oneline(text)
    if 'state=RESTART' in body:
        return name, 'PASS', '%s 含 state=RESTART: %s' % (WATCHDOG_STATE_FILE, body[:200])
    return name, 'FAIL', '%s 未见 state=RESTART（内容: %s）' % (WATCHDOG_STATE_FILE, body[:200] or '空')


def check_watchdog_alive(pid, err, rows):
    name = 'wd.watchdog_alive'
    if pid is None:
        return name, 'FAIL', '%s 不可用: %s' % (WATCHDOG_PID_FILE, err)
    row = find_row(rows, pid)
    if row is None:
        return name, 'FAIL', 'watchdog.pid=%s 不在 ps（看门狗死了）' % pid
    return name, 'PASS', 'watchdog.pid=%s 存活（USER=%s PPID=%s）' % (pid, row.get('user'), row.get('ppid'))


def check_no_app_start(name, count_before, count_after):
    """判据：本阶段脚本**没有**启动 App（工单要求：恢复过程不能依赖 App 在前台）。"""
    if count_after == count_before:
        return name, 'PASS', '本阶段脚本未执行任何 am start（计数 %d → %d）' % (count_before, count_after)
    return name, 'FAIL', '本阶段脚本执行了 %d 次 am start —— 该阶段不允许启动 App' % (count_after - count_before)


# ---- fallback ----

def check_fb_marker(hit, timeout):
    name = 'fb.fallback_marker'
    if hit and MARK_FALLBACK in hit:
        return name, 'PASS', '命中: %s' % oneline(hit)
    if hit:
        return name, 'FAIL', '未见 fallback 标记，反而命中: %s（Shizuku 仍可用？托管路径没被判定为不可用）' \
            % oneline(hit)
    return name, 'FAIL', '%ss 内未出现 %s' % (int(timeout), MARK_FALLBACK)


def check_fb_listen(listen, relax_tcp6):
    return check_listen(listen, 'fb.listen_3080', relax_tcp6)


def check_fb_listen_uid_app(listen):
    """回落引擎必须跑在 App uid 上（socket 属主 uid >= 10000）。"""
    name = 'fb.listen_uid_app'
    uid = listen.get('tcp_uid')
    if uid is None:
        uid = listen.get('tcp6_uid')
    if uid is None:
        return name, 'FAIL', '拿不到 3080 socket 属主 uid（监听都没起来）'
    if uid >= APP_UID_MIN:
        return name, 'PASS', '3080 socket uid=%s（u0_a* App 域，符合回落预期）' % uid
    if uid == SHELL_UID:
        return name, 'FAIL', '3080 socket uid=2000（shell）—— 监听者仍是 Shizuku 托管引擎，不是回落引擎'
    return name, 'FAIL', '3080 socket uid=%s（期望 u0_a* / >=%s）' % (uid, APP_UID_MIN)


def check_fb_engine_proc_app_uid(snap, listen):
    name = 'fb.engine_proc_app_uid'
    engines = snap.get('engines') or []
    inapp = [r for r in engines if r.get('kind') == 'inapp' or (r.get('user') or '').startswith('u0_a')]
    if inapp:
        return name, 'PASS', 'App uid 引擎进程: %s' % engine_procs_brief(inapp)
    uid = listen.get('tcp_uid') if listen.get('tcp_uid') is not None else listen.get('tcp6_uid')
    if uid is not None and uid >= APP_UID_MIN:
        return name, 'PASS', 'ps 未列出引擎行，但 3080 socket uid=%s 已是 App 域' % uid
    return name, 'FAIL', '没有 App uid 的引擎进程（ps 引擎行: %s；socket uid=%s）' \
        % (engine_procs_brief(engines) or '(无)', uid)


def check_fb_no_hosted(snap):
    name = 'fb.hosted_remnant'
    hosted = [r for r in (snap.get('engines') or []) if r.get('kind') == 'hosted']
    if hosted:
        return name, 'INFO', '仍有 shell uid 的托管引擎进程: %s（回落时通常应被清理/停用）' \
            % engine_procs_brief(hosted)
    return name, 'INFO', '没有残留的 shell uid 托管引擎进程'


# ---- cleanup ----

def check_clean_no_engine(snap, name='clean.no_engine_proc'):
    engines = snap.get('engines') or []
    if not engines:
        return name, 'PASS', 'ps 里已无任何 dshroot 引擎进程'
    kinds = sorted(set(r.get('kind') or 'unknown' for r in engines))
    extra = '（若全是 inapp，说明上一步 fallback 的 App 内引擎没有被 hosted stop 覆盖）' \
        if kinds == ['inapp'] else ''
    return name, 'FAIL', '仍有引擎进程: %s%s' % (engine_procs_brief(engines), extra)


def check_clean_dir_gone(ok, rc, out):
    name = 'clean.dsh_dir_gone'
    if ok:
        return name, 'FAIL', '%s 仍存在（cleanup 未生效）: %s' % (DSH_DIR, oneline(out))
    return name, 'PASS', '%s 已不存在（ls -d rc=%s: %s）' % (DSH_DIR, rc, oneline(out))


def check_clean_home_kept(ok, rc, out):
    name = 'clean.home_kept'
    if ok:
        return name, 'PASS', '%s 仍存在（会话数据保留）: %s' % (DSH_HOME, oneline(out))
    return name, 'FAIL', '%s 被删掉了（cleanup 误伤会话数据；rc=%s: %s）' % (DSH_HOME, rc, oneline(out))


def check_clean_port_closed(listen):
    name = 'clean.port_closed'
    if not listen.get('tcp_listen') and not listen.get('tcp6_listen'):
        return name, 'PASS', '3080 已无 LISTEN（tcp/tcp6 都未命中）'
    return name, 'FAIL', '收尾后 3080 仍在 LISTEN（tcp=%s uid=%s / tcp6=%s uid=%s）—— 有残留监听者' \
        % (listen.get('tcp_listen'), listen.get('tcp_uid'), listen.get('tcp6_listen'), listen.get('tcp6_uid'))


def check_marker_soft(name, label, hit):
    """清理动作的标记：见到记 PASS，没见记 INFO（该阶段的硬判据是文件系统状态）。"""
    if hit:
        return name, 'PASS', '命中: %s' % oneline(hit)
    return name, 'INFO', '窗口内未见 %s（清理效果以文件系统判据为准）' % label


def check_local_apk(exists, apk, name='reinst.apk_present'):
    if exists:
        try:
            size = os.path.getsize(apk)
        except Exception:
            size = -1
        return name, 'PASS', '%s（%d 字节）' % (apk, size)
    return name, 'FAIL', 'APK 不存在: %s（先跑 python .local/b47_build.py all）' % apk


def check_install_ok(ok, rc, out):
    name = 'reinst.install_ok'
    if ok:
        return name, 'PASS', 'adb install -r 返回 Success（rc=%s）' % rc
    return name, 'FAIL', 'adb install -r 失败 rc=%s 输出=%s' % (rc, oneline(out)[-300:])


# ---- selftest ----

def check_selftest_redact():
    name = 'selftest.redact'
    sample = '?token=0123456789abcdef0123456789abcdef&x=1'
    out = redact(sample)
    if '0123456789abcdef' in out or 'token=[redacted]' not in out or leak_scan(out):
        return name, 'FAIL', '脱敏未生效: %s' % out
    prose = '出口统一打码：token=说明性文字（engine.log 摘录同样已处理）'
    idem = 'token=[redacted]'
    if redact(prose) != prose or redact(idem) != idem:   # 说明性文字 / 已打码文本都不能被误伤
        return name, 'FAIL', '脱敏误伤说明性文字或非幂等: %s | %s' % (redact(prose), redact(idem))
    return name, 'PASS', '样例查询串（token 明文 32 位 hex）已脱敏为 %s；说明性文字与已打码文本保持原样' % out


def check_selftest_ps(rc, rows, engines, mode, app_pid):
    name = 'selftest.ps_parse'
    if rc != 0 or not rows:
        return name, 'FAIL', 'ps 解析结果为空（rc=%s，解析模式=%s）—— 设备侧 ps 列不兼容' % (rc, mode)
    if not engines:
        return name, 'INFO', 'ps 解析到 %d 行（模式=%s，App pid=%s），当前没有 dshroot 引擎进程' \
            % (len(rows), mode, app_pid)
    return name, 'PASS', 'ps 解析到 %d 行（模式=%s），识别引擎进程: %s' \
        % (len(rows), mode, engine_procs_brief(engines))


def check_selftest_starttime(pid, epoch, note, uid_num):
    name = 'selftest.proc_starttime'
    if pid is None:
        return name, 'INFO', '当前没有引擎/App 进程可取启动时刻'
    if epoch is None:
        return name, 'FAIL', 'pid=%s 启动时刻解析失败: %s' % (pid, note)
    return name, 'PASS', 'pid=%s 启动时刻≈%s（%s），/proc/<pid> 属主 uid=%s' \
        % (pid, fmt_epoch(epoch), note, uid_num)


def check_selftest_net(listen):
    name = 'selftest.net_parse'
    if listen.get('rc') != 0:
        return name, 'FAIL', 'cat /proc/net/tcp 失败（rc=%s）' % listen.get('rc')
    if listen.get('tcp_lines', 0) <= 0:
        return name, 'FAIL', '/proc/net/tcp 里没有可解析的行'
    return name, 'PASS', '/proc/net/tcp 行数=%d；3080 当前 LISTEN=%s（tcp uid=%s；tcp6 映射命中=%s）' \
        % (listen.get('tcp_lines'), listen.get('tcp_listen'), listen.get('tcp_uid'), listen.get('tcp6_listen'))


def check_selftest_logcat(rc, out, hits):
    name = 'selftest.logcat_grep'
    if out.startswith('ERROR:') or 'not found' in out.lower():
        return name, 'FAIL', '设备侧 logcat/grep 不可用: %s' % oneline(out)[:200]
    if rc not in (0, 1):
        return name, 'FAIL', '设备侧 logcat | grep 返回 rc=%s: %s' % (rc, oneline(out)[:200])
    return name, 'PASS', "设备侧 logcat -d -v time | grep -F '%s' 可用（rc=%s，命中 %d 行）" \
        % (LOG_NEEDLE, rc, hits)


def check_selftest_state_files(items):
    name = 'selftest.state_files'
    return name, 'INFO', '（只读探测）' + ' | '.join(items)


# =============================================================================================
# 阶段一：hosted-boot
# =============================================================================================

def phase_hosted_boot(rep, ctx, args):
    print('--- 阶段 hosted-boot：拉起 App —— 引擎应由 Shizuku(shell) 托管 ---', flush=True)

    rc_g, out_g = logcat_buffer_bump()
    rep.info('boot.logcat_buffer', 'logcat -G 8M rc=%s %s' % (rc_g, oneline(out_g) or '(空)'))
    rc_c, out_c = logcat_clear()
    if rc_c != 0:
        rep.info('boot.logcat_clear', 'logcat -c rc=%s %s（继续；日志窗口可能不干净）' % (rc_c, oneline(out_c)))

    ok, detail = launch_app()
    rep.add(*check_boot_launch(ok, detail))

    logs = LogCollector()
    hit = wait_marker(logs, (MARK_READY, MARK_REUSED), args.boot_timeout)
    rep.info('boot.wait', '等待 ready|reused <= %ss（poll=%ss），结果: %s'
             % (int(args.boot_timeout), int(POLL_SECONDS), oneline(hit) if hit else '未出现'))

    # staged / watchdog started 可能比 ready 晚一点；给一个短追加窗口（可选判据）
    hit_staged = None
    hit_watchdog = None
    reused_path = bool(hit and MARK_REUSED in hit)     # 复用路径不会有 staged 标记
    deadline = time.time() + MARKER_EXTRA_TIMEOUT
    while time.time() < deadline:
        logs.poll()
        hit_staged = hit_staged or (logs.match(MARK_STAGED) or [None])[-1]
        hit_watchdog = hit_watchdog or (logs.match(MARK_WATCHDOG) or [None])[-1]
        if hit_staged and hit_watchdog:
            break
        if reused_path and hit_watchdog:
            break
        time.sleep(min(POLL_SECONDS, max(0.5, deadline - time.time())))

    snap = engine_snapshot()
    pid, src = resolve_engine_pid(snap)
    row = find_row(snap['rows'], pid) if pid else None
    listen = snap['listen']
    uid_numeric = proc_uid_numeric(pid) if pid else None
    stamp_size = remote_size(STAMP_FILE)
    wd_pid, wd_raw, wd_err = read_pid_file(WATCHDOG_PID_FILE)
    wd_state, wd_state_err = read_file_text(WATCHDOG_STATE_FILE)
    home_ok, home_rc, home_out = remote_exists(DSH_HOME)
    start_epoch, start_note = proc_start_epoch(pid) if pid else (None, '无 pid')

    rep.info('boot.engine_pid', 'pid=%s（来源: %s）启动时刻≈%s（%s）'
             % (pid, src, fmt_epoch(start_epoch), start_note))
    rep.excerpt('boot ps 摘录', ps_brief(snap))
    rep.excerpt('boot /proc/net/tcp 证据', listen['evidence'])
    rep.excerpt('boot b67 日志窗口', logs.dump())
    rep.excerpt('boot engine.pid / watchdog.pid', 'engine.pid 原文=%s；watchdog.pid 原文=%s'
                % (oneline(snap.get('pid_raw')) or '(空)', oneline(wd_raw) or '(空)'))
    rep.excerpt('boot watchdog.state', wd_state if wd_state is not None else '(不可读: %s)' % wd_state_err)
    rep.excerpt('boot .stamp', 'size=%s bytes' % stamp_size)
    rep.excerpt('boot engine.log 末 20 行（token 已打码）', tail_engine_log(20))
    rep.excerpt('boot %s' % DSH_HOME, 'ls -d rc=%s %s' % (home_rc, oneline(home_out)))
    rep.excerpt('boot 当前前台窗口', foreground_probe())

    rep.add(*check_boot_marker_ready(hit, logs))
    rep.add(*check_boot_marker_pid_match(hit, pid))
    rep.add(*check_boot_engine_pid_file(pid, snap.get('pid_raw'), snap.get('pid_err')))
    rep.add(*check_engine_proc_alive('boot.engine_proc_alive', row, pid))
    rep.add(*check_boot_engine_uid_shell(row, uid_numeric, pid))
    rep.add(*check_boot_engine_ppid_1(row, snap['app_pid'], pid))
    rep.add(*check_boot_listen(listen, RELAX_TCP6))
    rep.add(*check_boot_listen_uid_shell(listen))
    rep.add(*check_boot_stamp(stamp_size))
    rep.add(*check_boot_watchdog(wd_pid, wd_err, snap['rows'], pid))
    rep.add(*check_boot_home(home_ok, home_rc, home_out))
    rep.add(*check_optional_marker('boot.marker_staged', MARK_STAGED, hit_staged))
    rep.add(*check_optional_marker('boot.marker_watchdog', MARK_WATCHDOG, hit_watchdog))

    ctx['engine_pid'] = pid
    ctx['engine_kind'] = (row or {}).get('kind')
    ctx['engine_start_epoch'] = start_epoch
    ctx['last_phase'] = 'hosted-boot'
    ctx['phases'] = sorted(set((ctx.get('phases') or []) + ['hosted-boot']))
    save_state(ctx)


# =============================================================================================
# 阶段二：force-stop
# =============================================================================================

def phase_force_stop(rep, ctx, args):
    print('--- 阶段 force-stop：App 被杀，托管引擎必须存活 + 复用 ---', flush=True)

    base = engine_snapshot()
    pid, src = resolve_engine_pid(base)
    if pid is None:
        rep.fail('forced.baseline', '找不到引擎 pid（engine.pid=%s；ps 无 dshroot 进程）—— 先跑 hosted-boot 阶段'
                 % (oneline(base.get('pid_raw')) or '空'))
        return
    row0 = find_row(base['rows'], pid)
    start0, start_note = proc_start_epoch(pid)
    rep.info('forced.baseline', 'pid=%s（来源: %s）启动时刻≈%s（%s）USER=%s PPID=%s listen=%s'
             % (pid, src, fmt_epoch(start0), start_note, (row0 or {}).get('user'), (row0 or {}).get('ppid'),
                base['listen'].get('tcp_listen')))
    rep.excerpt('forced force-stop 前 ps 摘录', ps_brief(base))

    am_before = len(AM_START_EVENTS)
    logcat_clear()
    rc_fs, out_fs = adb_shell('am force-stop %s' % APP_PKG, timeout=30)
    rep.info('forced.force_stop', 'am force-stop %s rc=%s %s' % (APP_PKG, rc_fs, oneline(out_fs) or '(空)'))
    time.sleep(max(1.0, args.force_stop_wait))

    after = engine_snapshot()
    row1 = find_row(after['rows'], pid)
    rep.excerpt('forced force-stop 后 ps 摘录', ps_brief(after))
    rep.excerpt('forced force-stop 后 /proc/net/tcp 证据', after['listen']['evidence'])

    rep.add(*check_engine_pid_unchanged('forced.pid_unchanged', pid, row1, after.get('pid_file_pid')))
    rep.add(*check_engine_proc_alive('forced.proc_alive', row1, pid))
    rep.add(*check_listen(after['listen'], 'forced.listen_still', RELAX_TCP6))
    rep.add(*check_app_process_gone(after.get('app_pid')))

    # 再启动 App → 必须走复用路径
    ok, detail = launch_app()
    rep.info('forced.relaunch', detail)
    logs = LogCollector()
    hit = wait_marker(logs, (MARK_REUSED, MARK_READY, MARK_FALLBACK), args.boot_timeout)
    rep.excerpt('forced 再启动后 b67 日志窗口', logs.dump())
    final = engine_snapshot()
    rep.excerpt('forced 收尾 ps 摘录', ps_brief(final))

    rep.add(*check_marker_expect('forced.reuse_marker', hit, MARK_REUSED, MARK_READY, args.boot_timeout))
    rep.add(*check_reuse_pid_match('forced.reuse_pid_match', hit, pid))
    rep.add(*check_no_respawn('forced.no_respawn', final, pid))
    rep.info('forced.am_start_count', '本阶段脚本 am start 次数=%d'
             % (len(AM_START_EVENTS) - am_before))

    ctx['engine_pid'] = pid
    ctx['last_phase'] = 'force-stop'
    ctx['phases'] = sorted(set((ctx.get('phases') or []) + ['force-stop']))
    save_state(ctx)


# =============================================================================================
# 阶段三：reinstall
# =============================================================================================

def phase_reinstall(rep, ctx, args):
    print('--- 阶段 reinstall：adb install -r 覆盖安装，托管引擎必须存活 + 复用 ---', flush=True)

    apk = APK_PATH if os.path.isabs(APK_PATH) else os.path.join(REPO_ROOT, APK_PATH)
    exists = os.path.isfile(apk)
    rep.add(*check_local_apk(exists, apk))
    if not exists:
        return

    base = engine_snapshot()
    pid, src = resolve_engine_pid(base)
    if pid is None:
        rep.fail('reinst.baseline', '找不到引擎 pid（engine.pid=%s；ps 无 dshroot 进程）—— 先跑 hosted-boot 阶段'
                 % (oneline(base.get('pid_raw')) or '空'))
        return
    start0, start_note = proc_start_epoch(pid)
    rep.info('reinst.baseline', 'pid=%s（来源: %s）启动时刻≈%s（%s）' % (pid, src, fmt_epoch(start0), start_note))
    rep.excerpt('reinst 安装前 ps 摘录', ps_brief(base))

    rc_i, out_i = adb(['install', '-r', apk], timeout=INSTALL_TIMEOUT)
    install_ok = (rc_i == 0) and ('Success' in out_i)
    rep.add(*check_install_ok(install_ok, rc_i, out_i))
    rep.excerpt('reinst adb install -r 输出', out_i)

    after = engine_snapshot()
    row1 = find_row(after['rows'], pid)
    rep.excerpt('reinst 安装后 ps 摘录', ps_brief(after))
    rep.excerpt('reinst 安装后 /proc/net/tcp 证据', after['listen']['evidence'])
    rep.add(*check_engine_pid_unchanged('reinst.pid_unchanged', pid, row1, after.get('pid_file_pid')))
    rep.add(*check_engine_proc_alive('reinst.proc_alive', row1, pid))
    rep.add(*check_listen(after['listen'], 'reinst.listen_still', RELAX_TCP6))

    ok, detail = launch_app()
    rep.info('reinst.relaunch', detail)
    logs = LogCollector()
    hit = wait_marker(logs, (MARK_REUSED, MARK_READY, MARK_FALLBACK), args.boot_timeout)
    rep.excerpt('reinst 再启动后 b67 日志窗口', logs.dump())
    final = engine_snapshot()
    rep.excerpt('reinst 收尾 ps 摘录', ps_brief(final))
    rep.add(*check_marker_expect('reinst.reuse_marker', hit, MARK_REUSED, MARK_READY, args.boot_timeout))
    rep.add(*check_reuse_pid_match('reinst.reuse_pid_match', hit, pid))
    rep.add(*check_no_respawn('reinst.no_respawn', final, pid))

    ctx['engine_pid'] = pid
    ctx['last_phase'] = 'reinstall'
    ctx['phases'] = sorted(set((ctx.get('phases') or []) + ['reinstall']))
    save_state(ctx)


# =============================================================================================
# 阶段四：watchdog
# =============================================================================================

def wait_engine_respawn(old_pid, timeout, logs=None):
    """轮询等待「新的引擎 pid + 3080 LISTEN」；返回 dict（含采样表与最后快照）。"""
    started = time.time()
    deadline = started + max(0.0, timeout)
    new_pid = None
    new_row = None
    snap = None
    samples = []
    while True:
        if logs is not None:
            logs.poll()
        snap = engine_snapshot()
        cand = [r for r in snap['engines'] if r['pid'] != old_pid]
        if cand and new_pid is None:
            new_pid, new_row = cand[0]['pid'], cand[0]
        listen = snap['listen']
        samples.append({'at': now_str(),
                        'engines': [{'pid': r['pid'], 'user': r.get('user'), 'ppid': r.get('ppid'),
                                     'kind': r.get('kind')} for r in snap['engines']],
                        'tcp_listen': listen.get('tcp_listen'), 'tcp_uid': listen.get('tcp_uid'),
                        'app_pid': snap.get('app_pid')})
        if new_pid is not None and listen.get('tcp_listen'):
            break
        if time.time() >= deadline:
            break
        sleep_until(min(deadline, time.time() + POLL_SECONDS))
    return {'pid': new_pid, 'row': new_row, 'listen': (snap or {}).get('listen') or {},
            'samples': samples, 'snap': snap or {}, 'waited': round(time.time() - started, 1)}


def phase_watchdog(rep, ctx, args):
    print('--- 阶段 watchdog：kill -9 引擎 → 看门狗拉起新引擎（App 不在前台）---', flush=True)

    base = engine_snapshot()
    pid, src = resolve_engine_pid(base)
    if pid is None:
        rep.fail('wd.baseline', '找不到引擎 pid（engine.pid=%s；ps 无 dshroot 进程）—— 先跑 hosted-boot 阶段'
                 % (oneline(base.get('pid_raw')) or '空'))
        return
    wd_pid, _wd_raw, wd_err = read_pid_file(WATCHDOG_PID_FILE)
    state_before, state_before_err = read_file_text(WATCHDOG_STATE_FILE)
    rep.info('wd.baseline', 'engine pid=%s（来源: %s）watchdog pid=%s listen=%s App pid=%s'
             % (pid, src, wd_pid, base['listen'].get('tcp_listen'), base['app_pid']))
    rep.excerpt('wd 前置 watchdog.state',
                state_before if state_before is not None else '(不可读: %s)' % state_before_err)
    rep.excerpt('wd 前置 ps 摘录', ps_brief(base))

    am_before = len(AM_START_EVENTS)
    rep.info('wd.foreground_before', 'kill 前前台窗口: %s' % foreground_probe())
    logcat_clear()
    rc_k, out_k = adb_shell('kill -9 %d' % pid, timeout=20)
    kill_epoch = time.time()
    gone = wait_until(lambda: find_row(fetch_ps()[1], pid) is None, 10.0, interval=1.5)
    rep.add(*check_kill_done(pid, rc_k, out_k, gone))
    if not gone:
        rep.excerpt('wd kill 后 ps 摘录', ps_brief(engine_snapshot()))
        return

    logs = LogCollector()
    res = wait_engine_respawn(pid, args.watchdog_timeout, logs)
    new_pid, new_row, listen = res['pid'], res['row'], res['listen']
    rep.info('wd.wait', '轮询 %ss：新 pid=%s，3080 LISTEN=%s，总耗时≈%ss'
             % (int(args.watchdog_timeout), new_pid, listen.get('tcp_listen'), res['waited']))
    rep.excerpt('wd 窗口采样表', json.dumps(res['samples'], ensure_ascii=False, indent=2))
    rep.excerpt('wd 窗口内 b67 日志', logs.dump())
    rep.excerpt('wd /proc/net/tcp 证据', listen.get('evidence', ''))
    rep.excerpt('wd 收尾 ps 摘录', ps_brief(res['snap']))
    state_after, state_err = read_file_text(WATCHDOG_STATE_FILE)
    rep.excerpt('wd 收尾 watchdog.state',
                state_after if state_after is not None else '(不可读: %s)' % state_err)
    rep.excerpt('wd engine.log 末 20 行（token 已打码）', tail_engine_log(20))

    rep.add(*check_respawn_pid(pid, new_pid, new_row, res['waited'], kill_epoch))
    rep.add(*check_respawn_detached(new_row, new_pid, base['app_pid']))
    rep.add(*check_listen(listen, 'wd.listen_recovered', RELAX_TCP6))
    rep.add(*check_watchdog_state_restart(state_after, state_err))
    rep.add(*check_watchdog_alive(wd_pid, wd_err, res['snap'].get('rows') or []))
    rep.add(*check_no_app_start('wd.no_app_start', am_before, len(AM_START_EVENTS)))
    app_markers = logs.match(MARK_READY, MARK_REUSED, MARK_STAGED)
    rep.info('wd.app_marker_absent', '窗口内 App 侧拉起标记数=%d（%s）—— 自愈不应依赖 App 前台'
             % (len(app_markers), oneline(app_markers[-1]) if app_markers else '无'))
    rep.info('wd.foreground_after', '窗口结束后前台窗口: %s' % foreground_probe())

    ctx['engine_pid'] = new_pid
    ctx['engine_start_epoch'] = proc_start_epoch(new_pid)[0] if new_pid else None
    ctx['last_phase'] = 'watchdog'
    ctx['phases'] = sorted(set((ctx.get('phases') or []) + ['watchdog']))
    save_state(ctx)


# =============================================================================================
# 阶段五：fallback
# =============================================================================================

def wait_listen(timeout):
    """轮询等待 3080 LISTEN，返回最后一次 listen_state()。"""
    deadline = time.time() + max(0.0, timeout)
    st = listen_state()
    while not st.get('tcp_listen') and not st.get('tcp6_listen') and time.time() < deadline:
        time.sleep(min(POLL_SECONDS, max(0.5, deadline - time.time())))
        st = listen_state()
    return st


def restore_shizuku():
    """尝试用 start.sh 重启 Shizuku；不可行则标 MANUAL（不让整体判 FAIL）。"""
    name = 'fb.shizuku_restore'
    ok, rc, _out = remote_exists(SHIZUKU_START_SH)
    if not ok:
        return name, 'MANUAL', ('未找到 %s（ls rc=%s），无法脚本化重启 Shizuku —— 需用户手动重新激活 Shizuku'
                                 '（打开 Shizuku 管理器 App，或重新执行 start.sh / 无线调试配对）'
                                 % (SHIZUKU_START_SH, rc))
    rc2, out2 = adb_shell('sh %s' % SHIZUKU_START_SH, timeout=40)
    back = wait_until(lambda: bool([r for r in shizuku_rows() if r.get('user') == 'shell']), 25.0, interval=2.0)
    if back:
        return name, 'PASS', 'sh start.sh rc=%s，shell uid 的 Shizuku 服务已回来' % rc2
    return name, 'MANUAL', ('sh %s rc=%s 但 25s 内未见 shell uid 的 Shizuku 服务（输出: %s）—— '
                            '需用户手动重新激活 Shizuku' % (SHIZUKU_START_SH, rc2, oneline(out2)[:200]))


def phase_fallback(rep, ctx, args):
    print('--- 阶段 fallback：停 Shizuku → 引擎应回落为 App uid 运行 ---', flush=True)

    before = shizuku_rows()
    rep.info('fb.shizuku_before', 'Shizuku 相关进程: %s'
             % (oneline('; '.join('pid=%s/user=%s/name=%s' % (r['pid'], r.get('user'), r.get('name'))
                                  for r in before)) or '(无)'))

    rc_fs, out_fs = adb_shell('am force-stop %s' % SHIZUKU_PKG, timeout=30)
    rep.info('fb.stop_shizuku', 'am force-stop %s rc=%s %s' % (SHIZUKU_PKG, rc_fs, oneline(out_fs) or '(空)'))
    time.sleep(3)

    # 可选：先杀掉还活着的托管引擎，让「回落」路径必然触发（默认关闭，保持工单动作集合不变）
    if args.fallback_kill_engine:
        host_pid, host_src = resolve_engine_pid(engine_snapshot())
        if host_pid is None:
            rep.info('fb.kill_hosted_first', '当前没有托管引擎进程需要先停掉（来源: %s）' % host_src)
        else:
            rc_h, out_h = adb_shell('kill -9 %d' % host_pid, timeout=20)
            gone_h = wait_until(lambda: find_row(fetch_ps()[1], host_pid) is None, 10.0, interval=1.5)
            rep.info('fb.kill_hosted_first', 'kill -9 %s（来源: %s）rc=%s 已消失=%s %s'
                     % (host_pid, host_src, rc_h, gone_h, oneline(out_h)))
            time.sleep(2)
    after_stop = shizuku_rows()
    rep.info('fb.shizuku_after_stop', '停止后 Shizuku 相关进程: %s'
             % (oneline('; '.join('pid=%s/user=%s/name=%s' % (r['pid'], r.get('user'), r.get('name'))
                                  for r in after_stop)) or '(无)'))
    servers = [r for r in after_stop if r.get('user') == 'shell']
    rep.info('fb.shizuku_server_alive', 'shell uid 的 Shizuku 服务进程仍有 %d 个（%s）—— '
             '本机 ROM 上 force-stop 管理器 App 往往不会停掉 shizuku_server'
             % (len(servers), oneline('; '.join('pid=%s' % r['pid'] for r in servers)) or '无'))
    if args.stop_shizuku_server and servers:
        killed = []
        for row in servers:
            rck, _outk = adb_shell('kill -9 %d' % row['pid'], timeout=20)
            killed.append('pid=%s rc=%s' % (row['pid'], rck))
        rep.info('fb.stop_shizuku_server_extra', '按 --stop-shizuku-server 额外停掉 shizuku_server: %s'
                 % oneline('; '.join(killed)))
        time.sleep(3)

    logcat_clear()
    _ok, detail = launch_app()
    rep.info('fb.launch', detail)
    logs = LogCollector()
    hit = wait_marker(logs, (MARK_FALLBACK, MARK_READY, MARK_REUSED), args.boot_timeout)
    rep.add(*check_fb_marker(hit, args.boot_timeout))

    listen = wait_listen(args.listen_timeout)
    snap = engine_snapshot()
    rep.excerpt('fb b67 日志窗口', logs.dump())
    rep.excerpt('fb /proc/net/tcp 证据', listen.get('evidence', ''))
    rep.excerpt('fb ps 摘录', ps_brief(snap))
    rep.excerpt('fb engine.log 末 20 行（token 已打码）', tail_engine_log(20))

    rep.add(*check_fb_listen(listen, RELAX_TCP6))
    rep.add(*check_fb_listen_uid_app(listen))
    rep.add(*check_fb_engine_proc_app_uid(snap, listen))
    rep.add(*check_fb_no_hosted(snap))
    if hit and (MARK_REUSED in hit or MARK_READY in hit):
        rep.info('fb.hosted_still_serving',
                 'App 走的是复用路径（%s）：托管引擎还活着并继续服务，所以不会回落成 App 内引擎 —— '
                 '想看真实回落请加 --fallback-kill-engine（先 kill 掉托管引擎），或先跑 cleanup 阶段' % oneline(hit))

    # 恢复 Shizuku（不可行时标 MANUAL，不影响退出码）
    rep.add(*restore_shizuku())

    ctx['last_phase'] = 'fallback'
    ctx['phases'] = sorted(set((ctx.get('phases') or []) + ['fallback']))
    save_state(ctx)


# =============================================================================================
# 阶段六：cleanup
# =============================================================================================

def phase_cleanup(rep, ctx, args):
    print('--- 阶段 cleanup：hosted stop + hosted cleanup（清目录，保留会话数据）---', flush=True)

    base = engine_snapshot()
    rep.info('clean.baseline', '引擎进程: %s；engine.pid=%s；listen=%s'
             % (engine_procs_brief(base['engines']) or '(无)', base.get('pid_file_pid'),
                base['listen'].get('tcp_listen')))
    rep.excerpt('clean 前置 ps 摘录', ps_brief(base))
    home_before_ok, _rc, home_before_out = remote_exists(DSH_HOME)
    rep.info('clean.home_before', '%s 存在=%s（%s）' % (DSH_HOME, home_before_ok, oneline(home_before_out)))

    logcat_clear()
    rc1, _out1, detail1 = am_start_action('action_hosted_stop', 'hosted_stop')
    rep.info('clean.stop_trigger', detail1)
    logs = LogCollector()
    hit_stop = wait_marker(logs, (MARK_STOP,), min(args.cleanup_timeout, 60.0))
    wait_until(lambda: not engine_snapshot()['engines'], args.cleanup_timeout, interval=3.0)
    snap1 = engine_snapshot()
    rep.excerpt('clean stop 后 ps 摘录', ps_brief(snap1))
    rep.excerpt('clean stop 后 b67 日志', logs.dump())
    rep.add(*check_clean_no_engine(snap1, 'clean.no_engine_after_stop'))
    rep.add(*check_marker_soft('clean.stop_marker', MARK_STOP, hit_stop))

    rc2, _out2, detail2 = am_start_action('action_hosted_cleanup', 'hosted_cleanup')
    rep.info('clean.cleanup_trigger', detail2)
    hit_clean = wait_marker(logs, (MARK_CLEANUP,), min(args.cleanup_timeout, 60.0))
    time.sleep(2)
    dir_ok, dir_rc, dir_out = remote_exists(DSH_DIR)
    home_ok, home_rc, home_out = remote_exists(DSH_HOME)
    snap2 = engine_snapshot()
    rep.excerpt('clean cleanup 后 b67 日志', logs.dump())
    rep.excerpt('clean cleanup 后 %s' % DSH_DIR, 'ls -d rc=%s %s' % (dir_rc, oneline(dir_out)))
    rep.excerpt('clean cleanup 后 %s' % DSH_HOME, 'ls -d rc=%s %s' % (home_rc, oneline(home_out)))
    rep.excerpt('clean cleanup 后 /proc/net/tcp 证据', snap2['listen']['evidence'])
    rep.excerpt('clean cleanup 后 ps 摘录', ps_brief(snap2))

    rep.add(*check_clean_dir_gone(dir_ok, dir_rc, dir_out))
    rep.add(*check_clean_home_kept(home_ok, home_rc, home_out))
    rep.add(*check_clean_no_engine(snap2, 'clean.no_engine_after_cleanup'))
    rep.add(*check_clean_port_closed(snap2['listen']))
    rep.add(*check_marker_soft('clean.cleanup_marker', MARK_CLEANUP, hit_clean))

    ctx['last_phase'] = 'cleanup'
    ctx['phases'] = sorted(set((ctx.get('phases') or []) + ['cleanup']))
    ctx['engine_pid'] = None
    save_state(ctx)


# =============================================================================================
# 阶段七：selftest（只读管道自检；不启动 App、不清 logcat、不写设备）
# =============================================================================================

def phase_selftest(rep, ctx, args):
    print('--- 阶段 selftest：只读管道自检（ps / 端口 / 启动时刻 / 日志 grep / 脱敏）---', flush=True)

    rep.add(*check_selftest_redact())

    rc, rows, _raw, mode = fetch_ps()
    engines = engine_rows(rows)
    app_pid = app_pid_of(rows)
    rep.excerpt('selftest ps 摘录', ps_brief({'ps_mode': mode, 'ps_rc': rc, 'rows': rows,
                                             'engines': engines, 'app_pid': app_pid}, limit=20))
    rep.add(*check_selftest_ps(rc, rows, engines, mode, app_pid))

    target_pid = engines[0]['pid'] if engines else app_pid
    epoch, note = proc_start_epoch(target_pid) if target_pid else (None, '没有可测的 pid')
    uid_num = proc_uid_numeric(target_pid) if target_pid else None
    rep.add(*check_selftest_starttime(target_pid, epoch, note, uid_num))

    listen = listen_state()
    rep.excerpt('selftest /proc/net/tcp 证据', listen['evidence'])
    rep.add(*check_selftest_net(listen))

    logs = LogCollector()
    logs.poll()
    rep.add(*check_selftest_logcat(logs.last_rc, logs.last_out, len(logs.lines)))
    rep.excerpt('selftest logcat 窗口（[b67] 行）', logs.dump())

    apk = APK_PATH if os.path.isabs(APK_PATH) else os.path.join(REPO_ROOT, APK_PATH)
    rep.add(*check_local_apk(os.path.isfile(apk), apk, 'selftest.apk_present'))

    items = []
    for path in (ENGINE_PID_FILE, WATCHDOG_PID_FILE, STAMP_FILE, WATCHDOG_STATE_FILE, ENGINE_LOG_FILE,
                 DSH_HOME):
        ok, _frc, _fout = remote_exists(path)
        size = 'dir' if path == DSH_HOME else remote_size(path)
        items.append('%s 存在=%s（size=%s）' % (path, ok, size))
    rep.add(*check_selftest_state_files(items))


# =============================================================================================
# CLI / 主流程
# =============================================================================================

EPILOG = """阶段说明:
  hosted-boot  拉起 App（action_launch_engine + silent）→ 等 [b67] hosted engine ready/reused →
               断言 engine.pid 存活、USER=shell、PPID=1、3080 LISTEN、.stamp 非空、watchdog 存活、DSH_HOME 存在
  force-stop   am force-stop App → 5s 后引擎 pid 不变、3080 仍 LISTEN → 再拉起 → 断言 reused 且 pid 相同
  reinstall    adb install -r <apk> → 引擎 pid 不变、3080 仍 LISTEN → 再拉起 → 断言 reused
  watchdog     kill -9 引擎 → ≤150s 内出现新 pid + 3080 恢复 + watchdog.state 含 state=RESTART（全程不启动 App）
  fallback     am force-stop Shizuku → 拉起 App → 断言 [b67] fallback 标记 + 3080 以 App uid 监听 → 尝试 start.sh 恢复 Shizuku
               （若托管引擎仍存活，App 会走 reused 复用路径而**不**回落；加 --fallback-kill-engine 可强制回落）
  cleanup      action_hosted_stop（无 dshroot 残留）→ action_hosted_cleanup（/data/local/tmp/dsh 消失、DSH_HOME 保留）
  selftest     只读管道自检（ps 解析 / 端口解析 / 启动时刻 / 日志 grep / 脱敏）—— 不改设备状态
  all          hosted-boot → force-stop → reinstall → watchdog → fallback → cleanup

退出码: 0 = 无 FAIL（MANUAL 不影响退出码）；1 = 有 FAIL；2 = 环境问题（没设备 / 用法错误）。
token 明文永不出现在 stdout 与报告里：所有出口统一打码为 token=[redacted]。
"""

COMMON_DEFAULTS = {
    'poll_seconds': DEFAULT_POLL_SECONDS,
    'boot_timeout': DEFAULT_BOOT_TIMEOUT,
    'watchdog_timeout': DEFAULT_WATCHDOG_TIMEOUT,
    'force_stop_wait': DEFAULT_FORCE_STOP_WAIT,
    'cleanup_timeout': DEFAULT_CLEANUP_TIMEOUT,
    'listen_timeout': DEFAULT_LISTEN_TIMEOUT,
    'relax_listen_tcp6': False,
    'stop_shizuku_server': False,
    'fallback_kill_engine': False,
}


def build_parser():
    parser = argparse.ArgumentParser(
        prog='e2e_batch67_residency.py',
        description='批次67 托管引擎（Shizuku 拉起 / 脱离 App 进程树）—— 真机端到端验证脚手架（只取证与判定）',
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--serial', default=None,
                        help='adb 序列号（默认自动检测：$ANDROID_SERIAL → adb devices 第一个 device）')
    parser.add_argument('--apk', default=DEFAULT_APK, help='批次67 APK 路径（默认 %s）' % DEFAULT_APK)
    parser.add_argument('--out-dir', default=DEFAULT_OUT_DIR,
                        help='报告与状态文件目录（默认 %s）' % DEFAULT_OUT_DIR)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument('--poll-seconds', type=float, default=DEFAULT_POLL_SECONDS, help='轮询间隔秒（默认 5）')
    common.add_argument('--boot-timeout', type=float, default=DEFAULT_BOOT_TIMEOUT,
                        help='等 App 侧标记的超时秒（默认 180）')
    common.add_argument('--watchdog-timeout', type=float, default=DEFAULT_WATCHDOG_TIMEOUT,
                        help='watchdog 阶段等新引擎的超时秒（默认 150）')
    common.add_argument('--force-stop-wait', type=float, default=DEFAULT_FORCE_STOP_WAIT,
                        help='force-stop 后静置秒（默认 5）')
    common.add_argument('--cleanup-timeout', type=float, default=DEFAULT_CLEANUP_TIMEOUT,
                        help='cleanup 阶段轮询超时秒（默认 60）')
    common.add_argument('--listen-timeout', type=float, default=DEFAULT_LISTEN_TIMEOUT,
                        help='fallback 等 3080 LISTEN 的超时秒（默认 60）')
    common.add_argument('--relax-listen-tcp6', action='store_true',
                        help='放宽监听判据：允许只在 /proc/net/tcp6 命中（个别 ROM 上 node 只出现在 tcp6）')
    common.add_argument('--stop-shizuku-server', action='store_true',
                        help='fallback 阶段额外 kill -9 shell uid 的 shizuku_server（默认关闭）')
    common.add_argument('--fallback-kill-engine', action='store_true',
                        help='fallback 阶段先 kill -9 托管引擎，强制走 App 内引擎回落（默认关闭）')

    sub = parser.add_subparsers(dest='phase')
    for name, help_text in (('hosted-boot', '引擎由 Shizuku 托管启动（六阶段之一）'),
                            ('force-stop', 'App 被杀后引擎存活 + 复用'),
                            ('reinstall', 'APK 覆盖安装后引擎存活 + 复用'),
                            ('watchdog', 'kill -9 引擎 → 看门狗自愈'),
                            ('fallback', 'Shizuku 不可用 → App 内引擎回落'),
                            ('cleanup', 'hosted stop / cleanup + 会话数据保留'),
                            ('selftest', '只读管道自检（不改设备状态）'),
                            ('all', '按顺序跑全部六个阶段')):
        sub.add_parser(name, parents=[common], help=help_text, description=help_text)
    parser.set_defaults(**COMMON_DEFAULTS)
    return parser


def ensure_stdout_utf8():
    """stdout 切 UTF-8（本机 Python 默认编码可能是 gbk，中文判据会乱码）。"""
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass


def rep_finish(rep):
    """打印汇总 + 写报告；返回退出码（有 FAIL → 1）。"""
    n = rep.counts()
    print('', flush=True)
    print('=== 汇总: PASS %d / FAIL %d / INFO %d / MANUAL %d ==='
          % (n.get('PASS', 0), n.get('FAIL', 0), n.get('INFO', 0), n.get('MANUAL', 0)), flush=True)
    ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report_path = os.path.join(OUT_DIR, 'b67_residency_report_%s.md' % ts)
    if rep.save(report_path):
        print('报告: %s' % report_path, flush=True)
    fails = n.get('FAIL', 0)
    print('结论: %s' % ('PASS（无 FAIL）' if fails == 0 else 'FAIL（%d 条判据失败）' % fails), flush=True)
    if n.get('MANUAL', 0):
        print('提示: %d 条 MANUAL 步骤需要人工处理（不影响退出码，见报告）。' % n['MANUAL'], flush=True)
    return 1 if fails else 0


def main(argv=None):
    global SERIAL, SERIAL_SOURCE, POLL_SECONDS, OUT_DIR, APK_PATH, RELAX_TCP6, DEVICE_INFO
    ensure_stdout_utf8()
    args = build_parser().parse_args(argv)
    if not args.phase:
        args.phase = 'all'

    serial, src = resolve_serial(args.serial)
    if serial is None:
        print(src, flush=True)
        return 2
    SERIAL, SERIAL_SOURCE = serial, src
    POLL_SECONDS = max(1.0, args.poll_seconds)
    OUT_DIR = os.path.abspath(args.out_dir)
    APK_PATH = args.apk if os.path.isabs(args.apk) else os.path.join(REPO_ROOT, args.apk)
    RELAX_TCP6 = bool(args.relax_listen_tcp6)

    rep = Report(args.phase)
    print('=== 批次67 托管引擎 —— 真机 e2e (phase=%s serial=%s) ===' % (args.phase, SERIAL), flush=True)
    print('INFO  env.serial  %s（来源: %s）' % (SERIAL, src), flush=True)
    print('INFO  env.apk     %s（存在=%s）' % (APK_PATH, os.path.isfile(APK_PATH)), flush=True)
    print('INFO  env.out_dir %s' % OUT_DIR, flush=True)

    rep.note('engine.log 等所有读取出口均已打码 token=[redacted]（统一走 redact()，落盘前再走 leak_scan()）。')
    rep.note('宿主通道断言依赖 Shizuku 处于激活状态；本机 ROM 上 am force-stop moe.shizuku.privileged.api '
             '不一定停掉 shell uid 的 shizuku_server —— fallback 阶段会把该事实写进证据'
             '（可用 --stop-shizuku-server 额外停掉，默认关闭）。')
    rep.note('监听判据按冻结契约严格只认 /proc/net/tcp 的 %s:%s（st=%s）；若某些 ROM/构建下 node 只出现在 '
             '/proc/net/tcp6 的 v4 映射地址，可用 --relax-listen-tcp6 放宽（判据详情会标注）。'
             % (LOOPBACK_HEX, ENGINE_PORT_HEX, LISTEN_ST))
    rep.note('cleanup 判据（%s 不存在、%s 保留）与实现的目录布局强耦合；实现若换 DSH 根目录，需同步脚本常量。'
             % (DSH_DIR, DSH_HOME))
    rep.note('watchdog 阶段允许的写操作只有 kill -9 引擎 pid；脚本会用 am start 计数证明该阶段没有启动 App。')
    rep.note('fallback 阶段按工单只做 am force-stop Shizuku + 拉起 App：若托管引擎本来就活着，App 会复用而不是回落'
             '（判据详情会写明这一点）；需要强制走回落路径时加 --fallback-kill-engine（默认关闭）。')

    rc, state = adb(['get-state'], timeout=25)
    if rc != 0 or state.strip() != 'device':
        rep.fail('env.adb_device', 'adb -s %s get-state → rc=%s %s' % (SERIAL, rc, oneline(state)))
        rep.excerpt('env.adb devices', adb(['devices'])[1])
        return rep_finish(rep)
    rep.pass_('env.adb_device', 'get-state=device（来源: %s）' % src)
    DEVICE_INFO = device_info()
    rep.info('env.device', DEVICE_INFO)
    shizuku = shizuku_rows()
    rep.info('env.shizuku', 'Shizuku 相关进程: %s'
             % (oneline('; '.join('pid=%s/user=%s/name=%s' % (r['pid'], r.get('user'), r.get('name'))
                                  for r in shizuku)) or '(无)'))

    ctx = load_state()
    print('INFO  state.carry %s'
          % (compact({k: ctx[k] for k in sorted(ctx) if k != 'phases'})[:300] or '(无)'), flush=True)
    try:
        if args.phase in ('hosted-boot', 'all'):
            phase_hosted_boot(rep, ctx, args)
        if args.phase in ('force-stop', 'all'):
            phase_force_stop(rep, ctx, args)
        if args.phase in ('reinstall', 'all'):
            phase_reinstall(rep, ctx, args)
        if args.phase in ('watchdog', 'all'):
            phase_watchdog(rep, ctx, args)
        if args.phase in ('fallback', 'all'):
            phase_fallback(rep, ctx, args)
        if args.phase in ('cleanup', 'all'):
            phase_cleanup(rep, ctx, args)
        if args.phase == 'selftest':
            phase_selftest(rep, ctx, args)
    except KeyboardInterrupt:
        rep.fail('runtime.interrupted', '收到 Ctrl+C，已停止（报告仍会落盘）')
    except Exception as exc:
        rep.fail('runtime.exception', '脚本内部异常（已收敛，不抛栈）: %s: %s' % (type(exc).__name__, exc))

    return rep_finish(rep)


if __name__ == '__main__':
    sys.exit(main())
