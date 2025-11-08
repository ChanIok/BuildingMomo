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
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // Vue 核心库
            if (id.includes('node_modules/vue/') || 
                id.includes('node_modules/pinia/') || 
                id.includes('node_modules/@vueuse/')) {
              return 'vue-vendor'
            }
            // Konva 图形库
            if (id.includes('node_modules/konva/') || 
                id.includes('node_modules/vue-konva/')) {
              return 'konva'
            }
            // UI 组件库
            if (id.includes('node_modules/reka-ui/') || 
                id.includes('node_modules/lucide-vue-next/') || 
                id.includes('node_modules/vue-sonner/')) {
              return 'ui-vendor'
            }
            // CSS 工具库
            if (id.includes('node_modules/clsx/') || 
                id.includes('node_modules/tailwind-merge/') || 
                id.includes('node_modules/class-variance-authority/')) {
              return 'css-utils'
            }
          },
        },
      },
    },
  }
})
