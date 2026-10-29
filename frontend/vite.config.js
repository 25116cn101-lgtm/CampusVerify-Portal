import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8000'
  return { plugins: [react()], server: { host: '0.0.0.0', proxy: { '/api': target, '/ws': { target: target.replace('http', 'ws'), ws: true } } } }
})
