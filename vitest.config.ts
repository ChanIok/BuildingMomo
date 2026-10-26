import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 独立配置，不复用 vite.config.ts：PWA 插件会在测试时生成 manifest / service worker。
// Vue 组件直接由测试运行器编译，不在测试中另建 Vite 服务器。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    dedupe: ['vue', 'three', 'three-mesh-bvh'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
