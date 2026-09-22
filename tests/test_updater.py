from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.dsh_updater.apk import extract_zip_safely
from tools.dsh_updater.common import UpdaterError, load_lock, replace_once


class CommonTests(unittest.TestCase):
    def test_lock_has_pinned_upstream_commit(self) -> None:
        lock = load_lock()
        self.assertEqual(lock["dsh"]["version"], "0.1.5-rc.1")
        self.assertEqual(
            lock["dsh"]["upstream_commit"],
            "183f08e9c6dde7e36cd2318eaee70b0da08fb35e",
        )

    def test_replace_once_rejects_zero_matches(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "file.txt"
            path.write_text("abc", encoding="utf-8")
            with self.assertRaises(UpdaterError):
                replace_once(path, "missing", "value")


class ZipTests(unittest.TestCase):
    def test_extract_zip_safely(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "test.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("dir/file.txt", "hello")
            destination = root / "out"
            extract_zip_safely(archive, destination)
            self.assertEqual((destination / "dir" / "file.txt").read_text(), "hello")

    def test_extract_zip_rejects_parent_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "test.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("../escape.txt", "bad")
            with self.assertRaises(UpdaterError):
                extract_zip_safely(archive, root / "out")


class CompatibilityProfileTests(unittest.TestCase):
    def test_vscreen_shizuku_jar_is_staged_outside_app_private_storage(self) -> None:
        source = (
            Path(__file__).resolve().parents[1]
            / "android-app"
            / "src"
            / "com"
            / "deepseek"
            / "harness"
            / "VscreensManager.java"
        ).read_text(encoding="utf-8")
        self.assertIn("stageServerJarForShizuku", source)
        self.assertIn("getExternalFilesDir(\"vscreen\")", source)
        self.assertIn("ensureServerJar(ctx, channel)", source)

    # apply.py::apply_attachment_durability 的原块（批次16 加入）；夹具需包含
    # 该块才能让 replace_once 命中 count==1。
    SYNC_DIRECTORY_BLOCK = (
        "async function syncDirectory(path) {\n"
        "\t/* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */\n"
        "\tif (process.platform === \"win32\") return;\n"
        "\t/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */\n"
        "\tconst handle = await open(path, constants.O_RDONLY);\n"
        "\ttry {\n"
        "\t\tawait handle.sync();\n"
        "\t} finally {\n"
        "\t\tawait handle.close();\n"
        "\t}\n"
        "\t/* v8 ignore stop */\n"
        "}"
    )

    # 批次22 W-B 怠速功耗补丁的上游原片段（dsh-client-hmr / dsh-skill-filesystem）。
    HMR_UPSTREAM_BLOCK = (
        "\t\tconst timer = setInterval(pollWatches, pollIntervalMs);\n"
        "\t\ttimer.unref();"
    )
    SKILL_FS_UPSTREAM_BLOCK = (
        "\t\tif (this.config.enabled) await this.ensureWatcher(state);"
    )
    BASH_LOCAL_UPSTREAM_BLOCK = (
        "\tget config() {\n"
        "\t\treturn this.source();\n"
        "\t}"
    )

    def test_attachment_and_session_replacements(self) -> None:
        profile = (
            Path(__file__).resolve().parents[1]
            / "compatibility"
            / "0.1.5-rc.1"
        )
        namespace = {}
        exec((profile / "apply.py").read_text(encoding="utf-8"), namespace)

        with tempfile.TemporaryDirectory() as temp:
            devhome = Path(temp)
            modules = devhome / "dshroot" / "lib" / "node_modules"
            attachment = (
                modules
                / "@deepseek-ai"
                / "dsh-attachment-local"
                / "lib"
                / "index.js"
            )
            session_store = (
                modules
                / "@deepseek-ai"
                / "dsh-session-persistence-jsonl"
                / "lib"
                / "index.js"
            )
            attachment.parent.mkdir(parents=True)
            session_store.parent.mkdir(parents=True)
            attachment.write_text(
                "\n".join(
                    [
                        'import { chmod, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";',
                        "async function normalizeImage(data, detected, policy) {",
                        "\treturn 0;",
                        "}",
                        "//#endregion",
                        "async function createRequestImage(attachment, policy, hasAlpha) {",
                        "\treturn 0;",
                        "}",
                        "function cachePath() {}",
                        "\t\t\tawait link(source, target);",
                        "\t\t\tawait link(staged.path, target);",
                        self.SYNC_DIRECTORY_BLOCK,
                    ]
                ),
                encoding="utf-8",
            )
            session_store.write_text(
                "\n".join(
                    [
                        'import { readdirSync } from "node:fs";',
                        'import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";',
                        "\t\tawait internals.fs.link(staged, currentPath);",
                        "\t\t\tawait link(tmp, finalPath);",
                        "\tlink,",
                    ]
                ),
                encoding="utf-8",
            )
            subprocess = (
                modules
                / "@deepseek-ai"
                / "dsh-subprocess-local"
                / "lib"
                / "index.js"
            )
            subprocess.parent.mkdir(parents=True)
            subprocess.write_text(
                "\t\tlet fallbackReason;\n",
                encoding="utf-8",
            )

            # apply_write_and_search（批次15a/16）补丁目标：dsh-fs-local 与
            # dsh-tool-fs-search 的未打补丁上游原貌。
            fs_local = modules / "@deepseek-ai" / "dsh-fs-local" / "lib" / "index.js"
            fs_local.parent.mkdir(parents=True)
            fs_local.write_text(
                "\n".join(
                    [
                        'import { createReadStream } from "node:fs";',
                        'import { chmod, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";',
                        "\t\t\tawait linkFile(tempPath, absolutePath);",
                    ]
                ),
                encoding="utf-8",
            )
            fs_search = (
                modules / "@deepseek-ai" / "dsh-tool-fs-search" / "lib" / "index.js"
            )
            fs_search.parent.mkdir(parents=True)
            fs_search.write_text(
                'import { existsSync } from "node:fs";\n'
                "export async function resolveRgPath() {\n"
                '\t\treturn (await import("@vscode/ripgrep")).rgPath;\n'
                "}\n",
                encoding="utf-8",
            )

            # apply_android_idle_power（批次22 W-B）补丁目标：dsh-client-hmr 与
            # dsh-skill-filesystem，双树（dshroot + .dsh/profiles/node_modules）。
            hmr = modules / "@deepseek-ai" / "dsh-client-hmr" / "lib" / "index.js"
            skill = (
                modules
                / "@deepseek-ai"
                / "dsh-skill-filesystem"
                / "lib"
                / "index.js"
            )
            hmr.parent.mkdir(parents=True)
            skill.parent.mkdir(parents=True)
            hmr.write_text(self.HMR_UPSTREAM_BLOCK, encoding="utf-8")
            skill.write_text(self.SKILL_FS_UPSTREAM_BLOCK, encoding="utf-8")
            profile_ai = (
                devhome / ".dsh" / "profiles" / "node_modules" / "@deepseek-ai"
            )
            profile_hmr = profile_ai / "dsh-client-hmr" / "lib" / "index.js"
            profile_skill = profile_ai / "dsh-skill-filesystem" / "lib" / "index.js"
            profile_hmr.parent.mkdir(parents=True)
            profile_skill.parent.mkdir(parents=True)
            profile_hmr.write_text(self.HMR_UPSTREAM_BLOCK, encoding="utf-8")
            profile_skill.write_text(self.SKILL_FS_UPSTREAM_BLOCK, encoding="utf-8")

            # apply_bash_local_sandbox_mode 补丁目标：dsh-bash-local，双树。
            bash_local = modules / "@deepseek-ai" / "dsh-bash-local" / "lib" / "index.js"
            bash_local.parent.mkdir(parents=True)
            bash_local.write_text(self.BASH_LOCAL_UPSTREAM_BLOCK, encoding="utf-8")
            profile_bash_local = profile_ai / "dsh-bash-local" / "lib" / "index.js"
            profile_bash_local.parent.mkdir(parents=True)
            profile_bash_local.write_text(self.BASH_LOCAL_UPSTREAM_BLOCK, encoding="utf-8")

            namespace["apply"](devhome, replace_once)

            attachment_text = attachment.read_text(encoding="utf-8")
            self.assertIn("copyFile", attachment_text)
            self.assertNotIn("await link(", attachment_text)
            self.assertIn("async function normalizeImage(data, detected)", attachment_text)
            self.assertIn("async function createRequestImage(attachment)", attachment_text)
            self.assertIn("error.code === \"EINVAL\"", attachment_text)

            session_text = session_store.read_text(encoding="utf-8")
            self.assertIn("constants", session_text)
            self.assertIn("internals.fs.copyFile", session_text)
            self.assertNotIn("await link(", session_text)
            self.assertNotIn("\tlink,", session_text)

            subprocess_text = subprocess.read_text(encoding="utf-8")
            self.assertIn("DSH_ANDROID", subprocess_text)
            self.assertIn('return "fallback"', subprocess_text)

            for path in (hmr, profile_hmr):
                text = path.read_text(encoding="utf-8")
                self.assertIn(
                    'const timer = process.env.DSH_ANDROID === "1"'
                    " ? void 0 : setInterval(pollWatches, pollIntervalMs);",
                    text,
                )
                self.assertIn("timer?.unref?.();", text)
                self.assertNotIn(self.HMR_UPSTREAM_BLOCK, text)
            for path in (skill, profile_skill):
                text = path.read_text(encoding="utf-8")
                self.assertIn(
                    'if (this.config.enabled && process.env.DSH_ANDROID !== "1")'
                    " await this.ensureWatcher(state);",
                    text,
                )
                self.assertNotIn(self.SKILL_FS_UPSTREAM_BLOCK, text)
            for path in (bash_local, profile_bash_local):
                text = path.read_text(encoding="utf-8")
                self.assertIn("get sandboxMode()", text)
                self.assertIn("set sandboxMode(value)", text)
                self.assertIn('_sandboxMode = "danger-full-access";', text)

            # 整体幂等（批次15c 口径）：已打补丁的 devhome 重跑 apply 为 no-op，
            # 覆盖批次22 怠速补丁；任一补丁失去幂等性会在此抛错。
            namespace["apply"](devhome, replace_once)

    def test_android_idle_power_optional_profile_tree_and_drift(self) -> None:
        profile = (
            Path(__file__).resolve().parents[1]
            / "compatibility"
            / "0.1.5-rc.1"
        )
        namespace = {}
        exec((profile / "apply.py").read_text(encoding="utf-8"), namespace)

        with tempfile.TemporaryDirectory() as temp:
            # profile 树缺失（payload 不携带 profiles/node_modules，全新 prepare
            # 的合法形态）→ 跳过不报错；dshroot 树正常打补丁。
            devhome = Path(temp)
            ai = devhome / "dshroot" / "lib" / "node_modules" / "@deepseek-ai"
            hmr = ai / "dsh-client-hmr" / "lib" / "index.js"
            hmr.parent.mkdir(parents=True)
            hmr.write_text(self.HMR_UPSTREAM_BLOCK, encoding="utf-8")
            skill = ai / "dsh-skill-filesystem" / "lib" / "index.js"
            skill.parent.mkdir(parents=True)
            skill.write_text(self.SKILL_FS_UPSTREAM_BLOCK, encoding="utf-8")

            namespace["apply_android_idle_power"](devhome, replace_once)
            self.assertIn("timer?.unref?.();", hmr.read_text(encoding="utf-8"))
            self.assertIn(
                'process.env.DSH_ANDROID !== "1") await this.ensureWatcher(state);',
                skill.read_text(encoding="utf-8"),
            )

            # 已打补丁重跑 → no-op（幂等）
            before = hmr.read_text(encoding="utf-8")
            namespace["apply_android_idle_power"](devhome, replace_once)
            self.assertEqual(before, hmr.read_text(encoding="utf-8"))

        with tempfile.TemporaryDirectory() as temp:
            # dshroot 树文件存在但新旧片段皆无 → 上游漂移，如实抛错。
            devhome = Path(temp)
            ai = devhome / "dshroot" / "lib" / "node_modules" / "@deepseek-ai"
            hmr = ai / "dsh-client-hmr" / "lib" / "index.js"
            hmr.parent.mkdir(parents=True)
            hmr.write_text(
                self.HMR_UPSTREAM_BLOCK.replace(
                    "timer.unref();", "timer?.unref?.();"
                ),
                encoding="utf-8",
            )
            skill = ai / "dsh-skill-filesystem" / "lib" / "index.js"
            skill.parent.mkdir(parents=True)
            skill.write_text("upstream drifted beyond recognition\n", encoding="utf-8")
            with self.assertRaises(UpdaterError):
                namespace["apply_android_idle_power"](devhome, replace_once)

    def test_bash_local_sandbox_mode_optional_profile_tree_and_drift(self) -> None:
        profile = (
            Path(__file__).resolve().parents[1]
            / "compatibility"
            / "0.1.5-rc.1"
        )
        namespace = {}
        exec((profile / "apply.py").read_text(encoding="utf-8"), namespace)

        with tempfile.TemporaryDirectory() as temp:
            # profile 树缺失时跳过不报错；dshroot 树正常打补丁。
            devhome = Path(temp)
            ai = devhome / "dshroot" / "lib" / "node_modules" / "@deepseek-ai"
            bash_local = ai / "dsh-bash-local" / "lib" / "index.js"
            bash_local.parent.mkdir(parents=True)
            bash_local.write_text(self.BASH_LOCAL_UPSTREAM_BLOCK, encoding="utf-8")

            namespace["apply_bash_local_sandbox_mode"](devhome, replace_once)
            self.assertIn("get sandboxMode()", bash_local.read_text(encoding="utf-8"))

            # 已打补丁重跑 → no-op（幂等）
            before = bash_local.read_text(encoding="utf-8")
            namespace["apply_bash_local_sandbox_mode"](devhome, replace_once)
            self.assertEqual(before, bash_local.read_text(encoding="utf-8"))

        with tempfile.TemporaryDirectory() as temp:
            # dshroot 树文件存在但新旧片段皆无 → 上游漂移，如实抛错。
            devhome = Path(temp)
            ai = devhome / "dshroot" / "lib" / "node_modules" / "@deepseek-ai"
            bash_local = ai / "dsh-bash-local" / "lib" / "index.js"
            bash_local.parent.mkdir(parents=True)
            bash_local.write_text("class LocalBashExecutor {}\n", encoding="utf-8")
            with self.assertRaises(UpdaterError):
                namespace["apply_bash_local_sandbox_mode"](devhome, replace_once)

    def test_manifest_declares_version(self) -> None:
        profile = (
            Path(__file__).resolve().parents[1]
            / "compatibility"
            / "0.1.5-rc.1"
            / "manifest.json"
        )
        data = json.loads(profile.read_text(encoding="utf-8"))
        self.assertEqual(data["dsh_version"], "0.1.5-rc.1")
        self.assertGreaterEqual(len(data["android_replacements"]), 5)


if __name__ == "__main__":
    unittest.main()
