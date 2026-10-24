import type { useEditorStore } from '@/stores/editorStore'
import type { useSettingsStore } from '@/stores/settingsStore'

/** 手动 JSON 与游戏监控共用自动继承策略；其他导入保持原有语义。 */
export function createGameImportOps(
  editorStore: ReturnType<typeof useEditorStore>,
  settingsStore: ReturnType<typeof useSettingsStore>,
  t: (key: string, params?: Record<string, string | number>) => string
) {
  async function importGameJSON(content: string, name: string, lastModified?: number) {
    const sourceId = settingsStore.settings.autoInheritGroupMetadata
      ? settingsStore.settings.lastSavedToGameSchemeId
      : null
    const result = await editorStore.importJSONAsScheme(content, name, lastModified, {
      inheritGroupsFromSchemeId: sourceId ?? undefined,
    })
    // 自动继承是附加能力，未发生时不干扰正常导入的成功提示。
    const count = result.inheritedGroupCount ?? 0
    const message =
      result.success && count > 0
        ? t('fileOps.import.groupsInherited', { count })
        : t('fileOps.import.success')
    return { ...result, message }
  }
  return { importGameJSON }
}
