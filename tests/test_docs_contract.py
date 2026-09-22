from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DocsContractTests(unittest.TestCase):
    """跨对话续接契约：现状快照 + 开场必读 + 自动保鲜。"""

    def _read_or_skip(self, rel: str) -> str:
        """AGENTS.md / docs/STATE.md / docs/PLAN-INDEX.md 只在维护者工作区存在（公开副本不含内部开发记录）。"""
        path = ROOT / rel
        if not path.is_file():
            self.skipTest(rel + " 不在工作区（公开发布版不含内部开发记录）")
        return path.read_text(encoding="utf-8")

    def test_state_snapshot_exists_with_auto_block(self) -> None:
        state = self._read_or_skip("docs/STATE.md")
        self.assertIn("AUTO:STATE:BEGIN", state)
        self.assertIn("AUTO:STATE:END", state)
        self.assertIn("新会话开场三步", state)

    def test_agents_has_session_bootstrap(self) -> None:
        agents = self._read_or_skip("AGENTS.md")
        self.assertIn("新会话开场必读", agents)
        self.assertIn("docs/STATE.md", agents)

    def test_journal_sync_supports_state_refresh(self) -> None:
        src = (ROOT / "tools" / "journal_sync.py").read_text(encoding="utf-8")
        self.assertIn("--state", src)
        self.assertIn("def refresh_state", src)

    def test_plan_index_registers_batches(self) -> None:
        plan = self._read_or_skip("docs/PLAN-INDEX.md")
        self.assertIn("| 45 |", plan)
        self.assertIn("| 46 |", plan)
