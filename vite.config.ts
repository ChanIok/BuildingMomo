import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // 生产环境（部署到 GitHub Pages）使用仓库路径
  // 开发环境和其他情况使用根路径
  const base =
    command === 'build' && mode === 'production'
      ? process.env.VITE_BASE_PATH || '/BuildingMomo/'
      : '/'

  return {
    plugins: [vue(), tailwindcss()],
    base,
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
