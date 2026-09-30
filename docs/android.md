# Android 安装与应用内更新（v0.12.1）

## 结论（先看这里）

| 路径 | 能否「安装」 | 稳定性 | 说明 |
|------|-------------|--------|------|
| **PWA「添加到主屏幕」** | ✅ 推荐日常 | 最高 | 已有 `manifest.webmanifest` + Service Worker；Chrome/Edge「安装应用」或「添加到主屏幕」。**零打包、零签名。** |
| **Capacitor / TWA 包一层 APK** | ✅ 可出 debug APK | 中 | 打开同一 GitHub Pages 或内置 `dist/` assets。需 Android SDK / Gradle；本仓库提供脚手架 + **GitHub Actions** 构建 debug APK。自 **v0.12.1** 起支持**应用内检查更新**（用户可选）。 |
| **Electron** | ❌ | — | **不能**出安卓包；仅 Windows / macOS / Linux 桌面。 |

**不承诺**上架 Google Play / 国内应用商店。仓库/Actions 产出的为 **debug 签名** APK，仅供自用测试。同 debug 签名可**覆盖安装**。

---

## 应用内检查更新（v0.12.1+）

### 行为

- **设置 → 检查更新（Android APK）**：手动检查；展示**版本号 + changelog**；由你决定是否下载安装。
- **启动后轻量检查**（默认开，可关）：有新版本时顶栏横幅 / 设置角标提示，**不打断、不强制、不静默升级**。
- 元数据 URL（随 Pages 发布）：  
  **https://timeroulette.github.io/stock-workstation/app-update.json**  
  失败时回退 GitHub Releases API（`android-debug-latest`）。
- 点「下载」会打开 APK 直链（系统下载器 / 浏览器）；再在系统安装界面确认。优先可靠路径，不做后台静默安装。

### 旧版兼容（请诚实看待）

- **从本版本（含检查器）起**，之后可用应用内更新到更新的 debug APK。
- 已经装出去的 **0.11.0（或更早）旧包若当时没有检查器，无法凭空出现该功能**。
- 请先**手动安装一次**带检查器的新包（soft Release 或本页直链），之后即可在设置里检查更新。
- 网页 / PWA **不能**升级成 APK；站点可提示「安卓有新版本」并链到 APK，但不会假装能把 PWA 变成原生包。

### 元数据字段示例

```json
{
  "android": {
    "latestVersion": "0.12.1",
    "minVersion": "0.11.0",
    "apkUrl": "https://github.com/TimeRoulette/stock-workstation/releases/download/android-debug-latest/stock-workstation-0.12.1-debug.apk",
    "releasePage": "https://github.com/TimeRoulette/stock-workstation/releases/tag/android-debug-latest",
    "publishedAt": "ISO-8601",
    "changelog": ["..."]
  }
}
```

CI（`android-apk.yml`）在 soft Release 成功后会刷新 `public/app-update.json` 并推回 `main`（随 Pages 发布）。版本比较为 semver。

---

## 推荐：PWA

1. 用 Chrome 打开：https://timeroulette.github.io/stock-workstation/
2. 菜单 → **安装应用** / **添加到主屏幕**
3. 从桌面图标以 standalone 打开（与桌面 PWA 同类体验）

限制：依赖浏览器与系统 WebView；后台能力弱于原生；行情仍受公开站 CORS/中继限制。

---

## 最快拿到可安装的 `.apk`（推荐）

每次成功构建会刷新 soft Release：

**https://github.com/TimeRoulette/stock-workstation/releases/tag/android-debug-latest**

1. 打开上面链接 → **Assets** 里点 `stock-workstation-*-debug.apk`（扩展名必须是 **`.apk`**）
2. 手机：**设置 → 应用 → 特殊权限 / 安装未知应用** → 允许你用来下载的浏览器或「文件」应用
3. 用文件管理器打开刚下的 `.apk` → **安装**
4. 若出现「未知来源 / Play 保护机制」警告：选 **仍要安装**（debug 签名包常见，不是商店正式包）
5. 覆盖安装：使用同一 debug 签名的新包可直接覆盖旧版，本地 sql.js 数据一般保留（仍建议设置里先备份）

> 固定入口以后可收藏 soft tag；每次 Actions 成功会覆盖同名 Release 里的 APK。

---

## 从 GitHub Actions Artifact 下载（容易踩坑）

1. 打开 [Actions → Build Android Debug APK](https://github.com/TimeRoulette/stock-workstation/actions/workflows/android-apk.yml)
2. 点进最近一次 **绿色成功** 的 run → 页面底部 **Artifacts**
3. 下载 `stock-workstation-debug-apk`
4. **重要：** 浏览器下到的是 **`.zip` 压缩包**（GitHub 固定行为），**不能**直接当 APK 打开。
5. 解压 zip → 得到 `stock-workstation-*-debug.apk`（或旧产物名 `app-debug.apk`）
6. 再按上一节「允许未知来源 → 安装」

### 「下载打开不了」常见原因

| 现象 | 原因 | 处理 |
|------|------|------|
| 点开下载文件提示无法解析 / 不是有效安装包 | 把 **artifact zip** 当成 APK 打开 | **先解压**，再装里面的 `.apk`；或改用 soft Release 直链 |
| 安装被拦截 / 灰色无法安装 | 未开「未知来源」或厂商拦截 debug 包 | 允许未知应用；关掉「纯净模式」后再试 |
| 能装但一点图标就闪退 | WebView / 网络 / 资源问题（较少见） | 先用 PWA 验证功能；清数据重装；看 logcat |
| 文件极小或 0 字节 | 下载中断或下错文件 | 重新下；确认体积约数 MB |
| 提示签名冲突无法覆盖 | 换过签名或装过不同包名 | 卸载旧包再装（会清数据；先备份） |

配置见 `.github/workflows/android-apk.yml`（安装 `platforms;android-34` 等，避免已下架的 `tools` 包）。

若 Actions 失败：打开该次 run 日志；常见原因是 SDK 组件名变更或 Capacitor/Gradle 版本不匹配，可按日志改 workflow 后 `workflow_dispatch` 重跑。

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

本 CI/开发 box 若未装 SDK，则**无法在本地打出正式/debug APK**；请用上方 Actions / soft Release。

### 在线壳 vs 离线 assets

- **离线**：`capacitor.config.ts` 的 `webDir: 'dist'`，`cap sync` 把构建产物打进 APK（推荐自用；当前 CI 即此模式）。
- **在线**：设置 `server.url` 为 Pages 地址（类似 TWA）；APK 只是浏览器壳，需联网，且受站点可用性影响。

检查更新始终拉取 **Pages 上的** `app-update.json`（不依赖 APK 内置的可能过期副本）。

---

## 与 Bubblewrap / TWA

Google Bubblewrap 也可把 PWA 打成 TWA APK。本仓库优先 Capacitor，因与现有 Vite `dist` 同步路径更直接。若你更熟 Bubblewrap，可对同一 Pages URL 自行 `bubblewrap init`；原理等价「系统 WebView 打开站点」。

---

## 明确不做

- Electron → Android
- 未授权券商 App 打包/爬取
- 商店上架与正式 release 签名流程（可自行用 keystore 扩展）
- 强制更新 / 静默升级 / 假装网页能升成 APK
