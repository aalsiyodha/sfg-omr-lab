import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// The package release version is the only manually maintained version number.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
// Vercel and GitHub supply a new commit SHA for each deployment. This makes
// builds distinguishable even if the semantic release version stays the same.
const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'local'
const buildId = commit === 'local' ? 'local' : commit.slice(0, 7)

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'app-version-html',
      transformIndexHtml: html => html.replaceAll('__APP_VERSION__', `v${version}`),
    },
  ],
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    host: true,
    allowedHosts: true,
  },
})
