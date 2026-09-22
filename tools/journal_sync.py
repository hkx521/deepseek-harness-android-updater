# -*- coding: utf-8 -*-
"""journal_sync —— 把 Codex 会话事实落到 docs/journal 与 CHANGES 校验。

用法：
    python tools/journal_sync.py            # 生成/追加当日 journal 草稿
    python tools/journal_sync.py --commit   # 生成后 git add/commit
    python tools/journal_sync.py --check    # 漂移校验：源码改了但未记录 → 退出码 1
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import io
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOURNAL_DIR = os.path.join(REPO, "docs", "journal")
SESS_ROOT = os.path.join(os.path.expanduser("~"), ".codex", "sessions")
WATCH_PREFIXES = ("android-app/src", "android-app/res", "tools/", "tests/")
ROLE_TAG = chr(34) + "role" + chr(34) + ":" + chr(34) + "user" + chr(34)


def run_git(*args: str) -> str:
    try:
        out = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True,
                             encoding="utf-8", errors="replace")
        return out.stdout or ""
    except Exception:
        return ""


def latest_rollout(day: dt.date) -> str | None:
    pat = os.path.join(SESS_ROOT, "%04d" % day.year, "%02d" % day.month, "%02d" % day.day, "*.jsonl")
    files = sorted(glob.glob(pat))
    return files[-1] if files else None


def harvest(path: str) -> dict:
    info = {"session": "", "model": "", "provider": "", "cwd": "", "tokens": {},
            "turn_tokens": {}, "requests": [], "files": []}
    if not path or not os.path.exists(path):
        return info
    seen_files = []
    with io.open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if "session_meta" in line and not info["session"]:
                try:
                    payload = json.loads(line)["payload"]
                except Exception:
                    continue
                info["session"] = payload.get("session_id", "")
                info["cwd"] = payload.get("cwd", "")
                info["provider"] = payload.get("model_provider", "")
                prov = (payload.get("base_instructions") or {}).get("provenance") or {}
                info["model"] = prov.get("model", "")
            elif "token_usage_record" in line:
                try:
                    payload = json.loads(line)["payload"]
                except Exception:
                    continue
                info["tokens"] = payload.get("thread_token_usage") or {}
                info["turn_tokens"] = payload.get("turn_token_usage") or {}
            elif "*** Update File: " in line or "*** Add File: " in line:
                for marker in ("*** Update File: ", "*** Add File: ", "*** Delete File: "):
                    at = 0
                    while True:
                        at = line.find(marker, at)
                        if at < 0:
                            break
                        rest = line[at + len(marker):]
                        stop = len(rest)
                        for i in range(len(rest)):
                            ch = rest[i]
                            if not (ch.isalnum() or ch in "_./-" or ch == chr(92)):
                                stop = i
                                break
                        p = rest[:stop].strip()
                        at += len(marker)
                        if p and p not in seen_files and len(p) < 120:
                            seen_files.append(p)
            elif ROLE_TAG in line.replace(" ", ""):
                try:
                    content = json.loads(line)["payload"].get("content") or []
                except Exception:
                    continue
                for block in content:
                    txt = block.get("text") if isinstance(block, dict) else None
                    if txt:
                        info["requests"].append(txt.strip().splitlines()[0][:120])
    info["files"] = seen_files[-12:]
    info["requests"] = info["requests"][-3:]
    return info


def git_changed() -> list[str]:
    out = run_git("status", "--short")
    return [l[3:].strip() for l in out.splitlines() if l.strip()]


def disk_changes() -> list[str]:
    """真实落盘改动（过滤截图/安装包等噪音，供 journal 的「产出」字段使用）。"""
    keep = []
    for l in run_git("status", "--short").splitlines():
        if len(l) < 4:
            continue
        p = l[3:].strip().strip(chr(34))
        if len(p) < 3 or p.endswith((".png", ".jpg", ".apk", ".idsig", ".log")):
            continue
        if p not in keep:
            keep.append(p)
    return keep[:14]


def render_entry(info: dict, changed: list[str]) -> str:
    now = dt.datetime.now().strftime("%H:%M")
    turn = info.get("turn_tokens") or {}
    total = info.get("tokens") or {}
    tok = "in/out/reason/total=%s/%s/%s/%s；会话累计 total=%s" % (
        turn.get("input_tokens", "?"), turn.get("output_tokens", "?"),
        turn.get("reasoning_output_tokens", "?"), turn.get("total_tokens", "?"),
        total.get("total_tokens", "?"))
    files = sorted(set(changed))
    lines = [
        "## %s · 轮次记录（自动生成草稿）" % now,
        "",
        "- **类型**：<答疑/计划/实现/修复/发布>",
        "- **模型与额度**：model=%s provider=%s；本轮 tokens=%s；额度降级=<无/有+说明>" % (
            info.get("model") or "?", info.get("provider") or "?", tok),
        "- **会话**：%s" % (info.get("session") or "?"),
        "- **用户请求（末三条）**：" + ("；".join(info.get("requests") or ["-"])),
        "- **产出（盘上路径）**：" + ("、".join(files) if files else "-"),
        "- **决策**：<一句话结论 + 依据>",
        "- **验证**：<命令 + 结果数字>",
        "- **遗留 / 下一步**：<指向 docs/PLAN-INDEX.md 条目>",
        "",
    ]
    return chr(10).join(lines)


def write_journal(info: dict, changed: list[str]) -> str:
    os.makedirs(JOURNAL_DIR, exist_ok=True)
    path = os.path.join(JOURNAL_DIR, dt.date.today().isoformat() + ".md")
    header = "# %s 逐轮记录%s%s" % (dt.date.today().isoformat(), chr(10), chr(10))
    exists = os.path.exists(path)
    with io.open(path, "a", encoding="utf-8", newline=chr(10)) as fh:
        if not exists:
            fh.write(header)
        fh.write(render_entry(info, changed))
    return path


def check() -> int:
    changed = git_changed()
    src = [c for c in changed if c.startswith(WATCH_PREFIXES)]
    if not src:
        print("[journal-check] 无源码改动，跳过")
        return 0
    journal_rel = "docs/journal/" + dt.date.today().isoformat() + ".md"
    changes_touched = any(c == "CHANGES.md" for c in changed)
    if changes_touched or (journal_rel in changed):
        print("[journal-check] OK（源码改动 %d 处，已有当日 journal 或 CHANGES 更新）" % len(src))
        return 0
    print("[journal-check] FAIL：以下源码改动未记录")
    for c in src:
        print("  -", c)
    print("请执行 python tools/journal_sync.py 并更新 CHANGES.md")
    return 1


STATE_PATH = os.path.join(REPO, "docs", "STATE.md")
AUTO_BEGIN = "<!-- AUTO:STATE:BEGIN -->"
AUTO_END = "<!-- AUTO:STATE:END -->"


def refresh_state() -> str:
    """刷新 docs/STATE.md：日期 + AUTO 区块（最近提交 / 工作区改动 / 待办计划）。"""
    if not os.path.exists(STATE_PATH):
        return ""
    with io.open(STATE_PATH, encoding="utf-8") as fh:
        text = fh.read()
    today = dt.date.today().isoformat()
    out_lines = []
    for line in text.split(chr(10)):
        if line.startswith("> 最后更新："):
            out_lines.append("> 最后更新：" + today)
        else:
            out_lines.append(line)
    text = chr(10).join(out_lines)
    commits = run_git("log", "-n", "5", "--pretty=format:%h %ad %s", "--date=short").splitlines()
    changed = disk_changes()
    pending = []
    plan_path = os.path.join(REPO, "docs", "PLAN-INDEX.md")
    if os.path.exists(plan_path):
        with io.open(plan_path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("|") and ("待办" in line or "进行中" in line):
                    pending.append(line.strip())
    block = [AUTO_BEGIN,
             "### 自动区块（由 tools/journal_sync.py --state 生成，勿手改）",
             "",
             "- 最近提交：" + ("；".join(commits) if commits else "-"),
             "- 当前工作区改动：" + ("、".join(changed) if changed else "无"),
             "- 待办 / 进行中计划："]
    for item in pending:
        block.append("  - " + item)
    block.append(AUTO_END)
    new_block = chr(10).join(block)
    begin = text.find(AUTO_BEGIN)
    end = text.find(AUTO_END)
    if begin >= 0 and end > begin:
        text = text[:begin] + new_block + text[end + len(AUTO_END):]
    else:
        text = text.rstrip() + chr(10) + chr(10) + new_block + chr(10)
    with io.open(STATE_PATH, "w", encoding="utf-8", newline=chr(10)) as fh:
        fh.write(text)
    return STATE_PATH


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--state", action="store_true")
    args = ap.parse_args()
    if args.state:
        sp = refresh_state()
        print("[state] ok:", sp)
        return 0
    if args.check:
        return check()
    info = harvest(latest_rollout(dt.date.today()))
    changed = disk_changes()
    path = write_journal(info, changed)
    refresh_state()
    print("[journal] 已写入", os.path.relpath(path, REPO))
    if args.commit:
        run_git("add", os.path.relpath(path, REPO))
        run_git("commit", "-q", "-m", "docs: journal %s" % dt.date.today().isoformat())
        print("[journal] 已提交")
    return 0


if __name__ == "__main__":
    sys.exit(main())
