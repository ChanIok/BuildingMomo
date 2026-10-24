import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia } from 'pinia'

const server = await createServer({
  configFile: false,
  plugins: [
    {
      name: 'canvas-panel-fixtures',
      enforce: 'pre',
      // 这些无关工具会引入仅浏览器可用的 Worker 和模型资源。
      resolveId(source) {
        if (/(?:^|[\\/])DebugPanel\.vue$/.test(source)) return '\0test:debug'
        if (/(?:^|[\\/])commandStore(?:\.ts)?$/.test(source)) return '\0test:commands'
      },
      load(id) {
        if (id === '\0test:debug') return 'export default { render: () => null }'
        if (id === '\0test:commands')
          return 'export const useCommandStore = () => ({ showFurnitureLibrary: false, showDyePanel: false, executeCommand() {} })'
      },
    },
    vue(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
    dedupe: ['vue'],
  },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  appType: 'custom',
})

beforeAll(async () => {
  // 组件编译属于测试准备，避免完整回归时挤占首个交互测试的超时时间。
  await server.ssrLoadModule('/src/components/EditorLayout.vue')
})

afterAll(async () => {
  await server.close()
  vi.unstubAllGlobals()
})

it('keeps viewport layout markup identical when groups open and close', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: EditorLayout } = await server.ssrLoadModule('/src/components/EditorLayout.vue')
  const { useUIStore } = await server.ssrLoadModule('/src/stores/uiStore.ts')
  let ui: any
  const app = createSSRApp({
    setup() {
      ui = useUIStore()
      return () =>
        h(
          EditorLayout,
          { editing: true },
          {
            default: () => h('canvas'),
            sidebar: () => h('aside'),
          }
        )
    },
  })
  app.use(createPinia())
  const original = await renderToString(app)
  expect(original).toContain('<canvas>')
  expect(original).toContain('<aside>')
  for (const open of [true, false]) {
    ui.groupPanelOpen = open
    expect(await renderToString(app)).toBe(original)
  }
  ui.sidebarCollapsed = true
  expect(await renderToString(app)).not.toBe(original)
})

it.each([false, true])(
  'renders a non-modal overlay with its toggle last in CanvasToolbar (open: %s)',
  async (open) => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    const { default: Overlays } = await server.ssrLoadModule(
      '/src/components/ThreeEditorOverlays.vue'
    )
    const { useUIStore } = await server.ssrLoadModule('/src/stores/uiStore.ts')
    const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
    const app = createSSRApp({
      setup() {
        useEditorStore().createScheme('overlay')
        const ui = useUIStore()
        ui.groupPanelOpen = open
        ui.updateEditorContainerRect({ left: 8, top: 80, width: 960, height: 800 })
        return () =>
          h(Overlays, {
            contextMenu: { open: false, x: 0, y: 0 },
            tooltip: { visible: false, data: null },
            selection: { rect: null, lasso: [] },
            viewInfo: {
              isOrthographic: false,
              controlMode: 'orbit',
              currentViewPreset: 'perspective',
            },
            commandStore: {
              showFurnitureLibrary: false,
              showDyePanel: false,
              commandMap: new Map([]),
              isCommandEnabled: () => false,
              executeCommand: vi.fn(),
            },
          })
      },
    })
    app.use(createPinia())
    const html = await renderToString(app)
    const panel = html.match(/<div\b[^>]*id="canvas-group-panel"[^>]*>/)?.[0]
    expect(panel).toBeDefined()
    expect(panel?.includes('display:none')).toBe(!open)
    const toggles = html.match(/<button\b[^>]*data-slot="toggle"[^>]*>/g)!
    const trigger = toggles.at(-1)
    expect(trigger).toContain('data-group-panel-toggle')
    expect(trigger).toContain(`aria-expanded="${open}"`)
    expect(trigger).toContain('aria-controls="canvas-group-panel"')
    expect(trigger).toContain('aria-keyshortcuts="O"')
    expect(trigger).toContain('aria-label="组面板"')
    expect(html.match(/data-group-panel-toggle/g)).toHaveLength(1)
    expect(html).not.toContain('aria-modal="true"')
    expect(html).not.toContain('dialog-overlay')
  }
)

it('renders the four selection categories without loaded furniture metadata', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: SelectionSettings } = await server.ssrLoadModule(
    '/src/components/SidebarSelectionSettings.vue'
  )
  const { TooltipProvider } = await server.ssrLoadModule('/src/components/ui/tooltip/index.ts')
  const app = createSSRApp({
    render: () => h(TooltipProvider, null, () => h(SelectionSettings)),
  })
  app.use(createPinia())
  const html = await renderToString(app)
  for (const name of ['家具', '结构', '山石', '地形']) {
    expect(html).toContain(`>${name}</span>`)
  }
  expect(html.match(/role="checkbox"/g)).toHaveLength(4)
})
