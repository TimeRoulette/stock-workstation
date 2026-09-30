import type { AndroidUpdateMeta } from '../services/appUpdate'
import { openApkDownload } from '../services/appUpdate'
import { Icons } from './Icon'

interface Props {
  latestVersion: string
  currentVersion: string
  meta?: AndroidUpdateMeta
  /** android | web：文案略有不同 */
  context?: 'android' | 'web'
  onDismiss: () => void
  onOpenSettings?: () => void
}

export function UpdateBanner({
  latestVersion,
  currentVersion,
  meta,
  context = 'android',
  onDismiss,
  onOpenSettings,
}: Props) {
  const lines = (meta?.changelog || []).slice(0, 3)

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-main">
        <strong>
          {context === 'android' ? '安卓有新版本' : '安卓 APK 有新版本'}
        </strong>
        <span className="muted">
          v{latestVersion}
          {currentVersion ? `（当前 v${currentVersion}）` : ''}
        </span>
        {lines.length > 0 && (
          <ul className="update-banner-log">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {context === 'web' && (
          <p className="muted update-banner-hint">网页不能自动变成 APK；点下载获取安装包。</p>
        )}
      </div>
      <div className="update-banner-actions">
        {meta?.apkUrl && (
          <button
            type="button"
            className="btn btn-xs primary"
            onClick={() => {
              void openApkDownload(meta.apkUrl)
            }}
          >
            <Icons.download /> 下载 APK
          </button>
        )}
        {onOpenSettings && (
          <button type="button" className="btn btn-xs" onClick={onOpenSettings}>
            详情
          </button>
        )}
        <button type="button" className="btn btn-xs" onClick={onDismiss} aria-label="关闭">
          <Icons.close />
        </button>
      </div>
    </div>
  )
}
