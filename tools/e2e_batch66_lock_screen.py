#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次66「锁屏挂机不中断」方案 —— 真机端到端复测脚手架（只取证 + 判定，不做任何修复动作）。

用法
----
    python tools/e2e_batch66_lock_screen.py --help
    python tools/e2e_batch66_lock_screen.py --phase all --lock-seconds 180 --poll-seconds 10
    python tools/e2e_batch66_lock_screen.py --phase reuse
    python tools/e2e_batch66_lock_screen.py --phase lock    --lock-seconds 300
    python tools/e2e_batch66_lock_screen.py --phase debounce
    python tools/e2e_batch66_lock_screen.py --phase cleanup

前置条件（脚本不会替你补，缺一条就先修环境）
--------------------------------------------
1. 真机已连接：adb devices 能看到 <serial>（默认 SN-HONOR-XXXX / Honor BKQ-AN10 / MagicOS 11）。
2. DeepSeek Harness App 进程存活：3081 本地桥由 MainActivity 提供，App 被杀则所有 HTTP 直接失败。
3. 设备上装的是批次66 产物（服务端 BUILD = b12）。
4. .local/b66_evidence/token.txt 存在：单行 32 位 hex 本地桥 token（gitignored）。
   脚本自己建立 adb forward（本机 13081→设备 3081 / 本机 18998→设备 8998），无需手工前置。

结构
----
* 基础设施：http_json / http_bytes / adb / adb_shell / logcat_tail / logcat_clear /
  dump_power / get_doze_always_on / list_dsh_pids / api_status / api_create / api_see / server_health。
* 判据：每个判据一个 check_<阶段>_<判据>() 小函数，返回 (name, status, detail)；
  阶段函数只负责取数 + rep.add(*check_xxx(...))，保证一判据一行输出。
* 证据：Report 收集判据行与原始 JSON / logcat / dumpsys 摘录，统一脱敏后写入 markdown 报告。

设计要点（对齐批次66 取证契约）
--------------------------------
* 全部 HTTP 走标准库 urllib（不依赖 requests），单请求超时 20s（create 另给 60s）；
  任何网络/解析异常都收敛成 "ERROR:<原因>" 文本，绝不抛栈崩掉整轮复测。
* token 明文永不出现在 stdout 与报告文件里：所有输出出口统一过 redact()，
  匹配 [0-9a-f]{32} 的串一律替换成 <TOKEN>。
* 每个判据打印一行 "PASS/FAIL/INFO  <判据名>  <证据摘要>"（ASCII 前缀便于 grep），
  末尾打印汇总，并把每个判据的原始 JSON / logcat / dumpsys 摘录写入
  .local/b66_evidence/b66_lock_report_<UTC时间戳>.md。
* 黑帧签名（批次14f 已知坑）：/vscreen/see 的 PNG 若恒为同一 sha1（历史上是 13840B 恒定帧），
  即判定画面冻结 → lock 阶段的 lock.frame_advance 判据 FAIL 并打印字节数列表。

设备写操作清单（有意为之，其余全部只读）
----------------------------------------
  logcat -G 8M / logcat -c（取证缓冲）、input keyevent 223|224（入睡/唤醒）、
  kill -9 <服务端 pid>（debounce 阶段有意制造真死，root 通道下补一次 su -c 兜底）。

与工单的一处显式偏差（已在判据名与报告中标注）
----------------------------------------------
cleanup 阶段除 POST /vscreen/close 外，追加一次 POST /vscreen/shutdown。
原因（读源码取证，非猜测）：vscreen shutdown done 只在 VscreensManager.shutdown() 里打印、
doze_always_on 的还原（restoreDozeAod）也只在 shutdown() 里做；
handleClose() 只做 close 透传 + 释放 wakelock/面板锁/广播，既不杀服务端也不还原 AOD。
只发 close 会让 cleanup 的三条判据（无 dsh-vscreen 进程 / AOD 还原 / shutdown done）结构性必挂。
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

# =============================================================================================
# 常量与全局配置
# =============================================================================================

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE_DIR = os.path.join(REPO_ROOT, '.local', 'b66_evidence')

# 批次97：真机序列号已脱敏；用 ANDROID_SERIAL=<serial> 指定目标设备。
DEFAULT_SERIAL = os.environ.get('ANDROID_SERIAL', 'SN-HONOR-XXXX')   # Honor BKQ-AN10 / MagicOS 11（以 adb devices 实时输出为准）
DEFAULT_TOKEN_FILE = os.path.join(EVIDENCE_DIR, 'token.txt')

BRIDGE_PORT = 13081                          # 本机 tcp:13081 → 设备 tcp:3081（App 本地桥）
SERVER_PORT = 18998                          # 本机 tcp:18998 → 设备 tcp:8998（dsh-vscreen 服务端直连）
DEVICE_BRIDGE_PORT = 3081
DEVICE_SERVER_PORT = 8998

LOG_TAG = 'VscreensManager'                  # 唯一日志 tag（I/W 级）
SERVER_VERSION_EXPECT = 'b12'                # 批次66 服务端 BUILD

HTTP_TIMEOUT = 20.0                          # 判据/取证用单请求超时（契约要求 20s）
CREATE_TIMEOUT = 60.0                        # create 可能触发换道拉起服务端 + 建屏，单独放宽
DEBOUNCE_WINDOW_SECONDS = 200.0              # debounce 判据固定窗口（脚本内常量，非 CLI 开关）
UNLOCK_WAIT_SECONDS = 30.0                   # 解锁后等 "screen-off grace cleared" 的时间
CLEANUP_WINDOW_SECONDS = 60.0                # cleanup 收尾轮询窗口

TOKEN_RE = re.compile(r'[0-9a-fA-F]{32}')    # 32 位 hex token 明文
LOG_TS_RE = re.compile(r'^(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})')
MISS_RE = re.compile(r'health miss (\d+)/(\d+)')
PID_IN_HEALTH_RE = re.compile(r'"pid":(\d+)')
FENCE = chr(96) * 3                          # markdown 围栏（避免源码里出现反引号）

# 运行期由 main() 赋值（避免每个函数都传一串参数）
SERIAL = DEFAULT_SERIAL
TOKEN = ''
POLL_SECONDS = 10.0


# =============================================================================================
# 输出安全与文本工具
# =============================================================================================

def redact(text):
    """把 32 位 hex token 明文替换成 <TOKEN>；本脚本任何输出路径都必须先过这里。"""
    if text is None:
        return ''
    return TOKEN_RE.sub('<TOKEN>', str(text))


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


# =============================================================================================
# 判据收集 / 报告落盘
# =============================================================================================

class Report(object):
    """判据结果 + 原始证据收集；落盘前统一脱敏。"""

    def __init__(self, phase, lock_seconds):
        self.phase = phase
        self.lock_seconds = lock_seconds
        self.rows = []       # [(name, status, detail)]
        self.sections = []   # [(title, body_text)]
        self.started = datetime.datetime.now(datetime.timezone.utc)

    # ---- 判据输出（PASS/FAIL/INFO  <判据名>  <证据摘要>）----
    def add(self, name, status, detail):
        status = str(status).upper()
        detail = oneline(redact(detail))
        print('%s  %s  %s' % (status, name, detail), flush=True)
        self.rows.append((name, status, detail))

    def pass_(self, name, detail):
        self.add(name, 'PASS', detail)

    def fail(self, name, detail):
        self.add(name, 'FAIL', detail)

    def info(self, name, detail):
        self.add(name, 'INFO', detail)

    # ---- 原始证据摘录 ----
    def excerpt(self, title, body):
        if body is None:
            body = '(空)'
        if not isinstance(body, str):
            body = json.dumps(body, ensure_ascii=False, indent=2, default=str)
        self.sections.append((title, redact(body)))

    def counts(self):
        n = {'PASS': 0, 'FAIL': 0, 'INFO': 0}
        for _name, status, _detail in self.rows:
            n[status] = n.get(status, 0) + 1
        return n

    def save(self, path):
        """写 markdown 报告：头部元信息 + 判据表 + 原始证据摘录。"""
        n = self.counts()
        out = []
        out.append('# 批次66 锁屏挂机不中断方案 —— 真机复测报告')
        out.append('')
        out.append('- UTC 开始: %s' % self.started.strftime('%Y-%m-%dT%H:%M:%SZ'))
        out.append('- UTC 结束: %s' % datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
        out.append('- 设备序列号: %s' % SERIAL)
        out.append('- 阶段: %s（lock_seconds=%s, poll_seconds=%s）' % (self.phase, self.lock_seconds, POLL_SECONDS))
        out.append('- 汇总: PASS %d / FAIL %d / INFO %d' % (n.get('PASS', 0), n.get('FAIL', 0), n.get('INFO', 0)))
        out.append('- 结论: %s' % ('PASS（无 FAIL）' if n.get('FAIL', 0) == 0 else 'FAIL（见下 FAIL 行）'))
        out.append('- token: 由 token 文件读取，明文已在所有输出中脱敏为 <TOKEN>')
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
        out.append('')
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write('\n'.join(out))
            return True
        except Exception as exc:
            print('INFO  report.write  ERROR: 报告落盘失败: %s' % exc, flush=True)
            return False


# =============================================================================================
# HTTP（urllib；失败一律收敛成 ERROR:<原因> 字符串）
# =============================================================================================

def _request(method, path, body=None, timeout=None, port=None):
    """统一 HTTP 出口：返回 (status|None, headers, payload_bytes, err|None)。"""
    timeout = HTTP_TIMEOUT if timeout is None else timeout
    port = BRIDGE_PORT if port is None else port
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        elif isinstance(body, str):
            data = body.encode('utf-8')
        else:
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request('http://127.0.0.1:%d%s' % (port, path), data=data, method=method)
    req.add_header('X-DSH-Token', TOKEN)   # 3081 桥与 8998 服务端同源 token（HTTP 头名大小写不敏感）
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read(), None
    except urllib.error.HTTPError as exc:
        try:
            payload = exc.read() or b''
        except Exception:
            payload = b''
        return exc.code, dict(exc.headers or {}), payload, None
    except Exception as exc:
        return None, {}, b'', 'ERROR: %s: %s' % (type(exc).__name__, exc)


def http_json(method, path, body=None, timeout=None, port=None):
    """返回 (status|None, data|None, err|None)；data 为解析后的 JSON。"""
    status, _headers, payload, err = _request(method, path, body=body, timeout=timeout, port=port)
    if err:
        return None, None, err
    if not payload:
        return status, None, 'ERROR: 空响应体 (HTTP %s)' % status
    try:
        return status, json.loads(payload.decode('utf-8', 'replace')), None
    except Exception as exc:
        return status, None, 'ERROR: JSON 解析失败 (%s): %s' % (exc, payload[:200])


def http_bytes(method, path, body=None, timeout=None, port=None):
    """返回 (status|None, payload_bytes, headers, err|None)。"""
    return _request(method, path, body=body, timeout=timeout, port=port)


def api_status():
    return http_json('GET', '/vscreen/status')


def api_create(body=None, timeout=CREATE_TIMEOUT):
    return http_json('POST', '/vscreen/create', body=('{}' if body is None else body), timeout=timeout)


def api_see():
    """采一帧虚拟屏：返回 dict(status/nbytes/sha1/err)。"""
    status, payload, _headers, err = http_bytes('GET', '/vscreen/see')
    if err:
        return {'status': None, 'nbytes': 0, 'sha1': '', 'err': err}
    if status != 200:
        return {'status': status, 'nbytes': len(payload or b''), 'sha1': '', 'err': None}   # 404 = NOT_CREATED
    if not payload:   # 真机踩过：200 但空 body（服务端/网关异常）会让 hashlib.sha1(None) 抛 TypeError 崩掉整轮
        return {'status': status, 'nbytes': 0, 'sha1': '', 'err': 'empty-body'}
    return {
        'status': status,
        'nbytes': len(payload),
        'sha1': hashlib.sha1(payload).hexdigest()[:12],   # 黑帧签名：字节数 + sha1 前 12 位
        'err': None,
    }


def server_health():
    """直连 8998 服务端 /health（经 adb forward 18998）。"""
    return http_json('GET', '/health', port=SERVER_PORT)


# =============================================================================================
# adb / 设备侧取证（全部走 subprocess 列表参数，避免 PowerShell 引号地狱）
# =============================================================================================

def adb(args, timeout=30):
    """执行 adb -s <serial> <args...>；返回 (rc, 文本)。永不抛异常。"""
    cmd = ['adb', '-s', SERIAL] + [str(a) for a in args]
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


def ensure_forwards():
    """建立本轮所需的两条 adb forward（幂等）。返回 (ok, detail)。"""
    details = []
    ok = True
    for local_port, device_port in ((BRIDGE_PORT, DEVICE_BRIDGE_PORT), (SERVER_PORT, DEVICE_SERVER_PORT)):
        rc, out = adb(['forward', 'tcp:%d' % local_port, 'tcp:%d' % device_port])
        if rc != 0:
            ok = False
        details.append('%d->%d rc=%s %s' % (local_port, device_port, rc, oneline(out)))
    return ok, '; '.join(details)


def enlarge_logcat_buffer():
    """取证前扩大环形缓冲（否则长窗口内早期关键行会被冲掉）。"""
    return adb_shell('logcat -G 8M')


def logcat_clear():
    return adb_shell('logcat -c')


def logcat_tail():
    """整份 VscreensManager 日志（-v time 便于统计时间戳间隔）。"""
    _rc, out = adb_shell('logcat -d -v time -s %s:V' % LOG_TAG)
    return out


def dump_power():
    """返回 (dsh: 前缀的 wakelock 行列表, dumpsys power 原文)。"""
    _rc, out = adb_shell('dumpsys power')
    lines = [ln.strip() for ln in out.splitlines() if 'dsh:' in ln]
    return lines, out


def get_doze_always_on():
    """读 AOD 设置（服务端会话期会被置 1，收尾还原）。"""
    _rc, out = adb_shell('settings get secure doze_always_on')
    return out.strip()


def list_dsh_pids():
    """返回 ([(pid, user)], ps 原文)：进程名含 dsh-vscreen 的条目（uid 0=root / 2000=shell）。"""
    _rc, out = adb_shell('ps -A')
    rows = []
    for line in out.splitlines():
        if 'dsh-vscreen' not in line:
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[1].isdigit():
            rows.append((int(parts[1]), parts[0]))
    return rows, out


def pid_from_logs():
    """status 拿不到 serverPid 时的兜底：从 "vscreen server healthy via ..." 行的 /health JSON 里取 pid。"""
    pid = None
    for line in logcat_tail().splitlines():
        if 'vscreen server healthy via' not in line:
            continue
        m = PID_IN_HEALTH_RE.search(line)
        if m:
            pid = int(m.group(1))
    return pid


# =============================================================================================
# 日志窗口 / 时间工具
# =============================================================================================

class LogCollector(object):
    """按轮次追加 logcat 新增行（行文本去重，保持首次出现顺序）。"""

    def __init__(self):
        self.lines = []
        self._seen = set()

    def poll(self):
        for line in logcat_tail().splitlines():
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

    def dump(self, limit=500):
        return '\n'.join(self.lines[-limit:]) if self.lines else '(窗口内无新增日志行)'


def parse_log_ts(line):
    """解析 logcat -v time 的 MM-DD HH:MM:SS.mmm 前缀为 epoch 秒；失败返回 None。"""
    m = LOG_TS_RE.match(line.strip())
    if not m:
        return None
    month, day, hour, minute, sec, ms = (int(x) for x in m.groups())
    now = datetime.datetime.now()
    year = now.year
    try:
        cand = datetime.datetime(year, month, day, hour, minute, sec, ms * 1000)
    except ValueError:
        return None
    if cand > now + datetime.timedelta(days=1):   # 跨年：日志时间在未来 -> 归到上一年
        cand = cand.replace(year=year - 1)
    return cand.timestamp()


def max_increasing_run(nums):
    """最长「每次 +1」的连续段长度（health miss n/3 的 1,2,3 连击）。"""
    best = run = 0
    prev = None
    for n in nums:
        run = run + 1 if (prev is not None and n == prev + 1) else 1
        prev = n
        best = max(best, run)
    return best


def wait_until(predicate, timeout, interval=3.0):
    """轮询等待谓词为真；返回 True/False。"""
    deadline = time.time() + max(0.0, timeout)
    while True:
        try:
            if predicate():
                return True
        except Exception:
            pass
        if time.time() >= deadline:
            return False
        time.sleep(min(interval, max(0.2, deadline - time.time())))


def poll_and_match(collector, *needles):
    """先拉一次 logcat，再判断窗口内是否命中。

    注意不能写成 collector.poll() or collector.has(...)：poll() 返回行列表，只要窗口里已经有
    任何一行日志它就是真值，会把等待条件短路成「立刻为真」而误判 PASS。
    """
    collector.poll()
    return collector.has(*needles)


def pid_alive(pid):
    """ps -A 里是否还有该 pid：True/False；ps 失败时返回 None（不可判定）。"""
    rows, out = list_dsh_pids()
    if out.startswith('ERROR:'):
        return None
    return any(p == pid for p, _u in rows)


def sleep_until(deadline, chunk=5.0):
    """分段睡眠到指定时刻（长窗口下便于日志滚动采集）。"""
    while True:
        remain = deadline - time.time()
        if remain <= 0:
            return
        time.sleep(min(chunk, remain))


# =============================================================================================
# 判据：reuse（未指定尺寸必须复用现有 display，绝不因默认值差异销毁重建）
# =============================================================================================

def check_reuse_create_reused(d1, d2, e1, e2):
    """判据① 连续两次 create {}：第二次 reused==true 且 displayId 与第一次相同。"""
    name = 'reuse.create_reused'
    if e1 or e2 or not (d1 or {}).get('ok') or not (d2 or {}).get('ok'):
        return name, 'FAIL', 'create 调用失败: #1=%s #2=%s' % (e1 or compact(d1), e2 or compact(d2))
    did1, did2 = d1.get('displayId'), d2.get('displayId')
    if d2.get('reused') is True and did1 is not None and did1 == did2:
        return name, 'PASS', 'displayId=%s 二次 reused=true strategy=%s' % (did2, d2.get('strategy'))
    return name, 'FAIL', ('期望 reused=true 且 displayId 相同，实际 #1.displayId=%s #2.displayId=%s #2.reused=%s'
                          % (did1, did2, d2.get('reused')))


def check_reuse_explicit_keep(d1, d3, d4, e3, e4):
    """判据② 显式尺寸 create 后再 create {}：displayId 不得变化（不得销毁重建）。"""
    name = 'reuse.explicit_keep'
    if e3 or e4 or not (d3 or {}).get('ok') or not (d4 or {}).get('ok'):
        return name, 'FAIL', 'create 调用失败: 显式=%s 其后={}=%s' % (e3 or compact(d3), e4 or compact(d4))
    ids = [d1.get('displayId') if isinstance(d1, dict) else None, d3.get('displayId'), d4.get('displayId')]
    if ids[0] is not None and ids[0] == ids[1] == ids[2]:
        return name, 'PASS', 'displayId 全程=%s（显式 1008x1792 未销毁重建）' % ids[2]
    return name, 'FAIL', 'displayId 序列=%s（期望三次全等，出现销毁重建）' % ids


def check_reuse_status_match(d1, st5, s5, e5):
    """判据③ /vscreen/status 的 displayId 与①一致。"""
    name = 'reuse.status_match'
    if e5 or st5 != 200 or not (s5 or {}).get('ok'):
        return name, 'FAIL', 'GET /vscreen/status 失败: %s' % (e5 or ('HTTP %s' % st5))
    want = d1.get('displayId') if isinstance(d1, dict) else None
    got = s5.get('displayId')
    if want is not None and got == want:
        return name, 'PASS', ('status.displayId=%s 与①一致（serverPid=%s channel=%s）'
                              % (got, s5.get('serverPid'), s5.get('channel')))
    return name, 'FAIL', 'status.displayId=%s 不等于①的 %s' % (got, want)


def check_reuse_server_b12(hst, h2, herr):
    """判据④ 直连 8998 /health 的 version 含 b12。"""
    name = 'reuse.server_b12'
    if herr or hst != 200 or not (h2 or {}).get('ok'):
        return name, 'FAIL', '直连 127.0.0.1:%d/health 失败: %s' % (SERVER_PORT, herr or ('HTTP %s' % hst))
    if SERVER_VERSION_EXPECT in str(h2.get('version', '')):
        return name, 'PASS', 'version=%s uid=%s pid=%s' % (h2.get('version'), h2.get('uid'), h2.get('pid'))
    return name, 'FAIL', 'version=%s 不含 %s（旧服务端未换掉）' % (h2.get('version'), SERVER_VERSION_EXPECT)


# =============================================================================================
# 判据：lock（锁屏窗口内的会话稳定性 / 面板保护 / 画面推进）
# =============================================================================================

def check_lock_grace_log(logs):
    """判据⑤ 出现灭屏宽限日志。"""
    name = 'lock.grace_log'
    hits = logs.match('[b66] screen off during vscreen session -> grace')
    if hits:
        return name, 'PASS', oneline(hits[0])
    return name, 'FAIL', '窗口内未出现 [b66] screen off during vscreen session -> grace ...（灭屏广播未注册/未收到？）'


def check_lock_panel_protect(logs):
    """判据⑥ 出现 panel keepalive acquired 或 panel still interactive 之一。"""
    name = 'lock.panel_protect'
    acquired = logs.match('panel keepalive acquired')
    interactive = logs.match('panel still interactive')
    if acquired or interactive:
        return name, 'PASS', oneline((acquired or interactive)[0])
    return name, 'FAIL', '窗口内既无 panel keepalive acquired 也无 panel still interactive（AOD/面板兜底均未走通）'


def check_lock_session_stable(samples, base_display, base_pid):
    """判据⑦ 窗口内 displayId 与 serverPid 均不变。"""
    name = 'lock.session_stable'
    bad = [s for s in samples if s['displayId'] != base_display or s['serverPid'] != base_pid]
    if not bad:
        return name, 'PASS', 'displayId 恒=%s serverPid 恒=%s（%d 次采样）' % (base_display, base_pid, len(samples))
    sids = sorted({str(s['displayId']) for s in samples})
    spids = sorted({str(s['serverPid']) for s in samples})
    return name, 'FAIL', ('窗口内会话标识漂移：displayId 集合=%s serverPid 集合=%s（基线 %s/%s）'
                          % (sids, spids, base_display, base_pid))


def check_lock_no_session_dead(logs):
    """判据⑧ 窗口内不得出现 vscreen session dead / killed vscreen server。"""
    name = 'lock.no_session_dead'
    dead = logs.match('vscreen session dead', 'killed vscreen server')
    if dead:
        return name, 'FAIL', '命中 %d 行: %s' % (len(dead), oneline(dead[0]))
    return name, 'PASS', '窗口内无 vscreen session dead / killed vscreen server'


def check_lock_frame_advance(samples):
    """判据⑨ see 采样 sha1 至少出现 2 个不同值（否则怀疑黑帧冻结）。"""
    name = 'lock.frame_advance'
    good = [s for s in samples if s['see_sha1']]
    sha1s = sorted({s['see_sha1'] for s in good})
    bytes_list = [s['see_bytes'] for s in samples]
    if len(good) < 2:
        return name, 'FAIL', ('see 成功样本不足（%d/%d），字节数列表=%s，末次错误=%s'
                              % (len(good), len(samples), bytes_list, (samples[-1]['see_err'] if samples else '')))
    if len(sha1s) >= 2:
        return name, 'PASS', 'sha1 去重=%d/%d %s' % (len(sha1s), len(good), sha1s)
    return name, 'FAIL', 'see 帧冻结（sha1 恒为 %s）—— 黑帧签名，字节数列表=%s' % (sha1s[0], bytes_list)


def check_lock_unlock_cleared(cleared_ok, acquired, released_ok):
    """判据⑩ 解锁后宽限清除（曾获取面板锁则还应看到 panel keepalive released）。"""
    name = 'lock.unlock_cleared'
    if not cleared_ok:
        return name, 'FAIL', '%ss 内未出现 [b66] screen on/unlock -> screen-off grace cleared' % int(UNLOCK_WAIT_SECONDS)
    if not acquired:
        return name, 'PASS', '宽限清除日志命中（本窗口未走面板保活分支，无需释放）'
    if released_ok:
        return name, 'PASS', '宽限清除 + panel keepalive released 均命中（曾获取面板锁）'
    return name, 'FAIL', '宽限已清除，但曾获取面板锁却未见 panel keepalive released（锁泄漏风险）'


# =============================================================================================
# 判据：debounce（真死后防抖 / 冷却 / 抢救链是否生效）
# =============================================================================================

def check_debounce_dead_count(dead_lines, gaps, dead_head):
    """debounce① vscreen session dead 次数 ≤ 2。"""
    name = 'debounce.dead_count'
    if len(dead_lines) <= 2:
        return name, 'PASS', 'session dead 次数=%d（<=2），间隔=%s' % (len(dead_lines), gaps)
    return name, 'FAIL', 'session dead 次数=%d（>2），间隔=%s | 样本: %s' % (len(dead_lines), gaps, dead_head)


def check_debounce_miss_streak(miss_ns, run):
    """debounce② ≥3 条连续 health miss（防抖阈值生效）。"""
    name = 'debounce.miss_streak'
    if run >= 3:
        return name, 'PASS', 'health miss 连续段最长=%d（序列 %s）' % (run, miss_ns[:12])
    return name, 'FAIL', 'health miss 最长连续段=%d（<3，防抖未生效）；序列=%s' % (run, miss_ns[:12])


def check_debounce_cooldown(cool):
    """debounce③ 出现 recovery cooling down（冷却生效）。"""
    name = 'debounce.cooldown'
    if cool:
        return name, 'PASS', oneline(cool[0])
    return name, 'FAIL', '窗口内未出现 vscreen recovery cooling down (<ms>ms left) -> skip kill/respawn'


def check_debounce_recovered(rec):
    """debounce④ 出现 vscreen session recovered via ...（有则记 PASS 证据）。"""
    name = 'debounce.recovered'
    if rec:
        return name, 'PASS', oneline(rec[-1])
    return name, 'INFO', '窗口内未出现 vscreen session recovered via <alt>（抢救未发起或未成功）'


def check_debounce_no_kill_loop(dead_lines, gaps):
    """debounce⑤ 不得出现「每 5s 一轮」的杀建循环（判死次数 >2 且存在 <60s 间隔）。"""
    name = 'debounce.no_kill_loop'
    if len(dead_lines) > 2 and any(gap < 60.0 for gap in gaps):
        return name, 'FAIL', '疑似 5s 级杀建循环：次数=%d 间隔=%s（存在 <60s 间隔）' % (len(dead_lines), gaps)
    return name, 'PASS', '次数=%d 间隔=%s（无 <60s 的连续判死）' % (len(dead_lines), gaps)


# =============================================================================================
# 判据：cleanup（会话收尾是否干净）
# =============================================================================================

def check_cleanup_no_process(last):
    """cleanup① 无 dsh-vscreen 进程。"""
    name = 'cleanup.no_process'
    if not last['pids']:
        return name, 'PASS', '60s 内 dsh-vscreen 进程已退出（末次采样无 pid）'
    return name, 'FAIL', '仍有 dsh-vscreen 进程存活: %s' % last['pids']


def check_cleanup_no_panel_lock(panel):
    """cleanup② dsh:vscreen-panel 不在 dumpsys power。"""
    name = 'cleanup.no_panel_lock'
    if not panel:
        return name, 'PASS', '收尾后 dumpsys power 无 dsh:vscreen-panel'
    return name, 'FAIL', '面板保活锁未释放: %s' % oneline(panel[-1])


def check_cleanup_doze_restored(got, baseline, baseline_source):
    """cleanup③ doze_always_on 回到 lock 阶段基线值。"""
    name = 'cleanup.doze_restored'
    if got == baseline:
        return name, 'PASS', 'doze_always_on=%s == 基线 %s' % (got, baseline)
    if baseline_source == 'lock':
        return name, 'FAIL', 'doze_always_on=%s 不等于 lock 阶段基线 %s（AOD 未还原）' % (got, baseline)
    return name, 'INFO', ('doze_always_on=%s 不等于本阶段起始值 %s，但基线取自会话进行中（未跑 lock 阶段），'
                          '无法判定是否未还原' % (got, baseline))


def check_cleanup_shutdown_log(logs):
    """cleanup④ 出现 vscreen shutdown done。"""
    name = 'cleanup.shutdown_log'
    hits = logs.match('vscreen shutdown done')
    if hits:
        return name, 'PASS', oneline(hits[-1])
    return name, 'FAIL', '60s 内未出现 vscreen shutdown done（会话收尾未走完）'


# =============================================================================================
# 阶段一：reuse
# =============================================================================================

def phase_reuse(rep, ctx):
    print('--- 阶段 reuse ---', flush=True)

    # 前置：App 本地桥存活（3081 由 MainActivity 提供）
    st, status, err = api_status()
    if err or st != 200 or not (status or {}).get('ok'):
        rep.fail('reuse.bridge_alive',
                 'GET /vscreen/status 失败: %s' % (err or ('HTTP %s %s' % (st, compact(status)))))
        return
    rep.pass_('reuse.bridge_alive', 'status=%s' % compact(status))
    rep.excerpt('reuse 前置 /vscreen/status', compact(status))

    # 附带探测（非判据）：App 桥只暴露 status/create/close/shutdown/key/launch/see/tap/swipe，
    # 没有 /vscreen/health；这里探一次仅作 INFO 记录，避免被误读成判据失败。
    hst, hdata, herr = http_json('GET', '/vscreen/health')
    rep.info('reuse.app_health_probe',
             'App 桥 /vscreen/health → HTTP %s %s' % (hst, compact(hdata) if hdata else (herr or '')))

    # 数据：连续两次 create {} → 显式尺寸 create → 再 create {} → status
    st1, d1, e1 = api_create('{}')
    st2, d2, e2 = api_create('{}')
    st3, d3, e3 = api_create({'width': 1008, 'height': 1792})
    st4, d4, e4 = api_create('{}')
    st5, s5, e5 = api_status()
    hst2, h2, herr2 = server_health()
    rep.excerpt('reuse create#1 响应', compact({'http': st1, 'body': d1, 'err': e1}))
    rep.excerpt('reuse create#2 响应', compact({'http': st2, 'body': d2, 'err': e2}))
    rep.excerpt('reuse 显式尺寸 create 响应', compact({'http': st3, 'body': d3, 'err': e3}))
    rep.excerpt('reuse 其后 create {} 响应', compact({'http': st4, 'body': d4, 'err': e4}))
    rep.excerpt('reuse 收尾 /vscreen/status', compact({'http': st5, 'body': s5, 'err': e5}))
    rep.excerpt('reuse 直连 8998 /health', compact({'http': hst2, 'body': h2, 'err': herr2}))

    rep.add(*check_reuse_create_reused(d1, d2, e1, e2))
    rep.add(*check_reuse_explicit_keep(d1, d3, d4, e3, e4))
    rep.add(*check_reuse_status_match(d1, st5, s5, e5))
    rep.add(*check_reuse_server_b12(hst2, h2, herr2))

    if isinstance(s5, dict):
        ctx['display_id'] = s5.get('displayId')
        ctx['server_pid'] = s5.get('serverPid')


# =============================================================================================
# 阶段二：lock
# =============================================================================================

def phase_lock(rep, ctx, lock_seconds):
    print('--- 阶段 lock（窗口 %ss）---' % int(lock_seconds), flush=True)

    # 前置：必须有活跃 display，否则 lock 阶段无意义
    st, status, err = api_status()
    if err or st != 200 or not (status or {}).get('ok'):
        rep.fail('lock.active_display',
                 '状态不可读: %s（App 进程死了？先跑 --phase reuse）' % (err or ('HTTP %s' % st)))
        return
    base_display = status.get('displayId')
    base_pid = status.get('serverPid')
    if base_display is None or base_display == -1:
        rep.fail('lock.active_display',
                 '当前无活跃 display（displayId=%s）—— 先跑 --phase reuse 或在 App 里发起一次虚拟屏任务'
                 % base_display)
        return
    rep.pass_('lock.active_display', 'displayId=%s serverPid=%s channel=%s strategy=%s'
              % (base_display, base_pid, status.get('channel'), status.get('strategy')))

    # 基线：AOD 设置 + wakelock 现状（清 logcat 之前先记录）
    base_doze = get_doze_always_on()
    ctx['doze_baseline'] = base_doze
    ctx['doze_baseline_source'] = 'lock'
    base_power, _power_raw = dump_power()
    rep.info('lock.doze_baseline', 'doze_always_on=%s（收尾判定基线）' % base_doze)
    rep.info('lock.wakelock_baseline', 'dsh: 前缀 wakelock 行=%s' % (base_power if base_power else '(无)'))
    rep.excerpt('lock 基线 dumpsys power（dsh: 行）', '\n'.join(base_power) if base_power else '(无 dsh: wakelock)')

    # 取证准备：扩大缓冲 + 清空，随后入睡
    rc_g, out_g = enlarge_logcat_buffer()
    rep.info('lock.logcat_buffer', 'logcat -G 8M → rc=%s %s' % (rc_g, oneline(out_g)))
    rc_c, _out_c = logcat_clear()
    if rc_c != 0:
        rep.info('lock.logcat_clear', 'logcat -c 返回 rc=%s（继续，日志窗口可能不干净）' % rc_c)

    rc_off, out_off = adb_shell('input keyevent 223')
    rep.info('lock.screen_off_inject', 'keyevent 223（入睡）rc=%s %s' % (rc_off, oneline(out_off)))

    # ---- 窗口内轮询采样 ----
    logs = LogCollector()
    samples = []
    deadline = time.time() + max(1.0, lock_seconds)
    while True:
        logs.poll()
        _stx, stx_body, stx_err = api_status()
        see = api_see()
        power_lines, _power_raw = dump_power()
        samples.append({
            'at': datetime.datetime.now().strftime('%H:%M:%S'),
            'displayId': (stx_body or {}).get('displayId') if isinstance(stx_body, dict) else None,
            'serverPid': (stx_body or {}).get('serverPid') if isinstance(stx_body, dict) else None,
            'status_err': stx_err,
            'see_status': see['status'],
            'see_bytes': see['nbytes'],
            'see_sha1': see['sha1'],
            'see_err': see['err'],
            'doze_always_on': get_doze_always_on(),
            'power_dsh': power_lines,
        })
        if time.time() >= deadline:
            break
        sleep_until(min(deadline, time.time() + max(1.0, POLL_SECONDS)), chunk=max(1.0, POLL_SECONDS))
    logs.poll()

    rep.excerpt('lock 窗口采样表', json.dumps(samples, ensure_ascii=False, indent=2))
    rep.excerpt('lock 窗口内新增日志（VscreensManager）', logs.dump())
    power_groups = [s['power_dsh'] for s in samples if s['power_dsh']]
    rep.excerpt('lock 窗口内 dumpsys power（dsh: 行，去重）',
                '\n'.join(sorted({ln for group in power_groups for ln in group})) or '(无 dsh: wakelock)')

    # ---- 判据⑤⑥⑦⑧⑨（窗口内证据） ----
    rep.add(*check_lock_grace_log(logs))
    rep.add(*check_lock_panel_protect(logs))
    rep.add(*check_lock_session_stable(samples, base_display, base_pid))
    rep.add(*check_lock_no_session_dead(logs))
    rep.add(*check_lock_frame_advance(samples))

    # 附带 INFO：AOD 复述 / 偏好关闭
    aod = logs.match('doze_always_on reasserted')
    if aod:
        rep.info('lock.aod_reassert', oneline(aod[-1]))
    if logs.has('panel keepalive disabled by preference'):
        rep.info('lock.panel_keepalive_pref', '面板保活被偏好关闭（vscreen_lock_panel_keepalive=false）')

    # ---- 判据⑩ 解锁 + 宽限清除（曾获取面板锁则还应释放） ----
    acquired = logs.match('panel keepalive acquired')
    rc_on, out_on = adb_shell('input keyevent 224')
    rep.info('lock.screen_on_inject', 'keyevent 224（唤醒）rc=%s %s' % (rc_on, oneline(out_on)))
    cleared_ok = wait_until(
        lambda: poll_and_match(logs, '[b66] screen on/unlock -> screen-off grace cleared'),
        UNLOCK_WAIT_SECONDS, interval=3.0)
    released_ok = False
    if cleared_ok and acquired:
        released_ok = wait_until(lambda: poll_and_match(logs, 'panel keepalive released'), 15.0, interval=2.0)
    rep.add(*check_lock_unlock_cleared(cleared_ok, acquired, released_ok))

    release_lines = logs.match('panel keepalive released')
    if release_lines:
        rep.info('lock.panel_release_log', oneline(release_lines[-1]))
    rep.excerpt('lock 收尾日志（含解锁后新增）', logs.dump())


# =============================================================================================
# 阶段三：debounce
# =============================================================================================

def phase_debounce(rep, ctx):
    print('--- 阶段 debounce（窗口 %ss）---' % int(DEBOUNCE_WINDOW_SECONDS), flush=True)

    # 前置：取服务端 pid（status 优先，logcat 兜底）
    _st, status, err = api_status()
    pid = (status or {}).get('serverPid') if isinstance(status, dict) else None
    pid_src = 'status/serverPid'
    if not pid:
        pid = pid_from_logs()
        pid_src = 'logcat(vscreen server healthy via /health pid)'
    if not pid:
        rep.fail('debounce.kill',
                 '拿不到服务端 pid（status=%s err=%s），无法制造真死 —— 先跑 --phase reuse' % (compact(status), err))
        return
    rep.info('debounce.pid', 'pid=%s 来源=%s' % (pid, pid_src))

    procs, _ps_raw = list_dsh_pids()
    rep.excerpt('debounce 前置进程表（ps -A 过滤 dsh-vscreen）',
                '\n'.join('%s user=%s' % (p, u) for p, u in procs) or '(无)')
    if procs:
        rep.info('debounce.channel_uid', 'dsh-vscreen 进程 uid=%s（0=root 通道 / 2000=shell=shizuku 通道）'
                 % ','.join(sorted({u for _p, u in procs})))

    # ---- 真死注入：清 logcat → kill -9 ----
    logs = LogCollector()
    logcat_clear()
    rc_k, out_k = adb_shell('kill -9 %s' % pid)
    rep.info('debounce.kill_cmd', 'kill -9 %s rc=%s %s' % (pid, rc_k, oneline(out_k)))
    gone = wait_until(lambda: pid_alive(int(pid)) is False, 4.0, interval=1.0)
    if not gone:
        rc_su, out_su = adb_shell('su -c "kill -9 %s"' % pid, timeout=15)
        rep.info('debounce.kill_fallback', 'shell 无权限（root 通道）→ su 兜底 rc=%s %s' % (rc_su, oneline(out_su)))
        gone = wait_until(lambda: pid_alive(int(pid)) is False, 5.0, interval=1.0)
    if gone:
        rep.pass_('debounce.kill', 'pid=%s 已确认消失（真死注入成功）' % pid)
    else:
        rep.fail('debounce.kill', 'pid=%s 杀不掉（仍在 ps -A 中），本阶段后续判据不可信' % pid)
        return

    # ---- 200s 轮询窗口 ----
    deadline = time.time() + DEBOUNCE_WINDOW_SECONDS
    samples = []
    while True:
        logs.poll()
        _stx, stx_body, _stx_err = api_status()
        samples.append({
            'at': datetime.datetime.now().strftime('%H:%M:%S'),
            'displayId': (stx_body or {}).get('displayId') if isinstance(stx_body, dict) else None,
            'serverPid': (stx_body or {}).get('serverPid') if isinstance(stx_body, dict) else None,
            'channel': (stx_body or {}).get('channel') if isinstance(stx_body, dict) else None,
        })
        if time.time() >= deadline:
            break
        sleep_until(min(deadline, time.time() + max(2.0, POLL_SECONDS)), chunk=max(2.0, POLL_SECONDS))
    logs.poll()
    rep.excerpt('debounce 窗口采样表', json.dumps(samples, ensure_ascii=False, indent=2))
    rep.excerpt('debounce 窗口内新增日志（VscreensManager）', logs.dump())

    dead_lines = logs.match('vscreen session dead')
    dead_ts = [t for t in (parse_log_ts(ln) for ln in dead_lines) if t is not None]
    gaps = [round(dead_ts[i + 1] - dead_ts[i], 1) for i in range(len(dead_ts) - 1)]
    miss_ns = [int(m.group(1)) for ln in logs.match('vscreen health miss')
               for m in [MISS_RE.search(ln)] if m]

    # ---- 判据①②③④⑤ ----
    rep.add(*check_debounce_dead_count(dead_lines, gaps, '; '.join(oneline(ln) for ln in dead_lines[:4])))
    rep.add(*check_debounce_miss_streak(miss_ns, max_increasing_run(miss_ns)))
    rep.add(*check_debounce_cooldown(logs.match('vscreen recovery cooling down')))
    rep.add(*check_debounce_recovered(logs.match('vscreen session recovered via')))
    rep.add(*check_debounce_no_kill_loop(dead_lines, gaps))

    # 附带：窗口结束态与进程表
    stz, szt, _erz = api_status()
    procs2, _ps_raw2 = list_dsh_pids()
    rep.info('debounce.end_state', 'HTTP=%s %s' % (stz, compact(szt)))
    rep.excerpt('debounce 收尾进程表', '\n'.join('%s user=%s' % (p, u) for p, u in procs2) or '(无 dsh-vscreen 进程)')
    rep.excerpt('debounce 收尾 /vscreen/status', compact(szt))
    ctx['server_pid'] = (szt or {}).get('serverPid') if isinstance(szt, dict) else None


# =============================================================================================
# 阶段四：cleanup
# =============================================================================================

def phase_cleanup(rep, ctx):
    print('--- 阶段 cleanup ---', flush=True)

    baseline = ctx.get('doze_baseline')
    baseline_source = ctx.get('doze_baseline_source')
    if baseline is None:
        baseline = get_doze_always_on()
        baseline_source = 'cleanup_start'
    rep.info('cleanup.doze_baseline', 'doze_always_on 基线=%s（来源=%s）' % (baseline, baseline_source))

    # 会话收尾：close（契约路由）+ shutdown（见文件头偏差说明）
    st1, c1, e1 = http_json('POST', '/vscreen/close', body='{}', timeout=30)
    rep.info('cleanup.close', 'POST /vscreen/close → HTTP %s %s' % (st1, compact(c1) if c1 else (e1 or '')))
    rep.excerpt('cleanup close 响应', compact({'http': st1, 'body': c1, 'err': e1}))
    st2, c2, e2 = http_json('POST', '/vscreen/shutdown', body='{}', timeout=30)
    rep.info('cleanup.shutdown', 'POST /vscreen/shutdown（显式收尾：shutdown done + AOD 还原）→ HTTP %s %s'
             % (st2, compact(c2) if c2 else (e2 or '')))
    rep.excerpt('cleanup shutdown 响应', compact({'http': st2, 'body': c2, 'err': e2}))

    # ---- 60s 轮询收尾 ----
    logs = LogCollector()
    deadline = time.time() + CLEANUP_WINDOW_SECONDS
    samples = []
    while True:
        logs.poll()
        procs, _ps = list_dsh_pids()
        power_lines, _raw = dump_power()
        samples.append({
            'at': datetime.datetime.now().strftime('%H:%M:%S'),
            'pids': [p for p, _u in procs],
            'power_dsh': power_lines,
            'doze_always_on': get_doze_always_on(),
            'shutdown_done': logs.has('vscreen shutdown done'),
        })
        if time.time() >= deadline:
            break
        sleep_until(min(deadline, time.time() + max(2.0, POLL_SECONDS)), chunk=max(2.0, POLL_SECONDS))
    logs.poll()
    rep.excerpt('cleanup 采样表', json.dumps(samples, ensure_ascii=False, indent=2))
    rep.excerpt('cleanup 窗口内新增日志（VscreensManager）', logs.dump())

    last = samples[-1] if samples else {'pids': [], 'power_dsh': [], 'doze_always_on': ''}
    panel = [ln for s in samples for ln in s['power_dsh'] if 'dsh:vscreen-panel' in ln]

    # ---- 判据①②③④ ----
    rep.add(*check_cleanup_no_process(last))
    rep.add(*check_cleanup_no_panel_lock(panel))
    rep.add(*check_cleanup_doze_restored(last['doze_always_on'], baseline, baseline_source))
    rep.add(*check_cleanup_shutdown_log(logs))

    stx, szt, _erx = api_status()
    rep.excerpt('cleanup 收尾 /vscreen/status', compact({'http': stx, 'body': szt}))
    rep.info('cleanup.end_state', 'HTTP=%s %s' % (stx, compact(szt)))


# =============================================================================================
# CLI / 主流程
# =============================================================================================

EPILOG = """前置条件:
  1. 真机已连接（默认序列号 %s，以 adb devices 实时输出为准）
  2. DeepSeek Harness App 进程存活（3081 本地桥由 MainActivity 提供）
  3. 设备上是批次66 产物（服务端 BUILD=b12）
  4. token 文件存在: %s（单行 32 位 hex，gitignored）—— 脚本只读取，不打印明文

阶段说明:
  reuse     连续两次 create {} 复用语义 + 显式尺寸不打碎会话 + status/version 一致性
  lock      清 logcat → keyevent 223 入睡 → 按 poll-seconds 轮询 lock-seconds 秒 → keyevent 224 解锁
  debounce  kill -9 服务端制造真死 → 200s 窗口统计判死次数/防抖连击/冷却/recovered
  cleanup   POST /vscreen/close（+ 追加 /vscreen/shutdown，见模块开头偏差说明）→ 轮询 60s 收尾判定
  all       依次执行 reuse → lock → debounce → cleanup

报告: %s/b66_lock_report_<UTC时间戳>.md （含每个判据的原始 JSON / logcat / dumpsys 摘录）
""" % (DEFAULT_SERIAL, DEFAULT_TOKEN_FILE, EVIDENCE_DIR)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        prog='e2e_batch66_lock_screen.py',
        description='批次66 锁屏挂机不中断方案 —— 真机端到端复测脚手架（只取证与判定，不做修复）',
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--serial', default=DEFAULT_SERIAL, help='adb 设备序列号（默认 %s）' % DEFAULT_SERIAL)
    parser.add_argument('--token-file', default=DEFAULT_TOKEN_FILE,
                        help='本地桥 token 文件（单行 32 位 hex；默认 %s）' % DEFAULT_TOKEN_FILE)
    parser.add_argument('--phase', default='all', choices=['reuse', 'lock', 'debounce', 'cleanup', 'all'],
                        help='要执行的阶段（默认 all）')
    parser.add_argument('--lock-seconds', type=float, default=180.0, help='lock 阶段锁屏观察窗口秒数（默认 180）')
    parser.add_argument('--poll-seconds', type=float, default=10.0, help='轮询间隔秒数（默认 10）')
    return parser.parse_args(argv)


def read_token(path):
    """读取并校验 token（32 位 hex）。返回 (token, None) 或 (None, 错误信息)；错误信息不含明文。"""
    if not os.path.isfile(path):
        return None, 'ERROR: token 文件不存在: %s' % path
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as fh:
            raw = fh.read().strip()
    except Exception as exc:
        return None, 'ERROR: token 文件读取失败: %s' % exc
    if not TOKEN_RE.fullmatch(raw or ''):
        return None, 'ERROR: token 文件内容不是单个 32 位 hex 串（长度=%d）: %s' % (len(raw or ''), path)
    return raw, None


def ensure_stdout_utf8():
    """把 stdout 切到 UTF-8。

    本机 PowerShell 7 的 [Console]::OutputEncoding 是 utf-8，而 Python 默认跟随控制台代码页
    （实测 sys.stdout.encoding=gbk）—— 两者不一致会让中文判据行变成乱码（ASCII 前缀 PASS/FAIL/INFO
    与判据名不受影响，但 grep 中文会失败）。报告文件始终显式 UTF-8，与 stdout 无关。
    """
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass


def rep_finish(rep):
    """打印汇总 + 写报告；返回进程退出码（有 FAIL → 1）。"""
    n = rep.counts()
    print('', flush=True)
    print('=== 汇总: PASS %d / FAIL %d / INFO %d ==='
          % (n.get('PASS', 0), n.get('FAIL', 0), n.get('INFO', 0)), flush=True)
    ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report_path = os.path.join(EVIDENCE_DIR, 'b66_lock_report_%s.md' % ts)
    if rep.save(report_path):
        print('报告: %s' % report_path, flush=True)
    print('结论: %s' % ('PASS（无 FAIL）' if n.get('FAIL', 0) == 0 else 'FAIL（%d 条判据失败）' % n.get('FAIL', 0)),
          flush=True)
    return 1 if n.get('FAIL', 0) else 0


def main(argv=None):
    global SERIAL, TOKEN, POLL_SECONDS
    ensure_stdout_utf8()
    args = parse_args(argv)
    SERIAL = args.serial
    POLL_SECONDS = max(1.0, args.poll_seconds)

    token_path = args.token_file if os.path.isabs(args.token_file) else os.path.join(REPO_ROOT, args.token_file)
    token, terr = read_token(token_path)
    if token is None:
        print(terr, flush=True)
        return 2
    TOKEN = token

    rep = Report(args.phase, args.lock_seconds)
    print('=== 批次66 锁屏挂机不中断方案 —— 真机复测 (phase=%s serial=%s) ===' % (args.phase, SERIAL), flush=True)
    print('INFO  env.serial   %s' % SERIAL, flush=True)
    print('INFO  env.token    已从 %s 读取（明文不入日志/报告）' % token_path, flush=True)

    rc, state = adb(['get-state'], timeout=20)
    if rc != 0 or state.strip() != 'device':
        rep.fail('env.adb_device', 'adb -s %s get-state → rc=%s %s' % (SERIAL, rc, oneline(state)))
        rep.excerpt('env.adb devices', adb(['devices'])[1])
        return rep_finish(rep)
    rep.pass_('env.adb_device', 'get-state=device')

    fok, fdetail = ensure_forwards()
    rep.info('env.forwards', ('OK ' if fok else 'PARTIAL ') + fdetail)

    ctx = {}
    if args.phase in ('reuse', 'all'):
        phase_reuse(rep, ctx)
    if args.phase in ('lock', 'all'):
        phase_lock(rep, ctx, args.lock_seconds)
    if args.phase in ('debounce', 'all'):
        phase_debounce(rep, ctx)
    if args.phase in ('cleanup', 'all'):
        phase_cleanup(rep, ctx)

    return rep_finish(rep)


if __name__ == '__main__':
    sys.exit(main())
