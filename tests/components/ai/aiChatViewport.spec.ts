import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { createRenderer, h, nextTick, reactive, ref, ssrContextKey } from 'vue'
import { createPinia } from 'pinia'

const server = await createServer({
  configFile: false,
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../../src', import.meta.url)) },
    dedupe: ['vue'],
  },
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: 'custom',
})
afterAll(() => server.close())
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mountSetup(file: string, props: object, chat: object) {
  const { default: component } = await server.ssrLoadModule(`/src/components/ai/${file}.vue`)
  const { aiChatKey } = await server.ssrLoadModule('/src/composables/ai/useAiChat.ts')
  const { createApp } = createRenderer<object, object>({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert() {},
    remove() {},
    setText() {},
    setElementText() {},
    patchProp() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  let state: any
  const app = createApp({
    setup() {
      state = component.setup(props, { expose() {}, emit() {} })
      return () => h('div')
    },
  })
  app.use(createPinia())
  app.provide(aiChatKey, chat)
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({})
  cleanups.push(() => app.unmount())
  return { state, app }
}

it('does not publish a stale image after its ID changes or its component unmounts', async () => {
  let resolveFirst!: (value: Blob) => void, resolveLast!: (value: Blob) => void
  const loadImage = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )
    .mockResolvedValueOnce(new Blob(['second']))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLast = resolve
        })
    )
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:second')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const props = reactive({
    image: { id: 'first', width: 1024, height: 1024 },
    label: 'Image',
    eager: true,
  })
  const { state, app } = await mountSetup('AiImage', props, { loadImage })
  props.image = { ...props.image, id: 'second' }
  await nextTick()
  await nextTick()
  resolveFirst(new Blob(['first']))
  await nextTick()
  expect(state.url.value).toBe('blob:second')
  expect(create).toHaveBeenCalledOnce()
  props.image = { ...props.image, id: 'last' }
  await nextTick()
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:second')
  app.unmount()
  resolveLast(new Blob(['last']))
  await nextTick()
  expect(create).toHaveBeenCalledOnce()
})

async function sidebar() {
  // Sidebar imports the shared file-operation entry; no workspace work runs in this UI test.
  vi.stubGlobal('window', { location: { pathname: '/' } })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  vi.stubGlobal(
    'Worker',
    class {
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
    }
  )
  const chat = {
    entries: ref([{ id: 'message', role: 'assistant', text: 'Text', state: 'running' }]),
    isRunning: ref(true),
    isLoading: ref(false),
    sessionId: ref('session'),
    sessions: ref([]),
    uncertain: ref([]),
    loadOlder: vi.fn(),
  }
  const { state } = await mountSetup('SidebarAI', {}, chat)
  let top = 0
  const viewport = {
    scrollHeight: 1000,
    clientHeight: 200,
    get scrollTop() {
      return top
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight))
    },
  }
  state.viewport.value = viewport
  state.bottom()
  await nextTick()
  return { state, chat, viewport }
}

it('cancels a queued follow on a one-pixel upward gesture; resumes only at the bottom or on explicit request', async () => {
  const { state, chat, viewport } = await sidebar()
  expect(viewport.scrollTop).toBe(800)
  const queued = state.scrollBottom()
  state.onWheel({ deltaY: -1 })
  state.onScroll() // An old programmatic scroll event must not re-enable following.
  viewport.scrollTop = 799
  state.onScroll()
  await queued
  expect(state.following.value).toBe(false)
  expect(viewport.scrollTop).toBe(799)
  viewport.scrollHeight += 200
  chat.entries.value[0]!.text += ' streamed'
  await nextTick()
  await nextTick()
  expect(viewport.scrollTop).toBe(799)
  viewport.scrollTop = 1000
  state.onScroll()
  expect(state.following.value).toBe(true)
  viewport.scrollHeight += 200
  chat.entries.value[0]!.text += ' more'
  await nextTick()
  await nextTick()
  expect(viewport.scrollTop).toBe(1200)
  state.onWheel({ deltaY: -10 })
  viewport.scrollTop = 600
  state.onScroll()
  state.bottom()
  await nextTick()
  expect(viewport.scrollTop).toBe(1200)
  expect(state.following.value).toBe(true)
})

it('follows asynchronous Markdown layout only while following, including cancellation of queued resize work', async () => {
  const { state, viewport } = await sidebar()
  viewport.scrollHeight += 150
  state.onTimelineResize()
  await nextTick()
  expect(viewport.scrollTop).toBe(950)
  viewport.scrollHeight += 200
  state.onTimelineResize()
  state.onWheel({ deltaY: -1 })
  viewport.scrollTop = 600
  state.onScroll()
  await nextTick()
  expect(viewport.scrollTop).toBe(600)
  viewport.scrollHeight += 300
  state.onTimelineResize()
  await nextTick()
  expect(viewport.scrollTop).toBe(600)
  state.bottom()
  await nextTick()
  expect(viewport.scrollTop).toBe(1450)
})

it('preserves the reading position when prepending older messages and resets follow for another session', async () => {
  const { state, chat, viewport } = await sidebar()
  viewport.scrollTop = 300
  state.onScroll()
  chat.loadOlder.mockImplementation(() => {
    viewport.scrollHeight += 400
  })
  await state.loadOlder()
  expect(viewport.scrollTop).toBe(700)
  state.onScroll()
  expect(state.following.value).toBe(false)
  chat.sessionId.value = 'another'
  await nextTick()
  await nextTick()
  expect(viewport.scrollTop).toBe(1200)
  expect(state.following.value).toBe(true)
})
