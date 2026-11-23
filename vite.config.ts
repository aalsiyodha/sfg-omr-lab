import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

function localGitSha(): string {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 2000 }).trim() }
  catch { return 'unknown' }
}
function localDirty(): boolean {
  try { return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', timeout: 2000 }).trim().length > 0 }
  catch { return false }
}

export default defineConfig(({ command }) => {
  const isVercel = Boolean(process.env.VERCEL)
  const source = isVercel ? 'vercel' : command === 'serve' ? 'local-dev' : 'local-build'
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || localGitSha()
  const environment = isVercel ? (process.env.VERCEL_ENV || 'unknown') : command === 'serve' ? 'development' : 'local-preview'
  // Vite substitutes these literals at build time; never rely on the user-visible app
  // version alone to distinguish older deployed bundles from newer GitHub commits.
  const identity = {
    version, source, environment,
    sha, buildId: sha === 'unknown' ? 'unknown' : sha.slice(0, 7),
    builtAt: new Date().toISOString(),
    dirty: !isVercel && localDirty(),
  }
  return {
    // GitHub Pages serves this repository under /sfg-omr-lab/, not /.
    base: process.env.GITHUB_PAGES === 'true' ? (process.env.GITHUB_PAGES_BASE || '/sfg-omr-lab/') : '/',
    plugins: [
      react(),
      { name: 'app-version-html', transformIndexHtml: html => html.replaceAll('__APP_VERSION__', `v${version}`) },
    ],
    define: {
      __APP_BUILD_ID__: JSON.stringify(identity.buildId),
      __APP_BUILD_META__: JSON.stringify(identity),
    },
    server: { host: true, allowedHosts: true },
  }
})
