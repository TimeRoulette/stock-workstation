import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/app.css'
import { claimSingleInstance, registerServiceWorker } from './utils/singleInstance'

// PWA + 命名窗口 / 多标签检测（尽最大努力，无法 100% 强制合并外链打开的标签）
const instance = claimSingleInstance()
void registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App instanceRole={instance.role} tryFocusPrimary={instance.tryFocusPrimary} />
  </StrictMode>,
)
