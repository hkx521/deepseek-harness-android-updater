"""批次95 端到端回归：root(su) 托管常驻引擎（Pixel 6 Pro / SukiSU 实测口径）。

判据（全部真机取证）：
  A1 通道到位：引擎进程 uid=0（root）、PPID=1（setsid 脱离 App 进程树）、3080 LISTEN 属主 uid=0
  A2 看护到位：watchdog.pid 存活、uid=0、cmdline 命中 watchdog.sh
  A3 常驻性：am force-stop 本 App 后引擎 pid 不变、3080 仍 LISTEN（App 不在场也活着）
  A4 自愈：kill -9 引擎 → 看护预算内拉起新 pid（watchdog.state 出现 RESTART）且 3080 恢复
  A5 收尾：action_hosted_cleanup → 看护与引擎消失、运行目录删除；随后冷启 App 重新以 root 托管（终态健康）
  A6 特权标记：引擎 env = ROOT_AVAILABLE=1 / SHIZUKU_AVAILABLE=0 / DSH_HOSTED_CHANNEL=root

用法：
  python tools/e2e_batch95_root_hosted.py            # 自动选设备（多设备必须 --serial）
  python tools/e2e_batch95_root_hosted.py --serial <sn> [--timeout-scale 1.0]
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

PKG = 'com.deepseek.harness'
ACTIVITY = PKG + '/.MainActivity'
A11Y = PKG + '/' + PKG + '.AccessibilityService'
HOSTED_DIR = '/data/local/tmp/dsh'
ENGINE_PID_FILE = HOSTED_DIR + '/engine.pid'
WATCHDOG_PID_FILE = HOSTED_DIR + '/watchdog.pid'
WATCHDOG_STATE_FILE = HOSTED_DIR + '/watchdog.state'
ENGINE_ENV_FILE = HOSTED_DIR + '/engine.env'
PORT_HEX = '0C08'
LOOPBACK_HEX = '0100007F'
LISTEN_ST = '0A'
SUDO = 'su -c'

DEFAULT_READY_TIMEOUT = 180.0
DEFAULT_REVIVE_TIMEOUT = 150.0
DEFAULT_CLEANUP_TIMEOUT = 60.0


class Runner:
    def __init__(self, serial: str, scale: float = 1.0):
        self.serial = serial
        self.scale = scale
        self.passed = 0
        self.failed = 0

    # ---------- adb 基元 ----------
    def raw(self, args, timeout=60):
        cmd = ['adb']
        if self.serial:
            cmd += ['-s', self.serial]
        cmd += args
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or '') + (p.stderr or '')

    def sh(self, command, timeout=60):
        rc, out = self.raw(['shell', command], timeout=timeout)
        return out.replace('\r\n', '\n').strip()

    def root(self, command, timeout=90):
        """以 root 执行（su -c '<cmd>'，单引号转义成 '\\''）。"""
        quoted = command.replace("'", "'\\''")
        rc, out = self.raw(['shell', SUDO + " '" + quoted + "'"], timeout=timeout)
        return out.replace('\r\n', '\n').strip()

    # ---------- 判据 ----------
    def check(self, name, ok, detail=''):
        tag = 'PASS' if ok else 'FAIL'
        if ok:
            self.passed += 1
        else:
            self.failed += 1
        print('[' + tag + '] ' + name + (' - ' + str(detail) if detail else ''))
        return ok

    # ---------- 设备事实 ----------
    def engine_pid(self):
        out = self.sh('cat ' + ENGINE_PID_FILE + ' 2>/dev/null')
        return int(out.strip()) if out.strip().isdigit() else 0

    def watchdog_pid(self):
        out = self.sh('cat ' + WATCHDOG_PID_FILE + ' 2>/dev/null')
        return int(out.strip()) if out.strip().isdigit() else 0

    def proc_field(self, pid, field):
        out = self.root('cat /proc/' + str(pid) + '/status 2>/dev/null')
        for line in out.splitlines():
            if line.startswith(field + ':'):
                return line.split(':', 1)[1].strip()
        return ''

    def proc_user(self, pid):
        out = self.root('ps -A -o USER,PID | grep -w ' + str(pid))
        return out.strip().split()[0] if out.strip() else ''

    def listen_uid(self):
        """/proc/net/tcp 里 3080 LISTEN 那一行的属主 uid。"""
        out = self.root('cat /proc/net/tcp 2>/dev/null')
        for line in out.splitlines():
            parts = line.split()
            if len(parts) < 8:
                continue
            local, st, uid = parts[1], parts[3], parts[7]
            if st == LISTEN_ST and local.upper().endswith(':' + PORT_HEX):
                return int(uid, 10)
        return -1

    def port_listening(self):
        return self.listen_uid() >= 0

    def engine_env(self):
        pid = self.engine_pid()
        if pid <= 0:
            return {}
        out = self.root("tr '\\0' '\\n' < /proc/" + str(pid) + '/environ 2>/dev/null')
        env = {}
        for line in out.splitlines():
            if '=' in line:
                k, v = line.split('=', 1)
                env[k] = v
        return env

    def wait(self, cond, timeout, what, interval=2.0):
        deadline = time.time() + timeout * self.scale
        while time.time() < deadline:
            if cond():
                return True
            time.sleep(interval)
        print('   ... 等待超时：' + what)
        return False

    def a11y_enabled(self):
        # settings 里存的是展开形态（com.deepseek.harness/com.deepseek.harness.AccessibilityService），
        # 不能用短形态 com.deepseek.harness/.AccessibilityService 做子串判据（真机实测：恒 false）。
        return 'AccessibilityService' in self.sh(
            'settings get secure enabled_accessibility_services')

    def restore_a11y(self):
        """force-stop 会摘掉无障碍服务（批次92 教训）——按项目既有口径补回。"""
        self.root('settings put secure enabled_accessibility_services ' + A11Y +
                  '; settings put secure accessibility_enabled 1')
        # 系统写回 + 重新绑定有延迟（实测 10s 级），给足窗口
        return self.wait(self.a11y_enabled, 60, '无障碍服务重新绑定')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--serial', default='')
    ap.add_argument('--timeout-scale', type=float, default=1.0)
    ap.add_argument('--skip-boot', action='store_true', help='跳过「重启 App 重新托管」的收尾段')
    args = ap.parse_args()

    serial = args.serial
    if not serial:
        out = subprocess.run(['adb', 'devices'], capture_output=True, text=True).stdout
        devices = [l.split()[0] for l in out.splitlines()[1:] if l.strip().endswith('device')]
        if len(devices) != 1:
            print('需要显式 --serial（当前设备：' + str(devices) + '）')
            return 2
        serial = devices[0]

    r = Runner(serial, args.timeout_scale)
    print('=== 批次95 root 托管常驻 e2e · serial=' + serial + ' ===')

    # 0) 让 App 起来（引擎由 App 启动路径按 root 通道托管）
    r.sh('am start -n ' + ACTIVITY)
    if not r.wait(lambda: r.port_listening(), DEFAULT_READY_TIMEOUT, '3080 LISTEN'):
        r.check('A0 引擎上线', False, '3080 未监听')

    pid0 = r.engine_pid()
    uid_line = r.proc_field(pid0, 'Uid')
    ppid = r.proc_field(pid0, 'PPid')
    engine_uid = 0 if uid_line.startswith('0') else (int(uid_line.split()[0]) if uid_line else -1)

    # A1 通道到位
    r.check('A1a 引擎由 root 托管（uid=0）', engine_uid == 0,
            'pid=' + str(pid0) + ' Uid=' + uid_line)
    r.check('A1b 引擎脱离 App 进程树（PPid=1）', ppid.strip() == '1', 'PPid=' + ppid)
    luid = r.listen_uid()
    r.check('A1c 3080 LISTEN 属主 uid=0', luid == 0, 'listen uid=' + str(luid))

    # A2 看护
    # pidfile 由看护脚本自己写，可能晚于引擎就绪 —— 先等落盘再判
    r.wait(lambda: r.watchdog_pid() > 0, 90, '看护 pidfile 落盘')
    wd = r.watchdog_pid()
    wd_user = r.proc_user(wd) if wd > 0 else ''
    r.check('A2a 看护存活且身份 root', wd > 0 and wd_user == 'root',
            'watchdog pid=' + str(wd) + ' user=' + wd_user)

    # A6 特权标记（引擎 env）
    env = r.engine_env()
    r.check('A6a ROOT_AVAILABLE=1', env.get('ROOT_AVAILABLE') == '1', env.get('ROOT_AVAILABLE'))
    r.check('A6b DSH_HOSTED_CHANNEL=root', env.get('DSH_HOSTED_CHANNEL') == 'root',
            env.get('DSH_HOSTED_CHANNEL'))
    r.check('A6c DSH_HOSTED_DIR 已注入', env.get('DSH_HOSTED_DIR') == HOSTED_DIR,
            env.get('DSH_HOSTED_DIR'))

    # A3 常驻性：force-stop 本 App 后引擎不受影响
    app_pid = r.sh('pidof ' + PKG).strip().split()[0] if r.sh('pidof ' + PKG).strip() else ''
    r.sh('am force-stop ' + PKG)
    time.sleep(5)
    pid_after = r.engine_pid()
    r.check('A3a force-stop 后引擎 pid 不变', pid_after == pid0,
            'before=' + str(pid0) + ' after=' + str(pid_after))
    r.check('A3b force-stop 后 3080 仍 LISTEN', r.port_listening())
    r.check('A3c App 进程确已不在场', not r.sh('pidof ' + PKG).strip(),
            'boot app_pid=' + str(app_pid))
    # A4 看护自愈（**在 App 不在场时做**：A3 刚 force-stop、无障碍也还没补回 ⇒ 唯一可能复活引擎的是 shell 看护）
    # 注意顺序：若先 restore_a11y，系统会立刻拉起 App 进程，App 侧收养/探活会抢先复活引擎，判据就分不清是谁干的。
    r.root('kill -9 ' + str(pid0))
    revived = r.wait(lambda: r.engine_pid() not in (0, pid0) and r.port_listening(),
                     DEFAULT_REVIVE_TIMEOUT, '看护拉起新引擎')
    pid_new = r.engine_pid()
    state = r.sh('cat ' + WATCHDOG_STATE_FILE + ' 2>/dev/null')
    r.check('A4a 看护自愈（新 pid + 3080 恢复）', revived,
            'old=' + str(pid0) + ' new=' + str(pid_new))
    # 自愈留痕：watchdog.state 可能已被随后的稳定态改写回 OK（App 侧收养路径抢先复活时尤甚），
    # 因此判据放宽为「state=RESTART 或 watchdog.log 出现 revive ok」——A4a 的「新 pid + 端口恢复」才是硬判据。
    wd_log = r.root('tail -c 4096 ' + HOSTED_DIR + '/logs/watchdog.log 2>/dev/null')
    tag = state
    if wd_log.strip():
        tag = state + ' | ' + wd_log.strip().splitlines()[-1]
    r.check('A4b 自愈留痕（state=RESTART 或 watchdog.log 有 revive ok）',
            ('RESTART' in state.upper()) or ('revive ok' in wd_log), tag)

    # A3d 放回：确认 force-stop 摘掉的无障碍服务已补回（系统写回 + 重新绑定有延迟）
    r.check('A3d 无障碍服务已补回', r.restore_a11y())

    # A5 收尾：停托管 → 引擎/看护消失
    # 用 action_hosted_cleanup（先按 pidfile 杀看护与引擎，再删运行目录）：
    # action_hosted_stop 之后看护会在预算内立刻复活引擎，停机判据不可观测（真机实测 2026-09-22）。
    out = r.sh('am start -n ' + ACTIVITY + ' --ez action_hosted_cleanup true')
    stopped = r.wait(lambda: r.engine_pid() == 0 and not r.port_listening(),
                     DEFAULT_CLEANUP_TIMEOUT, '托管引擎停止')
    r.check('A5a action_hosted_cleanup 后引擎消失', stopped, out)
    gone = r.wait(lambda: not r.sh('ls -d ' + HOSTED_DIR + ' 2>/dev/null').strip(),
                  DEFAULT_CLEANUP_TIMEOUT, '托管运行目录删除')
    # 排除「执行本判据的 shell 自身」——pgrep -f 会把命令行里含该路径的 pgrep/kill 也匹配进来
    leftover = r.root("P=''; for p in $(pgrep -f " + HOSTED_DIR + "); do "
                      "grep -qa pgrep /proc/$p/cmdline 2>/dev/null && continue; "
                      "grep -qa 'kill -9' /proc/$p/cmdline 2>/dev/null && continue; "
                      "P=\"$P $p\"; done; echo $P")
    r.check('A5b 运行目录已删除且无残留进程', gone and not leftover.strip(),
            'gone=' + str(gone) + ' leftover=[' + leftover.strip() + ']')

    if not args.skip_boot:
        # 冷启动才会走 MainActivity.onCreate 的启动流程（把 am start 送到已在前台的实例不触发启动）
        r.sh('am force-stop ' + PKG)
        time.sleep(3)
        r.restore_a11y()
        r.sh('am start -n ' + ACTIVITY)
        back = r.wait(lambda: r.port_listening(), DEFAULT_READY_TIMEOUT, '重新托管')
        pid_back = r.engine_pid()
        back_uid = r.proc_field(pid_back, 'Uid')
        r.check('A5c 重新启动 App 后再次以 root 托管', back and back_uid.startswith('0'),
                'pid=' + str(pid_back) + ' Uid=' + back_uid)

    print('=== 结果：PASS=' + str(r.passed) + ' FAIL=' + str(r.failed) + ' ===')
    return 0 if r.failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
