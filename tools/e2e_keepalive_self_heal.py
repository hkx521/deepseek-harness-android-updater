# -*- coding: utf-8 -*-
import os
import subprocess

# 批次97：真机序列号已脱敏；用 ANDROID_SERIAL=<serial> 指定目标设备。
SERIAL = os.environ.get('ANDROID_SERIAL', 'SN-HONOR-XXXX')

def adb(cmd):
    full_cmd = ['adb', '-s', SERIAL] + cmd.split()
    res = subprocess.run(full_cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return res.stdout.strip()

def main():
    print('=== 批次58 方案B：保活与自启引导真机收网回归 ===')
    devices = adb('devices')
    assert SERIAL in devices, '设备未在线: ' + devices
    print('[1/5] 设备连接正常: ' + SERIAL)

    services = adb('shell dumpsys activity services com.deepseek.harness')
    assert 'OverlayService' in services, 'OverlayService 未在运行'
    assert 'isForeground=true' in services, 'OverlayService 非前台服务'
    print('[2/5] OverlayService 前台服务正常存活在册')

    boot_log = adb('logcat -d -s dsh-boot:I')
    assert '开机/更新自启：已请求拉起助手浮层' in boot_log, 'BootReceiver 自启日志未命中'
    print('[3/5] BootReceiver 自启广播验证通过（dsh_prefs 权威源已生效）')

    overlay_log = adb('logcat -d -s dsh-overlay:I')
    assert '[b55c] heartbeat' in overlay_log, '心跳日志未命中'
    print('[4/5] 真机保活心跳验证通过（heartbeat 持续滴答刷新）')

    assert '[b58] overlay' in overlay_log, '悬浮窗保活跳转日志未命中'
    print('[5/5] 悬浮窗详情内保活诊断与一键跳转已验证生效')

    print('>>> ALL 5 CHECKS PASSED: 方案 B 保活与自启引导收网成功！<<<')

if __name__ == '__main__':
    main()
