import { computed, triggerRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editorStore'
import { useUIStore } from '../stores/uiStore'
import { useEditorHistory } from './editor/useEditorHistory'
import { applyTransformToItems } from '../lib/itemTransform'
import type {
  AppItem,
  AdvancedPasteOptions,
  ClipboardData,
  StepRepeatConfig,
  TransformParams,
} from '../types/editor'

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function cloneColorMap(colorMap: AppItem['extra']['ColorMap'] | undefined) {
  if (Array.isArray(colorMap)) {
    return [...colorMap]
  }

  if (colorMap && typeof colorMap === 'object') {
    return { ...colorMap }
  }

  return undefined
}

function cloneItemExtra(extra: AppItem['extra']): AppItem['extra'] {
  return {
    ...extra,
    Scale: extra.Scale ? { ...extra.Scale } : { X: 1, Y: 1, Z: 1 },
    TempInfo:
      extra.TempInfo && typeof extra.TempInfo === 'object' ? { ...extra.TempInfo } : undefined,
    ColorMap: cloneColorMap(extra.ColorMap),
  }
}

function cloneItem(item: AppItem): AppItem {
  return {
    ...item,
    rotation: { ...item.rotation },
    extra: cloneItemExtra(item.extra),
  }
}

function cloneClipboardData(clipboardData: ClipboardData): ClipboardData {
  return {
    sourceSchemeId: clipboardData.sourceSchemeId ?? null,
    items: clipboardData.items.map(cloneItem),
    groupOrigins: new Map(clipboardData.groupOrigins),
  }
}

// 将 ColorMap 中引用的 groupId 按 groupIdMap 重映射，用于 preserve-source 模式下已有物品的组重编号
function remapColorMapGroupIds(
  colorMap: AppItem['extra']['ColorMap'] | undefined,
  groupIdMap: Map<number, number>
) {
  if (!colorMap || groupIdMap.size === 0) {
    return cloneColorMap(colorMap)
  }

  if (Array.isArray(colorMap)) {
    return colorMap.map((raw) => {
      // raw < 10 既排除了无效值（≤0）也排除了无需重映射的单色索引
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 10) {
        return raw
      }

      const oldGroupId = Math.floor(raw / 10)
      const colorIndex = raw % 10
      const nextGroupId = groupIdMap.get(oldGroupId) ?? oldGroupId
      return nextGroupId * 10 + colorIndex
    })
  }

  const result: Record<string, number> = {}
  for (const [groupKey, raw] of Object.entries(colorMap)) {
    const parsedGroupId = Number(groupKey)
    if (!Number.isFinite(parsedGroupId) || parsedGroupId < 0 || typeof raw !== 'number') {
      continue
    }

    const nextGroupId = groupIdMap.get(parsedGroupId) ?? parsedGroupId
    if (!Number.isFinite(raw) || raw <= 0) {
      result[String(nextGroupId)] = raw
      continue
    }

    const colorIndex = raw < 10 ? raw : raw % 10
    result[String(nextGroupId)] = nextGroupId === 0 ? colorIndex : nextGroupId * 10 + colorIndex
  }

  return result
}

// 计算步进复制的基准锚点：单组时取组原点，否则取所有物品的 AABB 中心
function getClipboardPivot(clipboardData: ClipboardData): { x: number; y: number; z: number } {
  const { items, groupOrigins } = clipboardData
  if (items.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  if (groupOrigins.size === 1) {
    // size === 1，for...of 只迭代一次，类型安全且无需下标访问
    for (const [groupId, originItemId] of groupOrigins) {
      const originItem = items.find(
        (item) => item.internalId === originItemId && item.groupId === groupId
      )
      if (originItem) {
        return { x: originItem.x, y: originItem.y, z: originItem.z }
      }
    }
  }

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (const item of items) {
    if (item.x < minX) minX = item.x
    if (item.x > maxX) maxX = item.x
    if (item.y < minY) minY = item.y
    if (item.y > maxY) maxY = item.y
    if (item.z < minZ) minZ = item.z
    if (item.z > maxZ) maxZ = item.z
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  }
}

/**
 * 计算当前这批剪贴板物品的有效工作坐标系。
 *
 * 说明：
 * - 单选 + local 模式时，坐标系依赖物品自身当前旋转。
 * - 因此步进复制必须每一轮都重新计算，不能只取初始值。
 */
function getClipboardEffectiveWorkingRotation(
  clipboardData: ClipboardData,
  uiStore: ReturnType<typeof useUIStore>
) {
  const itemIds = new Set(clipboardData.items.map((item) => item.internalId))
  const itemsMap = new Map(clipboardData.items.map((item) => [item.internalId, item]))
  return uiStore.getEffectiveCoordinateRotation(itemIds, itemsMap) || { x: 0, y: 0, z: 0 }
}

type InsertIdMode = 'regenerate' | 'preserve-source'

interface InternalInsertOptions {
  idMode?: InsertIdMode
  offset?: { x: number; y: number; z: number }
  saveHistory?: boolean
  updateSelection?: boolean
  triggerUpdates?: boolean
}

export function useClipboard() {
  const store = useEditorStore()
  const uiStore = useUIStore()
  const { activeScheme, clipboardList: clipboard } = storeToRefs(store)
  const { saveHistory } = useEditorHistory()

  function buildClipboardDataFromSelection(): ClipboardData {
    const scheme = activeScheme.value
    if (!scheme) {
      return { sourceSchemeId: null, items: [], groupOrigins: new Map() }
    }

    const copiedItems = scheme.items.value
      .filter((item) => scheme.selectedItemIds.value.has(item.internalId))
      .map(cloneItem)

    if (copiedItems.length === 1) {
      const singleItem = copiedItems[0]
      if (singleItem && singleItem.groupId > 0) {
        singleItem.groupId = 0
      }
    }

    const involvedGroupIds = new Set<number>()
    copiedItems.forEach((item) => {
      if (item.groupId > 0) {
        involvedGroupIds.add(item.groupId)
      }
    })

    const copiedGroupOrigins = new Map<number, string>()
    involvedGroupIds.forEach((groupId) => {
      const originItemId = scheme.groupOrigins.value.get(groupId)
      if (originItemId) {
        copiedGroupOrigins.set(groupId, originItemId)
      }
    })

    return {
      sourceSchemeId: scheme.id,
      items: copiedItems,
      groupOrigins: copiedGroupOrigins,
    }
  }

  function copyToClipboard() {
    if (!activeScheme.value) return
    clipboard.value = buildClipboardDataFromSelection()
  }

  function cutToClipboard() {
    if (!activeScheme.value) return

    saveHistory('edit')
    copyToClipboard()

    activeScheme.value.items.value = activeScheme.value.items.value.filter(
      (item) => !activeScheme.value!.selectedItemIds.value.has(item.internalId)
    )
    activeScheme.value.selectedItemIds.value.clear()

    store.triggerSceneUpdate()
    store.triggerSelectionUpdate()
  }

  // 将新插入物品设为选中状态；选择更新触发由调用方统一负责
  function selectInsertedItems(ids: string[]) {
    const scheme = activeScheme.value
    if (!scheme) return

    scheme.selectedItemIds.value.clear()
    ids.forEach((id) => scheme.selectedItemIds.value.add(id))
  }

  // 将剪贴板数据插入当前方案：支持 regenerate（重分配 ID）和 preserve-source（保留源 ID）两种模式
  function insertClipboardData(
    clipboardData: ClipboardData,
    options: InternalInsertOptions = {}
  ): { newIds: string[]; newItems: AppItem[] } {
    const scheme = activeScheme.value
    if (!scheme || clipboardData.items.length === 0) {
      return { newIds: [], newItems: [] }
    }

    const {
      idMode = 'regenerate',
      offset = { x: 0, y: 0, z: 0 },
      saveHistory: shouldSaveHistory = true,
      updateSelection = true,
      triggerUpdates = true,
    } = options

    if (shouldSaveHistory) {
      saveHistory('edit')
    }

    let currentMaxInstanceId = scheme.maxInstanceId.value
    let currentMaxGroupId = scheme.maxGroupId.value

    const newIds: string[] = []
    const newItems: AppItem[] = []
    const itemIdMap = new Map<string, string>()
    const targetGroupIdMap = new Map<number, number>()

    if (idMode === 'preserve-source') {
      const sourceInstanceIds = new Set<number>()
      const sourceGroupIds = new Set<number>()

      for (const item of clipboardData.items) {
        sourceInstanceIds.add(item.instanceId)
        if (item.groupId > 0) {
          sourceGroupIds.add(item.groupId)
        }
      }

      const existingInstanceRemap = new Map<number, number>()
      const existingGroupRemap = new Map<number, number>()
      const existingGroupOrigins = new Map(scheme.groupOrigins.value)

      for (const item of scheme.items.value) {
        if (sourceInstanceIds.has(item.instanceId) && !existingInstanceRemap.has(item.instanceId)) {
          currentMaxInstanceId++
          existingInstanceRemap.set(item.instanceId, currentMaxInstanceId)
        }
        if (
          item.groupId > 0 &&
          sourceGroupIds.has(item.groupId) &&
          !existingGroupRemap.has(item.groupId)
        ) {
          currentMaxGroupId++
          existingGroupRemap.set(item.groupId, currentMaxGroupId)
        }
      }

      if (existingInstanceRemap.size > 0 || existingGroupRemap.size > 0) {
        for (const item of scheme.items.value) {
          const remappedInstanceId = existingInstanceRemap.get(item.instanceId)
          const remappedGroupId =
            item.groupId > 0 ? existingGroupRemap.get(item.groupId) : undefined
          const shouldRemapColorMap = existingGroupRemap.size > 0

          if (remappedInstanceId !== undefined) {
            item.instanceId = remappedInstanceId
          }

          if (shouldRemapColorMap) {
            item.extra = {
              ...cloneItemExtra(item.extra),
              ColorMap: remapColorMapGroupIds(item.extra.ColorMap, existingGroupRemap),
            }
          }

          if (remappedGroupId !== undefined) {
            item.groupId = remappedGroupId
          }
        }

        for (const [oldGroupId, newGroupId] of existingGroupRemap.entries()) {
          const originItemId = existingGroupOrigins.get(oldGroupId)
          existingGroupOrigins.delete(oldGroupId)
          if (originItemId) {
            existingGroupOrigins.set(newGroupId, originItemId)
          }
        }

        scheme.groupOrigins.value = existingGroupOrigins
      }

      sourceGroupIds.forEach((groupId) => targetGroupIdMap.set(groupId, groupId))
    } else {
      for (const item of clipboardData.items) {
        if (item.groupId > 0 && !targetGroupIdMap.has(item.groupId)) {
          currentMaxGroupId++
          targetGroupIdMap.set(item.groupId, currentMaxGroupId)
        }
      }
    }

    for (const item of clipboardData.items) {
      const newInternalId = generateUUID()
      itemIdMap.set(item.internalId, newInternalId)
      newIds.push(newInternalId)

      let nextInstanceId = item.instanceId
      if (idMode === 'regenerate') {
        currentMaxInstanceId++
        nextInstanceId = currentMaxInstanceId
      } else {
        currentMaxInstanceId = Math.max(currentMaxInstanceId, nextInstanceId)
      }

      const nextGroupId = item.groupId > 0 ? (targetGroupIdMap.get(item.groupId) ?? 0) : 0
      currentMaxGroupId = Math.max(currentMaxGroupId, nextGroupId)

      newItems.push({
        ...cloneItem(item),
        internalId: newInternalId,
        instanceId: nextInstanceId,
        x: item.x + offset.x,
        y: item.y + offset.y,
        z: item.z + offset.z,
        groupId: nextGroupId,
      })
    }

    const nextGroupOrigins = new Map(scheme.groupOrigins.value)
    clipboardData.groupOrigins.forEach((oldOriginItemId, oldGroupId) => {
      const newOriginItemId = itemIdMap.get(oldOriginItemId)
      const newGroupId = targetGroupIdMap.get(oldGroupId)
      if (newOriginItemId && newGroupId !== undefined) {
        nextGroupOrigins.set(newGroupId, newOriginItemId)
      }
    })

    scheme.groupOrigins.value = nextGroupOrigins
    scheme.items.value.push(...newItems)
    scheme.maxInstanceId.value = currentMaxInstanceId
    scheme.maxGroupId.value = currentMaxGroupId

    if (updateSelection) {
      selectInsertedItems(newIds)
    }

    if (triggerUpdates) {
      triggerRef(scheme.groupOrigins)
      store.triggerSceneUpdate()
      if (updateSelection) {
        store.triggerSelectionUpdate()
      }
    }

    return { newIds, newItems }
  }

  // 对剪贴板数据应用一次步进变换，返回变换后的新剪贴板快照（累计调用实现步进复制）
  function transformClipboardDataStep(
    clipboardData: ClipboardData,
    config: StepRepeatConfig,
    pivotData: { x: number; y: number; z: number }
  ): ClipboardData {
    const nextData = cloneClipboardData(clipboardData)
    const params: TransformParams = {
      mode: 'relative',
      position: uiStore.workingDeltaToData(config.positionDelta),
      rotation: { ...config.rotationDelta },
      scale: { ...config.scaleMultiplier },
    }

    // 关键修复：步进复制改为直接复用编辑器正式变换引擎，
    // 这样 repeat = 1 时会与“复制后手动执行一次相对变换”严格一致。
    nextData.items = applyTransformToItems(nextData.items, params, {
      rotationCenter: pivotData,
      positionReferencePoint: pivotData,
      effectiveWorkingRotation: getClipboardEffectiveWorkingRotation(nextData, uiStore),
      limitScaleValues: false,
      getScaleRange: () => null,
    })

    return nextData
  }

  function pasteItems(clipboardData: ClipboardData, offsetX: number, offsetY: number): string[] {
    return insertClipboardData(clipboardData, {
      idMode: 'regenerate',
      offset: { x: offsetX, y: offsetY, z: 0 },
    }).newIds
  }

  function copy() {
    if (!activeScheme.value || activeScheme.value.selectedItemIds.value.size === 0) {
      console.warn('[Clipboard] No items selected to copy')
      return
    }

    copyToClipboard()
    console.log(`[Clipboard] Copied ${clipboard.value.items.length} items`)
  }

  function cut() {
    if (!activeScheme.value || activeScheme.value.selectedItemIds.value.size === 0) {
      console.warn('[Clipboard] No items selected to cut')
      return
    }

    cutToClipboard()
    console.log(`[Clipboard] Cut ${clipboard.value.items.length} items`)
  }

  function paste() {
    if (clipboard.value.items.length === 0) {
      console.warn('[Clipboard] No items in clipboard to paste')
      return
    }

    pasteItems(clipboard.value, 0, 0)
    console.log(`[Clipboard] Pasted ${clipboard.value.items.length} items`)
  }

  // 高级粘贴入口：preserveIds 保留源 ID 并重编号冲突项；stepRepeat 迭代步进变换
  function advancedPaste(options: AdvancedPasteOptions): string[] {
    if (!activeScheme.value || clipboard.value.items.length === 0) {
      return []
    }

    if (options.mode === 'preserveIds') {
      if (clipboard.value.sourceSchemeId === activeScheme.value.id) {
        return []
      }

      return insertClipboardData(clipboard.value, {
        idMode: 'preserve-source',
      }).newIds
    }

    if (options.stepRepeat.repeatCount <= 0) {
      return []
    }

    saveHistory('edit')

    const { stepRepeat } = options
    const createdIds: string[] = []
    const pivot = getClipboardPivot(clipboard.value)
    let currentClipboardData = cloneClipboardData(clipboard.value)

    for (let index = 0; index < stepRepeat.repeatCount; index++) {
      currentClipboardData = transformClipboardDataStep(currentClipboardData, stepRepeat, pivot)
      const result = insertClipboardData(currentClipboardData, {
        idMode: 'regenerate',
        saveHistory: false,
        updateSelection: false,
        triggerUpdates: false,
      })
      createdIds.push(...result.newIds)
    }

    if (createdIds.length > 0) {
      selectInsertedItems(createdIds)
      triggerRef(activeScheme.value.groupOrigins)
      store.triggerSceneUpdate()
      store.triggerSelectionUpdate()
    }

    return createdIds
  }

  function clearClipboard() {
    clipboard.value = {
      sourceSchemeId: null,
      items: [],
      groupOrigins: new Map(),
    }
    console.log('[Clipboard] Cleared')
  }

  const hasClipboardData = computed(() => clipboard.value.items.length > 0)
  const canPreserveSourceIds = computed(
    () =>
      !!activeScheme.value &&
      !!clipboard.value.sourceSchemeId &&
      clipboard.value.sourceSchemeId !== activeScheme.value.id
  )

  return {
    clipboard: computed(() => clipboard.value),
    hasClipboardData,
    canPreserveSourceIds,
    copy,
    cut,
    paste,
    advancedPaste,
    pasteItems,
    clearClipboard,
    copyToClipboard,
    cutToClipboard,
    buildClipboardDataFromSelection,
  }
}
