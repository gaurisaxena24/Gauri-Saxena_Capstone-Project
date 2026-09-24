import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type ProxyOptions } from 'vite'

// Where the dev server sends /api and /uploads. Defaults to a local backend on :4000. Set
// API_TARGET to try the frontend against another backend, e.g. the deployed one:
//   API_TARGET=https://gauri-saxenacapstone-project-production.up.railway.app npm run dev
// (that uses REAL data — buttons really send reminders / mark debts paid).
const apiTarget = process.env.API_TARGET || 'http://localhost:4000'
const proxyTo: ProxyOptions = {
  target: apiTarget,
  changeOrigin: true,
  secure: true,
  // The deployed backend marks its session cookie Secure; http://localhost isn't HTTPS, so some
  // browsers (Safari) drop it and the login never sticks. Dev-only: strip Secure on the way back.
  configure: (proxy) => {
    proxy.on('proxyRes', (proxyRes) => {
      const cookies = proxyRes.headers['set-cookie']
      if (cookies) proxyRes.headers['set-cookie'] = cookies.map((c: string) => c.replace(/;\s*Secure/gi, ''))
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': proxyTo,
      '/uploads': proxyTo,
    },
  },
})
