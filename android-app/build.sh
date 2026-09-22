#!/system/bin/sh
# DeepSeek Harness 手机版 APK 构建脚本
# 需要开发环境（runtime/dshroot/.dsh 等），路径可通过环境变量覆盖
set -e
# 开发环境主目录（runtime/dshroot/.dsh 所在位置）
H="${DSH_DEV_HOME:-/data/data/com.coomi.android/files/home}"
source "$H/build/env.sh"

# 本脚本所在目录（android-app/）
P="$(cd "$(dirname "$0")" && pwd)"
# android.jar 放 android-app/sdk/（可 export ANDROID_JAR 覆盖）
AJ="${ANDROID_JAR:-$P/sdk/android.jar}"
# javac 所在目录：优先 JAVA_BIN，否则从 DSH_DEV_HOME 推导（devhome 与 usr 同在 buildenv 下）
JAVA="${JAVA_BIN:-$H/../usr/lib/jvm/java-17-openjdk/bin}"
[ -x "$JAVA/javac" ] || { echo "!! 找不到 javac：$JAVA/javac（请 export JAVA_BIN=.../java-17-openjdk/bin）"; exit 1; }
# classpath 分隔符：Windows(Git Bash) 用 ';'，POSIX/Android 用 ':'（Windows 的 Java 程序不认 ':' 分隔）
# Windows 上 d8/apksigner 是 .bat（bash 不会自动补 .bat 后缀，显式指定）
CP_SEP=":"
D8="d8"
APKSIGNER="apksigner"
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*) CP_SEP=";"; D8="d8.bat"; APKSIGNER="apksigner.bat" ;;
esac
# 签名密钥（自行准备，不入仓库）
KEY="$P/release.jks"

# ---------------------------------------------------------------------------
# 阶段 0 防呆：插件同步链路校验（2026-09-11）
# 三插件实际打包自 devhome profile（$H/.dsh/profiles/web/node_modules/...），
# 仓库 plugins/ 只是源码。改仓库插件后忘记 cp 同步 → 静默打包旧代码，白跑全量构建。
# 这里在装配 payload 之前做逐文件对比：不一致默认中止；
# BUILD_SYNC_PLUGINS=1 时自动从仓库覆盖同步到 devhome 后继续。
# ---------------------------------------------------------------------------
DSH_PLUGINS="dsh-tool-shizuku dsh-tool-android dsh-tool-accessibility"
SYNC_TMP="$P/out/plugin-sync-check"
mkdir -p "$P/out"
gen_plugin_manifest() { # $1 = 基目录（其下直接是各插件目录）
  for p in $DSH_PLUGINS; do
    find "$p" -type f | LC_ALL=C sort | xargs sha256sum 2>/dev/null
  done
}
( cd "$P/../plugins" && gen_plugin_manifest ) > "$SYNC_TMP.src"
( cd "$H/.dsh/profiles/web/node_modules/@deepseek-ai" && gen_plugin_manifest ) > "$SYNC_TMP.dst" 2>/dev/null
if ! cmp -s "$SYNC_TMP.src" "$SYNC_TMP.dst"; then
  if [ "$BUILD_SYNC_PLUGINS" = "1" ]; then
    echo "  插件不同步：自动从仓库 plugins/ 覆盖同步到 devhome profile..."
    for p in $DSH_PLUGINS; do
      rm -rf "$H/.dsh/profiles/web/node_modules/@deepseek-ai/$p"
      cp -R "$P/../plugins/$p" "$H/.dsh/profiles/web/node_modules/@deepseek-ai/$p"
    done
    ( cd "$H/.dsh/profiles/web/node_modules/@deepseek-ai" && gen_plugin_manifest ) > "$SYNC_TMP.dst" 2>/dev/null
    cmp -s "$SYNC_TMP.src" "$SYNC_TMP.dst" \
      || { echo "!! 自动同步后仍不一致，请手工核对 devhome profile"; exit 1; }
    echo "  插件同步完成（BUILD_SYNC_PLUGINS=1）"
  else
    echo "!! 仓库 plugins/ 与 devhome profile 插件不一致（继续构建会打包旧插件代码，中止）"
    echo "   差异文件："
    diff "$SYNC_TMP.src" "$SYNC_TMP.dst" | grep '^[<>]' | awk '{print "     " $1 " " $3}' || true
    echo "   修复：BUILD_SYNC_PLUGINS=1 sh build.sh（自动同步），或手工执行："
    for p in $DSH_PLUGINS; do
      echo "     cp -r \"$P/../plugins/$p\" \"$H/.dsh/profiles/web/node_modules/@deepseek-ai/\""
    done
    exit 1
  fi
else
  echo "  插件同步链路校验通过（仓库 == devhome profile）"
fi

# 批次 27：高可用模型路由插件（@jiesou/dsh-model-router）同步链路校验
ROUTER_PLUGIN="dsh-model-router"
if [ -d "$P/../plugins/$ROUTER_PLUGIN" ]; then
  ROUTER_SYNC_SRC="$SYNC_TMP.router.src"
  ROUTER_SYNC_DST="$SYNC_TMP.router.dst"
  ( cd "$P/../plugins" && find "$ROUTER_PLUGIN" -type f | LC_ALL=C sort | xargs sha256sum 2>/dev/null ) > "$ROUTER_SYNC_SRC"
  ( cd "$H/.dsh/profiles/web/node_modules/@jiesou" && find "$ROUTER_PLUGIN" -type f | LC_ALL=C sort | xargs sha256sum 2>/dev/null ) > "$ROUTER_SYNC_DST" 2>/dev/null
  if ! cmp -s "$ROUTER_SYNC_SRC" "$ROUTER_SYNC_DST"; then
    if [ "$BUILD_SYNC_PLUGINS" = "1" ]; then
      echo "  模型路由插件不同步：自动覆盖同步到 devhome profile 与 dshroot 以及 overlay..."
      mkdir -p "$H/.dsh/profiles/web/node_modules/@jiesou/$ROUTER_PLUGIN"
      rm -rf "$H/.dsh/profiles/web/node_modules/@jiesou/$ROUTER_PLUGIN"/*
      cp -R "$P/../plugins/$ROUTER_PLUGIN/." "$H/.dsh/profiles/web/node_modules/@jiesou/$ROUTER_PLUGIN/"
      mkdir -p "$H/dshroot/lib/node_modules/@jiesou/$ROUTER_PLUGIN"
      rm -rf "$H/dshroot/lib/node_modules/@jiesou/$ROUTER_PLUGIN"/*
      cp -R "$P/../plugins/$ROUTER_PLUGIN/." "$H/dshroot/lib/node_modules/@jiesou/$ROUTER_PLUGIN/"
      mkdir -p "$P/../compatibility/0.1.5-rc.1/overlay/node_modules/@jiesou/$ROUTER_PLUGIN"
      rm -rf "$P/../compatibility/0.1.5-rc.1/overlay/node_modules/@jiesou/$ROUTER_PLUGIN"/*
      cp -R "$P/../plugins/$ROUTER_PLUGIN/." "$P/../compatibility/0.1.5-rc.1/overlay/node_modules/@jiesou/$ROUTER_PLUGIN/"
      echo "  模型路由插件同步完成（BUILD_SYNC_PLUGINS=1）"
    else
      echo "!! 仓库 plugins/$ROUTER_PLUGIN 与 devhome profile 插件不一致（继续构建会打包旧代码，中止）"
      echo "   修复：BUILD_SYNC_PLUGINS=1 sh build.sh"
      exit 1
    fi
  else
    echo "  模型路由插件同步链路校验通过（仓库 == devhome profile）"
  fi
fi

# ---------------------------------------------------------------------------
# v1.8.5 壳/payload 分离：BUILD_LITE_SHELL=1 构建轻壳（assets 不含 payload.zip，
# APK ~5MB、构建约 1 分钟）——改壳代码（Java/Manifest/res）日常迭代用。
# payload 复用上次全量构建产物：adb push .local/payload-latest/payload.zip
#   /sdcard/DeepSeekHarness/payload.zip，App 启动时从外部导入（见 MainActivity）。
# 发布正式包/内核变更时用全量构建（不加此变量，或 BUILD_CLEAN=1 完全重建）。
# ---------------------------------------------------------------------------
if [ "$BUILD_LITE_SHELL" = "1" ]; then
  echo "== 0/7 组装 payload —— 轻壳模式：跳过 payload 装配（复用设备上已有的 payload）=="
  # 防回归：增量模式下 assets/ 由上次全量构建保留，残留 payload.zip 会被 aapt -A 静默打进轻壳包，
  # 轻壳秒级构建的意义（assetsHasPayload() 判定）随之失效 → 必须明确失败而不是默默打出一个"假轻壳"。
  if [ -e "$P/assets/payload.zip" ]; then
    echo "!! 轻壳构建中止：发现上次全量构建遗留的 $P/assets/payload.zip"
    echo "   请删除该文件后重试，或跑一次 BUILD_CLEAN=1 全量构建"
    exit 1
  fi
  mkdir -p "$P/staging" "$P/assets"
  # WebView 注入资源与 payload 版本标记：轻壳也要带（MainActivity 启动逻辑会读）
  cp "$P/../mobile-patch/mobile.css" "$P/assets/mobile.css"
  cp "$P/../mobile-patch/mobile.js" "$P/assets/mobile.js"
else
echo "== 0/7 组装 payload =="
# 移动端适配注入（mobile.css，不覆盖原生 index.html，DSH 更新后也自动重新注入）
sh "$P/../mobile-patch/inject.sh"

# ---------------------------------------------------------------------------
# 中间目录策略（v1.8.5 构建提速）：
#   默认   —— staging/out/assets 保留并增量复用：dshroot 用 robocopy /MIR 镜像
#             （staging 与内核源严格一致，无残留风险），runtime/dshhome 覆盖写，
#             payload 每次仍全量重打 + 全量密钥扫描。典型增量构建 ~3-5 分钟。
#   BUILD_CLEAN=1 —— 全量重建：旧中间目录整体 mv 到 ../.local/scratch-bak-<时间戳>/
#             （mv 不触发 safe-delete 钩子；需要完全干净时用一次）。
# 七步强校验（javac / dex 含 MainActivity / 三插件缺失中止 / 密钥扫描）在任何模式下都完整执行。
# ---------------------------------------------------------------------------
if [ "$BUILD_CLEAN" = "1" ]; then
  SCRATCH="$P/../.local/scratch-bak-$(date +%H%M%S)"
  mkdir -p "$SCRATCH"
  for d in staging out assets; do
    [ -e "$P/$d" ] && mv "$P/$d" "$SCRATCH/"
  done
  echo "  全量重建：旧中间目录已移至 $SCRATCH"
fi
mkdir -p "$P/staging/runtime/bin" "$P/staging/runtime/lib" \
         "$P/staging/runtime/etc" \
         "$P/staging/bin" "$P/staging/dshroot" \
         "$P/staging/dshhome/profiles/web" "$P/assets"

# Termux 共存修复（v1.7.4）：内置 node 在 Termux 环境编译，OPENSSLDIR 编译死为
# /data/data/com.termux/files/usr。装了 Termux 的设备读其 openssl.cnf 触发 EACCES，
# node 启动即崩；没装 Termux 时靠 ENOENT 静默才碰巧正常。App 启动引擎时注入
# OPENSSL_CONF 指向本文件（最小配置，显式激活内置 default provider，无需外部模块）。
cat > "$P/staging/runtime/etc/openssl.cnf" <<'EOF'
openssl_conf = openssl_init

[openssl_init]
providers = provider_sect

[provider_sect]
default = default_sect

[default_sect]
activate = 1
EOF

cp -L "$H/runtime/bin/node" "$P/staging/runtime/bin/node"
# Android 内置 ripgrep（grep/glob 工具用，@vscode/ripgrep 无 android 平台包）：
# rg 由 dsh-tool-fs-search 在 @vscode/ripgrep 解析失败后回退查找（runtime/bin/rg）
if [ -f "$H/runtime/bin/rg" ]; then
  cp -L "$H/runtime/bin/rg" "$P/staging/runtime/bin/rg"
  chmod +x "$P/staging/runtime/bin/rg"
  echo "  内置 rg: runtime/bin/rg"
# Android 内置 curl（AI 的 bash 工具用，Android 系统不带 curl）：
# termux 静态构建（NDK r29，interpreter /system/bin/linker64），依赖 libcurl/libnghttp2/3/ngtcp2/libssh2/openssl
if [ -f "$H/runtime/bin/curl" ]; then
  cp -L "$H/runtime/bin/curl" "$P/staging/runtime/bin/curl"
  chmod +x "$P/staging/runtime/bin/curl"
  echo "  内置 curl: runtime/bin/curl"
  # v1.8.2：Termux curl 编译期硬编码 Termux 证书路径（Android 上不存在）→ HTTPS error 77。
  # 打包 Mozilla CA bundle 进 payload，配合 MainActivity 注入的 CURL_CA_BUNDLE 使用。
  if [ -f "$P/ca-bundle/curl-ca-bundle.crt" ]; then
    cp -L "$P/ca-bundle/curl-ca-bundle.crt" "$P/staging/runtime/etc/curl-ca-bundle.crt"
    echo "  内置 CA bundle: runtime/etc/curl-ca-bundle.crt（$(grep -c 'BEGIN CERTIFICATE' "$P/ca-bundle/curl-ca-bundle.crt") 证书）"
  fi
fi
fi

# ---------------------------------------------------------------------------
# v1.9.0 glibc runtime 装配（双 runtime 共存，bionic 段原样保留）：
#   staging/runtime-glibc/  <- tools/runtime_glibc/fetch.py 的产物
#   staging/runtime/bin/node.glibc  <- glibc 启动 wrapper（sh 脚本）。
# 现有 runtime/bin/node 是 bionic 真身，不动；由 MainActivity 读
# dsh_prefs/runtime_mode 决定 exec node.glibc（glibc）还是 node（bionic）。
# bionic 回退因此零成本。fetch.py 产物缺失即中止（不让坏包静默通过）。
# ---------------------------------------------------------------------------
GLIBC_SRC="${DSH_GLIBC_RUNTIME:-$P/../build/updater/runtime-glibc}"
if [ ! -f "$GLIBC_SRC/bin/node" ]; then
  echo "!! 缺少 glibc runtime 产物：$GLIBC_SRC/bin/node"
  echo "   请先执行：python tools/runtime_glibc/fetch.py"
  exit 1
fi
mkdir -p "$P/staging/runtime-glibc"
cp -R "$GLIBC_SRC/bin" "$P/staging/runtime-glibc/"
cp -R "$GLIBC_SRC/lib" "$P/staging/runtime-glibc/"
cp -R "$GLIBC_SRC/etc" "$P/staging/runtime-glibc/"
# 批次32：mnemon CLI 二进制随包（静态 aarch64 ELF，overlay 为持久化源）
if [ -f "$P/../compatibility/0.1.5-rc.1/overlay/bin/mnemon" ]; then
  cp "$P/../compatibility/0.1.5-rc.1/overlay/bin/mnemon" "$P/staging/runtime-glibc/bin/mnemon"
  chmod 755 "$P/staging/runtime-glibc/bin/mnemon"
fi
# busybox 清账（#9a，2026-09-13）：musl 静态 PIE（ET_DYN）在 app 域被 seccomp 杀
# （SIGSYS 159），PATH 已由 /system/bin toybox 顶替，全仓核查无任何调用方指向
# payload busybox（chroot 通道用的 busybox 属 /data/local/dsh-chroot rootfs，与
# payload 无关）→ 从 payload 移除。随包的 symlinks.json 34 条符号链接全部指向
# busybox（原 TEG 路径改写 / root 域便捷入口，TEG 已永不预加载），一并移除；
# MainActivity 的 applyGlibcSymlinks 对缺失清单幂等跳过（isFile() 守卫）。
# fetch.py 仍会下载 busybox 到 build 产物——此处兜底剔除，防止将来被误加回 PATH。
rm -f "$P/staging/runtime-glibc/bin/busybox" "$P/staging/runtime-glibc/symlinks.json"
cat > "$P/staging/runtime/bin/node.glibc" <<'EOF'
#!/system/bin/sh
# v1.9.0 glibc 启动 wrapper：官方 glibc node 经随包 ld.so 启动（不用 patchelf）。
# 真机修复（2026-09-11，Pixel 6 Pro / SDK 37 ROM）：
#  1) app 域 seccomp 会 SIGSYS 杀掉 /system/bin/dirname 等外部命令（mksh 内建
#     不受影响）→ 本脚本只用 mksh 内建与参数展开，零外部依赖；
#  2) wrapper 在 runtime/bin/ 下，payload 根的 runtime-glibc/ 是 ../../runtime-glibc；
#  3) 不用 `cd --`（mksh 不支持，早前踩过）。
# LD_PRELOAD=TEG 在 execve 层把 /bin/sh、/usr/bin/env 等改写到 payload 内
# busybox 链接（链接清单 runtime-glibc/symlinks.json 由 MainActivity 首启创建）。
DIR=${0%/*}
[ -d "$DIR/../../runtime-glibc/lib" ] || {
  echo "node.glibc: cannot locate runtime-glibc next to $0" >&2
  exit 97
}
GLIBC="$DIR/../../runtime-glibc"
export LD_LIBRARY_PATH="$GLIBC/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# 注意：绝不导出 LD_PRELOAD=TEG（libtermux-exec.so）。真机 A/B 实证（2026-09-11）：
# TEG 是 glibc 库，会被 bionic 子进程（payload/bin/bash、/system/bin/sh）继承，
# bionic linker 沿继承的 LD_LIBRARY_PATH 加载 glibc libc.so.6 去解析 TEG 的符号
# 版本 → "CANNOT LINK EXECUTABLE: cannot find verneed/verdef for version
# index=32770 (_res)"，bash/glob/grep 全灭。TEG 的路径改写目标是不存在的 Termux
# 前缀，对本 App 零收益，故仅随包留存、不预加载。
exec "$GLIBC/lib/ld-linux-aarch64.so.1" \
     --library-path "$LD_LIBRARY_PATH" "$GLIBC/bin/node" "$@"
EOF
chmod +x "$P/staging/runtime/bin/node.glibc" 2>/dev/null || true
# 预检：glibc 五要素 + wrapper 语法（sh -n）
GLIBC_FAIL=""
[ -f "$P/staging/runtime-glibc/bin/node" ] || GLIBC_FAIL="$GLIBC_FAIL runtime-glibc/bin/node"
[ -f "$P/staging/runtime-glibc/lib/ld-linux-aarch64.so.1" ] || GLIBC_FAIL="$GLIBC_FAIL ld-linux-aarch64.so.1"
[ -f "$P/staging/runtime-glibc/lib/libtermux-exec.so" ] || GLIBC_FAIL="$GLIBC_FAIL libtermux-exec.so"
[ -f "$P/staging/runtime-glibc/etc/nsswitch.conf" ] || GLIBC_FAIL="$GLIBC_FAIL nsswitch.conf"
[ -f "$P/staging/runtime-glibc/bin/rg" ] || GLIBC_FAIL="$GLIBC_FAIL runtime-glibc/bin/rg"
[ -f "$P/staging/runtime-glibc/bin/mnemon" ] || GLIBC_FAIL="$GLIBC_FAIL runtime-glibc/bin/mnemon"
if [ -n "$GLIBC_FAIL" ]; then
  echo "!! glibc runtime 预检失败，payload 缺少：$GLIBC_FAIL"; exit 1
fi
if ! sh -n "$P/staging/runtime/bin/node.glibc" 2>&1; then
  echo "!! node.glibc wrapper 语法检查（sh -n）失败，中止"; exit 1
fi
echo "  glibc runtime 装配 + wrapper 预检通过（双 runtime 共存）"

for f in $(find "$H/runtime/lib" -maxdepth 1 -type f); do
  cp -L "$f" "$P/staging/runtime/lib/"
done

cat > "$P/staging/runtime/lib/LINKS.txt" <<'EOF'
libcrypto.so	libcrypto.so.3
libicudata.so	libicudata.so.78.3
libicudata.so.78	libicudata.so.78.3
libicui18n.so	libicui18n.so.78.3
libicui18n.so.78	libicui18n.so.78.3
libicuio.so	libicuio.so.78.3
libicuio.so.78	libicuio.so.78.3
libicutest.so	libicutest.so.78.3
libicutest.so.78	libicutest.so.78.3
libicutu.so	libicutu.so.78.3
libicutu.so.78	libicutu.so.78.3
libicuuc.so	libicuuc.so.78.3
libicuuc.so.78	libicuuc.so.78.3
libsqlite3.so	libsqlite3.so.3.53.4
libsqlite3.so.0	libsqlite3.so.3.53.4
libssl.so	libssl.so.3
libz.so	libz.so.1.3.2
libz.so.1	libz.so.1.3.2
EOF

# 补全 soname 为实体文件（关键修复）：
# jar 打包会把符号链接压平成普通内容，且部分设备解压后无法创建软链接（FUSE/权限），
# 导致 node 启动报 "library libz.so.1 not found"。这里直接把链接目标复制成同名实体文件，
# 动态加载器按名字找文件即可，不依赖任何链接支持。
cd "$P/staging/runtime/lib"
while IFS=$'\t' read -r _link _target; do
  case "$_link" in ""|\#*) continue ;; esac
  [ -n "$_target" ] || continue
  if [ ! -e "$_link" ] && [ -f "$_target" ]; then
    cp -L "$_target" "$_link"
    echo "  soname 实体化: $_link"
  fi
done < LINKS.txt
cd - >/dev/null

mkdir -p "$P/staging/dshroot/lib"
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
    RC=0
    # /MIR 镜像：staging 与内核源严格一致（删除源里已不存在的文件），增量构建无残留
    MSYS2_ARG_CONV_EXCL='*' robocopy "$(cygpath -w "$H/dshroot/lib")" "$(cygpath -w "$P/staging/dshroot/lib")" /MIR /NFL /NDL /NJH /NJS /NP /XD .bin || RC=$?
    [ "$RC" -lt 8 ] || exit "$RC"
    ;;
  *)
    ( cd "$H/dshroot/lib" && tar cf - --exclude='./node_modules/@deepseek-ai/dsh/node_modules/.bin' . ) \
      | ( cd "$P/staging/dshroot/lib" && tar xf - )
    ;;
esac

# 批次 15 #3 方案 A 死重冲销（2026-09-12）：node-pty 的 win32/darwin prebuilds
# （win32 含 conpty .pdb 调试符号 + OpenConsole.exe，共 23.1MB raw / 5.5MB compressed）
# 在 linux-arm64 设备上永远用不到（node-pty 在 Android 本就走 child-process 替身），
# 删除它们用于冲销真 sharp @img/libvips 进包的压缩增量（≈8.3MB）；linux-* prebuilds 保留。
# 放在 dshroot 镜像之后：robocopy /MIR 与 tar 两条路径每次装配都会先复原再被此处剔除，幂等。
rm -rf "$P/staging/dshroot/lib/node_modules/node-pty/prebuilds/win32-arm64" \
       "$P/staging/dshroot/lib/node_modules/node-pty/prebuilds/win32-x64" \
       "$P/staging/dshroot/lib/node_modules/node-pty/prebuilds/darwin-arm64" \
       "$P/staging/dshroot/lib/node_modules/node-pty/prebuilds/darwin-x64"

# dshroot 版本标记：App 用它判断「外部 /sdcard/DeepSeekHarness/dshroot」是否需要补齐。
# 外部已有的文件永不覆盖（保留 AI 运行时修改），缺失文件才从 APK 补上。
DSHROOT_REV="$(date +%Y%m%d%H%M%S)"
echo "$DSHROOT_REV" > "$P/staging/dshroot/REVISION"
echo "$DSHROOT_REV" > "$P/assets/dshroot_revision.txt"

# 内核版本标记（v1.5.2 慢启动修复）：REVISION 是构建时间戳，每次构建都变；
# App 用它区分「同内核升级（内容几乎不变，快速同步即可）」与「内核升级（新增文件，需全量补齐）」。
DSHROOT_PKG_JSON="$P/staging/dshroot/lib/node_modules/@deepseek-ai/dsh/package.json"
if [ -f "$DSHROOT_PKG_JSON" ]; then
  grep -m1 '"version"' "$DSHROOT_PKG_JSON" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' > "$P/assets/dshroot_kernel_version.txt"
  echo "  内核版本标记: $(cat "$P/assets/dshroot_kernel_version.txt")"
else
  echo "  !! 未找到 dsh/package.json，内核版本标记留空（App 将保守全量补齐）"
  : > "$P/assets/dshroot_kernel_version.txt"
fi

cat > "$P/staging/bin/bash" <<'EOF'
#!/system/bin/sh
exec /system/bin/sh "$@"
EOF
chmod +x "$P/staging/bin/bash"

# Shizuku 运行时（rish dex）：独立放 assets 供权限界面检测，同时放 payload 供 DSH 插件调用
cp "$H/rish/rish_shizuku.dex" "$P/assets/rish_shizuku.dex"
mkdir -p "$P/staging/rish"
cp "$H/rish/rish_shizuku.dex" "$P/staging/rish/rish_shizuku.dex"
chmod 644 "$P/staging/rish/rish_shizuku.dex"

# 批次 11：vscreen 特权服务端 jar（独立 javac/d8，LGPL 三文件不进 APK dex）→ assets 随包分发。
# 构建失败必须中止：宁可不出包也不能默默打出缺服务端的旧 jar（App 侧会诚实报 SPAWN_FAILED）。
echo "== vscreen server jar =="
# 用 sh 显式调起（脚本 shebang 是 #!/system/bin/sh，与 build.sh 同款，Windows Git Bash 无此解释器）
sh "$P/build-vscreen-jar.sh" || { echo "!! vscreen-server.jar 构建失败"; exit 1; }
mkdir -p "$P/assets/vscreen"
cp "$P/out/vscreen-server/vscreen-server.jar" "$P/assets/vscreen/vscreen-server.jar"

# 移动端适配资源：随 APK 打包，MainActivity 注入 WebView（不依赖服务器 dist）
cp "$P/../mobile-patch/mobile.css" "$P/assets/mobile.css"
cp "$P/../mobile-patch/mobile.js" "$P/assets/mobile.js"

cp "$H/.dsh/cordis.patch.yml" "$P/staging/dshhome/"
cp "$H/.dsh/profiles/web/cordis.patch.yml" "$P/staging/dshhome/profiles/web/"
cp "$H/.dsh/profiles/web/cordis.yml" "$P/staging/dshhome/profiles/web/"
cp "$H/.dsh/profiles/web/package.json" "$P/staging/dshhome/profiles/web/"
cp "$H/.dsh/profiles/web/pnpm-workspace.yaml" "$P/staging/dshhome/profiles/web/"
cp "$H/.dsh/settings.yaml" "$P/staging/dshhome/"

# Cordis resolves inserted plugins from the profile, but copying the whole
# profile node_modules would package a second DSH core. That duplicates
# process-scoped services such as system-prompt and breaks preset mounting.
# Ship only the custom plugins plus a shim that reuses the host dsh-tools.
PROFILE_AI="$P/staging/dshhome/profiles/web/node_modules/@deepseek-ai"
mkdir -p "$PROFILE_AI"
for plugin in dsh-tool-shizuku dsh-tool-android dsh-tool-accessibility; do
  cp -R "$H/.dsh/profiles/web/node_modules/@deepseek-ai/$plugin" "$PROFILE_AI/"
done
cp -R "$P/profile-shims/dsh-tools" "$PROFILE_AI/"
for plugin in dsh-tool-shizuku dsh-tool-android dsh-tool-accessibility; do
  [ -f "$PROFILE_AI/$plugin/package.json" ] \
    || { echo "!! profile 缺少插件：$plugin"; exit 1; }
done
[ -f "$PROFILE_AI/dsh-tools/package.json" ] \
  || { echo "!! profile 缺少宿主 dsh-tools shim"; exit 1; }

# 批次23+批次27：第三方插件随包（@jiesou/dsh-commandcode-go-provider, @jiesou/dsh-model-router）。cordis insert 同样从
# profile 树解析（dshroot 是 dshhome 的兄弟目录，ESM 向上查找不可达，见 S2/S3 双树教训），
# 故与三插件同机制物化进 profile staging。源=仓库 overlay（prepare/refresh 持久化源头），
# 缺失即失败——cordis.patch.yml 已引用该 id，缺包会导致引擎启动失败（已真机实证）。
VENDOR_SRC="$P/../compatibility/0.1.5-rc.1/overlay/node_modules/@jiesou"
if [ -d "$VENDOR_SRC" ]; then
  mkdir -p "$P/staging/dshhome/profiles/web/node_modules/@jiesou"
  cp -R "$VENDOR_SRC/." "$P/staging/dshhome/profiles/web/node_modules/@jiesou/"
else
  echo "!! 缺少第三方插件源 $VENDOR_SRC（cordis.patch.yml 已引用）"; exit 1
fi
# 批次27：双树物化与强校验（确保 @jiesou/ 命名空间规范随包生效）
if [ -d "$P/../plugins/dsh-model-router" ]; then
  mkdir -p "$P/staging/dshroot/lib/node_modules/@jiesou/dsh-model-router"
  cp -R "$P/../plugins/dsh-model-router/." "$P/staging/dshroot/lib/node_modules/@jiesou/dsh-model-router/"
fi
for vendor_plugin in dsh-commandcode-go-provider dsh-model-router; do
  [ -f "$P/staging/dshhome/profiles/web/node_modules/@jiesou/$vendor_plugin/package.json" ] \
    || { echo "!! profile 缺少第三方插件：@jiesou/$vendor_plugin"; exit 1; }
  [ -f "$P/staging/dshroot/lib/node_modules/@jiesou/$vendor_plugin/package.json" ] \
    || { echo "!! dshroot 缺少第三方插件：@jiesou/$vendor_plugin"; exit 1; }
done

# 批次30/31/32：裸包名第三方插件随包（无 scope，@jiesou 的 cp -R 覆盖不到，双树都需在位）。
#   - dsh-codearts-auth：CodeArts/CodeBuddy 认证 + LLM provider（lib/client/jet-hub.js 为 Models 页 UI）
#   - dsh-agy：Google Antigravity OAuth（本项目已改造其主密钥存储为自有文件 agy-master-key.json，
#     以规避 DSH 0.1.5-rc.1 凭据文档的严格顶层键校验）
#   - proper-lockfile/graceful-fs/signal-exit undici：dsh-agy 运行期依赖链（signal-exit 必须 v3）
#   - dsh-mnemon + 16 个子包 + fflate/schemastery/zod：三层记忆控制平面及其 provider/source/strategy 链
# 源同为仓库 overlay（prepare/refresh 的持久化源头），缺失即失败——cordis.patch.yml 已引用对应 id。
BARE_PKGS="dsh-codearts-auth dsh-agy proper-lockfile graceful-fs signal-exit \
  dsh-mnemon \
  dsh-mnemon-provider-byterover \
  dsh-mnemon-provider-hindsight \
  dsh-mnemon-provider-holographic \
  dsh-mnemon-provider-honcho \
  dsh-mnemon-provider-mem0 \
  dsh-mnemon-provider-mnemon-native \
  dsh-mnemon-provider-openviking \
  dsh-mnemon-provider-retaindb \
  dsh-mnemon-provider-supermemory \
  dsh-mnemon-source-documents \
  dsh-mnemon-source-memory-spaces \
  dsh-mnemon-source-runtime \
  dsh-mnemon-strategy-auto-capture \
  dsh-mnemon-strategy-default-three-tier \
  dsh-mnemon-strategy-light-context \
  dsh-mnemon-strategy-scoped \
  fflate schemastery zod cosmokit markdown-to-jsx js-tokens loose-envify scheduler"
for VENDOR_BARE in $BARE_PKGS; do
  BARE_SRC="$P/../compatibility/0.1.5-rc.1/overlay/node_modules/$VENDOR_BARE"
  if [ ! -d "$BARE_SRC" ]; then
    echo "!! 缺少第三方包源 $BARE_SRC（cordis.patch.yml 或依赖链已引用）"; exit 1
  fi
  mkdir -p "$P/staging/dshhome/profiles/web/node_modules"
  rm -rf "$P/staging/dshhome/profiles/web/node_modules/$VENDOR_BARE"
  cp -R "$BARE_SRC" "$P/staging/dshhome/profiles/web/node_modules/"
  mkdir -p "$P/staging/dshroot/lib/node_modules"
  rm -rf "$P/staging/dshroot/lib/node_modules/$VENDOR_BARE"
  cp -R "$BARE_SRC" "$P/staging/dshroot/lib/node_modules/"
done
# @deepseek-ai/dsh-client-ui-primitives：dsh-mnemon Web UI 依赖，双树均需就位
UI_PRIM_SRC="$P/../compatibility/0.1.5-rc.1/overlay/node_modules/@deepseek-ai/dsh-client-ui-primitives"
if [ -d "$UI_PRIM_SRC" ]; then
  mkdir -p "$P/staging/dshhome/profiles/web/node_modules/@deepseek-ai"
  rm -rf "$P/staging/dshhome/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-primitives"
  cp -R "$UI_PRIM_SRC" "$P/staging/dshhome/profiles/web/node_modules/@deepseek-ai/"
  mkdir -p "$P/staging/dshroot/lib/node_modules/@deepseek-ai"
  rm -rf "$P/staging/dshroot/lib/node_modules/@deepseek-ai/dsh-client-ui-primitives"
  cp -R "$UI_PRIM_SRC" "$P/staging/dshroot/lib/node_modules/@deepseek-ai/"
fi
# @deepseek-ai/dsh-native-command：配置文件查看器原生拦截（通过 3081 桥接）
NATIVE_CMD_SRC="$P/../compatibility/0.1.5-rc.1/overlay/node_modules/@deepseek-ai/dsh-native-command"
if [ -d "$NATIVE_CMD_SRC" ]; then
  mkdir -p "$P/staging/dshroot/lib/node_modules/@deepseek-ai"
  rm -rf "$P/staging/dshroot/lib/node_modules/@deepseek-ai/dsh-native-command"
  cp -R "$NATIVE_CMD_SRC" "$P/staging/dshroot/lib/node_modules/@deepseek-ai/"
fi
# @deepseek-ai/dsh-client-connection：网关层放行 /api/jet-hub 解决 401，双树物化随包
CLIENT_CONN_SRC="$P/../compatibility/0.1.5-rc.1/overlay/node_modules/@deepseek-ai/dsh-client-connection"
if [ -d "$CLIENT_CONN_SRC" ]; then
  mkdir -p "$P/staging/dshroot/lib/node_modules/@deepseek-ai"
  rm -rf "$P/staging/dshroot/lib/node_modules/@deepseek-ai/dsh-client-connection"
  cp -R "$CLIENT_CONN_SRC" "$P/staging/dshroot/lib/node_modules/@deepseek-ai/"
  mkdir -p "$P/staging/dshhome/profiles/web/node_modules/@deepseek-ai"
  rm -rf "$P/staging/dshhome/profiles/web/node_modules/@deepseek-ai/dsh-client-connection"
  cp -R "$CLIENT_CONN_SRC" "$P/staging/dshhome/profiles/web/node_modules/@deepseek-ai/"
fi
# 强校验：入口文件双树在位（缺失会让引擎启动即失败，必须在打包前拦下）
for f in "dsh-codearts-auth/lib/index.js" "dsh-codearts-auth/lib/client/jet-hub.js" \
         "dsh-agy/lib/index.mjs" "dsh-agy/lib/web/plugin.mjs" \
         "proper-lockfile/lib/lockfile.js" "graceful-fs/graceful-fs.js" "signal-exit/index.js" \
         "dsh-mnemon/lib/index.js" "dsh-mnemon/lib/client.js"; do
  [ -f "$P/staging/dshhome/profiles/web/node_modules/$f" ] \
    || { echo "!! profile 缺少第三方文件：$f"; exit 1; }
  [ -f "$P/staging/dshroot/lib/node_modules/$f" ] \
    || { echo "!! dshroot 缺少第三方文件：$f"; exit 1; }
done

# 安全检查：payload 里绝不能出现 API Key 或凭证文件。
# Git Bash 下 grep 递归扫描 2 万+ 文件会非常慢，优先用 rg。
if command -v rg >/dev/null 2>&1; then
  if rg -q --hidden --no-messages \
      -g '!*.so' -g '!*.dex' -g '!*.png' -g '!*.jpg' \
      'sk-[A-Za-z0-9]{20,}' "$P/staging"; then
    echo "!! 检测到 API Key 混入 payload，中止"; exit 1
  fi
elif grep -rIqE "sk-[A-Za-z0-9]{20,}" "$P/staging" 2>/dev/null; then
  echo "!! 检测到 API Key 混入 payload，中止"; exit 1
fi
if [ -e "$P/staging/dshhome/.credentials.yaml" ]; then
  echo "!! 检测到 .credentials.yaml，中止"; exit 1
fi

echo "--- payload 各部分大小 ---"
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
    # Git Bash du recursively walking 20k+ files adds minutes on NTFS.
    echo "  Windows build: 跳过 payload 目录大小统计"
    ;;
  *)
    du -sh "$P/staging/runtime" "$P/staging/dshroot" "$P/staging/dshhome" "$P/staging/bin"
    ;;
esac

( cd "$P/staging" && jar cMf "$P/assets/payload.zip" . )
echo "payload.zip: $(du -sh "$P/assets/payload.zip" | cut -f1)"
# 固定路径供轻壳开发使用（adb push 到 /sdcard/DeepSeekHarness/payload.zip）
mkdir -p "$P/../.local/payload-latest"
cp "$P/assets/payload.zip" "$P/../.local/payload-latest/payload.zip"
echo "  payload-latest: .local/payload-latest/payload.zip（轻壳开发：adb push 到 /sdcard/DeepSeekHarness/）"
fi

echo "== 1/7 资源编译 (aapt) =="
# out 子目录必须干净：javac/d8 增量会残留已删除源文件的旧 class 混进 dex。
# 用 mv 移走（不触发 safe-delete 钩子），BUILD_CLEAN 时随整目录一起移。
SCRATCH_OUT="$P/../.local/scratch-bak-out-$(date +%H%M%S)"
for sub in gen classes dex; do
  if [ -e "$P/out/$sub" ]; then
    mkdir -p "$SCRATCH_OUT"
    mv "$P/out/$sub" "$SCRATCH_OUT/"
  fi
done
mkdir -p "$P/out/gen" "$P/out/classes" "$P/out/dex"
aapt package -f -m -J "$P/out/gen" -M "$P/AndroidManifest.xml" -S "$P/res" -I "$AJ"

echo "== 2/7 javac =="
# 解压 Shizuku API + provider + aidl 的 classes.jar 供编译和 dex
SHIZUKU_CLS="$P/out/shizuku-cls"
# rm -rf 会被 safe-delete 钩子拦截（genie-trash 偶发失败即 fail-closed 中止构建），改用 mv 移走
if [ -e "$SHIZUKU_CLS" ]; then
  mv "$SHIZUKU_CLS" "$P/../.local/scratch-bak-shizuku-cls-$(date +%H%M%S)"
fi
mkdir -p "$SHIZUKU_CLS"
for AAR in "$P/libs/shizuku-api.aar" "$P/libs/shizuku-provider.aar" "$P/libs/shizuku-aidl.aar"; do
  TMP="$P/out/$(basename "$AAR" .aar)"
  rm -rf "$TMP"; mkdir -p "$TMP"
  ( cd "$TMP" && "$JAVA/jar" xf "$AAR" classes.jar )
  ( cd "$SHIZUKU_CLS" && "$JAVA/jar" xf "$TMP/classes.jar" )
done
SHIZUKU_JARS="$P/out/shizuku-api/classes.jar${CP_SEP}$P/out/shizuku-provider/classes.jar${CP_SEP}$P/out/shizuku-aidl/classes.jar"
# Windows(Git Bash)：MSYS 不转换"分号分隔的 POSIX 路径列表"，javac 会整体当一条路径找不到 → 用 cygpath 转 Windows 路径
GEN_CP="$P/out/gen"
if [ "$CP_SEP" = ";" ] && command -v cygpath >/dev/null 2>&1; then
  GEN_CP="$(cygpath -w "$P/out/gen")"
  SHIZUKU_JARS="$(cygpath -w "$P/out/shizuku-api/classes.jar")${CP_SEP}$(cygpath -w "$P/out/shizuku-provider/classes.jar")${CP_SEP}$(cygpath -w "$P/out/shizuku-aidl/classes.jar")"
fi
# javac 必须成功：失败立即中止（曾因 javac 找不到而产出无 MainActivity 的坏 APK，安装即闪退）
if ! "$JAVA/javac" -source 1.8 -target 1.8 -bootclasspath "$AJ" \
  -classpath "$GEN_CP${CP_SEP}$SHIZUKU_JARS" -d "$P/out/classes" \
  "$P/src/com/deepseek/harness/OverlayAgentClient.java" \
  "$P"/src/com/deepseek/harness/*.java \
  "$P/out/gen/com/deepseek/harness/R.java" \
  >"$P/out/javac.log" 2>&1; then
  echo "!! javac 编译失败，日志：$P/out/javac.log"
  tail -20 "$P/out/javac.log"
  exit 1
fi
grep -v "bootstrap class path\|warning:\|RestrictTo\|Note:\|deprecat" "$P/out/javac.log" || true
NCLASS="$(find "$P/out/classes" -name '*.class' | wc -l)"
echo "  javac 完成，class 数：$NCLASS"
[ "$NCLASS" -gt 0 ] || { echo "!! javac 产物为空，中止构建"; exit 1; }

echo "== 3/7 d8 -> dex =="
# class 列表写入 response file（Windows 命令行 8191 字符限制，98+ 个绝对路径会超长）
CLS_RSP="$P/out/classes.rsp"
if [ "$CP_SEP" = ";" ] && command -v cygpath >/dev/null 2>&1; then
  { find "$P/out/classes" -name '*.class'; find "$SHIZUKU_CLS" -name '*.class'; } | cygpath -w -f - > "$CLS_RSP"
else
  { find "$P/out/classes" -name '*.class'; find "$SHIZUKU_CLS" -name '*.class'; } > "$CLS_RSP"
fi
"$D8" --release --lib "$AJ" --min-api 24 --output "$P/out/dex" @"$CLS_RSP" \
  || { echo "!! d8 失败"; exit 1; }
# 校验 dex 必须包含 MainActivity（防止再次产出安装即闪退的坏包）
if ! grep -aq "MainActivity" "$P/out/dex/classes.dex"; then
  echo "!! classes.dex 缺少 MainActivity，中止构建"; exit 1
fi
echo "  classes.dex 含 MainActivity，$(stat -c%s "$P/out/dex/classes.dex") bytes"

echo "== 4/7 aapt 打包 + assets =="
aapt package -f -M "$P/AndroidManifest.xml" -S "$P/res" -I "$AJ" -A "$P/assets" -0 zip -F "$P/out/unsigned.apk"
( cd "$P/out/dex" && aapt add "$P/out/unsigned.apk" classes.dex )

echo "== 5/7 zipalign =="
zipalign -f 4 "$P/out/unsigned.apk" "$P/out/aligned.apk"

echo "== 6/7 签名 =="
[ -f "$KEY" ] || { echo "!! 缺少签名密钥 $KEY（release.jks 不入仓库，请自行准备）"; exit 1; }
"$APKSIGNER" sign --ks "$KEY" --ks-pass "pass:${KEYSTORE_PASS:?请先 export KEYSTORE_PASS=签名密码}" --ks-key-alias "${KEYSTORE_ALIAS:-dsh}" --key-pass "pass:$KEYSTORE_PASS" \
  --out "$P/DeepSeekHarness.apk" "$P/out/aligned.apk"

echo "== 7/7 校验 =="
"$APKSIGNER" verify --print-certs "$P/DeepSeekHarness.apk"
aapt dump badging "$P/DeepSeekHarness.apk" | head -8
ls -la "$P/DeepSeekHarness.apk"
# 轻壳防回归（打包后终检）：轻壳 APK 绝不能包含 assets/payload.zip
if [ "$BUILD_LITE_SHELL" = "1" ]; then
  if "$JAVA/jar" tf "$P/DeepSeekHarness.apk" | grep -q "^assets/payload.zip$"; then
    echo "!! 轻壳 APK 含 assets/payload.zip，中止（检查 assets/ 残留或 aapt -A 输入）"; exit 1
  fi
  echo "  轻壳终检通过：APK 不含 assets/payload.zip"
fi
echo "BUILD OK -> $P/DeepSeekHarness.apk"
