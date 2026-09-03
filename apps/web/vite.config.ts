import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Package BK: stamp the build with the commit it came from.
//
// This exists because answering "what is actually deployed?" took a session's
// worth of archaeology -- fetching the production bundle and grepping it for
// strings that only exist after a given commit. With this baked in, the same
// question is a five-second check: the commit is printed in the crash screen's
// Details panel and sent with every client error report.
//
// Railway builds from a git checkout, but a shallow/detached one can still
// fail `git rev-parse`, and a tarball build has no git at all -- so this
// never throws: an unknown commit is reported as "unknown" rather than
// breaking the build.
function gitCommit(): string {
  const fromEnv =
    process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT
  if (fromEnv) return fromEnv.slice(0, 12)
  try {
    return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_COMMIT__: JSON.stringify(gitCommit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
})
