#!/system/bin/sh
# vscreen 特权服务端 jar 构建（批次 11，LGPL 三文件 → classes.dex → vscreen-server.jar）
# 只负责服务端 jar：不编 App、不打包 APK（那是 build.sh 的事）。
# 产物：android-app/out/vscreen-server/vscreen-server.jar
#       → 协调者负责放进 android-app/assets/vscreen/vscreen-server.jar 随 APK 分发
#         （App 侧 extractPayload 解到 <filesDir>/vscreen/ 后用 app_process 拉起，见契约 §1）。
# 环境推导与 android-app/build.sh 同款：DSH_DEV_HOME / ANDROID_JAR / JAVA_BIN。
set -e
# 开发环境主目录（runtime/dshroot/.dsh 所在位置）
H="${DSH_DEV_HOME:-/data/data/com.coomi.android/files/home}"
source "$H/build/env.sh"

# 本脚本所在目录（android-app/）
P="$(cd "$(dirname "$0")" && pwd)"
# android.jar 放 android-app/sdk/（可 export ANDROID_JAR 覆盖）——与 build.sh 同款推导
AJ="${ANDROID_JAR:-$P/sdk/android.jar}"
[ -f "$AJ" ] || { echo "!! 找不到 android.jar：$AJ（请 export ANDROID_JAR=.../android.jar）"; exit 1; }
# javac 所在目录：优先 JAVA_BIN，否则从 DSH_DEV_HOME 推导（与 build.sh 同款）
JAVA="${JAVA_BIN:-$H/../usr/lib/jvm/java-17-openjdk/bin}"
[ -x "$JAVA/javac" ] || { echo "!! 找不到 javac：$JAVA/javac（请 export JAVA_BIN=.../java-17-openjdk/bin）"; exit 1; }

# classpath 分隔符：Windows(Git Bash) 用 ';'，POSIX/Android 用 ':'（与 build.sh 同款）
# Windows 上 d8 是 .bat（bash 不会自动补 .bat 后缀，显式指定）
CP_SEP=":"
D8="d8"
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*) CP_SEP=";"; D8="d8.bat" ;;
esac

OUT="$P/out/vscreen-server"
# out 子目录必须干净：javac/d8 增量会残留已删除源文件的旧 class 混进 dex（与 build.sh 同款防呆）
for sub in classes dex; do
  if [ -e "$OUT/$sub" ]; then
    mv "$OUT/$sub" "$P/../.local/scratch-bak-vscreen-$sub-$(date +%H%M%S)"
  fi
done
mkdir -p "$OUT/classes" "$OUT/dex"

# Windows(Git Bash)：MSYS 不转换"分号分隔的 POSIX 路径列表" → cygpath 转 Windows 路径（与 build.sh 同款）
CP="$AJ"
if [ "$CP_SEP" = ";" ] && command -v cygpath >/dev/null 2>&1; then
  CP="$(cygpath -w "$AJ")"
fi

echo "== 1/2 javac（classpath=android.jar，LGPL 3 文件）=="
# ⚠ 编译需 API>=31 的 android.jar：FakeContext 用到 android.content.AttributionSource（API 31）。
#   android-28 的 jar 缺该类会编译失败；历史构建用过 platform33（android-13），可直接用。
if ! "$JAVA/javac" -source 1.8 -target 1.8 -encoding UTF-8 -bootclasspath "$AJ" \
  -classpath "$CP" -d "$OUT/classes" \
  "$P/src/com/deepseek/harness/vscreen/Main.java" \
  "$P/src/com/deepseek/harness/vscreen/FakeContext.java" \
  "$P/src/com/deepseek/harness/vscreen/Workarounds.java" \
  >"$OUT/javac.log" 2>&1; then
  echo "!! javac 编译失败，日志：$OUT/javac.log"
  tail -20 "$OUT/javac.log"
  exit 1
fi
grep -v "bootstrap class path\|warning:\|Note:\|deprecat" "$OUT/javac.log" || true
NCLASS="$(find "$OUT/classes" -name '*.class' | wc -l)"
echo "  javac 完成，class 数：$NCLASS"
[ "$NCLASS" -gt 0 ] || { echo "!! javac 产物为空，中止构建"; exit 1; }

echo "== 2/2 d8 -> classes.dex -> vscreen-server.jar =="
# class 列表写入 response file（Windows 命令行 8191 字符限制，与 build.sh 同款）
CLS_RSP="$OUT/classes.rsp"
if [ "$CP_SEP" = ";" ] && command -v cygpath >/dev/null 2>&1; then
  find "$OUT/classes" -name '*.class' | cygpath -w -f - > "$CLS_RSP"
else
  find "$OUT/classes" -name '*.class' > "$CLS_RSP"
fi
"$D8" --release --lib "$AJ" --min-api 24 --output "$OUT/dex" @"$CLS_RSP" \
  || { echo "!! d8 失败"; exit 1; }
[ -f "$OUT/dex/classes.dex" ] || { echo "!! d8 未产出 classes.dex，中止"; exit 1; }

# dex 打进 jar（dex 必须在 jar 根部：app_process -Djava.class.path 按 dex 加载）
# cMf = 不带 MANIFEST（与 build.sh 打 payload.zip 同款手法）
rm -f "$OUT/vscreen-server.jar"
( cd "$OUT/dex" && "$JAVA/jar" cMf "$OUT/vscreen-server.jar" classes.dex )
echo "  产物：$OUT/vscreen-server.jar（$(stat -c%s "$OUT/vscreen-server.jar") bytes）"
echo "  下一步（协调者）：cp 到 android-app/assets/vscreen/vscreen-server.jar，随 APK 分发"
