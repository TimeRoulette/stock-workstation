#!/usr/bin/env node
/**
 * 写入 / 刷新 public/app-update.json（供 CI 在 APK soft Release 发布后调用）
 * 用法：
 *   node scripts/write-app-update.mjs
 *   VERSION=0.12.1 PUBLISHED_AT=... CHANGELOG_LINES=$'a\nb' node scripts/write-app-update.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = process.env.VERSION || pkg.version
const publishedAt = process.env.PUBLISHED_AT || new Date().toISOString()
const apkName = `stock-workstation-${version}-debug.apk`
const apkUrl =
  process.env.APK_URL ||
  `https://github.com/TimeRoulette/stock-workstation/releases/download/android-debug-latest/${apkName}`
const releasePage =
  process.env.RELEASE_PAGE ||
  'https://github.com/TimeRoulette/stock-workstation/releases/tag/android-debug-latest'

let changelog = []
if (process.env.CHANGELOG_LINES) {
  changelog = String(process.env.CHANGELOG_LINES)
    .split(/\r?\n/)
    .map((s) => s.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
} else {
  try {
    const log = execSync('git log -8 --pretty=format:%s', { cwd: root, encoding: 'utf8' })
    changelog = log
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8)
  } catch {
    changelog = [`v${version}`]
  }
}

const out = {
  android: {
    latestVersion: version,
    minVersion: '0.11.0',
    apkUrl,
    releasePage,
    publishedAt,
    changelog,
  },
}

const dest = path.join(root, 'public', 'app-update.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n')
console.log('Wrote', dest)
console.log(JSON.stringify(out, null, 2))
