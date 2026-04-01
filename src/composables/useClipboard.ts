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

/** 给每个粘贴出来的家具一个应用里唯一的 internalId（字符串）。 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 染色数据可能是数组或对象，这里各拷贝一份，避免和场景里别的物品共用一个引用。 */
function cloneColorMap(colorMap: AppItem['extra']['ColorMap'] | undefined) {
  if (Array.isArray(colorMap)) {
    return [...colorMap]
  }

  if (colorMap && typeof colorMap === 'object') {
    return { ...colorMap }
  }

  return undefined
}

/** 判断两份染色是否一样，给「要不要改 extra」时当比较用。 */
function isColorMapEqual(
  left: AppItem['extra']['ColorMap'] | undefined,
  right: AppItem['extra']['ColorMap'] | undefined
) {
  if (left === right) {
    return true
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }

    return left.every((value, index) => value === right[index])
  }

  if (!left || !right) {
    return left === right
  }

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  return leftKeys.every((key) => left[key] === right[key])
}

/** 把 extra（缩放、临时信息、染色等）深拷贝一层，防止复制改到原物品。 */
function cloneItemExtra(extra: AppItem['extra']): AppItem['extra'] {
  return {
    ...extra,
    Scale: extra.Scale ? { ...extra.Scale } : { X: 1, Y: 1, Z: 1 },
    TempInfo:
      extra.TempInfo && typeof extra.TempInfo === 'object' ? { ...extra.TempInfo } : undefined,
    ColorMap: cloneColorMap(extra.ColorMap),
  }
}

/** 复制一件家具：旋转角、extra 都拆开拷贝。 */
function cloneItem(item: AppItem): AppItem {
  return {
    ...item,
    rotation: { ...item.rotation },
    extra: cloneItemExtra(item.extra),
  }
}

/** 整份剪贴板再拷贝一份（步进复制每一轮都要在副本上改，不动用户手上的那份）。 */
function cloneClipboardData(clipboardData: ClipboardData): ClipboardData {
  return {
    sourceSchemeId: clipboardData.sourceSchemeId ?? null,
    items: clipboardData.items.map(cloneItem),
    groupOrigins: new Map(clipboardData.groupOrigins),
  }
}

/**
 * 游戏里染色会把「组号」编进数字里。场景里已有家具的组被改过编号时，
 * 染色里藏着的旧组号也要跟着换，否则颜色会指错组。
 */
function remapColorMapGroupIds(
  colorMap: AppItem['extra']['ColorMap'] | undefined,
  groupIdMap: Map<number, number>
) {
  if (!colorMap || groupIdMap.size === 0) {
    return cloneColorMap(colorMap)
  }

  if (Array.isArray(colorMap)) {
    return colorMap.map((raw) => {
      // 小于 10 的数当作「单色槽位」，里面没有组号，不用改
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

/**
 * 步进复制要「绕着一个点」旋转、缩放。这里选一个枢轴点：
 * 只有一组且能查到组原点时，用原点那一件的位置；否则用所有复制项坐标的包围盒中心。
 */
function getClipboardPivot(clipboardData: ClipboardData): { x: number; y: number; z: number } {
  const { items, groupOrigins } = clipboardData
  if (items.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  if (groupOrigins.size === 1) {
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
 * 步进复制用的「工作坐标系」角度（和侧边栏里工作坐标一致）。
 * 单选且局部坐标时跟那件家具的朝向有关，所以每一轮步进都要重新算，不能死记第一次的值。
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

/** insertClipboardData 的选项：是否记入撤销、是否刷新选中、是否通知场景重绘等。 */
interface InternalInsertOptions {
  idMode?: InsertIdMode
  offset?: { x: number; y: number; z: number }
  recordHistory?: boolean
  updateSelection?: boolean
  triggerUpdates?: boolean
}

export function useClipboard() {
  const store = useEditorStore()
  const uiStore = useUIStore()
  const { activeScheme, clipboardList: clipboard } = storeToRefs(store)
  const { recordTransaction } = useEditorHistory()

  /**
   * 把当前方案里「选中的家具」做成一份剪贴板数据。
   * 只选一件且它在某个组里时，会脱掉组（groupId 归零），避免贴出来还带半个组。
   * 多选涉及的组会把「组原点」一并记下来，粘贴后旋转/move 组时行为才正确。
   */
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

  /** 根据当前选中内容覆盖内存剪贴板（不写历史）。 */
  function copyToClipboard() {
    if (!activeScheme.value) return
    clipboard.value = buildClipboardDataFromSelection()
  }

  /** 先复制到剪贴板，再删掉选中项；整段包在一笔撤销里，可以一次 Ctrl+Z 找回。 */
  function cutToClipboard() {
    if (!activeScheme.value) return

    recordTransaction('clipboard.cut', () => {
      copyToClipboard()

      activeScheme.value!.items.value = activeScheme.value!.items.value.filter(
        (item) => !activeScheme.value!.selectedItemIds.value.has(item.internalId)
      )
      activeScheme.value!.selectedItemIds.value.clear()

      store.triggerSceneUpdate()
      store.triggerSelectionUpdate()
    })
  }

  /** 清空当前选择，只选中刚插入的这些 internalId。 */
  function selectInsertedItems(ids: string[]) {
    const scheme = activeScheme.value
    if (!scheme) return

    scheme.selectedItemIds.value.clear()
    ids.forEach((id) => scheme.selectedItemIds.value.add(id))
  }

  /**
   * 把剪贴板里的家具真正加进当前方案。
   *
   * - regenerate：新家具用新的 instanceId / groupId / internalId（日常粘贴、跨方案最省心）。
   * - preserve-source：尽量沿用剪贴板里的编号（对齐游戏存档）；若和场上已有冲突，会先给「旧家具」改号。
   */
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
      recordHistory: shouldRecordHistory = true,
      updateSelection = true,
      triggerUpdates = true,
    } = options

    const executeInsert = () => {
      const existingItems = scheme.items.value
      let currentMaxInstanceId = scheme.maxInstanceId.value
      let currentMaxGroupId = scheme.maxGroupId.value

      const newIds: string[] = []
      const newItems: AppItem[] = []
      const itemIdMap = new Map<string, string>()
      const targetGroupIdMap = new Map<number, number>()
      let nextExistingItems = existingItems
      let nextGroupOrigins = new Map(scheme.groupOrigins.value)

      // --- 保留源编号模式：先扫一遍场上，和剪贴板将要用的号冲突的「老家具」必须先改号腾出位置 ---
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

        for (const item of existingItems) {
          if (
            sourceInstanceIds.has(item.instanceId) &&
            !existingInstanceRemap.has(item.instanceId)
          ) {
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
          nextExistingItems = existingItems.map((item) => {
            const remappedInstanceId = existingInstanceRemap.get(item.instanceId)
            const remappedGroupId =
              item.groupId > 0 ? existingGroupRemap.get(item.groupId) : undefined
            const nextColorMap =
              existingGroupRemap.size > 0
                ? remapColorMapGroupIds(item.extra.ColorMap, existingGroupRemap)
                : item.extra.ColorMap
            const colorMapChanged =
              existingGroupRemap.size > 0 && !isColorMapEqual(item.extra.ColorMap, nextColorMap)

            if (
              remappedInstanceId === undefined &&
              remappedGroupId === undefined &&
              !colorMapChanged
            ) {
              return item
            }

            return {
              ...item,
              instanceId: remappedInstanceId ?? item.instanceId,
              groupId: remappedGroupId ?? item.groupId,
              extra: colorMapChanged
                ? {
                    ...cloneItemExtra(item.extra),
                    ColorMap: nextColorMap,
                  }
                : item.extra,
            }
          })

          for (const [oldGroupId, newGroupId] of existingGroupRemap.entries()) {
            const originItemId = nextGroupOrigins.get(oldGroupId)
            nextGroupOrigins.delete(oldGroupId)
            if (originItemId) {
              nextGroupOrigins.set(newGroupId, originItemId)
            }
          }
        }

        // 新贴上的家具：组号和剪贴板里一致（identity）。若和场上撞号，已在上面给「老家具」改过号了
        sourceGroupIds.forEach((groupId) => targetGroupIdMap.set(groupId, groupId))
      } else {
        // --- 日常模式：剪贴板里每个旧 groupId 映射成一个新的 groupId，避免和当前方案里已有组撞车 ---
        for (const item of clipboardData.items) {
          if (item.groupId > 0 && !targetGroupIdMap.has(item.groupId)) {
            currentMaxGroupId++
            targetGroupIdMap.set(item.groupId, currentMaxGroupId)
          }
        }
      }

      // 逐件生成新 internalId；instanceId / groupId 由上两种模式之一决定
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

      // 组原点：粘贴后要用「新组号 → 新原点那件 internalId」
      clipboardData.groupOrigins.forEach((oldOriginItemId, oldGroupId) => {
        const newOriginItemId = itemIdMap.get(oldOriginItemId)
        const newGroupId = targetGroupIdMap.get(oldGroupId)
        if (newOriginItemId && newGroupId !== undefined) {
          nextGroupOrigins.set(newGroupId, newOriginItemId)
        }
      })

      scheme.groupOrigins.value = nextGroupOrigins
      scheme.items.value = [...nextExistingItems, ...newItems]
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

    if (!shouldRecordHistory) {
      return executeInsert()
    }

    return recordTransaction(`clipboard.insert.${idMode}`, executeInsert)
  }

  /**
   * 步进复制的一小步：在一份剪贴板副本上做「相对移动 / 旋转 / 缩放」，得到下一批要落盘的形状。
   * 底层用编辑器的同一套变换逻辑，所以和你在场景里手动拖一次效果一致。
   */
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

    // 与主界面 Gizmo 使用同一套变换，保证「步进 1 次」=「粘贴后再做一次同样的相对变换」
    nextData.items = applyTransformToItems(nextData.items, params, {
      rotationCenter: pivotData,
      positionReferencePoint: pivotData,
      effectiveWorkingRotation: getClipboardEffectiveWorkingRotation(nextData, uiStore),
      limitScaleValues: false,
      getScaleRange: () => null,
    })

    return nextData
  }

  /** 在数据坐标下平移 dx、dy 后插入（Z 不改）；返回新物品的 internalId 列表。 */
  function pasteItems(clipboardData: ClipboardData, offsetX: number, offsetY: number): string[] {
    return insertClipboardData(clipboardData, {
      idMode: 'regenerate',
      offset: { x: offsetX, y: offsetY, z: 0 },
    }).newIds
  }

  /** 有选中则写入内存剪贴板（供 UI / 快捷键调用）。 */
  function copy() {
    if (!activeScheme.value || activeScheme.value.selectedItemIds.value.size === 0) {
      console.warn('[Clipboard] No items selected to copy')
      return
    }

    copyToClipboard()
    console.log(`[Clipboard] Copied ${clipboard.value.items.length} items`)
  }

  /** 有选中则复制并删除原物（可撤销）。 */
  function cut() {
    if (!activeScheme.value || activeScheme.value.selectedItemIds.value.size === 0) {
      console.warn('[Clipboard] No items selected to cut')
      return
    }

    cutToClipboard()
    console.log(`[Clipboard] Cut ${clipboard.value.items.length} items`)
  }

  /** 剪贴板有内容则在原位置插入一份副本（新编号）。 */
  function paste() {
    if (clipboard.value.items.length === 0) {
      console.warn('[Clipboard] No items in clipboard to paste')
      return
    }

    pasteItems(clipboard.value, 0, 0)
    console.log(`[Clipboard] Pasted ${clipboard.value.items.length} items`)
  }

  /**
   * 两种用途：
   * 1）preserveIds — 从别的方案拷来时保留存档里的 ID；同方案内不能用来「自己贴自己」。
   * 2）stepRepeat — 按设定多次「变一点再贴一份」，多轮插入合成一笔撤销。
   */
  function advancedPaste(options: AdvancedPasteOptions): string[] {
    if (!activeScheme.value || clipboard.value.items.length === 0) {
      return []
    }

    if (options.mode === 'preserveIds') {
      // 来源就是当前标签：贴进来会和现有物品完全同号，逻辑上无意义，直接跳过
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

    return recordTransaction('clipboard.step_repeat', () => {
      const { stepRepeat } = options
      const createdIds: string[] = []
      const pivot = getClipboardPivot(clipboard.value)
      let currentClipboardData = cloneClipboardData(clipboard.value)

      for (let index = 0; index < stepRepeat.repeatCount; index++) {
        currentClipboardData = transformClipboardDataStep(currentClipboardData, stepRepeat, pivot)
        // 每一轮单独插入但不各占撤销栈一层；最后整段 step_repeat 算一次操作
        const result = insertClipboardData(currentClipboardData, {
          idMode: 'regenerate',
          recordHistory: false,
          updateSelection: false,
          triggerUpdates: false,
        })
        createdIds.push(...result.newIds)
      }

      if (createdIds.length > 0) {
        selectInsertedItems(createdIds)
        triggerRef(activeScheme.value!.groupOrigins)
        store.triggerSceneUpdate()
        store.triggerSelectionUpdate()
      }

      return createdIds
    })
  }

  /** 清空内存里的剪贴板内容。 */
  function clearClipboard() {
    clipboard.value = {
      sourceSchemeId: null,
      items: [],
      groupOrigins: new Map(),
    }
    console.log('[Clipboard] Cleared')
  }

  const hasClipboardData = computed(() => clipboard.value.items.length > 0)
  /** 只有「剪贴板来自另一个方案」时才允许做「保留源 ID」粘贴，否则会和本方案自己冲突。 */
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
