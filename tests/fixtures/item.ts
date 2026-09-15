import { ref, shallowRef } from 'vue'
import type { AppItem, HistoryStack, HomeScheme, ThreeViewState } from '@/types/editor'

/**
 * 构造一个合法的最小 AppItem。
 *
 * 默认值刻意保持"零值"：坐标 0、无旋转、Scale 1、无分组，
 * 这样每个测试只需要显式写出它真正关心的字段。
 */
export function makeAppItem(overrides: Partial<AppItem> = {}): AppItem {
  const { extra, ...rest } = overrides

  return {
    internalId: 'item-1',
    gameId: 1170000010,
    instanceId: 1000,
    x: 0,
    y: 0,
    z: 0,
    rotation: { x: 0, y: 0, z: 0 },
    groupId: 0,
    extra: {
      Scale: { X: 1, Y: 1, Z: 1 },
      AttachID: 0,
      ...extra,
    },
    ...rest,
  }
}

/** 批量构造，internalId 自动派生，避免手写样板。 */
export function makeAppItems(
  count: number,
  overrides: (index: number) => Partial<AppItem> = () => ({})
): AppItem[] {
  return Array.from({ length: count }, (_, index) =>
    makeAppItem({ internalId: `item-${index + 1}`, ...overrides(index) })
  )
}

/**
 * 构造一个满足 HomeScheme 形状的方案对象。
 * 使用真实的 ref / shallowRef，让事务系统里的 `.value =` 赋值与生产一致。
 */
export function makeScheme(items: AppItem[] = []): HomeScheme {
  return {
    id: 'scheme-test',
    name: ref('测试方案'),
    filePath: ref<string | undefined>(undefined),
    lastModified: ref<number | undefined>(undefined),
    source: ref<'local' | 'cloud'>('local'),
    cloudRoomCode: ref<string | undefined>(undefined),
    items: shallowRef<AppItem[]>(items),
    selectedItemIds: shallowRef<Set<string>>(new Set()),
    maxInstanceId: ref(999),
    maxGroupId: ref(0),
    currentViewConfig: ref<{ scale: number; x: number; y: number } | undefined>(undefined),
    viewState: ref<ThreeViewState | undefined>(undefined),
    groupOrigins: shallowRef<Map<number, string>>(new Map()),
    history: shallowRef<HistoryStack | undefined>(undefined),
  }
}
