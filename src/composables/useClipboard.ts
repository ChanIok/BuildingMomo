import { resolveSelectionReference } from '@/lib/selectionReference'
import {
  captureClipboardStructure,
  createEmptyClipboardData,
  restoreClipboardStructure,
} from '@/lib/clipboardStructure'
import { resolveCollectionEntries } from '@/lib/collectionTargets'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useI18n } from './useI18n'
import { setSchemeItems } from '../lib/groupState'
import { computed, shallowRef, triggerRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editorStore'
import { useUIStore } from '../stores/uiStore'
import { useEditorHistory } from './editor/useEditorHistory'
import {
  applyRelativeSelectionTransform,
  createSelectionTransformFrame,
} from '../lib/selectionTransform'
import type {
  AppItem,
  AdvancedPasteOptions,
  ClipboardData,
  CollectionEntry,
  PasteResult,
  StepRepeatConfig,
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
      extra.TempInfo && typeof extra.TempInfo === 'object'
        ? structuredClone(extra.TempInfo)
        : undefined,
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

  const reference = items.find((item) => item.internalId === clipboardData.referenceItemId)
  if (reference) return { x: reference.x, y: reference.y, z: reference.z }

  if (groupOrigins.size === 1) {
    for (const [groupId, originItemId] of groupOrigins) {
      const originItem = items.find(
        (item) => item.internalId === originItemId && item.groupId === groupId
      )
      if (originItem && items.every((item) => item.groupId === groupId)) {
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

function containsClipboardData(data: ClipboardData) {
  return data.items.length > 0 || data.structure.collectionIds.length > 0
}

/** insertClipboardData 的选项：是否记入撤销、是否刷新选中、是否通知场景重绘等。 */
interface InternalInsertOptions {
  idMode?: InsertIdMode
  offset?: { x: number; y: number; z: number }
  recordHistory?: boolean
  updateSelection?: boolean
  triggerUpdates?: boolean
  parentId?: string | null
}

export function useClipboard() {
  const store = useEditorStore()
  const uiStore = useUIStore()
  const cloud = useCloudSchemeStore()
  const { t } = useI18n()
  const { activeScheme, clipboardList: clipboard } = storeToRefs(store)
  const { recordTransaction } = useEditorHistory()

  function canInsertClipboard(data: ClipboardData, parentId?: string | null) {
    const scheme = activeScheme.value
    if (!scheme || !containsClipboardData(data)) return false
    const existing = new Set(scheme.collectionTree.value.nodes.map((node) => node.id))
    if (parentId != null && !existing.has(parentId)) return false
    // 目录编辑的连接约束只作用于新能力，不阻断原有家具粘贴的离线事务。
    const editsCollections =
      parentId !== undefined ||
      data.structure.collectionIds.length > 0 ||
      data.structure.tree.nodes.some(
        (node) => data.sourceSchemeId !== scheme.id || !existing.has(node.id)
      )
    return (
      !editsCollections ||
      scheme.source.value !== 'cloud' ||
      (scheme.collectionsSupported.value && cloud.isConnected && cloud.schemeId === scheme.id)
    )
  }

  /**
   * 无参时复制画布家具选区；传节点时复制完整组/集合，不受画布保护和过滤影响。
   * 画布只选一件时脱组；面板选中的单家具组仍保留组身份。
   * 目录、组原点和个人标记均在复制时快照，不在粘贴时回读源方案。
   */
  function buildClipboardDataFromSelection(entries?: readonly CollectionEntry[]): ClipboardData {
    const scheme = activeScheme.value
    if (!scheme) {
      return createEmptyClipboardData()
    }

    entries ??= scheme.selectedEntries.value ?? undefined
    const resolved = entries ? resolveCollectionEntries(scheme, entries) : null
    const sourceItems =
      resolved?.items ??
      scheme.items.value.filter(
        (item) =>
          scheme.selectedItemIds.value.has(item.internalId) && store.isItemEditable(item.internalId)
      )
    const copiedItems = sourceItems.map(cloneItem)

    if (!entries && copiedItems.length === 1) {
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
      referenceItemId: resolveSelectionReference({
        ...scheme,
        selectedEntries: shallowRef(entries ?? null),
        selectedItemIds: shallowRef(new Set(copiedItems.map((item) => item.internalId))),
      })?.item.internalId,
      items: copiedItems,
      groupOrigins: copiedGroupOrigins,
      structure: captureClipboardStructure(scheme, involvedGroupIds, resolved?.collectionIds),
    }
  }

  /** 根据当前选中内容覆盖内存剪贴板（不写历史）。 */
  function copyToClipboard(entries?: readonly CollectionEntry[]) {
    if (!activeScheme.value) return
    const data = buildClipboardDataFromSelection(entries)
    if (containsClipboardData(data)) clipboard.value = data
  }

  /** 先复制到剪贴板，再删掉选中项；整段包在一笔撤销里，可以一次 Ctrl+Z 找回。 */
  function cutToClipboard() {
    if (!activeScheme.value) return

    recordTransaction('clipboard.cut', () => {
      copyToClipboard()

      setSchemeItems(
        activeScheme.value!,
        activeScheme.value!.items.value.filter(
          (item) => !activeScheme.value!.selectedItemIds.value.has(item.internalId)
        )
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

    scheme.selectedEntries.value = null
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
  ): PasteResult {
    const scheme = activeScheme.value
    if (!scheme || !canInsertClipboard(clipboardData, options.parentId)) {
      return { newIds: [], roots: [] }
    }

    const {
      idMode = 'regenerate',
      offset = { x: 0, y: 0, z: 0 },
      recordHistory: shouldRecordHistory = true,
      updateSelection = true,
      triggerUpdates = true,
      parentId,
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

      // 保留来源 ID 时，也可能需要重映射其他家具的染色引用。
      if (
        nextExistingItems.some(
          (item, index) => item !== existingItems[index] && !store.isItemEditable(item.internalId)
        )
      ) {
        return { newIds: [], roots: [] }
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

      // 先协调已有组，再恢复副本的目录与名称：保留 ID 模式会复用刚腾出的来源编号。
      setSchemeItems(scheme, nextExistingItems)
      if (newItems.length) scheme.items.value = [...nextExistingItems, ...newItems]
      const structure = clipboardData.structure
      const restored = restoreClipboardStructure(
        structure,
        scheme.collectionTree.value,
        targetGroupIdMap,
        clipboardData.sourceSchemeId === scheme.id,
        parentId,
        (name) => t('groups.copyName', { name }).slice(0, 200),
        itemIdMap
      )
      scheme.collectionTree.value = restored.tree
      const newGroupIds = new Set(targetGroupIdMap.values())
      for (const [state, ids] of [
        [scheme.hiddenGroupIds, structure.hiddenGroups],
        [scheme.lockedGroupIds, structure.lockedGroups],
      ] as const) {
        // 清除可能复用的来源编号上的旧个人标记，尤其是保留 ID 粘贴。
        const next = new Set([...state.value].filter((id) => !newGroupIds.has(id)))
        for (const id of ids) {
          const mapped = targetGroupIdMap.get(id)
          if (mapped !== undefined) next.add(mapped)
        }
        state.value = next
      }
      for (const [state, ids] of [
        [scheme.hiddenCollectionIds, structure.hiddenCollections],
        [scheme.lockedCollectionIds, structure.lockedCollections],
      ] as const) {
        const next = new Set(state.value)
        for (const id of ids) {
          const mapped = restored.collectionMap.get(id)
          if (mapped) next.add(mapped)
        }
        state.value = next
      }
      if (newItems.length) scheme.groupOrigins.value = nextGroupOrigins
      scheme.maxInstanceId.value = currentMaxInstanceId
      scheme.maxGroupId.value = currentMaxGroupId

      if (updateSelection) {
        selectInsertedItems(newIds)
        scheme.selectedEntries.value = restored.roots
      }

      if (triggerUpdates) {
        if (newItems.length) {
          triggerRef(scheme.groupOrigins)
          store.triggerSceneUpdate()
        }
        if (updateSelection) {
          store.triggerSelectionUpdate()
          uiStore.groupPanelPasteTarget = { schemeId: scheme.id, roots: restored.roots }
        }
      }

      return { newIds, roots: restored.roots }
    }

    if (!shouldRecordHistory) {
      return executeInsert()
    }

    return recordTransaction(`clipboard.insert.${idMode}`, executeInsert)
  }

  /**
   * 步进复制只替换变换后的家具，目录、组原点和个人标记复用只读快照。
   * 底层用编辑器的同一套变换逻辑，所以和你在场景里手动拖一次效果一致。
   */
  function transformClipboardDataStep(
    clipboardData: ClipboardData,
    config: StepRepeatConfig,
    pivotData: { x: number; y: number; z: number }
  ): ClipboardData {
    // 第一步：每一轮根据当前副本解析有效坐标系，并围绕固定步进 Pivot 建立共享 Frame。
    const workingRotation = getClipboardEffectiveWorkingRotation(clipboardData, uiStore)
    const frame = createSelectionTransformFrame(pivotData, workingRotation)
    // 第二步：统一执行 Scale → Rotate → Translate，倍率始终采用界面视觉 x/y/z。
    const items = applyRelativeSelectionTransform(
      clipboardData.items,
      {
        positionDelta: uiStore.workingDeltaToData(config.positionDelta),
        rotationDelta: { ...config.rotationDelta },
        scaleFactors: { ...config.scaleMultiplier },
      },
      frame
    )

    return { ...clipboardData, items }
  }

  /** 在数据坐标下平移 dx、dy 后插入（Z 不改），返回新家具 ID 和面板根节点。 */
  function pasteItems(
    clipboardData: ClipboardData,
    offsetX: number,
    offsetY: number,
    parentId?: string | null
  ): PasteResult {
    return insertClipboardData(clipboardData, {
      idMode: 'regenerate',
      offset: { x: offsetX, y: offsetY, z: 0 },
      parentId,
    })
  }

  /** 有选中则写入内存剪贴板（供 UI / 快捷键调用）。 */
  function copy(entries?: readonly CollectionEntry[]) {
    if (!activeScheme.value || (!entries && activeScheme.value.selectedItemIds.value.size === 0)) {
      console.warn('[Clipboard] No items selected to copy')
      return
    }

    copyToClipboard(entries)
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
    if (!hasClipboardData.value) {
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
  function advancedPaste(options: AdvancedPasteOptions): PasteResult {
    if (!canPaste.value) {
      return { newIds: [], roots: [] }
    }

    if (options.mode === 'preserveIds') {
      // 来源就是当前标签：贴进来会和现有物品完全同号，逻辑上无意义，直接跳过
      if (clipboard.value.sourceSchemeId === activeScheme.value!.id) {
        return { newIds: [], roots: [] }
      }

      return insertClipboardData(clipboard.value, {
        idMode: 'preserve-source',
      })
    }

    if (options.stepRepeat.repeatCount <= 0) {
      return { newIds: [], roots: [] }
    }

    return recordTransaction('clipboard.step_repeat', () => {
      const { stepRepeat } = options
      const createdIds: string[] = []
      const roots: PasteResult['roots'] = []
      const pivot = getClipboardPivot(clipboard.value)
      let currentClipboardData = clipboard.value

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
        roots.push(...result.roots)
      }

      if (createdIds.length > 0 || roots.length > 0) {
        selectInsertedItems(createdIds)
        activeScheme.value!.selectedEntries.value = roots
        if (createdIds.length > 0) {
          triggerRef(activeScheme.value!.groupOrigins)
          store.triggerSceneUpdate()
        }
        store.triggerSelectionUpdate()
        uiStore.groupPanelPasteTarget = { schemeId: activeScheme.value!.id, roots }
      }

      return { newIds: createdIds, roots }
    })
  }

  /** 清空内存里的剪贴板内容。 */
  function clearClipboard() {
    clipboard.value = createEmptyClipboardData()
    console.log('[Clipboard] Cleared')
  }

  const hasClipboardData = computed(() => containsClipboardData(clipboard.value))
  const canPaste = computed(() => canInsertClipboard(clipboard.value))
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
    canPaste,
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
