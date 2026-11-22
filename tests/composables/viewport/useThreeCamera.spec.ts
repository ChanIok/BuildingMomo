import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { Box3, Vector3 } from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTabStore } from '@/stores/tabStore'
import { useUIStore } from '@/stores/uiStore'
import { useThreeCamera } from '@/composables/viewport/useThreeCamera'
import { makeAppItem } from '../../fixtures/item'

vi.mock('@/composables/app/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useRafFn: () => ({ pause: vi.fn(), resume: vi.fn(), isActive: ref(false) }),
    useMagicKeys: () => ({
      w: ref(false),
      a: ref(false),
      s: ref(false),
      d: ref(false),
      q: ref(false),
      space: ref(false),
      shift: ref(false),
      ctrl: ref(false),
      meta: ref(false),
      alt: ref(false),
    }),
  }
})
vi.mock('@/lib/viewport/spatialBounds', () => ({
  getItemsWorldBoundsMetrics: (items: Array<{ x: number; y: number; z: number }>) => {
    if (items.length === 0) return null
    const first = items[0]!
    // 数据坐标 Y 在世界空间取反
    const center = new Vector3(first.x, -first.y, first.z)
    const size = new Vector3(400, 400, 200)
    return {
      box: new Box3().setFromCenterAndSize(center, size),
      center,
      size,
      maxDim: 400,
    }
  },
}))

let pinia: ReturnType<typeof createPinia>
const scopes: EffectScope[] = []

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  disposePinia(pinia)
  vi.unstubAllGlobals()
})

function mountCamera() {
  const scope = effectScope()
  scopes.push(scope)
  const camera = scope.run(() => useThreeCamera())
  if (!camera) throw new Error('useThreeCamera failed to initialize')
  return camera
}

describe('useThreeCamera scheme view preset inheritance', () => {
  it('defaults the first new scheme in a session to top view', () => {
    const editor = useEditorStore()
    const ui = useUIStore()

    editor.createScheme('First')
    mountCamera()

    expect(ui.currentViewPreset).toBe('top')
  })

  it('follows the previous scheme preset and perspective flight mode for newly imported schemes', async () => {
    const editor = useEditorStore()
    const settings = useSettingsStore()
    const ui = useUIStore()
    settings.settings.perspectiveControlMode = 'flight'

    const firstId = editor.createScheme('Scheme A')
    const firstScheme = editor.schemes.find((s) => s.id === firstId)!
    firstScheme.items.value = [makeAppItem({ x: 100, y: 200, z: 0 })]

    const camera = mountCamera()
    expect(ui.currentViewPreset).toBe('top')

    camera.switchToViewPreset('perspective')
    await nextTick()
    expect(ui.currentViewPreset).toBe('perspective')
    expect(camera.controlMode.value).toBe('flight')

    // 导入新的有物品方案（无 viewState）：跟随透视视图并适配新方案中心
    await editor.importJSONAsScheme(
      JSON.stringify({
        PlaceInfo: [
          {
            ItemID: 1001,
            InstanceID: 1000,
            Location: { X: 2500, Y: -1500, Z: 300 },
            Rotation: { Roll: 0, Pitch: 0, Yaw: 0 },
            GroupID: 0,
          },
        ],
      }),
      'Scheme B.json'
    )
    await nextTick()

    expect(ui.currentViewPreset).toBe('perspective')
    expect(camera.controlMode.value).toBe('flight')
    expect(camera.cameraLookAt.value).toEqual([2500, 1500, 300])

    // 新建空白方案（无 viewState）：同样跟随透视视图
    editor.createScheme('Empty C')
    await nextTick()

    expect(ui.currentViewPreset).toBe('perspective')
    expect(camera.controlMode.value).toBe('flight')
  })

  it('restores saved viewState when switching to an existing scheme and follows it for subsequent new schemes', async () => {
    const editor = useEditorStore()
    const tabStore = useTabStore()
    const ui = useUIStore()

    const firstId = editor.createScheme('Scheme A')
    const firstScheme = editor.schemes.find((s) => s.id === firstId)!
    firstScheme.viewState.value = {
      position: [0, 0, 5000],
      target: [0, 0, 0],
      preset: 'front',
      zoom: 1.5,
    }

    const camera = mountCamera()
    expect(ui.currentViewPreset).toBe('front')

    // 切换到新方案 B 并切到透视视图（方案 A 的 viewState 保留为 front）
    editor.createScheme('Scheme B')
    await nextTick()
    camera.switchToViewPreset('perspective')
    await nextTick()
    expect(ui.currentViewPreset).toBe('perspective')

    // 切回已保存为 front 的方案 A
    tabStore.openSchemeTab(firstId, 'Scheme A')
    await nextTick()
    expect(ui.currentViewPreset).toBe('front')

    // 再新建或导入无 viewState 的方案 C：跟随当前的 front
    editor.createScheme('Scheme C')
    await nextTick()
    expect(ui.currentViewPreset).toBe('front')
    expect(camera.controlMode.value).toBe('orbit')
  })
})
