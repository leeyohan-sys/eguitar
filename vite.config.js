import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages: https://leeyohan-sys.github.io/eguitar/
export default defineConfig({
  base: '/eguitar/',
  plugins: [react(), tailwindcss()],
})
