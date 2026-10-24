import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { prNumberFrom } from './src/lib/buildInfo.js'

// The pull request this build came from (src/lib/buildInfo.js), shown on
// the admin page. Vercel's system variables, or the last commit locally.
function lastCommitMessage() {
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE) return process.env.VERCEL_GIT_COMMIT_MESSAGE
  try { return execSync('git log -1 --format=%s', { stdio: ['ignore', 'pipe', 'ignore'] }).toString() } catch { return '' }
}
const prNumber = prNumberFrom({ prId: process.env.VERCEL_GIT_PULL_REQUEST_ID, message: lastCommitMessage() })

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_PR_NUMBER': JSON.stringify(prNumber) },
  build: {
    rolldownOptions: {
      output: {
        // React in its own file: it changes far less often than the app, so
        // returning visitors keep it cached across deploys.
        advancedChunks: {
          groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
        },
      },
    },
  },
})
