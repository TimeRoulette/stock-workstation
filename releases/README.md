# releases/

可选存放本机打出的 debug APK。默认不把大型二进制提交进 git。

## 下载入口（优先）

1. **直链 APK（推荐）**：soft Release  
   https://github.com/TimeRoulette/stock-workstation/releases/tag/android-debug-latest  
   → Assets 里的 `stock-workstation-*-debug.apk`（可直接安装，无需解压）

2. **Actions artifact**：run 页 Artifacts → `stock-workstation-debug-apk`  
   → 下到的是 **zip**，必须解压后才得到 `.apk`

安装前请允许「未知来源」。详见 `docs/android.md`。
