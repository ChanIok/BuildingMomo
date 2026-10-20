import { defineConfig, loadEnv, normalizePath, searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { templateCompilerOptions } from '@tresjs/core'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Config-only variable in ignored .env.local; never exposed to client code.
  const localRender = loadEnv(mode, process.cwd(), 'NUAN5_').NUAN5_RENDER_SOURCE
  const renderSource = localRender ? resolve(localRender, 'src') : null
  const isRenderModule = (id: string) =>
    id.includes('/node_modules/@nuan5-pro/render/') ||
    (renderSource !== null && id.startsWith(`${normalizePath(renderSource)}/`))

  // 默认使用根路径，如果设置了 VITE_BASE_PATH 环境变量则使用该路径
  const base = process.env.VITE_BASE_PATH || '/'
  const cloudApiProxyTarget = process.env.VITE_CLOUD_API_PROXY_TARGET || 'http://127.0.0.1:8788'
  const buildInfo = {
    commit: execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
    }).trim(),
    time: new Date().toISOString(),
  }

  return {
    define: {
      __BUILD_INFO__: JSON.stringify(buildInfo),
    },
    plugins: [
      vue({
        // TresJS 模板编译器配置，让 Vue 识别 Tres 组件
        ...templateCompilerOptions,
      }),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          // 禁用默认的 navigation fallback（否则 /en/ 可能会被错误回退到 /index.html）
          navigateFallback: null,
          // 运行时缓存：访问时才缓存
          runtimeCaching: [
            {
              // HTML 页面导航
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'html-pages',
              },
            },
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
              // 字体文件：缓存优先
              urlPattern: /\.(?:woff2?|ttf|otf|eot)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'fonts',
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 1 年
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
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 天
                },
              },
            },
            {
              // 3D 模型：内容 hash 位于查询参数中，按版本 URL 长期缓存
              urlPattern: ({ url }) => url.pathname.endsWith('.glb'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'model-assets',
              },
            },
            {
              // 带 Hash 的材质打包
              urlPattern: ({ url }) => url.pathname.startsWith('/assets/furniture-v2/textures/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'model-textures',
                cacheableResponse: {
                  statuses: [200],
                },
              },
            },
            {
              // 先获取当前目录，避免版本更新后继续引用已下线的资源。
              urlPattern: ({ url }) => url.pathname.endsWith('/assets/furniture-v2/manifest.json'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'furniture-catalog',
                cacheableResponse: {
                  statuses: [200],
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
    optimizeDeps: {
      // 保留渲染库源码中的 Worker 相对路径，交由 Vite 正常转换。
      exclude: ['@nuan5-pro/render', '@nuan5-pro/render/furniture'],
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        ...(renderSource
          ? {
              '@nuan5-pro/render/furniture': resolve(renderSource, 'furniture/index.ts'),
              '@nuan5-pro/render': resolve(renderSource, 'index.ts'),
            }
          : {}),
      },
      // 强制使用单一 Three.js 实例，避免多版本冲突
      dedupe: ['three', 'three-mesh-bvh'],
    },
    build: {
      rollupOptions: {
        treeshake: {
          moduleSideEffects(id) {
            const normalized = normalizePath(id)
            // This entry only re-exports functions/types. Let unused re-export
            // branches stay lazy; keep default side-effect handling everywhere else.
            // tests/scripts/renderTreeShaking.spec.ts checks this on dependency upgrades.
            if (isRenderModule(normalized) && normalized.endsWith('/furniture/index.ts')) {
              return false
            }
          },
        },
        output: {
          advancedChunks: {
            // Rolldown groups recursively capture dependencies. Assign foundations
            // first so Vue stays independent of TresJS and Three stays shared.
            groups: [
              {
                name: 'vue-vendor',
                test: /\/node_modules\/(?:@vue\/|vue\/|pinia\/|@vueuse\/)/,
                priority: 100,
              },
              { name: 'three-core', test: /\/node_modules\/three\//, priority: 90 },
              { name: 'three-bvh', test: /\/node_modules\/three-mesh-bvh\//, priority: 80 },
              {
                name: 'furniture-catalog',
                test: (id) => isRenderModule(id) && id.endsWith('/furniture/manifest.ts'),
                priority: 75,
              },
              { name: 'furniture-render', test: isRenderModule, priority: 70 },
              { name: 'tresjs', test: /\/node_modules\/@tresjs\//, priority: 60 },
              {
                name: 'ui-vendor',
                test: /\/node_modules\/(?:reka-ui|lucide-vue-next|vue-sonner)\//,
                priority: 50,
              },
              {
                name: 'css-utils',
                test: /\/node_modules\/(?:clsx|tailwind-merge|class-variance-authority)\//,
                priority: 40,
              },
            ],
            // Capture catalog dependencies before renderer code, keeping the eager
            // metadata entry independent of the lazy furniture-render chunk.
          },
        },
      },
    },
    server: {
      // Render assets publish in bulk; refresh explicitly after generation.
      watch: { ignored: ['**/public/assets/furniture-v2/**'] },
      ...(renderSource
        ? {
            fs: { allow: [searchForWorkspaceRoot(process.cwd()), renderSource] },
          }
        : {}),
      // 本地联调：另开 `npm run dev:cloudflare-functions`（wrangler pages dev，默认 8788）。
      // 将 /api 全部转发到 Pages Functions，否则仅 Vite 时 /api/login、/api/cloud-schemes 会 404。
      proxy: {
        '/api': {
          target: cloudApiProxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
