# sdk/ —— Android platform jar（自备，不入仓库）

本目录放编译用的 `android.jar`（Android platform jar）。

- **为什么不入仓库**：android.jar 体积大且属于 Google SDK 许可范围，迁移包/仓库均不包含
- **构建方式**：`build.sh` 默认找 `$P/sdk/android.jar`（`P` = android-app 目录），
  也可以 `export ANDROID_JAR=<路径>` 覆盖（推荐，避免把 jar 放进工程目录）

## 获取 android.jar

任选其一：

1. 从原设备 buildenv 恢复：`buildenv/build/platform33/android-13/android.jar`
   （交接文档第四节；原脚本 `restore-buildenv.sh` 会把它放到 devhome/build/）
2. Android SDK 下载 platform 包：`sdkmanager "platforms;android-28"` 后
   `export ANDROID_JAR=$ANDROID_HOME/platforms/android-28/android.jar`
3. 从在线源直接下载 android-28 platform jar（如 https://github.com/Sable/android-platforms 等镜像）

> ⚠️ targetSdk 必须保持 28（manifest 已写死）：≥29 时 Android 私有目录 noexec，
> node 二进制 EACCES 起不来，引擎无法启动。android.jar 用 android-28（API 28）即可，
> 历史构建用过 android-13（API 33）编译也没问题（-bootclasspath 兼容）。
