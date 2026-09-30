# Android 安装说明（v0.11）

## 结论（先看这里）

| 路径 | 能否「安装」 | 稳定性 | 说明 |
|------|-------------|--------|------|
| **PWA「添加到主屏幕」** | ✅ 推荐日常 | 最高 | 已有 `manifest.webmanifest` + Service Worker；Chrome/Edge「安装应用」或「添加到主屏幕」。**零打包、零签名。** |
| **Capacitor / TWA 包一层 APK** | ✅ 可出 debug APK | 中 | 打开同一 GitHub Pages 或内置 `dist/` assets。需 Android SDK / Gradle；本仓库提供脚手架 + **GitHub Actions** 构建 debug APK。 |
| **Electron** | ❌ | — | **不能**出安卓包；仅 Windows / macOS / Linux 桌面。 |

**不承诺**上架 Google Play / 国内应用商店。仓库/Actions 产出的为 **debug 签名** APK，仅供自用测试。

---

## 推荐：PWA

1. 用 Chrome 打开：https://timeroulette.github.io/stock-workstation/
2. 菜单 → **安装应用** / **添加到主屏幕**
3. 从桌面图标以 standalone 打开（与桌面 PWA 同类体验）

限制：依赖浏览器与系统 WebView；后台能力弱于原生；行情仍受公开站 CORS/中继限制。

---

## Capacitor 脚手架（本仓库）

### 本机（需 Android SDK）

```bash
npm ci
npm run build
# 首次生成 android/ 工程（体积大，默认不提交）
npm run android:add
npm run android:sync
# 有 Android Studio / SDK 时：
npm run android:apk
# 产物通常在 android/app/build/outputs/apk/debug/
```

缺什么：

- **JDK 17+**
- **Android SDK**（`ANDROID_HOME`）与 platform-tools、build-tools、一个 platform（如 34）
- **Gradle**（由 Android 工程 wrapper 拉取）

本 CI/开发 box 若未装 SDK，则**无法在本地打出正式/debug APK**；请用下方 Actions。

### GitHub Actions 下载 debug APK

1. 打开仓库 **Actions → Build Android Debug APK**
2. 手动 **Run workflow**，或 push 到 `main` 后按 workflow 配置触发
3. 完成后在该次 run 的 **Artifacts** 下载 `stock-workstation-debug-apk`
4. 手机需允许「未知来源」安装；为 debug 签名，**不能**当商店包

配置见 `.github/workflows/android-apk.yml`。

### 在线壳 vs 离线 assets

- **离线**：`capacitor.config.ts` 的 `webDir: 'dist'`，`cap sync` 把构建产物打进 APK（推荐自用）。
- **在线**：设置 `server.url` 为 Pages 地址（类似 TWA）；APK 只是浏览器壳，需联网，且受站点可用性影响。

---

## 与 Bubblewrap / TWA

Google Bubblewrap 也可把 PWA 打成 TWA APK。本仓库优先 Capacitor，因与现有 Vite `dist` 同步路径更直接。若你更熟 Bubblewrap，可对同一 Pages URL 自行 `bubblewrap init`；原理等价「系统 WebView 打开站点」。

---

## 明确不做

- Electron → Android
- 未授权券商 App 打包/爬取
- 商店上架与正式 release 签名流程（可自行用 keystore 扩展）
