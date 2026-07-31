import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this repository at /robo/. Local development and
  // custom-domain builds stay rooted at /.
  base: process.env.GITHUB_ACTIONS ? '/robo/' : '/',
  plugins: [react()],
})
