import type { useEditorStore } from '@/stores/editorStore'
import type { useNotification } from '@/composables/useNotification'
import type { AppItem, GameDataFile, GameItem } from '@/types/editor'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorItemAdd } from '@/composables/editor/useEditorItemAdd'

type SchemeCodeType = 'island' | 'combination'
type TranslateFn = (key: string, params?: Record<string, string | number>) => string

interface CreateCodeImportOpsParams {
  editorStore: ReturnType<typeof useEditorStore>
  notification: ReturnType<typeof useNotification>
  t: TranslateFn
  ensureResourcesReady: () => void
  preloadActiveSchemeResources: () => void
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function normalizeSchemeCodeType(type: unknown): SchemeCodeType {
  return type === 'combination' ? 'combination' : 'island'
}

function cloneColorMap(
  colorMap: GameItem['ColorMap'] | undefined
): NonNullable<GameItem['ColorMap']> {
  if (Array.isArray(colorMap)) {
    return [...colorMap]
  }

  if (colorMap && typeof colorMap === 'object') {
    return { ...colorMap }
  }

  return { '0': 0 }
}

function convertGameItemToAppItem(gameItem: GameItem): AppItem {
  const { Location, Rotation, GroupID, ItemID, InstanceID, ...others } = gameItem
  return {
    internalId: generateUUID(),
    gameId: ItemID,
    instanceId: InstanceID,
    x: Location?.X ?? 0,
    y: Location?.Y ?? 0,
    z: Location?.Z ?? 0,
    rotation: {
      x: Rotation?.Roll ?? 0,
      y: Rotation?.Pitch ?? 0,
      z: Rotation?.Yaw ?? 0,
    },
    groupId: GroupID ?? 0,
    extra: {
      ...others,
      Scale: {
        X: others.Scale?.X ?? 1,
        Y: others.Scale?.Y ?? 1,
        Z: others.Scale?.Z ?? 1,
      },
      AttachID: typeof others.AttachID === 'number' ? others.AttachID : 0,
      TempInfo:
        others.TempInfo && typeof others.TempInfo === 'object' ? { ...others.TempInfo } : {},
      ColorMap: cloneColorMap(others.ColorMap),
    },
  }
}

export function createCodeImportOps(params: CreateCodeImportOpsParams) {
  const { editorStore, notification, t, ensureResourcesReady, preloadActiveSchemeResources } =
    params
  const { saveHistory } = useEditorHistory()
  const { getAddPositionFn } = useEditorItemAdd()

  function getCombinationImportPosition(): [number, number, number] {
    if (getAddPositionFn.value) {
      const hitPosition = getAddPositionFn.value()
      if (hitPosition) {
        return hitPosition
      }
    }

    return [0, 0, 0]
  }

  function importCombinationIntoActiveScheme(gameItems: GameItem[]): {
    success: boolean
    count: number
  } {
    if (!editorStore.activeScheme) {
      editorStore.createScheme()
    }

    const scheme = editorStore.activeScheme
    if (!scheme) {
      return { success: false, count: 0 }
    }

    const sourceItems = gameItems.map(convertGameItemToAppItem)
    if (sourceItems.length === 0) {
      return { success: true, count: 0 }
    }

    const targetPosition = getCombinationImportPosition()

    // 锚点：中心 XY + 最低 Z
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity

    for (const item of sourceItems) {
      if (item.x < minX) minX = item.x
      if (item.x > maxX) maxX = item.x
      if (item.y < minY) minY = item.y
      if (item.y > maxY) maxY = item.y
      if (item.z < minZ) minZ = item.z
    }

    const sourceCenterX = (minX + maxX) / 2
    const sourceCenterY = (minY + maxY) / 2
    const offsetX = targetPosition[0] - sourceCenterX
    const offsetY = targetPosition[1] - sourceCenterY
    const offsetZ = targetPosition[2] - minZ

    saveHistory('edit')

    let currentMaxInstanceId = scheme.maxInstanceId.value
    let currentMaxGroupId = scheme.maxGroupId.value
    const groupIdMap = new Map<number, number>()
    const newInternalIds: string[] = []
    const insertedItems: AppItem[] = []

    for (const item of sourceItems) {
      const oldGroupId = item.groupId
      let newGroupId = 0

      if (oldGroupId > 0) {
        if (!groupIdMap.has(oldGroupId)) {
          currentMaxGroupId++
          groupIdMap.set(oldGroupId, currentMaxGroupId)
        }
        newGroupId = groupIdMap.get(oldGroupId) ?? 0
      }

      currentMaxInstanceId++
      const newInternalId = generateUUID()
      newInternalIds.push(newInternalId)

      insertedItems.push({
        ...item,
        internalId: newInternalId,
        instanceId: currentMaxInstanceId,
        x: item.x + offsetX,
        y: item.y + offsetY,
        z: item.z + offsetZ,
        groupId: newGroupId,
        rotation: { ...item.rotation },
        extra: {
          ...item.extra,
          Scale: item.extra.Scale ? { ...item.extra.Scale } : { X: 1, Y: 1, Z: 1 },
          TempInfo:
            item.extra.TempInfo && typeof item.extra.TempInfo === 'object'
              ? { ...item.extra.TempInfo }
              : {},
          ColorMap: cloneColorMap(item.extra.ColorMap),
        },
      })
    }

    scheme.items.value.push(...insertedItems)
    scheme.maxInstanceId.value = currentMaxInstanceId
    scheme.maxGroupId.value = currentMaxGroupId
    scheme.selectedItemIds.value = new Set(newInternalIds)

    editorStore.triggerSceneUpdate()
    editorStore.triggerSelectionUpdate()

    return { success: true, count: insertedItems.length }
  }

  async function importFromCode(code: string): Promise<void> {
    try {
      ensureResourcesReady()

      const apiUrl = `https://nuan5.pro/api/home/code/${encodeURIComponent(code)}?export=save-data`
      const response = await fetch(apiUrl)

      if (!response.ok) {
        if (response.status === 404) {
          notification.error(t('fileOps.importCode.notFound'))
        } else {
          notification.error(t('fileOps.importCode.networkError', { reason: response.statusText }))
        }
        return
      }

      const jsonData = (await response.json()) as {
        type?: unknown
        data?: unknown
      }

      if (!jsonData || !Array.isArray(jsonData.data)) {
        notification.error(t('fileOps.importCode.parseError'))
        return
      }

      const codeType = normalizeSchemeCodeType(jsonData.type)
      const gameItems = jsonData.data as GameItem[]

      if (codeType === 'combination') {
        const result = importCombinationIntoActiveScheme(gameItems)

        if (result.success) {
          console.log(`[FileOps] Successfully imported combination from code: ${code}`, {
            itemCount: result.count,
          })
          notification.success(t('fileOps.importCode.success'))
          preloadActiveSchemeResources()
        } else {
          notification.error(t('fileOps.importCode.parseError'))
        }
        return
      }

      const gameDataFile: GameDataFile = {
        NeedRestore: true,
        PlaceInfo: gameItems,
      }

      const result = await editorStore.importJSONAsScheme(
        JSON.stringify(gameDataFile),
        `Scheme_${code}`,
        Date.now()
      )

      if (result.success) {
        console.log(`[FileOps] Successfully imported island scheme from code: ${code}`)
        notification.success(t('fileOps.importCode.success'))
        preloadActiveSchemeResources()
      } else {
        notification.error(t('fileOps.import.failed', { reason: result.error || 'Unknown error' }))
      }
    } catch (error: any) {
      console.error('[FileOps] Failed to import from code:', error)
      notification.error(
        t('fileOps.importCode.networkError', { reason: error.message || 'Unknown error' })
      )
    }
  }

  return {
    importFromCode,
  }
}
