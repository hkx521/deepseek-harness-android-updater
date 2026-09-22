from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from .common import PROJECT_ROOT, command_path, print_status


def android_sdk_root() -> Path | None:
    for variable in ("ANDROID_SDK_ROOT", "ANDROID_HOME"):
        value = os.environ.get(variable)
        if value and Path(value).is_dir():
            return Path(value)
    candidate = Path.home() / "AppData" / "Local" / "Android" / "Sdk"
    return candidate if candidate.is_dir() else None


def newest_build_tools(sdk: Path) -> Path | None:
    root = sdk / "build-tools"
    if not root.is_dir():
        return None
    versions = sorted(
        (entry for entry in root.iterdir() if entry.is_dir()),
        key=lambda entry: tuple(int(part) for part in entry.name.split(".") if part.isdigit()),
        reverse=True,
    )
    for version in versions:
        if (version / "aapt.exe").is_file() or (version / "aapt").is_file():
            return version
    return None


def newest_android_jar(sdk: Path) -> Path | None:
    root = sdk / "platforms"
    if not root.is_dir():
        return None
    versions = sorted(
        (entry for entry in root.iterdir() if entry.is_dir()),
        key=lambda entry: tuple(int(part) for part in entry.name.replace("android-", "").split(".") if part.isdigit()),
        reverse=True,
    )
    for version in versions:
        jar = version / "android.jar"
        if jar.is_file():
            return jar
    return None


def java_bin() -> Path | None:
    candidates: list[Path] = []
    if os.environ.get("JAVA_BIN"):
        candidates.append(Path(os.environ["JAVA_BIN"]))
    java = command_path("javac")
    if java is not None:
        candidates.append(java.parent)
    for candidate in candidates:
        executable = candidate / ("javac.exe" if os.name == "nt" else "javac")
        if executable.is_file():
            return candidate
    return None


def git_bash() -> Path | None:
    if os.name != "nt":
        return command_path("bash")
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "bin" / "bash.exe",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Git" / "bin" / "bash.exe",
        command_path("bash"),
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    return None


def to_bash_path(path: Path) -> str:
    resolved = path.resolve()
    if os.name != "nt":
        return resolved.as_posix()
    drive = resolved.drive.rstrip(":").lower()
    tail = resolved.as_posix().split(":", 1)[1]
    return f"/{drive}{tail}"


def node_major() -> int | None:
    node = command_path("node")
    if node is None:
        return None
    result = subprocess.run(
        [str(node), "--version"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    version = result.stdout.strip().lstrip("v")
    try:
        return int(version.split(".", 1)[0])
    except ValueError:
        return None


def doctor(required_node_major: int = 22) -> bool:
    checks: list[tuple[str, bool, str]] = []
    checks.append(("Python 3.10+", True, "runtime"))
    node = command_path("node")
    major = node_major()
    checks.append(("Node.js", node is not None and major is not None and major >= required_node_major, str(node or "")))
    npm = command_path("npm")
    checks.append(("npm", npm is not None, str(npm or "")))
    git = command_path("git")
    checks.append(("Git", git is not None, str(git or "")))
    bash = git_bash()
    checks.append(("Git Bash", bash is not None, str(bash or "")))
    java = java_bin()
    checks.append(("JDK", java is not None, str(java or "")))
    sdk = android_sdk_root()
    build_tools = newest_build_tools(sdk) if sdk else None
    checks.append(("Android SDK", sdk is not None, str(sdk or "")))
    checks.append(("Android build-tools", build_tools is not None, str(build_tools or "")))
    android_jar = newest_android_jar(sdk) if sdk else None
    checks.append(("android.jar", android_jar is not None, str(android_jar or "")))
    checks.append(("Project root", PROJECT_ROOT.is_dir(), str(PROJECT_ROOT)))

    all_ok = True
    for label, ok, detail in checks:
        print_status(ok, label, detail)
        all_ok = all_ok and ok
    return all_ok


def require_environment(required_node_major: int) -> dict[str, Path]:
    result: dict[str, Path] = {}
    missing: list[str] = []

    def find(label: str, resolver) -> None:
        value = resolver()
        if value is None:
            missing.append(label)
        else:
            result[label] = value

    find("node", lambda: command_path("node"))
    find("npm", lambda: command_path("npm"))
    find("git", lambda: command_path("git"))
    find("bash", git_bash)
    find("java_bin", java_bin)
    find("sdk", android_sdk_root)
    if "sdk" in result:
        result["build_tools"] = newest_build_tools(result["sdk"])  # type: ignore[assignment]
        result["android_jar"] = newest_android_jar(result["sdk"])  # type: ignore[assignment]
        if result["build_tools"] is None:
            missing.append("build-tools")
        if result["android_jar"] is None:
            missing.append("android.jar")

    major = node_major()
    if major is None or major < required_node_major:
        missing.append(f"Node.js >= {required_node_major}")
    if missing:
        raise RuntimeError("missing build prerequisites: " + ", ".join(missing))
    return result


def reset_path_for_tests(*, path: str | None = None) -> None:
    if path is not None:
        os.environ["PATH"] = path
        shutil.which.cache_clear()
