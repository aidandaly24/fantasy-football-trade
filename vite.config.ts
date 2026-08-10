import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sites } from './build/sites-vite-plugin.ts'

export default defineConfig({
  plugins: [react(), sites(), cloudflare({ viteEnvironment: { name: 'server' } })],
})
