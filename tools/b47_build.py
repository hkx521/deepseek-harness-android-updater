"""批次47 全量构建：aapt 资源 + javac + d8 + repack + zipalign + 签名。

2026-09-18 重建：原脚本因一次过宽的本地清理 glob 被误删（git 忽略，无法恢复），
依据 .local/_b47_run.txt 与 .local/b46_evidence/build_final.log 中留存的完整命令行
逐段重建。六个阶段与批次60/73 的契约测试兼容（run() 风格、预检挂载点）。

d8 说明：432+35 个 .class 直接拼命令行会超 Windows 32K 限制（WinError 206），
因此把类清单写入 rsp 文件用 @file 传给 d8（d8 支持与 javac 相同的 @argfile 语法）。

用法：
    python .local/b47_build.py all          # 全部阶段
    python .local/b47_build.py r,j,d        # 指定阶段

批次81：两份脚本（`tools/b47_build.py` 与 `.local/b47_build.py`）内容必须一致，
`tests/test_batch81_build_sync_hook.py` 会校验字节相等；
pack 阶段会先自动同步 `plugins/**` 到 base APK 的 payload（`B47_PLUGIN_STRICT=1` 时改为报错退出）。
"""
import glob
import os
import subprocess
import sys
import zipfile
from pathlib import Path

# 该文件是 .local/b47_build.py 的「版本化权威副本」。
# .local/ 被 gitignore，历史上脚本被一次过宽的清理 glob 误删后无法恢复；
# 现在把权威副本入库，.local/b47_build.py 若丢失可直接复制回来：
#     copy tools\b47_build.py .local\b47_build.py
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUILD_TOOLS = "36.1.0"      # 本机验证过的版本；其他环境用 ANDROID_BUILD_TOOLS 覆盖


def _sdk_dir():
    """Android SDK 目录：ANDROID_HOME / ANDROID_SDK_ROOT -> %LOCALAPPDATA%/Android/Sdk。"""
    for key in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(key):
            return Path(os.environ[key])
    return Path(os.environ.get("LOCALAPPDATA", "")) / "Android" / "Sdk"


def _pick_build_tools():
    """build-tools 目录：ANDROID_BUILD_TOOLS 优先，否则 SDK/build-tools/<DEFAULT>。"""
    env = os.environ.get("ANDROID_BUILD_TOOLS")
    if env:
        p = Path(env)
        if (p / "aapt.exe").is_file() or (p / "aapt").is_file():
            return p
        raise SystemExit("[b47] ANDROID_BUILD_TOOLS 目录里找不到 aapt：" + env)
    p = _sdk_dir() / "build-tools" / DEFAULT_BUILD_TOOLS
    if p.is_dir():
        return p
    sdk_bt = _sdk_dir() / "build-tools"
    avail = sorted(d.name for d in sdk_bt.glob("*") if d.is_dir()) if sdk_bt.is_dir() else []
    raise SystemExit(
        "[b47] 找不到 Android build-tools/%s（SDK=%s）。已安装：%s\n"
        "      请设置 ANDROID_BUILD_TOOLS=<sdk>/build-tools/<版本>，"
        "或把本文件的 DEFAULT_BUILD_TOOLS 改成已安装的版本。"
        % (DEFAULT_BUILD_TOOLS, _sdk_dir(), ", ".join(avail) or "（无）"))


def _pick_javac():
    """javac 路径：JAVAC 环境变量 -> 本机已验证的 Corretto -> JAVA_HOME -> PATH。"""
    env = os.environ.get("JAVAC")
    if env and Path(env).is_file():
        return Path(env)
    pinned = Path(r"C:\Program Files\Amazon Corretto\jdk21.0.11_10\bin\javac.exe")
    if pinned.is_file():
        return pinned
    if os.environ.get("JAVA_HOME"):
        for name in ("javac.exe", "javac"):
            cand = Path(os.environ["JAVA_HOME"]) / "bin" / name
            if cand.is_file():
                return cand
    import shutil
    found = shutil.which("javac")
    if found:
        return Path(found)
    raise SystemExit("[b47] 找不到 javac：请安装 JDK 21+ 并设置 JAVA_HOME，"
                     "或用 JAVAC=<javac 路径> 指定。")


BT = _pick_build_tools()
JAVAC = _pick_javac()
APP = ROOT / "android-app"
SDK_JAR = APP / "sdk" / "android.jar"
GEN = APP / "out" / "gen"
CLS = APP / "out" / "classes"
DEX = APP / "out" / "dex"
WORK = ROOT / ".local" / "b47_work"
OUT = ROOT / ".local" / "b47_out"
BASE_APK = APP / "DeepSeekHarness.apk"
VS_JAR = APP / "assets" / "vscreen" / "vscreen-server.jar"
KS = APP / "release.jks"
KS_ALIAS = "dsh"


def _load_keystore_pass():
    """签名口令：环境变量 KEYSTORE_PASS 优先，其次 .local/signing.env（由 dsh_updater init-signing 生成）。

    批次97：口令曾经以明文写在源码里（见 docs/批次96 审计），开源前已移除；
    本机自用请设置环境变量或保留 .local/signing.env。
    """
    pw = os.environ.get("KEYSTORE_PASS")
    if not pw:
        env_file = ROOT / ".local" / "signing.env"
        if env_file.is_file():
            for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
                if line.strip().startswith("KEYSTORE_PASS="):
                    pw = line.split("=", 1)[1].strip()
                    break
    if not pw:
        raise SystemExit(
            "缺少签名口令 KEYSTORE_PASS：请设置环境变量，或运行 "
            "python -m tools.dsh_updater init-signing 生成 .local/signing.env"
        )
    return pw


_KS_PASS_CACHE = None


def keystore_pass():
    """签名口令按需读取：非 sign 阶段（r/j/d/res/pack）无口令也能跑（批次97 续）。"""
    global _KS_PASS_CACHE
    if _KS_PASS_CACHE is None:
        _KS_PASS_CACHE = _load_keystore_pass()
    return _KS_PASS_CACHE


def _safe_args(args):
    """打印用参数：不回显签名口令（apksigner 的 pass:...）。"""
    return ["pass:***" if str(a).startswith("pass:") else a for a in args]


def run(cmd):
    shown = " ".join(str(c) for c in _safe_args(cmd))
    print(">>", shown[:400] + (" ..." if len(shown) > 400 else ""), flush=True)
    p = subprocess.run([str(c) for c in cmd], capture_output=True, text=True,
                       errors="replace")
    if p.stdout.strip():
        print(p.stdout.strip())
    if p.stderr.strip():
        print("STDERR:", p.stderr.strip())
    if p.returncode != 0:
        print("!! FAILED rc=", p.returncode)
        sys.exit(p.returncode)
    return p


def shizuku_classpath():
    jars = []
    for name in ("shizuku-api", "shizuku-provider", "shizuku-aidl"):
        jar = APP / "out" / name / "classes.jar"
        if jar.exists():
            jars.append(str(jar))
    return ";".join(jars)


def stage_r_gen():
    # 与 android-app/build.sh 一致：out/{gen,classes,dex} 必须从干净状态开始。
    # 否则 javac/d8 的增量产物会残留"已删除源文件的旧 class"混进 dex
    # （原 b47 脚本漏了这一步，实测累积出约 115 个陈旧 class，dex 虚胖 ~50KB）。
    import shutil
    for sub in (GEN, CLS, DEX):
        if sub.exists():
            shutil.rmtree(sub)
    for sub in (GEN, CLS, DEX):
        sub.mkdir(parents=True, exist_ok=True)
    run([BT / "aapt.exe", "package", "-f", "-m",
         "-J", GEN,
         "-M", APP / "AndroidManifest.xml",
         "-S", APP / "res",
         "-I", SDK_JAR])
    r_java = GEN / "com" / "deepseek" / "harness" / "R.java"
    text = r_java.read_text(encoding="utf-8", errors="replace")
    for res in ("ic_fish_blue", "ic_launcher", "ic_whale_black",
                "accessibility_config", "shortcuts"):
        print(f"R.java has {res} :", res in text)

    # javac 响应文件：全部 src + 生成的 R.java。
    # 批次60 的 PromptChipItem / PromptChipManager / SelectionOverlayView 仍被
    # OverlayService 引用（契约测试亦要求构建脚本登记它们），必须参与编译。
    # 批次82-N5 的 PromptStudio（指令库管理页）被 MainActivity / OverlayService 引用，同样登记。
    # 只编 harness 包顶层源文件：src/.../vscreen/*.java 是"虚拟屏特权服务端"，
    # 走独立 javac/d8 打进 assets/vscreen/vscreen-server.jar（LGPL 三文件不进 APK dex，
    # 见 android-app/build.sh 批次11 注释）。用递归 glob 会把它们混进主 dex（实测多 8 个类）。
    files = sorted(
        glob.glob(str(APP / "src" / "com" / "deepseek" / "harness" / "*.java"))
        + glob.glob(str(GEN / "**" / "*.java"), recursive=True)
    )
    rsp = APP / "out" / "classes.rsp"
    rsp.parent.mkdir(parents=True, exist_ok=True)
    rsp.write_text("\n".join(files), encoding="utf-8")
    print("classes.rsp entries:", len(files))


def stage_javac():
    CLS.mkdir(parents=True, exist_ok=True)
    run([JAVAC, "-encoding", "UTF-8", "-source", "8", "-target", "8", "-nowarn",
         "-bootclasspath", SDK_JAR,
         "-classpath", shizuku_classpath(),
         "-d", CLS,
         "@" + str(APP / "out" / "classes.rsp")])


def stage_dex():
    DEX.mkdir(parents=True, exist_ok=True)
    class_files = sorted(
        glob.glob(str(CLS / "**" / "*.class"), recursive=True)
    )
    shizuku_dir = APP / "out" / "shizuku-cls"
    if shizuku_dir.exists():
        class_files += sorted(glob.glob(str(shizuku_dir / "**" / "*.class"),
                                        recursive=True))
    print("dex input classes:", len(class_files))
    # 命令行超长（>32K）时 Windows CreateProcess 直接失败；用 @argfile 传给 d8
    dex_rsp = APP / "out" / "dex.rsp"
    # d8 的 argfile 解析不支持引号路径（R8 InvalidPathException: Illegal char <">）——直接写裸路径
    dex_rsp.write_text("\n".join(class_files), encoding="utf-8")
    run([BT / "d8.bat", "--release", "--lib", SDK_JAR, "--min-api", "24",
         "--output", DEX, "@" + str(dex_rsp)])
    out_dex = DEX / "classes.dex"
    print("classes.dex:", out_dex.stat().st_size, "bytes")


def stage_res_apk():
    OUT.mkdir(parents=True, exist_ok=True)
    run([BT / "aapt.exe", "package", "-f",
         "-M", APP / "AndroidManifest.xml",
         "-S", APP / "res",
         "-I", SDK_JAR,
         "-F", OUT / "resources.apk"])


def sync_plugins():
    """批次81-T1：pack 前置把 `plugins/**` 同步进 base APK 的 `assets/payload.zip`。

    本地增量构建只替换 classes.dex / resources.arsc / AndroidManifest / res/*，
    **不重建 assets/**；而设备侧真正运行的插件来自 payload.zip。批次80 真机复现过
    「改了插件、只跑增量构建 → 改动从未上机」（批次74/75 的 dsh-tool-accessibility）。
    因此这一步必须在 pack 之前跑，幂等：一致直接返回，不一致自动同步。
    设 B47_PLUGIN_STRICT=1 时不自动修，直接失败（交付前检查用）。
    """
    tool = ROOT / "tools" / "sync_base_apk_plugins.py"
    probe = subprocess.run([sys.executable, str(tool), "--check"],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace")
    if probe.returncode == 0:
        print("[build] payload 插件与 plugins/ 一致（跳过同步）")
        return
    if probe.returncode == 2:
        print("[build] base APK 不存在，跳过插件同步（后续 pack 阶段会失败）")
        return
    if os.environ.get("B47_PLUGIN_STRICT") == "1":
        print((probe.stdout or "").strip())
        raise SystemExit("[build] plugins/ 与 payload 不一致且 B47_PLUGIN_STRICT=1："
                         "先跑 python tools/sync_base_apk_plugins.py")
    print("[build] payload 与 plugins/ 不一致 -> 自动同步")
    print((probe.stdout or "").strip())
    run([sys.executable, str(tool)])
    print("[build] payload 插件已同步")


def stage_repack():
    # 批次81-T1 预检：插件交付链（plugins/** -> base APK assets/payload.zip）。
    # 增量构建不重建 assets/**，漏了这步「改了插件却没进 APK」会静默发生。
    sync_plugins()

    # 批次73 预检：base APK 的 assets/payload.zip 会被构建流程重新生成，
    # 其内 dsh-attachment-local 的 fsync(EINVAL/erofs 只读根) 容忍补丁必须在
    # 每次打包前重新固化，否则设备上"看图"链路（read_image / android_see /
    # android_vscreen_see）会整体回归 EINVAL 故障。幂等。
    run([sys.executable, str(ROOT / "tools" / "patch_base_apk_attachment.py")])

    out = WORK / "unsigned.apk"
    out.parent.mkdir(parents=True, exist_ok=True)
    new_dex = (DEX / "classes.dex").read_bytes()
    with zipfile.ZipFile(OUT / "resources.apk") as nz:
        names = nz.namelist()
        new_manifest = nz.read("AndroidManifest.xml")
        new_arsc = nz.read("resources.arsc")
        new_res = {n: nz.read(n) for n in names if n.startswith("res/") and not n.endswith("/")}
    print("new res entries:", len(new_res))
    with zipfile.ZipFile(BASE_APK) as zin, zipfile.ZipFile(out, "w") as zout:
        zout.writestr("AndroidManifest.xml", new_manifest, compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr("classes.dex", new_dex, compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr("resources.arsc", new_arsc, compress_type=zipfile.ZIP_STORED)
        written = set()
        for name, data in new_res.items():
            zout.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
            written.add(name)
        for info in zin.infolist():
            if info.is_dir() or info.filename in ("AndroidManifest.xml", "classes.dex", "resources.arsc"):
                continue
            if info.filename in written:
                continue
            if info.filename == "assets/vscreen/vscreen-server.jar" and VS_JAR.exists():
                data = VS_JAR.read_bytes()
                print("override assets/vscreen/vscreen-server.jar ->", len(data), "bytes")
            else:
                data = zin.read(info.filename)
            ni = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            ni.compress_type = info.compress_type
            ni.external_attr = info.external_attr
            zout.writestr(ni, data)
    print("unsigned size:", out.stat().st_size)


def stage_sign():
    aligned = OUT / "aligned.apk"
    run([BT / "zipalign.exe", "-f", "4", WORK / "unsigned.apk", aligned])
    signed = OUT / "DeepSeekHarness-b47.apk"
    run([BT / "apksigner.bat", "sign",
         "--ks", KS, "--ks-pass", "pass:" + keystore_pass(),
         "--ks-key-alias", KS_ALIAS, "--key-pass", "pass:" + keystore_pass(),
         "--out", signed, aligned])
    run([BT / "apksigner.bat", "verify", "--print-certs", signed])
    print("SIGNED OK ->", signed, signed.stat().st_size)


STAGES = {
    "r": stage_r_gen,
    "j": stage_javac,
    "d": stage_dex,
    "res": stage_res_apk,
    "pack": stage_repack,
    "sign": stage_sign,
}

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    order = ["r", "j", "d", "res", "pack", "sign"] if which == "all" else which.split(",")
    print("stages:", order, flush=True)
    for name in order:
        print(f"=== stage {name} ===", flush=True)
        STAGES[name]()
    print("ALL DONE")
