import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Matrix4, Object3D, OrthographicCamera } from 'three'
import type { AppItem } from '@/types/editor'

const hoisted = vi.hoisted(() => ({
  keys: {
    Alt: { value: false },
    Control: { value: false },
    Meta: { value: false },
    Shift: { value: false },
  },
  commits: [] as Array<{ updates: unknown; options: unknown }>,
  // 必须是单例：测试里要修改它，gizmo 内部读的也必须是同一份。
  editorStore: {
    activeScheme: {
      items: { value: [] as AppItem[] },
      selectedItemIds: { value: new Set<string>() },
      groupOrigins: { value: new Map<number, string>() },
    },
    gizmoMode: 'translate' as string,
    itemsMap: new Map<string, AppItem>(),
  },
}))

// 只桩掉跨模块的接线，vue / three 保持真实实现，避免掩盖真实行为。
vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  return { ...actual, watch: () => () => {}, watchEffect: () => () => {}, onUnmounted: () => {} }
})

vi.mock('@vueuse/core', () => ({
  useMagicKeys: () => hoisted.keys,
}))

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: () => hoisted.editorStore,
}))

vi.mock('@/stores/gameDataStore', () => ({
  useGameDataStore: () => ({
    getFurnitureSize: () => [100, 100, 10],
    getFurnitureModelConfig: () => null,
  }),
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      threeDisplayMode: 'box',
      enableSurfaceSnap: true,
      surfaceSnapThreshold: 20,
      translationSnap: 0,
    },
  }),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: () => ({
    activeSlidePathPoint: null,
    editorContainerRect: { left: 0, top: 0, width: 1000, height: 1000 },
  }),
}))

vi.mock('@/composables/useThreeModelManager', () => ({
  getThreeModelManager: () => ({ getModelBoundingBox: () => null }),
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({}),
}))

vi.mock('@/composables/editor/useEditorManipulation', () => ({
  useEditorManipulation: () => ({
    getSelectedItemsCenter: () => ({ x: 0, y: 0, z: 0 }),
    commitBatchedTransform: (updates: unknown, options: unknown) => {
      hoisted.commits.push({ updates, options })
    },
  }),
}))

vi.mock('@/composables/editor/useEditorHistory', () => ({
  useEditorHistory: () => ({ recordTransaction: () => {} }),
}))

vi.mock('@/composables/transformGizmo/gizmoAppearance', () => ({
  createGizmoAppearanceManager: () => () => {},
}))

// 飞花道相关导入在普通家具拖拽路径上不会被调用，但 ESM 要求命名导出必须存在。
vi.mock('@/lib/slidePath', () => ({
  isSlidePathItem: () => false,
  hasEditableSlidePath: () => false,
  shouldRenderAsSlidePath: () => false,
  getSlidePathWorldPoint: () => null,
  withSlidePathWorldPoint: (item: AppItem) => item,
}))

const { useThreeTransformGizmo } = await import('@/composables/useThreeTransformGizmo')

function item(id: string, x: number, y = 0, gameId = 1): AppItem {
  return {
    internalId: id,
    gameId,
    instanceId: 1,
    x,
    y,
    z: 0,
    rotation: { x: 0, y: 0, z: 0 },
    groupId: 0,
    extra: { Scale: { X: 1, Y: 1, Z: 1 }, AttachID: 0 },
  }
}

function gizmoFixture() {
  hoisted.commits.length = 0
  hoisted.keys.Alt.value = false
  hoisted.keys.Control.value = false
  hoisted.keys.Meta.value = false

  const items = [item('m', -160), item('t', 0)]
  const editorStore = hoisted.editorStore
  editorStore.gizmoMode = 'translate'
  editorStore.activeScheme.items.value = items
  editorStore.activeScheme.selectedItemIds.value = new Set(['m'])
  editorStore.itemsMap = new Map(items.map((i) => [i.internalId, i]))

  const pivot = new Object3D()
  pivot.position.set(-160, 0, 0)

  const camera = new OrthographicCamera(-500, 500, 500, -500, 1, 2000)
  camera.position.set(0, 0, 1000)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)

  const controls = { axis: 'X' }
  const previews: Array<{ matrices: Map<string, Matrix4>; preview: boolean }> = []

  const gizmo = useThreeTransformGizmo(
    { value: pivot } as any,
    (matrices, preview) => previews.push({ matrices, preview: preview ?? false }),
    ref(false) as any,
    undefined,
    { value: camera } as any,
    { value: { instance: controls } } as any
  )

  return { gizmo, pivot, controls, items, previews, commits: hoisted.commits }
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-6)
}

describe('useThreeTransformGizmo 拖拽提交', () => {
  it('鼠标与实际触控投影共用吸附预览，松手只提交最后一帧且只提交位置', async () => {
    const originalWindow = (globalThis as any).window

    try {
      for (const touch of [false, true]) {
        ;(globalThis as any).window = { matchMedia: () => ({ matches: touch }) }

        const fixture = gizmoFixture()
        const event = (clientX: number) => ({
          pointerType: 'touch',
          pointerId: 1,
          clientX,
          clientY: 500,
        })

        fixture.gizmo.handleGizmoMouseDown(touch ? (event(340) as any) : undefined)
        if (!touch) fixture.pivot.position.x = -110
        await fixture.gizmo.handleGizmoChange(touch ? (event(390) as any) : undefined)

        near(fixture.previews.at(-1)!.matrices.get('m')!.elements[12]!, -100)
        // 预览阶段绝不写入存档。
        near(fixture.items[0]!.x, -160)

        // 松手时轴已清除或修饰键变化，都不能把最终位置重新算一遍。
        fixture.controls.axis = null as any
        hoisted.keys.Control.value = true
        fixture.gizmo.handleGizmoMouseUp()

        expect(fixture.commits).toHaveLength(1)
        expect(fixture.commits[0]).toEqual({
          updates: [{ id: 'm', x: -100, y: -0, z: 0 }],
          options: { recordHistory: true },
        })
        expect(fixture.previews.at(-1)!.preview).toBe(false)
        near(fixture.previews.at(-1)!.matrices.get('m')!.elements[12]!, -100)
      }
    } finally {
      if (originalWindow === undefined) delete (globalThis as any).window
      else (globalThis as any).window = originalWindow
    }
  })

  it('点击不移动、拖回起点均不提交空历史事务', async () => {
    const fixture = gizmoFixture()

    fixture.gizmo.handleGizmoMouseDown()
    fixture.gizmo.handleGizmoMouseUp()
    expect(fixture.commits).toHaveLength(0)

    fixture.gizmo.handleGizmoMouseDown()
    fixture.pivot.position.x = -130
    await fixture.gizmo.handleGizmoChange()
    fixture.pivot.position.x = -160
    await fixture.gizmo.handleGizmoChange()
    fixture.gizmo.handleGizmoMouseUp()

    expect(fixture.commits).toHaveLength(0)
  })
})
