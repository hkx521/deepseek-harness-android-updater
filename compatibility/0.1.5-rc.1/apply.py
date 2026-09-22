from __future__ import annotations

from pathlib import Path


def _replace_exact(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"expected exactly one compatibility match in {path}, found {count}"
        )
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def _replace_function_until(
    path: Path,
    start_marker: str,
    end_marker: str,
    replacement: str,
) -> None:
    # 幂等保护（2026-09-11）：替换结果已逐字存在时跳过，重跑 apply() 成为 no-op。
    # 首次运行时 replacement 不在文件中，仍走区间替换（上游漂移由 index() 抛错暴露）。
    text = path.read_text(encoding="utf-8")
    if replacement in text:
        return
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


# dsh-tool-fs-search 的 Android ripgrep 解析块（2026-09-13 #8 重写版）。
# 解析顺序：显式 DSH_RG_PATH env（仍最高，MainActivity 注入保留为覆盖口/逃生口）
# → payload 根探测：从本模块目录向上找持有 runtime/ 的祖先（即 payload 根），
# 依次拼 runtime/bin/rg（bionic）与 runtime-glibc/bin/rg（glibc，均为 musl 静态 rg）。
# 探测失败如实拒绝（runRipgrep 捕获后归类 SEARCH_FAILED），Android 下不再回落
# @vscode/ripgrep——payload 里该包无 linux-arm64 平台二进制（bin/ 为空，rgPath 指向
# 不存在的文件），import 它只会得到一个必然 spawn 失败的路径（死兜底）。
# dirname(process.execPath) 锚定一并移除：glibc 模式 execPath 是 ld-linux
# （dirname 带 lib/ 偏移），同目录探测永远落空——这正是 DSH_RG_PATH env 兜底的历史成因。
_FS_SEARCH_ANDROID_BLOCK = (
    '\t\tif (process.env.DSH_ANDROID === "1") {\n'
    '\t\t\tif (process.env.DSH_RG_PATH && existsSync(process.env.DSH_RG_PATH)) return process.env.DSH_RG_PATH;\n'
    '\t\t\t// Payload root probe: walk up from the directory of this module to the\n'
    '\t\t\t// ancestor holding runtime/, then prefer the packaged static rg (bionic\n'
    '\t\t\t// first, glibc second). dirname(process.execPath) is not a usable anchor:\n'
    '\t\t\t// bionic mode it is runtime/bin/node, glibc mode it is\n'
    '\t\t\t// runtime-glibc/lib/ld-linux-*.so.1 (dirname carries a lib/ offset).\n'
    '\t\t\t// @vscode/ripgrep ships no linux-arm64 platform binary in the payload, so\n'
    '\t\t\t// a failed probe rejects and the caller surfaces SEARCH_FAILED instead of\n'
    '\t\t\t// spawning a path that cannot exist.\n'
    '\t\t\tlet root = decodeURIComponent(new URL(".", import.meta.url).pathname);\n'
    '\t\t\tfor (let i = 0; i < 8; i++) {\n'
    '\t\t\t\tconst bionicRg = join(root, "runtime", "bin", "rg");\n'
    '\t\t\t\tif (existsSync(bionicRg)) return bionicRg;\n'
    '\t\t\t\tconst glibcRg = join(root, "runtime-glibc", "bin", "rg");\n'
    '\t\t\t\tif (existsSync(glibcRg)) return glibcRg;\n'
    '\t\t\t\tconst parent = join(root, "..");\n'
    '\t\t\t\tif (parent === root) break;\n'
    '\t\t\t\troot = parent;\n'
    '\t\t\t}\n'
    '\t\t\tthrow new Error("DSH Android: ripgrep not found under payload root (runtime/bin/rg, runtime-glibc/bin/rg); set DSH_RG_PATH to override");\n'
    '\t\t}\n'
    '\t\treturn (await import("@vscode/ripgrep")).rgPath;'
)

# 2026-09-13 #8 之前的旧补丁块（executable.dir 同目录探测 + env 次优先 + @vscode 死兜底）。
# 仅用于把已 prepare 的 devhome（旧补丁已生效）迁移到新块；全新上游文件不含此块，
# 迁移调用自动跳过，由下方 ORIGINAL 替换负责首次打补丁。
_FS_SEARCH_OLD_ANDROID_BLOCK = (
    '\t\tif (process.env.DSH_ANDROID === "1") {\n'
    '\t\t\tconst androidRg = join(executable.dir, process.platform === "win32" ? "rg.exe" : "rg");\n'
    '\t\t\tif (existsSync(androidRg)) return androidRg;\n'
    '\t\t\tif (process.env.DSH_RG_PATH && existsSync(process.env.DSH_RG_PATH)) return process.env.DSH_RG_PATH;\n'
    '\t\t}\n'
    '\t\treturn (await import("@vscode/ripgrep")).rgPath;'
)

# 批次22 W-B（#P0-②/③）引擎怠速功耗治理：Android 下关停两处常驻轮询。
# 上游为 PC dev 场景设计，Android 上没有对应的"编辑者"，轮询纯属空转：
#   ② dsh-client-hmr 在 ctx.effect 里挂 500ms（pollIntervalMs）statSync 轮询，
#      每轮对全部 client 模块 watch 逐个 statSync。SSE 路由与 graph 服务保留，
#      仅停轮询定时器（clearInterval(void 0) 是 no-op，timer?.unref?.() 同理）。
#   ③ dsh-skill-filesystem 的 retainRoot 为每个 retained root 挂 chokidar
#      递归 watcher。Android 下 skill 由插件静态提供，无人工编辑面。
# 两者均以 DSH_ANDROID=1（MainActivity 注入）为闸门，PC dev 行为零变化。
_CLIENT_HMR_POLL_OLD_BLOCK = (
    "\t\tconst timer = setInterval(pollWatches, pollIntervalMs);\n"
    "\t\ttimer.unref();"
)
_CLIENT_HMR_POLL_NEW_BLOCK = (
    '\t\tconst timer = process.env.DSH_ANDROID === "1" ? void 0 : setInterval(pollWatches, pollIntervalMs);\n'
    "\t\ttimer?.unref?.();"
)
_SKILL_FS_WATCHER_OLD = "\t\tif (this.config.enabled) await this.ensureWatcher(state);"
_SKILL_FS_WATCHER_NEW = (
    '\t\tif (this.config.enabled && process.env.DSH_ANDROID !== "1")'
    " await this.ensureWatcher(state);"
)

# (包相对路径, 旧片段, 新片段)。同名包在 dshroot 树与 profile 树各有一份拷贝。
_IDLE_POWER_PATCHES = (
    (
        "dsh-client-hmr/lib/index.js",
        _CLIENT_HMR_POLL_OLD_BLOCK,
        _CLIENT_HMR_POLL_NEW_BLOCK,
    ),
    (
        "dsh-skill-filesystem/lib/index.js",
        _SKILL_FS_WATCHER_OLD,
        _SKILL_FS_WATCHER_NEW,
    ),
)


def apply(devhome: Path, replace_once) -> None:
    """对 devhome 应用 Android 兼容补丁。

    2026-09-11 起整体幂等：每个补丁先检查替换结果是否已存在，已打补丁的
    devhome 重跑本函数是 no-op（此前重跑会在 import 替换处 count=0 报错）。
    上游漂移仍会被暴露：new 不在时回落 replace_once，要求 count==1。
    2026-09-13 批次22 W-B 起尾部追加 apply_android_idle_power（怠速功耗治理，
    双树补丁，profile 树缺失时按可选跳过）。
    """
    node_modules = devhome / "dshroot" / "lib" / "node_modules"

    attachment = (
        node_modules
        / "@deepseek-ai"
        / "dsh-attachment-local"
        / "lib"
        / "index.js"
    )
    _replace_unless_present(
        attachment,
        'import { chmod, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";',
        'import { chmod, copyFile, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";',
        replace_once,
    )
    _replace_unless_present(
        attachment,
        '\t\t\tawait link(source, target);',
        '\t\t\tawait copyFile(source, target, constants.COPYFILE_EXCL);',
        replace_once,
    )
    _replace_unless_present(
        attachment,
        '\t\t\tawait link(staged.path, target);',
        '\t\t\tawait copyFile(staged.path, target, constants.COPYFILE_EXCL);',
        replace_once,
    )
    _replace_function_until(
        attachment,
        "async function normalizeImage(",
        "\n//#endregion",
        """async function normalizeImage(data, detected) {
	// 批次 15a（#3 方案 A）：真 sharp 可用时 EXIF 方向纠正 + >2048 长边缩放 + 重编码；
	// 替身/任何失败 → 原样透传（fail-safe，与历史行为一致）。require 解析到
	// @deepseek-ai/dsh/node_modules/sharp（条件加载器：glibc 真模块 / bionic 回退替身）。
	try {
		const sharpMod = require("sharp");
		if (typeof sharpMod !== "function") throw new Error("substitute sharp");
		let img = sharpMod(data, { failOn: "none" }).rotate();
		const meta = await img.metadata();
		const w = meta.width || detected.width || 0;
		const h = meta.height || detected.height || 0;
		const LIMIT = 2048;
		const needsResize = w > LIMIT || h > LIMIT;
		if (needsResize) {
			img = w >= h
				? img.resize({ width: LIMIT, withoutEnlargement: true })
				: img.resize({ height: LIMIT, withoutEnlargement: true });
		}
		const isPng = (meta.format || detected.format) === "png";
		const out = isPng
			? await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
			: await img.jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
		if (!needsResize && out.data.length >= data.length) {
			return { data, mediaType: detected.mediaType, width: w, height: h };
		}
		return {
			data: out.data,
			mediaType: isPng ? "image/png" : "image/jpeg",
			width: out.info.width,
			height: out.info.height
		};
	} catch (err) {
		return {
			data,
			mediaType: detected.mediaType,
			width: detected.width,
			height: detected.height
		};
	}
}
""",
    )
    _replace_function_until(
        attachment,
        "async function createRequestImage(",
        "\nfunction cachePath(",
        """async function createRequestImage(attachment) {
	// 批次 15a：与 normalizeImage 同策略（真 sharp → EXIF/缩放/重编码；失败透传）。
	try {
		const sharpMod = require("sharp");
		if (typeof sharpMod !== "function") throw new Error("substitute sharp");
		let img = sharpMod(attachment.data, { failOn: "none" }).rotate();
		const meta = await img.metadata();
		const w = meta.width || attachment.ref.width || 0;
		const h = meta.height || attachment.ref.height || 0;
		const LIMIT = 2048;
		const needsResize = w > LIMIT || h > LIMIT;
		if (needsResize) {
			img = w >= h
				? img.resize({ width: LIMIT, withoutEnlargement: true })
				: img.resize({ height: LIMIT, withoutEnlargement: true });
		}
		const isPng = (meta.format || "png") === "png";
		const out = isPng
			? await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
			: await img.jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
		if (!needsResize && out.data.length >= attachment.data.length) {
			return {
				data: attachment.data,
				mediaType: attachment.ref.mediaType,
				width: w,
				height: h
			};
		}
		return {
			data: out.data,
			mediaType: isPng ? "image/png" : "image/jpeg",
			width: out.info.width,
			height: out.info.height
		};
	} catch (err) {
		return {
			data: attachment.data,
			mediaType: attachment.ref.mediaType,
			width: attachment.ref.width,
			height: attachment.ref.height
		};
	}
}
""",
    )

    session_store = (
        node_modules
        / "@deepseek-ai"
        / "dsh-session-persistence-jsonl"
        / "lib"
        / "index.js"
    )
    _replace_unless_present(
        session_store,
        'import { readdirSync } from "node:fs";',
        'import { constants as fsConstants, readdirSync } from "node:fs";',
        replace_once,
    )
    _replace_unless_present(
        session_store,
        'import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";',
        'import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";',
        replace_once,
    )
    _replace_unless_present(
        session_store,
        "\t\tawait internals.fs.link(staged, currentPath);",
        "\t\tawait internals.fs.copyFile(staged, currentPath, fsConstants.COPYFILE_EXCL);",
        replace_once,
    )
    _replace_unless_present(
        session_store,
        "\t\t\tawait link(tmp, finalPath);",
        "\t\t\tawait copyFile(tmp, finalPath, fsConstants.COPYFILE_EXCL);",
        replace_once,
    )
    _replace_unless_present(
        session_store,
        "\tlink,",
        "\tcopyFile,",
        replace_once,
    )

    subprocess = (
        node_modules
        / "@deepseek-ai"
        / "dsh-subprocess-local"
        / "lib"
        / "index.js"
    )
    _replace_unless_present(
        subprocess,
        "\t\tlet fallbackReason;",
        """\t\tif (process.env.DSH_ANDROID === "1" || platform === "android") {
\t\t\tthis.warnFallback(platform, kind, "Android has no supported native process-range owner");
\t\t\treturn "fallback";
\t\t}
\t\tlet fallbackReason;""",
        replace_once,
    )

    apply_write_and_search(devhome, replace_once)

    apply_attachment_durability(devhome, replace_once)

    apply_android_idle_power(devhome, replace_once)

    apply_bash_local_sandbox_mode(devhome, replace_once)

    apply_client_connection_jet_hub(devhome, replace_once)


def apply_android_idle_power(devhome: Path, replace_once) -> None:
    """Android 适配（批次22 W-B）：关停引擎怠速轮询（幂等，可独立调用）。

    - dsh-client-hmr：Android 停掉 500ms statSync 轮询定时器（#P0-②）；
    - dsh-skill-filesystem：Android 不再为 retained root 挂 chokidar watcher（#P0-③）。

    双树说明：同名包在 dshroot 树（dshroot/lib/node_modules，npm ci 装的内核）
    与 profile 树（.dsh/profiles/node_modules，引擎在宿主机物化的共享 profile
    依赖树）各有一份拷贝，运行时哪份被加载取决于宿主形态，故两树都打。既有
    补丁函数只声明 dshroot 单树，本函数显式处理双树：
    - dshroot 树文件必须存在（内核装机必有，缺失/漂移照常抛错）；
    - profile 树文件可选——payload 不携带 profiles/node_modules（build.sh 只
      装 web/node_modules 的三插件 + shim），全新 prepare 的 devhome 没有这棵
      树，缺失时整体跳过、不算漂移；但文件存在而新旧片段皆无时仍按上游漂移
      抛错。
    """
    dshroot_ai = devhome / "dshroot" / "lib" / "node_modules" / "@deepseek-ai"
    for relative, old, new in _IDLE_POWER_PATCHES:
        _patch_idle_power(
            dshroot_ai / relative, old, new, replace_once, required=True
        )

    profile_ai = (
        devhome / ".dsh" / "profiles" / "node_modules" / "@deepseek-ai"
    )
    for relative, old, new in _IDLE_POWER_PATCHES:
        _patch_idle_power(
            profile_ai / relative, old, new, replace_once, required=False
        )


def _patch_idle_power(
    path: Path, old: str, new: str, replace_once, *, required: bool
) -> None:
    """三态幂等替换（批次22 W-B）：
    - 新片段已逐字存在 → 已打过补丁，跳过（重跑 no-op）；
    - 旧片段存在 → replace_once 精确一次替换（count!=1 由它以 UpdaterError 暴露）；
    - 新旧片段皆无 → 上游漂移，replace_once 以 count=0 抛错，如实失败。
    required=False 且文件不存在 → 整体跳过（可选树，见 apply_android_idle_power
    的双树说明）；required=True 时缺失视为补丁目标损坏，照常报错。
    """
    if not path.is_file():
        if required:
            raise RuntimeError(f"compatibility target is missing: {path}")
        return
    if new in path.read_text(encoding="utf-8"):
        return
    replace_once(path, old, new)


_ATTACHMENT_SYNC_DIR_FINAL = """async function syncDirectory(path) {
	/* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
	if (process.platform === "win32") return;
	/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY);
	} catch (error) {
		/* Android: ancestors above the app sandbox (e.g. /data/user/0, mode
		   dr-x--x--x) reject O_RDONLY opens from the app, so the durability
		   walk from DSH_HOME toward the filesystem root cannot fsync them.
		   Skip the unopenable level: synced data already lives below it,
		   and durability of the inaccessible prefix is owned by the OS. */
		if (error && (error.code === "EACCES" || error.code === "EPERM")) return;
		throw error;
	}
	try {
		await handle.sync();
	} catch (error) {
		/* Android: a directory handle can open successfully yet still reject
		   fsync. The filesystem root ("/") reports EINVAL, and some FUSE /
		   sdcardfs mounts report ENOTSUP. Same rationale as the unopenable
		   level above: synced data already lives below this level, and
		   durability of that prefix is owned by the OS, so skip it instead
		   of failing the whole attachment write. */
		if (!(error && (error.code === "EINVAL" || error.code === "ENOTSUP" || error.code === "EOPNOTSUPP" || error.code === "EACCES" || error.code === "EPERM"))) throw error;
	} finally {
		await handle.close();
	}
	/* v8 ignore stop */
}"""

_ATTACHMENT_SYNC_DIR_INTERMEDIATE = """async function syncDirectory(path) {
	/* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
	if (process.platform === "win32") return;
	/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY);
	} catch (error) {
		/* Android: ancestors above the app sandbox (e.g. /data/user/0, mode
		   dr-x--x--x) reject O_RDONLY opens from the app, so the durability
		   walk from DSH_HOME toward the filesystem root cannot fsync them.
		   Skip the unopenable level: synced data already lives below it,
		   and durability of the inaccessible prefix is owned by the OS. */
		if (error && (error.code === "EACCES" || error.code === "EPERM")) return;
		throw error;
	}
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
	/* v8 ignore stop */
}"""

_ATTACHMENT_SYNC_DIR_ORIGINAL = """async function syncDirectory(path) {
	/* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
	if (process.platform === "win32") return;
	/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
	const handle = await open(path, constants.O_RDONLY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
	/* v8 ignore stop */
}"""


def apply_attachment_durability(devhome: Path, replace_once) -> None:
    """Android 适配：上溯目录的持久化 fsync 在 /data/user/0 上必然 EACCES，
    在 / 等 rootfs 根目录或部分 FUSE 挂载点上报 EINVAL/ENOTSUP。

    dsh-attachment-local 的 ensureDurableHome 会从 DSH_HOME 逐级向上 fsync
    父目录直到文件系统根；DSH_HOME 位于 /data/local/tmp/dsh/home 或
    /data/user/0/<pkg>/files/payload/…，向上遍历到 / 时 open 成功但
    fsync(dirFd) 报 EINVAL，导致整个图片附件保存崩溃。

    修法：
    1) open 遇 EACCES/EPERM 时跳过该层；
    2) handle.sync() 遇 EINVAL/ENOTSUP/EOPNOTSUPP/EACCES/EPERM 时跳过。
    """
    attachment = (
        devhome
        / "dshroot"
        / "lib"
        / "node_modules"
        / "@deepseek-ai"
        / "dsh-attachment-local"
        / "lib"
        / "index.js"
    )
    text = attachment.read_text(encoding="utf-8")
    if _ATTACHMENT_SYNC_DIR_FINAL in text:
        return
    if _ATTACHMENT_SYNC_DIR_INTERMEDIATE in text:
        attachment.write_text(text.replace(_ATTACHMENT_SYNC_DIR_INTERMEDIATE, _ATTACHMENT_SYNC_DIR_FINAL, 1), encoding="utf-8")
        return
    replace_once(attachment, _ATTACHMENT_SYNC_DIR_ORIGINAL, _ATTACHMENT_SYNC_DIR_FINAL)


def _replace_unless_present(path: Path, old: str, new: str, replace_once) -> None:
    """幂等版 replace_once：目标串已存在则跳过（用于对已 prepare 好的 devhome 追加补丁）。"""
    if new in path.read_text(encoding="utf-8"):
        return
    replace_once(path, old, new)


def apply_write_and_search(devhome: Path, replace_once) -> None:
    """Android 适配：write 工具落盘（禁硬链接）+ grep 的 ripgrep 解析。

    可独立调用且幂等，便于对已 prepare 好的 devhome 单独追加这两项。
    """
    ai = devhome / "dshroot" / "lib" / "node_modules" / "@deepseek-ai"

    # 1) dsh-fs-local：Android SELinux 禁硬链接。createIfAbsent（新建文件）原本用
    #    linkFile() 发布 → EACCES；改用 copyFile(COPYFILE_EXCL)，保留「目标已存在即失败」语义。
    fs_local = ai / "dsh-fs-local" / "lib" / "index.js"
    _replace_unless_present(
        fs_local,
        'import { createReadStream } from "node:fs";',
        'import { constants as fsConstants, createReadStream } from "node:fs";',
        replace_once,
    )
    _replace_unless_present(
        fs_local,
        'import { chmod, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";',
        'import { chmod, copyFile, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";',
        replace_once,
    )
    _replace_unless_present(
        fs_local,
        "\t\t\tawait linkFile(tempPath, absolutePath);",
        "\t\t\tawait copyFile(tempPath, absolutePath, fsConstants.COPYFILE_EXCL);",
        replace_once,
    )

    # 2) dsh-tool-fs-search：Android 的 ripgrep 解析（2026-09-13 #8 重写）。
    #    旧块（executable.dir 同目录探测 + env 次优先 + @vscode 死兜底）→ 新块
    #   （env 最优先 + payload 根探测 + 探测失败如实拒绝）。迁移仅当旧块仍在；
    #    全新上游文件不含旧块，走下方 ORIGINAL 替换完成首次打补丁。
    fs_search = ai / "dsh-tool-fs-search" / "lib" / "index.js"
    if _FS_SEARCH_OLD_ANDROID_BLOCK in fs_search.read_text(encoding="utf-8"):
        text = fs_search.read_text(encoding="utf-8")
        fs_search.write_text(
            text.replace(_FS_SEARCH_OLD_ANDROID_BLOCK, _FS_SEARCH_ANDROID_BLOCK, 1),
            encoding="utf-8",
        )
    _replace_unless_present(
        fs_search,
        '\t\treturn (await import("@vscode/ripgrep")).rgPath;',
        _FS_SEARCH_ANDROID_BLOCK,
        replace_once,
    )


# ---------------------------------------------------------------------------
# dsh-bash-local：为 LocalBashExecutor 补齐 sandboxMode 属性。
# 官方 dsh-permission-presets 要求注入的 ctx.shell 必须暴露 sandboxMode 属性
# （presets 绑定沙箱模式）；Android 使用纯 JS subprocess 的 dsh-bash-local，
# 原生未声明该属性导致 permission 预设服务无法挂载。
# 此处补齐读写 sandboxMode，默认 'danger-full-access'，保证权限管理体系正常运作。
# ---------------------------------------------------------------------------
_BASH_LOCAL_TARGET = "dsh-bash-local/lib/index.js"

_BASH_LOCAL_SANDBOX_OLD = (
    "\tget config() {\n"
    "\t\treturn this.source();\n"
    "\t}"
)
_BASH_LOCAL_SANDBOX_NEW = (
    "\tget config() {\n"
    "\t\treturn this.source();\n"
    "\t}\n"
    "\t_sandboxMode = \"danger-full-access\";\n"
    "\tget sandboxMode() {\n"
    "\t\treturn this._sandboxMode ?? \"danger-full-access\";\n"
    "\t}\n"
    "\tset sandboxMode(value) {\n"
    "\t\tthis._sandboxMode = value;\n"
    "\t}"
)


def apply_bash_local_sandbox_mode(devhome: Path, replace_once=None) -> None:
    """Android 适配：为 dsh-bash-local 的 LocalBashExecutor 添加 sandboxMode 属性。

    双树打补丁：
    - dshroot 树必需（装机内核）；
    - profile 树可选（若存在则打补丁，缺失时跳过）。
    """
    if replace_once is None:
        from tools.dsh_updater.common import replace_once as default_replace_once
        replace_once = default_replace_once

    dshroot_target = (
        devhome
        / "dshroot"
        / "lib"
        / "node_modules"
        / "@deepseek-ai"
        / _BASH_LOCAL_TARGET
    )
    _patch_bash_local(dshroot_target, replace_once, required=True)

    profile_target = (
        devhome
        / ".dsh"
        / "profiles"
        / "node_modules"
        / "@deepseek-ai"
        / _BASH_LOCAL_TARGET
    )
    _patch_bash_local(profile_target, replace_once, required=False)


def _patch_bash_local(path: Path, replace_once, *, required: bool) -> None:
    """三态幂等替换：
    - 新片段已逐字存在 → 已打过补丁，跳过（重跑 no-op）；
    - 旧片段存在 → replace_once 精确一次替换；
    - 新旧片段皆无 → 上游漂移，replace_once 抛错。
    required=False 且文件不存在时跳过。
    """
    if not path.is_file():
        if required:
            raise RuntimeError(f"compatibility target is missing: {path}")
        return
    if _BASH_LOCAL_SANDBOX_NEW in path.read_text(encoding="utf-8"):
        return
    replace_once(path, _BASH_LOCAL_SANDBOX_OLD, _BASH_LOCAL_SANDBOX_NEW)


# ---------------------------------------------------------------------------
# dsh-client-connection: 解决 401 拦截，允许 loopback /api/jet-hub 内部请求免认证放行
# ---------------------------------------------------------------------------
_CLIENT_CONNECTION_TARGET = "dsh-client-connection/lib/index.js"
_CLIENT_CONNECTION_REJECTION_OLD = (
    "\t\t/** Apply the configured Host/Origin fence, then browser authentication. */\n"
    "\t\trequestRejection(request) {\n"
    "\t\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;\n"
    "\t\t\treturn this.browserAuth.isAuthenticated(request) ? void 0 : 401;\n"
    "\t\t}"
)
_CLIENT_CONNECTION_REJECTION_NEW = (
    "\t\t/** Apply the configured Host/Origin fence, then browser authentication. */\n"
    "\t\trequestRejection(request) {\n"
    "\t\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;\n"
    "\t\t\ttry {\n"
    '\t\t\t\tconst rawUrl = request.url ?? "";\n'
    '\t\t\t\tconst pathname = rawUrl.startsWith("http") ? new URL(rawUrl).pathname : new URL(rawUrl, "http://127.0.0.1").pathname;\n'
    '\t\t\t\tif (pathname === "/api/jet-hub" || pathname.startsWith("/api/jet-hub/")) {\n'
    '\t\t\t\t\tconst host = header$1(request.headers, "host");\n'
    "\t\t\t\t\tif (host !== void 0) {\n"
    "\t\t\t\t\t\tconst hostUrl = parseAuthority(host);\n"
    "\t\t\t\t\t\tif (hostUrl && (isLoopbackHostname(hostUrl.hostname) || isTrustedAuthority(hostUrl, this.trustedHosts))) {\n"
    "\t\t\t\t\t\t\treturn void 0;\n"
    "\t\t\t\t\t\t}\n"
    "\t\t\t\t\t}\n"
    "\t\t\t\t}\n"
    "\t\t\t} catch {}\n"
    "\t\t\treturn this.browserAuth.isAuthenticated(request) ? void 0 : 401;\n"
    "\t\t}"
)


def apply_client_connection_jet_hub(devhome: Path, replace_once=None) -> None:
    """Android 适配：网关层放行 loopback /api/jet-hub 请求，消除 401 拦截。"""
    if replace_once is None:
        from tools.dsh_updater.common import replace_once as default_replace_once
        replace_once = default_replace_once

    for subpath in (
        devhome / "dshroot" / "lib" / "node_modules" / "@deepseek-ai" / _CLIENT_CONNECTION_TARGET,
        devhome / ".dsh" / "profiles" / "node_modules" / "@deepseek-ai" / _CLIENT_CONNECTION_TARGET,
        devhome / ".dsh" / "profiles" / "web" / "node_modules" / "@deepseek-ai" / _CLIENT_CONNECTION_TARGET,
    ):
        if not subpath.is_file():
            continue
        text = subpath.read_text(encoding="utf-8")
        if _CLIENT_CONNECTION_REJECTION_NEW in text:
            continue
        if _CLIENT_CONNECTION_REJECTION_OLD in text:
            replace_once(subpath, _CLIENT_CONNECTION_REJECTION_OLD, _CLIENT_CONNECTION_REJECTION_NEW)


