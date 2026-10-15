import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { pdfAssets } from './build/pdfAssets.ts'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss(), pdfAssets()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
