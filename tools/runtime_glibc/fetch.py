#!/usr/bin/env python3
"""v1.9.0 glibc runtime 组装器（迁移方案阶段 0）。

下载并组装「glibc ld.so 直跑」所需 runtime 到 build/updater/runtime-glibc/：

  bin/node               官方 Node.js linux-arm64（glibc，nodejs.org 发行版）
  bin/rg                 ripgrep 官方 aarch64-unknown-linux-musl（静态）
  bin/curl               curl 静态（pkgforge-dev/Static-Binaries 镜像）
  bin/busybox            busybox musl 静态（pkgforge-dev/Static-Binaries 镜像）
  lib/*.so*              termux glibc-packages（gpkg）核心库 + gcc-libs，
                         soname 全部实体化（Android FUSE/zip 不支持 symlink）
  lib/libtermux-exec.so  TEG（gpkg termux-exec-glibc 包产物，路径改写 LD_PRELOAD）。
                         注意：方案文档里写的「libtermux-exec-glibc.so」在 gpkg
                         包内的真实文件名是 libtermux-exec.so，保持原名不重命名。
  etc/nsswitch.conf      最小 NSS 配置（hosts: files dns 等）
  symlinks.json          设备端首启需创建的符号链接清单（bin/sh -> busybox 等）。
                         Windows 宿主无法创建 Linux symlink，选定方案：MainActivity
                         首启读此清单在设备上逐条创建（link -> symlink -> copy
                         三级回退，复用现有 applyLinks 的模式）。

sha256 锁定：全部下载物记录在 tools/runtime_glibc/lock.json；重复执行先查
lock + 缓存目录（build/updater/runtime-glibc-cache/），命中且哈希匹配即跳过
下载。lock 无条目时为「首次引导」语义：下载后计算哈希写入 lock 并打印，
供人工核对后提交（node 额外对照官方 SHASUMS256.txt）。

校验（任一失败即非零退出）：
  1. ELF 16KB 页检查：产物内全部 ELF 的 PT_LOAD 最大 p_align >= 16384。
  2. 库完备性：bin/node 与 lib/ 下全部 .so 的 DT_NEEDED 递归解析，
     每个 NEEDED 必须能在 lib/ 集合内解析到同名文件，缺失即列出。

用法：
  python fetch.py            # 组装 + 全量校验
  python fetch.py --check    # 只跑校验（不下载，要求产物已就绪）
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import sys
import tarfile
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = PROJECT_ROOT / "build" / "updater" / "runtime-glibc"
CACHE_DIR = PROJECT_ROOT / "build" / "updater" / "runtime-glibc-cache"
LOCK_PATH = Path(__file__).resolve().parent / "lock.json"

# 16KB 页内核要求（迁移方案：所有随包 ELF 必须 16KB 对齐）
MIN_PAGE_ALIGN = 16384
# aarch64 ELF machine
EM_AARCH64 = 183

# ---------------------------------------------------------------------------
# 下载物清单。sha256 为 None 表示 lock 尚未引导（首跑写入）。
# gpkg 包文件名可在 https://sync.termux-pacman.dev/gpkg/aarch64/gpkg.db 的
# %FILENAME% 字段查证（fetch.py 不动态解析 db，版本固化在这里）。
# ---------------------------------------------------------------------------
ARTIFACTS: dict[str, dict] = {
    "node": {
        "version": "24.21.0",
        "url": "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.xz",
        "sha256": None,
        # 官方 SHASUMS256.txt 交叉校验
        "verify_url": "https://nodejs.org/dist/v24.21.0/SHASUMS256.txt",
        "verify_line": "node-v24.21.0-linux-arm64.tar.xz",
    },
    "glibc": {
        "version": "2.44-0",
        "url": "https://sync.termux-pacman.dev/gpkg/aarch64/glibc-2.44-0-aarch64.pkg.tar.xz",
        "sha256": None,
    },
    "gcc-libs": {
        "version": "14.2.1-1",
        "url": "https://sync.termux-pacman.dev/gpkg/aarch64/gcc-libs-glibc-14.2.1-1-aarch64.pkg.tar.xz",
        "sha256": None,
    },
    "termux-exec-glibc": {
        "version": "1:1.0-0",
        "url": "https://sync.termux-pacman.dev/gpkg/aarch64/termux-exec-glibc-1%3A1.0-0-aarch64.pkg.tar.xz",
        "sha256": None,
    },
    "ripgrep": {
        "version": "15.2.0",
        "url": "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/"
               "ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz",
        # 上游 release 公布的 sha256（2026-09-11 核对）
        "sha256": "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915",
    },
    "curl-static": {
        "version": "8.x (pkgforge-dev mirror)",
        "url": "https://raw.githubusercontent.com/pkgforge-dev/Static-Binaries/main/curl/"
               "curl_aarch64_arm64_Linux",
        # 镜像 README 公布的 SHA256SUM（2026-09-11 核对）
        "sha256": "cae4b723c121dcc5c7c54809c49b286be32904384d757896fa9c4b90e6c1e807",
    },
    "busybox": {
        "version": "1.36.1 (pkgforge-dev mirror)",
        "url": "https://raw.githubusercontent.com/pkgforge-dev/Static-Binaries/main/busybox/"
               "busybox_aarch64_arm64_musl_Linux",
        "sha256": None,
    },
}

# glibc 主包裁剪白名单（basename 精确匹配；symlink 由通用逻辑实体化）。
# libdl/libpthread/librt/libutil 在 glibc>=2.34 已并入 libc，包内仅剩满足旧
# NEEDED 的 stub 库——官方 node 的 DT_NEEDED 仍引用它们，必须保留。
GLIBC_LIBS = (
    "ld-linux-aarch64.so.1",
    "ld.so",
    "libc.so.6",
    "libm.so.6",
    "libmvec.so.1",
    "libdl.so.2",
    "libpthread.so.0",
    "librt.so.1",
    "libutil.so.1",
    "libBrokenLocale.so.1",
    "libresolv.so.2",
    "libnss_dns.so.2",
    "libnss_files.so.2",
    "libnss_compat.so.2",
    "libnss_hesiod.so.2",
    "libthread_db.so.1",
    "libanl.so.1",
)
# gcc-libs 裁剪白名单（libstdc++/libgcc_s；asan/tsan 等调试库不打包）
GCC_LIBS = (
    "libstdc++.so.6",
    "libgcc_s.so.1",
)

# 设备端符号链接清单（bin/sh -> busybox 等；MainActivity 首启创建）
BUSYBOX_LINKS = (
    "sh", "env", "ln", "dirname", "basename", "cat", "ls", "cp", "mv", "rm",
    "mkdir", "rmdir", "echo", "printf", "test", "head", "tail", "sleep",
    "uname", "id", "which", "tty", "unlink", "readlink", "true", "false",
    "touch", "grep", "sed", "tar", "gzip", "gunzip", "date", "wc", "sort",
)

NSSWITCH_CONF = """\
# 最小 NSS 配置（Android 无 /etc，由 DSH App 随包提供；
# resolv.conf 由 MainActivity 每次启动刷新生成）
hosts: files dns
passwd: files
group: files
shadow: files
gshadow: files
protocols: files
services: files
ethers: files
rpc: files
networks: files
"""


def die(msg: str) -> None:
    print(f"fetch.py: 错误: {msg}", file=sys.stderr)
    sys.exit(1)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_lock() -> dict:
    if LOCK_PATH.is_file():
        return json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    return {"artifacts": {}}


def save_lock(lock: dict) -> None:
    LOCK_PATH.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n",
                         encoding="utf-8")


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  下载 {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "dsh-runtime-glibc-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, dest.open("wb") as out:
        shutil.copyfileobj(resp, out)


def ensure_artifact(name: str, spec: dict, lock: dict) -> Path:
    """返回缓存路径；lock 有哈希则强校验，无则引导写入。"""
    expected = lock["artifacts"].get(name, {}).get("sha256")
    cache = CACHE_DIR / Path(spec["url"].split("?")[0]).name
    if cache.is_file():
        actual = sha256_file(cache)
        if expected is None:
            if actual != spec.get("sha256") and spec.get("sha256") is not None:
                die(f"{name}: 缓存哈希与 ARTIFACTS 硬编码不符: {actual}")
            # 缓存存在但 lock 未引导 → 直接用缓存哈希引导
            lock["artifacts"][name] = {
                "version": spec["version"], "url": spec["url"], "sha256": actual,
            }
            print(f"  {name}: 首次引导 sha256={actual}")
        elif actual != expected:
            die(f"{name}: 缓存 sha256 不匹配（lock={expected} 实际={actual}）→ 删除缓存重跑")
        else:
            print(f"  {name}: 缓存命中且哈希匹配，跳过下载")
        return cache
    download(spec["url"], cache)
    actual = sha256_file(cache)
    if spec.get("sha256") is not None and actual != spec["sha256"]:
        die(f"{name}: 下载物 sha256 不匹配（期望 {spec['sha256']} 实际 {actual}）")
    # node 额外对照官方 SHASUMS256.txt
    if spec.get("verify_url"):
        verify_url: str = spec["verify_url"]
        verify_line: str = spec["verify_line"]
        ref = CACHE_DIR / Path(verify_url).name
        if not ref.is_file():
            download(verify_url, ref)
        lines = ref.read_text(encoding="utf-8").splitlines()
        hit = [ln for ln in lines if ln.strip().endswith(verify_line)]
        if not hit or hit[0].split()[0] != actual:
            die(f"{name}: 官方 {Path(verify_url).name} 校验失败（本地 {actual}，官方 {hit}）")
        print(f"  {name}: 官方 SHASUMS256 校验通过")
    if expected is None:
        lock["artifacts"][name] = {
            "version": spec["version"], "url": spec["url"], "sha256": actual,
        }
        print(f"  {name}: 首次引导 sha256={actual}")
    else:
        print(f"  {name}: sha256 校验通过")
    return cache


# ---------------------------------------------------------------------------
# ELF 解析（ELF64 小端 only）
# ---------------------------------------------------------------------------
PT_LOAD = 1
PT_DYNAMIC = 2
DT_NULL = 0
DT_NEEDED = 1
DT_STRTAB = 5


class ElfInfo:
    __slots__ = ("machine", "max_load_align", "needed", "interp", "is_dyn")

    def __init__(self) -> None:
        self.machine = 0
        self.max_load_align = 0
        self.needed: list[str] = []
        self.interp: str | None = None
        self.is_dyn = False


def parse_elf(path: Path) -> ElfInfo | None:
    data = path.read_bytes()
    if len(data) < 64 or data[:4] != b"\x7fELF":
        return None
    ei_class, ei_data = data[4], data[5]
    if ei_class != 2 or ei_data != 1:
        die(f"{path.name}: 仅支持 ELF64 小端（class={ei_class} data={ei_data}）")
    e_type, e_machine, _ver, _entry, e_phoff, _shoff, _flags, \
        _ehsize, e_phentsize, e_phnum = struct.unpack_from("<HHIQQQIHHH", data, 16)
    info = ElfInfo()
    info.machine = e_machine
    info.is_dyn = e_type == 3  # ET_DYN
    loads: list[tuple[int, int, int]] = []  # (vaddr, filesz, offset)
    dynamic: tuple[int, int] | None = None  # (offset, size)
    for i in range(e_phnum):
        off = e_phoff + i * e_phentsize
        p_type, _flags, p_offset, p_vaddr, _paddr, p_filesz, _memsz, p_align = \
            struct.unpack_from("<IIQQQQQQ", data, off)
        if p_type == PT_LOAD:
            info.max_load_align = max(info.max_load_align, p_align)
            loads.append((p_vaddr, p_filesz, p_offset))
        elif p_type == PT_DYNAMIC:
            dynamic = (p_offset, p_filesz)
        elif p_type == 3:  # PT_INTERP
            end = data.index(b"\x00", p_offset, p_offset + p_filesz)
            info.interp = data[p_offset:end].decode("ascii", "replace")
    if dynamic is not None:
        d_off, d_size = dynamic
        strtab_vaddr: int | None = None
        entries: list[tuple[int, int]] = []
        for j in range(d_size // 16):
            tag, val = struct.unpack_from("<QQ", data, d_off + j * 16)
            if tag == DT_NULL:
                break
            entries.append((tag, val))
            if tag == DT_STRTAB:
                strtab_vaddr = val
        if strtab_vaddr is not None:
            strtab_off: int | None = None
            for vaddr, filesz, offset in loads:
                if vaddr <= strtab_vaddr < vaddr + filesz:
                    strtab_off = strtab_vaddr - vaddr + offset
                    break
            if strtab_off is not None:
                for tag, val in entries:
                    if tag != DT_NEEDED:
                        continue
                    end = data.index(b"\x00", strtab_off + val)
                    info.needed.append(
                        data[strtab_off + val:end].decode("utf-8", "replace"))
    return info


def check_elfs(out_dir: Path) -> None:
    """16KB 对齐检查 + DT_NEEDED 完备性检查。"""
    elv: list[Path] = []
    for sub in ("bin", "lib"):
        d = out_dir / sub
        if d.is_dir():
            elv.extend(sorted(p for p in d.iterdir() if p.is_file()))
    if not elv:
        die("产物为空，无法校验")

    print(f"== ELF 16KB 页对齐检查（{len(elv)} 个文件）==")
    align_fail: list[str] = []
    infos: dict[str, ElfInfo] = {}
    for p in elv:
        info = parse_elf(p)
        if info is None:
            print(f"  [skip] {p.name}: 非 ELF（清单/配置文件）")
            continue
        if info.machine != EM_AARCH64:
            die(f"{p.name}: 非 aarch64 ELF（machine={info.machine}）")
        infos[p.name] = info
        if info.max_load_align >= MIN_PAGE_ALIGN:
            print(f"  [ok]   {p.name}: PT_LOAD p_align={info.max_load_align:#x}")
        else:
            align_fail.append(f"{p.name}: p_align={info.max_load_align:#x} < {MIN_PAGE_ALIGN:#x}")
    if align_fail:
        die("16KB 对齐检查失败：\n  " + "\n  ".join(align_fail))
    print("  16KB 对齐检查 0 失败")

    print("== DT_NEEDED 递归完备性检查 ==")
    # lib 集合 = lib/ 下全部文件名（soname 解析按文件名匹配）
    avail = {p.name for p in (out_dir / "lib").iterdir()} if (out_dir / "lib").is_dir() else set()
    missing: dict[str, list[str]] = []
    checked = 0
    for name, info in sorted(infos.items()):
        if not info.needed:
            continue
        checked += 1
        for needed in info.needed:
            if needed not in avail:
                missing.append(f"{name} -> {needed}")
    if missing:
        die("库完备性检查失败（缺失 NEEDED）：\n  " + "\n  ".join(missing))
    print(f"  {checked} 个动态 ELF 的 NEEDED 全部解析成功（lib 集合 {len(avail)} 个文件）")


# ---------------------------------------------------------------------------
# 解包落位
# ---------------------------------------------------------------------------
def _resolve_tar_target(members: dict[str, tarfile.TarInfo], link: str,
                        member_name: str) -> tarfile.TarInfo | None:
    """把 tar 内 symlink/硬链接目标解析成成员（可能带 ../）。

    member_name 是链接成员自身的完整路径；其所在目录为解析基准。
    """
    base = member_name.rsplit("/", 1)[0] if "/" in member_name else ""
    target = link
    if not target.startswith("/"):
        target = (base + "/" + target) if base else target
    parts: list[str] = []
    for part in target.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return members.get("/".join(parts))


def _copy_member(t: tarfile.TarFile, member: tarfile.TarInfo,
                 dest: Path, members: dict[str, tarfile.TarInfo]) -> None:
    """提取文件成员；symlink/硬链接解析后实体化（Windows/Android 均不建链接）。"""
    if member.issym() or member.islnk():
        src = _resolve_tar_target(members, member.linkname, member.name)
        if src is None:
            die(f"tar 内链接目标无法解析: {member.name} -> {member.linkname}")
        if src.issym() or src.islnk():
            # 允许一层间接链接（如 ld.so -> ld-linux-aarch64.so.1 -> 实体）
            src2 = _resolve_tar_target(members, src.linkname, src.name)
            if src2 is None or src2.issym() or src2.islnk():
                die(f"tar 内链接解析超过两层: {member.name} -> {member.linkname}")
            src = src2
        with t.extractfile(src) as fsrc, dest.open("wb") as fdst:
            shutil.copyfileobj(fsrc, fdst)
    else:
        with t.extractfile(member) as fsrc, dest.open("wb") as fdst:
            shutil.copyfileobj(fsrc, fdst)


def extract_gpkg(pkg: Path, prefix_dir: str, dest: Path,
                 whitelist: tuple[str, ...] | None = None) -> list[str]:
    """从 gpkg 包提取 lib 文件（prefix 形如 .../glibc/lib），返回落位文件名。"""
    placed: list[str] = []
    with tarfile.open(pkg) as t:
        members = {m.name: m for m in t.getmembers()}
        for name, member in members.items():
            if not name.startswith(prefix_dir + "/"):
                continue
            basename = name.rsplit("/", 1)[-1]
            if not basename or member.isdir():
                continue
            if whitelist is not None and basename not in whitelist:
                continue
            _copy_member(t, member, dest / basename, members)
            placed.append(basename)
    return placed


def extract_single_by_pattern(pkg: Path, member_suffix: str, dest: Path,
                              out_name: str) -> None:
    """从 tar 包提取唯一匹配的成员并落位为 out_name。"""
    with tarfile.open(pkg) as t:
        members = {m.name: m for m in t.getmembers()}
        hits = [m for n, m in members.items()
                if n.endswith(member_suffix) and not (m.issym() or m.islnk())]
        if len(hits) != 1:
            die(f"{pkg.name}: 期望唯一匹配 *{member_suffix}，实际 {len(hits)} 个: "
                + ", ".join(m.name for m in hits[:5]))
        _copy_member(t, hits[0], dest / out_name, members)


# libc 内编译死的配置文件路径（gpkg Termux 前缀）→ App 私有目录等价路径。
# 新路径必须 ≤ 原长度-1（留 NUL 终止）；两个串在 libc 内各恰好出现 1 次。
LIBC_PATH_REWRITES: tuple[tuple[bytes, bytes], ...] = (
    (b"/data/data/com.termux/files/usr/glibc/etc/resolv.conf",
     b"/data/user/0/com.deepseek.harness/files/etc/r.conf"),
    (b"/data/data/com.termux/files/usr/glibc/etc/nsswitch.conf",
     b"/data/user/0/com.deepseek.harness/files/etc/n.conf"),
)


def patch_libc_paths(libc: Path) -> None:
    data = bytearray(libc.read_bytes())
    for old, new in LIBC_PATH_REWRITES:
        if old not in data and new in data:
            continue  # 已补丁过（幂等）
        cnt = data.count(old)
        if cnt != 1:
            die(f"libc.so.6: 期望 {old.decode()!r} 恰好出现 1 次，实际 {cnt} 次")
        if len(new) > len(old) - 1:
            die(f"libc.so.6: 替换路径 {new.decode()!r} 超过原串长度，放不下")
        idx = data.index(old)
        data[idx:idx + len(old)] = new + b"\x00" * (len(old) - len(new))
        print(f"  libc.so.6 补丁: ...{old.decode()[-24:]} -> {new.decode()}")
    libc.write_bytes(bytes(data))


def assemble(cache: dict[str, Path]) -> None:
    bin_dir = OUT_DIR / "bin"
    lib_dir = OUT_DIR / "lib"
    etc_dir = OUT_DIR / "etc"
    for d in (bin_dir, lib_dir, etc_dir):
        d.mkdir(parents=True, exist_ok=True)

    print("== 组装 ==")
    # 1) 官方 node（只要 bin/node；npm/corepack/include/docs 全部裁掉）
    extract_single_by_pattern(cache["node"], "/bin/node", bin_dir, "node")
    print("  bin/node  <- nodejs.org 官方 linux-arm64")

    # 2) glibc 核心库（白名单裁剪；soname 实体化由 _copy_member 保证）
    placed = extract_gpkg(cache["glibc"], "data/data/com.termux/files/usr/glibc/lib",
                          lib_dir, GLIBC_LIBS)
    absent = [n for n in GLIBC_LIBS if n not in placed and n != "ld.so"]
    if absent:
        die(f"glibc 包缺库: {absent}")
    print(f"  lib/      <- gpkg glibc {placed and ''}({len(placed)} 个库)")

    # 3) gcc-libs（libstdc++/libgcc_s）
    placed2 = extract_gpkg(cache["gcc-libs"], "data/data/com.termux/files/usr/glibc/lib",
                           lib_dir, GCC_LIBS)
    absent2 = [n for n in GCC_LIBS if n not in placed2]
    if absent2:
        die(f"gcc-libs 包缺库: {absent2}")
    print(f"  lib/      <- gpkg gcc-libs ({len(placed2)} 个库)")

    # 3.5) libc 路径二进制补丁（真机 2026-09-11 实证必需）：gpkg glibc 把
    #      resolv.conf/nsswitch.conf 路径编译死为 Termux 前缀，本 App 设备上不存在
    #      → getaddrinfo 直接失败。就地改写为 App 私有目录下的更短等价路径
    #      （≤原长度，NUL 填充；MainActivity 每次引擎启动刷新 files/etc/{r,n}.conf）。
    patch_libc_paths(lib_dir / "libc.so.6")

    # 4) TEG（包内名 libtermux-exec.so，保持原名）
    extract_gpkg(cache["termux-exec-glibc"],
                 "data/data/com.termux/files/usr/glibc/lib", lib_dir, None)
    if not (lib_dir / "libtermux-exec.so").is_file():
        die("termux-exec-glibc 包内未找到 libtermux-exec.so")
    print("  lib/libtermux-exec.so  <- gpkg termux-exec-glibc（TEG）")

    # 5) musl/静态工具
    extract_single_by_pattern(cache["ripgrep"], "/rg", bin_dir, "rg")
    print("  bin/rg    <- ripgrep 官方 aarch64-unknown-linux-musl")
    shutil.copyfile(cache["curl-static"], bin_dir / "curl")
    print("  bin/curl  <- pkgforge-dev 镜像静态 curl")
    shutil.copyfile(cache["busybox"], bin_dir / "busybox")
    print("  bin/busybox <- pkgforge-dev 镜像 musl busybox")

    # 6) 设备端符号链接清单 + NSS 配置
    symlinks = {f"bin/{n}": "busybox" for n in BUSYBOX_LINKS}
    (OUT_DIR / "symlinks.json").write_text(
        json.dumps({"comment": "MainActivity 首启在设备上按此清单创建链接"
                               "（link -> symlink -> copy 三级回退）；"
                               "Windows 宿主无法创建 Linux symlink",
                    "links": symlinks}, indent=2) + "\n", encoding="utf-8")
    (etc_dir / "nsswitch.conf").write_text(NSSWITCH_CONF, encoding="utf-8")
    print(f"  symlinks.json（{len(symlinks)} 条）+ etc/nsswitch.conf")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true",
                        help="只跑校验，不下载（要求产物已就绪）")
    args = parser.parse_args()

    lock = load_lock()
    if not args.check:
        cache: dict[str, Path] = {}
        print("== 获取下载物 ==")
        for name, spec in ARTIFACTS.items():
            cache[name] = ensure_artifact(name, spec, lock)
        save_lock(lock)
        print(f"  lock 已写入 {LOCK_PATH}")
        assemble(cache)

    check_elfs(OUT_DIR)
    print("fetch.py: 全部校验通过")


if __name__ == "__main__":
    main()
