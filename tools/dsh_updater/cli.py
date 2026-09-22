from __future__ import annotations

import argparse
from pathlib import Path

from .build import build_apk
from .common import PROJECT_ROOT, UpdaterError, ensure_python_version, load_lock
from .environment import doctor
from .signing import create_signing_key
from .verify import verify
from .workspace import prepare, refresh


def _path(value: str) -> Path:
    return Path(value).expanduser().resolve()


def parser() -> argparse.ArgumentParser:
    lock = load_lock()  # noqa: F841 —— 校验性赋值：lock 失配/损坏在此处即抛错；后续清账时移除
    root = argparse.ArgumentParser(
        prog="dsh-android-updater",
        description="Prepare, verify and build the DeepSeek Harness Android APK.",
    )
    subparsers = root.add_subparsers(dest="command", required=True)

    subparsers.add_parser("doctor", help="check local build prerequisites")

    signing = subparsers.add_parser("init-signing", help="create a local APK signing key")
    signing.add_argument("--alias", default="dsh")
    signing.add_argument("--force", action="store_true")

    prepare_parser = subparsers.add_parser(
        "prepare",
        help="extract the base APK payload and install the pinned DSH runtime",
    )
    prepare_parser.add_argument(
        "--base-apk",
        type=_path,
        default=PROJECT_ROOT / "input" / "DeepSeekHarness-official-v1.7.5.apk",
    )
    prepare_parser.add_argument(
        "--workspace",
        type=_path,
        default=PROJECT_ROOT / "build" / "updater",
    )
    prepare_parser.add_argument("--force", action="store_true")

    verify_parser = subparsers.add_parser("verify", help="verify the prepared runtime")
    verify_parser.add_argument(
        "--workspace",
        type=_path,
        default=PROJECT_ROOT / "build" / "updater",
    )

    refresh_parser = subparsers.add_parser(
        "refresh",
        help="reinstall the pinned DSH runtime in an existing workspace",
    )
    refresh_parser.add_argument(
        "--workspace",
        type=_path,
        default=PROJECT_ROOT / "build" / "updater",
    )

    build_parser = subparsers.add_parser("build", help="build and sign the Android APK")
    build_parser.add_argument(
        "--workspace",
        type=_path,
        default=PROJECT_ROOT / "build" / "updater",
    )

    all_parser = subparsers.add_parser(
        "all",
        help="prepare, verify, create a signing key if needed, and build",
    )
    all_parser.add_argument(
        "--base-apk",
        type=_path,
        default=PROJECT_ROOT / "input" / "DeepSeekHarness-official-v1.7.5.apk",
    )
    all_parser.add_argument(
        "--workspace",
        type=_path,
        default=PROJECT_ROOT / "build" / "updater",
    )
    all_parser.add_argument("--force", action="store_true")
    all_parser.add_argument("--alias", default="dsh")
    return root


def main(argv: list[str] | None = None) -> int:
    try:
        ensure_python_version()
        args = parser().parse_args(argv)
        lock = load_lock()

        if args.command == "doctor":
            return 0 if doctor(lock["dsh"]["minimum_node_major"]) else 1
        if args.command == "init-signing":
            key = create_signing_key(PROJECT_ROOT, alias=args.alias, force=args.force)
            print(f"Signing key: {key}")
            return 0
        if args.command == "prepare":
            devhome = prepare(args.workspace, args.base_apk, force=args.force)
            print(f"Prepared DSH runtime: {devhome}")
            return 0
        if args.command == "verify":
            verify(args.workspace)
            print("Runtime verification passed")
            return 0
        if args.command == "refresh":
            devhome = refresh(args.workspace)
            print(f"Refreshed DSH runtime: {devhome}")
            return 0
        if args.command == "build":
            verify(args.workspace)
            build_apk(PROJECT_ROOT, args.workspace)
            return 0
        if args.command == "all":
            if not (PROJECT_ROOT / "android-app" / "release.jks").is_file():
                create_signing_key(PROJECT_ROOT, alias=args.alias)
            prepare(args.workspace, args.base_apk, force=args.force)
            verify(args.workspace)
            build_apk(PROJECT_ROOT, args.workspace)
            return 0
        raise UpdaterError(f"unknown command: {args.command}")
    except UpdaterError as exc:
        print(f"ERROR: {exc}")
        return 1
