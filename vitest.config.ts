import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// 独立配置，不复用 vite.config.ts：PWA 插件会在测试时生成 manifest / service worker。
// 只保留与生产一致的模块解析，其余插件一律不加。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    dedupe: ['three'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
