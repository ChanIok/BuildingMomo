import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import {
  createRenderer,
  createSSRApp,
  h,
  nextTick,
  shallowReactive,
  ssrContextKey,
  watch,
} from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia } from 'pinia'
import { makeAppItem, setGroupNames } from '../fixtures/item'

const server = await createServer({
  configFile: false,
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
    dedupe: ['vue'],
  },
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: 'custom',
})
afterAll(async () => {
  await server.close()
  vi.unstubAllGlobals()
})
// 单文件组件及依赖的编译属于测试准备，不计入行渲染耗时。
beforeAll(async () => {
  await server.ssrLoadModule('/src/components/GroupPanel.vue')
})

it('delegates delayed hints and keeps clicked controls dismissed until re-entry', async () => {
  const { default: GroupPanelHints } = await server.ssrLoadModule(
    '/src/components/GroupPanelHints.vue'
  )
  const container = Object.assign(new EventTarget(), { contains: () => true })
  const props = shallowReactive({ container, active: true, rows: [] })
  let hints: any
  const { createApp } = createRenderer<object, object>({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert: () => {},
    remove: () => {},
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
    patchProp: () => {},
  })
  const app = createApp({
    setup() {
      hints = GroupPanelHints.setup(props, { expose: () => {} })
      return () => h('div')
    },
  })
  app.provide(ssrContextKey, { modules: new Set() })
  const button = { getAttribute: () => '隐藏「墙」' }
  const control: any = {
    closest: () => control,
    querySelector: () => button,
    getAttribute: () => '',
    matches: () => true,
  }
  const count: any = { closest: () => count, getAttribute: () => '已选 1 / 2 件' }
  const fire = (type: string, target = control, extra = {}) => {
    const event = new Event(type)
    for (const [key, value] of Object.entries({
      target,
      relatedTarget: null,
      pointerType: 'mouse',
      buttons: 0,
      ...extra,
    })) {
      Object.defineProperty(event, key, { value })
    }
    container.dispatchEvent(event)
  }
  vi.useFakeTimers()
  app.mount({})
  try {
    await nextTick()
    fire('pointerover')
    vi.advanceTimersByTime(499)
    expect(hints.visible.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(hints.visible.value).toBe(true)
    expect(hints.text.value).toBe('隐藏「墙」')
    fire('pointerdown')
    fire('focusin')
    fire('click')
    fire('pointerover')
    vi.advanceTimersByTime(1000)
    expect(hints.target.value).toBeNull()
    expect(hints.visible.value).toBe(false)
    fire('pointerout')
    fire('pointerover')
    vi.advanceTimersByTime(500)
    expect(hints.visible.value).toBe(true)
    fire('scroll')
    expect(hints.target.value).toBeNull()
    fire('pointerover', count)
    vi.advanceTimersByTime(500)
    expect(hints.text.value).toBe('已选 1 / 2 件')
    fire('pointerout', count)
    fire('focusin')
    expect(hints.visible.value).toBe(true)
    fire('focusout')
    fire('pointerover', control, { pointerType: 'touch' })
    vi.advanceTimersByTime(500)
    expect(hints.visible.value).toBe(false)
    fire('pointerover')
    props.active = false
    await nextTick()
    vi.advanceTimersByTime(500)
    expect(hints.target.value).toBeNull()
    expect(hints.visible.value).toBe(false)
    props.active = true
    await nextTick()
    fire('pointerover')
  } finally {
    app.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  }
})

it('renders named groups and a hidden summary without listing furniture members', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
  const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
  const app = createSSRApp({
    setup() {
      const store = useEditorStore()
      store.createScheme('render')
      const scheme = store.activeScheme!
      scheme.items.value = [
        makeAppItem({ internalId: 'member-a', groupId: 7 }),
        makeAppItem({ internalId: 'member-b', groupId: 7 }),
        makeAppItem({ internalId: 'member-c', groupId: 8 }),
      ]
      setGroupNames(scheme, [
        [7, '二楼的墙'],
        [8, '屋顶'],
      ])
      store.setGroupHidden(7, true)
      store.setGroupLocked(8, true)
      return () => h(GroupPanel)
    },
  })
  app.use(createPinia())
  const html = await renderToString(app)
  expect(html.match(/data-group-id=/g)).toHaveLength(2)
  expect(html).toContain('二楼的墙')
  expect(html).toContain('屋顶')
  expect(html).toContain('2 件家具已隐藏')
  expect(html).toContain('全部显示')
  expect(html).toContain('搜索集合或组名')
  expect(html).not.toContain('member-a')
})

it.each([false, true])(
  'renders ungrouped-only furniture instead of the empty state (hidden: %s)',
  async (hidden) => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
    const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
    const app = createSSRApp({
      setup() {
        const store = useEditorStore()
        store.createScheme('ungrouped only')
        store.activeScheme!.items.value = [
          makeAppItem({ internalId: 'loose-a' }),
          makeAppItem({ internalId: 'loose-b' }),
        ]
        if (hidden) store.setGroupHidden(0, true)
        return () => h(GroupPanel)
      },
    })
    app.use(createPinia())
    const html = await renderToString(app)
    expect(html.match(/<li\b/g)).toHaveLength(1)
    expect(html).toContain('data-ungrouped="true"')
    expect(html).toContain('2 件家具')
    expect(html).toContain(hidden ? '显示“未分组”' : '隐藏“未分组”')
    expect(html).not.toContain('还没有组')
    expect(html).not.toContain('data-group-id="0"')
    expect(html).toContain('锁定“未分组”')
  }
)

it('renders canvas selection states independently of the active row', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
  const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
  const app = createSSRApp({
    setup() {
      const store = useEditorStore()
      store.createScheme('compact')
      const scheme = store.activeScheme!
      scheme.items.value = [
        makeAppItem({ internalId: 'full', groupId: 1 }),
        makeAppItem({ internalId: 'partial-a', groupId: 2 }),
        makeAppItem({ internalId: 'partial-b', groupId: 2 }),
        makeAppItem({ internalId: 'active', groupId: 3 }),
        makeAppItem({ internalId: 'idle', groupId: 4 }),
      ]
      scheme.selectedItemIds.value = new Set(['full', 'partial-a'])
      scheme.activeGroupId.value = 3
      scheme.collectionTree.value = {
        nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
        groups: [{ groupId: 1, collectionId: 'house', order: 0 }],
      }
      return () => h(GroupPanel)
    },
  })
  app.use(createPinia())
  const html = await renderToString(app)
  const rows = [...html.matchAll(/<li\b[^>]*data-group-id="(\d+)"[^>]*>/g)]
  expect(rows).toHaveLength(4)
  for (const [row, id] of rows) {
    const state = id === '1' ? 'full' : id === '2' ? 'partial' : 'none'
    expect(row).toContain(`data-selection="${state}"`)
    expect(row).toContain(`aria-selected="${state === 'full'}"`)
  }
  const parent = html.match(/<li\b[^>]*data-collection-id="house"[^>]*>/)?.[0]
  expect(parent).toContain('data-selection="full"')
  expect(parent).toContain('aria-selected="false"')
  expect(html).toContain('aria-current="true"')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('部分家具已选中')
  expect(html).toContain('aria-multiselectable="true"')
  for (const [row] of html.matchAll(/<li\b[\s\S]*?<\/li>/g)) {
    const selected = row.match(/^<li\b[^>]*aria-selected="true"/)
    expect(row.includes('data-group-deselect')).toBe(!!selected)
  }
  expect(html).toContain('取消选中「组 1」')
  expect(html).toContain('data-group-hint="已选 1 / 2 件"')
})

it.each([false, true])(
  'renders the collection hierarchy and inherited controls (collapsed: %s)',
  async (collapsed) => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
    const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
    const app = createSSRApp({
      setup() {
        const store = useEditorStore()
        store.createScheme('tree')
        const scheme = store.activeScheme!
        scheme.items.value = [
          makeAppItem({ internalId: 'a', groupId: 7 }),
          makeAppItem({ internalId: 'b', groupId: 8 }),
        ]
        scheme.collectionTree.value = {
          nodes: [
            { id: 'house', name: 'House', parentId: null, order: 0 },
            { id: 'floor', name: 'Floor', parentId: 'house', order: 0 },
          ],
          groups: [
            { groupId: 7, collectionId: 'floor', order: 0 },
            { groupId: 8, collectionId: 'house', order: 0 },
          ],
        }
        store.setCollectionRestriction('house', 'hidden', true)
        store.setCollectionRestriction('house', 'locked', true)
        if (collapsed) scheme.collapsedCollectionIds.value = new Set(['house'])
        return () => h(GroupPanel)
      },
    })
    app.use(createPinia())
    const html = await renderToString(app)
    expect(html).toContain('role="tree"')
    expect(html).toContain('全部折叠')
    expect(html).toContain('2 件家具已隐藏')
    expect(html.match(/data-collection-id=/g)).toHaveLength(collapsed ? 1 : 2)
    expect(html.match(/data-group-id=/g) ?? []).toHaveLength(collapsed ? 0 : 2)
    if (!collapsed) {
      expect(html).toContain('由集合「House」隐藏')
      expect(html).toContain('由集合「House」锁定')
      expect(html).toContain('aria-level="3"')
      expect(html).toContain('Alt + 点击仅显示此项')
    }
    expect(html).toContain(collapsed ? '展开集合「House」' : '折叠集合「House」')
  }
)

it.each(['house', 'floor', '@unclassified', null])(
  'follows canvas selection only if its group row is visible (collapsed ancestor: %s)',
  async (collapsedId) => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
    const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
    const { useUIStore } = await server.ssrLoadModule('/src/stores/uiStore.ts')
    let scheme: any
    const collapsed = new Set(collapsedId ? [collapsedId] : [])
    const app = createSSRApp({
      setup() {
        useUIStore().groupPanelOpen = true
        const store = useEditorStore()
        store.createScheme('silent selection')
        scheme = store.activeScheme!
        scheme.items.value = [makeAppItem({ internalId: 'selected', groupId: 7 })]
        scheme.collectionTree.value = {
          nodes: [
            { id: 'house', name: 'House', parentId: null, order: 0 },
            { id: 'floor', name: 'Floor', parentId: 'house', order: 0 },
          ],
          groups: [
            {
              groupId: 7,
              collectionId: collapsedId === '@unclassified' ? null : 'floor',
              order: 0,
            },
          ],
        }
        scheme.collapsedCollectionIds.value = collapsed
        scheme.activeCollectionId.value = 'house'
        // 面板的实际选择监听器接收与画布点击相同的选择状态；
        // 对隐藏行应提前返回，不激活也不滚动。
        scheme.selectedItemIds.value = new Set(['selected'])
        return () => h(GroupPanel)
      },
    })
    app.use(createPinia())
    const html = await renderToString(app)
    expect(scheme.collapsedCollectionIds.value).toBe(collapsed)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['selected']))
    expect(scheme.activeCollectionId.value).toBe(collapsedId ? 'house' : null)
    expect(scheme.activeGroupId.value).toBe(collapsedId ? null : 7)
    expect(html.includes('data-group-id="7"')).toBe(!collapsedId)
  }
)

it('deduplicates drag targets and changes only affected row props until drop', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
  const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
  let handlers: any, scheme: any
  // 使用客户端组件作用域：SSR 会禁用计算属性缓存，
  // 无法验证客户端更新所依赖的属性引用稳定性。
  const { createApp } = createRenderer<object, object>({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert: () => {},
    remove: () => {},
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
    patchProp: () => {},
  })
  const app = createApp({
    setup() {
      const store = useEditorStore()
      store.createScheme('drag performance')
      scheme = store.activeScheme!
      scheme.items.value = Array.from({ length: 3 }, (_, i) =>
        makeAppItem({ internalId: `item-${i}`, groupId: i + 1 })
      )
      handlers = GroupPanel.setup({}, { expose: () => {} })
      return () => h('div')
    },
  })
  app.use(createPinia())
  // 即使在客户端作用域中，ssrLoadModule 的组件包装仍会记录模块信息。
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({})
  const rows = handlers.rows.value
  const event = (clientY: number) => ({
    clientY,
    currentTarget: { getBoundingClientRect: () => ({ top: 100, height: 32 }) },
    dataTransfer: { setData: vi.fn(), dropEffect: 'none', effectAllowed: 'none' },
    preventDefault: vi.fn(),
  })
  const snapshot = () => rows.map((row: any) => handlers.rowProps(row))
  const changed = (before: Record<string, unknown>[]) =>
    rows
      .filter((row: any, index: number) =>
        Object.entries(handlers.rowProps(row)).some(
          ([key, value]) => !Object.is(value, before[index]![key])
        )
      )
      .map((row: any) => handlers.keyOf(row))
  const updates = vi.fn()
  const stop = watch(handlers.dropTarget, updates, { flush: 'sync' })
  try {
    const items = scheme.items.value,
      tree = scheme.collectionTree.value
    handlers.dragStart(event(104), rows[0])
    const initial = snapshot()
    handlers.dragOver(event(104), rows[1])
    expect(changed(initial)).toEqual(['group:2'])
    const firstTarget = handlers.dropTarget.value
    const unchanged = snapshot()
    for (let i = 0; i < 2; i++) {
      const repeated = event(104)
      handlers.dragOver(repeated, rows[1])
      expect(repeated.preventDefault).toHaveBeenCalledOnce()
      expect(repeated.dataTransfer.dropEffect).toBe('move')
    }
    expect(updates).toHaveBeenCalledTimes(1)
    expect(handlers.dropTarget.value).toBe(firstTarget)
    expect(changed(unchanged)).toEqual([])
    handlers.dragOver(event(104), rows[2])
    expect(changed(unchanged)).toEqual(['group:2', 'group:3'])
    const beforeEdge = snapshot()
    handlers.dragOver(event(128), rows[2])
    expect(changed(beforeEdge)).toEqual(['group:3'])
    expect(handlers.dropTarget.value.after).toBe(true)
    expect(scheme.collectionTree.value).toBe(tree)
    expect(scheme.history.value.transactionUndoStack).toHaveLength(0)
    handlers.drop(event(128))
    expect(handlers.dragged.value).toBeNull()
    expect(handlers.dropTarget.value).toBeNull()
    expect(scheme.items.value).toBe(items)
    expect(scheme.history.value.transactionUndoStack).toHaveLength(1)
    expect(handlers.rows.value.slice(0, 3).map((row: any) => row.id)).toEqual([2, 3, 1])
  } finally {
    stop()
    app.unmount()
  }
})

it('keeps inside-folder feedback stable and clears invalid/cyclic drag targets', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
  const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
  let handlers: any
  const app = createSSRApp({
    setup() {
      const store = useEditorStore()
      store.createScheme('drag validity')
      store.activeScheme!.items.value = [makeAppItem({ groupId: 7 })]
      store.activeScheme!.collectionTree.value = {
        nodes: [
          { id: 'house', name: 'House', parentId: null, order: 0 },
          { id: 'floor', name: 'Floor', parentId: 'house', order: 0 },
        ],
        groups: [],
      }
      handlers = GroupPanel.setup({}, { expose: () => {} })
      return () => h('div')
    },
  })
  app.use(createPinia())
  await renderToString(app)
  const rows = handlers.rows.value
  const house = rows.find((row: any) => row.id === 'house')
  const floor = rows.find((row: any) => row.id === 'floor')
  const group = rows.find((row: any) => row.kind === 'group')
  const event = (clientY: number) => ({
    clientY,
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 32 }) },
    preventDefault: vi.fn(),
  })
  handlers.dragStart(event(4), group)
  handlers.dragOver(event(4), house)
  const target = handlers.dropTarget.value
  handlers.dragOver(event(28), house)
  expect(handlers.dropTarget.value).toBe(target)
  expect(handlers.dropPosition(house)).toBe('inside')
  handlers.setDropTarget(null)
  expect(handlers.dropPosition(house)).toBeNull()
  handlers.dragStart(event(16), house)
  const invalid = event(16)
  handlers.dragOver(invalid, floor)
  expect(invalid.preventDefault).not.toHaveBeenCalled()
  expect(handlers.dropTarget.value).toBeNull()
})

it('renders a viewport-sized slice of a 500-group collection rather than all group components', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
  const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
  const app = createSSRApp({
    setup() {
      const store = useEditorStore()
      store.createScheme('large collection')
      store.activeScheme!.items.value = Array.from({ length: 500 }, (_, i) =>
        makeAppItem({ internalId: `item-${i}`, groupId: i + 1 })
      )
      store.activeScheme!.collectionTree.value = {
        nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
        groups: Array.from({ length: 500 }, (_, i) => ({
          groupId: i + 1,
          collectionId: 'house',
          order: i,
        })),
      }
      return () => h(GroupPanel)
    },
  })
  app.use(createPinia())
  const html = await renderToString(app)
  expect(html.match(/<li\b/g)!.length).toBeGreaterThan(0)
  expect(html.match(/<li\b/g)!.length).toBeLessThan(50)
  expect(html).toContain('height:16032px')
  expect(html).not.toContain('data-group-id="500"')
  expect(html.match(/data-slot="context-menu-trigger"/g)).toHaveLength(1)
  for (const [row] of html.matchAll(/<li\b[\s\S]*?<\/li>/g)) {
    expect(row).not.toContain('tooltip-trigger')
    expect(row).not.toContain('context-menu-trigger')
  }
})

it('navigates beyond the mounted slice and keeps rename, drag and menu rows alive', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
  const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
  let handlers: any
  const focus = vi.fn(),
    inputFocus = vi.fn(),
    select = vi.fn(),
    dispatchEvent = vi.fn()
  const viewport = {
    scrollTop: 0,
    scrollTo: vi.fn(),
    querySelectorAll: () =>
      handlers.virtualRows.value.map(({ row }: any) => ({
        dataset: { rowKey: handlers.keyOf(row) },
        focus,
        getBoundingClientRect: () => ({ left: 10, bottom: 120 }),
        dispatchEvent,
      })),
  }
  const { createApp } = createRenderer<object, object>({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert: () => {},
    remove: () => {},
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
    patchProp: () => {},
  })
  const app = createApp({
    setup() {
      const store = useEditorStore()
      store.createScheme('keyboard and editing')
      store.activeScheme!.items.value = Array.from({ length: 500 }, (_, i) =>
        makeAppItem({ internalId: `item-${i}`, groupId: i + 1 })
      )
      handlers = GroupPanel.setup({}, { expose: () => {} })
      handlers.list.value = {
        focus: vi.fn(),
        contains: () => true,
        querySelector: (selector: string) =>
          selector === 'input' ? { focus: inputFocus, select } : viewport,
      }
      return () => h('div')
    },
  })
  app.use(createPinia())
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({})
  try {
    await nextTick()
    const target = {},
      event = (key: string) => ({ key, target, currentTarget: target, preventDefault: vi.fn() })
    const first = handlers.rows.value[0],
      last = handlers.rows.value.at(-1)
    handlers.treeKey(event('End'), first)
    await nextTick()
    expect(handlers.focused.value).toEqual({ kind: 'group', id: 500 })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(handlers.virtualRows.value.some(({ row }: any) => row.id === 500)).toBe(true)
    handlers.treeKey(event('ArrowUp'), last)
    await nextTick()
    expect(handlers.focused.value.id).toBe(499)
    handlers.treeKey(event('Home'), handlers.rows.value[498])
    await nextTick()
    expect(handlers.focused.value.id).toBe(1)
    await handlers.startRename(last)
    expect(inputFocus).toHaveBeenCalledOnce()
    expect(select).toHaveBeenCalledOnce()
    expect(handlers.virtualRows.value.some(({ row }: any) => row.id === 500)).toBe(true)
    handlers.rowActions.cancelRename()
    handlers.dragStart({ dataTransfer: { setData: vi.fn() }, preventDefault: vi.fn() }, last)
    await nextTick()
    expect(handlers.virtualRows.value.some(({ row }: any) => row.id === 500)).toBe(true)
    handlers.rowActions.endDrag()
    const menuEvent = (key?: string) => ({
      target: { closest: () => (key ? { dataset: { rowKey: key } } : null) },
      preventDefault: vi.fn(),
    })
    handlers.prepareMenu(menuEvent('group:500'))
    handlers.setMenuOpen(true)
    await nextTick()
    expect(handlers.virtualRows.value.some(({ row }: any) => row.id === 500)).toBe(true)
    expect(handlers.menuRow.value.id).toBe(500)
    // 右键点击未选中行会替换选择，重复右键则保留选择。
    handlers.prepareMenu(menuEvent('group:1'))
    expect(handlers.openMenu.value).toEqual({ kind: 'group', id: 1 })
    expect(handlers.menuRow.value.id).toBe(1)
    expect(handlers.rowProps(first).selected).toBe(true)
    const previousProps = handlers.rowProps(handlers.rows.value[0])
    handlers.prepareMenu(menuEvent('group:1'))
    expect(handlers.rowProps(handlers.rows.value[0])).toEqual(previousProps)
    handlers.setMenuOpen(false)
    expect(handlers.openMenu.value).toBeNull()
    const blank = menuEvent()
    handlers.prepareMenu(blank)
    handlers.setMenuOpen(true)
    expect(blank.preventDefault).not.toHaveBeenCalled()
    expect(handlers.openMenu.value).toBe('background')
    expect(useEditorStore().activeScheme!.selectedItemIds.value.size).toBe(0)
    handlers.setMenuOpen(false)
    vi.stubGlobal(
      'MouseEvent',
      class {
        type: string
        constructor(type: string, options: object) {
          this.type = type
          Object.assign(this, options)
        }
      }
    )
    const keyboardMenu = { ...event('F10'), shiftKey: true }
    handlers.treeKey(keyboardMenu, first)
    expect(keyboardMenu.preventDefault).toHaveBeenCalledOnce()
    expect(dispatchEvent).toHaveBeenCalledOnce()
    expect(dispatchEvent.mock.calls[0]![0]).toMatchObject({
      type: 'contextmenu',
      clientX: 26,
      clientY: 120,
      bubbles: true,
      cancelable: true,
    })
    const store = useEditorStore()
    store.activeScheme!.collectionTree.value = {
      nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
      groups: Array.from({ length: 500 }, (_, i) => ({
        groupId: i + 1,
        collectionId: 'house',
        order: i,
      })),
    }
    await handlers.focusEntry({ kind: 'group', id: 500 })
    handlers.toggleCollection('house')
    await nextTick()
    expect(handlers.focused.value).toEqual({ kind: 'collection', id: 'house' })
    expect(handlers.rows.value).toHaveLength(1)
    expect(store.activeScheme!.selectedItemIds.value.size).toBe(0)
  } finally {
    app.unmount()
  }
})

it('keeps list selections in place and applies keyboard modifiers from a focused name button', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
  const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
  const { useUIStore } = await server.ssrLoadModule('/src/stores/uiStore.ts')
  let handlers: any, scheme: any
  const focus = vi.fn()
  const viewport = {
    scrollTop: 0,
    scrollTo: vi.fn(),
    querySelectorAll: () =>
      handlers.virtualRows.value.map(({ row }: any) => ({
        dataset: { rowKey: handlers.keyOf(row) },
        focus,
      })),
  }
  const { createApp } = createRenderer<object, object>({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert: () => {},
    remove: () => {},
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
    patchProp: () => {},
  })
  const app = createApp({
    setup() {
      useUIStore().groupPanelOpen = true
      const store = useEditorStore()
      store.createScheme('list selection integration')
      scheme = store.activeScheme!
      scheme.items.value = [1, 2, 3].map((id) =>
        makeAppItem({ internalId: `item-${id}`, groupId: id })
      )
      scheme.collectionTree.value = {
        nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
        groups: [1, 2].map((groupId) => ({ groupId, collectionId: 'house', order: groupId })),
      }
      handlers = GroupPanel.setup({}, { expose: () => {} })
      handlers.list.value = {
        contains: () => true,
        querySelector: (selector: string) => (selector === 'input' ? null : viewport),
      }
      return () => h('div')
    },
  })
  app.use(createPinia())
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({})
  try {
    await nextTick()
    const house = handlers.rows.value[0]
    const group = (id: number) =>
      handlers.rows.value.find((row: any) => row.kind === 'group' && row.id === id)
    const mouse = { ctrlKey: false, metaKey: false, shiftKey: false }
    handlers.activate(house, mouse)
    await nextTick()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-1', 'item-2']))
    expect(scheme.activeCollectionId.value).toBe('house')
    expect(scheme.activeGroupId.value).toBeNull()
    expect(handlers.rowProps(house).selectionState).toBe('full')
    expect(handlers.rowProps(house).selected).toBe(true)
    expect(handlers.rowProps(group(1)).selected).toBe(false)
    handlers.activate(group(1), mouse)
    handlers.activate(group(2), { ...mouse, ctrlKey: true })
    expect(handlers.rowProps(house).selected).toBe(false)
    handlers.rowActions.deselect(group(1))
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-2']))
    expect(handlers.rowProps(house).selectionState).toBe('partial')
    handlers.resetSelectionAnchor()
    const key = (value: string, modifiers = {}, name = true) => ({
      key: value,
      ...mouse,
      ...modifiers,
      target: { hasAttribute: (attribute: string) => name && attribute === 'data-group-name' },
      currentTarget: {},
      preventDefault: vi.fn(),
    })
    const end = key('End', { shiftKey: true })
    handlers.treeKey(end, group(1))
    await nextTick()
    expect(end.preventDefault).toHaveBeenCalledOnce()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-1', 'item-2', 'item-3']))
    expect(handlers.focused.value).toEqual({ kind: 'group', id: 3 })
    handlers.treeKey(key('Home', { shiftKey: true }), group(3))
    await nextTick()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-1', 'item-2']))
    handlers.activate(house, mouse)
    handlers.activate(group(3), { ...mouse, ctrlKey: true })
    const menuEvent = (id: string) => ({
      target: { closest: () => ({ dataset: { rowKey: id } }) },
      preventDefault: vi.fn(),
    })
    handlers.prepareMenu(menuEvent('collection:house'))
    handlers.setMenuOpen(true)
    expect(handlers.menuEntries.value).toEqual([
      { kind: 'collection', id: 'house' },
      { kind: 'group', id: 3 },
    ])
    expect(handlers.singleMenuEntry.value).toBe(false)
    handlers.dismissOnPointer({ button: 0 })
    expect(handlers.openMenu.value).toBeNull()
    const restore = vi.fn()
    focus.mockClear()
    handlers.restoreMenuFocus({ preventDefault: restore })
    await nextTick()
    expect(restore).toHaveBeenCalledOnce()
    expect(focus).not.toHaveBeenCalled()
    // 随后的点击仍按修饰键执行选择。
    handlers.treeKey(key('Enter', { ctrlKey: true }), house)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-3']))
    const folded = scheme.collapsedCollectionIds.value
    handlers.treeKey(key('Enter'), house)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-1', 'item-2']))
    expect(scheme.collapsedCollectionIds.value).toBe(folded)
    const selectionVersion = useEditorStore().selectionVersion
    handlers.treeKey(key('ArrowLeft'), house)
    expect(scheme.collapsedCollectionIds.value.has('house')).toBe(true)
    expect(useEditorStore().selectionVersion).toBe(selectionVersion)
    const collapsed = scheme.collapsedCollectionIds.value
    handlers.treeKey(key('F2'), house)
    await nextTick()
    expect(handlers.editing.value).toEqual({ kind: 'collection', id: 'house' })
    handlers.draft.value = 'Renamed house'
    handlers.finishRename()
    expect(scheme.collectionTree.value.nodes[0].name).toBe('Renamed house')
    expect(scheme.collapsedCollectionIds.value).toBe(collapsed)
    const actionButton = key('Enter', {}, false)
    handlers.treeKey(actionButton, house)
    expect(actionButton.preventDefault).not.toHaveBeenCalled()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-1', 'item-2']))
    const toggleFocus = vi.fn()
    vi.stubGlobal('document', { querySelector: () => ({ focus: toggleFocus }) })
    handlers.query.value = 'house'
    handlers.pointerInside.value = true
    handlers.close()
    await nextTick()
    expect(toggleFocus).toHaveBeenCalledWith({ preventScroll: true })
    expect(handlers.pointerInside.value).toBe(false)
    useUIStore().groupPanelOpen = true
    await nextTick()
    expect(handlers.query.value).toBe('house')
    expect(scheme.collapsedCollectionIds.value).toBe(collapsed)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-1', 'item-2']))

    const root = handlers.rows.value.find((row: any) => row.kind === 'collection')
    useEditorStore().setCollectionRestriction('house', 'hidden', true)
    await nextTick()
    const hiddenGroup = group(1)
    handlers.rowActions.toggleVisibility(hiddenGroup, { altKey: false })
    expect(useEditorStore().isItemVisible('item-1')).toBe(false)
    handlers.rowActions.toggleVisibility(hiddenGroup, { altKey: true })
    expect(useEditorStore().renderItemIds).toEqual(new Set(['item-1']))
    useEditorStore().showAllGroups()
    handlers.rowActions.toggleVisibility(root, { altKey: true })
    expect(useEditorStore().renderItemIds).toEqual(new Set(['item-1', 'item-2']))
    useEditorStore().showAllGroups()

    handlers.query.value = ''
    const destination = handlers.createCollection()
    handlers.activate(house, mouse)
    handlers.activate(group(3), { ...mouse, ctrlKey: true })
    handlers.prepareMenu(menuEvent('collection:house'))
    handlers.setMenuOpen(true)
    const count = scheme.history.value.transactionUndoStack.length
    handlers.moveMenuEntries(destination)
    expect(handlers.openMenu.value).toBeNull()
    expect(
      scheme.collectionTree.value.nodes.find((node: any) => node.id === 'house').parentId
    ).toBe(destination)
    expect(
      scheme.collectionTree.value.groups.find((entry: any) => entry.groupId === 3).collectionId
    ).toBe(destination)
    expect(scheme.history.value.transactionUndoStack).toHaveLength(count + 1)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-1', 'item-2', 'item-3']))
    scheme.items.value = [
      ...scheme.items.value,
      makeAppItem({ internalId: 'loose-a' }),
      makeAppItem({ internalId: 'loose-b' }),
    ]
    await nextTick()
    const loose = handlers.rows.value.at(-1)
    handlers.activate(loose, mouse)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['loose-a', 'loose-b']))
    handlers.rowActions.toggleVisibility(loose, { altKey: false })
    expect(useEditorStore().isItemVisible('loose-a')).toBe(false)
    expect(handlers.rows.value.at(-1).kind).toBe('ungrouped')
    handlers.rowActions.toggleVisibility(handlers.rows.value.at(-1), { altKey: false })
    expect(useEditorStore().isItemVisible('loose-a')).toBe(true)
    handlers.rowActions.toggleVisibility(handlers.rows.value.at(-1), { altKey: true })
    expect(useEditorStore().renderItemIds).toEqual(new Set(['loose-a', 'loose-b']))
    await handlers.startRename(loose)
    expect(handlers.editing.value).toBeNull()
    const drag = { preventDefault: vi.fn() }
    handlers.dragStart(drag, loose)
    expect(drag.preventDefault).toHaveBeenCalledOnce()
    const menu = menuEvent('ungrouped:0')
    handlers.prepareMenu(menu)
    handlers.setMenuOpen(true)
    expect(menu.preventDefault).toHaveBeenCalledOnce()
    expect(handlers.openMenu.value).toBeNull()
  } finally {
    app.unmount()
  }
})

it('routes protected panel nodes through the merge dialog without changing its captured scope or stealing focus', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
  const { default: GroupMergeDialog } = await server.ssrLoadModule(
    '/src/components/GroupMergeDialog.vue'
  )
  const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
  const { useUIStore } = await server.ssrLoadModule('/src/stores/uiStore.ts')
  const { useEditorSelection } = await server.ssrLoadModule(
    '/src/composables/editor/useEditorSelection.ts'
  )
  const { useEditorHistory } = await server.ssrLoadModule(
    '/src/composables/editor/useEditorHistory.ts'
  )
  let panel: any, dialog: any, scheme: any
  const props = shallowReactive({ open: false })
  const focus = vi.fn()
  const viewport = {
    scrollTop: 0,
    scrollTo: vi.fn(),
    querySelectorAll: () =>
      panel.rows.value.map((row: any) => ({
        dataset: { rowKey: panel.keyOf(row) },
        focus,
      })),
  }
  const { createApp } = createRenderer<object, object>({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert: () => {},
    remove: () => {},
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
    patchProp: () => {},
  })
  const app = createApp({
    setup() {
      const store = useEditorStore(),
        ui = useUIStore()
      store.createScheme('panel merge integration')
      scheme = store.activeScheme!
      scheme.items.value = [1, 2, 3].map((groupId) =>
        makeAppItem({ internalId: `item-${groupId}`, groupId })
      )
      scheme.maxGroupId.value = 3
      scheme.collectionTree.value = {
        nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
        groups: [1, 2].map((groupId) => ({ groupId, collectionId: 'house', order: groupId })),
      }
      store.setGroupHidden(1, true)
      store.setGroupLocked(2, true)
      ui.groupPanelOpen = true
      panel = GroupPanel.setup({}, { expose: () => {} })
      panel.list.value = { contains: () => true, querySelector: () => viewport }
      watch(
        () => ui.groupMergeOpen,
        (open) => {
          props.open = open
        }
      )
      dialog = GroupMergeDialog.setup(props, {
        expose: () => {},
        emit: (_event: string, open: boolean) => {
          ui.groupMergeOpen = open
        },
      })
      return () => h('div')
    },
  })
  app.use(createPinia())
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({})
  const menu = (key: string) => ({
    target: { closest: () => ({ dataset: { rowKey: key } }) },
    preventDefault: vi.fn(),
  })
  try {
    await nextTick()
    const house = panel.rows.value[0]
    panel.activate(house, { ctrlKey: false, metaKey: false, shiftKey: false })
    panel.prepareMenu(menu('collection:house'))
    panel.setMenuOpen(true)
    expect(panel.singleMenuEntry.value).toBe(true)
    expect(panel.menuGroupTarget.value.groupIds).toEqual([1, 2])
    expect(panel.canGroupSelection(panel.menuGroupTarget.value)).toBe(true)
    expect(panel.canUngroupSelection(panel.menuGroupTarget.value)).toBe(true)
    panel.requestGroup(panel.menuGroupTarget.value)
    panel.setMenuOpen(false)
    panel.restoreMenuFocus({ preventDefault: vi.fn() })
    await nextTick()
    expect(focus).not.toHaveBeenCalled()
    expect(props.open).toBe(true)
    dialog.target.value = '2'
    useEditorSelection().updateSelection(['item-3'], false)
    await nextTick()
    expect(dialog.canSubmit.value).toBe(true)
    dialog.submit()
    await nextTick()
    expect(scheme.items.value.map((item: any) => item.groupId)).toEqual([2, 2, 3])
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-3']))
    expect(useUIStore().groupMergeTarget).toBeNull()
    expect(props.open).toBe(false)
    useEditorHistory().undo()
    panel.prepareMenu(menu('collection:house'))
    panel.setMenuOpen(true)
    panel.ungroupSelected(panel.menuGroupTarget.value)
    expect(scheme.items.value.map((item: any) => item.groupId)).toEqual([0, 0, 3])
    useEditorHistory().undo()
    panel.prepareMenu(menu('collection:house'))
    panel.requestGroup(panel.menuGroupTarget.value)
    await nextTick()
    useEditorStore().createScheme('different scheme')
    await nextTick()
    expect(props.open).toBe(false)
    expect(useUIStore().groupMergeTarget).toBeNull()
  } finally {
    app.unmount()
  }
})

it('clears background selections and creates a top-level collection without treating controls as blank space', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
  const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
  const { useUIStore } = await server.ssrLoadModule('/src/stores/uiStore.ts')
  const { useEditorHistory } = await server.ssrLoadModule(
    '/src/composables/editor/useEditorHistory.ts'
  )
  let panel: any, scheme: any
  const focus = vi.fn(),
    inputFocus = vi.fn(),
    selectText = vi.fn()
  const outside = { closest: () => null }
  const viewport = { scrollTop: 0, scrollTo: vi.fn(), querySelectorAll: () => [] }
  const { createApp } = createRenderer<object, object>({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert: () => {},
    remove: () => {},
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
    patchProp: () => {},
  })
  const app = createApp({
    setup() {
      const store = useEditorStore()
      store.createScheme('background interaction')
      scheme = store.activeScheme!
      scheme.items.value = [0, 1, 2, 3].map((groupId) =>
        makeAppItem({ internalId: `item-${groupId}`, groupId })
      )
      scheme.collectionTree.value = {
        nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
        groups: [1, 2].map((groupId) => ({ groupId, collectionId: 'house', order: groupId })),
      }
      store.setGroupHidden(1, true)
      store.setGroupLocked(2, true)
      useUIStore().groupPanelOpen = true
      panel = GroupPanel.setup({}, { expose: () => {} })
      panel.list.value = {
        focus,
        contains: (target: unknown) => target !== outside,
        querySelector: (selector: string) =>
          selector === 'input' ? { focus: inputFocus, select: selectText } : viewport,
      }
      return () => h('div')
    },
  })
  app.use(createPinia())
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({})
  const mouse = { ctrlKey: false, metaKey: false, shiftKey: false }
  const event = (target: object, button = 0) => ({ target, button, preventDefault: vi.fn() })
  const blank = { closest: () => null }
  const row = (id: number) =>
    panel.rows.value.find((entry: any) => entry.kind === 'group' && entry.id === id)
  try {
    await nextTick()
    const house = panel.rows.value[0]
    panel.activate(house, mouse)
    panel.activate(row(3), { ...mouse, ctrlKey: true })
    const items = scheme.items.value,
      tree = scheme.collectionTree.value
    const hidden = scheme.hiddenGroupIds.value,
      locked = scheme.lockedGroupIds.value
    const collapsed = scheme.collapsedCollectionIds.value
    const count = scheme.history.value.selectionUndoStack.length
    for (const selector of [
      '[data-row-key]',
      'button',
      'input',
      '[data-slot="scroll-area-scrollbar"]',
    ]) {
      const control = { closest: (query: string) => (query.includes(selector) ? {} : null) }
      panel.clickBackground(event(control))
      expect(scheme.selectedItemIds.value).toEqual(new Set(['item-3']))
    }
    panel.clickBackground(event(outside))
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-3']))
    panel.clickBackground(event(blank))
    expect(scheme.selectedItemIds.value.size).toBe(0)
    expect(panel.selectedEntries.value).toEqual([])
    expect(scheme.activeGroupId.value).toBeNull()
    expect(scheme.activeCollectionId.value).toBeNull()
    expect(panel.focused.value).toBeNull()
    expect(scheme.history.value.selectionUndoStack).toHaveLength(count + 1)
    panel.clickBackground(event(blank))
    expect(scheme.history.value.selectionUndoStack).toHaveLength(count + 1)
    expect(scheme.hiddenGroupIds.value).toBe(hidden)
    expect(scheme.lockedGroupIds.value).toBe(locked)
    expect(scheme.collapsedCollectionIds.value).toBe(collapsed)

    panel.activate(row(3), mouse)
    panel.menuPointerDown({ ...event(blank), pointerType: 'touch' })
    expect(scheme.selectedItemIds.value).toEqual(new Set(['item-3']))
    panel.setMenuOpen(true)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    panel.setMenuOpen(false)
    panel.activate(house, mouse)
    panel.activate(row(3), { ...mouse, ctrlKey: true })
    panel.activate(panel.rows.value.at(-1), { ...mouse, ctrlKey: true })
    panel.query.value = 'no matching rows'
    const rightClick = event(blank, 2)
    panel.prepareMenu(rightClick)
    panel.setMenuOpen(true)
    await nextTick()
    expect(rightClick.preventDefault).not.toHaveBeenCalled()
    expect(panel.openMenu.value).toBe('background')
    expect(panel.menuRow.value).toBeUndefined()
    expect(panel.menuEntries.value).toEqual([])
    expect(scheme.selectedItemIds.value.size).toBe(0)
    await panel.addCollection()
    panel.setMenuOpen(false)
    const created = scheme.collectionTree.value.nodes.find((node: any) => node.id !== 'house')
    expect(created.parentId).toBeNull()
    expect(panel.editing.value).toEqual({ kind: 'collection', id: created.id })
    expect(panel.query.value).toBe('')
    expect(inputFocus).toHaveBeenCalledOnce()
    expect(selectText).toHaveBeenCalledOnce()
    expect(scheme.items.value).toBe(items)
    expect(scheme.collectionTree.value.groups).toEqual(tree.groups)
    const focusCount = focus.mock.calls.length
    panel.restoreMenuFocus({ preventDefault: vi.fn() })
    expect(focus).toHaveBeenCalledTimes(focusCount)
    panel.rowActions.cancelRename()
    useEditorHistory().undo()
    expect(scheme.collectionTree.value).toEqual(tree)
  } finally {
    app.unmount()
  }
})

it.each([false, true])(
  'keeps the whole list as a context-menu trigger with no rows (search: %s)',
  async (searching) => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
    const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
    const Panel = {
      ...GroupPanel,
      setup(props: object, context: object) {
        const bindings = GroupPanel.setup(props, context)
        if (searching) bindings.query.value = 'no matching rows'
        return bindings
      },
    }
    const app = createSSRApp({
      setup() {
        const store = useEditorStore()
        store.createScheme('empty list trigger')
        if (searching) store.activeScheme!.items.value = [makeAppItem({ groupId: 7 })]
        return () => h(Panel)
      },
    })
    app.use(createPinia())
    const html = await renderToString(app)
    const trigger = html.match(/<div\b[^>]*data-slot="context-menu-trigger"[^>]*>/)?.[0]
    expect(trigger).toContain('flex-1')
    expect(trigger).toContain('tabindex="-1"')
    expect(html).toContain(searching ? '没有匹配的组' : '还没有组')
  }
)

it('renders working visibility and lock controls for unclassified and ungrouped rows', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
  const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
  const app = createSSRApp({
    setup() {
      const store = useEditorStore()
      store.createScheme('aggregate controls')
      const scheme = store.activeScheme!
      scheme.items.value = [
        makeAppItem({ internalId: 'grouped', groupId: 7 }),
        makeAppItem({ internalId: 'loose' }),
      ]
      scheme.collectionTree.value = {
        nodes: [{ id: 'empty', name: 'Empty', parentId: null, order: 0 }],
        groups: [],
      }
      store.setCollectionRestriction('@unclassified', 'hidden', true)
      store.setCollectionRestriction('@unclassified', 'locked', true)
      store.setGroupLocked(0, true)
      return () => h(GroupPanel)
    },
  })
  app.use(createPinia())
  const html = await renderToString(app)
  const rows = [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)].map(([row]) => row)
  const unclassified = rows.find((row) => row.includes('data-collection-id="@unclassified"'))!
  const ungrouped = rows.find((row) => row.includes('data-ungrouped="true"'))!
  const group = rows.find((row) => row.includes('data-group-id="7"'))!
  expect(unclassified).toContain('aria-label="显示“未分类”"')
  expect(unclassified).toContain('aria-label="解锁“未分类”"')
  expect(ungrouped).toContain('aria-label="隐藏“未分组”"')
  expect(ungrouped).toContain('aria-label="解锁“未分组”"')
  expect(ungrouped).not.toMatch(/\sdisabled(?:=|\s|>)/)
  expect(group).toContain('由集合「未分类」隐藏')
  expect(group).toContain('由集合「未分类」锁定')
})

it.each(['none', 'hidden', 'locked', 'both'] as const)(
  'shows footer recovery actions only for active restrictions: %s',
  async (state) => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    const { default: GroupPanel } = await server.ssrLoadModule('/src/components/GroupPanel.vue')
    const { useEditorStore } = await server.ssrLoadModule('/src/stores/editorStore.ts')
    const app = createSSRApp({
      setup() {
        const store = useEditorStore()
        store.createScheme('footer')
        store.activeScheme!.collectionTree.value = {
          nodes: [{ id: 'empty', name: 'Empty', parentId: null, order: 0 }],
          groups: [],
        }
        if (state === 'hidden' || state === 'both')
          store.setCollectionRestriction('empty', 'hidden', true)
        if (state === 'locked' || state === 'both')
          store.setCollectionRestriction('empty', 'locked', true)
        return () => h(GroupPanel)
      },
    })
    app.use(createPinia())
    const html = await renderToString(app)
    const footer = html.match(/<footer\b[\s\S]*?<\/footer>/)![0]
    expect(footer.includes('全部显示')).toBe(state === 'hidden' || state === 'both')
    expect(footer.includes('全部解锁')).toBe(state === 'locked' || state === 'both')
  }
)
