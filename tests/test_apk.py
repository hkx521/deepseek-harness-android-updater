"""tools/dsh_updater/apk.py 纯逻辑单测：zip 解包安全边界，全部离线。"""
from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.dsh_updater.apk import _safe_target, extract_zip_safely
from tools.dsh_updater.common import UpdaterError


def _write_zip(path: Path, entries: list[tuple[str, bytes]]) -> None:
    with zipfile.ZipFile(path, "w") as bundle:
        for name, data in entries:
            if isinstance(name, bytes):
                name = name.decode("utf-8")
            if isinstance(data, str):
                data = data.encode("utf-8")
            bundle.writestr(name, data)


class SafeTargetTests(unittest.TestCase):
    """_safe_target 边界：正常相对路径 / `../` 穿越 / 绝对路径 / `.` 归一。"""

    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name).resolve()

    def tearDown(self) -> None:
        self._temp.cleanup()

    def test_relative_path_resolves_inside_root(self) -> None:
        self.assertEqual(
            _safe_target(self.root, "a/b.txt"), (self.root / "a" / "b.txt").resolve()
        )

    def test_dot_and_empty_stay_at_root(self) -> None:
        # 边界："." 与空段归一到 root 自身——不越界、不抛错
        self.assertEqual(_safe_target(self.root, "."), self.root)
        self.assertEqual(_safe_target(self.root, ""), self.root)
        # 内嵌 "./" 归一后仍在 root 内，允许
        self.assertEqual(
            _safe_target(self.root, "a/./b.txt"), (self.root / "a" / "b.txt").resolve()
        )

    def test_parent_traversal_rejected(self) -> None:
        for member in ("../escape.txt", "a/../../escape.txt", "a/b/../../../escape.txt"):
            with self.assertRaises(UpdaterError, msg=member):
                _safe_target(self.root, member)

    def test_absolute_path_rejected(self) -> None:
        # zip 成员名 /etc/passwd：解析后落到 root 之外（Linux 直接绝对路径；
        # Windows 盘符根），一律拒绝
        with self.assertRaises(UpdaterError):
            _safe_target(self.root, "/etc/passwd")


class ExtractZipSafelyTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name).resolve()

    def tearDown(self) -> None:
        self._temp.cleanup()

    def _archive(self, name: str, entries: list[tuple[str, bytes]]) -> Path:
        archive = self.root / name
        _write_zip(archive, entries)
        return archive

    def test_normal_extraction_creates_parents_and_dirs(self) -> None:
        archive = self._archive(
            "ok.zip",
            [
                (b"dir/sub/deep.txt", "payload".encode("utf-8")),
                (b"emptydir/", b""),
            ],
        )
        destination = self.root / "out"
        extract_zip_safely(archive, destination)
        self.assertEqual((destination / "dir" / "sub" / "deep.txt").read_text(), "payload")
        self.assertTrue((destination / "emptydir").is_dir())

    def test_rejects_parent_traversal_member(self) -> None:
        archive = self._archive("traversal.zip", [(b"../evil.txt", b"bad")])
        destination = self.root / "out"
        with self.assertRaises(UpdaterError):
            extract_zip_safely(archive, destination)
        # 拒绝后不得在 destination 之外留下任何落盘物
        self.assertFalse((self.root / "evil.txt").exists())

    def test_rejects_absolute_path_member(self) -> None:
        archive = self._archive("absolute.zip", [(b"/abs.txt", b"bad")])
        with self.assertRaises(UpdaterError):
            extract_zip_safely(archive, self.root / "out")

    def test_rejects_symbolic_link_member(self) -> None:
        # external_attr 高 16 位 = POSIX mode；0o120777 = S_IFLNK | 0777
        archive = self.root / "symlink.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            info = zipfile.ZipInfo("evil/link")
            info.external_attr = 0o120777 << 16
            bundle.writestr(info, b"/etc/passwd")
        with self.assertRaises(UpdaterError):
            extract_zip_safely(archive, self.root / "out")
        self.assertFalse((self.root / "out" / "evil").exists())

    def test_rejects_traversal_after_valid_entries(self) -> None:
        # 混合包：前若干条正常，后一条穿越——整包拒绝，防"部分解包"
        archive = self._archive(
            "mixed.zip",
            [(b"ok.txt", b"fine"), (b"../evil.txt", b"bad")],
        )
        destination = self.root / "out"
        with self.assertRaises(UpdaterError):
            extract_zip_safely(archive, destination)


if __name__ == "__main__":
    unittest.main()
