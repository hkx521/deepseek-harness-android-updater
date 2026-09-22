from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'android-app' / 'src' / 'com' / 'deepseek' / 'harness'
OVERLAY_SRC = (PKG / 'OverlayService.java').read_text(encoding='utf-8')
MAIN_SRC = (PKG / 'MainActivity.java').read_text(encoding='utf-8')


class Batch52SelfHealAndConversationTests(unittest.TestCase):
    '''批次52：灵动助手离线静默自愈 + 多轮连续追问与新会话切换。'''

    def test_silent_engine_launch_in_main_activity(self) -> None:
        '''MainActivity 收到 action_launch_engine 且带 silent=true 时，必须在后台启动引擎并立刻退后台，不抢前台焦点。'''
        self.assertIn('boolean silent = in.getBooleanExtra("silent", false);', MAIN_SRC)
        self.assertIn('if (silent) moveTaskToBack(true);', MAIN_SRC)

    def test_overlay_triggers_silent_launch(self) -> None:
        '''OverlayService 拉起引擎时必须传 silent=true，保障零切屏体验。'''
        self.assertIn('open.putExtra("action_launch_engine", true);', OVERLAY_SRC)
        self.assertIn('open.putExtra("silent", true);', OVERLAY_SRC)

    def test_offline_auto_heal_and_resubmit_in_overlay(self) -> None:
        '''离线提交指令时，自动提示自愈中并挂起，就绪后自动重试。'''
        self.assertIn('if (!engineUp) {', OVERLAY_SRC)
        self.assertIn('setTaskStatus("任务：⚡ 引擎离线，正在静默自愈拉起…");', OVERLAY_SRC)
        self.assertIn('executeCommandPayload(', OVERLAY_SRC)

    def test_multi_round_conversation_support(self) -> None:
        '''任务成功后不得盲目重置会话，应支持连续追问并提供新会话切换入口。'''
        self.assertIn('conversationRounds++;', OVERLAY_SRC)
        self.assertIn('startNewConversation()', OVERLAY_SRC)
        self.assertIn('makeChip("✨ 新会话"', OVERLAY_SRC)
        self.assertIn('client.resetSession();', OVERLAY_SRC)


if __name__ == '__main__':
    unittest.main()
