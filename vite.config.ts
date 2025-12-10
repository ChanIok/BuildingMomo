import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { templateCompilerOptions } from '@tresjs/core'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(() => {
  // 默认使用根路径，如果设置了 VITE_BASE_PATH 环境变量则使用该路径
  const base = process.env.VITE_BASE_PATH || '/'

  return {
    plugins: [
      vue({
        // TresJS 模板编译器配置，让 Vue 识别 Tres 组件
        ...templateCompilerOptions,
      }),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          globPatterns: ['index.html'],
          // 运行时缓存：访问时才缓存
          runtimeCaching: [
            {
              // JS/CSS：缓存优先（带 hash，内容不变）
              urlPattern: /\.(?:js|css)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'static-assets',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 天
                },
              },
            },
            {
              // 图片资源：缓存优先
              urlPattern: /\.(?:png|svg|ico|webp)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'images',
                expiration: {
                  maxEntries: 500,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 天
                },
              },
            },
            {
              // JSON 数据：边用边更新（数据可能更新）
              urlPattern: /\.json$/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'data-cache',
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 7, // 7 天
                },
              },
            },
          ],
        },
        manifest: {
          name: 'BuildingMomo',
          short_name: 'BuildingMomo',
          description: 'Infinity Nikki Home Visual Editor',
          theme_color: '#ffffff',
          start_url: './',
          display: 'standalone',
          background_color: '#ffffff',
          icons: [
            {
              src: 'logo.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'logo.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    base,
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      // 强制使用单一 Three.js 实例，避免多版本冲突
      dedupe: ['three'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // Vue 核心库
            if (
              id.includes('node_modules/vue/') ||
              id.includes('node_modules/pinia/') ||
              id.includes('node_modules/@vueuse/')
            ) {
              return 'vue-vendor'
            }
            // Konva 图形库
            if (id.includes('node_modules/konva/') || id.includes('node_modules/vue-konva/')) {
              return 'konva'
            }
            // TresJS 核心和cientos
            if (
              id.includes('node_modules/@tresjs/core/') ||
              id.includes('node_modules/@tresjs/cientos/')
            ) {
              return 'tresjs'
            }
            // Three.js 核心库
            if (id.includes('node_modules/three/')) {
              return 'three-core'
            }
            // UI 组件库
            if (
              id.includes('node_modules/reka-ui/') ||
              id.includes('node_modules/lucide-vue-next/') ||
              id.includes('node_modules/vue-sonner/')
            ) {
              return 'ui-vendor'
            }
            // CSS 工具库
            if (
              id.includes('node_modules/clsx/') ||
              id.includes('node_modules/tailwind-merge/') ||
              id.includes('node_modules/class-variance-authority/')
            ) {
              return 'css-utils'
            }
          },
        },
      },
    },
  }
})
