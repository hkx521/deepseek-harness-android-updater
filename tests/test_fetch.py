"""tools/runtime_glibc/fetch.py 纯逻辑单测：全部离线（不下载、不碰设备）。

覆盖面（只测可离线驱动的函数，临时目录夹具）：
  - sha256_file / ensure_artifact：sha256 校验通过与失配拒绝（下载以桩函数模拟，
    网络零依赖）；
  - _resolve_tar_target / _copy_member / extract_gpkg：tar 内 soname 符号链接
    解析与实体化（Windows/Android 均不建链接，拷贝实体文件）；
  - patch_libc_paths：libc 路径改写、NUL 填充、幂等重入；
  - parse_elf / check_elfs：最小手工构造的 ELF64（静态/动态 PT_DYNAMIC）解析与
    16KB 页对齐 + DT_NEEDED 完备性检查。

不可离线测的部分：fetch.py main() 的真实下载/组装链路（依赖 nodejs.org/gpkg 等
外网大文件）与 --check 全量校验（要求产物已就绪），不在单测范围。
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import struct
import tarfile
import tempfile
import unittest
from pathlib import Path

_FETCH_PATH = Path(__file__).resolve().parents[1] / "tools" / "runtime_glibc" / "fetch.py"
_spec = importlib.util.spec_from_file_location("dsh_runtime_glibc_fetch", _FETCH_PATH)
fetch = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fetch)

EM_AARCH64 = 183
PT_LOAD = 1
PT_DYNAMIC = 2
DT_NULL = 0
DT_NEEDED = 1
DT_STRTAB = 5
EH_SIZE = 64
PHENT_SIZE = 56


def build_elf(
    *,
    machine: int = EM_AARCH64,
    align: int = 16384,
    needed: list[str] | None = None,
) -> bytes:
    """构造最小 ELF64 小端镜像（仅 fetch.parse_elf 所需字段的合法子集）。"""
    ident = b"\x7fELF" + bytes([2, 1, 1, 0]) + b"\x00" * 8  # class=2(64位) data=1(小端)
    phnum = 2 if needed else 1
    body_off = EH_SIZE + phnum * PHENT_SIZE
    if needed:
        strtab_off = body_off + 16 * (len(needed) + 2)  # DT_STRTAB + N*DT_NEEDED + DT_NULL
        strtab = b""
        offsets = []
        for soname in needed:
            offsets.append(len(strtab))
            strtab += soname.encode("utf-8") + b"\x00"
        entries = [(DT_STRTAB, strtab_off)] + [(DT_NEEDED, off) for off in offsets]
        entries.append((DT_NULL, 0))
        dynamic_blob = b"".join(struct.pack("<QQ", tag, val) for tag, val in entries)
        blob = dynamic_blob + strtab
    else:
        dynamic_blob = b""
        blob = b"\x00" * 16
    total = body_off + len(blob)
    load = struct.pack("<IIQQQQQQ", PT_LOAD, 5, 0, 0, 0, total, total, align)
    header = struct.pack(
        "<16sHHIQQQIHHH", ident, 3, machine, 1, 0, EH_SIZE, 0, 0, EH_SIZE, PHENT_SIZE, phnum
    ).ljust(EH_SIZE, b"\x00")
    image = header + load
    if needed:
        dynamic = struct.pack(
            "<IIQQQQQQ",
            PT_DYNAMIC, 6, body_off, body_off, body_off,
            len(dynamic_blob), len(dynamic_blob), 8,
        )
        image += dynamic + blob
    return image


def _member(name: str, *, linkname: str | None = None) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    if linkname is not None:
        info.type = tarfile.SYMTYPE
        info.linkname = linkname
    return info


def build_gpkg(path: Path, entries: list[tuple[str, str | None, bytes | str]]) -> None:
    """构建最小 gpkg 布局 tar：(成员名, symlink目标或None, 文件内容)。"""
    with tarfile.open(path, "w") as bundle:
        for name, linkname, payload in entries:
            if linkname is not None:
                bundle.addfile(_member(name, linkname=linkname))
                continue
            data = payload if isinstance(payload, bytes) else payload.encode("utf-8")
            info = tarfile.TarInfo(name)
            info.size = len(data)
            bundle.addfile(info, io.BytesIO(data))


class Sha256FileTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._temp.name)

    def tearDown(self) -> None:
        self._temp.cleanup()

    def test_matches_hashlib_reference(self) -> None:
        path = self.tmp / "a.bin"
        path.write_bytes(b"hello world")
        self.assertEqual(
            fetch.sha256_file(path), hashlib.sha256(b"hello world").hexdigest()
        )

    def test_empty_file(self) -> None:
        path = self.tmp / "empty.bin"
        path.write_bytes(b"")
        self.assertEqual(
            fetch.sha256_file(path), hashlib.sha256(b"").hexdigest()
        )


class EnsureArtifactTests(unittest.TestCase):
    """ensure_artifact：缓存命中/失配 + 下载桩的 sha256 强校验与 lock 引导。"""

    PAYLOAD = b"fake-tarball-payload"

    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._temp.name)
        self.orig_cache, self.orig_lock, self.orig_download = (
            fetch.CACHE_DIR, fetch.LOCK_PATH, fetch.download,
        )
        fetch.CACHE_DIR = self.tmp / "cache"
        fetch.CACHE_DIR.mkdir()
        fetch.LOCK_PATH = self.tmp / "lock.json"
        self.downloads: list[str] = []

    def tearDown(self) -> None:
        fetch.CACHE_DIR, fetch.LOCK_PATH, fetch.download = (
            self.orig_cache, self.orig_lock, self.orig_download,
        )
        self._temp.cleanup()

    def _spec(self, sha256: str | None = None, **extra: str) -> dict:
        spec = {"version": "1.0", "url": "https://example.invalid/pkg.tar.xz"}
        if sha256 is not None:
            spec["sha256"] = sha256
        spec.update(extra)
        return spec

    def _stub_download(self) -> None:
        def fake_download(url: str, dest: Path) -> None:
            self.downloads.append(url)
            if url.endswith("SHASUMS256.txt"):
                dest.write_text(
                    f"{hashlib.sha256(self.PAYLOAD).hexdigest()}  pkg.tar.xz\n",
                    encoding="utf-8",
                )
            else:
                dest.write_bytes(self.PAYLOAD)

        fetch.download = fake_download

    def test_cache_hit_with_matching_lock_hash_skips_download(self) -> None:
        good = hashlib.sha256(self.PAYLOAD).hexdigest()
        (fetch.CACHE_DIR / "pkg.tar.xz").write_bytes(self.PAYLOAD)
        lock = {"artifacts": {"t": {"version": "1.0", "sha256": good}}}
        cache = fetch.ensure_artifact("t", self._spec(), lock)
        self.assertEqual(cache, fetch.CACHE_DIR / "pkg.tar.xz")
        self.assertEqual(self.downloads, [])

    def test_cache_hit_with_mismatched_lock_hash_rejected(self) -> None:
        (fetch.CACHE_DIR / "pkg.tar.xz").write_bytes(self.PAYLOAD)
        lock = {"artifacts": {"t": {"version": "1.0", "sha256": "0" * 64}}}
        with self.assertRaises(SystemExit):
            fetch.ensure_artifact("t", self._spec(), lock)

    def test_download_hash_pass_bootstraps_lock(self) -> None:
        self._stub_download()
        good = hashlib.sha256(self.PAYLOAD).hexdigest()
        lock: dict = {"artifacts": {}}
        cache = fetch.ensure_artifact("t", self._spec(good), lock)
        self.assertEqual(cache.read_bytes(), self.PAYLOAD)
        self.assertEqual(lock["artifacts"]["t"]["sha256"], good)  # 首次引导写入

    def test_download_hash_mismatch_rejected(self) -> None:
        self._stub_download()
        lock: dict = {"artifacts": {}}
        with self.assertRaises(SystemExit):
            fetch.ensure_artifact("t", self._spec("0" * 64), lock)

    def test_cache_bootstrap_rejected_when_hardcoded_sha_mismatches(self) -> None:
        # lock 未引导 + 缓存已存在：缓存哈希须与 ARTIFACTS 硬编码一致
        (fetch.CACHE_DIR / "pkg.tar.xz").write_bytes(self.PAYLOAD)
        lock: dict = {"artifacts": {}}
        with self.assertRaises(SystemExit):
            fetch.ensure_artifact("t", self._spec("0" * 64), lock)

    def test_official_shasums_mismatch_rejected(self) -> None:
        # node 类下载物的官方 SHASUMS256.txt 交叉校验失败 → die
        self._stub_download()
        fetch.download = lambda url, dest: (
            dest.write_text("deadbeef  pkg.tar.xz\n", encoding="utf-8")
            if url.endswith("SHASUMS256.txt")
            else dest.write_bytes(self.PAYLOAD)
        )
        good = hashlib.sha256(self.PAYLOAD).hexdigest()
        lock: dict = {"artifacts": {}}
        spec = self._spec(
            good,
            verify_url="https://example.invalid/SHASUMS256.txt",
            verify_line="pkg.tar.xz",
        )
        with self.assertRaises(SystemExit):
            fetch.ensure_artifact("t", spec, lock)

    def test_official_shasums_match_passes(self) -> None:
        self._stub_download()
        good = hashlib.sha256(self.PAYLOAD).hexdigest()
        lock: dict = {"artifacts": {}}
        spec = self._spec(
            good,
            verify_url="https://example.invalid/SHASUMS256.txt",
            verify_line="pkg.tar.xz",
        )
        fetch.ensure_artifact("t", spec, lock)
        self.assertIn("https://example.invalid/SHASUMS256.txt", self.downloads)


class ResolveTarTargetTests(unittest.TestCase):
    """_resolve_tar_target：tar 内链接目标解析（同目录 / ../ 归一 / 拒绝越界）。"""

    PREFIX = "data/data/com.termux/files/usr/glibc/lib"

    def _members(self) -> dict[str, tarfile.TarInfo]:
        real = _member(f"{self.PREFIX}/libc.so.6")
        ld_real = _member(f"{self.PREFIX}/ld-linux-aarch64.so.1")
        return {
            real.name: real,
            ld_real.name: ld_real,
            f"{self.PREFIX}/ld.so": _member(
                f"{self.PREFIX}/ld.so", linkname="ld-linux-aarch64.so.1"
            ),
            "top/real.so": _member("top/real.so"),
            # `../../` 自 lib 目录上跳两级落在 usr/ 下（fetch.py 逐段归一）
            "data/data/com.termux/files/usr/top/real.so": _member(
                "data/data/com.termux/files/usr/top/real.so"
            ),
            f"{self.PREFIX}/up.so": _member(
                f"{self.PREFIX}/up.so", linkname="../../top/real.so"
            ),
        }

    def test_sibling_link_resolves(self) -> None:
        members = self._members()
        target = fetch._resolve_tar_target(
            members, "ld-linux-aarch64.so.1", f"{self.PREFIX}/ld.so"
        )
        self.assertIs(target, members[f"{self.PREFIX}/ld-linux-aarch64.so.1"])

    def test_parent_relative_link_resolves(self) -> None:
        members = self._members()
        target = fetch._resolve_tar_target(
            members, "../../top/real.so", f"{self.PREFIX}/up.so"
        )
        self.assertIs(target, members["data/data/com.termux/files/usr/top/real.so"])

    def test_absolute_link_outside_members_resolves_to_none(self) -> None:
        members = self._members()
        self.assertIsNone(
            fetch._resolve_tar_target(members, "/system/lib64/libc.so", f"{self.PREFIX}/x.so")
        )

    def test_missing_target_resolves_to_none(self) -> None:
        members = self._members()
        self.assertIsNone(
            fetch._resolve_tar_target(members, "ghost.so", f"{self.PREFIX}/x.so")
        )


class ExtractGpkgTests(unittest.TestCase):
    """extract_gpkg/_copy_member：白名单裁剪 + soname 链接实体化（拷贝非链接）。"""

    PREFIX = "data/data/com.termux/files/usr/glibc/lib"

    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._temp.name)
        self.pkg = self.tmp / "glibc.pkg.tar.xz"
        build_gpkg(
            self.pkg,
            [
                (f"{self.PREFIX}", None, b""),  # 目录成员
                ("other-prefix/not-selected.so", None, b"NOPE"),  # 前缀外
                (f"{self.PREFIX}/libc.so.6", None, b"LIBC"),
                (f"{self.PREFIX}/libm.so.6", "libc.so.6", b""),  # 同目录 symlink
                (f"{self.PREFIX}/libone.so", "libc.so.6", b""),  # 一层间接链
                (f"{self.PREFIX}/libtwo.so", "libone.so", b""),  # 两层间接链
                (f"{self.PREFIX}/libskip.so", None, b"SKIP"),  # 白名单外
            ],
        )

    def tearDown(self) -> None:
        self._temp.cleanup()

    def test_whitelist_and_soname_materialization(self) -> None:
        dest = self.tmp / "lib"
        dest.mkdir(parents=True)  # fetch.assemble() 预建 lib/，extract_gpkg 自身不建目录
        whitelist = ("libc.so.6", "libm.so.6", "libone.so", "libtwo.so")
        placed = fetch.extract_gpkg(self.pkg, self.PREFIX, dest, whitelist)
        self.assertEqual(set(placed), set(whitelist))
        self.assertEqual((dest / "libc.so.6").read_bytes(), b"LIBC")
        # soname 链接实体化：libm/one/two 均为实体拷贝，内容同 libc
        for soname in ("libm.so.6", "libone.so", "libtwo.so"):
            target = dest / soname
            self.assertFalse(target.is_symlink(), soname)
            self.assertEqual(target.read_bytes(), b"LIBC", soname)
        # 白名单外与前缀外均未落位
        self.assertFalse((dest / "libskip.so").exists())
        self.assertFalse((dest / "not-selected.so").exists())

    def test_no_whitelist_places_everything_under_prefix(self) -> None:
        dest = self.tmp / "lib-all"
        dest.mkdir(parents=True)
        placed = fetch.extract_gpkg(self.pkg, self.PREFIX, dest, None)
        self.assertIn("libskip.so", placed)
        self.assertEqual((dest / "libskip.so").read_bytes(), b"SKIP")


class PatchLibcPathsTests(unittest.TestCase):
    """patch_libc_paths：路径改写 + NUL 填充 + 幂等重入 + 多重出现拒绝。"""

    OLD_RESOLV, NEW_RESOLV = fetch.LIBC_PATH_REWRITES[0]
    OLD_NSS, NEW_NSS = fetch.LIBC_PATH_REWRITES[1]

    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._temp.name)

    def tearDown(self) -> None:
        self._temp.cleanup()

    def _libc(self, *chunks: bytes) -> Path:
        path = self.tmp / "libc.so.6"
        path.write_bytes(b"\x7fELF-fake" + b"".join(chunks) + b"tail")
        return path

    def test_rewrite_replaces_with_nul_padding(self) -> None:
        libc = self._libc(self.OLD_NSS, b"\x00", self.OLD_RESOLV)
        fetch.patch_libc_paths(libc)
        data = libc.read_bytes()
        self.assertNotIn(self.OLD_RESOLV, data)
        self.assertNotIn(self.OLD_NSS, data)
        self.assertIn(self.NEW_RESOLV, data)
        self.assertIn(self.NEW_NSS, data)
        # 长度守恒：替换区差值以 NUL 填充（不挪动后续字节偏移）
        idx = data.index(self.NEW_RESOLV)
        pad_end = idx + len(self.OLD_RESOLV)
        self.assertEqual(
            data[idx + len(self.NEW_RESOLV):pad_end],
            b"\x00" * (len(self.OLD_RESOLV) - len(self.NEW_RESOLV)),
        )

    def test_rewind_is_idempotent(self) -> None:
        libc = self._libc(self.OLD_NSS, b"\x00", self.OLD_RESOLV)
        fetch.patch_libc_paths(libc)
        once = libc.read_bytes()
        fetch.patch_libc_paths(libc)  # 已补丁：应静默跳过（幂等）
        self.assertEqual(libc.read_bytes(), once)

    def test_double_occurrence_rejected(self) -> None:
        libc = self._libc(self.OLD_RESOLV, b"\x00", self.OLD_RESOLV)
        with self.assertRaises(SystemExit):
            fetch.patch_libc_paths(libc)


class ParseElfTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._temp.name)

    def tearDown(self) -> None:
        self._temp.cleanup()

    def _write(self, name: str, data: bytes) -> Path:
        path = self.tmp / name
        path.write_bytes(data)
        return path

    def test_non_elf_returns_none(self) -> None:
        self.assertIsNone(fetch.parse_elf(self._write("sh.txt", b"#!/bin/sh\njust text")))
        self.assertIsNone(fetch.parse_elf(self._write("short.bin", b"\x7fELF")))

    def test_static_elf_fields(self) -> None:
        path = self._write("node", build_elf(align=16384))
        info = fetch.parse_elf(path)
        self.assertIsNotNone(info)
        self.assertEqual(info.machine, EM_AARCH64)
        self.assertTrue(info.is_dyn)  # e_type = ET_DYN
        self.assertEqual(info.max_load_align, 16384)
        self.assertEqual(info.needed, [])

    def test_dynamic_elf_dt_needed_parsed(self) -> None:
        path = self._write("node", build_elf(needed=["libc.so.6", "libm.so.6"]))
        info = fetch.parse_elf(path)
        self.assertEqual(info.needed, ["libc.so.6", "libm.so.6"])
        self.assertEqual(info.max_load_align, 16384)

    def test_small_page_align_visible(self) -> None:
        path = self._write("fourk", build_elf(align=4096))
        self.assertEqual(fetch.parse_elf(path).max_load_align, 4096)


class CheckElfsTests(unittest.TestCase):
    """check_elfs：16KB 对齐 + DT_NEEDED 完备性（离线夹具树）。"""

    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.out_dir = Path(self._temp.name) / "runtime-glibc"
        (self.out_dir / "bin").mkdir(parents=True)
        (self.out_dir / "lib").mkdir()

    def tearDown(self) -> None:
        self._temp.cleanup()

    def _write(self, sub: str, name: str, data: bytes) -> Path:
        path = self.out_dir / sub / name
        path.write_bytes(data)
        return path

    def test_passes_with_complete_needed_closure(self) -> None:
        self._write("bin", "node", build_elf(needed=["libc.so.6", "libm.so.6"]))
        self._write("lib", "libc.so.6", build_elf())
        self._write("lib", "libm.so.6", build_elf())
        self._write("bin", "notes.txt", b"not an elf, should be skipped")
        self.assertIsNone(fetch.check_elfs(self.out_dir))  # 不抛即通过

    def test_missing_needed_library_rejected(self) -> None:
        self._write("bin", "node", build_elf(needed=["libc.so.6"]))
        with self.assertRaises(SystemExit):
            fetch.check_elfs(self.out_dir)

    def test_non_aarch64_elf_rejected(self) -> None:
        self._write("bin", "x86node", build_elf(machine=62, needed=["libc.so.6"]))
        self._write("lib", "libc.so.6", build_elf())
        with self.assertRaises(SystemExit):
            fetch.check_elfs(self.out_dir)

    def test_sub_16k_page_align_rejected(self) -> None:
        self._write("bin", "node", build_elf(align=4096, needed=["libc.so.6"]))
        self._write("lib", "libc.so.6", build_elf())
        with self.assertRaises(SystemExit):
            fetch.check_elfs(self.out_dir)

    def test_empty_tree_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            fetch.check_elfs(self.out_dir)


if __name__ == "__main__":
    unittest.main()
