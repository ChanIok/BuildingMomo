import { ref, onUnmounted } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import type { GameDataFile, GameItem } from '../types/editor'
import { useNotification } from './useNotification'
import { useSettingsStore } from '../stores/settingsStore'
import type { AlertDetailItem } from '../stores/notificationStore'
import { storeToRefs } from 'pinia'
import { useValidationStore } from '../stores/validationStore'
import { useGameDataStore } from '../stores/gameDataStore'
import { getIconLoader } from './useIconLoader'
import { getThreeModelManager } from './useThreeModelManager'
import { useI18n } from './useI18n'
import backgroundUrl from '@/assets/home.webp'
import { createCodeImportOps } from './fileOps/codeImport'
import { createWatchModeOps } from './fileOps/watchMode'

// 检查浏览器是否支持 File System Access API
const isFileSystemAccessSupported = 'showDirectoryPicker' in window

// 模块级变量：是否不再提醒保存警告（本次访问有效）
const suppressSaveWarning = ref(false)

export function useFileOperations(editorStore: ReturnType<typeof useEditorStore>) {
  const notification = useNotification()
  const { t } = useI18n()
  const settingsStore = useSettingsStore()
  const gameDataStore = useGameDataStore()
  const validationStore = useValidationStore()
  const { hasDuplicate, duplicateItemCount, hasLimitIssues, limitIssues } =
    storeToRefs(validationStore)

  function preloadImage(url: string) {
    const img = new Image()
    img.src = url
  }

  function preloadActiveSchemeResources() {
    if (editorStore.activeScheme) {
      const uniqueIds = [...new Set(editorStore.activeScheme.items.value.map((i) => i.gameId))]

      getIconLoader().preloadIcons(uniqueIds)

      if (import.meta.env.VITE_ENABLE_SECURE_MODE === 'true' && settingsStore.isAuthenticated) {
        getThreeModelManager()
          .preloadModels(uniqueIds)
          .catch((err) => {
            console.warn('[FileOps] 模型预加载失败:', err)
          })
      }
    }
  }

  function ensureResourcesReady() {
    gameDataStore.initialize()
    preloadImage(backgroundUrl)
  }

  async function prepareDataForSave(): Promise<GameItem[] | null> {
    const details: AlertDetailItem[] = []

    if (settingsStore.settings.enableDuplicateDetection && hasDuplicate.value) {
      details.push({
        type: 'warning',
        title: t('fileOps.duplicate.title'),
        text: `${t('fileOps.duplicate.desc', { n: duplicateItemCount.value })}\n${t('fileOps.duplicate.detail')}`,
      })
    }

    if (hasLimitIssues.value) {
      const { outOfBoundsItemIds, oversizedGroups, invalidScaleItemIds, invalidRotationItemIds } =
        limitIssues.value
      const limitMsgs: string[] = []

      if (outOfBoundsItemIds.length > 0) {
        limitMsgs.push(t('fileOps.limit.outOfBounds', { n: outOfBoundsItemIds.length }))
      }
      if (oversizedGroups.length > 0) {
        limitMsgs.push(t('fileOps.limit.oversized', { n: oversizedGroups.length }))
      }
      if (invalidScaleItemIds.length > 0) {
        limitMsgs.push(t('fileOps.limit.invalidScale', { n: invalidScaleItemIds.length }))
      }
      if (invalidRotationItemIds.length > 0) {
        limitMsgs.push(t('fileOps.limit.invalidRotation', { n: invalidRotationItemIds.length }))
      }

      if (limitMsgs.length > 0) {
        details.push({
          type: 'info',
          title: t('fileOps.limit.title'),
          text: t('fileOps.limit.desc'),
          list: limitMsgs,
        })
      }
    }

    if (details.length > 0 && !suppressSaveWarning.value) {
      const { confirmed, checked } = await notification.confirmWithCheckbox({
        title: t('fileOps.save.confirmTitle'),
        description: t('fileOps.save.confirmDesc'),
        details: details,
        confirmText: t('fileOps.save.continue'),
        cancelText: t('common.cancel'),
        checkboxLabel: t('fileOps.save.dontShowAgain'),
      })

      if (!confirmed) {
        return null
      }

      if (checked) {
        suppressSaveWarning.value = true
      }
    }

    const outOfBoundsIds = new Set(limitIssues.value.outOfBoundsItemIds)
    const oversizedGroupIds = new Set(limitIssues.value.oversizedGroups)
    const invalidScaleIds = new Set(limitIssues.value.invalidScaleItemIds)
    const invalidRotationIds = new Set(limitIssues.value.invalidRotationItemIds)

    const gameItems: GameItem[] = (editorStore.activeScheme?.items.value ?? [])
      .filter((item) => !outOfBoundsIds.has(item.internalId))
      .map((item) => {
        const originalGroupId = item.groupId
        let newGroupId = originalGroupId

        if (originalGroupId > 0 && oversizedGroupIds.has(originalGroupId)) {
          newGroupId = 0
        }

        let finalScale = { ...item.extra.Scale }
        if (invalidScaleIds.has(item.internalId)) {
          const furniture = gameDataStore.getFurniture(item.gameId)
          if (furniture?.scaleRange) {
            const [min, max] = furniture.scaleRange
            finalScale.X = Math.max(min, Math.min(max, finalScale.X))
            finalScale.Y = Math.max(min, Math.min(max, finalScale.Y))
            finalScale.Z = Math.max(min, Math.min(max, finalScale.Z))
          }
        }

        let finalRotation = { ...item.rotation }
        if (invalidRotationIds.has(item.internalId)) {
          const furniture = gameDataStore.getFurniture(item.gameId)
          if (furniture?.rotationAllowed) {
            if (!furniture.rotationAllowed.x) finalRotation.x = 0
            if (!furniture.rotationAllowed.y) finalRotation.y = 0
          }
        }

        return {
          ...item.extra,
          ItemID: item.gameId,
          InstanceID: item.instanceId,
          GroupID: newGroupId,
          Location: {
            X: item.x,
            Y: item.y,
            Z: item.z,
          },
          Rotation: {
            Roll: finalRotation.x,
            Pitch: finalRotation.y,
            Yaw: finalRotation.z,
          },
          Scale: finalScale,
        }
      })

    return gameItems
  }

  async function importJSON(): Promise<void> {
    ensureResourcesReady()

    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'

      input.onchange = (event: Event) => {
        const target = event.target as HTMLInputElement
        const file = target.files?.[0]

        if (!file) {
          resolve()
          return
        }

        const reader = new FileReader()
        reader.onload = async (e) => {
          const content = e.target?.result as string
          const result = await editorStore.importJSONAsScheme(content, file.name, file.lastModified)

          if (result.success) {
            console.log(`[FileOps] Successfully imported scheme: ${file.name}`)
            notification.success(t('fileOps.import.success'))
            preloadActiveSchemeResources()
          } else {
            notification.error(
              t('fileOps.import.failed', { reason: result.error || 'Unknown error' })
            )
          }

          resolve()
        }

        reader.onerror = () => {
          notification.error(t('fileOps.import.readFailed'))
          resolve()
        }

        reader.readAsText(file)
      }

      input.click()
    })
  }

  async function exportJSON(filename?: string): Promise<void> {
    if ((editorStore.activeScheme?.items.value.length ?? 0) === 0) {
      notification.warning(t('fileOps.export.noData'))
      return
    }

    const gameItems = await prepareDataForSave()
    if (!gameItems) return

    const exportData: GameDataFile = {
      NeedRestore: true,
      PlaceInfo: gameItems,
    }

    const jsonString = JSON.stringify(exportData)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    let downloadName = filename
    if (!downloadName) {
      if (editorStore.activeScheme?.filePath.value) {
        downloadName = editorStore.activeScheme.filePath.value
      } else {
        downloadName = `BUILD_SAVEDATA_${Date.now()}.json`
      }
    }
    link.download = downloadName
    link.click()

    URL.revokeObjectURL(url)

    console.log(`[FileOps] Exported ${gameItems.length} items to ${link.download}`)
  }

  const watchOps = createWatchModeOps({
    editorStore,
    settingsStore,
    notification,
    t,
    ensureResourcesReady,
    preloadActiveSchemeResources,
    prepareDataForSave,
  })

  const { importFromCode } = createCodeImportOps({
    editorStore,
    notification,
    t,
    ensureResourcesReady,
    preloadActiveSchemeResources,
  })

  onUnmounted(() => {
    watchOps.cleanup()
  })

  return {
    importJSON,
    importFromCode,
    exportJSON,
    saveToGame: watchOps.saveToGame,
    isFileSystemAccessSupported,
    watchState: watchOps.watchState,
    startWatchMode: watchOps.startWatchMode,
    stopWatchMode: watchOps.stopWatchMode,
    importFromWatchedFile: watchOps.importFromWatchedFile,
    checkFileUpdate: watchOps.checkFileUpdate,
    getWatchHistory: watchOps.getWatchHistory,
    clearWatchHistory: watchOps.clearWatchHistory,
    deleteHistoryRecord: watchOps.deleteHistoryRecord,
    importFromHistory: watchOps.importFromHistory,
  }
}
