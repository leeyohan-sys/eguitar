import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 배포 빌드만 /eguitar/ base, 로컬 개발은 /
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/eguitar/' : '/',
  plugins: [react(), tailwindcss()],
}))
